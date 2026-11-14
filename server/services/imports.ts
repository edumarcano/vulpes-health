import { createHash } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';
import { ImportResultSchema, CSV_LIMIT_BYTES } from '../../shared/imports.js';
import {
  IMPORT_METADATA_LIMIT_BYTES,
  ImportBundleSchema,
  ImportPreviewV2Schema,
  InspectionSchema,
  initialImportReview,
  type GenericObservationTuple,
  type ImportBundle,
  type ImportReadSchema,
  type PreviewCsvWire,
  type ReviewImportSchema,
} from '../../shared/import-v2.js';
import {
  METRIC_REGISTRY_VERSION,
  RENPHO_ADAPTER_VERSION,
  metricRegistry,
} from '../../shared/metrics.js';
import type { ImportCommitRequest } from '../../shared/api.js';
import type { AuthContext } from '../auth/session.js';
import { HttpFailure } from '../http/failure.js';
import { MAX_PAYLOAD_BYTES } from '../security/encryption.js';
import {
  discardImportPayload,
  readPayload,
  writePayload,
} from '../security/private-payloads.js';
import { parseCsv } from './csv.js';
import { parseRenphoV1 } from './imports/renpho-v1.js';
import {
  packRenphoEvent,
  stagedAnnotations,
  validateStagedText,
} from './imports/staging.js';
import { normalizeObservation } from '../analytics/measurements.js';
import { importSelections } from '../analytics/import-selection.js';

const hash = (bytes: string | Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
const batchSchema = z.object({
  id: z.uuid(),
  source_id: z.uuid(),
  payload_hash: z.string(),
  expires_at: z.string(),
  preview_data_revision: z.number(),
  staging_payload_id: z.uuid().nullable(),
  status: z.enum(['previewed', 'committed', 'expired', 'discarded', 'failed']),
  result: ImportResultSchema.nullable(),
  observation_count: z.number(),
  new_count: z.number(),
  duplicate_count: z.number(),
  conflict_count: z.number(),
  contract_version: z.literal(2),
  adapter_version: z.string(),
  registry_version: z.string(),
  source_rows: z.number(),
  event_count: z.number(),
  enriched_count: z.number(),
});
type Batch = z.infer<typeof batchSchema>;

export function importFailure(message: string): never {
  const failures: Record<string, [number, string, string]> = {
    data_not_found: [
      404,
      'not_found',
      'The owned source or import was not found.',
    ],
    import_changed: [
      409,
      'import_changed',
      'The preview expired, changed or no longer matches your data. Create a fresh preview.',
    ],
    review_required: [
      409,
      'review_required',
      'Review and acknowledge the exclusions and unsupported columns before confirming.',
    ],
    invalid_import: [
      400,
      'invalid_input',
      'The import is invalid. Check its mapping, values and limits.',
    ],
    account_unavailable: [
      403,
      'account_unavailable',
      'This account is not available.',
    ],
  };
  const [status, code, text] = failures[message] ?? [
    503,
    'import_unavailable',
    'The import could not be verified or saved.',
  ];
  throw new HttpFailure(status, code, text);
}

export function decodeCsvRequest(request: PreviewCsvWire): Buffer {
  if (
    Buffer.byteLength(JSON.stringify({ ...request, csv_base64: '' })) >
    IMPORT_METADATA_LIMIT_BYTES
  )
    throw new HttpFailure(
      413,
      'request_too_large',
      'Import mapping metadata exceeds 64 KiB.',
    );
  const encoded = request.csv_base64;
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      encoded,
    )
  )
    throw new HttpFailure(
      400,
      'invalid_encoding',
      'Send canonical base64-encoded UTF-8 CSV bytes.',
    );
  const bytes = Buffer.from(encoded, 'base64');
  if (
    bytes.toString('base64') !== encoded ||
    bytes.length === 0 ||
    bytes.length > CSV_LIMIT_BYTES
  )
    throw new HttpFailure(
      413,
      'csv_too_large',
      'Choose a nonempty UTF-8 CSV of at most 1 MiB.',
    );
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new HttpFailure(
      400,
      'invalid_encoding',
      'The CSV is not valid UTF-8.',
    );
  }
  return bytes;
}

export function importRows(bundle: ImportBundle) {
  if (bundle.mapping.format === 'renpho')
    return bundle.events.flatMap((event, eventIndex) =>
      event.values.map(([metric, original, canonical]) => ({
        metric_key: metric,
        canonical_value: canonical,
        canonical_unit: metricRegistry[metric].canonicalUnit,
        original_value: original,
        original_unit: metricRegistry[metric].renphoUnit!,
        observed_at: event.instant,
        original_offset_minutes: event.offset,
        timezone: bundle.mapping.timezone,
        local_date: null,
        granularity: 'instant' as const,
        measurement_method: metricRegistry[metric].method,
        quality_flags: bundle.mapping.review_requested
          ? ['review_requested']
          : [],
        external_record_id: null,
        provenance: {
          schema_version: 2,
          adapter: bundle.adapter_version,
          row: event.row,
          column: metricRegistry[metric].renphoHeader!,
        },
        eventIndex,
      })),
    );
  return bundle.observations.map(
    ([
      metric,
      original,
      originalUnit,
      canonical,
      unit,
      instant,
      offset,
      zone,
      localDate,
      granularity,
      method,
      flags,
      external,
      row,
      column,
    ]) => ({
      metric_key: metric,
      canonical_value: canonical,
      canonical_unit: unit,
      original_value: original,
      original_unit: originalUnit,
      observed_at: instant,
      original_offset_minutes: offset,
      timezone: zone,
      local_date: localDate,
      granularity,
      measurement_method: method,
      quality_flags: flags,
      external_record_id: external,
      provenance: { schema_version: 2, adapter: 'csv', row, column },
      eventIndex: null,
    }),
  );
}

function checkedBundle(input: unknown): ImportBundle {
  const bundle = ImportBundleSchema.parse(input);
  bundle.events.forEach(validateStagedText);
  const rows = importRows(bundle);
  for (const row of rows) {
    const zone = `${row.original_offset_minutes < 0 ? '-' : '+'}${String(Math.floor(Math.abs(row.original_offset_minutes) / 60)).padStart(2, '0')}:${String(Math.abs(row.original_offset_minutes) % 60).padStart(2, '0')}`;
    const local =
      Temporal.Instant.from(row.observed_at)
        .toZonedDateTimeISO(zone)
        .toPlainDateTime()
        .toString() + zone;
    const normalized = normalizeObservation({
      metric: row.metric_key,
      value: row.original_value,
      unit: row.original_unit as Parameters<
        typeof normalizeObservation
      >[0]['unit'],
      observed_at: local,
      timezone: row.timezone,
      local_date: row.local_date,
      granularity: row.granularity,
      method: row.measurement_method,
      quality_flags: row.quality_flags,
    });
    if (
      Object.entries(normalized).some(
        ([key, value]) =>
          JSON.stringify(row[key as keyof typeof row]) !==
          JSON.stringify(value),
      )
    )
      throw new Error('Invalid normalized staging.');
  }
  if (rows.length !== bundle.inspection.classifications.length)
    throw new Error('Invalid classification count.');
  return bundle;
}

async function findBatch(context: AuthContext, id: string): Promise<Batch> {
  const result = await context.db
    .from('import_batches')
    .select('*')
    .eq('user_id', context.userId)
    .eq('id', id)
    .maybeSingle();
  if (result.error) importFailure(result.error.message);
  if (!result.data || result.data.contract_version !== 2)
    importFailure('data_not_found');
  return batchSchema.parse(result.data);
}
async function readStaging(context: AuthContext, batch: Batch) {
  if (
    batch.status !== 'previewed' ||
    Date.parse(batch.expires_at) <= Date.now() ||
    !batch.staging_payload_id
  )
    importFailure('import_changed');
  const payload = await readPayload(
    context,
    batch.staging_payload_id,
    'import_staging',
  );
  if (payload.state !== 'available') importFailure('import_changed');
  try {
    if (hash(payload.bytes) !== batch.payload_hash)
      importFailure('import_changed');
    const bundle = ImportBundleSchema.parse(
      JSON.parse(payload.bytes.toString('utf8')),
    );
    bundle.events.forEach(validateStagedText);
    return { bundle, bytes: payload.bytes };
  } catch {
    payload.bytes.fill(0);
    importFailure('import_changed');
  }
}
async function loadBundle(
  context: AuthContext,
  batch: Batch,
): Promise<ImportBundle> {
  const payload = await readStaging(context, batch);
  try {
    return payload.bundle;
  } finally {
    payload.bytes.fill(0);
  }
}
function previewResult(batch: Batch, bundle: ImportBundle) {
  const rows = importRows(bundle),
    classes = bundle.inspection.classifications;
  const counts = {
    observations: classes.length,
    new: 0,
    duplicate: 0,
    conflict: 0,
    invalid: bundle.issues.length,
    profileExcluded: bundle.profile_excluded,
    sourceExcluded: bundle.source_excluded,
    blank: bundle.unavailable_cells,
  };
  for (const label of classes) counts[label === 'enrichment' ? 'new' : label]++;
  let annotationAdditions = 0,
    annotationConflicts = 0;
  for (const annotations of bundle.inspection.annotation_classes)
    for (const label of Object.values(annotations)) {
      if (label === 'new') annotationAdditions++;
      if (label === 'conflict') annotationConflicts++;
    }
  const eventGroups = new Map<string, 'new' | 'existing' | 'conflict'>();
  bundle.events.forEach((event, i) =>
    eventGroups.set(
      event.instant,
      bundle.inspection.time_conflicts[i]
        ? 'conflict'
        : bundle.inspection.event_ids[i]
          ? 'existing'
          : 'new',
    ),
  );
  const eventKinds = [...eventGroups.values()];
  const instants = rows
    .map((row) => row.observed_at)
    .sort((a, b) => Temporal.Instant.compare(a, b));
  const historical = batch.status === 'committed';
  return ImportPreviewV2Schema.parse({
    schema_version: 2,
    adapter_version: bundle.adapter_version,
    registry_version: bundle.registry_version,
    batch_id: batch.id,
    source_id: batch.source_id,
    payload_hash: batch.payload_hash,
    expires_at: batch.expires_at,
    dataRevision: batch.preview_data_revision,
    counts: historical
      ? {
          ...counts,
          observations: batch.observation_count,
          new: batch.new_count,
          duplicate: batch.duplicate_count,
          conflict: batch.conflict_count,
        }
      : counts,
    ignored_columns: bundle.unknown_columns,
    errors: bundle.issues.slice(0, 50),
    errors_omitted: Math.max(0, bundle.issues.length - 50),
    preview: rows.slice(0, 20).map((row, i) => ({
      row: row.provenance.row,
      metric: row.metric_key,
      value: row.canonical_value,
      unit: row.canonical_unit,
      observed_at: row.observed_at,
      classification: classes[i] === 'enrichment' ? 'new' : classes[i],
    })),
    historical_result: batch.result,
    selections: importSelections(rows, classes, bundle.mapping.timezone),
    review: bundle.review,
    ready_to_commit:
      batch.status === 'previewed' &&
      (bundle.issues.length === 0 || bundle.review.exclude_invalid) &&
      (counts.conflict + annotationConflicts === 0 ||
        bundle.review.exclude_conflicts) &&
      (bundle.populated_unknown_columns.length === 0 ||
        bundle.review.acknowledge_unknown),
    source_rows: bundle.source_rows,
    events: {
      total: eventKinds.length,
      new: eventKinds.filter((x) => x === 'new').length,
      existing: eventKinds.filter((x) => x === 'existing').length,
      conflict: eventKinds.filter((x) => x === 'conflict').length,
    },
    enrichment_count: classes.filter((x) => x === 'enrichment').length,
    annotation_additions: annotationAdditions,
    annotation_conflicts: annotationConflicts,
    unavailable_cells: bundle.unavailable_cells,
    empty_events: bundle.empty_events,
    absent_columns: bundle.absent_columns,
    populated_unknown_columns: bundle.populated_unknown_columns,
    observed_from: instants[0] ?? null,
    observed_to: instants.at(-1) ?? null,
  });
}

function bundleBytes(bundle: ImportBundle) {
  const bytes = Buffer.from(JSON.stringify(bundle));
  if (bytes.length > MAX_PAYLOAD_BYTES)
    throw new HttpFailure(
      413,
      'staging_too_large',
      'Normalized import staging exceeds the supported 4 MiB envelope. Nothing was committed.',
    );
  return bytes;
}
export async function previewCsv(
  context: AuthContext,
  request: PreviewCsvWire,
) {
  const bytes = decodeCsvRequest(request);
  let parsed: Pick<
    ImportBundle,
    | 'events'
    | 'observations'
    | 'issues'
    | 'unknown_columns'
    | 'populated_unknown_columns'
    | 'absent_columns'
    | 'source_rows'
    | 'unavailable_cells'
    | 'empty_events'
    | 'profile_excluded'
    | 'source_excluded'
  >;
  try {
    if (request.mapping.format === 'renpho') {
      const renpho = parseRenphoV1(
        bytes,
        request.mapping.timezone,
        request.mapping.review_requested,
      );
      parsed = {
        ...renpho,
        events: renpho.events.map(packRenphoEvent),
        observations: [],
        profile_excluded: 0,
        source_excluded: 0,
      };
    } else {
      const generic = parseCsv(
        new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
          bytes,
        ),
        request.mapping,
      );
      parsed = {
        events: [],
        observations: generic.observations.map(
          (row) =>
            [
              row.metric_key,
              row.original_value,
              row.original_unit,
              row.canonical_value,
              row.canonical_unit,
              row.observed_at,
              row.original_offset_minutes,
              row.timezone,
              row.local_date,
              row.granularity,
              row.measurement_method,
              row.quality_flags,
              row.external_record_id,
              row.provenance.row,
              row.provenance.column,
            ] satisfies GenericObservationTuple,
        ),
        issues: generic.all_errors,
        unknown_columns: generic.ignored_columns,
        populated_unknown_columns: generic.populated_unknown_columns,
        absent_columns: [],
        source_rows: generic.source_rows,
        unavailable_cells: generic.counts.blank,
        empty_events: 0,
        profile_excluded: generic.counts.profileExcluded,
        source_excluded: generic.counts.sourceExcluded,
      };
    }
  } catch (error) {
    throw new HttpFailure(
      400,
      'invalid_csv',
      error instanceof Error ? error.message : 'Check the CSV mapping.',
    );
  }
  const bundle: ImportBundle = {
    schema_version: 2,
    adapter_version:
      request.mapping.format === 'renpho' ? RENPHO_ADAPTER_VERSION : 'csv-v2',
    registry_version: METRIC_REGISTRY_VERSION,
    client_request_id: request.client_request_id.toLowerCase(),
    source: request.source,
    mapping: request.mapping,
    file_hash: hash(bytes),
    mapping_hash: hash(JSON.stringify(request.mapping)),
    data_revision: 0,
    events: parsed.events,
    observations: parsed.observations,
    issues: parsed.issues,
    unknown_columns: parsed.unknown_columns,
    populated_unknown_columns: parsed.populated_unknown_columns,
    absent_columns: parsed.absent_columns,
    source_rows: parsed.source_rows,
    unavailable_cells: parsed.unavailable_cells,
    empty_events: parsed.empty_events,
    profile_excluded: parsed.profile_excluded,
    source_excluded: parsed.source_excluded,
    review: { ...initialImportReview },
    inspection: {
      revision: 0,
      classifications: [],
      event_ids: [],
      time_conflicts: [],
      annotation_classes: [],
    },
  };
  bytes.fill(0);
  bundleBytes(bundle);
  const inspected = await context.db.rpc('inspect_import_v2', {
    p_source: bundle.source,
    p_bundle: bundle,
  });
  if (inspected.error) importFailure(inspected.error.message);
  bundle.inspection = InspectionSchema.parse(inspected.data);
  bundle.data_revision = bundle.inspection.revision;
  const staging = bundleBytes(bundle);
  const payload = await writePayload(context, 'import_staging', staging);
  try {
    const saved = await context.db.rpc('register_import_v2', {
      p_payload_id: payload.id,
      p_bytes: staging.toString('utf8'),
    });
    if (saved.error) importFailure(saved.error.message);
    const batch = batchSchema.parse(saved.data);
    if (batch.status !== 'previewed' && batch.status !== 'committed')
      importFailure('import_changed');
    const reviewed =
      batch.status === 'previewed' && batch.staging_payload_id !== payload.id
        ? await loadBundle(context, batch)
        : bundle;
    return previewResult(batch, reviewed);
  } catch (error) {
    await discardImportPayload(context, payload.id);
    throw error;
  } finally {
    staging.fill(0);
  }
}

export async function reviewImport(
  context: AuthContext,
  request: z.infer<typeof ReviewImportSchema>,
) {
  const batch = await findBatch(context, request.batch_id),
    bundle = await loadBundle(context, batch);
  bundle.review = request.review;
  const bytes = bundleBytes(bundle),
    payload = await writePayload(
      context,
      'import_staging',
      bytes,
      batch.expires_at,
    );
  try {
    const saved = await context.db.rpc('review_import_v2', {
      p_batch_id: batch.id,
      p_expected_hash: request.payload_hash,
      p_payload_id: payload.id,
      p_bytes: bytes.toString('utf8'),
    });
    if (saved.error) importFailure(saved.error.message);
    return previewResult(batchSchema.parse(saved.data), bundle);
  } catch (error) {
    await discardImportPayload(context, payload.id);
    throw error;
  } finally {
    bytes.fill(0);
  }
}
export async function commitImport(
  context: AuthContext,
  request: ImportCommitRequest,
) {
  const batch = await findBatch(context, request.batch_id);
  let bytes = '';
  if (batch.status !== 'committed') {
    try {
      const payload = await readStaging(context, batch);
      try {
        checkedBundle(payload.bundle);
        bytes = payload.bytes.toString('utf8');
      } finally {
        payload.bytes.fill(0);
      }
    } catch (error) {
      if ((await findBatch(context, batch.id)).status !== 'committed')
        throw error;
    }
  }
  const saved = await context.db.rpc('commit_import_v2', {
    p_request: request,
    p_bytes: bytes,
  });
  if (saved.error) importFailure(saved.error.message);
  return ImportResultSchema.parse(saved.data);
}
export async function discardImport(context: AuthContext, id: string) {
  const saved = await context.db.rpc('discard_import_v2', { p_batch_id: id });
  if (saved.error) importFailure(saved.error.message);
  return saved.data;
}
export async function readImport(
  context: AuthContext,
  query: z.infer<typeof ImportReadSchema>,
) {
  if (query.view === 'import_status') {
    const found = await context.db.rpc('read_import_status_v2', {
      ...(query.batch_id
        ? { p_batch_id: query.batch_id }
        : { p_request_id: query.client_request_id! }),
    });
    if (found.error) importFailure(found.error.message);
    const batch = batchSchema.parse(found.data);
    const status =
      batch.status === 'previewed' && Date.parse(batch.expires_at) <= Date.now()
        ? 'expired'
        : batch.status;
    return {
      batch_id: batch.id,
      status,
      result: batch.result,
      preview:
        status === 'previewed'
          ? previewResult(batch, await loadBundle(context, batch))
          : null,
    };
  }
  const batch = await findBatch(context, query.batch_id);
  if (batch.payload_hash !== query.payload_hash)
    importFailure('import_changed');
  const bundle = await loadBundle(context, batch),
    rows = importRows(bundle);
  const items: Array<Record<string, unknown>> = [
    ...bundle.issues.map((issue) => ({ kind: 'issue', ...issue })),
  ];
  bundle.events.forEach((event, i) => {
    for (const [field, text] of Object.entries(stagedAnnotations(event)))
      items.push({
        kind: 'annotation',
        row: event.row,
        column: field,
        value: text,
        classification: bundle.inspection.annotation_classes[i]?.[field],
      });
  });
  rows.forEach((row, i) =>
    items.push({
      kind: 'observation',
      row: row.provenance.row,
      column: row.provenance.column,
      metric: row.metric_key,
      original_value: row.original_value,
      original_unit: row.original_unit,
      value: row.canonical_value,
      unit: row.canonical_unit,
      observed_at: row.observed_at,
      classification: bundle.inspection.classifications[i],
    }),
  );
  return {
    batch_id: batch.id,
    payload_hash: batch.payload_hash,
    dataRevision: batch.preview_data_revision,
    items: items.slice(query.offset, query.offset + query.limit),
    next_offset:
      query.offset + query.limit < items.length
        ? query.offset + query.limit
        : null,
    total: items.length,
  };
}

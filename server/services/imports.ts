import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Temporal } from '@js-temporal/polyfill';
import { ObservationInputSchema } from '../../shared/data.js';
import {
  ImportPreviewSchema,
  ImportResultSchema,
  type PreviewCsv,
} from '../../shared/imports.js';
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
import { normalizeObservation } from '../analytics/measurements.js';
import { importSelections } from '../analytics/import-selection.js';

const hash = (bytes: string | Buffer) =>
  createHash('sha256').update(bytes).digest('hex');
const classificationsSchema = z
  .array(z.enum(['new', 'duplicate', 'conflict']))
  .max(5000);
const batchSchema = z.object({
  id: z.string().uuid(),
  source_id: z.string().uuid(),
  payload_hash: z.string(),
  expires_at: z.string(),
  preview_data_revision: z.number(),
  staging_payload_id: z.string().nullable(),
  status: z.enum(['previewed', 'committed', 'expired', 'failed']),
  result: ImportResultSchema.nullable(),
  observation_count: z.number(),
  new_count: z.number(),
  duplicate_count: z.number(),
  conflict_count: z.number(),
});
function failure(message: string): never {
  if (message === 'data_not_found')
    throw new HttpFailure(
      404,
      'not_found',
      'The source or import preview was not found.',
    );
  if (message === 'import_changed')
    throw new HttpFailure(
      409,
      'import_changed',
      'The preview expired, changed or no longer matches your data. Create a fresh preview.',
    );
  if (message === 'invalid_import')
    throw new HttpFailure(
      400,
      'invalid_input',
      'The import is invalid. Check its mapping and limits.',
    );
  throw new HttpFailure(
    503,
    'import_unavailable',
    'The import could not be verified or saved.',
  );
}
export async function previewCsv(context: AuthContext, request: PreviewCsv) {
  let parsed: ReturnType<typeof parseCsv>;
  try {
    parsed = parseCsv(request.csv, request.mapping);
  } catch (error) {
    throw new HttpFailure(
      400,
      'invalid_csv',
      error instanceof Error ? error.message : 'Check the CSV mapping.',
    );
  }
  if (Buffer.byteLength(JSON.stringify(parsed)) > MAX_PAYLOAD_BYTES)
    throw new HttpFailure(
      413,
      'staging_too_large',
      'Normalized staging exceeds 4 MiB. Split the file; nothing was staged.',
    );
  const fileHash = hash(request.csv),
    mappingHash = hash(JSON.stringify(request.mapping));
  const inspected = await context.db.rpc('inspect_import_v1', {
    p_source: request.source,
    p_rows: parsed.observations,
  });
  if (inspected.error) failure(inspected.error.message);
  const inspection = z
    .object({ revision: z.number(), classifications: classificationsSchema })
    .parse(inspected.data);
  const counts = { ...parsed.counts };
  for (const label of inspection.classifications) counts[label]++;
  let bundle = {
    schema_version: 1,
    client_request_id: request.client_request_id.toLowerCase(),
    source: request.source,
    mapping: request.mapping,
    file_hash: fileHash,
    mapping_hash: mappingHash,
    data_revision: inspection.revision,
    ...parsed,
    counts,
    classifications: inspection.classifications,
  };
  let batch: z.infer<typeof batchSchema>;
  {
    const bytes = Buffer.from(JSON.stringify(bundle));
    if (bytes.length > MAX_PAYLOAD_BYTES)
      throw new HttpFailure(
        413,
        'staging_too_large',
        'Normalized staging exceeds 4 MiB. Split the file; nothing was staged.',
      );
    const payload = await writePayload(context, 'import_staging', bytes);
    try {
      const saved = await context.db.rpc('register_import_v1', {
        p_payload_id: payload.id,
        p_bytes: bytes.toString('utf8'),
      });
      if (saved.error) failure(saved.error.message);
      batch = batchSchema.parse(saved.data);
      if (
        batch.staging_payload_id !== payload.id &&
        batch.status === 'previewed'
      ) {
        const original = await readPayload(
          context,
          batch.staging_payload_id!,
          'import_staging',
        );
        if (original.state !== 'available') failure('import_changed');
        // Only authenticated, server-written staging is accepted here.
        bundle = JSON.parse(original.bytes.toString('utf8')) as typeof bundle;
      }
    } catch (error) {
      await discardImportPayload(context, payload.id);
      throw error;
    }
  }
  if (
    batch.status === 'expired' ||
    batch.status === 'failed' ||
    (batch.status === 'previewed' && Date.parse(batch.expires_at) <= Date.now())
  )
    failure('import_changed');
  return ImportPreviewSchema.parse({
    batch_id: batch.id,
    source_id: batch.source_id,
    payload_hash: batch.payload_hash,
    expires_at: batch.expires_at,
    dataRevision: batch.preview_data_revision,
    counts:
      batch.status === 'committed'
        ? {
            ...counts,
            observations: batch.observation_count,
            new: batch.new_count,
            duplicate: batch.duplicate_count,
            conflict: batch.conflict_count,
          }
        : bundle.counts,
    ignored_columns: bundle.ignored_columns,
    errors: bundle.errors,
    errors_omitted: bundle.errors_omitted,
    preview: bundle.observations.slice(0, 20).map((r, index) => ({
      row: r.provenance.row,
      metric: r.metric_key,
      value: r.canonical_value,
      unit: r.canonical_unit,
      observed_at: r.observed_at,
      classification: bundle.classifications[index],
    })),
    historical_result: batch.result,
    selections: importSelections(
      bundle.observations,
      bundle.classifications,
      bundle.mapping.timezone,
    ),
  });
}
export async function commitImport(
  context: AuthContext,
  request: ImportCommitRequest,
) {
  const found = await context.db
    .from('import_batches')
    .select('*')
    .eq('user_id', context.userId)
    .eq('id', request.batch_id)
    .maybeSingle();
  if (found.error) failure(found.error.message);
  if (!found.data) failure('data_not_found');
  const batch = batchSchema.parse(found.data);
  let bytes = '';
  if (batch.status !== 'committed') {
    if (batch.status !== 'previewed') failure('import_changed');
    if (
      Date.parse(batch.expires_at) <= Date.now() ||
      !batch.staging_payload_id
    ) {
      const closed = await context.db.rpc('discard_import_v1', {
        p_batch_id: batch.id,
      });
      if (closed.error) failure(closed.error.message);
      failure('import_changed');
    }
    const payload = await readPayload(
      context,
      batch.staging_payload_id,
      'import_staging',
    );
    if (payload.state !== 'available') {
      const concurrent = await context.db
        .from('import_batches')
        .select('status')
        .eq('user_id', context.userId)
        .eq('id', batch.id)
        .maybeSingle();
      if (concurrent.data?.status === 'committed') {
        const saved = await context.db.rpc('commit_import_v1', {
          p_request: request,
          p_bytes: '',
        });
        if (saved.error) failure(saved.error.message);
        return ImportResultSchema.parse(saved.data);
      }
      failure('import_changed');
    }
    if (hash(payload.bytes) !== batch.payload_hash) failure('import_changed');
    // Validate normalized staging again with the same normalizer before commit.
    try {
      const bundle = z
        .object({
          schema_version: z.literal(1),
          observations: z
            .array(
              z.looseObject({
                metric_key: z.string(),
                canonical_value: z.string(),
                original_value: z.string(),
                original_unit: z.string(),
                observed_at: z.string(),
                original_offset_minutes: z.number().int().min(-840).max(840),
                timezone: z.string(),
                local_date: z.string().nullable(),
                granularity: z.string(),
                measurement_method: z.string(),
                quality_flags: z.array(z.string()),
                external_record_id: z.string().min(1).max(500).nullable(),
                provenance: z.object({ adapter: z.literal('csv') }),
              }),
            )
            .max(5000),
          classifications: classificationsSchema,
        })
        .parse(JSON.parse(payload.bytes.toString('utf8')));
      for (const r of bundle.observations) {
        const offset = r.original_offset_minutes;
        const zone = `${offset < 0 ? '-' : '+'}${String(Math.floor(Math.abs(offset) / 60)).padStart(2, '0')}:${String(Math.abs(offset) % 60).padStart(2, '0')}`;
        const observed =
          Temporal.Instant.from(r.observed_at)
            .toZonedDateTimeISO(zone)
            .toPlainDateTime()
            .toString() + zone;
        const normalized = normalizeObservation(
          ObservationInputSchema.parse({
            metric: r.metric_key,
            value: r.original_value,
            unit: r.original_unit,
            observed_at: observed,
            timezone: r.timezone,
            local_date: r.local_date,
            granularity: r.granularity,
            method: r.measurement_method,
            quality_flags: r.quality_flags,
          }),
        );
        if (
          Object.entries(normalized).some(
            ([key, value]) => JSON.stringify(r[key]) !== JSON.stringify(value),
          )
        )
          throw new Error();
      }
    } catch {
      failure('import_changed');
    }
    bytes = payload.bytes.toString('utf8');
  }
  const saved = await context.db.rpc('commit_import_v1', {
    p_request: request,
    p_bytes: bytes,
  });
  if (saved.error) {
    if (saved.error.message === 'import_changed') {
      const closed = await context.db.rpc('discard_import_v1', {
        p_batch_id: batch.id,
      });
      if (closed.error) failure(closed.error.message);
    }
    failure(saved.error.message);
  }
  return ImportResultSchema.parse(saved.data);
}

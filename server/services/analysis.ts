import { z } from 'zod';
import {
  AnalysisBatchSchema,
  ANALYSIS_OBSERVATION_BUDGET,
  AnalysisReadRequestSchema,
  EventAnalysisResultSchema,
  InventoryItemSchema,
  InventoryQuerySchema,
  MetricInventorySchema,
  type AnalysisOperation,
} from '../../shared/analysis.js';
import { API_JSON_LIMIT_BYTES } from '../../shared/api.js';
import {
  MetricKeySchema,
  CanonicalUnitSchema,
  MeasurementMethodSchema,
  GranularitySchema,
} from '../../shared/domain.js';
import { EventDetailSchema, EventSchema } from '../../shared/events.js';
import {
  CountSchema,
  ISOInstantSchema,
  UUIDSchema,
} from '../../shared/primitives.js';
import {
  METRIC_REGISTRY_VERSION,
  metricRegistry,
  registryMetricKeys,
} from '../../shared/metrics.js';
import type { AuthContext } from '../auth/session.js';
import {
  analysisBase,
  calculateAnalysis,
  operationWindows,
} from '../analytics/analysis.js';
import {
  measurementDTO,
  type StoredObservation,
} from '../analytics/measurements.js';
import { HttpFailure } from '../http/failure.js';

const rawObservation = z.object({
  id: UUIDSchema,
  source_id: UUIDSchema,
  metric_key: MetricKeySchema,
  canonical_value: z.string(),
  canonical_unit: CanonicalUnitSchema,
  original_value: z.string(),
  original_unit: z.string(),
  observed_at: ISOInstantSchema,
  original_offset_minutes: z.number().nullable(),
  timezone: z.string().nullable(),
  local_date: z.string().nullable(),
  granularity: GranularitySchema,
  measurement_method: MeasurementMethodSchema,
  quality_flags: z.array(z.string()),
  external_record_id: z.string().nullable(),
  version: CountSchema,
  event_id: UUIDSchema.nullable().optional(),
});
function failure(message: string): never {
  if (message === 'analysis_limit')
    throw new HttpFailure(
      422,
      message,
      'This analysis exceeds 25,000 observations. Narrow the dates or metric selection; no partial statistic was returned.',
    );
  if (message === 'data_not_found')
    throw new HttpFailure(
      404,
      'not_found',
      'The owned source or endpoint was not found.',
    );
  if (message === 'data_conflict')
    throw new HttpFailure(
      409,
      'data_changed',
      'Your data changed. Refresh this selection.',
    );
  if (message === 'invalid_analysis')
    throw new HttpFailure(
      400,
      'invalid_input',
      'Choose a supported bounded analysis.',
    );
  if (message === 'account_unavailable')
    throw new HttpFailure(403, message, 'This account is not available.');
  throw new HttpFailure(
    503,
    'data_unavailable',
    'Your analysis could not be verified.',
  );
}
function readQuery(operation: AnalysisOperation) {
  const windows = operationWindows(operation);
  if (
    'series' in operation &&
    operation.operation !== 'latest_per_metric' &&
    !metricRegistry[operation.series.metric].analyticsOperand
  )
    throw new HttpFailure(
      400,
      'unresolved_semantics',
      metricRegistry[operation.series.metric].limitation,
    );
  return {
    mode:
      operation.operation === 'latest_event'
        ? 'event'
        : operation.operation === 'latest_per_metric'
          ? 'latest'
          : operation.operation === 'endpoint_difference'
            ? 'endpoints'
            : 'rows',
    source_id:
      operation.operation === 'latest_event'
        ? operation.source_id
        : operation.series.source_id,
    ...('series' in operation
      ? {
          metric: operation.series.metric,
          method: operation.series.method,
          granularity: operation.series.granularity,
        }
      : {}),
    timezone: operation.timezone,
    windows: [windows.effective?.window, windows.previous?.window].filter(
      (item) => item !== undefined,
    ),
    ...(operation.operation === 'endpoint_difference'
      ? { ids: operation.endpointIds }
      : {}),
  };
}
export async function readAnalysis(
  context: AuthContext,
  input: z.input<typeof AnalysisReadRequestSchema>,
  evaluatedAt = new Date().toISOString(),
) {
  const request = AnalysisReadRequestSchema.parse(input);
  const operations =
    request.action === 'analyze' ? request.operations : [request.operation];
  let queries;
  try {
    queries = operations.map(readQuery);
  } catch (error) {
    if (error instanceof HttpFailure) throw error;
    throw new HttpFailure(
      400,
      'invalid_interval',
      'Select 1–366 complete local calendar days with explicit timezone boundaries.',
    );
  }
  const snapshot = await context.db.rpc('read_analysis_v1', {
    p_queries: queries,
  });
  if (snapshot.error) failure(snapshot.error.message);
  const raw = z
    .strictObject({
      revision: CountSchema,
      lastSuccessfulImportAt: ISOInstantSchema.nullable(),
      snapshots: z
        .array(
          z.strictObject({
            rows: z.array(rawObservation).max(25000),
            events: z
              .array(
                z.strictObject({
                  id: UUIDSchema,
                  observed_at: ISOInstantSchema,
                }),
              )
              .max(2),
            event: z
              .object({
                event: EventSchema,
                observations: z.array(rawObservation.passthrough()).max(24),
                dataRevision: CountSchema,
              })
              .nullable(),
          }),
        )
        .max(24),
    })
    .parse(snapshot.data);
  if (raw.snapshots.length !== operations.length) failure('invalid_response');
  if (
    raw.snapshots.reduce(
      (total, item) =>
        total + item.rows.length + (item.event?.observations.length ?? 0),
      0,
    ) > ANALYSIS_OBSERVATION_BUDGET
  )
    failure('analysis_limit');
  if (
    request.action === 'resolve_analysis' &&
    request.dataRevision !== raw.revision
  )
    throw new HttpFailure(
      410,
      'result_unavailable',
      'The original data revision is unavailable. Request current data separately.',
    );
  const results = operations.map((operation, index) => {
    const data = raw.snapshots[index]!;
    if (operation.operation !== 'latest_event')
      return calculateAnalysis(
        context.userId,
        operation,
        data.rows as StoredObservation[],
        raw.revision,
        evaluatedAt,
        raw.lastSuccessfulImportAt,
      );
    const detail = data.event
      ? EventDetailSchema.parse({
          ...data.event,
          observations: (data.event.observations as StoredObservation[]).map(
            measurementDTO,
          ),
          provenance: Object.fromEntries(
            data.event.observations.map((row) => [
              row.id,
              row.provenance ?? {},
            ]),
          ),
        })
      : null;
    if (detail && detail.dataRevision !== raw.revision)
      failure('data_conflict');
    return EventAnalysisResultSchema.parse({
      ...analysisBase(
        context.userId,
        operation,
        raw.revision,
        evaluatedAt,
        raw.lastSuccessfulImportAt,
      ),
      kind: 'event_analysis',
      operation: 'latest_event',
      sourceId: operation.source_id,
      requestedWindow: operation.window ?? null,
      status: detail
        ? 'available'
        : data.events.length
          ? 'ambiguous'
          : 'insufficient_data',
      event: detail,
      candidates: detail
        ? [detail.event.id]
        : data.events.map((item) => item.id),
    });
  });
  if (
    request.action === 'resolve_analysis' &&
    results[0]!.id !== request.expectedResultId
  )
    throw new HttpFailure(
      410,
      'result_unavailable',
      'This result does not match the original selection or method. Request current data separately.',
    );
  const end = await context.db
    .from('profiles')
    .select('data_revision')
    .eq('user_id', context.userId)
    .eq('account_state', 'active')
    .maybeSingle();
  if (end.error) failure(end.error.message);
  if (!end.data || end.data.data_revision !== raw.revision)
    failure('data_conflict');
  const result = AnalysisBatchSchema.parse({
    schemaVersion: 1,
    dataRevision: raw.revision,
    results,
  });
  if (Buffer.byteLength(JSON.stringify(result)) > API_JSON_LIMIT_BYTES)
    failure('analysis_limit');
  return result;
}

const InventoryCursorSchema = z.strictObject({
  owner: UUIDSchema,
  revision: CountSchema,
  after: InventoryItemSchema.pick({
    metric: true,
    source_id: true,
    method: true,
    granularity: true,
  }),
});
export async function readMetricInventory(
  context: AuthContext,
  input: z.input<typeof InventoryQuerySchema> = { view: 'inventory' },
) {
  const query = InventoryQuerySchema.parse(input);
  let cursor: z.infer<typeof InventoryCursorSchema> | undefined;
  if (query.cursor) {
    try {
      cursor = InventoryCursorSchema.parse(
        JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')),
      );
      if (
        cursor.owner !== context.userId ||
        (query.data_revision !== undefined &&
          query.data_revision !== cursor.revision)
      )
        throw new Error();
    } catch {
      throw new HttpFailure(
        400,
        'invalid_cursor',
        'Refresh the owned inventory to restart pagination.',
      );
    }
  }
  const revision = cursor?.revision ?? query.data_revision;
  const result = await context.db.rpc('read_metric_inventory_v2', {
    p_limit: query.page_size,
    ...(cursor ? { p_after: cursor.after } : {}),
    ...(revision === undefined ? {} : { p_revision: revision }),
  });
  if (result.error) failure(result.error.message);
  const page = z
    .strictObject({
      dataRevision: CountSchema,
      items: z.array(InventoryItemSchema).max(201),
    })
    .parse(result.data);
  const items = page.items.slice(0, query.page_size);
  const last = items.at(-1);
  return MetricInventorySchema.parse({
    ...page,
    items,
    nextCursor:
      page.items.length > query.page_size && last
        ? Buffer.from(
            JSON.stringify({
              owner: context.userId,
              revision: page.dataRevision,
              after: {
                metric: last.metric,
                source_id: last.source_id,
                method: last.method,
                granularity: last.granularity,
              },
            }),
          ).toString('base64url')
        : null,
    registryVersion: METRIC_REGISTRY_VERSION,
    registry: registryMetricKeys.map((metric) => ({
      metric,
      label: metricRegistry[metric].label,
      unit: metricRegistry[metric].canonicalUnit,
      analyticsEligible: metricRegistry[metric].analyticsOperand,
      limitation: metricRegistry[metric].limitation,
    })),
    limits: { localDays: 366, observations: 25000, batch: 24, rawPage: 200 },
  });
}

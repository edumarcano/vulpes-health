import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LocalSupabase } from '../helpers/local-supabase.js';
import { localStatus } from '../../scripts/local-database.js';
import { localRouter } from '../../server/http/router.js';
import { successEnvelopeSchema } from '../../shared/api.js';
import { metricRegistry, registryMetricKeys } from '../../shared/metrics.js';
import {
  MutationResultSchema,
  type AddMeasurement,
} from '../../shared/data.js';
import {
  ImportPreviewV2Schema,
  ImportResultSchema,
} from '../../shared/imports.js';
import {
  AnalysisBatchSchema,
  MetricInventorySchema,
  type AnalysisOperation,
} from '../../shared/analysis.js';

const server = createServer(localRouter);
let db: LocalSupabase;
let owner: { id: string; token: string };
let foreign: { id: string; token: string };
let origin: string;
let source: string;
let firstId: string;
const month = { from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z' };
const previousMonth = {
  from: '2026-08-01T00:00:00Z',
  to: '2026-09-01T00:00:00Z',
};
function series() {
  return {
    metric: 'weight' as const,
    source_id: source,
    method: 'device_reported' as const,
    granularity: 'instant' as const,
  };
}
async function post(body: unknown, token = owner.token) {
  return fetch(origin + '/api/data', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Vulpes-Data-Contract': '2',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
}
async function analyze(operation: AnalysisOperation) {
  const response = await post({ action: 'analyze', operations: [operation] });
  const body: unknown = await response.json();
  expect({
    status: response.status,
    error: response.ok ? undefined : body,
  }).toEqual({ status: 200, error: undefined });
  return successEnvelopeSchema(AnalysisBatchSchema).parse(body).data
    .results[0]!;
}
async function add(value: string, observedAt: string) {
  const input: AddMeasurement = {
    action: 'add_measurement',
    client_request_id: randomUUID(),
    source: source
      ? { kind: 'existing', id: source }
      : {
          kind: 'new',
          label: 'Synthetic analysis scale',
          origin_app: null,
          device_label: null,
        },
    observation: {
      metric: 'weight',
      value,
      unit: 'kg',
      observed_at: observedAt,
      timezone: 'UTC',
      local_date: null,
      granularity: 'instant',
      method: 'device_reported',
      quality_flags: [],
    },
  };
  const response = await post(input);
  expect(response.status).toBe(200);
  const saved = successEnvelopeSchema(MutationResultSchema).parse(
    await response.json(),
  ).data;
  source = saved.sourceId;
  return saved.id;
}
beforeAll(async () => {
  const config = localStatus();
  vi.stubEnv('VITE_SUPABASE_URL', config.apiUrl);
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', config.anonKey);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', config.adminKey);
  vi.stubEnv('VULPES_TRACE_ENCRYPTION_KEY_ID', 'synthetic-analysis');
  vi.stubEnv(
    'VULPES_TRACE_ENCRYPTION_KEY_B64',
    randomBytes(32).toString('base64'),
  );
  vi.stubEnv('VULPES_LIVE_AI_ENABLED', 'false');
  db = new LocalSupabase();
  owner = await db.createUser();
  foreign = await db.createUser();
  for (const user of [owner, foreign])
    await db.admin('/rest/v1/profiles', 'POST', {
      user_id: user.id,
      display_name: 'Synthetic analysis',
    });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing local interface.');
  origin = `http://127.0.0.1:${address.port}`;
  await add('80', '2026-08-15T08:00:00Z');
  firstId = await add('70', '2026-09-01T08:00:00Z');
  await add('74', '2026-09-01T09:00:00Z');
  await add('78', '2026-09-01T10:00:00Z');
  await add('68', '2026-09-03T08:00:00Z');
  await add('74', '2026-09-10T08:00:00Z');
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    if (db) await db.cleanup();
  } finally {
    vi.unstubAllEnvs();
  }
});
describe('owned explicit analysis HTTP artifact', () => {
  it('uses independent daily medians and exact equal-day means rather than row weighting', async () => {
    const result = await analyze({
      operation: 'observed_day_mean',
      series: series(),
      timezone: 'UTC',
      window: month,
      includeSampleMean: true,
    });
    expect(result.kind).toBe('series_analysis');
    if (result.kind !== 'series_analysis') throw new Error('Expected series.');
    expect(result.current).toMatchObject({
      value: '72',
      sampleMean: '72.8',
      observedDays: 3,
      calendarDays: 30,
      observationCount: 5,
    });
    expect(result.points.filter((p) => p.value !== null)).toEqual([
      { localDate: '2026-09-01', value: '74' },
      { localDate: '2026-09-03', value: '68' },
      { localDate: '2026-09-10', value: '74' },
    ]);
    expect(result.points.filter((p) => p.value === null)).toHaveLength(27);
  });
  it('compares actual calendar months and withholds a sparse rolling scalar', async () => {
    const comparison = await analyze({
      operation: 'period_comparison',
      series: series(),
      timezone: 'UTC',
      window: month,
      comparisonWindow: previousMonth,
      comparisonMethod: 'observed_day_mean',
    });
    expect(comparison).toMatchObject({
      kind: 'series_analysis',
      current: { value: '72', calendarDays: 30 },
      previous: { value: '80', calendarDays: 31 },
      absoluteChange: '-8',
      relativeChangePercent: '-10',
    });
    const rolling = await analyze({
      operation: 'rolling_7d',
      series: series(),
      timezone: 'UTC',
      window: { from: '2026-09-04T00:00:00Z', to: '2026-09-11T00:00:00Z' },
    });
    expect(rolling).toMatchObject({
      current: {
        value: null,
        coverageStatus: 'insufficient_data',
        observedDays: 1,
        calendarDays: 7,
      },
      absoluteChange: null,
    });
  });
  it('discovers the complete registry and denies existing foreign sources', async () => {
    const response = await fetch(origin + '/api/data?view=inventory', {
      headers: { Authorization: `Bearer ${owner.token}` },
    });
    expect(response.status).toBe(200);
    const inventory = successEnvelopeSchema(MetricInventorySchema).parse(
      await response.json(),
    ).data;
    expect(inventory.registry).toHaveLength(29);
    expect(inventory.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source_id: source,
          metric: 'weight',
          observations: 6,
        }),
      ]),
    );
    const denied = await post(
      {
        action: 'analyze',
        operations: [
          { operation: 'latest_per_metric', series: series(), timezone: 'UTC' },
        ],
      },
      foreign.token,
    );
    expect(denied.status).toBe(404);
    const duplicate = await post({
      action: 'analyze',
      operations: [
        { operation: 'latest_per_metric', series: series(), timezone: 'UTC' },
        { operation: 'latest_per_metric', series: series(), timezone: 'UTC' },
      ],
    });
    expect(duplicate.status).toBe(400);
  });
  it('resolves only the same owned revision and never regenerates stale evidence', async () => {
    const operation: AnalysisOperation = {
      operation: 'observed_day_mean',
      series: series(),
      timezone: 'UTC',
      window: month,
      includeSampleMean: false,
    };
    const original = await analyze(operation),
      repeated = await analyze(operation);
    expect(repeated.id).toBe(original.id);
    const resolved = await post({
      action: 'resolve_analysis',
      operation,
      expectedResultId: original.id,
      dataRevision: original.dataRevision,
    });
    expect(resolved.status).toBe(200);
    const correction = await post({
      action: 'correct_measurement',
      client_request_id: randomUUID(),
      measurement_id: firstId,
      expected_version: 1,
      changes: {
        value: '71',
        unit: 'kg',
        observed_at: '2026-09-01T08:00:00Z',
        timezone: 'UTC',
        local_date: null,
      },
    });
    expect(correction.status).toBe(200);
    const stale = await post({
      action: 'resolve_analysis',
      operation,
      expectedResultId: original.id,
      dataRevision: original.dataRevision,
    });
    expect(stale.status).toBe(410);
    const current = await analyze(operation);
    expect(current.id).not.toBe(original.id);
    console.info(
      JSON.stringify({
        artifact: 'explicit_analysis_http',
        synthetic: true,
        monthMean: '72',
        sampleMean: '72.8',
        previousMonthMean: '80',
        absoluteChange: '-8',
        relativeChangePercent: '-10',
        staleResolutionStatus: stale.status,
        providerRequests: 0,
      }),
    );
  });
  it('keeps an incomplete latest weigh-in separate from older per-metric readings', async () => {
    async function importCsv(csv: Buffer | string, existing?: string) {
      const response = await post({
        action: 'preview_csv',
        schema_version: 2,
        client_request_id: randomUUID(),
        csv_base64: Buffer.from(csv).toString('base64'),
        source: existing
          ? { kind: 'existing', id: existing }
          : {
              kind: 'new',
              label: 'Synthetic event analysis',
              origin_app: null,
              device_label: null,
            },
        mapping: {
          schema_version: 1,
          format: 'renpho',
          timezone: 'UTC',
          profile: null,
          single_profile: true,
          timezone_confirmed: true,
          review_requested: false,
        },
      });
      expect(response.status).toBe(200);
      const preview = successEnvelopeSchema(ImportPreviewV2Schema).parse(
        await response.json(),
      ).data;
      const committed = await post({
        action: 'commit_import',
        schema_version: 2,
        batch_id: preview.batch_id,
        payload_hash: preview.payload_hash,
        client_request_id: randomUUID(),
      });
      expect(committed.status).toBe(200);
      successEnvelopeSchema(ImportResultSchema).parse(await committed.json());
      return preview.source_id;
    }
    const panelSource = await importCsv(
      readFileSync('docs/spec/v0.2.0/fixtures/renpho-v1/full-panel.csv'),
    );
    const complete = await analyze({
      operation: 'latest_event',
      source_id: panelSource,
      timezone: 'UTC',
    });
    expect(complete.kind).toBe('event_analysis');
    if (complete.kind !== 'event_analysis') throw new Error('Expected event.');
    expect(complete.event?.observations).toHaveLength(24);
    await importCsv(
      'Date,Time,Weight(lb)\n2026.09.02,08:00:00,149\n',
      panelSource,
    );
    const latest = await analyze({
      operation: 'latest_event',
      source_id: panelSource,
      timezone: 'UTC',
    });
    if (latest.kind !== 'event_analysis') throw new Error('Expected event.');
    expect(latest.event?.observations).toHaveLength(1);
    expect(latest.event?.observations[0]?.metric).toBe('weight');
    const fat = await analyze({
      operation: 'latest_per_metric',
      series: {
        metric: 'body_fat_percent',
        source_id: panelSource,
        method: 'device_estimate',
        granularity: 'instant',
      },
      timezone: 'UTC',
    });
    expect(fat).toMatchObject({
      kind: 'series_analysis',
      current: { value: '20' },
    });
    if (fat.kind !== 'series_analysis') throw new Error('Expected series.');
    expect(Date.parse(fat.current.lastMeasuredAt!)).toBe(
      Date.parse('2026-09-01T08:00:00Z'),
    );
    expect(fat.lastSuccessfulImportAt).not.toBeNull();
    const started = performance.now();
    const batchResponse = await post({
      action: 'analyze',
      operations: registryMetricKeys
        .filter(
          (metric) =>
            metricRegistry[metric].renphoHeader !== null &&
            metricRegistry[metric].analyticsOperand,
        )
        .map((metric) => ({
          operation: 'observed_day_mean',
          series: {
            metric,
            source_id: panelSource,
            method: metricRegistry[metric].method,
            granularity: 'instant',
          },
          timezone: 'UTC',
          window: { from: '2026-09-01T00:00:00Z', to: '2027-09-02T00:00:00Z' },
        })),
    });
    expect(batchResponse.status).toBe(200);
    const serialized = await batchResponse.text();
    const batch = successEnvelopeSchema(AnalysisBatchSchema).parse(
      JSON.parse(serialized),
    ).data;
    expect(batch.results).toHaveLength(20);
    expect(
      batch.results.every(
        (result) =>
          result.kind === 'series_analysis' && result.points.length === 366,
      ),
    ).toBe(true);
    expect(
      new Set(batch.results.map((result) => result.dataRevision)).size,
    ).toBe(1);
    console.info(
      JSON.stringify({
        artifact: 'full_panel_366_day_http',
        synthetic: true,
        series: 20,
        responseBytes: Buffer.byteLength(serialized),
        elapsedMs: Math.round(performance.now() - started),
        providerRequests: 0,
      }),
    );
    console.info(
      JSON.stringify({
        artifact: 'latest_event_http',
        synthetic: true,
        completeObservations: 24,
        latestObservations: 1,
        olderFatPercent: '20',
        providerRequests: 0,
      }),
    );
  });
});

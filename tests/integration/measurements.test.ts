import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LocalSupabase } from '../helpers/local-supabase.js';
import { localStatus } from '../../scripts/local-database.js';
import { localRouter } from '../../server/http/router.js';
import {
  DataSummarySchema,
  MeasurementsPageSchema,
  MutationResultSchema,
  SourcesPageSchema,
  type AddMeasurement,
} from '../../shared/data.js';
import { successEnvelopeSchema } from '../../shared/api.js';

let db: LocalSupabase;
let a: { id: string; token: string };
let b: { id: string; token: string };
let origin: string;
const server = createServer(localRouter);
const base: AddMeasurement = {
  action: 'add_measurement',
  client_request_id: randomUUID(),
  source: {
    kind: 'new',
    label: 'Synthetic Scale A',
    origin_app: null,
    device_label: 'Synthetic device',
  },
  observation: {
    metric: 'weight',
    value: '70',
    unit: 'kg',
    observed_at: '2026-09-01T08:00:00Z',
    timezone: 'UTC',
    local_date: null,
    granularity: 'instant',
    method: 'device_reported',
    quality_flags: [],
  },
};
async function request(
  token: string | null,
  method: string,
  path: string,
  body?: unknown,
) {
  return fetch(origin + path, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
async function add(body: AddMeasurement, token = a.token) {
  const response = await request(token, 'POST', '/api/data', body);
  expect(response.status).toBe(200);
  return successEnvelopeSchema(MutationResultSchema).parse(
    await response.json(),
  ).data;
}
const query = (
  source: string,
  view = 'summary',
  extra: Record<string, string> = {},
) =>
  '/api/data?' +
  new URLSearchParams({
    view,
    source_id: source,
    metric: 'weight',
    from: '2026-09-01T00:00:00Z',
    to: '2026-09-15T00:00:00Z',
    timezone: 'UTC',
    method: 'device_reported',
    granularity: 'instant',
    ...extra,
  });
beforeAll(async () => {
  const config = localStatus();
  vi.stubEnv('VITE_SUPABASE_URL', config.apiUrl);
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', config.anonKey);
  vi.stubEnv('VULPES_LIVE_AI_ENABLED', 'false');
  db = new LocalSupabase();
  a = await db.createUser();
  b = await db.createUser();
  for (const user of [a, b])
    await db.admin('/rest/v1/profiles', 'POST', {
      user_id: user.id,
      display_name: 'Synthetic data tester',
    });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing local interface');
  origin = `http://127.0.0.1:${address.port}`;
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
describe('real measurement HTTP/Auth/PostgREST workflow', () => {
  it('persists exact canonical fixture results through manual API with AI disabled', async () => {
    const lines = readFileSync(
      'docs/spec/v0.1.0/fixtures/measurements-synthetic.csv',
      'utf8',
    )
      .trim()
      .split(/\r?\n/)
      .slice(1);
    let source: string | undefined;
    for (const line of lines) {
      const [observed_at, metric, value, unit] = line.split(',');
      const result = await add({
        ...base,
        client_request_id: randomUUID(),
        source: source ? { kind: 'existing', id: source } : base.source,
        observation: {
          ...base.observation,
          observed_at: observed_at!,
          metric: metric as 'weight' | 'body_fat_percent',
          value: value!,
          unit: unit as 'kg' | '%',
          method: metric === 'weight' ? 'device_reported' : 'device_estimate',
        },
      });
      source = result.sourceId;
    }
    const response = await request(a.token, 'GET', query(source!));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const result = successEnvelopeSchema(DataSummarySchema).parse(
      await response.json(),
    ).data;
    expect(result.analysis).toMatchObject({
      value: 69,
      previousValue: 69.7,
      absoluteChange: -0.7,
      validDays: 7,
      dataRevision: 28,
    });
    const alternate = successEnvelopeSchema(DataSummarySchema).parse(
      await (
        await request(a.token, 'GET', query(source!.toUpperCase()))
      ).json(),
    ).data;
    expect(alternate.analysis.value).toBe(69);
    const fat = successEnvelopeSchema(DataSummarySchema).parse(
      await (
        await request(
          a.token,
          'GET',
          query(source!, 'summary', {
            metric: 'body_fat_percent',
            method: 'device_estimate',
          }),
        )
      ).json(),
    ).data;
    expect(fat.analysis.absoluteChange).toBe(-0.7);
    const privateRows = await db.request(
      `/rest/v1/measurements?source_id=eq.${source}&select=id`,
      a.token,
    );
    expect((await privateRows.json()) as unknown[]).toHaveLength(28);
    const sources = successEnvelopeSchema(SourcesPageSchema).parse(
      await (await request(a.token, 'GET', '/api/data?view=sources')).json(),
    ).data;
    expect(sources.items.some((item) => item.id === source)).toBe(true);
    const foreign = await request(b.token, 'GET', query(source!));
    expect(foreign.status).toBe(404);
    expect(
      await (
        await db.request(
          `/rest/v1/measurements?source_id=eq.${source}`,
          b.token,
        )
      ).json(),
    ).toEqual([]);
    const exact = await db.request('/rest/v1/rpc/read_data_v1', a.token, {
      method: 'POST',
      body: JSON.stringify({
        p_query: {
          view: 'measurements',
          source_id: source,
          metric: 'weight',
          method: 'device_reported',
          granularity: 'instant',
          from: '2026-09-01',
          to: '2026-09-15',
        },
      }),
    });
    const payload = (await exact.json()) as {
      rows: Array<{ canonical_value: unknown }>;
    };
    expect(typeof payload.rows[0]!.canonical_value).toBe('string');
    console.info(
      JSON.stringify({
        artifact: 'manual_data_http',
        synthetic: true,
        observations: 28,
        current: result.analysis.value,
        previous: result.analysis.previousValue,
        change: result.analysis.absoluteChange,
        foreignStatus: foreign.status,
      }),
    );
  });
  it('serializes retry and conflict paths without duplicate rows or revisions', async () => {
    const body = { ...base, client_request_id: randomUUID() };
    const results = await Promise.all([add(body), add(body)]);
    expect(results[0]).toEqual(results[1]);
    const original = results[0]!;
    const changed = await request(a.token, 'POST', '/api/data', {
      ...body,
      observation: { ...body.observation, value: '71' },
    });
    expect(changed.status).toBe(409);
    const duplicate = await add({
      ...body,
      client_request_id: randomUUID(),
      source: { kind: 'existing', id: original.sourceId },
    });
    expect(duplicate).toMatchObject({
      id: original.id,
      outcome: 'duplicate',
      dataRevision: original.dataRevision,
    });
    const conflict = await request(a.token, 'POST', '/api/data', {
      ...body,
      client_request_id: randomUUID(),
      source: { kind: 'existing', id: original.sourceId },
      observation: { ...body.observation, value: '71' },
    });
    expect(conflict.status).toBe(409);
    expect((await add(body)).dataRevision).toBe(original.dataRevision);
    const receipts = await db.admin(
      `/rest/v1/audit_events?object_id=eq.${original.id}&select=safe_metadata`,
      'GET',
    );
    expect(JSON.stringify(await receipts.json())).not.toContain('observation');
  });
  it('uses exact conversion, accepts unusual valid input, and rolls back invalid source creation', async () => {
    const converted = await add({
      ...base,
      client_request_id: randomUUID(),
      observation: { ...base.observation, value: '150', unit: 'lb' },
    });
    const page = successEnvelopeSchema(MeasurementsPageSchema).parse(
      await (
        await request(a.token, 'GET', query(converted.sourceId, 'measurements'))
      ).json(),
    ).data;
    expect(page.items[0]).toMatchObject({
      value: 68.0388555,
      originalValue: '150',
      originalUnit: 'lb',
    });
    const unusual = await add({
      ...base,
      client_request_id: randomUUID(),
      observation: {
        ...base.observation,
        value: '600',
        quality_flags: ['review_requested'],
      },
    });
    const unusualPage = successEnvelopeSchema(MeasurementsPageSchema).parse(
      await (
        await request(a.token, 'GET', query(unusual.sourceId, 'measurements'))
      ).json(),
    ).data;
    expect(unusualPage.items[0]).toMatchObject({
      value: 600,
      qualityFlags: ['review_requested'],
    });
    for (const observation of [
      { ...base.observation, value: 'NaN' },
      { ...base.observation, value: '' },
      { ...base.observation, user_id: b.id },
      {
        ...base.observation,
        observed_at: '2026-11-01T01:30:00',
        timezone: 'America/New_York',
      },
    ])
      expect(
        (
          await request(a.token, 'POST', '/api/data', {
            ...base,
            client_request_id: randomUUID(),
            observation,
          })
        ).status,
      ).toBe(400);
  });
  it('binds pagination to owner, filters, owned anchors, and data revision', async () => {
    const first = await add({ ...base, client_request_id: randomUUID() });
    await add({
      ...base,
      client_request_id: randomUUID(),
      source: { kind: 'existing', id: first.sourceId },
      observation: {
        ...base.observation,
        observed_at: '2026-09-02T08:00:00Z',
        value: '69',
      },
    });
    const page = successEnvelopeSchema(MeasurementsPageSchema).parse(
      await (
        await request(
          a.token,
          'GET',
          query(first.sourceId, 'measurements', { page_size: '1' }),
        )
      ).json(),
    ).data;
    expect(page.nextCursor).not.toBeNull();
    const next = successEnvelopeSchema(MeasurementsPageSchema).parse(
      await (
        await request(
          a.token,
          'GET',
          query(first.sourceId, 'measurements', {
            page_size: '1',
            cursor: page.nextCursor!,
          }),
        )
      ).json(),
    ).data;
    expect(next.items[0]!.id).not.toBe(page.items[0]!.id);
    expect(
      (
        await request(
          b.token,
          'GET',
          query(first.sourceId, 'measurements', { cursor: page.nextCursor! }),
        )
      ).status,
    ).toBe(404);
    expect(
      (
        await request(
          a.token,
          'GET',
          query(first.sourceId, 'measurements', {
            cursor: page.nextCursor!,
            metric: 'height',
          }),
        )
      ).status,
    ).toBe(400);
    await add({ ...base, client_request_id: randomUUID() });
    expect(
      (
        await request(
          a.token,
          'GET',
          query(first.sourceId, 'measurements', { cursor: page.nextCursor! }),
        )
      ).status,
    ).toBe(409);
    expect(
      (
        await request(
          a.token,
          'GET',
          query(first.sourceId, 'measurements', { page_size: '201' }),
        )
      ).status,
    ).toBe(400);
  });
  it('rejects whitespace-only source labels through direct RPC', async () => {
    for (const label of ['\t', '\uFEFF', '\u00A0']) {
      const response = await db.request(
        '/rest/v1/rpc/add_measurement_v1',
        a.token,
        {
          method: 'POST',
          body: JSON.stringify({
            p_request: {
              ...base,
              client_request_id: randomUUID(),
              source: {
                kind: 'new',
                label,
                origin_app: null,
                device_label: null,
              },
            },
          }),
        },
      );
      expect(response.ok).toBe(false);
    }
  });
  it('reads daily totals by declared date rather than shifting a summary timestamp', async () => {
    const reading = await add({
      ...base,
      client_request_id: randomUUID(),
      observation: {
        ...base.observation,
        metric: 'steps_daily',
        value: '100',
        unit: 'count',
        granularity: 'daily_total',
        local_date: '2026-09-01',
        timezone: 'America/New_York',
        observed_at: '2026-09-02T03:00:00Z',
      },
    });
    const response = await request(
      a.token,
      'GET',
      query(reading.sourceId, 'summary', {
        metric: 'steps_daily',
        granularity: 'daily_total',
        to: '2026-09-02T00:00:00Z',
      }),
    );
    expect(response.status).toBe(200);
    const result = successEnvelopeSchema(DataSummarySchema).parse(
      await response.json(),
    ).data;
    expect(result.series).toEqual([{ localDate: '2026-09-01', value: 100 }]);
  });
  it('normalizes UUID spelling for idempotent retries', async () => {
    const body = {
      ...base,
      client_request_id: 'aabbccdd-1122-4334-8556-abcdefabcdef',
    };
    const first = await add(body);
    expect(
      await add({
        ...body,
        client_request_id: body.client_request_id.toUpperCase(),
      }),
    ).toEqual(first);
  });
  it('rejects a summary assembled across a concurrent revision change', async () => {
    const reading = await add({ ...base, client_request_id: randomUUID() });
    const originalFetch = globalThis.fetch;
    let changed = false;
    const spy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input, init) => {
        const response = await originalFetch(input, init);
        if (
          !changed &&
          String(input).endsWith('/rpc/read_data_v1') &&
          typeof init?.body === 'string' &&
          init.body.includes('measurements')
        ) {
          changed = true;
          await add({
            ...base,
            client_request_id: randomUUID(),
            source: { kind: 'existing', id: reading.sourceId },
            observation: {
              ...base.observation,
              observed_at: '2026-09-02T08:00:00Z',
            },
          });
        }
        return response;
      });
    try {
      expect(
        (await request(a.token, 'GET', query(reading.sourceId))).status,
      ).toBe(409);
      expect(changed).toBe(true);
    } finally {
      spy.mockRestore();
    }
  });
  it('denies foreign parents, direct writes, forged sessions and unsafe direct RPC inputs', async () => {
    const foreign = await add(
      { ...base, client_request_id: randomUUID() },
      b.token,
    );
    expect(
      (
        await request(a.token, 'POST', '/api/data', {
          ...base,
          client_request_id: randomUUID(),
          source: { kind: 'existing', id: foreign.sourceId },
        })
      ).status,
    ).toBe(404);
    for (const token of [null, 'forged'])
      expect(
        (await request(token, 'GET', '/api/data?view=sources')).status,
      ).toBe(401);
    expect(
      (
        await db.request('/rest/v1/measurements', a.token, {
          method: 'POST',
          body: '{}',
        })
      ).status,
    ).toBe(403);
    for (const patch of [
      { user_id: b.id },
      { observation: { ...base.observation, value: 70 } },
      { observation: { ...base.observation, method: null } },
      { observation: { ...base.observation, value: '-1' } },
      {
        observation: {
          ...base.observation,
          observed_at: '2026-11-01T01:30:00',
          timezone: 'America/New_York',
        },
      },
    ]) {
      const response = await db.request(
        '/rest/v1/rpc/add_measurement_v1',
        a.token,
        {
          method: 'POST',
          body: JSON.stringify({
            p_request: { ...base, client_request_id: randomUUID(), ...patch },
          }),
        },
      );
      expect(response.ok).toBe(false);
    }
    expect(
      (await request(a.token, 'POST', '/api/data', { action: 'preview_csv' }))
        .status,
    ).toBe(400);
    const anonymous = await db.request('/rest/v1/rpc/read_data_v1', 'anon', {
      method: 'POST',
      body: JSON.stringify({ p_query: { view: 'sources' } }),
    });
    expect([401, 403]).toContain(anonymous.status);
  });
});

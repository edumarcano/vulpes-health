import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LocalSupabase } from '../helpers/local-supabase.js';
import { localStatus } from '../../scripts/local-database.js';
import { localRouter } from '../../server/http/router.js';
import { successEnvelopeSchema } from '../../shared/api.js';
import { MutationResultSchema } from '../../shared/data.js';
import { MetricReferenceResultSchema } from '../../shared/references.js';

const server = createServer(localRouter);
let db: LocalSupabase;
let a: { id: string; token: string };
let b: { id: string; token: string };
let origin: string;
let source: string;
async function add(value: string, time: string) {
  const response = await fetch(origin + '/api/data', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Vulpes-Data-Contract': '2',
      Authorization: `Bearer ${a.token}`,
    },
    body: JSON.stringify({
      action: 'add_measurement',
      client_request_id: randomUUID(),
      source: source
        ? { kind: 'existing', id: source }
        : {
            kind: 'new',
            label: 'Synthetic reference source',
            origin_app: null,
            device_label: null,
          },
      observation: {
        metric: 'weight',
        value,
        unit: 'kg',
        observed_at: time,
        timezone: 'UTC',
        local_date: null,
        granularity: 'instant',
        method: 'device_reported',
        quality_flags: [],
      },
    }),
  });
  expect(response.status).toBe(200);
  source = successEnvelopeSchema(MutationResultSchema).parse(
    await response.json(),
  ).data.sourceId;
}
function read(extra: Record<string, string> = {}, token = a.token) {
  return fetch(
    origin +
      '/api/data?' +
      new URLSearchParams({
        view: 'reference',
        metric: 'weight',
        source_id: source,
        method: 'device_reported',
        granularity: 'instant',
        timezone: 'UTC',
        ...extra,
      }),
    { headers: { Authorization: `Bearer ${token}` } },
  );
}
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
      display_name: 'Synthetic references',
    });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing local interface.');
  origin = `http://127.0.0.1:${address.port}`;
  await add('70', '2026-09-01T08:00:00Z');
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
describe('owned reference HTTP states', () => {
  it('returns original definitions with explicit unavailable manufacturer guidance', async () => {
    const response = await read();
    expect(response.status).toBe(200);
    const result = successEnvelopeSchema(MetricReferenceResultSchema).parse(
      await response.json(),
    ).data;
    expect(result.definition).toMatchObject({
      metric: 'weight',
      unit: 'kg',
      analyticsEligible: true,
      goalEligible: true,
    });
    expect(result.analysis?.current.value).toBe('70');
    expect(result.classification).toMatchObject({
      state: 'unavailable',
      message: 'Manufacturer reference unavailable',
    });
    const same = successEnvelopeSchema(MetricReferenceResultSchema).parse(
      await (await read()).json(),
    ).data;
    expect(same.id).toBe(result.id);
    expect(
      (
        await read({
          expected_result_id: result.id,
          data_revision: String(result.dataRevision),
        })
      ).status,
    ).toBe(200);
    await add('71', '2026-09-02T08:00:00Z');
    expect(
      (
        await read({
          expected_result_id: result.id,
          data_revision: String(result.dataRevision),
        })
      ).status,
    ).toBe(410);
    console.info(
      JSON.stringify({
        artifact: 'reference_http',
        synthetic: true,
        state: result.classification.state,
        numericalValue: result.analysis?.current.value,
        staleStatus: 410,
        providerRequests: 0,
      }),
    );
  });
  it('keeps unresolved definitions available without enabling derived values or goals', async () => {
    const response = await read({
      metric: 'renpho.bmr',
      method: 'device_estimate',
    });
    expect(response.status).toBe(200);
    const result = successEnvelopeSchema(MetricReferenceResultSchema).parse(
      await response.json(),
    ).data;
    expect(result.definition).toMatchObject({
      metric: 'renpho.bmr',
      analyticsEligible: false,
      goalEligible: false,
    });
    expect(result.analysis).toBeNull();
    expect(result.classification).toMatchObject({
      state: 'unavailable',
      reason: 'unresolved_semantics',
    });
  });
  it('denies existing foreign sources and rejects incomplete evidence selections', async () => {
    expect((await read({}, b.token)).status).toBe(404);
    expect((await read({ from: '2026-09-01T00:00:00Z' })).status).toBe(400);
    expect((await read({ data_revision: '1' })).status).toBe(400);
    const runs = await db.admin(
      `/rest/v1/ai_runs?user_id=eq.${a.id}&select=id`,
      'GET',
    );
    expect(await runs.json()).toEqual([]);
  });
});

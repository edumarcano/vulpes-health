import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LocalSupabase } from '../helpers/local-supabase.js';
import { localStatus } from '../../scripts/local-database.js';
import { localRouter } from '../../server/http/router.js';
import { successEnvelopeSchema } from '../../shared/api.js';
import { MutationResultSchema } from '../../shared/data.js';
import { GoalProposalRowSchema } from '../../shared/goal-views.js';
import { GoalProgressResultSchema } from '../../shared/goal-progress.js';
import { GoalRevisionPayloadSchema } from '../../shared/goals.js';
import { metricRegistry, type RegistryMetric } from '../../shared/metrics.js';

const server = createServer(localRouter);
let db: LocalSupabase;
let a: { id: string; token: string };
let b: { id: string; token: string };
let origin: string;
let source: string;
async function post(path: string, body: unknown, token = a.token) {
  return fetch(origin + path, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'X-Vulpes-Data-Contract': '2',
    },
    body: JSON.stringify(body),
  });
}
async function add(metric: RegistryMetric, value: string, at: string) {
  const response = await post('/api/data', {
    action: 'add_measurement',
    client_request_id: randomUUID(),
    source: { kind: 'existing', id: source },
    observation: {
      metric,
      value,
      unit: metricRegistry[metric].canonicalUnit,
      observed_at: at,
      timezone: 'UTC',
      local_date: null,
      granularity: 'instant',
      method: 'device_estimate',
      quality_flags: [],
    },
  });
  expect(response.status).toBe(200);
  return successEnvelopeSchema(MutationResultSchema).parse(
    await response.json(),
  ).data;
}
function definition(
  metric: RegistryMetric,
  target: unknown,
  patch: Record<string, unknown> = {},
) {
  return {
    schemaVersion: 1,
    title: 'Synthetic numeric goal',
    metric,
    unit: metricRegistry[metric].canonicalUnit,
    sourceId: source,
    target,
    baselineMethod: 'user_reported',
    reportedBaseline: 50,
    baselineFrom: null,
    baselineTo: null,
    currentMethod: 'latest_value',
    method: 'device_estimate',
    granularity: 'instant',
    timezone: 'UTC',
    targetDate: null,
    constraints: [],
    proposedStrategy: null,
    ...patch,
  };
}
async function propose(d: unknown) {
  const response = await post('/api/goals', {
    action: 'propose_create',
    client_request_id: randomUUID(),
    definition: d,
  });
  const body: unknown = await response.json();
  expect({
    status: response.status,
    error: response.ok ? undefined : body,
  }).toEqual({ status: 200, error: undefined });
  return successEnvelopeSchema(GoalProposalRowSchema).parse(body).data;
}
async function approve(p: {
  id: string;
  payload_hash: string;
  target_version: number | null;
}) {
  const request = {
    action: 'approve',
    proposal_id: p.id,
    payload_hash: p.payload_hash,
    expected_version: p.target_version,
    client_request_id: randomUUID(),
  };
  const response = await post('/api/approvals', request);
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    data: { goalId: string; revisionId: string };
  };
  return body.data;
}
async function progress(id: string) {
  const response = await fetch(
    origin + '/api/goals?' + new URLSearchParams({ view: 'progress', id }),
    { headers: { Authorization: `Bearer ${a.token}` } },
  );
  expect(response.status).toBe(200);
  return successEnvelopeSchema(GoalProgressResultSchema).parse(
    await response.json(),
  ).data;
}
beforeAll(async () => {
  const config = localStatus();
  vi.stubEnv('VITE_SUPABASE_URL', config.apiUrl);
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', config.anonKey);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', config.adminKey);
  vi.stubEnv('VULPES_LIVE_AI_ENABLED', 'false');
  db = new LocalSupabase();
  a = await db.createUser();
  b = await db.createUser();
  for (const user of [a, b])
    await db.admin('/rest/v1/profiles', 'POST', {
      user_id: user.id,
      display_name: 'Synthetic numeric goals',
    });
  source = randomUUID();
  await db.admin('/rest/v1/data_sources', 'POST', {
    id: source,
    user_id: a.id,
    kind: 'manual',
    label: 'Synthetic numeric source',
    source_namespace: randomUUID(),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing local interface.');
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
describe('general numeric goals through authenticated approval', () => {
  it('redacts newly dated frozen evidence from revisions and approved proposals after correction', async () => {
    const reading = await add(
      'renpho.bone_mass',
      '3.2',
      '2026-09-02T08:00:00Z',
    );
    const proposal = await propose(
      definition(
        'renpho.bone_mass',
        { direction: 'increase_to', value: 3.3 },
        {
          baselineMethod: 'latest_value',
          reportedBaseline: null,
          baselineFrom: '2026-09-01T00:00:00Z',
          baselineTo: '2026-09-08T00:00:00Z',
        },
      ),
    );
    const before = GoalRevisionPayloadSchema.parse(proposal.canonical_payload);
    expect(before.baseline.value).toBe('3.2');
    expect(before.baseline.references).toEqual([
      expect.objectContaining({
        id: reading.id,
        version: 1,
        observedAt: expect.any(String),
      }),
    ]);
    const approved = await approve(proposal);
    const corrected = await post('/api/data', {
      action: 'correct_measurement',
      measurement_id: reading.id,
      expected_version: 1,
      client_request_id: randomUUID(),
      changes: {
        value: '3.1',
        unit: 'kg',
        observed_at: '2026-09-02T08:00:00Z',
        timezone: 'UTC',
        local_date: null,
      },
    });
    expect(corrected.status).toBe(200);
    for (const [table, id, column] of [
      ['goal_revisions', approved.revisionId, 'payload'],
      ['action_proposals', proposal.id, 'canonical_payload'],
    ] as const) {
      const response = await db.admin(
        `/rest/v1/${table}?id=eq.${id}&select=${column}`,
        'GET',
      );
      const rows = (await response.json()) as Array<Record<string, unknown>>;
      const payload = GoalRevisionPayloadSchema.parse(rows[0]![column]);
      expect(payload.baseline).toMatchObject({ value: null, references: [] });
    }
    expect(await progress(approved.goalId)).toMatchObject({
      kind: 'unavailable',
      reason: 'needs_review',
    });
  });
  it('creates reviewed mass, percentage, ratio and decimal estimate targets without inference', async () => {
    for (const [metric, target, baseline] of [
      ['renpho.muscle_mass', { direction: 'increase_to', value: 51 }, 50],
      [
        'renpho.body_water_percent',
        { direction: 'maintain_range', lower: 54.5, upper: 56 },
        55,
      ],
      [
        'renpho.waist_hip_ratio',
        { direction: 'decrease_to', value: 0.85 },
        0.9,
      ],
      ['renpho.metabolic_age', { direction: 'decrease_to', value: 30.5 }, 31.5],
    ] as const) {
      const p = await propose(
        definition(metric, target, { reportedBaseline: baseline }),
      );
      expect(p.state).toBe('pending');
      const payload = GoalRevisionPayloadSchema.parse(p.canonical_payload);
      expect(payload.definition.metric).toBe(metric);
      const approved = await approve(p);
      const stored = await db.admin(
        `/rest/v1/goals?id=eq.${approved.goalId}&select=metric_key,canonical_unit,state`,
        'GET',
      );
      expect(await stored.json()).toEqual([
        {
          metric_key: metric,
          canonical_unit: metricRegistry[metric].canonicalUnit,
          state: 'active',
        },
      ]);
    }
    const runs = await db.admin(
      `/rest/v1/ai_runs?user_id=eq.${a.id}&select=id`,
      'GET',
    );
    expect(await runs.json()).toEqual([]);
  });
  it('preserves raw regression/overshoot, excludes future current readings and never completes on read', async () => {
    const metric = 'renpho.skeletal_muscle_mass';
    await add(metric, '40', new Date(Date.now() - 60_000).toISOString());
    const approved = await approve(
      await propose(
        definition(metric, { direction: 'increase_to', value: 60 }),
      ),
    );
    expect(await progress(approved.goalId)).toMatchObject({
      kind: 'progress',
      baseline: '50',
      current: '40',
      actualChange: '-10',
      conditionMet: false,
      result: { kind: 'directional', rawPercent: -100, displayPercent: 0 },
    });
    await add(metric, '70', new Date(Date.now() - 30_000).toISOString());
    await add(metric, '99', new Date(Date.now() + 86400_000).toISOString());
    expect(await progress(approved.goalId)).toMatchObject({
      kind: 'progress',
      baseline: '50',
      current: '70',
      actualChange: '20',
      conditionMet: true,
      result: { kind: 'directional', rawPercent: 200, displayPercent: 100 },
    });
    const stored = await db.admin(
      `/rest/v1/goals?id=eq.${approved.goalId}&select=state,version`,
      'GET',
    );
    expect(await stored.json()).toEqual([{ state: 'active', version: 1 }]);
  });
  it('gates stale evidence only under an explicitly approved age policy', async () => {
    const metric = 'renpho.body_water_mass';
    await add(metric, '50', new Date(Date.now() - 5 * 86400_000).toISOString());
    const withPolicy = await approve(
      await propose(
        definition(
          metric,
          { direction: 'maintain_range', lower: 49, upper: 51 },
          { maxEvidenceAgeDays: 2 },
        ),
      ),
    );
    const stale = await progress(withPolicy.goalId);
    expect(stale).toMatchObject({
      kind: 'progress',
      current: '50',
      conditionMet: false,
      freshness: { status: 'stale', maxEvidenceAgeDays: 2 },
      result: { kind: 'within_range' },
    });
    const withoutPolicy = await approve(
      await propose(
        definition(metric, { direction: 'increase_to', value: 50 }),
      ),
    );
    expect(await progress(withoutPolicy.goalId)).toMatchObject({
      kind: 'progress',
      conditionMet: true,
      result: { kind: 'undefined', reason: 'zero_denominator' },
    });
    const rows = await db.admin(
      `/rest/v1/goals?id=eq.${withPolicy.goalId}&select=state,version`,
      'GET',
    );
    expect(await rows.json()).toEqual([{ state: 'active', version: 1 }]);
    console.info(
      JSON.stringify({
        artifact: 'numeric_goal_freshness_http',
        synthetic: true,
        stalePolicyDays: 2,
        staleConditionMet: false,
        rangeStatus: 'within_range',
        readState: 'active',
        providerRequests: 0,
      }),
    );
  });
  it('rejects unresolved metrics and foreign sources, while preserving direct body-fat entry policy', async () => {
    for (const metric of [
      'renpho.bmr',
      'renpho.target_weight_delta',
      'renpho.target_muscle_delta',
      'renpho.target_fat_delta',
    ] as const) {
      expect(
        (
          await post('/api/goals', {
            action: 'propose_create',
            client_request_id: randomUUID(),
            definition: definition(metric, {
              direction: 'increase_to',
              value: 1,
            }),
          })
        ).status,
      ).toBe(400);
    }
    expect(
      (
        await post(
          '/api/goals',
          {
            action: 'propose_create',
            client_request_id: randomUUID(),
            definition: definition('renpho.muscle_mass', {
              direction: 'increase_to',
              value: 51,
            }),
          },
          b.token,
        )
      ).status,
    ).toBe(404);
    const p = await propose(
      definition(
        'body_fat_percent',
        { direction: 'decrease_to', value: 1 },
        { reportedBaseline: 20 },
      ),
    );
    expect((await approve(p)).goalId).toBeTruthy();
  });
});

import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import {
  projectId,
  localEnvironment,
  localStatus,
} from '../../scripts/local-database.js';
import { LocalSupabase } from '../helpers/local-supabase.js';
import { localRouter } from '../../server/http/router.js';
let db: LocalSupabase;
let a: { id: string; token: string };
let b: { id: string; token: string };
let origin: string;
let source: string;
const server = createServer(localRouter);
const definition = () => ({
  schemaVersion: 1,
  title: 'Synthetic goal',
  metric: 'weight',
  unit: 'kg',
  sourceId: source,
  target: { direction: 'decrease_to', value: 68 },
  baselineMethod: 'user_reported',
  reportedBaseline: 70,
  baselineFrom: '2026-10-01T00:00:00Z',
  baselineTo: '2026-10-08T00:00:00Z',
  currentMethod: 'latest_value',
  method: 'device_reported',
  granularity: 'instant',
  timezone: 'UTC',
  targetDate: null,
  constraints: [],
  proposedStrategy: null,
});
const post = (route: string, input: unknown, token = a.token) =>
  fetch(origin + route, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(input),
  });
async function propose() {
  const response = await post('/api/goals', {
    action: 'propose_create',
    client_request_id: randomUUID(),
    definition: definition(),
  });
  expect(response.status).toBe(200);
  return (await response.json()).data;
}
beforeAll(async () => {
  const c = localStatus();
  vi.stubEnv('VITE_SUPABASE_URL', c.apiUrl);
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', c.anonKey);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', c.adminKey);
  vi.stubEnv('VULPES_LIVE_AI_ENABLED', 'false');
  db = new LocalSupabase();
  a = await db.createUser();
  b = await db.createUser();
  for (const u of [a, b])
    await db.admin('/rest/v1/profiles', 'POST', { user_id: u.id });
  source = randomUUID();
  await db.admin('/rest/v1/data_sources', 'POST', {
    id: source,
    user_id: a.id,
    kind: 'manual',
    label: 'Synthetic goal source',
    source_namespace: randomUUID(),
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error();
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((r) => server.close(() => r()));
  try {
    await db.cleanup();
  } finally {
    vi.unstubAllEnvs();
  }
});
const approval = (p: {
  id: string;
  payload_hash: string;
  target_version: number | null;
}) => ({
  action: 'approve',
  proposal_id: p.id,
  payload_hash: p.payload_hash,
  expected_version: p.target_version,
  client_request_id: randomUUID(),
});
it('creates pending only, denies foreign and tampered approval, and applies exactly one replayable revision', async () => {
  const p = await propose();
  expect(
    await (await db.admin(`/rest/v1/goals?user_id=eq.${a.id}`, 'GET')).json(),
  ).toHaveLength(0);
  const request = approval(p);
  expect((await post('/api/approvals', request, b.token)).status).toBe(404);
  expect(
    (await post('/api/approvals', { ...request, payload_hash: 'f'.repeat(64) }))
      .status,
  ).toBe(409);
  const results = await Promise.all([
    post('/api/approvals', request),
    post('/api/approvals', request),
  ]);
  expect(results.map((x) => x.status)).toEqual([200, 200]);
  expect(await results[0]!.json()).toMatchObject({
    data: { outcome: 'approved', revisionNumber: 1 },
  });
  expect(
    await (
      await db.admin(`/rest/v1/goal_revisions?user_id=eq.${a.id}`, 'GET')
    ).json(),
  ).toHaveLength(1);
  expect(
    (await post('/api/approvals', { ...request, action: 'reject' })).status,
  ).toBe(409);
});
it('rejects and discards draft content without creating a goal', async () => {
  const p = await propose();
  const response = await post('/api/approvals', {
    ...approval(p),
    action: 'reject',
  });
  expect(response.status).toBe(200);
  const rows = await (
    await db.admin(`/rest/v1/action_proposals?id=eq.${p.id}`, 'GET')
  ).json();
  expect(rows[0]).toMatchObject({ state: 'rejected', canonical_payload: null });
});
it('rejects direct authenticated transaction execution and foreign sources', async () => {
  expect(
    (
      await db.request('/rest/v1/rpc/register_goal_proposal_v1', a.token, {
        method: 'POST',
        body: JSON.stringify({ p_owner: b.id, p_request: {}, p_payload: {} }),
      })
    ).ok,
  ).toBe(false);
  expect(
    (
      await post(
        '/api/goals',
        {
          action: 'propose_create',
          client_request_id: randomUUID(),
          definition: definition(),
        },
        b.token,
      )
    ).status,
  ).toBe(404);
});
it('serializes competing revisions and binds fresh terminal retry keys', async () => {
  const p = await propose();
  const first = await (await post('/api/approvals', approval(p))).json();
  const goal = first.data.goalId;
  const make = (title: string) =>
    post('/api/goals', {
      action: 'propose_revision',
      goal_id: goal,
      expected_version: 1,
      client_request_id: randomUUID(),
      definition: { ...definition(), title },
      baseline_resolution: 'retain',
    });
  const one = (await (await make('Synthetic revision one')).json()).data;
  const two = (await (await make('Synthetic revision two')).json()).data;
  const outcomes = await Promise.all([
    post('/api/approvals', approval(one)),
    post('/api/approvals', approval(two)),
  ]);
  expect(outcomes.map((r) => r.status).sort()).toEqual([200, 409]);
  const retry = approval(p);
  expect((await post('/api/approvals', retry)).status).toBe(200);
  const other = await propose();
  expect(
    (
      await post('/api/approvals', {
        ...approval(other),
        client_request_id: retry.client_request_id,
      })
    ).status,
  ).toBe(409);
  const revisions = await (
    await db.admin(`/rest/v1/goal_revisions?goal_id=eq.${goal}`, 'GET')
  ).json();
  expect(revisions).toHaveLength(2);
});
it('expires draft contents and preserves a registered proposal receipt after data changes', async () => {
  const p = await propose();
  await db.admin(`/rest/v1/action_proposals?id=eq.${p.id}`, 'PATCH', {
    created_at: new Date(Date.now() - 172800000).toISOString(),
    expires_at: new Date(Date.now() - 86400000).toISOString(),
  });
  expect((await post('/api/approvals', approval(p))).status).toBe(409);
  expect(
    (
      await (
        await db.admin(`/rest/v1/action_proposals?id=eq.${p.id}`, 'GET')
      ).json()
    )[0].canonical_payload,
  ).toBeNull();
  const request = {
    action: 'propose_create',
    client_request_id: randomUUID(),
    definition: definition(),
  };
  const response = await post('/api/goals', request);
  expect(response.status).toBe(200);
  const before = (await response.json()).data;
  await db.admin(`/rest/v1/profiles?user_id=eq.${a.id}`, 'PATCH', {
    data_revision: 1,
  });
  const repeated = await post('/api/goals', request);
  expect(repeated.status).toBe(200);
  expect((await repeated.json()).data).toMatchObject({
    id: before.id,
    state: 'conflicted',
    canonical_payload: null,
  });
});
it('freezes exact daily baselines and requires approval to retain them after correction', async () => {
  let reading: { id: string; version: number } | undefined;
  for (let day = 1; day <= 7; day++) {
    const value = String(70 - (day - 1) / 10);
    const r = await post('/api/data', {
      action: 'add_measurement',
      client_request_id: randomUUID(),
      source: { kind: 'existing', id: source },
      observation: {
        metric: 'weight',
        value,
        unit: 'kg',
        observed_at: `2026-09-${String(day).padStart(2, '0')}T08:00:00Z`,
        timezone: 'UTC',
        local_date: null,
        granularity: 'instant',
        method: 'device_reported',
        quality_flags: [],
      },
    });
    expect(r.status).toBe(200);
    reading ??= (await r.json()).data;
  }
  const d = {
    ...definition(),
    baselineMethod: 'daily_median_mean_7d',
    currentMethod: 'daily_median_mean_7d',
    reportedBaseline: null,
    baselineFrom: '2026-09-01T00:00:00Z',
    baselineTo: '2026-09-08T00:00:00Z',
  };
  const r = await post('/api/goals', {
    action: 'propose_create',
    client_request_id: randomUUID(),
    definition: d,
  });
  expect(r.status).toBe(200);
  const p = (await r.json()).data;
  expect(p.canonical_payload.baseline.value).toBe('69.7');
  const approved = (await (await post('/api/approvals', approval(p))).json())
    .data;
  const correction = await post('/api/data', {
    action: 'correct_measurement',
    measurement_id: reading!.id,
    expected_version: reading!.version,
    client_request_id: randomUUID(),
    changes: {
      value: '75',
      unit: 'kg',
      observed_at: '2026-09-01T08:00:00Z',
      timezone: 'UTC',
      local_date: null,
    },
  });
  expect(correction.status).toBe(200);
  const goal = (
    await (
      await db.admin(`/rest/v1/goals?id=eq.${approved.goalId}`, 'GET')
    ).json()
  )[0];
  expect(goal).toMatchObject({
    review_status: 'needs_review',
    version: 2,
    baseline_snapshot: { value: '69.7' },
  });
  const review = await post('/api/goals', {
    action: 'propose_revision',
    goal_id: goal.id,
    expected_version: 2,
    client_request_id: randomUUID(),
    definition: d,
    baseline_resolution: 'retain',
  });
  expect(review.status).toBe(200);
  expect(
    (await post('/api/approvals', approval((await review.json()).data))).status,
  ).toBe(200);
  const retained = (
    await (await db.admin(`/rest/v1/goals?id=eq.${goal.id}`, 'GET')).json()
  )[0];
  expect(retained).toMatchObject({
    review_status: 'clear',
    version: 3,
    baseline_snapshot: { value: '69.7' },
  });
});
it('treats differently cased request UUIDs as the same replay key', async () => {
  const key = 'abcdefab-1111-4111-8111-111111111111';
  const request = {
    action: 'propose_create',
    client_request_id: key,
    definition: definition(),
  };
  expect((await post('/api/goals', request)).status).toBe(200);
  expect(
    (
      await post('/api/goals', {
        ...request,
        client_request_id: key.toUpperCase(),
      })
    ).status,
  ).toBe(409);
});

it('rolls back the goal and revision when the final state update fails', async () => {
  const request = {
    action: 'propose_create',
    client_request_id: randomUUID(),
    definition: { ...definition(), title: 'Synthetic rollback goal' },
  };
  const proposed = await post('/api/goals', request);
  expect(proposed.status).toBe(200);
  const proposal = (await proposed.json()).data;
  const rows = async (table: string) =>
    await (
      await db.admin(`/rest/v1/${table}?user_id=eq.${a.id}&order=id`, 'GET')
    ).json();
  const beforeGoals = await rows('goals');
  const beforeRevisions = await rows('goal_revisions');
  const sql = (value: string) => {
    const result = spawnSync(
      'docker',
      [
        'exec',
        `supabase_db_${projectId}`,
        'psql',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        value,
      ],
      { env: localEnvironment(), encoding: 'utf8', timeout: 15000 },
    );
    expect(result.status).toBe(0);
  };
  sql(
    "alter table public.goals add constraint pr11_test_rollback check (title<>'Synthetic rollback goal' or state='draft') not valid",
  );
  try {
    expect((await post('/api/approvals', approval(proposal))).status).toBe(503);
    expect(await rows('goals')).toEqual(beforeGoals);
    expect(await rows('goal_revisions')).toEqual(beforeRevisions);
    expect(
      (await rows('action_proposals')).find(
        (p: { id: string }) => p.id === proposal.id,
      ),
    ).toMatchObject({ state: 'pending', payload_hash: proposal.payload_hash });
  } finally {
    sql('alter table public.goals drop constraint pr11_test_rollback');
  }
});

it.each([
  ['UTC', '2026-03-08T00:00:00Z'],
  ['Pacific/Kiritimati', '2026-03-08T12:00:00Z'],
  ['Pacific/Honolulu', '2026-03-08T00:00:00Z'],
  ['America/New_York', '2026-03-08T06:59:59Z'],
  ['America/New_York', '2026-03-08T07:00:00Z'],
  ['America/New_York', '2025-11-02T05:59:59Z'],
  ['America/New_York', '2025-11-02T06:00:00Z'],
  ['America/New_York', '2026-03-09T03:59:59Z'],
  ['America/New_York', '2026-03-09T04:00:00Z'],
])(
  'latest daily progress includes today and excludes tomorrow in %s at %s',
  async (timezone, instant) => {
    const now = Temporal.Instant.from(instant);
    const today = now.toZonedDateTimeISO(timezone).startOfDay();
    const selectedSource = randomUUID();
    await db.admin('/rest/v1/data_sources', 'POST', {
      id: selectedSource,
      user_id: a.id,
      kind: 'manual',
      label: 'Synthetic date boundary',
      source_namespace: randomUUID(),
    });
    for (const [offset, value] of [
      [-1, '6000'],
      [0, '8000'],
      [1, '9000'],
    ] as const) {
      const day = today.add({ days: offset });
      const response = await post('/api/data', {
        action: 'add_measurement',
        client_request_id: randomUUID(),
        source: { kind: 'existing', id: selectedSource },
        observation: {
          metric: 'steps_daily',
          value,
          unit: 'count',
          observed_at: day.toInstant().toString(),
          timezone,
          local_date: day.toPlainDate().toString(),
          granularity: 'daily_total',
          method: 'device_reported',
          quality_flags: [],
        },
      });
      expect(response.status).toBe(200);
    }
    const response = await post('/api/goals', {
      action: 'propose_create',
      client_request_id: randomUUID(),
      definition: {
        ...definition(),
        sourceId: selectedSource,
        metric: 'steps_daily',
        unit: 'count',
        granularity: 'daily_total',
        timezone,
        reportedBaseline: 4000,
        target: { direction: 'increase_to', value: 10000 },
      },
    });
    expect(response.status).toBe(200);
    const p = (await response.json()).data;
    const approved = await post('/api/approvals', approval(p));
    expect(approved.status).toBe(200);
    const goal = (await approved.json()).data.goalId;
    const clock = vi.spyOn(Temporal.Now, 'instant').mockReturnValue(now);
    try {
      const result = await fetch(
        origin + '/api/goals?view=progress&id=' + goal,
        { headers: { Authorization: `Bearer ${a.token}` } },
      );
      expect(result.status).toBe(200);
      const progress = (await result.json()).data;
      expect(progress).toMatchObject({
        kind: 'progress',
        current: '8000',
        selection: { to: today.add({ days: 1 }).toInstant().toString() },
      });
      expect(progress.result.rawPercent).toBeCloseTo(200 / 3, 10);
    } finally {
      clock.mockRestore();
    }
  },
);
it('latest timestamped progress excludes later readings on the same local day', async () => {
  const now = Temporal.Instant.from('2026-03-08T07:00:00Z');
  const selectedSource = randomUUID();
  await db.admin('/rest/v1/data_sources', 'POST', {
    id: selectedSource,
    user_id: a.id,
    kind: 'manual',
    label: 'Synthetic instant boundary',
    source_namespace: randomUUID(),
  });
  for (const [seconds, value] of [
    [-1, '69'],
    [1, '68'],
  ] as const) {
    const response = await post('/api/data', {
      action: 'add_measurement',
      client_request_id: randomUUID(),
      source: { kind: 'existing', id: selectedSource },
      observation: {
        metric: 'weight',
        value,
        unit: 'kg',
        observed_at: now.add({ seconds }).toString(),
        timezone: 'America/New_York',
        local_date: null,
        granularity: 'instant',
        method: 'device_reported',
        quality_flags: [],
      },
    });
    expect(response.status).toBe(200);
  }
  const proposed = await post('/api/goals', {
    action: 'propose_create',
    client_request_id: randomUUID(),
    definition: {
      ...definition(),
      sourceId: selectedSource,
      timezone: 'America/New_York',
    },
  });
  expect(proposed.status).toBe(200);
  const approved = await post(
    '/api/approvals',
    approval((await proposed.json()).data),
  );
  expect(approved.status).toBe(200);
  const goal = (await approved.json()).data.goalId;
  const clock = vi.spyOn(Temporal.Now, 'instant').mockReturnValue(now);
  try {
    const response = await fetch(
      origin + '/api/goals?view=progress&id=' + goal,
      { headers: { Authorization: `Bearer ${a.token}` } },
    );
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      kind: 'progress',
      current: '69',
      selection: { to: now.toString() },
      result: { rawPercent: 50 },
    });
  } finally {
    clock.mockRestore();
  }
});

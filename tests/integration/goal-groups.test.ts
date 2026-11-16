import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { LocalSupabase } from '../helpers/local-supabase.js';
import { localStatus } from '../../scripts/local-database.js';
import { localRouter } from '../../server/http/router.js';
import { successEnvelopeSchema } from '../../shared/api.js';
import {
  GoalProposalRowSchema,
  GoalRowSchema,
} from '../../shared/goal-views.js';
import {
  GoalGroupDecisionSchema,
  GoalGroupDetailSchema,
  GoalGroupProgressSchema,
  GoalGroupProposalRowSchema,
} from '../../shared/goal-groups.js';

const server = createServer(localRouter);
let db: LocalSupabase;
let a: { id: string; token: string };
let b: { id: string; token: string };
let origin: string;
let source: string;
type Proposal = z.infer<typeof GoalGroupProposalRowSchema>;
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
async function get(view: string, id?: string, token = a.token) {
  return fetch(
    origin +
      '/api/goals?' +
      new URLSearchParams({ view, ...(id ? { id } : {}) }),
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  );
}
async function data<T extends z.ZodType>(
  response: Response,
  schema: T,
): Promise<z.output<T>> {
  const body: unknown = await response.json();
  expect({
    status: response.status,
    error: response.ok ? undefined : body,
  }).toEqual({ status: 200, error: undefined });
  return schema.parse(successEnvelopeSchema(z.json()).parse(body).data);
}
async function rows(table: string, owner = a.id) {
  return (await (
    await db.admin(`/rest/v1/${table}?user_id=eq.${owner}&order=id`, 'GET')
  ).json()) as Record<string, unknown>[];
}
function definition(
  title = 'Synthetic grouped muscle',
  target: unknown = { direction: 'increase_to', value: 50 },
) {
  return {
    schemaVersion: 1,
    title,
    metric: 'renpho.muscle_mass',
    unit: 'kg',
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
  };
}
async function reading(value: string) {
  const response = await post('/api/data', {
    action: 'add_measurement',
    client_request_id: randomUUID(),
    source: { kind: 'existing', id: source },
    observation: {
      metric: 'renpho.muscle_mass',
      value,
      unit: 'kg',
      observed_at: new Date(Date.now() - 60_000).toISOString(),
      timezone: 'UTC',
      local_date: null,
      granularity: 'instant',
      method: 'device_estimate',
      quality_flags: [],
    },
  });
  expect(response.status).toBe(200);
}
async function propose(
  members: unknown[],
  patch: Record<string, unknown> = {},
  token = a.token,
) {
  return data(
    await post(
      '/api/goals',
      {
        action: 'propose_group_create',
        client_request_id: randomUUID(),
        name: 'Synthetic reviewed group',
        members,
        ...patch,
      },
      token,
    ),
    GoalGroupProposalRowSchema,
  );
}
function approval(
  p: { id: string; payload_hash: string; target_version: number | null },
  patch: Record<string, unknown> = {},
) {
  return {
    action: 'approve',
    proposal_id: p.id,
    payload_hash: p.payload_hash,
    expected_version: p.target_version,
    client_request_id: randomUUID(),
    ...patch,
  };
}
async function approve(p: Proposal) {
  const result = await data(
    await post('/api/approvals', approval(p)),
    GoalGroupDecisionSchema,
  );
  if (result.outcome !== 'approved')
    throw new Error('Expected an approved synthetic group.');
  return result;
}
async function single(d = definition()) {
  const p = await data(
    await post('/api/goals', {
      action: 'propose_create',
      client_request_id: randomUUID(),
      definition: d,
    }),
    GoalProposalRowSchema,
  );
  const response = await post('/api/approvals', approval(p));
  expect(response.status).toBe(200);
  const result = (await response.json()).data as { goalId: string };
  return GoalRowSchema.parse(
    (await rows('goals')).find((g) => g.id === result.goalId),
  );
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
    await db.admin('/rest/v1/profiles', 'POST', { user_id: user.id });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing synthetic interface.');
  origin = `http://127.0.0.1:${address.port}`;
});
beforeEach(async () => {
  source = randomUUID();
  await db.admin('/rest/v1/data_sources', 'POST', {
    id: source,
    user_id: a.id,
    kind: 'manual',
    label: 'Synthetic group source',
    source_namespace: randomUUID(),
  });
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

it('approves one parent atomically, preserves independent child calculations and replays the receipt once', async () => {
  await reading('50');
  const before = await rows('goals');
  const proposal = await propose([
    { kind: 'create', definition: definition('Synthetic mass target') },
    {
      kind: 'create',
      definition: definition('Synthetic independent range', {
        direction: 'maintain_range',
        lower: 49,
        upper: 51,
      }),
    },
  ]);
  expect(await rows('goals')).toHaveLength(before.length);
  expect(
    (
      await data(
        await get('group_proposals'),
        z.object({ items: z.array(GoalGroupProposalRowSchema) }),
      )
    ).items.some((p) => p.id === proposal.id),
  ).toBe(true);
  expect(
    (
      await data(
        await get('proposals'),
        z.object({ items: z.array(GoalProposalRowSchema) }),
      )
    ).items.some((p) => p.id === proposal.id),
  ).toBe(false);
  const request = approval(proposal);
  const [first, replay] = await Promise.all([
    data(await post('/api/approvals', request), GoalGroupDecisionSchema),
    data(await post('/api/approvals', request), GoalGroupDecisionSchema),
  ]);
  expect(replay).toEqual(first);
  if (first.outcome !== 'approved') throw new Error();
  expect(first.members.map((m) => m.position)).toEqual([1, 2]);
  expect(await rows('goals')).toHaveLength(before.length + 2);
  const revisions = (await rows('goal_revisions')).filter(
    (r) => r.approved_proposal_id === proposal.id,
  );
  expect(revisions).toHaveLength(2);
  expect(
    (await rows('action_proposals')).filter((p) => p.id === proposal.id),
  ).toHaveLength(1);
  const detail = await data(
    await get('group_detail', first.groupId),
    GoalGroupDetailSchema,
  );
  expect(detail.progress.conditionStatus).toBe('meeting_conditions');
  expect(detail.progress.members.map((m) => m.outcome)).toEqual(['met', 'met']);
  expect(detail.progress.members[0]!.progress).toMatchObject({
    kind: 'progress',
    result: { kind: 'undefined' },
    conditionMet: true,
  });
  expect(detail.progress.members[1]!.progress).toMatchObject({
    kind: 'progress',
    result: { kind: 'within_range' },
  });
  expect(
    new Set(
      detail.progress.members.flatMap((m) =>
        m.progress?.kind === 'progress'
          ? [m.progress.freshness?.evaluatedAt]
          : [],
      ),
    ),
  ).toEqual(new Set([detail.progress.evaluatedAt]));
  for (const member of first.members)
    expect((await get('detail', member.goalId)).status).toBe(200);
  expect(await rows('ai_runs')).toEqual([]);
  expect(
    (await post('/api/approvals', { ...request, payload_hash: 'f'.repeat(64) }))
      .status,
  ).toBe(409);
});

it('links and revises approved children only after group review, then exposes independent changes as needs review', async () => {
  await reading('50');
  const original = await single();
  const p = await propose([
    {
      kind: 'revise',
      goal_id: original.id,
      expected_version: original.version,
      definition: definition('Synthetic reviewed change', {
        direction: 'increase_to',
        value: 51,
      }),
      baseline_resolution: 'retain',
    },
    { kind: 'create', definition: definition('Synthetic second member') },
  ]);
  expect((await rows('goals')).find((g) => g.id === original.id)?.version).toBe(
    1,
  );
  const group = await approve(p);
  expect(group.members[0]).toMatchObject({ goalId: original.id, version: 2 });
  let progress = await data(
    await get('group_progress', group.groupId),
    GoalGroupProgressSchema,
  );
  expect(progress.conditionStatus).toBe('not_meeting_conditions');
  const change = await data(
    await post('/api/goals', {
      action: 'propose_state',
      client_request_id: randomUUID(),
      goal_id: original.id,
      expected_version: 2,
      state: 'paused',
    }),
    GoalProposalRowSchema,
  );
  expect((await post('/api/approvals', approval(change))).status).toBe(200);
  progress = await data(
    await get('group_progress', group.groupId),
    GoalGroupProgressSchema,
  );
  expect(progress.conditionStatus).toBe('unavailable');
  expect(progress.members[0]!.outcome).toBe('needs_review');
  // Administrative archival remains available after a child changes independently.
  const archive = await data(
    await post('/api/goals', {
      action: 'propose_group_state',
      client_request_id: randomUUID(),
      group_id: group.groupId,
      expected_version: group.version,
      state: 'archived',
    }),
    GoalGroupProposalRowSchema,
  );
  const archived = await approve(archive);
  expect(archived.version).toBe(2);
  expect(
    (
      await data(
        await get('group_progress', group.groupId),
        GoalGroupProgressSchema,
      )
    ).administrativeState,
  ).toBe('archived');
});

it('rejects foreign members, duplicate/fifth members and direct table/RPC attacks without activating children', async () => {
  const foreignSource = randomUUID();
  await db.admin('/rest/v1/data_sources', 'POST', {
    id: foreignSource,
    user_id: b.id,
    kind: 'manual',
    label: 'Synthetic foreign group source',
    source_namespace: randomUUID(),
  });
  const foreign = await propose(
    [
      {
        kind: 'create',
        definition: { ...definition(), sourceId: foreignSource },
      },
    ],
    {},
    b.token,
  );
  const receipt = await data(
    await post('/api/approvals', approval(foreign), b.token),
    GoalGroupDecisionSchema,
  );
  if (receipt.outcome !== 'approved') throw new Error();
  expect((await get('group_detail', receipt.groupId)).status).toBe(404);
  const member = receipt.members[0]!;
  const before = await rows('goals');
  const base = {
    action: 'propose_group_create',
    client_request_id: randomUUID(),
    name: 'Synthetic denied group',
  };
  expect(
    (
      await post('/api/goals', {
        ...base,
        members: [
          { kind: 'create', definition: definition() },
          {
            kind: 'existing',
            goal_id: member.goalId,
            expected_version: member.version,
          },
        ],
      })
    ).status,
  ).toBe(404);
  const own = await single();
  const existing = {
    kind: 'existing',
    goal_id: own.id,
    expected_version: own.version,
  };
  expect(
    (await post('/api/goals', { ...base, members: [existing, existing] }))
      .status,
  ).toBe(400);
  expect(
    (
      await post('/api/goals', {
        ...base,
        members: Array.from({ length: 5 }, () => ({
          kind: 'create',
          definition: definition(),
        })),
      })
    ).status,
  ).toBe(400);
  expect(await rows('goals')).toHaveLength(before.length + 1);
  for (const table of ['goal_groups', 'goal_group_members']) {
    const foreignRead = await db.request(
      `/rest/v1/${table}?user_id=eq.${b.id}`,
      a.token,
    );
    expect(await foreignRead.json()).toEqual([]);
    expect(
      (
        await db.request(`/rest/v1/${table}`, a.token, {
          method: 'POST',
          body: JSON.stringify({ user_id: a.id }),
        })
      ).status,
    ).toBe(403);
  }
  expect(
    (
      await db.request(
        '/rest/v1/rpc/register_goal_group_proposal_v1',
        a.token,
        {
          method: 'POST',
          body: JSON.stringify({
            p_owner: a.id,
            p_request: base,
            p_payload: {},
          }),
        },
      )
    ).status,
  ).toBe(403);
});

it('conflicts a pending mixed group after an individual revision and leaves all proposed new children absent', async () => {
  const own = await single();
  const before = await rows('goals');
  const proposal = await propose([
    { kind: 'create', definition: definition('Synthetic must stay absent') },
    { kind: 'existing', goal_id: own.id, expected_version: own.version },
  ]);
  const change = await data(
    await post('/api/goals', {
      action: 'propose_state',
      client_request_id: randomUUID(),
      goal_id: own.id,
      expected_version: own.version,
      state: 'paused',
    }),
    GoalProposalRowSchema,
  );
  expect((await post('/api/approvals', approval(change))).status).toBe(200);
  expect((await post('/api/approvals', approval(proposal))).status).toBe(409);
  expect(await rows('goals')).toHaveLength(before.length);
  expect(
    (await rows('goal_group_members')).some((m) => m.goal_id === own.id),
  ).toBe(false);
});

it('requires reviewed membership revision, preserves proposal replay and invalidates pending groups on data change', async () => {
  const own = await single();
  const requestId = randomUUID();
  const members = [
    { kind: 'existing', goal_id: own.id, expected_version: own.version },
  ];
  const proposal = await propose(members, { client_request_id: requestId });
  expect((await propose(members, { client_request_id: requestId })).id).toBe(
    proposal.id,
  );
  const group = await approve(proposal);
  const revised = await propose(
    [
      ...members,
      { kind: 'create', definition: definition('Synthetic reviewed addition') },
    ],
    {
      action: 'propose_group_revision',
      group_id: group.groupId,
      expected_version: 1,
      name: 'Synthetic renamed group',
    },
  );
  expect(
    (await rows('goal_group_members')).filter(
      (m) => m.group_id === group.groupId,
    ),
  ).toHaveLength(1);
  const result = await approve(revised);
  expect(result.version).toBe(2);
  expect(
    (await rows('goal_group_members')).filter(
      (m) => m.group_id === group.groupId,
    ),
  ).toHaveLength(2);
  const pending = await propose([
    { kind: 'create', definition: definition('Synthetic revision-bound') },
  ]);
  await reading('50');
  const expired = await data(
    await get('group_proposal', pending.id),
    GoalGroupProposalRowSchema,
  );
  expect(expired).toMatchObject({
    state: 'conflicted',
    canonical_payload: null,
  });
  expect((await post('/api/approvals', approval(pending))).status).toBe(409);
});

it('rejects proposals without creating a group and denies approval after expiry', async () => {
  const before = await rows('goal_groups');
  const rejected = await propose([
    { kind: 'create', definition: definition() },
  ]);
  expect(
    await data(
      await post('/api/approvals', approval(rejected, { action: 'reject' })),
      GoalGroupDecisionSchema,
    ),
  ).toEqual({ proposalId: rejected.id, outcome: 'rejected' });
  expect(await rows('goal_groups')).toHaveLength(before.length);
  const expired = await propose([{ kind: 'create', definition: definition() }]);
  await db.admin(`/rest/v1/action_proposals?id=eq.${expired.id}`, 'PATCH', {
    created_at: new Date(Date.now() - 172800000).toISOString(),
    expires_at: new Date(Date.now() - 86400000).toISOString(),
  });
  expect((await post('/api/approvals', approval(expired))).status).toBe(409);
  expect(await rows('goal_groups')).toHaveLength(before.length);
});

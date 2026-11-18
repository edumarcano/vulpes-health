import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { LocalSupabase } from '../helpers/local-supabase.js';
import { localStatus } from '../../scripts/local-database.js';
import { verifySession, type AuthContext } from '../../server/auth/session.js';
import { ConversationService } from '../../server/services/conversations.js';
import { createChatHandler } from '../../server/http/chat.js';
import { localRouter } from '../../server/http/router.js';
import { InspectionService } from '../../server/services/inspection.js';
import { ExecutionService } from '../../server/ai/ledger/execution.js';
import { addMeasurement } from '../../server/services/measurements.js';
import { previewCsv, commitImport } from '../../server/services/imports.js';
import { GoalGroupService } from '../../server/services/goal-groups.js';
import { GoalService } from '../../server/services/goals.js';
import { GoalGroupMutationSchema } from '../../shared/goal-groups.js';
import { ApprovalRequestSchema } from '../../shared/api.js';
import {
  ImportPreviewV2Schema,
  PreviewCsvWireSchema,
} from '../../shared/imports.js';
import type { RequestTransport } from '../../server/ai/ledger/dispatcher.js';
import { prepareGoalTool } from '../../server/ai/tools.js';
import { ChatSendRequestSchema } from '../../shared/api.js';
import { StreamDecoder } from '../../shared/stream.js';
import { MessagesPageSchema } from '../../shared/chat.js';
import {
  responseFrame,
  assistantOutput,
  syntheticChatDependencies,
} from '../fixtures/chat.js';

let db: LocalSupabase;
let owner: { id: string; token: string };
let context: AuthContext;
let source: string;
let app: string;
let origin: string;
let server: ReturnType<typeof createServer>;

class ScriptedTransport implements RequestTransport {
  readonly mode = 'mock';
  readonly requests: Buffer[] = [];
  constructor(
    private readonly name: string,
    private readonly args: unknown,
  ) {}
  async *send(bytes: Uint8Array, signal: AbortSignal) {
    signal.throwIfAborted();
    this.requests.push(Buffer.from(bytes));
    yield responseFrame(
      this.requests.length === 1
        ? [
            {
              type: 'function_call',
              id: 'synthetic-item',
              call_id: 'synthetic-call',
              name: this.name,
              arguments: JSON.stringify(this.args),
            },
          ]
        : [
            assistantOutput(
              'Review the server-issued evidence. No changes are applied by this answer.',
            ),
          ],
    );
  }
}
async function rows(table: string) {
  return (await (
    await db.admin(`/rest/v1/${table}?user_id=eq.${owner.id}`, 'GET')
  ).json()) as Record<string, unknown>[];
}
async function post(route: string, body: unknown) {
  return fetch(origin + route, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${owner.token}`,
      'content-type': 'application/json',
      'X-Vulpes-Data-Contract': '2',
    },
    body: JSON.stringify(body),
  });
}
async function send(
  transport: RequestTransport,
  text = 'Use the selected owned series.',
  selection?: { groupId: string },
) {
  const conversation = randomUUID();
  await new ConversationService(context).mutate({
    action: 'create',
    id: conversation,
    client_request_id: randomUUID(),
  });
  const chat = createChatHandler(() => syntheticChatDependencies(transport));
  server = createServer((req, res) => {
    void (req.url?.startsWith('/api/chat')
      ? chat(req, res)
      : localRouter(req, res));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing synthetic server.');
  origin = `http://127.0.0.1:${address.port}`;
  const input = ChatSendRequestSchema.parse({
    action: 'send',
    conversation_id: conversation,
    client_request_id: randomUUID(),
    message: { id: randomUUID(), text },
    depth: 'auto',
    ...(selection
      ? {
          context_selection: {
            metric: 'weight',
            source_id: source,
            goal_id: null,
            group_id: selection.groupId,
            from: '2026-09-01T00:00:00Z',
            to: '2026-10-01T00:00:00Z',
            timezone: 'UTC',
          },
        }
      : {}),
  });
  const response = await post('/api/chat', input);
  expect(response.status).toBe(200);
  const decoder = new StreamDecoder();
  const events = [];
  for await (const bytes of response.body!) events.push(...decoder.push(bytes));
  decoder.finish();
  expect(events.at(-1)?.type, JSON.stringify(events.at(-1))).toBe(
    'run.completed',
  );
  return { events, conversation, run: events[0]!.run_id };
}
beforeEach(async () => {
  const config = localStatus();
  for (const [key, value] of Object.entries({
    VITE_SUPABASE_URL: config.apiUrl,
    VITE_SUPABASE_PUBLISHABLE_KEY: config.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: config.adminKey,
    VULPES_TRACE_ENCRYPTION_KEY_ID: 'synthetic-v020-chat',
    VULPES_TRACE_ENCRYPTION_KEY_B64: randomBytes(32).toString('base64'),
    VULPES_LIVE_AI_ENABLED: 'false',
  }))
    vi.stubEnv(key, value);
  db = new LocalSupabase();
  owner = await db.createUser();
  await db.admin('/rest/v1/profiles', 'POST', {
    user_id: owner.id,
    consent_versions: {
      openrouter: {
        accepted_version: 'openrouter_zdr_v2',
        accepted_at: new Date().toISOString(),
      },
    },
  });
  app = randomUUID();
  const period = new Date().toISOString().slice(0, 7) + '-01';
  await db.admin('/rest/v1/usage_buckets', 'POST', {
    id: app,
    scope: 'app',
    period_start: period,
    allocated_ceiling_usd: '10',
  });
  await db.admin('/rest/v1/usage_buckets', 'POST', {
    user_id: owner.id,
    scope: 'account',
    period_start: period,
    allocated_ceiling_usd: '1',
  });
  context = await verifySession({
    headers: { authorization: `Bearer ${owner.token}` },
  });
  source = randomUUID();
  await db.admin('/rest/v1/data_sources', 'POST', {
    id: source,
    user_id: owner.id,
    kind: 'manual',
    label: 'Synthetic v020 source',
    source_namespace: randomUUID(),
  });
});
afterEach(async () => {
  if (server) {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  try {
    await db.cleanup();
    await db.admin(`/rest/v1/usage_buckets?id=eq.${app}`, 'DELETE');
  } finally {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  }
});

it('retains exact analysis identities across the real Ask stream, saved cards and encrypted inspection', async () => {
  for (const [day, weight, muscle] of [
    [1, 72, 50],
    [2, 70, 52],
    [3, 74, 54],
  ])
    for (const [metric, value, method] of [
      ['weight', weight, 'device_reported'],
      ['renpho.muscle_mass', muscle, 'device_estimate'],
    ] as const)
      await addMeasurement(context, {
        action: 'add_measurement',
        client_request_id: randomUUID(),
        source: { kind: 'existing', id: source },
        observation: {
          metric,
          value: String(value),
          unit: 'kg',
          observed_at: `2026-09-0${day}T12:00:00Z`,
          timezone: 'UTC',
          local_date: null,
          granularity: 'instant',
          method,
          quality_flags: [],
        },
      });
  const transport = new ScriptedTransport('analyze_measurements', {
    operation: 'observed_day_mean',
    metrics: ['weight', 'renpho.muscle_mass'],
    source_id: source,
    from: '2026-09-01',
    to: '2026-10-01',
  });
  const result = await send(transport);
  expect(transport.requests).toHaveLength(2);
  expect(transport.requests.every((body) => body.length <= 12000)).toBe(true);
  const cards = result.events.flatMap((event) =>
    event.type === 'card.ready' && event.payload.card.type === 'analysis_result'
      ? [event.payload.card]
      : [],
  );
  expect(cards).toHaveLength(2);
  for (const card of cards) {
    expect(card.result.id).toBe(card.result.evidence.resultId);
    expect(card.result.kind).toBe('series_analysis');
    if (card.result.kind === 'series_analysis') {
      expect(card.result.current.value).toBe(
        card.result.series.metric === 'weight' ? '72' : '52',
      );
      expect(card.result.current.observedDays).toBe(3);
    }
  }
  const messages = MessagesPageSchema.parse(
    await new ConversationService(context).read({
      view: 'messages',
      id: result.conversation,
      page_size: 100,
    }),
  );
  const parts = messages.items
    .flatMap((message) => message.parts)
    .filter((part) => part.type === 'analysis_result');
  expect(parts.map((part) => part.result.id)).toEqual(
    cards.map((card) => card.result.id),
  );
  const inspection = new InspectionService(context);
  const step = (await inspection.steps(result.run)).find(
    (item) => item.tool_name === 'analyze_measurements',
  );
  expect(step).toBeDefined();
  const evidence = await inspection.evidence({
    view: 'payload',
    run: result.run,
    step: step!.id,
    part: 'output',
  });
  expect(evidence.state).toBe('available');
  if (evidence.state !== 'available')
    throw new Error('Missing actual tool trace.');
  const trace = JSON.parse(evidence.bytes.toString());
  expect(trace.projectionVersion).toBe(5);
  expect(
    trace.result.data.results.map((item: { id: string }) => item.id),
  ).toEqual(cards.map((card) => card.result.id));
  expect((await rows('action_proposals')).length).toBe(0);
});

const goal = (metric = 'weight', target = 70) => ({
  title: 'Synthetic v020 member ' + metric,
  metric,
  source_id: source,
  method: metric === 'weight' ? 'device_reported' : 'device_estimate',
  granularity: 'instant',
  target: { direction: 'decrease_to', value: target },
  baseline_method: 'user_reported',
  reported_baseline: metric === 'weight' ? 80 : 30,
});

it('atomically checkpoints one pending group card, then activates only its exact reviewed terms once', async () => {
  const transport = new ScriptedTransport('prepare_goals', {
    group: { name: 'Synthetic v020 chat group' },
    members: [
      { kind: 'create', definition: goal() },
      { kind: 'create', definition: goal('body_fat_percent', 25) },
    ],
  });
  const result = await send(transport);
  expect(transport.requests).toHaveLength(2);
  expect(await rows('goals')).toHaveLength(0);
  expect(await rows('goal_groups')).toHaveLength(0);
  const proposals = await rows('action_proposals');
  expect(proposals).toHaveLength(1);
  const proposal = proposals[0]!;
  expect(proposal.source_run_id).toBe(result.run);
  expect(proposal.state).toBe('pending');
  const cards = result.events.flatMap((event) =>
    event.type === 'card.ready' &&
    event.payload.card.type === 'goal_group_proposal'
      ? [event.payload.card]
      : [],
  );
  expect(cards).toHaveLength(1);
  expect(cards[0]!.reference.proposalId).toBe(proposal.id);
  expect(cards[0]!.reference.payloadHash).toBe(proposal.payload_hash);
  const request = {
    action: 'approve',
    proposal_id: proposal.id,
    payload_hash: proposal.payload_hash,
    expected_version: null,
    client_request_id: randomUUID(),
  };
  const approved = await post('/api/approvals', request);
  expect(approved.status).toBe(200);
  const receipt = await approved.json();
  const replay = await post('/api/approvals', request);
  expect(replay.status).toBe(200);
  expect((await replay.json()).data).toEqual(receipt.data);
  expect(await rows('goals')).toHaveLength(2);
  expect(await rows('goal_revisions')).toHaveLength(2);
  expect(await rows('goal_group_members')).toHaveLength(2);
  const messages = MessagesPageSchema.parse(
    await new ConversationService(context).read({
      view: 'messages',
      id: result.conversation,
      page_size: 100,
    }),
  );
  expect(
    messages.items
      .flatMap((message) => message.parts)
      .filter((part) => part.type === 'goal_group_proposal'),
  ).toHaveLength(1);
});

it('rejects unsafe targets in every member without registering a partial proposal', async () => {
  const transport = new ScriptedTransport('prepare_goals', {
    group: { name: 'Synthetic unsafe group' },
    members: [
      { kind: 'create', definition: goal() },
      { kind: 'create', definition: goal('body_fat_percent', 2) },
    ],
  });
  const result = await send(transport);
  expect(result.events.some((event) => event.type === 'card.ready')).toBe(
    false,
  );
  expect(await rows('action_proposals')).toHaveLength(0);
  expect(await rows('goals')).toHaveLength(0);
  expect(transport.requests[1]!.toString()).toContain('tool_error');
});

it('denies a group checkpoint after cancellation without leaving proposal or card effects', async () => {
  const conversation = randomUUID();
  await new ConversationService(context).mutate({
    action: 'create',
    id: conversation,
    client_request_id: randomUUID(),
  });
  const ledger = new ExecutionService(context, { maxRunCostUSD: '0.25' });
  const admitted = await ledger.admit(
    {
      conversationId: conversation,
      clientRequestId: randomUUID(),
      requestHash: 'a'.repeat(64),
      depth: 'auto',
      route: {
        role: 'everyday',
        provider: 'openrouter',
        model: 'openai/gpt-6-luna',
        effort: 'low',
      },
      consentVersion: 'openrouter_zdr_v2',
    },
    { id: randomUUID(), text: 'Prepare synthetic group.' },
  );
  if (!admitted.lease) throw new Error('No lease.');
  const args = {
    group: { name: 'Synthetic cancelled group' },
    members: [{ kind: 'create', definition: goal() }],
  };
  const step = await ledger.prepare(admitted.lease, {
    type: 'tool',
    toolName: 'prepare_goals',
    adapterVersion: 'vulpes-tools-v3',
    body: Buffer.from(
      JSON.stringify({
        name: 'prepare_goals',
        arguments: args,
        callId: 'cancelled',
      }),
    ),
    metadata: { endpoint: 'tool:proposal', headers: {}, redactedHeaders: [] },
  });
  const output = await prepareGoalTool(context, 'prepare_goals', args, step.id);
  await ledger.cancelWithReceipt(step.lease.runId, randomUUID());
  await expect(
    ledger.checkpointGoal(step, output, { synthetic: true }),
  ).rejects.toBeDefined();
  expect(await rows('action_proposals')).toHaveLength(0);
  expect(
    (await rows('messages')).flatMap(
      (message) => message.content_parts as unknown[],
    ),
  ).toHaveLength(1);
});

async function importPanel(file: string, existing?: string) {
  const preview = ImportPreviewV2Schema.parse(
    await previewCsv(
      context,
      PreviewCsvWireSchema.parse({
        action: 'preview_csv',
        schema_version: 2,
        client_request_id: randomUUID(),
        csv_base64: readFileSync(
          'docs/spec/v0.2.0/fixtures/renpho-v1/' + file,
        ).toString('base64'),
        source: existing
          ? { kind: 'existing', id: existing }
          : {
              kind: 'new',
              label: 'Synthetic Ask panel',
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
      }),
    ),
  );
  await commitImport(context, {
    action: 'commit_import',
    schema_version: 2,
    batch_id: preview.batch_id,
    payload_hash: preview.payload_hash,
    client_request_id: randomUUID(),
  });
  return preview.source_id;
}

it.each(['complete', 'incomplete'])(
  'fits a real imported %s panel in two provider requests without filling missing fields',
  async (kind) => {
    source = await importPanel('full-panel.csv');
    if (kind === 'incomplete') await importPanel('weight-only.csv', source);
    const transport = new ScriptedTransport('analyze_measurements', {
      operation: 'latest_event',
      source_id: source,
    });
    const { events } = await send(
      transport,
      'Show only the latest actual panel, with its measurement date.',
    );
    expect(transport.requests).toHaveLength(2);
    expect(transport.requests.every((bytes) => bytes.length <= 12000)).toBe(
      true,
    );
    const card = events.find(
      (event) =>
        event.type === 'card.ready' &&
        event.payload.card.type === 'analysis_result',
    );
    if (
      card?.type !== 'card.ready' ||
      card.payload.card.type !== 'analysis_result' ||
      card.payload.card.result.kind !== 'event_analysis'
    )
      throw new Error('Missing real event card.');
    const result = card.payload.card.result;
    expect(result.status).toBe('available');
    expect(result.event?.observations).toHaveLength(
      kind === 'complete' ? 24 : 1,
    );
    if (kind === 'incomplete')
      expect(
        result.event?.observations.map((reading) => reading.metric),
      ).toEqual(['weight']);
  },
);

it('invalidates group cards and the whole follow-up history after an independent child change without a measurement revision', async () => {
  const service = new GoalGroupService(context);
  const proposed = await service.propose(
    GoalGroupMutationSchema.parse({
      action: 'propose_group_create',
      client_request_id: randomUUID(),
      name: 'Synthetic progress context',
      members: [
        {
          kind: 'create',
          definition: {
            schemaVersion: 1,
            title: 'Synthetic owned child',
            metric: 'weight',
            unit: 'kg',
            sourceId: source,
            method: 'device_reported',
            granularity: 'instant',
            target: { direction: 'decrease_to', value: 70 },
            baselineMethod: 'user_reported',
            currentMethod: 'latest_value',
            reportedBaseline: 80,
            baselineFrom: null,
            baselineTo: null,
            timezone: 'UTC',
            targetDate: null,
            constraints: [],
            proposedStrategy: null,
          },
        },
      ],
    }),
  );
  const approved = await service.decide(
    ApprovalRequestSchema.parse({
      action: 'approve',
      proposal_id: proposed.id,
      payload_hash: proposed.payload_hash,
      expected_version: null,
      client_request_id: randomUUID(),
    }),
  );
  if (approved.outcome !== 'approved')
    throw new Error('Missing group approval.');
  const transport = new ScriptedTransport('get_goal_progress', {
    group_id: approved.groupId,
  });
  const result = await send(transport);
  expect(
    result.events.some(
      (event) =>
        event.type === 'card.ready' &&
        event.payload.card.type === 'goal_group_progress',
    ),
  ).toBe(true);
  const goals = new GoalService(context);
  const child = await goals.owned(approved.members[0]!.goalId);
  const revision = await goals.propose({
    action: 'propose_state',
    client_request_id: randomUUID(),
    goal_id: child.id,
    expected_version: child.version,
    state: 'paused',
  });
  await goals.decide(
    ApprovalRequestSchema.parse({
      action: 'approve',
      proposal_id: revision.id,
      payload_hash: revision.payload_hash,
      expected_version: revision.target_version,
      client_request_id: randomUUID(),
    }),
  );
  const page = MessagesPageSchema.parse(
    await new ConversationService(context).read({
      view: 'messages',
      id: result.conversation,
      page_size: 100,
    }),
  );
  expect(
    page.items
      .flatMap((message) => message.parts)
      .some((part) => part.type === 'goal_group_progress'),
  ).toBe(false);
  const response = await post(
    '/api/chat',
    ChatSendRequestSchema.parse({
      action: 'send',
      conversation_id: result.conversation,
      client_request_id: randomUUID(),
      message: {
        id: randomUUID(),
        text: 'What changed from that group progress?',
      },
      depth: 'auto',
    }),
  );
  const decoder = new StreamDecoder();
  const events = [];
  for await (const bytes of response.body!) events.push(...decoder.push(bytes));
  expect(events.at(-1)?.type).toBe('run.completed');
  const steps = await new InspectionService(context).steps(events[0]!.run_id);
  const generation = steps.find((step) => step.step_type === 'generation')!;
  const capture = await new InspectionService(context).evidence({
    view: 'payload',
    run: events[0]!.run_id,
    step: generation.id,
    part: 'context',
  });
  expect(capture.state).toBe('available');
  if (capture.state === 'available')
    expect(JSON.parse(capture.bytes.toString()).excluded).toContainEqual({
      referenceId: result.run,
      reason: 'evidence_changed_or_unverifiable',
    });
});

it.each([
  ['analyze_measurements', false],
  ['explain_metrics', false],
  ['analyze_measurements', true],
  ['explain_metrics', true],
] as const)(
  'retains readable exact %s empty or ambiguous series evidence (ambiguous=%s)',
  async (tool, ambiguous) => {
    if (ambiguous) {
      const other = randomUUID();
      await db.admin('/rest/v1/data_sources', 'POST', {
        id: other,
        user_id: owner.id,
        kind: 'manual',
        label: 'Synthetic alternate series',
        source_namespace: randomUUID(),
      });
      for (const sourceId of [source, other])
        await addMeasurement(context, {
          action: 'add_measurement',
          client_request_id: randomUUID(),
          source: { kind: 'existing', id: sourceId },
          observation: {
            metric: 'weight',
            value: '70',
            unit: 'kg',
            observed_at: '2026-09-02T12:00:00Z',
            timezone: 'UTC',
            local_date: null,
            granularity: 'instant',
            method: 'device_reported',
            quality_flags: [],
          },
        });
    }
    const transport = new ScriptedTransport(
      tool,
      tool === 'analyze_measurements'
        ? {
            operation: 'observed_day_mean',
            metrics: ['weight'],
            from: '2026-09-01',
            to: '2026-10-01',
          }
        : { metrics: ['weight'], include_reference: true },
    );
    const result = await send(transport);
    const inspector = new InspectionService(context);
    const step = (await inspector.steps(result.run)).find(
      (item) => item.tool_name === tool,
    )!;
    const capture = await inspector.evidence({
      view: 'payload',
      run: result.run,
      step: step.id,
      part: 'output',
    });
    expect(capture.state).toBe('available');
    if (capture.state !== 'available')
      throw new Error('Missing clarification evidence');
    expect(JSON.parse(capture.bytes.toString()).result.kind).toBe(
      ambiguous ? 'clarification_required' : 'no_data',
    );
  },
);

it('fits four dated goal calculations with repeating percentages while retaining exact encrypted values', async () => {
  await addMeasurement(context, {
    action: 'add_measurement',
    client_request_id: randomUUID(),
    source: { kind: 'existing', id: source },
    observation: {
      metric: 'weight',
      value: '69.7',
      unit: 'kg',
      observed_at: '2026-09-02T12:00:00Z',
      timezone: 'UTC',
      local_date: null,
      granularity: 'instant',
      method: 'device_reported',
      quality_flags: [],
    },
  });
  const service = new GoalGroupService(context);
  const proposed = await service.propose(
    GoalGroupMutationSchema.parse({
      action: 'propose_group_create',
      client_request_id: randomUUID(),
      name: 'Synthetic four-member calculations',
      members: Array.from({ length: 4 }, (_, index) => ({
        kind: 'create',
        definition: {
          schemaVersion: 1,
          title: 'Synthetic member ' + index,
          metric: 'weight',
          unit: 'kg',
          sourceId: source,
          method: 'device_reported',
          granularity: 'instant',
          target: { direction: 'decrease_to', value: 65 + index },
          baselineMethod: 'user_reported',
          currentMethod: 'latest_value',
          reportedBaseline: 70,
          baselineFrom: null,
          baselineTo: null,
          timezone: 'UTC',
          targetDate: null,
          constraints: [],
          proposedStrategy: null,
        },
      })),
    }),
  );
  const approved = await service.decide(
    ApprovalRequestSchema.parse({
      action: 'approve',
      proposal_id: proposed.id,
      payload_hash: proposed.payload_hash,
      expected_version: null,
      client_request_id: randomUUID(),
    }),
  );
  if (approved.outcome !== 'approved') throw new Error('Missing approval.');
  const transport = new ScriptedTransport('get_goal_progress', {
    group_id: approved.groupId,
  });
  const result = await send(transport, 'Read the selected group progress.', {
    groupId: approved.groupId,
  });
  expect(transport.requests).toHaveLength(2);
  expect(transport.requests.every((body) => body.length <= 12000)).toBe(true);
  const inspector = new InspectionService(context);
  const step = (await inspector.steps(result.run)).find(
    (item) => item.tool_name === 'get_goal_progress',
  )!;
  const capture = await inspector.evidence({
    view: 'payload',
    run: result.run,
    step: step.id,
    part: 'output',
  });
  expect(capture.state).toBe('available');
  if (capture.state !== 'available') throw new Error('Missing trace.');
  const trace = JSON.parse(capture.bytes.toString());
  expect(trace.result.members).toHaveLength(4);
  expect(
    trace.result.members[0].progress.relativeChangePercent.length,
  ).toBeGreaterThan(1000);
  expect(
    trace.providerResult.members[0].progress.relativeChangePercent.length,
  ).toBeLessThan(32);
  expect(trace.providerResult.numericalPrecision.significantDigits).toBe(12);
});

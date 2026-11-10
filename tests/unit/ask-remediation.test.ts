import { afterEach, describe, expect, it, vi } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import type { AuthContext } from '../../server/auth/session.js';
import { buildContext } from '../../server/ai/context.js';
import {
  executeReadTool,
  prepareGoalTool,
  toolArguments,
  ToolErrorResultSchema,
} from '../../server/ai/tools.js';
import { baselineSafety } from '../../server/ai/prompts/everyday.js';
import { ChatSendRequestSchema } from '../../shared/api.js';
import { chatSend, goalDraft, otherId } from '../fixtures/contracts.js';
import { readData } from '../../server/services/measurements.js';
import {
  VulpesAgent,
  type AgentDependencies,
} from '../../server/ai/VulpesAgent.js';
import { OpenRouterResponsesAdapter } from '../../server/ai/providers/openrouter.js';
import { models } from '../../server/config/models.js';
import type {
  PreparedStep,
  RunLease,
  StepInput,
} from '../../server/ai/ledger/execution.js';
import type { RunSummary } from '../../shared/executions.js';
import { responseFrame, assistantOutput } from '../fixtures/chat.js';
import { HttpFailure } from '../../server/http/failure.js';
import { normalizeObservation } from '../../server/analytics/measurements.js';
import { getRoleAvailability } from '../../server/config/models.js';
import { everydayProductionEvidence } from '../../server/config/everyday-production.js';
import { everydayTemplateVersion } from '../../server/config/everyday-versions.js';
import { everydayCapabilityEvidence } from '../../server/config/everyday-verification.js';
import {
  assessEverydayPreflight,
  LiveSmokeEvidenceSchema,
} from '../../server/ai/live-preflight.js';
import { GoalService } from '../../server/services/goals.js';
import { GoalDefinitionSchema } from '../../shared/goals.js';

vi.mock('../../server/db/administrative.js', () => ({
  administrativeClient: () => ({}),
}));

vi.mock('../../server/services/measurements.js', async (original) => {
  const actual =
    await original<typeof import('../../server/services/measurements.js')>();
  return { ...actual, readData: vi.fn(actual.readData) };
});

function context(timezone = 'America/New_York'): AuthContext {
  const result = (table: string) => ({
    data:
      table === 'profiles'
        ? { timezone, units: {}, data_revision: 1 }
        : table === 'data_sources'
          ? { id: otherId }
          : [],
    error: null,
  });
  return {
    userId: otherId,
    db: {
      from(table: string) {
        const query = {
          select: () => query,
          eq: () => query,
          neq: () => query,
          not: () => query,
          order: () => query,
          limit: () => query,
          single: async () => result(table),
          maybeSingle: async () => result(table),
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve(result(table)).then(resolve),
        };
        return query;
      },
      rpc: async (name: string) =>
        name === 'read_data_v1'
          ? {
              data: {
                revision: 1,
                timezone,
                sources: [],
                rows: Array.from({ length: 7 }, (_, i) => ({
                  ...normalizeObservation({
                    metric: 'weight',
                    value: String(70 - i),
                    unit: 'kg',
                    observed_at: Temporal.PlainDate.from('2026-10-28')
                      .add({ days: i })
                      .toZonedDateTime({
                        timeZone: timezone,
                        plainTime: '23:30',
                      })
                      .toInstant()
                      .toString(),
                    timezone,
                    local_date: null,
                    granularity: 'instant',
                    method: 'device_reported',
                    quality_flags: [],
                  }),
                  id: `11111111-1111-4111-8111-${String(i).padStart(12, '0')}`,
                  source_id: otherId,
                  external_record_id: null,
                  version: 1,
                })),
              },
              error: null,
            }
          : {
              data: {
                dataRevision: 1,
                items: [
                  {
                    metric: 'weight',
                    source_id: otherId,
                    source_label: 'Synthetic scale',
                    method: 'device_reported',
                    granularity: 'instant',
                    observations: 7,
                    first_at: '2026-10-28T12:00:00Z',
                    last_at: '2026-11-03T12:00:00Z',
                  },
                ],
              },
              error: null,
            },
    } as unknown as AuthContext['db'],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(readData).mockClear();
});

describe('Ask server temporal grounding', () => {
  it('captures one current instant and the profile local date, with manifest evidence', async () => {
    vi.spyOn(Temporal.Now, 'instant').mockReturnValue(
      Temporal.Instant.from('2026-11-04T02:30:00Z'),
    );
    const built = await buildContext(
      context(),
      ChatSendRequestSchema.parse(chatSend),
      otherId,
      [],
      12000,
    );
    const profile = built.request.turns.find(
      (turn) =>
        turn.type === 'message' &&
        turn.role === 'system' &&
        turn.text.startsWith('{'),
    );
    expect(profile).toBeDefined();
    expect(JSON.parse((profile as { text: string }).text).clock).toEqual({
      instant: '2026-11-04T02:30:00Z',
      localDate: '2026-11-03',
      timezone: 'America/New_York',
    });
    expect(
      built.manifest.included.some(
        (item) => item.reference.id === 'clock:current',
      ),
    ).toBe(true);
  });

  it('accepts local dates and resolves each DST-crossing boundary in the owned profile timezone', async () => {
    await executeReadTool(context(), 'get_measurements', {
      metric: 'weight',
      from: '2026-10-28',
      to: '2026-11-04',
      timezone: 'America/New_York',
    });
    expect(readData).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        from: '2026-10-28T04:00:00Z',
        to: '2026-11-04T05:00:00Z',
        timezone: 'America/New_York',
      }),
    );
  });

  it('rejects substituting UTC even when UTC midnights would otherwise pass', async () => {
    await expect(
      executeReadTool(context(), 'get_measurements', {
        metric: 'weight',
        from: '2026-10-28T00:00:00Z',
        to: '2026-11-04T00:00:00Z',
        timezone: 'UTC',
      }),
    ).rejects.toMatchObject({ code: 'timezone_mismatch' });
  });
  it.each([
    [
      '2026-03-05',
      '2026-03-12',
      '2026-03-05T05:00:00Z',
      '2026-03-12T04:00:00Z',
    ],
    [
      '2026-10-28',
      '2026-11-04',
      '2026-10-28T04:00:00Z',
      '2026-11-04T05:00:00Z',
    ],
  ])(
    'resolves DST independently for %s through %s',
    async (from, to, expectedFrom, expectedTo) => {
      await executeReadTool(context(), 'get_measurements', {
        metric: 'weight',
        from,
        to,
        timezone: 'America/New_York',
      });
      expect(readData).toHaveBeenLastCalledWith(
        expect.anything(),
        expect.objectContaining({ from: expectedFrom, to: expectedTo }),
      );
    },
  );
  it.each([
    ['2026-10-28T00:00:00Z', '2026-11-04T00:00:00Z'],
    ['2026-10-28T00:00:00-04:00', '2026-11-04T00:00:00-04:00'],
    ['2026-11-04', '2026-10-28'],
    ['2026-11-04', '2026-11-04'],
    ['2025-01-01', '2026-11-04'],
  ])(
    'rejects non-midnight, fixed-offset, reversed, empty or excessive interval %s to %s',
    async (from, to) => {
      await expect(
        executeReadTool(context(), 'summarize_metric', {
          metric: 'weight',
          from,
          to,
          timezone: 'America/New_York',
        }),
      ).rejects.toMatchObject({ code: 'invalid_interval' });
      expect(readData).not.toHaveBeenCalled();
    },
  );
  it('does not silently move a nonexistent local date to the next day', async () => {
    await expect(
      executeReadTool(context('Pacific/Apia'), 'summarize_metric', {
        metric: 'weight',
        from: '2011-12-30',
        to: '2012-01-02',
        timezone: 'Pacific/Apia',
      }),
    ).rejects.toMatchObject({ code: 'invalid_interval' });
  });
  it('keeps unusual numeric requests distinct from hard representation failures', () => {
    const definition = {
      ...goalDraft,
      method: 'device_estimate',
      granularity: 'instant',
      currentMethod: 'daily_median_mean_7d',
      metric: 'body_fat_percent',
      unit: '%',
    };
    for (const value of [-1, 101, Infinity, NaN])
      expect(
        toolArguments.propose_goal.safeParse({
          definition: {
            ...definition,
            target: { direction: 'decrease_to', value },
          },
        }).success,
      ).toBe(false);
    expect(
      toolArguments.propose_goal.safeParse({
        definition: {
          ...definition,
          target: { direction: 'decrease_to', value: 2 },
        },
      }).success,
    ).toBe(true);
  });
  it('keeps v9 approval historical, blocks the changed v10 template and rejects stale smoke evidence', () => {
    expect(everydayTemplateVersion).toBe('vulpes-everyday-v10');
    expect(everydayProductionEvidence?.templateVersion).toBe(
      'vulpes-everyday-v9',
    );
    expect(everydayProductionEvidence?.assessment).toMatchObject({
      scope: 'technical_controls',
      modelQuality: 'deferred_by_owner',
    });
    expect(getRoleAvailability('everyday', true)).toEqual({
      state: 'unavailable',
      reason: 'capability_evidence_mismatch',
    });
    expect(
      assessEverydayPreflight({
        enabled: true,
        mode: 'production',
        model: models.everyday.modelId,
        effort: models.everyday.reasoning.effort,
        adapterVersion: 'openrouter-responses-v2',
        templateVersion: everydayTemplateVersion,
        maxInputTokens: models.everyday.maxInputTokens,
        maxOutputTokens: models.everyday.maxOutputTokens,
        price: models.everyday.price,
        capabilities: {
          ...everydayCapabilityEvidence,
          templateVersion: everydayTemplateVersion,
        },
        smoke: {
          ...LiveSmokeEvidenceSchema.strip().parse(everydayProductionEvidence),
          templateVersion: 'vulpes-everyday-v7',
        },
        maxCostUSD: '0.04',
      }),
    ).toEqual({ state: 'unavailable', reason: 'live_smoke_mismatch' });
  });
});

describe('contextual safety', () => {
  it.each([
    "I can't breathe well when running",
    'I was diagnosed with asthma; summarize my weight',
    'I am starving after the gym',
  ])('allows benign context to reach the bounded assistant: %s', (text) => {
    expect(baselineSafety(text)).toBeNull();
  });
  it.each([
    'I have severe chest pain',
    "I can't breathe right now",
    "I can't breathe well right now",
    "I can't breathe well when running and I have severe chest pain",
    'I want to kill myself',
  ])('retains urgent guidance: %s', (text) => {
    expect(baselineSafety(text)).toContain('emergency');
  });
  it.each([
    'Can you diagnose me?',
    'I want to stop my medication',
    'Help me starve myself',
  ])('retains treatment and unsafe-action boundaries: %s', (text) => {
    expect(baselineSafety(text)).toContain('cannot diagnose');
  });
});

const functionCall = (id: number, name: string, args: unknown) => ({
  type: 'function_call',
  id: `i${id}`,
  call_id: `c${id}`,
  name,
  arguments: JSON.stringify(args),
});

function scenario(
  frames: Buffer[],
  transport?: AgentDependencies['transport'],
) {
  const bodies: { input: Record<string, unknown>[]; tools: unknown[] }[] = [];
  const agent = new VulpesAgent(context(), {
    adapter: new OpenRouterResponsesAdapter(),
    transport: {
      mode: 'mock',
      async *send(body, signal) {
        bodies.push(JSON.parse(Buffer.from(body).toString()));
        if (transport) yield* transport.send(body, signal);
        else yield frames.shift()!;
      },
    },
    price: models.everyday.price!,
    maxRunCostUSD: '0.04',
  });
  const lease: RunLease = {
    runId: otherId,
    executor: otherId,
    fence: 1,
    deadlineAt: new Date(Date.now() + 60000).toISOString(),
  };
  const initial = {
    state: 'running',
    assistantMessageId: otherId,
    costUSD: '0',
    costStatus: 'reported',
    reservationUSD: '0',
    knownCostUSD: '0',
  } as unknown as RunSummary;
  const checkpoints: { result: unknown }[] = [];
  const ledger = agent.ledger;
  vi.spyOn(ledger, 'prepare').mockImplementation(
    async (_lease, input: StepInput) =>
      ({
        id: crypto.randomUUID(),
        lease,
        body: input.body,
        bodyHash: '',
        price: input.price ?? null,
        type: input.type,
      }) as PreparedStep,
  );
  vi.spyOn(ledger, 'authorize').mockResolvedValue(undefined);
  vi.spyOn(ledger, 'heartbeat').mockResolvedValue(initial);
  vi.spyOn(ledger, 'checkpoint').mockImplementation(async (step, bytes) => {
    if (step.type === 'tool')
      checkpoints.push(JSON.parse(Buffer.from(bytes).toString()));
    return otherId;
  });
  vi.spyOn(ledger, 'checkpointGoal').mockRejectedValue(
    new Error('unexpected_proposal_write'),
  );
  vi.spyOn(ledger, 'checkpointMessage').mockResolvedValue(undefined);
  vi.spyOn(ledger, 'saveState').mockResolvedValue(otherId);
  vi.spyOn(ledger, 'settle').mockResolvedValue(initial);
  vi.spyOn(ledger, 'finish').mockImplementation(async (_lease, state) => ({
    ...initial,
    state,
  }));
  vi.spyOn(ledger, 'usageTotals').mockResolvedValue({} as never);
  const controller = new AbortController();
  return {
    ledger,
    bodies,
    checkpoints,
    controller,
    async collect(text = chatSend.message.text) {
      const events = [];
      for await (const event of agent.run(
        ChatSendRequestSchema.parse({
          ...chatSend,
          message: { ...chatSend.message, text },
        }),
        lease,
        initial,
        null,
        controller.signal,
      )) {
        if (event.type === 'tool.result') {
          if (vi.mocked(ledger.checkpointGoal).mock.calls.length)
            expect(ledger.checkpointGoal).toHaveBeenCalled();
          else {
            expect(checkpoints.length).toBeGreaterThan(0);
            expect(ledger.settle).toHaveBeenCalledWith(
              expect.objectContaining({ type: 'tool' }),
              null,
              'completed',
            );
          }
        }
        if (
          event.type === 'card.ready' &&
          event.payload.card.type === 'goal_proposal'
        )
          expect(ledger.checkpointGoal).toHaveBeenCalled();
        if (
          event.type === 'card.ready' &&
          event.payload.card.type === 'metric_trend'
        )
          expect(ledger.checkpointMessage).toHaveBeenCalled();
        events.push(event);
      }
      return events;
    },
  };
}

describe('bounded production orchestrator with synthetic persistence and transport', () => {
  it.each([
    { direction: 'decrease_to', value: 2 },
    { direction: 'increase_to', value: 1 },
    { direction: 'maintain_range', lower: 2, upper: 3 },
  ])(
    'persists a cautious refusal for an AI body-fat target %j without creating a proposal',
    async (target) => {
      const definition = {
        ...goalDraft,
        metric: 'body_fat_percent',
        unit: '%',
        method: 'device_estimate',
        granularity: 'instant',
        currentMethod: 'daily_median_mean_7d',
        timezone: 'America/New_York',
        target,
      };
      const prepare = vi.spyOn(GoalService.prototype, 'prepareProposal');
      const run = scenario([
        responseFrame([functionCall(1, 'propose_goal', { definition })]),
        responseFrame([
          assistantOutput(
            'Please discuss an appropriate target with a qualified clinician.',
          ),
        ]),
      ]);
      const events = await run.collect();
      expect(events.at(-1)).toMatchObject({ type: 'run.completed' });
      expect(prepare).not.toHaveBeenCalled();
      expect(run.ledger.checkpointGoal).not.toHaveBeenCalled();
      expect(events.some((e) => e.type === 'card.ready')).toBe(false);
      const output = run.bodies[1]!.input.find(
        (item) => item.type === 'function_call_output',
      );
      expect(JSON.parse(String(output?.output)).result).toMatchObject({
        kind: 'tool_error',
        code: 'unsafe_goal_target',
        recoverable: true,
      });
      expect(JSON.parse(String(output?.output)).result.hint).toContain(
        'Higher targets are not necessarily safe',
      );
    },
  );
  it('checks the full merged target when AI revises an owned goal', async () => {
    const definition = GoalDefinitionSchema.parse({
      ...goalDraft,
      metric: 'body_fat_percent',
      unit: '%',
      method: 'device_estimate',
      granularity: 'instant',
      currentMethod: 'latest_value',
      baselineMethod: 'user_reported',
      reportedBaseline: 20,
      baselineFrom: null,
      baselineTo: null,
      timezone: 'America/New_York',
      target: { direction: 'decrease_to', value: 10 },
    });
    vi.spyOn(GoalService.prototype, 'revision').mockResolvedValue({
      revision: {
        payload: {
          schemaVersion: 2,
          definition,
          state: 'active',
          baselineResolution: 'replace',
          reviewedDataRevision: 1,
          baseline: {
            schemaVersion: 2,
            selection: {
              metric: 'body_fat_percent',
              source_id: otherId,
              method: 'device_estimate',
              granularity: 'instant',
              timezone: 'America/New_York',
              from: '2026-10-28T04:00:00Z',
              to: '2026-11-04T05:00:00Z',
            },
            value: '20',
            dataRevision: 1,
            algorithmVersion: 'user_reported_v1',
            provenance: 'user_reported',
            references: [],
          },
        },
      },
    } as never);
    const prepare = vi.spyOn(GoalService.prototype, 'prepareProposal');
    await expect(
      prepareGoalTool(
        context(),
        'propose_goal_revision',
        {
          goal_id: otherId,
          expected_version: 1,
          changes: { target: { direction: 'decrease_to', value: 2 } },
          baseline_resolution: 'retain',
          rationale: 'Synthetic target change',
        },
        otherId,
      ),
    ).rejects.toMatchObject({ code: 'unsafe_goal_target' });
    expect(prepare).not.toHaveBeenCalled();
  });
  it.each([
    {
      metric: 'body_fat_percent',
      unit: '%',
      target: { direction: 'decrease_to', value: 2.001 },
    },
    {
      metric: 'body_fat_percent',
      unit: '%',
      target: { direction: 'maintain_range', lower: 2.001, upper: 3 },
    },
    {
      metric: 'weight',
      unit: 'kg',
      target: { direction: 'decrease_to', value: 2 },
    },
  ])(
    'keeps the narrow numeric rule separate from ordinary proposal validation %j',
    async (fields) => {
      const prepare = vi
        .spyOn(GoalService.prototype, 'prepareProposal')
        .mockRejectedValue(new Error('ordinary_proposal_validation_reached'));
      await expect(
        prepareGoalTool(
          context(),
          'propose_goal',
          {
            definition: {
              ...goalDraft,
              ...fields,
              method: 'device_estimate',
              granularity: 'instant',
              currentMethod: 'daily_median_mean_7d',
              timezone: 'America/New_York',
            },
          },
          otherId,
        ),
      ).rejects.toThrow('ordinary_proposal_validation_reached');
      expect(prepare).toHaveBeenCalledOnce();
    },
  );
  it('preserves the atomic pending-proposal checkpoint before emitting its review card', async () => {
    const definition = GoalDefinitionSchema.parse({
      ...goalDraft,
      timezone: 'America/New_York',
      baselineMethod: 'user_reported',
      reportedBaseline: 70,
      baselineFrom: null,
      baselineTo: null,
      method: 'device_reported',
      granularity: 'instant',
      currentMethod: 'latest_value',
    });
    const payload = {
      schemaVersion: 2 as const,
      definition,
      state: 'active' as const,
      baselineResolution: 'replace' as const,
      reviewedDataRevision: 1,
      baseline: {
        schemaVersion: 2 as const,
        selection: {
          metric: definition.metric,
          source_id: definition.sourceId,
          method: definition.method,
          granularity: definition.granularity,
          timezone: definition.timezone,
          from: '2026-10-28T04:00:00Z',
          to: '2026-11-04T05:00:00Z',
        },
        value: '70',
        dataRevision: 1,
        algorithmVersion: 'user_reported_v1',
        provenance: 'user_reported' as const,
        references: [],
      },
    };
    const prepare = vi
      .spyOn(GoalService.prototype, 'prepareProposal')
      .mockResolvedValue(payload);
    const run = scenario([
      responseFrame([functionCall(1, 'propose_goal', { definition })]),
      responseFrame([assistantOutput('Review the pending card to confirm.')]),
    ]);
    vi.mocked(run.ledger.checkpointGoal).mockResolvedValue({
      reference: {
        version: 1,
        proposalId: otherId,
        payloadHash: 'a'.repeat(64),
        expectedVersion: null,
      },
      parts: [],
    });
    const events = await run.collect();
    expect(events.at(-1)).toMatchObject({ type: 'run.completed' });
    expect(prepare).toHaveBeenCalledOnce();
    expect(run.ledger.checkpointGoal).toHaveBeenCalledOnce();
    expect(
      events.some(
        (event) =>
          event.type === 'card.ready' &&
          event.payload.card.type === 'goal_proposal',
      ),
    ).toBe(true);
    const output = run.bodies[1]!.input.find(
      (item) => item.type === 'function_call_output',
    );
    expect(JSON.parse(String(output?.output)).result).toMatchObject({
      kind: 'goal_proposal',
      status: 'pending',
      requiresUserConfirmation: true,
    });
  });

  it('withholds cards when the message checkpoint fails', async () => {
    const run = scenario([
      responseFrame([
        functionCall(1, 'summarize_metric', {
          metric: 'weight',
          from: '2026-10-28',
          to: '2026-11-04',
          timezone: 'America/New_York',
        }),
      ]),
    ]);
    vi.mocked(run.ledger.checkpointMessage).mockRejectedValueOnce(
      new Error('synthetic-persistence-failure'),
    );
    const events = await run.collect();
    expect(events.at(-1)).toMatchObject({ type: 'run.failed' });
    expect(
      events.some(
        (event) => event.type === 'card.ready' || event.type === 'tool.result',
      ),
    ).toBe(false);
    expect(run.bodies).toHaveLength(1);
  });

  it('does not recover from malformed service output as if it were model input', async () => {
    vi.mocked(readData).mockResolvedValueOnce({
      invalid: 'synthetic',
    } as never);
    const run = scenario([
      responseFrame([
        functionCall(1, 'summarize_metric', {
          metric: 'weight',
          from: '2026-10-28',
          to: '2026-11-04',
          timezone: 'America/New_York',
        }),
      ]),
    ]);
    const events = await run.collect();
    expect(events.at(-1)).toMatchObject({ type: 'run.failed' });
    expect(run.checkpoints).toHaveLength(0);
    expect(run.bodies).toHaveLength(1);
  });

  it('fails closed if a provider ignores the six-tool ceiling', async () => {
    const run = scenario([
      responseFrame(
        Array.from({ length: 7 }, (_, i) =>
          functionCall(i, 'list_metrics', { bad: true }),
        ),
      ),
    ]);
    const events = await run.collect();
    expect(events.at(-1)).toMatchObject({
      type: 'run.failed',
      payload: { code: 'run_call_limit' },
    });
    expect(run.checkpoints).toHaveLength(0);
  });

  it('fails closed if a provider asks for another tool on the fourth request', async () => {
    const run = scenario(
      Array.from({ length: 4 }, (_, i) =>
        responseFrame([functionCall(i, 'list_metrics', { bad: true })]),
      ),
    );
    const events = await run.collect();
    expect(events.at(-1)).toMatchObject({
      type: 'run.failed',
      payload: { code: 'run_call_limit' },
    });
    expect(run.bodies).toHaveLength(4);
    expect(run.checkpoints).toHaveLength(3);
  });

  it.each([
    ['list_metrics', { invented: 'synthetic-private' }, 'invalid_arguments'],
    [
      'get_goal_progress',
      { goal_id: 'synthetic-private' },
      'invalid_arguments',
    ],
    [
      'propose_goal',
      { definition: { title: 'synthetic-private' } },
      'invalid_arguments',
    ],
    [
      'propose_goal',
      {
        definition: {
          ...goalDraft,
          method: 'device_estimate',
          granularity: 'instant',
          currentMethod: 'daily_median_mean_7d',
          metric: 'body_fat_percent',
          unit: '%',
          target: { direction: 'decrease_to', value: -1 },
        },
      },
      'invalid_arguments',
    ],
    [
      'summarize_metric',
      {
        metric: 'weight',
        from: '2026-02-30',
        to: '2026-11-04',
        timezone: 'America/New_York',
      },
      'invalid_arguments',
    ],
    [
      'summarize_metric',
      {
        metric: 'weight',
        from: '2026-10-28T00:00:00-04:00',
        to: '2026-11-04T00:00:00-04:00',
        timezone: 'America/New_York',
      },
      'invalid_interval',
    ],
    [
      'summarize_metric',
      {
        metric: 'weight',
        from: '2026-10-28',
        to: '2026-11-04',
        timezone: 'UTC',
      },
      'timezone_mismatch',
    ],
  ])(
    'recovers from %s %j via safe feedback then a repaired call',
    async (name, args, code) => {
      const run = scenario([
        responseFrame([functionCall(1, name, args)]),
        responseFrame([functionCall(2, 'list_metrics', {})]),
        responseFrame([assistantOutput('Synthetic repaired answer')]),
      ]);
      const events = await run.collect();
      expect(events.at(-1), JSON.stringify(events)).toMatchObject({
        type: 'run.completed',
      });
      expect(run.bodies).toHaveLength(3);
      const errorTrace = run.checkpoints.find(
        (item) => ToolErrorResultSchema.safeParse(item.result).success,
      );
      expect(errorTrace).toMatchObject({
        result: { kind: 'tool_error', code, recoverable: true },
      });
      expect(JSON.stringify(errorTrace)).not.toContain('synthetic-private');
      expect(run.ledger.checkpointGoal).not.toHaveBeenCalled();
      expect(
        events.filter((event) => event.type === 'tool.result'),
      ).toHaveLength(2);
      expect(events.some((event) => event.type === 'card.ready')).toBe(false);
      expect(
        run.bodies[1]!.input.some(
          (item) =>
            item.type === 'function_call_output' &&
            String(item.output).includes(code),
        ),
      ).toBe(true);
    },
  );

  it.each(['last 7 days', 'this month'])(
    'evaluates a scripted relative query "%s" from server clock through real analytics and saved card',
    async (question) => {
      vi.spyOn(Temporal.Now, 'instant').mockReturnValue(
        Temporal.Instant.from('2026-11-04T17:00:00Z'),
      );
      let sends = 0;
      const run = scenario([], {
        mode: 'mock',
        async *send(body) {
          const wire = JSON.parse(Buffer.from(body).toString());
          if (sends++ === 0) {
            const profileTurn = wire.input.find(
              (item: { role: string; content?: string }) =>
                item.role === 'system' && item.content?.startsWith('{'),
            );
            const clock = JSON.parse(profileTurn.content).clock;
            const date = Temporal.PlainDate.from(clock.localDate);
            const from =
              question === 'last 7 days'
                ? date.subtract({ days: 7 })
                : date.with({ day: 1 });
            const to =
              question === 'last 7 days' ? date : date.add({ days: 1 });
            yield responseFrame([
              functionCall(1, 'summarize_metric', {
                metric: 'weight',
                from: from.toString(),
                to: to.toString(),
                timezone: clock.timezone,
              }),
            ]);
          } else {
            const output = wire.input.findLast(
              (item: { type: string }) => item.type === 'function_call_output',
            );
            const data = JSON.parse(output.output).result.data;
            const summary = data.analysis;
            yield responseFrame([
              assistantOutput(
                data.requestedIntervalMatches
                  ? `Synthetic trailing seven-day mean ${summary.value} kg; ${summary.validDays} days; ${summary.from} to ${summary.to}.`
                  : 'This summary cannot answer the requested interval.',
              ),
            ]);
          }
        },
      });
      const events = await run.collect(`Summarize my weight for ${question}`);
      expect(events.at(-1)).toMatchObject({ type: 'run.completed' });
      const trace = run.checkpoints[0] as {
        result: {
          data: {
            selection: { from: string; to: string };
            analysis: { value: number; validDays: number };
          };
        };
      };
      expect(trace.result.data.selection).toMatchObject(
        question === 'last 7 days'
          ? { from: '2026-10-28T04:00:00Z', to: '2026-11-04T05:00:00Z' }
          : { from: '2026-11-01T04:00:00Z', to: '2026-11-05T05:00:00Z' },
      );
      // DATA_MODEL defines scalar calculations as trailing seven-day windows,
      // even for a wider/narrower selected plotting interval.
      expect(trace.result.data.analysis.value).toBe(
        question === 'last 7 days' ? 67 : 66.5,
      );
      expect(trace.result.data.analysis.validDays).toBe(
        question === 'last 7 days' ? 7 : 6,
      );
      expect(
        events.some(
          (event) =>
            event.type === 'card.ready' &&
            event.payload.card.type === 'metric_trend',
        ),
      ).toBe(true);
      expect(
        events.some(
          (event) =>
            event.type === 'text.delta' &&
            event.payload.text.includes(
              question === 'last 7 days'
                ? '67 kg'
                : 'cannot answer the requested interval',
            ),
        ),
      ).toBe(true);
    },
  );

  it('counts recoverable errors toward six tool calls and uses the fourth request only for an answer', async () => {
    const run = scenario([
      responseFrame([
        functionCall(1, 'list_metrics', { bad: true }),
        functionCall(2, 'list_metrics', { bad: true }),
      ]),
      responseFrame([
        functionCall(3, 'list_metrics', { bad: true }),
        functionCall(4, 'list_metrics', { bad: true }),
      ]),
      responseFrame([
        functionCall(5, 'list_metrics', { bad: true }),
        functionCall(6, 'list_metrics', { bad: true }),
      ]),
      responseFrame([assistantOutput('Please clarify the request.')]),
    ]);
    const events = await run.collect();
    expect(events.at(-1)).toMatchObject({ type: 'run.completed' });
    expect(run.bodies).toHaveLength(4);
    expect(run.bodies[3]!.tools).toEqual([]);
    expect(run.checkpoints).toHaveLength(6);
  });

  it.each([401, 403, 503])(
    'does not recover from authorization/infrastructure status %s',
    async (status) => {
      vi.mocked(readData).mockRejectedValueOnce(
        new HttpFailure(status, 'denied_or_unavailable', 'synthetic-private'),
      );
      const run = scenario([
        responseFrame([
          functionCall(1, 'summarize_metric', {
            metric: 'weight',
            from: '2026-10-28',
            to: '2026-11-04',
            timezone: 'America/New_York',
          }),
        ]),
      ]);
      const events = await run.collect();
      expect(events.at(-1)).toMatchObject({
        type: 'run.failed',
        payload: { code: 'denied_or_unavailable' },
      });
      expect(run.bodies).toHaveLength(1);
      expect(run.checkpoints).toHaveLength(0);
    },
  );

  it.each(['checkpoint', 'settle'] as const)(
    'does not turn %s failure into recoverable feedback',
    async (method) => {
      const run = scenario([
        responseFrame([functionCall(1, 'list_metrics', { bad: true })]),
      ]);
      const original = vi.mocked(run.ledger[method]).getMockImplementation()!;
      if (method === 'checkpoint')
        vi.mocked(run.ledger.checkpoint).mockImplementation(
          async (step, bytes) => {
            if (step.type === 'tool')
              throw new Error('synthetic-persistence-failure');
            return (original as typeof run.ledger.checkpoint)(step, bytes);
          },
        );
      else
        vi.mocked(run.ledger.settle).mockImplementation(async (step) => {
          if (step.type === 'tool')
            throw new Error('synthetic-accounting-failure');
          return {} as RunSummary;
        });
      const events = await run.collect();
      expect(events.at(-1)).toMatchObject({ type: 'run.failed' });
      expect(events.some((event) => event.type === 'tool.result')).toBe(false);
      expect(run.bodies).toHaveLength(1);
    },
  );

  it('keeps cancellation fail closed before a tool result can be committed or emitted', async () => {
    const run = scenario([
      responseFrame([
        functionCall(1, 'summarize_metric', {
          metric: 'weight',
          from: '2026-10-28',
          to: '2026-11-04',
          timezone: 'America/New_York',
        }),
      ]),
    ]);
    vi.mocked(readData).mockImplementationOnce(async () => {
      run.controller.abort();
      throw new Error('aborted');
    });
    const events = await run.collect();
    expect(events.at(-1)).toMatchObject({ type: 'run.cancelled' });
    expect(run.checkpoints).toHaveLength(0);
    expect(events.some((event) => event.type === 'tool.result')).toBe(false);
  });
});

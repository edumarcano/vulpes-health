import { afterEach, describe, expect, it, vi } from 'vitest';
import { Temporal } from '@js-temporal/polyfill';
import {
  assertEvaluationBinding,
  assertEvaluationBody,
  assessEvaluationBinding,
  createEvaluationBinding,
  type EvaluationBinding,
} from '../../server/config/evaluation-binding.js';
import {
  evaluationCandidates,
  getRoleAvailability,
  models,
} from '../../server/config/models.js';
import {
  OpenRouterResponsesAdapter,
  serializeEveryday,
} from '../../server/ai/providers/openrouter.js';
import { boundContext } from '../../server/ai/context.js';
import { continuationFor } from '../../server/ai/continuation.js';
import type { GenerationRequest } from '../../server/ai/contracts.js';
import { VulpesAgent } from '../../server/ai/VulpesAgent.js';
import type { AuthContext } from '../../server/auth/session.js';
import {
  assertEvaluationTransport,
  issueVerificationTransport,
} from '../../server/ai/providers/openrouter-verification.js';
import {
  createDispatcher,
  type RequestTransport,
} from '../../server/ai/ledger/dispatcher.js';
import type {
  ExecutionService,
  RunLease,
} from '../../server/ai/ledger/execution.js';
import type { ChatSendRequest } from '../../shared/api.js';
import type { RunSummary } from '../../shared/executions.js';
import { verificationFixtureHash } from '../../server/ai/verification-fixture.js';
import { responseFrame, assistantOutput } from '../fixtures/chat.js';
import { VerifiedPriceSchema } from '../../server/ai/ledger/pricing.js';

const database = vi.hoisted(() => ({ value: {} as Record<string, unknown> }));
vi.mock('../../server/db/administrative.js', () => ({
  administrativeClient: () => database.value,
}));
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});
const request: GenerationRequest = {
  turns: [{ type: 'message', role: 'user', text: 'Synthetic question.' }],
  tools: [],
  continuation: null,
};
function withEvidence(id: 'luna-low' | 'luna-medium' = 'luna-medium') {
  const binding = createEvaluationBinding(id);
  if (binding.config.price.status !== 'verified')
    throw new Error('test_price_unavailable');
  return createEvaluationBinding(id, {
    capabilities: {
      version: 1,
      provider: 'openrouter',
      model: binding.config.modelId,
      effort: binding.config.reasoning.effort,
      adapterVersion: binding.adapterVersion,
      templateVersion: binding.templateVersion,
      priceId: binding.config.price.id,
      priceHash: binding.priceHash,
      inputBoundTokens: 12000,
      outputBoundTokens: 3072,
      streaming: true,
      tools: true,
      zdr: true,
      checkedAt: binding.config.price.checkedAt,
      sourceURL: 'https://example.test/capabilities',
    },
    privacy: {
      version: 1,
      provider: 'openrouter',
      model: binding.config.modelId,
      effort: binding.config.reasoning.effort,
      policyVersion: binding.policyVersion,
      policyHash: binding.policyHash,
      checkedAt: binding.config.price.checkedAt,
      sourceURL: 'https://example.test/privacy',
      safetyRetention: 'excluded',
      guard: { kind: 'endpoint_allowlist', endpoints: ['Synthetic endpoint'] },
    },
  });
}

describe('catalog evaluation binding', () => {
  it.each(['matching', 'model_mismatch', 'effort_mismatch'] as const)(
    'uses bound admission and step identity and retains settlement before %s outcome',
    async (mode) => {
      const binding = withEvidence();
      const price = VerifiedPriceSchema.parse(binding.config.price);
      const clock = Temporal.Instant.from('2026-09-09T16:00:00Z');
      const owner = '11111111-1111-4111-8111-111111111111';
      const runId = '22222222-2222-4222-8222-222222222222';
      const context = {
        userId: owner,
        db: {
          from: (table: string) => {
            const query = {
              select: () => query,
              eq: () => query,
              neq: () => query,
              order: () => query,
              single: async () => ({
                data: { timezone: 'UTC', units: 'metric', data_revision: 1 },
                error: null,
              }),
              maybeSingle: async () => ({
                data: {
                  id: runId,
                  title: 'Synthetic conversation',
                  archived: false,
                  created_at: '2026-11-16T00:00:00Z',
                  updated_at: '2026-11-16T00:00:00Z',
                },
                error: null,
              }),
              limit: async () => ({ data: [], error: null }),
            };
            expect(['profiles', 'messages', 'conversations']).toContain(table);
            return query;
          },
        },
      } as unknown as AuthContext;
      const transport: RequestTransport = {
        mode: 'mock',
        send: vi.fn(async function* (body) {
          assertEvaluationBody(binding, body);
          yield Buffer.from(
            'data: ' +
              JSON.stringify({
                type: 'response.completed',
                response: {
                  status: 'completed',
                  model:
                    mode === 'model_mismatch'
                      ? 'different-model'
                      : binding.config.modelId,
                  reasoning: {
                    effort: mode === 'effort_mismatch' ? 'low' : 'medium',
                  },
                  output: [assistantOutput('Synthetic answer.')],
                  usage: { input_tokens: 50, output_tokens: 20, cost: '0.001' },
                },
              }) +
              '\n\n',
          );
        }),
      };
      const agent = new VulpesAgent(context, {
        adapter: new OpenRouterResponsesAdapter(binding),
        transport,
        price,
        maxRunCostUSD: '1',
        evaluationBinding: binding,
        evaluationClock: () => clock,
      });
      const initial: RunSummary = {
        id: runId,
        conversationId: runId,
        state: 'running',
        assistantMessageId: owner,
        requestedDepth: 'auto',
        route: null,
        admittedAt: '2026-11-16T00:00:00Z',
        deadlineAt: new Date(Date.now() + 60000).toISOString(),
        finishedAt: null,
        accountingPeriod: '2026-11-01',
        traceState: 'available',
        partialOutput: false,
        costUSD: '0.001',
        knownCostUSD: '0.001',
        costStatus: 'reported',
        reservationUSD: '0',
      };
      const lease = {
        runId,
        executor: owner,
        fence: 1,
        deadlineAt: new Date(Date.now() + 60000).toISOString(),
      } as RunLease;
      vi.spyOn(agent.ledger, 'reconcile').mockResolvedValue(null);
      vi.spyOn(agent.ledger, 'replayChat').mockResolvedValue(null);
      const admit = vi.spyOn(agent.ledger, 'admit').mockResolvedValue({
        result: { kind: 'admitted', run: initial },
        lease,
      });
      vi.spyOn(agent.ledger, 'heartbeat').mockResolvedValue(initial);
      const prepare = vi
        .spyOn(agent.ledger, 'prepare')
        .mockImplementation(async (value, input) => ({
          id: runId,
          lease: value,
          body: Buffer.from(input.body),
          bodyHash: 'synthetic',
          price,
          type: 'generation',
          payloadExpiresAt: new Date(Date.now() + 60000).toISOString(),
        }));
      vi.spyOn(agent.ledger, 'authorize').mockResolvedValue(undefined);
      vi.spyOn(agent.ledger, 'checkpoint').mockResolvedValue(
        'synthetic-payload',
      );
      vi.spyOn(agent.ledger, 'checkpointMessage').mockResolvedValue(undefined);
      vi.spyOn(agent.ledger, 'saveState').mockResolvedValue('synthetic-state');
      const settle = vi
        .spyOn(agent.ledger, 'settle')
        .mockResolvedValue(initial);
      vi.spyOn(agent.ledger, 'finish').mockImplementation(
        async (_lease, status) => ({ ...initial, state: status }),
      );
      vi.spyOn(agent.ledger, 'usageTotals').mockResolvedValue({
        inputTokens: 50,
        outputTokens: 20,
        reasoningTokens: null,
        cacheReadTokens: null,
        cacheWriteTokens: null,
      });
      const input = {
        action: 'send',
        client_request_id: owner,
        conversation_id: runId,
        message: { id: owner, text: 'Explain these synthetic measurements.' },
        depth: 'auto',
      } as ChatSendRequest;
      await agent.admit(input);
      expect(admit.mock.calls[0]?.[0].route).toEqual({
        role: 'everyday',
        provider: 'openrouter',
        model: binding.config.modelId,
        effort: 'medium',
      });
      const events = [];
      for await (const event of agent.run(
        input,
        lease,
        initial,
        null,
        new AbortController().signal,
      ))
        events.push(event);
      expect(
        events.find((event) => event.type === 'route.selected'),
      ).toMatchObject({
        payload: {
          provider: 'openrouter',
          model: binding.config.modelId,
          effort: 'medium',
        },
      });
      expect(prepare.mock.calls[0]?.[1]).toMatchObject({
        provider: 'openrouter',
        model: binding.config.modelId,
        requestedEffort: 'medium',
        price: binding.config.price,
      });
      expect(
        Buffer.from(prepare.mock.calls[0]![1].body).toString('utf8'),
      ).toContain(clock.toString());
      expect(settle).toHaveBeenCalledOnce();
      expect(settle.mock.calls[0]?.[1]).toMatchObject({
        inputTokens: 50,
        outputTokens: 20,
        reportedCostUSD: '0.001',
      });
      expect(settle.mock.calls[0]?.[5]).toMatchObject({
        effectiveModel:
          mode === 'model_mismatch'
            ? 'different-model'
            : binding.config.modelId,
        effectiveEffort: mode === 'effort_mismatch' ? 'low' : 'medium',
      });
      expect(events.at(-1)?.type).toBe(
        mode === 'matching' ? 'run.completed' : 'run.failed',
      );
      expect(transport.send).toHaveBeenCalledOnce();
    },
  );
  it('binds issued transport to candidate, body, ledger configuration and verified synthetic allocation', async () => {
    const binding = withEvidence();
    const price = VerifiedPriceSchema.parse(binding.config.price);
    const owner = '11111111-1111-4111-8111-111111111111';
    const batch = '22222222-2222-4222-8222-222222222222';
    const bucket = '33333333-3333-4333-8333-333333333333';
    const period = new Date().toISOString().slice(0, 7) + '-01';
    const allocation = {
      id: batch,
      user_id: owner,
      account_bucket_id: bucket,
      period_start: period,
      ceiling_text: '1',
      data_revision: 1,
      fixture_hash: verificationFixtureHash,
    };
    const profile = {
      account_state: 'active',
      display_name: 'Synthetic verification',
      data_revision: 1,
      consent_versions: {
        openrouter: {
          accepted_version: 'openrouter_zdr_v2',
          accepted_at: '2026-11-16T00:00:00Z',
        },
      },
    };
    const chain = (data: unknown) => {
      const query = {
        select: () => query,
        eq: () => query,
        single: async () => ({ data, error: null }),
        maybeSingle: async () => ({ data, error: null }),
      };
      return query;
    };
    database.value = {
      from: (name: string) =>
        chain(
          name === 'live_verification_allocations'
            ? allocation
            : {
                id: bucket,
                user_id: owner,
                scope: 'account',
                period_start: period,
              },
        ),
      auth: {
        admin: {
          getUserById: async () => ({
            data: { user: { email: `pr03-${owner}@example.test` } },
            error: null,
          }),
        },
      },
    };
    const context = {
      userId: owner,
      db: { from: () => chain(profile) },
    } as unknown as AuthContext;
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
    let keyReads = 0;
    const env = {
      VULPES_LIVE_AI_ENABLED: 'true',
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      get OPENROUTER_API_KEY() {
        keyReads++;
        return 'synthetic-key';
      },
    };
    const send = vi.fn<typeof fetch>(
      async () =>
        new Response('synthetic', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    );
    await expect(
      issueVerificationTransport(
        context,
        batch,
        '1',
        verificationFixtureHash,
        true,
        env,
        send,
        createEvaluationBinding('luna-medium'),
      ),
    ).rejects.toThrow('capability_privacy_unverified');
    expect(keyReads).toBe(0);
    expect(send).not.toHaveBeenCalled();
    const transport = await issueVerificationTransport(
      context,
      batch,
      '1',
      verificationFixtureHash,
      true,
      env,
      send,
      binding,
    );
    expect(keyReads).toBe(1);
    expect(() => assertEvaluationTransport(transport, binding)).not.toThrow();
    expect(() =>
      assertEvaluationTransport(transport, withEvidence('luna-low')),
    ).toThrow('evaluation_transport_mismatch');
    const wrapper: RequestTransport = {
      mode: 'verification',
      send: (bytes, signal) => transport.send(bytes, signal),
    };
    expect(() => assertEvaluationTransport(wrapper, binding)).toThrow(
      'evaluation_transport_mismatch',
    );
    const bytes = serializeEveryday(request, binding);
    const changed = JSON.parse(Buffer.from(bytes).toString());
    changed.reasoning.effort = 'low';
    await expect(async () => {
      for await (const chunk of transport.send(
        Buffer.from(JSON.stringify(changed)),
        new AbortController().signal,
      ))
        void chunk;
    }).rejects.toThrow('evaluation_request_mismatch');
    const prepare = vi.fn();
    const dispatcher = createDispatcher(
      { prepare } as unknown as ExecutionService,
      transport,
    );
    const bound = dispatcher.bind(
      {} as RunLease,
      {
        provider: 'openrouter',
        model: 'wrong-model',
        price,
      },
      () => {},
    );
    await expect(async () => {
      for await (const chunk of bound.send(
        {
          body: bytes,
          adapterVersion: binding.adapterVersion,
          requestedEffort: 'medium',
          metadata: {
            endpoint: 'https://openrouter.ai/api/v1/responses',
            headers: {},
            redactedHeaders: [],
          },
        },
        new AbortController().signal,
      ))
        void chunk;
    }).rejects.toThrow('evaluation_dispatch_mismatch');
    expect(prepare).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    const chunks = [];
    for await (const chunk of transport.send(
      bytes,
      new AbortController().signal,
    ))
      chunks.push(chunk);
    expect(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(),
    ).toBe('synthetic');
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[1]?.body).toEqual(bytes);
  });
  it('declares disabled candidates without changing production selection or v12 availability', () => {
    expect(Object.keys(evaluationCandidates)).toEqual([
      'luna-low',
      'luna-medium',
      'haiku-low',
    ]);
    expect(
      Object.values(evaluationCandidates).map((entry) => [
        entry.evaluationOnly,
        entry.enabledByDefault,
        entry.reasoning.effort,
      ]),
    ).toEqual([
      [true, false, 'low'],
      [true, false, 'medium'],
      [true, false, 'low'],
    ]);
    expect(models.everyday.reasoning.effort).toBe('low');
    expect(getRoleAvailability('everyday', true)).toEqual({
      state: 'unavailable',
      reason: 'capability_evidence_mismatch',
    });
    expect(Object.isFrozen(evaluationCandidates['luna-medium'].reasoning)).toBe(
      true,
    );
    expect(() => createEvaluationBinding('unknown' as 'luna-low')).toThrow(
      'evaluation_candidate_unknown',
    );
  });
  it('freezes nested settings and detects forged effort, price or identity', () => {
    const binding = withEvidence();
    expect(Object.isFrozen(binding.config.price)).toBe(true);
    expect(Object.isFrozen(binding.privacy!.guard)).toBe(true);
    expect(() => {
      (binding.config.reasoning as { effort: string }).effort = 'high';
    }).toThrow();
    for (const forged of [
      { ...binding, candidateId: 'luna-low' },
      { ...binding, priceHash: '0'.repeat(64) },
      {
        ...binding,
        config: { ...binding.config, reasoning: { effort: 'unsupported' } },
      },
    ])
      expect(() =>
        assertEvaluationBinding(forged as EvaluationBinding),
      ).toThrow('evaluation_binding_mismatch');
    expect(assessEvaluationBinding(binding, true, '1')).toEqual({
      state: 'ready',
    });
    expect(
      assessEvaluationBinding(createEvaluationBinding('haiku-low'), true, '1')
        .state,
    ).toBe('unavailable');
    expect(
      assessEvaluationBinding(
        createEvaluationBinding('luna-medium'),
        true,
        '1',
      ),
    ).toEqual({
      state: 'unavailable',
      reason: 'capability_privacy_unverified',
    });
    expect(
      assessEvaluationBinding(
        createEvaluationBinding('luna-medium', {
          capabilities: binding.capabilities,
        }),
        true,
        '1',
      ),
    ).toEqual({
      state: 'unavailable',
      reason: 'evaluation_privacy_unverified',
    });
    const mismatch = createEvaluationBinding('luna-low', {
      capabilities: binding.capabilities,
      privacy: binding.privacy,
    });
    expect(assessEvaluationBinding(mismatch, true, '1')).toEqual({
      state: 'unavailable',
      reason: 'capability_evidence_mismatch',
    });
  });
  it.each(['luna-low', 'luna-medium', 'haiku-low'] as const)(
    'serializes only the bound candidate %s',
    (id) => {
      const binding = createEvaluationBinding(id);
      const bytes = serializeEveryday(request, binding);
      const body = JSON.parse(Buffer.from(bytes).toString());
      expect(body).toMatchObject({
        model: binding.config.modelId,
        reasoning: binding.config.reasoning,
        max_output_tokens: 3072,
        store: false,
      });
      expect(body.provider).toEqual({
        zdr: true,
        data_collection: 'deny',
        require_parameters: true,
        max_price: { prompt: 0.2, completion: 1 },
      });
      expect(() => assertEvaluationBody(binding, bytes)).not.toThrow();
      for (const changed of [
        { ...body, model: 'other-model' },
        { ...body, reasoning: { effort: 'high' } },
        { ...body, max_output_tokens: 9999 },
        { ...body, temperature: 1 },
      ])
        expect(() =>
          assertEvaluationBody(binding, Buffer.from(JSON.stringify(changed))),
        ).toThrow('evaluation_request_mismatch');
    },
  );
  it('uses the same effort and model for adapter dispatch, continuation and observed metadata', async () => {
    const network = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('Network forbidden'));
    const binding = withEvidence();
    const dispatch = vi.fn(async function* (input) {
      expect(input.requestedEffort).toBe('medium');
      expect(input.adapterVersion).toBe(binding.adapterVersion);
      assertEvaluationBody(binding, input.body);
      yield responseFrame([assistantOutput('Synthetic answer.')]);
    });
    const events = [];
    for await (const event of new OpenRouterResponsesAdapter(binding).generate(
      request,
      { signal: new AbortController().signal, dispatch: { send: dispatch } },
    ))
      events.push(event);
    const completion = events.find((event) => event.type === 'completed');
    expect(completion).toMatchObject({
      continuation: { model: binding.config.modelId },
      metadata: { effectiveModel: null, effectiveEffort: null },
    });
    expect(events.find((event) => event.type === 'usage')).toMatchObject({
      usage: { inputTokens: 50, outputTokens: 20, reportedCostUSD: '0.001' },
    });
    expect(network).not.toHaveBeenCalled();
  });
  it('retains target continuation identity and strips incompatible opaque blocks while retaining logical turns', () => {
    const binding = withEvidence();
    const turns: GenerationRequest['turns'] = [
      { type: 'message', role: 'assistant', text: 'Earlier answer.' },
    ];
    const blocks = [
      { at: 0, count: 1, items: [{ type: 'reasoning', opaque: 'synthetic' }] },
    ];
    const groups = [
      {
        id: 'compatible',
        turns,
        continuation: continuationFor(
          blocks,
          'openrouter_responses',
          binding.config.modelId,
        ),
      },
      {
        id: 'different',
        turns,
        continuation: continuationFor(
          blocks,
          'openrouter_responses',
          'other-model',
        ),
      },
      { id: 'unknown', turns, continuation: continuationFor(blocks) },
    ];
    const bounded = boundContext(request, groups, 10000, {
      family: 'openrouter_responses',
      model: binding.config.modelId,
    });
    expect(bounded.request.turns).toHaveLength(4);
    expect(bounded.request.continuation).toMatchObject({
      model: binding.config.modelId,
      data: { blocks: [expect.objectContaining({ at: 1 })] },
    });
    expect(bounded.excluded).toEqual(
      ['different', 'unknown'].map((referenceId) => ({
        referenceId,
        reason: 'provider_continuation_not_transferable',
      })),
    );
    expect(() =>
      serializeEveryday(
        { ...request, continuation: groups[1]!.continuation },
        binding,
      ),
    ).toThrow('incompatible_continuation');
  });
  it('rejects agent adapter, accounting, routing or transport mismatch before admission', () => {
    const binding = withEvidence();
    const price = VerifiedPriceSchema.parse(binding.config.price);
    const context = {} as AuthContext;
    const dependencies = {
      adapter: new OpenRouterResponsesAdapter(binding),
      transport: {
        mode: 'mock' as const,
        async *send() {
          yield Buffer.from('');
        },
      },
      price,
      maxRunCostUSD: '1',
      evaluationBinding: binding,
    };
    expect(() => new VulpesAgent(context, dependencies)).not.toThrow();
    expect(
      () =>
        new VulpesAgent(context, {
          ...dependencies,
          adapter: new OpenRouterResponsesAdapter(),
        }),
    ).toThrow('evaluation_dependency_mismatch');
    expect(
      () =>
        new VulpesAgent(context, {
          ...dependencies,
          price: { ...price, id: 'wrong-price' },
        }),
    ).toThrow('evaluation_dependency_mismatch');
    expect(
      () =>
        new VulpesAgent(context, {
          adapter: dependencies.adapter,
          transport: dependencies.transport,
          price: dependencies.price,
          maxRunCostUSD: dependencies.maxRunCostUSD,
        }),
    ).toThrow('evaluation_binding_required');
    expect(
      () =>
        new VulpesAgent(context, {
          ...dependencies,
          verificationRole: 'intermediate',
        }),
    ).toThrow('evaluation_dependency_mismatch');
    expect(() =>
      assertEvaluationTransport(
        { ...dependencies.transport, mode: 'verification' },
        binding,
      ),
    ).toThrow('evaluation_transport_mismatch');
    expect(() =>
      assertEvaluationTransport(
        { ...dependencies.transport, mode: 'production' },
        binding,
      ),
    ).toThrow('evaluation_transport_mismatch');
  });
});

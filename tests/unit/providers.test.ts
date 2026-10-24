import { describe, expect, it, vi } from 'vitest';
import {
  DecisionRequestSchema, GenerationEventSchema, GenerationRequestSchema, normalizeUsage,
} from '../../server/ai/contracts.js';
import type { GenerationAdapter, GenerationFamily } from '../../server/ai/contracts.js';
import { getRoleAvailability, ModelConfigSchema, models, prototypeRunLimits } from '../../server/config/models.js';
import {
  exerciseGeneration, generationReplies, SyntheticDecisionAdapter, SyntheticDecisionTransport,
  SyntheticGenerationAdapter, SyntheticGenerationTransport, syntheticDecisionRequest, syntheticDecisionResult,
  syntheticRequest, syntheticUsage,
} from '../helpers/synthetic-providers.js';
import { encodeStreamEvent, StreamDecoder } from '../../shared/stream.js';
import { id } from '../fixtures/contracts.js';

describe('typed catalog and honest role availability', () => {
  it('preserves all four approved model identities and application ceilings', () => {
    expect(Object.values(models).map((model) => [model.role, model.modelId, model.maxInputTokens, model.maxOutputTokens])).toEqual([
      ['everyday', 'openai/gpt-6-luna', 12000, 3072], ['intermediate', 'gemini-3.8-flash', 24000, 8192],
      ['advanced', 'gemini-4-argon', 48000, 12288], ['decision', 'microsoft/microsoft-decision-1', 2048, null],
    ]);
    expect(prototypeRunLimits).toEqual({ modelRequests: 4, toolCalls: 6, applicationDeadlineSeconds: 210 });
    expect(models.everyday.reasoning).toEqual({ effort: 'low' });
    expect(models.intermediate.thinking).toEqual({ level: 'MEDIUM' });
    expect(models.advanced.thinking).toEqual({ level: 'MEDIUM' });
    for (const model of Object.values(models)) {
      expect(ModelConfigSchema.parse(model)).toEqual(model);
      expect(model.price.status).toBe('unverified');
      expect(model.price.inputPerMillion).toBeNull();
      expect(model.price.otherFees).toBeNull();
      expect(model.liveSmokeStatus).toBe('not_run');
      expect(getRoleAvailability(model.role).state).toBe(model.role === 'decision' ? 'disabled' : 'unavailable');
    }
  });
  it.each([
    { ...models.everyday, reasoning: { effort: 'MINIMAL' } },
    { ...models.everyday, thinking: { level: 'MEDIUM' } },
    { ...models.intermediate, thinking: { level: 'MINIMAL' } },
    { ...models.intermediate, reasoning: { effort: 'low' } },
    { ...models.advanced, maxOutputTokens: 0 },
    { ...models.decision, enabledByDefault: true },
    { ...models.decision, reasoning: { effort: 'low' } },
    { ...models.decision, apiFamily: 'openrouter_responses' },
  ])('rejects unsupported API-family settings (%#)', (input) => {
    expect(ModelConfigSchema.safeParse(input).success).toBe(false);
  });
});

describe.each<GenerationFamily>(['openrouter_responses', 'vertex_generate_content'])('%s offline generation contract', (family) => {
  it('uses the same caller, preserves continuation/tool pairing, and round-trips output through SSE', async () => {
    const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Network forbidden in synthetic tests.'));
    try {
      const transport = new SyntheticGenerationTransport(generationReplies(family));
      const adapter = new SyntheticGenerationAdapter(family, { streaming: true, tools: true }, transport);
      const result = await exerciseGeneration(adapter, new AbortController().signal);
      expect(transport.requests).toHaveLength(2);
      expect(transport.requests[0]).toEqual(syntheticRequest);
      expect(transport.requests[1]!.continuation).toEqual({ family, data: { signature: 'synthetic-opaque-do-not-rewrite', callId: 'synthetic-call-1' } });
      expect(transport.requests[1]!.turns.slice(-2)).toEqual([
        { type: 'tool_call', callId: 'synthetic-call-1', name: 'summarize_metric', arguments: { metric: 'weight' } },
        { type: 'tool_result', callId: 'synthetic-call-1', name: 'summarize_metric', result: { value: 69.7, unit: 'kg', synthetic: true } },
      ]);
      expect(result.second.filter((event) => event.type === 'usage')).toEqual([{ type: 'usage', usage: syntheticUsage }]);
      const text = result.second.filter((event) => event.type === 'text.delta').map((event) => event.text).join('');
      expect(text).toBe('The synthetic mean is 69.7 kg.');
      const frame = encodeStreamEvent({ v: 1, run_id: id, seq: 1, type: 'text.delta', payload: { message_id: id, text } });
      const decoder = new StreamDecoder();
      expect(decoder.push(new TextEncoder().encode(frame))[0]?.payload).toEqual({ message_id: id, text });
      decoder.finish();
      expect(network).not.toHaveBeenCalled();
    } finally { network.mockRestore(); }
  });
  it.each([{ streaming: false, tools: true }, { streaming: true, tools: false }])('rejects missing capabilities before transport: %j', async (capabilities) => {
    const transport = new SyntheticGenerationTransport(generationReplies(family));
    const adapter = new SyntheticGenerationAdapter(family, capabilities, transport);
    await expect(exerciseGeneration(adapter, new AbortController().signal)).rejects.toThrow('unsupported_capability');
    expect(transport.requests).toHaveLength(0);
  });
  it('rejects wrong-family continuation before transport', async () => {
    const transport = new SyntheticGenerationTransport(generationReplies(family));
    const adapter = new SyntheticGenerationAdapter(family, { streaming: true, tools: true }, transport);
    const input = { ...syntheticRequest, continuation: { family: family === 'openrouter_responses' ? 'vertex_generate_content' as const : 'openrouter_responses' as const, data: {} } };
    await expect(async () => { for await (const event of adapter.generate(input, { signal: new AbortController().signal })) void event; }).rejects.toThrow('incompatible_continuation');
    expect(transport.requests).toHaveLength(0);
  });
  it('requires tool support for historical tool turns even when no tools are offered', async () => {
    const transport = new SyntheticGenerationTransport(generationReplies(family));
    const adapter = new SyntheticGenerationAdapter(family, { streaming: true, tools: false }, transport);
    const request = { ...syntheticRequest, tools: [], turns: [
      { type: 'tool_call' as const, callId: 'x', name: 'summarize_metric', arguments: {} },
      { type: 'tool_result' as const, callId: 'x', name: 'summarize_metric', result: {} },
    ] };
    await expect(async () => { for await (const event of adapter.generate(request, { signal: new AbortController().signal })) void event; }).rejects.toThrow('unsupported_capability');
    expect(transport.requests).toHaveLength(0);
  });
  it('propagates transport failure once and never retries', async () => {
    const transport = new SyntheticGenerationTransport([new Error('synthetic_failure')]);
    const adapter = new SyntheticGenerationAdapter(family, { streaming: true, tools: true }, transport);
    await expect(exerciseGeneration(adapter, new AbortController().signal)).rejects.toThrow('synthetic_failure');
    expect(transport.requests).toHaveLength(1);
  });
  it('cancels before transport or during output without starting a continuation', async () => {
    const abort = new AbortController();
    const transport = new SyntheticGenerationTransport(generationReplies(family));
    const adapter = new SyntheticGenerationAdapter(family, { streaming: true, tools: true }, transport);
    abort.abort();
    await expect(exerciseGeneration(adapter, abort.signal)).rejects.toThrow();
    expect(transport.requests).toHaveLength(0);
    const during = new AbortController();
    const iterator = adapter.generate(syntheticRequest, { signal: during.signal })[Symbol.asyncIterator]();
    expect((await iterator.next()).value.type).toBe('text.delta');
    during.abort();
    await expect(iterator.next()).rejects.toThrow();
    expect(transport.requests).toHaveLength(1);
  });
  it.each([
    { type: 'tool.call', call: { callId: 'x', name: 'summarize_metric', arguments: { metric: 'weight', user_id: 'foreign' } } },
    { type: 'tool.call', call: { callId: 'x', name: 'delete_account', arguments: {} } },
    { type: 'tool.call', call: { name: 'summarize_metric', arguments: {} } },
    { type: 'usage', usage: { ...syntheticUsage, outputTokens: -1 } },
  ])('rejects malformed tool/output data without a second call (%#)', async (bad) => {
    const replies = [[bad, { type: 'completed', finishReason: 'tool_calls', continuation: null }]];
    const transport = new SyntheticGenerationTransport(replies);
    const adapter = new SyntheticGenerationAdapter(family, { streaming: true, tools: true }, transport);
    await expect(exerciseGeneration(adapter, new AbortController().signal)).rejects.toThrow();
    expect(transport.requests).toHaveLength(1);
  });
});

describe('usage and separate decision contract', () => {
  it.each([
    [{ type: 'tool_call', callId: 'call-1', name: 'summarize_metric', arguments: {} }, { type: 'tool_result', callId: 'wrong-id', name: 'summarize_metric', result: {} }],
    [{ type: 'tool_call', callId: 'call-1', name: 'summarize_metric', arguments: {} }, { type: 'tool_result', callId: 'call-1', name: 'different-tool', result: {} }],
    [{ type: 'tool_result', callId: 'call-1', name: 'summarize_metric', result: {} }],
    [{ type: 'tool_call', callId: 'call-1', name: 'summarize_metric', arguments: {} }],
    [{ type: 'tool_call', callId: 'call-1', name: 'summarize_metric', arguments: {} }, { type: 'tool_result', callId: 'call-1', name: 'summarize_metric', result: {} }, { type: 'tool_result', callId: 'call-1', name: 'summarize_metric', result: {} }],
  ])('rejects unmatched, repeated, or incomplete tool-result history (%#)', (...turns) => {
    expect(GenerationRequestSchema.safeParse({ ...syntheticRequest, turns }).success).toBe(false);
  });
  it('retains unknown categories as null and does not add reasoning/cache subsets to totals', () => {
    expect(normalizeUsage({ rawUsage: null })).toEqual({ inputTokens: null, outputTokens: null, reasoningTokens: null, cacheReadTokens: null, cacheWriteTokens: null, reasoningIsOutputSubset: null, cacheReadIsInputSubset: null, reportedCostUSD: null, rawUsage: null });
    expect(normalizeUsage(syntheticUsage)).toEqual(syntheticUsage);
    expect(syntheticUsage.inputTokens).toBe(20);
    expect(syntheticUsage.outputTokens).toBe(10);
    expect(syntheticUsage.rawUsage).toEqual({ synthetic: true, input: 20, output: 10, reasoningIncludedInOutput: 4, cacheIncludedInInput: 5 });
    expect(GenerationEventSchema.safeParse({ type: 'usage', usage: { ...syntheticUsage, reportedCostUSD: 0.01 } }).success).toBe(false);
  });
  it('scores typed choices with no generation interface', async () => {
    const transport = new SyntheticDecisionTransport(syntheticDecisionResult);
    const decision = new SyntheticDecisionAdapter(transport);
    expect(await decision.score(syntheticDecisionRequest, { signal: new AbortController().signal })).toEqual(syntheticDecisionResult);
    expect(transport.requests).toEqual([syntheticDecisionRequest]);
    expect('generate' in decision).toBe(false);
    // @ts-expect-error A decision adapter must not satisfy the generation port.
    const generation: GenerationAdapter = decision;
    void generation;
  });
  it.each([
    { ...syntheticDecisionResult, scores: { depth: { everyday: Infinity, clarify: 0.2 } } },
    { ...syntheticDecisionResult, scores: { depth: { everyday: 0.8 } } },
    { ...syntheticDecisionResult, scores: { different: { everyday: 0.8, clarify: 0.2 } } },
    { ...syntheticDecisionResult, scores: { depth: { everyday: 0.8, clarify: 0.2, advanced: 1 } } },
  ])('rejects malformed or unrequested decision output (%#)', async (response) => {
    const transport = new SyntheticDecisionTransport(response);
    const decision = new SyntheticDecisionAdapter(transport);
    await expect(decision.score(syntheticDecisionRequest, { signal: new AbortController().signal })).rejects.toThrow();
    expect(transport.requests).toHaveLength(1);
  });
  it('rejects duplicate questions and cancellation before scoring', async () => {
    expect(DecisionRequestSchema.safeParse({ ...syntheticDecisionRequest, questions: [...syntheticDecisionRequest.questions, ...syntheticDecisionRequest.questions] }).success).toBe(false);
    const transport = new SyntheticDecisionTransport(syntheticDecisionResult);
    const abort = new AbortController(); abort.abort();
    await expect(new SyntheticDecisionAdapter(transport).score(syntheticDecisionRequest, { signal: abort.signal })).rejects.toThrow();
    expect(transport.requests).toHaveLength(0);
  });
});

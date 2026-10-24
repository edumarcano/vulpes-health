import { z } from 'zod';
import {
  DecisionRequestSchema, GenerationEventSchema, normalizeUsage, requireGenerationCapabilities, validateDecisionResult,
} from '../../server/ai/contracts.js';
import type {
  DecisionAdapter, DecisionRequest, DecisionResult, GenerationAdapter, GenerationCapabilities, GenerationEvent, GenerationFamily, GenerationRequest,
} from '../../server/ai/contracts.js';

export class SyntheticGenerationTransport {
  readonly requests: GenerationRequest[] = [];
  constructor(private readonly replies: readonly (readonly unknown[] | Error)[]) {}
  async *send(request: GenerationRequest, signal: AbortSignal): AsyncIterable<unknown> {
    signal.throwIfAborted();
    const index = this.requests.length;
    this.requests.push(structuredClone(request));
    const reply = this.replies[index];
    if (!reply) throw new Error('synthetic_script_exhausted');
    if (reply instanceof Error) throw reply;
    for (const event of reply) {
      signal.throwIfAborted();
      yield structuredClone(event);
    }
  }
}

export class SyntheticGenerationAdapter implements GenerationAdapter {
  constructor(
    readonly family: GenerationFamily,
    readonly capabilities: GenerationCapabilities,
    private readonly transport: SyntheticGenerationTransport,
  ) {}
  async *generate(request: GenerationRequest, { signal }: { signal: AbortSignal }): AsyncIterable<GenerationEvent> {
    signal.throwIfAborted();
    const validated = requireGenerationCapabilities(this, request);
    for await (const event of this.transport.send(validated, signal)) {
      const parsed = GenerationEventSchema.parse(event);
      if (parsed.type === 'completed' && parsed.continuation && parsed.continuation.family !== this.family) throw new Error('incompatible_continuation');
      yield parsed;
    }
  }
}

export class SyntheticDecisionTransport {
  readonly requests: DecisionRequest[] = [];
  constructor(private readonly response: unknown) {}
  async send(request: DecisionRequest, signal: AbortSignal): Promise<unknown> {
    signal.throwIfAborted();
    this.requests.push(structuredClone(request));
    return structuredClone(this.response);
  }
}
export class SyntheticDecisionAdapter implements DecisionAdapter {
  readonly family = 'openrouter_decisions';
  constructor(private readonly transport: SyntheticDecisionTransport) {}
  async score(request: DecisionRequest, { signal }: { signal: AbortSignal }): Promise<DecisionResult> {
    signal.throwIfAborted();
    const validated = DecisionRequestSchema.parse(request);
    return validateDecisionResult(validated, await this.transport.send(validated, signal));
  }
}

export const syntheticUsage = normalizeUsage({
  inputTokens: 20, outputTokens: 10, reasoningTokens: 4, cacheReadTokens: 5, cacheWriteTokens: null,
  reasoningIsOutputSubset: true, cacheReadIsInputSubset: true, reportedCostUSD: null,
  rawUsage: { synthetic: true, input: 20, output: 10, reasoningIncludedInOutput: 4, cacheIncludedInInput: 5 },
});
export const syntheticRequest: GenerationRequest = {
  turns: [{ type: 'message', role: 'user', text: 'Summarize the synthetic weight fixture.' }],
  tools: [{ name: 'summarize_metric', description: 'Synthetic read only.', parameters: { type: 'object', properties: { metric: { const: 'weight' } }, required: ['metric'], additionalProperties: false } }],
  continuation: null,
};
export function generationReplies(family: GenerationFamily): readonly (readonly GenerationEvent[])[] {
  return [
    [
      { type: 'text.delta', text: 'Checking the synthetic fixture. ' },
      { type: 'tool.call', call: { callId: 'synthetic-call-1', name: 'summarize_metric', arguments: { metric: 'weight' } } },
      { type: 'completed', finishReason: 'tool_calls', continuation: { family, data: { signature: 'synthetic-opaque-do-not-rewrite', callId: 'synthetic-call-1' } } },
    ],
    [
      { type: 'text.delta', text: 'The synthetic mean is 69.7 kg.' }, { type: 'usage', usage: syntheticUsage },
      { type: 'completed', finishReason: 'stop', continuation: null },
    ],
  ];
}

// A bounded contract exerciser, not the application's future authenticated tool loop.
export async function exerciseGeneration(adapter: GenerationAdapter, signal: AbortSignal) {
  const first = [];
  for await (const event of adapter.generate(syntheticRequest, { signal })) first.push(event);
  const calls = first.filter((event) => event.type === 'tool.call');
  const completed = first.filter((event) => event.type === 'completed');
  if (calls.length !== 1 || completed.length !== 1 || completed[0]?.finishReason !== 'tool_calls') throw new Error('invalid_synthetic_tool_turn');
  const call = calls[0]!.call;
  if (call.name !== 'summarize_metric') throw new Error('unapproved_synthetic_tool');
  z.strictObject({ metric: z.literal('weight') }).parse(call.arguments);
  const next: GenerationRequest = {
    ...syntheticRequest,
    turns: [...syntheticRequest.turns, { type: 'tool_call', ...call }, { type: 'tool_result', callId: call.callId, name: call.name, result: { value: 69.7, unit: 'kg', synthetic: true } }],
    continuation: completed[0]!.continuation,
  };
  const second = [];
  for await (const event of adapter.generate(next, { signal })) second.push(event);
  if (second.filter((event) => event.type === 'completed').length !== 1 || second.at(-1)?.type !== 'completed') throw new Error('invalid_synthetic_final_turn');
  return { first, second };
}

export const syntheticDecisionRequest: DecisionRequest = {
  state: { synthetic: true, task: 'fixture routing' },
  questions: [{ id: 'depth', instructions: 'Score these synthetic routing choices.', choices: ['everyday', 'clarify'] }], policy: { version: 'synthetic:v1' },
};
export const syntheticDecisionResult = {
  scores: { depth: { everyday: 0.8, clarify: 0.2 } }, usage: syntheticUsage, rawResponse: { synthetic: true },
};

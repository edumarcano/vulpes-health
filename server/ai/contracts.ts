import { z } from 'zod';
import { CountSchema, DecimalUSDSchema } from '../../shared/primitives.js';
import { API_JSON_LIMIT_BYTES } from '../../shared/api.js';
import type { PaidRequestDispatcher } from './ledger/dispatcher.js';

export const GenerationFamilySchema = z.enum(['openrouter_responses', 'vertex_generate_content']);
export type GenerationFamily = z.infer<typeof GenerationFamilySchema>;
export const GenerationCapabilitiesSchema = z.strictObject({ streaming: z.boolean(), tools: z.boolean() });
export type GenerationCapabilities = z.infer<typeof GenerationCapabilitiesSchema>;
export const ProviderContinuationSchema = z.strictObject({ family: GenerationFamilySchema, data: z.json() });
export const ToolCallSchema = z.strictObject({ callId: z.string().min(1), name: z.string().min(1), arguments: z.json() });
export const GenerationRequestSchema = z.strictObject({
  turns: z.array(z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('message'), role: z.enum(['system', 'user', 'assistant']), text: z.string() }),
    ToolCallSchema.extend({ type: z.literal('tool_call') }),
    z.strictObject({ type: z.literal('tool_result'), callId: z.string().min(1), name: z.string().min(1), result: z.json() }),
  ])).min(1),
  tools: z.array(z.strictObject({ name: z.string().min(1), description: z.string(), parameters: z.record(z.string(), z.json()) })),
  continuation: ProviderContinuationSchema.nullable(),
}).superRefine((value, ctx) => {
  const pending = new Map<string, string>();
  const seen = new Set<string>();
  for (const turn of value.turns) {
    if (turn.type === 'tool_call') {
      if (seen.has(turn.callId)) ctx.addIssue({ code: 'custom', message: 'Repeated tool call ID.' });
      seen.add(turn.callId);
      pending.set(turn.callId, turn.name);
    } else if (turn.type === 'tool_result') {
      if (pending.get(turn.callId) !== turn.name) ctx.addIssue({ code: 'custom', message: 'Unmatched tool result.' });
      pending.delete(turn.callId);
    }
  }
  if (pending.size) ctx.addIssue({ code: 'custom', message: 'Tool calls require matching results.' });
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > API_JSON_LIMIT_BYTES) ctx.addIssue({ code: 'custom', message: 'Generation input exceeds limit.' });
});
export type GenerationRequest = z.infer<typeof GenerationRequestSchema>;

// Reported totals and their subsets remain separate. Pricing/settlement belongs to the ledger.
export const NormalizedUsageSchema = z.strictObject({
  inputTokens: CountSchema.nullable().default(null), outputTokens: CountSchema.nullable().default(null),
  reasoningTokens: CountSchema.nullable().default(null), cacheReadTokens: CountSchema.nullable().default(null), cacheWriteTokens: CountSchema.nullable().default(null),
  reasoningIsOutputSubset: z.boolean().nullable().default(null), cacheReadIsInputSubset: z.boolean().nullable().default(null),
  cacheWriteIsInputSubset: z.boolean().nullable().default(null),
  reportedCostUSD: DecimalUSDSchema.nullable().default(null), rawUsage: z.json(),
});
export type NormalizedUsage = z.infer<typeof NormalizedUsageSchema>;
export function normalizeUsage(value: unknown): NormalizedUsage { return NormalizedUsageSchema.parse(value); }

export const GenerationEventSchema = z.discriminatedUnion('type', [
  z.strictObject({ type: z.literal('text.delta'), text: z.string() }),
  z.strictObject({ type: z.literal('tool.call'), call: ToolCallSchema }),
  z.strictObject({ type: z.literal('usage'), usage: NormalizedUsageSchema }),
  z.strictObject({ type: z.literal('completed'), finishReason: z.enum(['stop', 'tool_calls', 'length', 'blocked']), continuation: ProviderContinuationSchema.nullable() }),
]);
export type GenerationEvent = z.infer<typeof GenerationEventSchema>;
export interface GenerationAdapter {
  readonly family: GenerationFamily;
  readonly capabilities: GenerationCapabilities;
  generate(request: GenerationRequest, options: { signal: AbortSignal; dispatch: PaidRequestDispatcher }): AsyncIterable<GenerationEvent>;
}

export const DecisionRequestSchema = z.strictObject({
  state: z.json(),
  questions: z.array(z.strictObject({ id: z.string().min(1), instructions: z.string(), choices: z.array(z.string().min(1)).min(2) })).min(1),
  policy: z.strictObject({ version: z.string().min(1) }),
}).superRefine((value, ctx) => {
  const ids = value.questions.map((question) => question.id);
  if (new Set(ids).size !== ids.length || value.questions.some((question) => new Set(question.choices).size !== question.choices.length)) {
    ctx.addIssue({ code: 'custom', message: 'Question and choice IDs must be unique.' });
  }
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > API_JSON_LIMIT_BYTES) ctx.addIssue({ code: 'custom', message: 'Decision input exceeds limit.' });
});
export const DecisionResultSchema = z.strictObject({
  scores: z.record(z.string(), z.record(z.string(), z.number().finite())), usage: NormalizedUsageSchema.nullable(), rawResponse: z.json(),
});
export type DecisionRequest = z.infer<typeof DecisionRequestSchema>;
export type DecisionResult = z.infer<typeof DecisionResultSchema>;
export interface DecisionAdapter {
  readonly family: 'openrouter_decisions';
  score(request: DecisionRequest, options: { signal: AbortSignal }): Promise<DecisionResult>;
}

export function requireGenerationCapabilities(adapter: Pick<GenerationAdapter, 'family' | 'capabilities'>, request: GenerationRequest): GenerationRequest {
  const parsed = GenerationRequestSchema.parse(request);
  const needsTools = parsed.tools.length > 0 || parsed.turns.some((turn) => turn.type !== 'message');
  if (!adapter.capabilities.streaming || (needsTools && !adapter.capabilities.tools)) throw new Error('unsupported_capability');
  if (parsed.continuation && parsed.continuation.family !== adapter.family) throw new Error('incompatible_continuation');
  return parsed;
}

export function validateDecisionResult(request: DecisionRequest, input: unknown): DecisionResult {
  const result = DecisionResultSchema.parse(input);
  const questions = request.questions;
  if (Object.keys(result.scores).length !== questions.length || questions.some((question) => {
    const scores = Object.hasOwn(result.scores, question.id) ? result.scores[question.id] : undefined;
    return !scores || Object.keys(scores).length !== question.choices.length || question.choices.some((choice) => !Object.hasOwn(scores, choice));
  })) throw new Error('invalid_decision_keys');
  // Vendor-specific score ranges/mapping are intentionally deferred to PR 14.
  return result;
}

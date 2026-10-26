import { z } from 'zod';
import { CountSchema, VersionSchema } from '../../shared/primitives.js';
import type { ModelRole } from '../../shared/primitives.js';
import { GenerationCapabilitiesSchema } from '../ai/contracts.js';
import { VerifiedPriceSchema } from '../ai/ledger/pricing.js';

const unverifiedPrice = z.strictObject({
  status: z.literal('unverified'), currency: z.literal('USD'), checkedAt: z.null(), sourceURL: z.null(),
  inputPerMillion: z.null(), outputPerMillion: z.null(), cacheReadPerMillion: z.null(), cacheWritePerMillion: z.null(), otherFees: z.null(),
});
const common = {
  modelId: z.string().min(1), maxInputTokens: VersionSchema,
  price: z.discriminatedUnion('status',[unverifiedPrice,VerifiedPriceSchema]), liveSmokeStatus: z.literal('not_run'),
};
export const ModelConfigSchema = z.discriminatedUnion('apiFamily', [
  z.strictObject({
    ...common, role: z.literal('everyday'), provider: z.literal('openrouter'), apiFamily: z.literal('openrouter_responses'),
    enabledByDefault: z.boolean(), reasoning: z.strictObject({ effort: z.enum(['low', 'medium', 'high']) }),
    maxOutputTokens: VersionSchema, privacyPolicy: z.literal('openrouter_zdr_required'), capabilities: GenerationCapabilitiesSchema,
  }),
  z.strictObject({
    ...common, role: z.enum(['intermediate', 'advanced']), provider: z.literal('vertex_ai'), apiFamily: z.literal('vertex_generate_content'),
    enabledByDefault: z.boolean(), thinking: z.strictObject({ level: z.enum(['LOW', 'MEDIUM', 'HIGH']) }),
    maxOutputTokens: VersionSchema, privacyPolicy: z.literal('google_cloud_accepted_retention'), capabilities: GenerationCapabilitiesSchema,
  }),
  z.strictObject({
    ...common, role: z.literal('decision'), provider: z.literal('openrouter'), apiFamily: z.literal('openrouter_decisions'),
    enabledByDefault: z.literal(false), maxOutputTokens: z.null(), capabilities: z.strictObject({ scoring: z.literal(true) }), privacyPolicy: z.literal('openrouter_zdr_required'),
  }),
]);
export type ModelConfig = z.infer<typeof ModelConfigSchema>;
const price = { status: 'unverified', currency: 'USD', checkedAt: null, sourceURL: null, inputPerMillion: null, outputPerMillion: null, cacheReadPerMillion: null, cacheWritePerMillion: null, otherFees: null } as const;
const capabilities = { streaming: true, tools: true } as const;

// Declared application settings only. These values never confer live availability.
export const models = {
  everyday: {
    role: 'everyday', provider: 'openrouter', apiFamily: 'openrouter_responses', modelId: 'openai/gpt-6-luna', enabledByDefault: true,
    reasoning: { effort: 'low' }, maxInputTokens: 12000, maxOutputTokens: 3072, privacyPolicy: 'openrouter_zdr_required', capabilities, price, liveSmokeStatus: 'not_run',
  },
  intermediate: {
    role: 'intermediate', provider: 'vertex_ai', apiFamily: 'vertex_generate_content', modelId: 'gemini-3.8-flash', enabledByDefault: true,
    thinking: { level: 'MEDIUM' }, maxInputTokens: 24000, maxOutputTokens: 8192, privacyPolicy: 'google_cloud_accepted_retention', capabilities, price, liveSmokeStatus: 'not_run',
  },
  advanced: {
    role: 'advanced', provider: 'vertex_ai', apiFamily: 'vertex_generate_content', modelId: 'gemini-4-argon', enabledByDefault: true,
    thinking: { level: 'MEDIUM' }, maxInputTokens: 48000, maxOutputTokens: 12288, privacyPolicy: 'google_cloud_accepted_retention', capabilities, price, liveSmokeStatus: 'not_run',
  },
  decision: {
    role: 'decision', provider: 'openrouter', apiFamily: 'openrouter_decisions', modelId: 'microsoft/microsoft-decision-1', enabledByDefault: false,
    maxInputTokens: 2048, maxOutputTokens: null, privacyPolicy: 'openrouter_zdr_required', capabilities: { scoring: true }, price, liveSmokeStatus: 'not_run',
  },
} as const satisfies Record<ModelRole, ModelConfig>;

export const RoleAvailabilitySchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('disabled'), reason: z.literal('optional_decision_disabled') }),
  z.strictObject({ state: z.literal('unavailable'), reason: z.literal('live_inference_not_implemented') }),
]);
export type RoleAvailability = z.infer<typeof RoleAvailabilitySchema>;
export function getRoleAvailability(role: ModelRole): RoleAvailability {
  return role === 'decision' ? { state: 'disabled', reason: 'optional_decision_disabled' } : { state: 'unavailable', reason: 'live_inference_not_implemented' };
}
// Force schema checks on configuration changes without consulting environment or credentials.
for (const model of Object.values(models)) ModelConfigSchema.parse(model);

export const prototypeRunLimits = {
  modelRequests: CountSchema.parse(4), toolCalls: CountSchema.parse(6), applicationDeadlineSeconds: CountSchema.parse(210),
} as const;

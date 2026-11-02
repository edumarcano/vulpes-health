import { everydayProductionEvidence,everydayMaxRunCostUSD,ProductionEvidenceSchema,openRouterPolicyHash } from './everyday-production.js';
import { providerPolicies } from '../security/consent.js';
import { z } from 'zod';
import { CountSchema, VersionSchema } from '../../shared/primitives.js';
import type { ModelRole } from '../../shared/primitives.js';
import { GenerationCapabilitiesSchema } from '../ai/contracts.js';
import { VerifiedPriceSchema } from '../ai/ledger/pricing.js';
import { assessEverydayPreflight,LiveSmokeEvidenceSchema } from '../ai/live-preflight.js';
import { everydayCapabilityEvidence } from './everyday-verification.js';
import { everydayAdapterVersion,everydayTemplateVersion } from './everyday-versions.js';

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
    reasoning: { effort: 'low' }, maxInputTokens: 12000, maxOutputTokens: 3072, privacyPolicy: 'openrouter_zdr_required', capabilities,
    price: {
      status:'verified',id:'openrouter-gpt-6-luna-20261027-conservative',currency:'USD',checkedAt:'2026-10-27T22:20:31.355Z',
      sourceURL:'https://openrouter.ai/api/v1/models/openai/gpt-6-luna/endpoints',
      inputPerMillion:'0.20',outputPerMillion:'1.00',cacheReadPerMillion:'0.02',cacheWritePerMillion:'0.25',otherFees:'0',
      inputBoundTokens:12000,outputBoundTokens:3072,reasoningBilling:'included_in_output',reasoningPerMillion:'0',reasoningBoundTokens:0,
      outputLimitVerified:true,inputBoundVerified:true,
    },liveSmokeStatus: 'not_run',
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
  z.strictObject({ state: z.literal('available'), reason: z.literal('verified') }),
  z.strictObject({ state: z.literal('disabled'), reason: z.literal('optional_decision_disabled') }),
  z.strictObject({ state: z.literal('unavailable'), reason: z.enum(['live_inference_not_implemented','live_ai_disabled','price_unverified','price_bounds_mismatch','capability_privacy_unverified','capability_evidence_mismatch','insufficient_spend_ceiling','live_smoke_unverified','live_smoke_mismatch','production_approval_unverified','production_policy_mismatch']) }),
]);
export type RoleAvailability = z.infer<typeof RoleAvailabilitySchema>;
export function getRoleAvailability(role: ModelRole,liveEnabled=true): RoleAvailability {
  if(role==='decision')return {state:'disabled',reason:'optional_decision_disabled'};
  if(role!=='everyday')return {state:'unavailable',reason:'price_unverified'};
  const model=models.everyday;
  const approval=ProductionEvidenceSchema.safeParse(everydayProductionEvidence);
  const readiness=assessEverydayPreflight({enabled:liveEnabled,mode:'production',model:model.modelId,effort:model.reasoning.effort,
    adapterVersion:everydayAdapterVersion,templateVersion:everydayTemplateVersion,
    maxInputTokens:model.maxInputTokens,maxOutputTokens:model.maxOutputTokens,price:model.price,capabilities:everydayCapabilityEvidence,smoke:approval.success?LiveSmokeEvidenceSchema.strip().parse(approval.data):null,
    maxCostUSD:everydayMaxRunCostUSD});
  if(readiness.state==='unavailable')return RoleAvailabilitySchema.parse(readiness);
  if(!approval.success)return {state:'unavailable',reason:'production_approval_unverified'};
  if(approval.data.policyVersion!==providerPolicies.openrouter.version||approval.data.policyHash!==openRouterPolicyHash()||Date.parse(approval.data.ownerApprovedAt)<Date.parse(approval.data.checkedAt))return {state:'unavailable',reason:'production_policy_mismatch'};
  return {state:'available',reason:'verified'};
}
// Force schema checks on configuration changes without consulting environment or credentials.
for (const model of Object.values(models)) ModelConfigSchema.parse(model);

export const prototypeRunLimits = {
  modelRequests: CountSchema.parse(4), toolCalls: CountSchema.parse(6), applicationDeadlineSeconds: CountSchema.parse(210),
} as const;

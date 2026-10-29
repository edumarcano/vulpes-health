import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { VerifiedPriceSchema,reserveMaximum } from './ledger/pricing.js';
import { priceFingerprint } from './live-preflight.js';
import { models } from '../config/models.js';
import { vertexAdapterVersion } from './providers/vertex.js';
import { everydayTemplateVersion } from '../config/everyday-versions.js';

export const VertexEvidenceSchema=z.strictObject({
  model:z.string(),effort:z.literal('MEDIUM'),project:z.string(),location:z.enum(['global','us','eu']),policyVersion:z.string(),privacyFingerprint:z.string().regex(/^[a-f0-9]{64}$/),
  adapterVersion:z.string(),templateVersion:z.string(),priceHash:z.string(),checkedAt:z.iso.datetime(),streaming:z.literal(true),tools:z.literal(true),
  inputBoundTokens:z.number().int().positive(),outputBoundTokens:z.number().int().positive(),
});
export type VertexEvidence=z.infer<typeof VertexEvidenceSchema>;
// Public documentation is not account access, policy approval or live smoke evidence.
export const vertexEvidence:Record<'intermediate'|'advanced',VertexEvidence|null>={intermediate:null,advanced:null};
export function assessVertex(role:'intermediate'|'advanced',input:{enabled:boolean;project:string|undefined;location:string|undefined;ceiling:string;evidence:unknown;price?:unknown}) {
  if(!input.enabled)return {state:'unavailable' as const,reason:'live_ai_disabled'};
  const model=models[role];const price=VerifiedPriceSchema.safeParse(input.price??model.price);
  if(!price.success)return {state:'unavailable' as const,reason:'price_unverified'};
  const evidence=VertexEvidenceSchema.safeParse(input.evidence);
  if(!evidence.success)return {state:'unavailable' as const,reason:'capability_privacy_unverified'};
  const e=evidence.data;
  if(e.model!==model.modelId||e.effort!==model.thinking.level||e.project!==input.project||e.location!==input.location||e.adapterVersion!==vertexAdapterVersion||e.templateVersion!==everydayTemplateVersion||e.priceHash!==priceFingerprint(price.data)||e.inputBoundTokens!==model.maxInputTokens||e.outputBoundTokens!==model.maxOutputTokens||price.data.inputBoundTokens!==model.maxInputTokens||price.data.outputBoundTokens!==model.maxOutputTokens||Date.parse(e.checkedAt)<Date.parse(price.data.checkedAt))return {state:'unavailable' as const,reason:'capability_evidence_mismatch'};
  if(!/^\d+(\.\d+)?$/.test(input.ceiling)||new Decimal(input.ceiling).lt(reserveMaximum(price.data)))return {state:'unavailable' as const,reason:'insufficient_spend_ceiling'};
  return {state:'ready' as const,evidence:e,price:price.data};
}

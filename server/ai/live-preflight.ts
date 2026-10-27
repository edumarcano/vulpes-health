import { Decimal } from 'decimal.js';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ISOInstantSchema, DecimalUSDSchema, HashSchema } from '../../shared/primitives.js';
import { reserveMaximum, VerifiedPriceSchema } from './ledger/pricing.js';

// Operator-maintained evidence refers to the exact catalog configuration. A
// switch or a successful test of an earlier model cannot authorize this route.
export const LiveCapabilityEvidenceSchema=z.strictObject({
  version:z.literal(1),provider:z.literal('openrouter'),model:z.string().min(1),effort:z.enum(['low','medium','high']),
  adapterVersion:z.string().min(1),templateVersion:z.string().min(1),priceId:z.string().min(1),priceHash:HashSchema,inputBoundTokens:z.number().int().positive(),outputBoundTokens:z.number().int().positive(),
  streaming:z.literal(true),tools:z.literal(true),zdr:z.literal(true),checkedAt:ISOInstantSchema,sourceURL:z.url(),
});
export const LiveSmokeEvidenceSchema=z.strictObject({
  version:z.literal(1),provider:z.literal('openrouter'),model:z.string().min(1),effort:z.enum(['low','medium','high']),
  adapterVersion:z.string().min(1),templateVersion:z.string().min(1),priceId:z.string().min(1),priceHash:HashSchema,runId:z.uuid(),checkedAt:ISOInstantSchema,result:z.literal('passed'),
});
export function priceFingerprint(input:unknown):string {return createHash('sha256').update(JSON.stringify(VerifiedPriceSchema.parse(input))).digest('hex');}
export type LiveReadiness = {state:'ready'} | {state:'unavailable';reason:string};
export function assessEverydayPreflight(input:{
  enabled:boolean;mode:'verification'|'production';model:string;effort:string;adapterVersion:string;templateVersion:string;maxInputTokens:number;maxOutputTokens:number;
  price:unknown;capabilities:unknown;smoke:unknown;maxCostUSD:string;
}):LiveReadiness {
  const denied=(reason:string):LiveReadiness=>({state:'unavailable',reason});
  if(!input.enabled)return denied('live_ai_disabled');
  const price=VerifiedPriceSchema.safeParse(input.price);
  if(!price.success)return denied('price_unverified');
  if(price.data.inputBoundTokens!==input.maxInputTokens||price.data.outputBoundTokens!==input.maxOutputTokens)return denied('price_bounds_mismatch');
  const capability=LiveCapabilityEvidenceSchema.safeParse(input.capabilities);
  if(!capability.success)return denied('capability_privacy_unverified');
  const record=capability.data;
  if(record.model!==input.model||record.effort!==input.effort||record.adapterVersion!==input.adapterVersion||record.templateVersion!==input.templateVersion||record.priceId!==price.data.id||record.priceHash!==priceFingerprint(price.data)||record.inputBoundTokens!==input.maxInputTokens||record.outputBoundTokens!==input.maxOutputTokens||Date.parse(record.checkedAt)<Date.parse(price.data.checkedAt))return denied('capability_evidence_mismatch');
  const ceiling=DecimalUSDSchema.safeParse(input.maxCostUSD);
  if(!ceiling.success||new Decimal(ceiling.data).lessThan(reserveMaximum(price.data)))return denied('insufficient_spend_ceiling');
  if(input.mode==='production') {
    const smoke=LiveSmokeEvidenceSchema.safeParse(input.smoke);
    if(!smoke.success)return denied('live_smoke_unverified');
    if(smoke.data.model!==input.model||smoke.data.effort!==input.effort||smoke.data.adapterVersion!==input.adapterVersion||smoke.data.templateVersion!==input.templateVersion||smoke.data.priceId!==price.data.id||smoke.data.priceHash!==priceFingerprint(price.data)||Date.parse(smoke.data.checkedAt)<Date.parse(record.checkedAt))return denied('live_smoke_mismatch');
  }
  return {state:'ready'};
}

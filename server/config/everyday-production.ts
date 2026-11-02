import { z } from 'zod';
import { createHash } from 'node:crypto';
import { LiveSmokeEvidenceSchema } from '../ai/live-preflight.js';
import { providerPolicies } from '../security/consent.js';

export const ProductionEvidenceSchema = LiveSmokeEvidenceSchema.extend({
  policyVersion:z.string().min(1), policyHash:z.string().regex(/^[a-f0-9]{64}$/),
  safetyEvaluationId:z.uuid(), ownerApprovedAt:z.iso.datetime(),
});
export function openRouterPolicyHash():string {
  return createHash('sha256').update(JSON.stringify(providerPolicies.openrouter)).digest('hex');
}
// Owner-approved Luna-only pilot. The live switch, consent and durable budgets
// remain independent gates; these public bindings contain no credentials.
export const everydayProductionEvidence:z.infer<typeof ProductionEvidenceSchema>|null = {
  version:1,provider:'openrouter',model:'openai/gpt-6-luna',effort:'low',
  adapterVersion:'openrouter-responses-v2',templateVersion:'vulpes-everyday-v7',
  priceId:'openrouter-gpt-6-luna-20261031-conservative',priceHash:'0a5a7a4099aeff7c38bcc37991a7f8243f534c4a870069ad3e20bb93d466bc2f',
  runId:'91fda175-7102-4988-8a9c-ab5ba24337a1',checkedAt:'2026-10-31T23:51:37.831Z',result:'passed',
  policyVersion:'openrouter_zdr_v2',policyHash:'c4446166b4f12430000892d989c682d5e5e1f6dbdcce8987b09c80465b37f1d5',
  safetyEvaluationId:'d741ba54-58a7-49ff-9213-4a33d17d70b8',ownerApprovedAt:'2026-11-02T04:41:02.340Z',
};
export const everydayMaxRunCostUSD:string = '0.04';

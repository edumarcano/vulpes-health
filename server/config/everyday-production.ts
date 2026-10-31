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
// Installed only after current live evaluation and explicit owner approval.
export const everydayProductionEvidence:z.infer<typeof ProductionEvidenceSchema>|null = null;
export const everydayMaxRunCostUSD:string = '0';

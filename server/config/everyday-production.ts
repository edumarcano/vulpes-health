import { z } from 'zod';
import { createHash } from 'node:crypto';
import { LiveSmokeEvidenceSchema } from '../ai/live-preflight.js';
import { providerPolicies } from '../security/consent.js';

export const ProductionEvidenceSchema = LiveSmokeEvidenceSchema.extend({
  policyVersion: z.string().min(1),
  policyHash: z.string().regex(/^[a-f0-9]{64}$/),
  safetyEvaluationId: z.uuid(),
  ownerApprovedAt: z.iso.datetime(),
  assessment: z
    .discriminatedUnion('scope', [
      z.strictObject({
        scope: z.literal('technical_controls'),
        modelQuality: z.literal('deferred_by_owner'),
        ownerDecisionAt: z.iso.datetime(),
      }),
      z.strictObject({
        scope: z.literal('technical_and_model'),
        modelQuality: z.literal('reviewed'),
      }),
    ])
    .optional(),
});
export function openRouterPolicyHash(): string {
  return createHash('sha256')
    .update(JSON.stringify(providerPolicies.openrouter))
    .digest('hex');
}
// Owner-approved Luna-only pilot. The live switch, consent and durable budgets
// remain independent gates; these public bindings contain no credentials.
export const everydayProductionEvidence: z.infer<
  typeof ProductionEvidenceSchema
> | null = {
  version: 1,
  provider: 'openrouter',
  model: 'openai/gpt-6-luna',
  effort: 'low',
  adapterVersion: 'openrouter-responses-v2',
  templateVersion: 'vulpes-everyday-v9',
  priceId: 'openrouter-gpt-6-luna-20261031-conservative',
  priceHash: '0a5a7a4099aeff7c38bcc37991a7f8243f534c4a870069ad3e20bb93d466bc2f',
  runId: '07f6cff8-95dd-4449-8237-36299101233c',
  checkedAt: '2026-11-05T17:59:14.859Z',
  result: 'passed',
  policyVersion: 'openrouter_zdr_v2',
  policyHash:
    'c4446166b4f12430000892d989c682d5e5e1f6dbdcce8987b09c80465b37f1d5',
  safetyEvaluationId: '2505bb84-d2c7-4af1-a1fc-a118d4b4f1a6',
  ownerApprovedAt: '2026-11-05T18:02:35.635Z',
  assessment: {
    scope: 'technical_controls',
    modelQuality: 'deferred_by_owner',
    ownerDecisionAt: '2026-11-05T18:02:35.635Z',
  },
};
export const everydayMaxRunCostUSD: string = '0.04';

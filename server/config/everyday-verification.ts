import type { z } from 'zod';
import type { LiveCapabilityEvidenceSchema } from '../ai/live-preflight.js';

// Public protocol/endpoint evidence authorizes only the separately opted-in
// synthetic verification route. Production still requires matching live evidence.
// See docs/evidence/m3-live-everyday-readiness.md at commit ee4e040 for rates and privacy limitations.
export const everydayCapabilityEvidence: z.infer<
  typeof LiveCapabilityEvidenceSchema
> | null = {
  version: 1,
  provider: 'openrouter',
  model: 'openai/gpt-6-luna',
  effort: 'low',
  adapterVersion: 'openrouter-responses-v2',
  templateVersion: 'vulpes-everyday-v10',
  priceId: 'openrouter-gpt-6-luna-20261031-conservative',
  priceHash: '0a5a7a4099aeff7c38bcc37991a7f8243f534c4a870069ad3e20bb93d466bc2f',
  inputBoundTokens: 12000,
  outputBoundTokens: 3072,
  streaming: true,
  tools: true,
  zdr: true,
  checkedAt: '2026-11-10T22:42:17.699Z',
  sourceURL: 'https://openrouter.ai/api/v1/endpoints/zdr',
};

import type { z } from 'zod';
import type { LiveCapabilityEvidenceSchema } from '../ai/live-preflight.js';

// Public protocol/endpoint evidence authorizes only the separately opted-in
// synthetic verification route. Production still requires matching live evidence.
// See docs/evidence/m3-live-everyday-readiness.md for rates and privacy limitations.
export const everydayCapabilityEvidence: z.infer<typeof LiveCapabilityEvidenceSchema> | null = {
  version:1,provider:'openrouter',model:'openai/gpt-6-luna',effort:'low',
  adapterVersion:'openrouter-responses-v2',templateVersion:'vulpes-everyday-v2',
  priceId:'openrouter-gpt-6-luna-20261027-conservative',priceHash:'7e9dcc1793067b0e991ef850f3a03d9513a00ec6ffc604d2de4b153e4f59f9f0',
  inputBoundTokens:12000,outputBoundTokens:3072,streaming:true,tools:true,zdr:true,
  checkedAt:'2026-10-27T22:53:33.676Z',sourceURL:'https://openrouter.ai/api/v1/endpoints/zdr',
};

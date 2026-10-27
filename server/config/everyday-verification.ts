import type { z } from 'zod';
import type { LiveCapabilityEvidenceSchema } from '../ai/live-preflight.js';

// Populate only after the model, price, capabilities, and privacy route have
// been separately verified and approved. This is deliberately not an env override.
export const everydayCapabilityEvidence: z.infer<typeof LiveCapabilityEvidenceSchema> | null = null;

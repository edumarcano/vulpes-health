import { z } from 'zod';
import type { Provider } from '../../shared/auth.js';
import { ISOInstantSchema } from '../../shared/primitives.js';

export const providerPolicies = {
  openrouter: {
    version: 'openrouter_zdr_v2', acceptanceAvailable: true,
    notice: 'Allow requests through OpenRouter with required ZDR endpoint routing. OpenRouter announces in-flight safety screening of all traffic, including ZDR; flagged content may be retained for review, reporting or legal preservation. Effective terms must be verified before activation. Consent does not enable inference. Revoking stops future routing; it cannot retract data already transmitted.',
  },
  vertex_ai: {
    version: 'google_cloud_pending_v1', acceptanceAvailable: false,
    notice: 'Google Cloud consent is unavailable until the operator selects a supported region and accepted retention policy. No-training commitments do not mean every request has zero retention.',
  },
} as const;
const StoredConsentSchema = z.object({ accepted_version: z.string().nullable(), accepted_at: ISOInstantSchema.nullable() });
export function consentState(value: unknown, provider: Provider, approvedPolicy?:{version:string;acceptanceAvailable:boolean;notice:string}) {
  const policy = approvedPolicy ?? providerPolicies[provider];
  const parsed = StoredConsentSchema.safeParse(value);
  const stored = parsed.success ? parsed.data : { accepted_version: null, accepted_at: null };
  return {
    provider, accepted: policy.acceptanceAvailable && stored.accepted_version === policy.version && stored.accepted_at !== null,
    acceptedVersion: stored.accepted_version, acceptedAt: stored.accepted_at,
    policyVersion: policy.version, acceptanceAvailable: policy.acceptanceAvailable, notice: policy.notice,
  };
}

import { z } from 'zod';
import { IanaTimezoneSchema, ISOInstantSchema, UUIDSchema } from './primitives.js';

export const ProviderSchema = z.enum(['openrouter', 'vertex_ai']);
export const UnitsSchema = z.enum(['metric', 'imperial']);
export const DisplayNameSchema = z.string().trim().min(1).max(200).nullable();
export const ConsentChangeSchema = z.strictObject({ provider: ProviderSchema, accepted: z.boolean(), policy_version: z.string().min(1).max(100) });
export const SettingsPatchSchema = z.strictObject({
  client_request_id: UUIDSchema, expected_updated_at: ISOInstantSchema,
  changes: z.strictObject({
    display_name: DisplayNameSchema.optional(), timezone: IanaTimezoneSchema.max(100).optional(),
    units: UnitsSchema.optional(), provider_consent: ConsentChangeSchema.optional(),
  }).refine((changes) => Object.keys(changes).length > 0, 'Choose a setting to change.'),
});
export const ProviderConsentSchema = z.strictObject({
  provider: ProviderSchema, accepted: z.boolean(), acceptedVersion: z.string().nullable(), acceptedAt: ISOInstantSchema.nullable(),
  policyVersion: z.string(), acceptanceAvailable: z.boolean(), notice: z.string(),
});
export const SettingsSchema = z.strictObject({
  profile: z.strictObject({ userId: UUIDSchema, displayName: DisplayNameSchema, timezone: IanaTimezoneSchema, units: UnitsSchema, updatedAt: ISOInstantSchema }),
  providerConsents: z.array(ProviderConsentSchema).length(2),
  retention: z.strictObject({ traceDays: z.literal(7), importStagingHours: z.literal(24) }),
});
export const AuthenticatedStatusSchema = z.strictObject({
  status: z.literal('ok'), features: z.strictObject({ settings: z.literal(true), healthWorkflows: z.literal(true), inference: z.literal(false) }),
  roles: z.strictObject({ everyday: z.literal('unavailable'), intermediate: z.literal('unavailable'), advanced: z.literal('unavailable'), decision: z.literal('disabled') }),
});
export type Provider = z.infer<typeof ProviderSchema>;
export type SettingsPatch = z.infer<typeof SettingsPatchSchema>;
export type Settings = z.infer<typeof SettingsSchema>;

export interface PublicAuthConfig { url: string; key: string }
export function publicAuthConfig(url: string | undefined, key: string | undefined): PublicAuthConfig | null {
  if (!url && !key) return null;
  try {
    if (!url || !key) throw new Error();
    const parsed = new URL(url);
    const local = ['127.0.0.1', 'localhost', '[::1]'].includes(parsed.hostname);
    if ((parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== '/') throw new Error();
    if (!/^sb_publishable_[\w-]+$/.test(key)) {
      const parts = key.split('.');
      if (parts.length !== 3 || JSON.parse(atob(parts[1]!.replaceAll('-', '+').replaceAll('_', '/'))).role !== 'anon') throw new Error();
    }
    return { url: parsed.origin, key };
  } catch { throw new Error('Public authentication configuration is invalid.'); }
}

import { SettingsSchema, type Provider, type SettingsPatch } from '../../shared/auth.js';
import type { AuthContext } from '../auth/session.js';
import { HttpFailure } from '../http/failure.js';
import { consentState } from '../security/consent.js';
import type { Database } from '../db/database.types.js';

async function settingsDTO(context:AuthContext,profile: Database['public']['Tables']['profiles']['Row']) {
  const {data:budget,error}=await context.db.rpc('read_budget_v1');
  if(error)throw new HttpFailure(503,'settings_unavailable','Spending information could not be loaded.');
  const stored = profile.consent_versions && typeof profile.consent_versions === 'object' && !Array.isArray(profile.consent_versions) ? profile.consent_versions : {};
  const {data:approval,error:policyError}=await context.db.rpc('read_vertex_policy_v1',{p_project:process.env.GOOGLE_CLOUD_PROJECT??'',p_location:process.env.GOOGLE_CLOUD_LOCATION??''});
  if(policyError)throw new HttpFailure(503,'settings_unavailable','Provider policy could not be checked.');
  const google=approval&&typeof approval==='object'&&!Array.isArray(approval)&&typeof approval.version==='string'&&typeof approval.notice==='string'?{version:approval.version,acceptanceAvailable:true,notice:approval.notice}:undefined;
  return SettingsSchema.parse({
    profile: { userId: profile.user_id, displayName: profile.display_name, timezone: profile.timezone, units: profile.units, updatedAt: profile.updated_at },
    providerConsents: (['openrouter', 'vertex_ai'] as const).map((provider) => consentState(stored[provider], provider,provider==='vertex_ai'?google:undefined)),
    retention: { traceDays: 7, importStagingHours: 24 },
    budget,
  });
}
export async function getSettings(context: AuthContext) {
  const { data, error } = await context.db.from('profiles').select('*').eq('user_id', context.userId).single();
  if (error || data.account_state !== 'active') throw new HttpFailure(503, 'settings_unavailable', 'Settings could not be loaded.');
  return settingsDTO(context,data);
}
export async function updateSettings(context: AuthContext, request: SettingsPatch) {
  const { data, error } = await context.db.rpc('update_settings_v1', { p_request: request });
  if (error) {
    const failures: Record<string, [number, string]> = {
      settings_conflict: [409, 'Settings changed. Refresh and review your changes.'],
      consent_policy_denied: [403, 'This provider policy is not available for acceptance.'],
      invalid_settings: [400, 'Choose valid settings.'], account_unavailable: [403, 'Your account is not available.'],
    };
    const failure = failures[error.message];
    if (failure) throw new HttpFailure(failure[0], error.message, failure[1]);
    throw new HttpFailure(503, 'settings_unavailable', 'Settings could not be saved.');
  }
  return settingsDTO(context,data);
}
export async function hasProviderConsent(context: AuthContext, provider: Provider): Promise<boolean> {
  const settings = await getSettings(context);
  return settings.providerConsents.find((consent) => consent.provider === provider)?.accepted === true;
}

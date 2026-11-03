import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../db/database.types.js';

// Trusted operator tooling only. The human verifies identity outside Vulpes before invocation.
export async function recoverAccount(
  admin: SupabaseClient<Database>,
  input: { userId: string; password: string; identityVerified: boolean },
) {
  const checked = z
    .strictObject({
      userId: z.uuid(),
      password: z.string().min(12).max(200),
      identityVerified: z.literal(true),
    })
    .parse(input);
  const profile = await admin
    .from('profiles')
    .select('account_state')
    .eq('user_id', checked.userId)
    .maybeSingle();
  if (profile.error || profile.data?.account_state !== 'active')
    throw new Error('Recovery requires an active provisioned account.');
  const updated = await admin.auth.admin.updateUserById(checked.userId, {
    password: checked.password,
  });
  if (updated.error)
    throw new Error(
      'Password reset is unconfirmed. Do not hand off credentials.',
    );
  const revoked = await admin.rpc('revoke_account_sessions_v1', {
    p_owner: checked.userId,
  });
  if (revoked.error)
    throw new Error(
      'Session revocation is unconfirmed. Retry recovery before credential handoff.',
    );
  return { state: 'credentials_reset', sessionsRevoked: true } as const;
}

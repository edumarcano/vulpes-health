import { z } from 'zod';
import {
  AccountStatusSchema,
  DeletionPhaseSchema,
} from '../../shared/account.js';
import type { AuthContext } from '../auth/session.js';
import { administrativeClient } from '../db/administrative.js';
import { HttpFailure } from '../http/failure.js';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../db/database.types.js';

export async function accountStatus(context: Pick<AuthContext, 'userId'>) {
  const { data, error } = await administrativeClient().rpc(
    'account_status_v1',
    { p_owner: context.userId },
  );
  if (error)
    throw new HttpFailure(
      503,
      'account_unavailable',
      'Account status could not be verified.',
    );
  if (data === null)
    throw new HttpFailure(
      403,
      'account_unavailable',
      'Your account is not provisioned. Contact the operator.',
    );
  return AccountStatusSchema.parse(data);
}
export async function beginDeletion(
  context: AuthContext & { passwordAt: string | null },
) {
  if (
    !context.passwordAt ||
    Date.now() - Date.parse(context.passwordAt) > 300_000 ||
    Date.parse(context.passwordAt) > Date.now() + 5000
  )
    throw new HttpFailure(
      403,
      'recent_password_required',
      'Sign in with your password again within five minutes to delete this account.',
    );
  const { data, error } = await administrativeClient().rpc(
    'begin_account_deletion_v1',
    { p_owner: context.userId, p_password_at: context.passwordAt },
  );
  if (error)
    throw new HttpFailure(
      error.message === 'recent_password_required' ? 403 : 503,
      'deletion_unavailable',
      'Deletion could not be started. Sign in with your password again and retry.',
    );
  return AccountStatusSchema.parse(data);
}
export async function continueDeletion(
  context: Pick<AuthContext, 'userId'>,
  admin: SupabaseClient<Database> = administrativeClient(),
) {
  const { data, error } = await admin.rpc('continue_account_deletion_v1', {
    p_owner: context.userId,
    p_batch_size: 100,
  });
  if (error)
    throw new HttpFailure(
      503,
      'deletion_unavailable',
      'Deletion is unfinished. Retry or contact the operator.',
    );
  const status = AccountStatusSchema.parse(data);
  if (status.state !== 'deleting' || status.phase !== 'auth_removal_pending')
    return status;
  let absent = false;
  try {
    const removed = await admin.auth.admin.deleteUser(context.userId);
    if (!removed.error || removed.error.code === 'user_not_found') {
      const checked = await admin.auth.admin.getUserById(context.userId);
      absent = checked.error?.code === 'user_not_found' && !checked.data.user;
    }
  } catch {
    /* Receipt remains retryable; an Auth outage is never completion evidence. */
  }
  const result = await admin.rpc('finish_account_deletion_v1', {
    p_owner: context.userId,
    p_auth_absent: absent,
  });
  if (result.error)
    throw new HttpFailure(
      503,
      'deletion_unavailable',
      'Identity removal is unconfirmed. Contact the operator with your deletion receipt.',
    );
  return AccountStatusSchema.parse(result.data);
}

export const DeletionJournalSchema = z.strictObject({
  schemaVersion: z.literal(1),
  capturedAt: z.iso.datetime(),
  rows: z.array(
    z
      .strictObject({
        user_id: z.uuid(),
        id: z.uuid(),
        phase: DeletionPhaseSchema,
        requested_at: z.iso.datetime({ offset: true }),
        updated_at: z.iso.datetime({ offset: true }),
        completed_at: z.iso.datetime({ offset: true }).nullable(),
        outcome: z.enum([
          'in_progress',
          'waiting_for_accounting',
          'auth_unavailable',
          'completed',
        ]),
      })
      .refine(
        (row) => (row.phase === 'completed') === (row.completed_at !== null),
      ),
  ),
});

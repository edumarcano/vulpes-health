import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  HostingTargetSchema,
  targetHash,
  type HostingTarget,
} from './hosting.js';

export const OwnerRecoveryTargetSchema = z
  .strictObject({
    ...HostingTargetSchema.shape,
    purpose: z.literal('owner-pilot'),
    ownerUserId: z.uuid(),
    syntheticPeerUserIds: z.array(z.uuid()).max(1),
  })
  .refine(
    (target) => target.supabaseProjectRef !== target.recoveryProjectRef,
    'Recovery must use a separate project.',
  )
  .refine(
    (target) =>
      new Set(
        [target.ownerUserId, ...target.syntheticPeerUserIds].map((id) =>
          id.toLowerCase(),
        ),
      ).size ===
      1 + target.syntheticPeerUserIds.length,
    'Owner and synthetic peer must differ.',
  );
export const RecoveryTargetSchema = z.union([
  HostingTargetSchema,
  OwnerRecoveryTargetSchema,
]);
export type RecoveryTarget = z.infer<typeof RecoveryTargetSchema>;
export const RecoveryUserScopeSchema = z
  .array(z.strictObject({ id: z.uuid(), synthetic: z.boolean() }))
  .max(10)
  .refine((users) => new Set(users.map((u) => u.id)).size === users.length);
export type RecoveryUserScope = z.infer<typeof RecoveryUserScopeSchema>;
export function recoveryTargetHash(input: RecoveryTarget) {
  const target = RecoveryTargetSchema.parse(input);
  return target.purpose === 'synthetic-only'
    ? targetHash(target)
    : createHash('sha256').update(JSON.stringify(target)).digest('hex');
}
export function checkRecoveryUsers(
  target: RecoveryTarget,
  nonsynthetic: number,
  users: RecoveryUserScope | undefined,
  count?: number,
  completedDeletionOwners: readonly string[] = [],
) {
  if (target.purpose === 'synthetic-only') {
    if (nonsynthetic !== 0) throw Error('Synthetic source required.');
    return;
  }
  if (!users)
    throw Error(
      'Owner recovery requires an explicit source identity inventory.',
    );
  const allowed = new Set([target.ownerUserId, ...target.syntheticPeerUserIds]);
  if (
    (count !== undefined && count !== users.length) ||
    users.some(
      (u) =>
        !allowed.has(u.id) || (!u.synthetic && u.id !== target.ownerUserId),
    ) ||
    users.filter((u) => !u.synthetic).length !== nonsynthetic ||
    [...allowed].some(
      (id) =>
        !users.some((u) => u.id === id) &&
        !completedDeletionOwners.includes(id),
    ) ||
    users.some((u) => completedDeletionOwners.includes(u.id))
  )
    throw Error('Owner recovery source identity mismatch.');
}
export function checkRecoveryMode(target: RecoveryTarget, ownerPilot: boolean) {
  if ((target.purpose === 'owner-pilot') !== ownerPilot)
    throw Error('Explicit matching owner-pilot mode required.');
}
export function recoveryPurpose(
  target: RecoveryTarget,
  synthetic: string,
  owner: string,
) {
  return target.purpose === 'owner-pilot' ? owner : synthetic;
}
export type RecoveryConnectionTarget = Pick<
  HostingTarget,
  'supabaseProjectRef' | 'databaseRegion'
>;
export const syntheticRecoveryIdentitySql =
  "email is not null and lower(email) like '%@example.invalid' and coalesce(raw_app_meta_data->>'vulpes_data_scope','') <> 'owner-pilot'";

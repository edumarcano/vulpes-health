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
const familyUuid = z.uuid().transform((id) => id.toLowerCase());
export const FamilyRecoveryTargetSchema = z
  .strictObject({
    ...HostingTargetSchema.shape,
    purpose: z.literal('family-pilot'),
    ownerUserId: familyUuid,
    familyUserIds: z.array(familyUuid).max(9),
    syntheticPeerUserIds: z.array(familyUuid).max(9),
  })
  .refine(
    (target) => target.supabaseProjectRef !== target.recoveryProjectRef,
    'Recovery must use a separate project.',
  )
  .refine((target) => {
    const ids = [
      target.ownerUserId,
      ...target.familyUserIds,
      ...target.syntheticPeerUserIds,
    ];
    return ids.length <= 10 && new Set(ids).size === ids.length;
  }, 'Family scope requires at most ten distinct named identities.');
export const RecoveryTargetSchema = z.union([
  HostingTargetSchema,
  OwnerRecoveryTargetSchema,
  FamilyRecoveryTargetSchema,
]);
export type RecoveryTarget = z.infer<typeof RecoveryTargetSchema>;
export const RecoveryUserScopeSchema = z
  .array(z.strictObject({ id: z.uuid(), synthetic: z.boolean() }))
  .max(10)
  .refine(
    (users) =>
      new Set(users.map((u) => u.id.toLowerCase())).size === users.length,
  );
export type RecoveryUserScope = z.infer<typeof RecoveryUserScopeSchema>;
export function recoveryAccountIds(target: RecoveryTarget) {
  return target.purpose === 'synthetic-only'
    ? undefined
    : [
        target.ownerUserId,
        ...(target.purpose === 'family-pilot' ? target.familyUserIds : []),
        ...target.syntheticPeerUserIds,
      ];
}
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
  const allowed = new Set(
      recoveryAccountIds(target)!.map((id) => id.toLowerCase()),
    ),
    personal = new Set(
      [
        target.ownerUserId,
        ...(target.purpose === 'family-pilot' ? target.familyUserIds : []),
      ].map((id) => id.toLowerCase()),
    ),
    completed = new Set(completedDeletionOwners.map((id) => id.toLowerCase()));
  if (
    new Set(users.map((u) => u.id.toLowerCase())).size !== users.length ||
    (count !== undefined && count !== users.length) ||
    users.some(
      (u) =>
        !allowed.has(u.id.toLowerCase()) ||
        (!u.synthetic && !personal.has(u.id.toLowerCase())),
    ) ||
    users.filter((u) => !u.synthetic).length !== nonsynthetic ||
    [...allowed].some(
      (id) =>
        !users.some((u) => u.id.toLowerCase() === id) && !completed.has(id),
    ) ||
    users.some((u) => completed.has(u.id.toLowerCase()))
  )
    throw Error('Owner recovery source identity mismatch.');
}
export function checkRecoveryMode(
  target: RecoveryTarget,
  ownerPilot: boolean,
  familyPilot = false,
) {
  if (
    (target.purpose === 'owner-pilot') !== ownerPilot ||
    (target.purpose === 'family-pilot') !== familyPilot
  )
    throw Error('Explicit matching owner-pilot or family-pilot mode required.');
}
export function recoveryPurpose(
  target: RecoveryTarget,
  synthetic: string,
  owner: string,
) {
  return target.purpose === 'family-pilot'
    ? owner
        .replace('owner-pilot', 'family-pilot')
        .replace('owner_pilot', 'family_pilot')
    : target.purpose === 'owner-pilot'
      ? owner
      : synthetic;
}
export type RecoveryConnectionTarget = Pick<
  HostingTarget,
  'supabaseProjectRef' | 'databaseRegion'
>;
export const syntheticRecoveryIdentitySql =
  "email is not null and lower(email) like '%@example.invalid' and coalesce(raw_app_meta_data->>'vulpes_data_scope','') in ('','synthetic-only')";
export function isSyntheticRecoveryIdentity(user: {
  email?: string | null;
  app_metadata?: Record<string, unknown>;
}) {
  return (
    !!user.email?.toLowerCase().endsWith('@example.invalid') &&
    ['', 'synthetic-only'].includes(
      String(user.app_metadata?.vulpes_data_scope ?? ''),
    )
  );
}

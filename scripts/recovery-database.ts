import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import {
  EnvelopeSchema,
  decryptBytes,
  type EncryptionKeys,
} from '../server/security/encryption.js';
import {
  RecoveryTargetSchema,
  recoveryTargetHash,
  checkRecoveryUsers,
  recoveryPurpose,
  RecoveryUserScopeSchema,
  type RecoveryTarget,
} from './recovery-target.js';
import { sealArchive, openArchive } from './backup-archive.js';
import type { Database } from '../server/db/database.types.js';
import { verifyRecoveryJournal } from './recovery-journal.js';
import type { RecoveryReplayActions } from './recovery-replay.js';
import type { RecoveryHttpInput } from './recovery-http.js';

export const maximumDumpBytes = 128 * 1024 * 1024;
export const recoveryRequiredPublicTables = [
  'profiles',
  'data_sources',
  'import_batches',
  'measurements',
  'conversations',
  'ai_runs',
  'messages',
  'goals',
  'action_proposals',
  'goal_revisions',
  'ai_steps',
  'private_payloads',
  'usage_buckets',
  'usage_reservations',
  'audit_events',
  'account_deletion_receipts',
  'ai_route_cost_blocks',
  'live_verification_allocations',
  'vertex_policy_approval',
] as const satisfies readonly (keyof Database['public']['Tables'])[];
const count = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  hash = z.string().regex(/^[a-f0-9]{64}$/);
const catalogSchema = z.strictObject(
  Object.fromEntries(
    [
      'columns',
      'functions',
      'constraints',
      'triggers',
      'policies',
      'grants',
      'rls',
    ].map((k) => [k, z.array(z.unknown())]),
  ),
);
export const RecoverySnapshotSchema = z.strictObject({
  serverMajor: z.number().int().min(15).max(20),
  nonsyntheticUsers: count,
  userScope: RecoveryUserScopeSchema.optional(),
  completedDeletionOwners: z.array(z.uuid()).max(10000).optional(),
  storageObjects: count,
  extensions: z.array(z.unknown()),
  catalog: catalogSchema,
  inventory: z.record(
    z
      .string()
      .regex(/^(public|auth|storage|supabase_migrations)\.[a-zA-Z0-9_]+$/),
    z.strictObject({ count, hash }),
  ),
  traceKeyIds: z.array(z.string().min(1).max(200)).max(10),
  traceSamples: z.array(EnvelopeSchema).max(10),
});
export type RecoverySnapshot = z.infer<typeof RecoverySnapshotSchema>;
const bundleSchema = z.strictObject({
  version: z.literal(1),
  purpose: z.enum([
    'synthetic-database-recovery',
    'owner-pilot-database-recovery',
    'family-pilot-database-recovery',
  ]),
  targetSHA256: hash,
  snapshot: RecoverySnapshotSchema,
  dumpBase64: z.string().max(Math.ceil(maximumDumpBytes / 3) * 4),
});
export interface RecoverySource {
  snapshot: () => Promise<unknown>;
  dump: () => Promise<Buffer>;
}
export interface RecoveryDestination {
  create: () => Promise<void>;
  assertFenced: () => Promise<void>;
  assertEmpty: () => Promise<void>;
  restore: (dump: Buffer) => Promise<void>;
  snapshot: () => Promise<unknown>;
  normalize: (value: RecoverySnapshot) => Promise<RecoverySnapshot>;
  stop: () => Promise<void>;
  recovery?: RecoveryReplayActions;
  verifyHttp?: (
    input: RecoveryHttpInput,
    journalOwners: Set<string>,
  ) => Promise<{
    authHttpVerified: true;
    apiHttpVerified: true;
    httpChecks: number;
    httpRetainedUsers: number;
    httpDeletedUsers: number;
  }>;
}
export interface RecoveryReplayInput {
  journal: Buffer;
  keyId: string;
  journalKeyB64: string;
  current: () => Promise<Buffer>;
  httpProof?: RecoveryHttpInput;
}
function snapshot(input: unknown, target: RecoveryTarget) {
  const checked = RecoverySnapshotSchema.parse(input);
  if (checked.storageObjects) throw new Error('Empty Storage required.');
  checkRecoveryUsers(
    target,
    checked.nonsyntheticUsers,
    checked.userScope,
    checked.inventory['auth.users']?.count,
    checked.completedDeletionOwners,
  );
  for (const table of [
    ...recoveryRequiredPublicTables.map((t) => 'public.' + t),
    'auth.users',
  ])
    if (!checked.inventory[table])
      throw new Error('Required source inventory missing.');
  if (
    !checked.catalog.columns?.length ||
    !checked.catalog.functions?.length ||
    !checked.catalog.policies?.length ||
    !checked.catalog.rls?.length
  )
    throw new Error('Source security catalog incomplete.');
  if (
    new Set(checked.traceKeyIds).size !== checked.traceKeyIds.length ||
    !isDeepStrictEqual(
      [...checked.traceKeyIds].sort(),
      checked.traceSamples.map((s) => s.key_id).sort(),
    )
  )
    throw new Error('Trace-key inventory incomplete.');
  return checked;
}
function comparableSnapshot(
  value: RecoverySnapshot,
  expected: RecoverySnapshot,
) {
  // Historical synthetic archives predate the optional identity inventory.
  const legacy = { ...value };
  if (expected.userScope === undefined) delete legacy.userScope;
  if (expected.completedDeletionOwners === undefined)
    delete legacy.completedDeletionOwners;
  return legacy;
}
function verifyTraces(value: RecoverySnapshot, keys: EncryptionKeys) {
  for (const sample of value.traceSamples) {
    const bytes = decryptBytes(sample, keys);
    bytes.fill(0);
  }
}
function dumpBytes(bytes: Buffer) {
  if (
    bytes.length < 5 ||
    bytes.length > maximumDumpBytes ||
    bytes.subarray(0, 5).toString('ascii') !== 'PGDMP'
  )
    throw new Error('Bounded custom PostgreSQL archive required.');
  return bytes;
}

export async function captureDatabase(
  target: RecoveryTarget,
  source: RecoverySource,
  keys: { backup: Buffer; keyId: string; traces: EncryptionKeys },
  now = Date.now(),
) {
  const checked = RecoveryTargetSchema.parse(target),
    before = snapshot(await source.snapshot(), checked);
  verifyTraces(before, keys.traces);
  const dump = await source.dump();
  try {
    dumpBytes(dump);
    const after = snapshot(await source.snapshot(), checked);
    if (!isDeepStrictEqual(before, after))
      throw new Error('Source changed during capture.');
    verifyTraces(after, keys.traces);
    const bytes = Buffer.from(
      JSON.stringify(
        bundleSchema.parse({
          version: 1,
          purpose: recoveryPurpose(
            checked,
            'synthetic-database-recovery',
            'owner-pilot-database-recovery',
          ),
          targetSHA256: recoveryTargetHash(checked),
          snapshot: before,
          dumpBase64: dump.toString('base64'),
        }),
      ),
    );
    try {
      return {
        archive: sealArchive(bytes, keys.backup, keys.keyId, 'database', now),
        report: {
          scope: recoveryPurpose(
            checked,
            'synthetic_database_capture',
            'owner_pilot_database_capture',
          ),
          targetSHA256: recoveryTargetHash(checked),
          tables: Object.keys(before.inventory).length,
          traceKeyVersions: before.traceKeyIds.length,
          sourceWrites: 0,
          restoreAccessAuthorized: false,
        },
      };
    } finally {
      bytes.fill(0);
    }
  } finally {
    dump.fill(0);
  }
}
export async function restoreDatabase(
  target: RecoveryTarget,
  archive: Buffer,
  keys: { backup: Buffer; keyId: string; traces: EncryptionKeys },
  destination: RecoveryDestination,
  now = Date.now(),
  recovery?: RecoveryReplayInput,
) {
  target = RecoveryTargetSchema.parse(target);
  const inspected = inspectDatabaseArchive(target, archive, keys, now);
  const { dump, snapshot: expected, header } = inspected;
  try {
    const journalKeys = recovery
      ? {
          keyId: recovery.keyId,
          journalKeyB64: recovery.journalKeyB64,
          backupCreatedAt: header.createdAt,
        }
      : undefined;
    const initial = recovery
      ? verifyRecoveryJournal(recovery.journal, target, journalKeys, now)
      : undefined;
    if (
      initial &&
      (!initial.accountingSHA256 ||
        !destination.recovery ||
        initial.journal.rows.length > 100 ||
        initial.journal.rows.some(
          (r) => r.outcome === 'waiting_for_accounting',
        ) ||
        (recovery?.httpProof && !destination.verifyHttp))
    )
      throw new Error(
        'Recovery actions unavailable or source accounting unresolved.',
      );
    let created = false;
    try {
      // The native destination always creates a fresh, network-none container.
      created = true;
      await destination.create();
      await destination.assertFenced();
      await destination.assertEmpty();
      await destination.restore(dump);
      await destination.assertFenced();
      const actual = snapshot(await destination.snapshot(), target);
      if (
        !isDeepStrictEqual(
          await destination.normalize(expected),
          comparableSnapshot(await destination.normalize(actual), expected),
        )
      )
        throw new Error(
          'Restored catalog, ownership, grants, policies, rows or keys differ.',
        );
      verifyTraces(actual, keys.traces);
      if (recovery && initial && destination.recovery) {
        // Recheck freshness after potentially slow restoration, before replay writes.
        verifyRecoveryJournal(recovery.journal, target, journalKeys);
        await destination.assertFenced();
        const replay = await destination.recovery.replay(initial.journal);
        const revoked = await destination.recovery.revokeSessions(),
          validation = await destination.recovery.validate();
        await destination.assertFenced();
        const http = recovery.httpProof
          ? await destination.verifyHttp!(
              recovery.httpProof,
              new Set(initial.journal.rows.map((r) => r.user_id)),
            )
          : undefined;
        if (http) {
          await destination.recovery.revokeSessions();
          await destination.recovery.validate();
        }
        const accounting = await destination.recovery.accounting();
        const current = await recovery.current();
        try {
          const latest = verifyRecoveryJournal(current, target, journalKeys);
          if (!isDeepStrictEqual(initial.journal.rows, latest.journal.rows))
            throw new Error(
              'Current deletion journal changed; recovery remains fenced.',
            );
          if (latest.accountingSHA256 !== accounting)
            throw new Error(
              'Current source accounting differs; recovery remains fenced.',
            );
        } finally {
          current.fill(0);
        }
        return {
          scope: recoveryPurpose(
            target,
            'fenced_synthetic_database_recovery',
            'fenced_owner_pilot_database_recovery',
          ),
          targetSHA256: recoveryTargetHash(target),
          encryptedArchiveAuthenticated: true,
          catalogAndRowsMatchedBeforeReplay: true,
          ...replay,
          ...revoked,
          ...validation,
          ...http,
          currentAccountingMatched: true,
          currentJournalRechecked: true,
          network: 'none',
          publishedPorts: 0,
          restoreAccessAuthorized: false,
          remaining: [
            ...(!http ? ['actual Auth/API compatibility'] : []),
            'source-loss/cutover completeness and credential handoff',
            'separate access approval',
          ],
        };
      }
      return {
        scope: recoveryPurpose(
          target,
          'fenced_synthetic_database_restore',
          'fenced_owner_pilot_database_restore',
        ),
        targetSHA256: recoveryTargetHash(target),
        tables: Object.keys(expected.inventory).length,
        traceKeyVersions: expected.traceKeyIds.length,
        encryptedArchiveAuthenticated: true,
        catalogAndRowsMatched: true,
        network: 'none',
        publishedPorts: 0,
        restoreAccessAuthorized: false,
        remaining: [
          'current independent deletion journal completeness and replay',
          'restored session revocation',
          'Auth/API compatibility and isolation',
          'separate access approval',
        ],
      };
    } finally {
      if (created) await destination.stop();
    }
  } finally {
    inspected.dispose();
  }
}

export function inspectDatabaseArchive(
  target: RecoveryTarget,
  archive: Buffer,
  keys: { backup: Buffer; keyId: string; traces: EncryptionKeys },
  now = Date.now(),
) {
  const opened = openArchive(
    archive,
    new Map([[keys.keyId, keys.backup]]),
    'database',
    now,
  );
  let dump: Buffer | undefined;
  try {
    const record = bundleSchema.parse(
      JSON.parse(opened.bytes.toString('utf8')),
    );
    if (
      record.targetSHA256 !== recoveryTargetHash(target) ||
      record.purpose !==
        recoveryPurpose(
          target,
          'synthetic-database-recovery',
          'owner-pilot-database-recovery',
        )
    )
      throw new Error('Backup source mismatch.');
    const checked = snapshot(record.snapshot, target);
    verifyTraces(checked, keys.traces);
    dump = dumpBytes(Buffer.from(record.dumpBase64, 'base64'));
    if (dump.toString('base64') !== record.dumpBase64)
      throw new Error('Invalid dump encoding.');
    const bytes = dump;
    return {
      snapshot: checked,
      dump: bytes,
      header: opened.header,
      dispose: () => {
        bytes.fill(0);
        opened.bytes.fill(0);
      },
    };
  } catch (error) {
    dump?.fill(0);
    opened.bytes.fill(0);
    throw error;
  }
}

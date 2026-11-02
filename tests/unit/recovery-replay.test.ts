import { randomBytes, randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import {
  captureDatabase,
  restoreDatabase,
  recoveryRequiredPublicTables,
  type RecoveryDestination,
} from '../../scripts/recovery-database.js';
import { sealArchive } from '../../scripts/backup-archive.js';
import { targetHash } from '../../scripts/hosting.js';
import { databaseRecoveryCommand } from '../../scripts/hosted-database-recovery.js';
import { recoveryReplayActions } from '../../scripts/recovery-replay.js';

const target = {
  version: 1,
  purpose: 'synthetic-only',
  supabaseProjectRef: 'abcdefghijklmnopqrst',
  recoveryProjectRef: null,
  databaseRegion: 'us-east-1',
  vercelProjectId: 'prj_SyntheticRecovery',
  appOrigin: 'https://vulpes-synthetic.vercel.app',
} as const;
const now = Date.now(),
  time = (offset = 0) => new Date(now + offset).toISOString(),
  journalKey = randomBytes(32),
  journalCredentials = {
    keyId: 'journal',
    journalKeyB64: journalKey.toString('base64'),
  };
const row = (complete = false) => ({
  user_id: randomUUID(),
  id: randomUUID(),
  phase: complete ? 'completed' : 'fenced',
  requested_at: time(-1000),
  updated_at: time(-500),
  completed_at: complete ? time(-500) : null,
  outcome: complete ? 'completed' : 'in_progress',
});
function journal(
  rows: ReturnType<typeof row>[],
  hash = targetHash(target),
  at = now,
) {
  return sealArchive(
    Buffer.from(
      JSON.stringify({
        version: 1,
        purpose: 'synthetic-recovery-journal',
        targetSHA256: hash,
        accountingSHA256: 'a'.repeat(64),
        journal: {
          schemaVersion: 1,
          capturedAt: new Date(at).toISOString(),
          rows,
        },
      }),
    ),
    journalKey,
    'journal',
    'deletion_journal',
    at,
  );
}
async function fixture() {
  const state = {
    serverMajor: 17,
    nonsyntheticUsers: 0,
    storageObjects: 0,
    extensions: [],
    catalog: {
      columns: [1],
      functions: [1],
      constraints: [1],
      triggers: [1],
      policies: [1],
      grants: [1],
      rls: [1],
    },
    inventory: Object.fromEntries(
      [
        ...recoveryRequiredPublicTables.map((t) => 'public.' + t),
        'auth.users',
      ].map((k) => [k, { count: 0, hash: 'a'.repeat(64) }]),
    ),
    traceKeyIds: [],
    traceSamples: [],
  };
  const keys = {
      backup: randomBytes(32),
      keyId: 'backup',
      traces: { activeId: 'test', keys: new Map<string, Buffer>() },
    },
    captured = await captureDatabase(
      target,
      {
        snapshot: async () => state,
        dump: async () => Buffer.from('PGDMPsynthetic'),
      },
      keys,
      now,
    ),
    rows = [row(true), row()],
    initial = journal(rows),
    order: string[] = [];
  const destination: RecoveryDestination = {
    create: vi.fn(async () => {}),
    assertFenced: vi.fn(async () => {}),
    assertEmpty: vi.fn(async () => {}),
    restore: vi.fn(async () => {}),
    snapshot: vi.fn(async () => state),
    normalize: vi.fn(async (value) => value),
    stop: vi.fn(async () => {}),
    recovery: {
      accounting: vi.fn(async () => 'a'.repeat(64)),
      replay: vi.fn(async () => {
        order.push('replay');
        return {
          deletionsReplayed: 2,
          deletionSteps: 12,
          unaffectedRowsPreserved: true,
          sharedChargesPreserved: true,
        } as const;
      }),
      revokeSessions: vi.fn(async () => {
        order.push('revoke');
        return { sessionsRemoved: 2, refreshTokensRemoved: 2 };
      }),
      validate: vi.fn(async () => {
        order.push('validate');
        return {
          sessionsRemaining: 0,
          refreshTokensRemaining: 0,
          profilesTested: 2,
          oldSessionsTested: 2,
          oldSessionsDenied: true,
          twoOwnerRlsVerified: true,
        } as const;
      }),
    },
  };
  const input = {
    ...journalCredentials,
    journal: initial,
    current: vi.fn(async () => {
      order.push('current');
      return Buffer.from(initial);
    }),
  };
  return { keys, captured, rows, destination, input, order };
}
it('replays, revokes and validates before the independently current reread, and always stops without enabling access', async () => {
  const f = await fixture(),
    report = await restoreDatabase(
      target,
      f.captured.archive,
      f.keys,
      f.destination,
      now,
      f.input,
    );
  expect(f.order).toEqual(['replay', 'revoke', 'validate', 'current']);
  expect(f.destination.stop).toHaveBeenCalledTimes(1);
  expect(report).toMatchObject({
    deletionsReplayed: 2,
    currentJournalRechecked: true,
    oldSessionsDenied: true,
    restoreAccessAuthorized: false,
  });
  expect(JSON.stringify(report)).not.toContain(f.rows[0]!.user_id);
});
it.each(['expired', 'foreign', 'corrupt', 'wrong-key', 'waiting', 'too-many'])(
  'refuses an invalid/unsettled independent journal before creating a destination: %s',
  async (mode) => {
    const f = await fixture();
    if (mode === 'expired')
      f.input.journal = journal(f.rows, targetHash(target), now - 300001);
    if (mode === 'foreign') f.input.journal = journal(f.rows, 'f'.repeat(64));
    if (mode === 'corrupt') {
      f.input.journal = Buffer.from(f.input.journal);
      f.input.journal[f.input.journal.length - 1] =
        f.input.journal[f.input.journal.length - 1]! ^ 1;
    }
    if (mode === 'wrong-key')
      f.input.journalKeyB64 = randomBytes(32).toString('base64');
    if (mode === 'waiting')
      f.input.journal = journal([
        {
          ...row(),
          phase: 'awaiting_settlement',
          outcome: 'waiting_for_accounting',
        },
      ]);
    if (mode === 'too-many')
      f.input.journal = journal(Array.from({ length: 101 }, () => row()));
    await expect(
      restoreDatabase(
        target,
        f.captured.archive,
        f.keys,
        f.destination,
        now,
        f.input,
      ),
    ).rejects.toThrow();
    expect(f.destination.create).not.toHaveBeenCalled();
    expect(f.input.current).not.toHaveBeenCalled();
  },
);
it('refuses a changed or failed current journal and stops after replay, preserving the initial copy', async () => {
  for (const fail of [false, true]) {
    const f = await fixture(),
      initial = Buffer.from(f.input.journal);
    if (fail) f.input.current.mockRejectedValue(Error('unavailable'));
    else f.input.current.mockResolvedValue(journal([f.rows[0]!]));
    await expect(
      restoreDatabase(
        target,
        f.captured.archive,
        f.keys,
        f.destination,
        now,
        f.input,
      ),
    ).rejects.toThrow();
    expect(f.destination.stop).toHaveBeenCalledTimes(1);
    expect(f.input.journal).toEqual(initial);
  }
});
it('refuses current accounting drift and journals without accounting evidence without resetting balances', async () => {
  const f = await fixture();
  vi.mocked(f.destination.recovery!.accounting).mockResolvedValue(
    'b'.repeat(64),
  );
  await expect(
    restoreDatabase(
      target,
      f.captured.archive,
      f.keys,
      f.destination,
      now,
      f.input,
    ),
  ).rejects.toThrow('accounting differs');
  expect(f.destination.stop).toHaveBeenCalledTimes(1);
  const missing = await fixture();
  missing.input.journal = sealArchive(
    Buffer.from(
      JSON.stringify({
        version: 1,
        purpose: 'synthetic-recovery-journal',
        targetSHA256: targetHash(target),
        journal: { schemaVersion: 1, capturedAt: time(), rows: missing.rows },
      }),
    ),
    journalKey,
    'journal',
    'deletion_journal',
    now,
  );
  await expect(
    restoreDatabase(
      target,
      missing.captured.archive,
      missing.keys,
      missing.destination,
      now,
      missing.input,
    ),
  ).rejects.toThrow('accounting unresolved');
  expect(missing.destination.create).not.toHaveBeenCalled();
});
it.each(['replay', 'revokeSessions', 'validate'])(
  'keeps recovery fenced and skips the source reread after %s failure',
  async (method) => {
    const f = await fixture();
    vi.mocked(f.destination.recovery![method as 'validate']).mockRejectedValue(
      Error('synthetic failure'),
    );
    await expect(
      restoreDatabase(
        target,
        f.captured.archive,
        f.keys,
        f.destination,
        now,
        f.input,
      ),
    ).rejects.toThrow();
    expect(f.destination.stop).toHaveBeenCalledTimes(1);
    expect(f.input.current).not.toHaveBeenCalled();
  },
);
it('requires explicit hosted journal-read opt-in before files, credentials or Docker access', async () => {
  const read = vi.fn(),
    send = vi.fn();
  await expect(
    databaseRecoveryCommand(
      [
        '--recover',
        '--allow-fenced-restore',
        '--manifest=missing',
        '--archive=missing',
        '--journal=missing',
        '--journal-latest=missing',
        '--image=missing',
      ],
      read,
      send,
    ),
  ).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});
it('detects exact-decimal loss of a shared charge without resetting allocations', async () => {
  let reads = 0;
  const statements: string[] = [];
  const actions = recoveryReplayActions(
    (statement) => {
      statements.push(statement);
      if (statement.includes('from(select id,user_id from auth.sessions'))
        return '[]';
      if (statement.includes('jsonb_agg(to_jsonb(b)'))
        return JSON.stringify([
          {
            id: 'shared',
            allocated_ceiling_usd: '1',
            spent_usd:
              ++reads === 1
                ? '0.123456789012345678901'
                : '0.123456789012345678900',
            reserved_usd: '0',
          },
        ]);
      if (statement.includes("where phase<>'completed'")) return '0';
      return 'stable';
    },
    async () => {},
    () => {},
  );
  await expect(
    actions.replay({ schemaVersion: 1, capturedAt: time(), rows: [] }),
  ).rejects.toThrow('charges');
  expect(statements.some((s) => /update public\.usage_buckets/i.test(s))).toBe(
    false,
  );
});
it('refuses an independently omitted unfinished restored request before starting deletion', async () => {
  const statements: string[] = [];
  const actions = recoveryReplayActions(
    (statement) => {
      statements.push(statement);
      if (
        statement.includes('from(select id,user_id from auth.sessions') ||
        statement.includes('jsonb_agg(to_jsonb(b)')
      )
        return '[]';
      if (statement.includes("where phase<>'completed'")) return '1';
      return 'stable';
    },
    async () => {},
    () => {},
  );
  await expect(
    actions.replay({ schemaVersion: 1, capturedAt: time(), rows: [] }),
  ).rejects.toThrow('omits');
  expect(statements.some((s) => s.includes('begin_account_deletion_v1'))).toBe(
    false,
  );
});

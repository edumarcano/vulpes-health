import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { HostingTargetSchema, targetHash } from '../../scripts/hosting.js';
import {
  InvitedRecoveryTargetSchema,
  OwnerRecoveryTargetSchema,
  RecoveryTargetSchema,
  checkRecoveryMode,
  checkRecoveryUsers,
  isSyntheticRecoveryIdentity,
  recoveryAccountIds,
  recoveryPurpose,
  recoveryTargetHash,
} from '../../scripts/recovery-target.js';
import {
  captureDatabase,
  restoreDatabase,
  recoveryRequiredPublicTables,
  type RecoverySnapshot,
  type RecoveryDestination,
} from '../../scripts/recovery-database.js';
import {
  captureRecoveryJournal,
  verifyRecoveryJournal,
  recoveryJournalCommand,
  recoveryPathHash,
} from '../../scripts/recovery-journal.js';
import { databaseRecoveryCommand } from '../../scripts/hosted-database-recovery.js';
import { hostedMaintenanceCommand } from '../../scripts/hosted-maintenance.js';
import { hostedAccountRecoveryCommand } from '../../scripts/hosted-account-recovery.js';
import { operationsStatusCommand } from '../../scripts/operations-status.js';
import { openArchive, sealArchive } from '../../scripts/backup-archive.js';

const synthetic = {
  version: 1,
  purpose: 'synthetic-only',
  supabaseProjectRef: 'abcdefghijklmnopqrst',
  recoveryProjectRef: null,
  databaseRegion: 'us-east-1',
  vercelProjectId: 'prj_SyntheticRecovery',
  appOrigin: 'https://invited-recovery-test.vercel.app',
} as const;
const owner = randomUUID(),
  invited = randomUUID(),
  peer = randomUUID(),
  target = InvitedRecoveryTargetSchema.parse({
    ...synthetic,
    purpose: 'invited-pilot',
    ownerUserId: owner,
    invitedUserIds: [invited],
    syntheticPeerUserIds: [peer],
  }),
  now = Date.now(),
  time = (offset = 0) => new Date(now + offset).toISOString();
const identities = [
  { id: owner, synthetic: false },
  { id: invited, synthetic: false },
  { id: peer, synthetic: true },
];
async function withManifest(run: (path: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'vulpes-invited-unit-')),
    path = join(directory, 'manifest.json');
  try {
    await writeFile(
      path,
      JSON.stringify({ target, targetSHA256: recoveryTargetHash(target) }),
    );
    await run(path);
  } finally {
    await rm(directory, { recursive: true });
  }
}

it('keeps invited identities canonical, bounded, target-bound and distinct from historical modes', () => {
  expect(recoveryTargetHash(synthetic)).toBe(targetHash(synthetic));
  expect(HostingTargetSchema.safeParse(target).success).toBe(false);
  expect(OwnerRecoveryTargetSchema.safeParse(target).success).toBe(false);
  expect(recoveryAccountIds(target)).toEqual([owner, invited, peer]);
  expect(
    InvitedRecoveryTargetSchema.safeParse({
      ...target,
      invitedUserIds: Array.from({ length: 9 }, () => randomUUID()),
      syntheticPeerUserIds: [],
    }).success,
  ).toBe(true);
  expect(recoveryAccountIds(synthetic)).toBeUndefined();
  expect(
    InvitedRecoveryTargetSchema.parse({
      ...target,
      ownerUserId: owner.toUpperCase(),
    }).ownerUserId,
  ).toBe(owner);
  for (const patch of [
    { invitedUserIds: [owner.toUpperCase()] },
    { invitedUserIds: [peer] },
    { invitedUserIds: Array.from({ length: 9 }, () => randomUUID()) },
    { recoveryProjectRef: synthetic.supabaseProjectRef },
    { unexpected: true },
  ])
    expect(
      InvitedRecoveryTargetSchema.safeParse({ ...target, ...patch }).success,
    ).toBe(false);
  expect(() => checkRecoveryMode(target, false, true)).not.toThrow();
  for (const flags of [
    [false, false],
    [true, false],
    [true, true],
  ] as const)
    expect(() => checkRecoveryMode(target, flags[0], flags[1])).toThrow();
  expect(() => checkRecoveryMode(synthetic, false, true)).toThrow();
  expect(
    recoveryPurpose(target, 'synthetic-maintenance', 'owner-pilot-maintenance'),
  ).toBe('invited-pilot-maintenance');
});

it('preserves the baseline synthetic and owner manifest hashes', () => {
  const fixedSynthetic = {
    ...synthetic,
    appOrigin: 'https://vulpes-synthetic.vercel.app',
  };
  expect(recoveryTargetHash(fixedSynthetic)).toBe(
    'fb1f0eda8f6fb60c8ed82788ae44ee09e7244217666964941e4b6c7f75704e26',
  );
  expect(
    recoveryTargetHash(
      OwnerRecoveryTargetSchema.parse({
        ...fixedSynthetic,
        purpose: 'owner-pilot',
        ownerUserId: '11111111-1111-4111-8111-111111111111',
        syntheticPeerUserIds: ['22222222-2222-4222-8222-222222222222'],
      }),
    ),
  ).toBe('8e142c8fc6b66612ba98f29e6ce89786a53dd63a24df5dc4db44b1b778cea61b');
});

it('rejects removed manifest purposes and fields, including mixed spellings', () => {
  const { invitedUserIds, ...otherFields } = target;
  for (const input of [
    { ...otherFields, purpose: 'family-pilot', familyUserIds: invitedUserIds },
    { ...otherFields, familyUserIds: invitedUserIds },
    { ...target, purpose: 'family-pilot' },
    { ...target, familyUserIds: [] },
  ])
    expect(RecoveryTargetSchema.safeParse(input).success).toBe(false);
});

it.each([
  ['database recovery', databaseRecoveryCommand],
  ['deletion journal', recoveryJournalCommand],
  ['maintenance', hostedMaintenanceCommand],
  ['account recovery', hostedAccountRecoveryCommand],
  ['status', operationsStatusCommand],
] as const)(
  '%s accepts only the new explicit invited mode before private input',
  async (_name, command) => {
    const read = vi.fn(),
      network = vi.fn();
    expect(
      await command(['--plan', '--invited-pilot'], read, network),
    ).toMatchObject({ networkRequests: 0 });
    for (const mode of [
      ['--family-pilot'],
      ['--family-pilot', '--invited-pilot'],
      ['--family-pilot', '--owner-pilot'],
    ])
      await expect(command(['--plan', ...mode], read, network)).rejects.toThrow(
        /Unknown option/,
      );
    await expect(
      command(['--plan', '--owner-pilot', '--invited-pilot'], read, network),
    ).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
  },
);

it('requires the complete named inventory, real counts and completed deletion proof without resurrection', () => {
  expect(() => checkRecoveryUsers(target, 2, identities, 3)).not.toThrow();
  for (const users of [
    undefined,
    identities.slice(0, 2),
    [...identities, { id: randomUUID(), synthetic: false }],
    identities.map((u) => (u.id === peer ? { ...u, synthetic: false } : u)),
    [...identities, { id: owner.toUpperCase(), synthetic: false }],
  ])
    expect(() => checkRecoveryUsers(target, 2, users)).toThrow();
  expect(() => checkRecoveryUsers(target, 1, identities, 3)).toThrow();
  const retained = identities.filter((u) => u.id !== invited);
  expect(() =>
    checkRecoveryUsers(target, 1, retained, 2, [invited]),
  ).not.toThrow();
  expect(() =>
    checkRecoveryUsers(target, 1, retained, 2, [randomUUID()]),
  ).toThrow();
  expect(() =>
    checkRecoveryUsers(target, 2, identities, 3, [invited]),
  ).toThrow();
});

it('does not classify personal, invited or unknown-scope accounts as synthetic based on email', () => {
  expect(
    isSyntheticRecoveryIdentity({ email: 'fixture@example.invalid' }),
  ).toBe(true);
  for (const marker of [
    'owner-pilot',
    'invited-pilot',
    'family-pilot',
    'personal',
    'unknown',
  ])
    expect(
      isSyntheticRecoveryIdentity({
        email: 'fixture@example.invalid',
        app_metadata: { vulpes_data_scope: marker },
      }),
    ).toBe(false);
  expect(isSyntheticRecoveryIdentity({ email: 'person@example.com' })).toBe(
    false,
  );
});

it('keeps invited CLI plans inert and rejects implicit/mixed modes before private input', async () => {
  const read = vi.fn(),
    network = vi.fn();
  expect(
    await databaseRecoveryCommand(['--plan', '--invited-pilot'], read, network),
  ).toMatchObject({
    scope: 'invited_pilot_database_capture_and_fenced_restore',
    networkRequests: 0,
  });
  expect(
    await recoveryJournalCommand(['--plan', '--invited-pilot'], read, network),
  ).toMatchObject({
    scope: 'independent_invited_pilot_deletion_journal',
    networkRequests: 0,
  });
  expect(
    await hostedMaintenanceCommand(
      ['--plan', '--invited-pilot'],
      read,
      network,
    ),
  ).toMatchObject({
    scope: 'named_invited_pilot_database_maintenance',
    maximumOwners: 10,
  });
  await expect(
    recoveryJournalCommand(
      ['--plan', '--invited-pilot', '--owner-pilot'],
      read,
      network,
    ),
  ).rejects.toThrow();
  await withManifest(async (path) => {
    await expect(
      hostedMaintenanceCommand(
        ['--allow-hosted', '--manifest=' + path],
        read,
        network,
      ),
    ).rejects.toThrow();
    await expect(
      recoveryJournalCommand(
        [
          '--capture',
          '--allow-hosted',
          '--manifest=' + path,
          '--output=unused',
        ],
        read,
        network,
      ),
    ).rejects.toThrow();
    await expect(
      databaseRecoveryCommand(
        [
          '--capture',
          '--allow-hosted-capture',
          '--manifest=' + path,
          '--output=unused',
        ],
        read,
        network,
      ),
    ).rejects.toThrow();
    await expect(
      databaseRecoveryCommand(
        [
          '--recover',
          '--invited-pilot',
          '--verify-http',
          '--allow-fenced-restore',
          '--allow-hosted-journal-read',
          '--manifest=' + path,
          '--archive=unused',
          '--image=unused',
          '--journal=unused',
          '--journal-latest=unused',
        ],
        read,
        network,
      ),
    ).rejects.toThrow('synthetic-only');
  });
  expect(read).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
});

it('authenticates invited backup scope and refuses other scopes before destination creation', async () => {
  const keys = {
    backup: randomBytes(32),
    keyId: 'synthetic-unit',
    traces: { activeId: 'unused', keys: new Map() },
  };
  const state: RecoverySnapshot = {
    serverMajor: 17,
    nonsyntheticUsers: 2,
    userScope: identities,
    storageObjects: 0,
    extensions: [],
    catalog: {
      columns: [1],
      functions: [1],
      constraints: [],
      triggers: [],
      policies: [1],
      grants: [],
      rls: [1],
    },
    inventory: Object.fromEntries(
      [
        ...recoveryRequiredPublicTables.map((t) => 'public.' + t),
        'auth.users',
      ].map((t) => [t, { count: 3, hash: 'a'.repeat(64) }]),
    ),
    traceKeyIds: [],
    traceSamples: [],
  };
  const source = {
    snapshot: async () => state,
    dump: async () => Buffer.from('PGDMPsynthetic invited fixture'),
  };
  const captured = await captureDatabase(target, source, keys, now);
  const opened = openArchive(
    captured.archive,
    new Map([[keys.keyId, keys.backup]]),
    'database',
    now,
  );
  expect(JSON.parse(opened.bytes.toString()).purpose).toBe(
    'invited-pilot-database-recovery',
  );
  const legacyRecord = JSON.parse(opened.bytes.toString());
  legacyRecord.purpose = 'family-pilot-database-recovery';
  const legacyArchive = sealArchive(
    Buffer.from(JSON.stringify(legacyRecord)),
    keys.backup,
    keys.keyId,
    'database',
    now,
  );
  opened.bytes.fill(0);
  const destination: RecoveryDestination = {
    create: vi.fn(async () => {}),
    assertFenced: async () => {},
    assertEmpty: async () => {},
    restore: async () => {},
    snapshot: async () => state,
    normalize: async (v) => v,
    stop: vi.fn(async () => {}),
  };
  await expect(
    restoreDatabase(target, legacyArchive, keys, destination, now),
  ).rejects.toThrow();
  expect(destination.create).not.toHaveBeenCalled();
  await expect(
    restoreDatabase(synthetic, captured.archive, keys, destination, now),
  ).rejects.toThrow('source mismatch');
  expect(destination.create).not.toHaveBeenCalled();
  expect(
    await restoreDatabase(target, captured.archive, keys, destination, now),
  ).toMatchObject({
    scope: 'fenced_invited_pilot_database_restore',
    catalogAndRowsMatched: true,
    restoreAccessAuthorized: false,
  });
  expect(destination.stop).toHaveBeenCalledOnce();
});

it('captures and authenticates an invited journal with a separate action purpose', async () => {
  const path = join(tmpdir(), 'invited-journal-unit.vpb'),
    secret = randomBytes(32).toString('base64');
  const input = {
    keyId: 'unit-journal',
    journalKeyB64: secret,
    accessToken: 'sbp_synthetic_canary',
    authorization: {
      purpose: 'invited-pilot-recovery-journal-capture',
      targetSHA256: recoveryTargetHash(target),
      outputPathSHA256: recoveryPathHash(path),
      expiresAt: time(3600000),
      approved: true,
      independentJournalCustody: true,
      separateKeyCustody: true,
    },
  };
  const network = vi.fn<typeof fetch>(
    async () =>
      new Response(
        JSON.stringify([
          {
            captured_at: time(),
            accounting_sha256: 'a'.repeat(64),
            nonsynthetic_users: 2,
            user_scope: identities,
            storage_objects: 0,
            receipt_count: 0,
            rows: [],
          },
        ]),
        { headers: { 'Content-Type': 'application/json' } },
      ),
  );
  for (const purpose of [
    'owner-pilot-recovery-journal-capture',
    'family-pilot-recovery-journal-capture',
  ])
    await expect(
      captureRecoveryJournal(
        target,
        path,
        {
          ...input,
          authorization: { ...input.authorization, purpose },
        },
        network,
        () => now,
      ),
    ).rejects.toThrow();
  expect(network).not.toHaveBeenCalled();
  const result = await captureRecoveryJournal(
    target,
    path,
    input,
    network,
    () => now,
  );
  expect(JSON.parse(String(network.mock.calls[0]![1]!.body)).read_only).toBe(
    true,
  );
  const credentials = {
    keyId: input.keyId,
    journalKeyB64: secret,
    backupCreatedAt: time(-1000),
  };
  expect(
    verifyRecoveryJournal(result.archive, target, credentials, now).report,
  ).toMatchObject({
    scope: 'independent_invited_pilot_deletion_journal',
    restoreAccessAuthorized: false,
  });
  expect(() =>
    verifyRecoveryJournal(result.archive, synthetic, credentials, now),
  ).toThrow();
  const opened = openArchive(
    result.archive,
    new Map([[input.keyId, Buffer.from(secret, 'base64')]]),
    'deletion_journal',
    now,
  );
  const legacyRecord = JSON.parse(opened.bytes.toString());
  legacyRecord.purpose = 'family-pilot-recovery-journal';
  opened.bytes.fill(0);
  expect(() =>
    verifyRecoveryJournal(
      sealArchive(
        Buffer.from(JSON.stringify(legacyRecord)),
        Buffer.from(secret, 'base64'),
        input.keyId,
        'deletion_journal',
        now,
      ),
      target,
      credentials,
      now,
    ),
  ).toThrow();
});

it('checks every maintenance owner against the invited manifest before any request', async () => {
  await withManifest(async (path) => {
    const network = vi.fn();
    await expect(
      hostedMaintenanceCommand(
        ['--allow-hosted', '--invited-pilot', '--manifest=' + path],
        async () => ({
          publishableKey: 'sb_publishable_synthetic',
          adminKey: 'sb_secret_synthetic',
          limits: {},
          authorization: {
            purpose: 'invited-pilot-maintenance',
            mode: 'inspect',
            targetSHA256: recoveryTargetHash(target),
            owners: [invited, randomUUID()],
            expiresAt: time(3600000),
            approved: true,
          },
        }),
        network,
        now,
      ),
    ).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();
  });
});

it('inspects only approved invited identities and preserves future accounting holds', async () => {
  await withManifest(async (path) => {
    const network = vi.fn<typeof fetch>(async (url, init) => {
      const value = String(url).includes('/auth/v1/admin/users/')
        ? {
            user: {
              id: invited,
              email: 'synthetic@example.invalid',
              app_metadata: { vulpes_data_scope: 'invited-pilot' },
            },
          }
        : {
            executed: false,
            busy: false,
            payloadsRemoved: 0,
            batchesExpired: 0,
            proposalsExpired: 0,
            receiptsRemoved: 0,
            interrupted: 0,
            conservative: 0,
            runsRemoved: 0,
            payloadsDue: 0,
            importsDue: 0,
            proposalsDue: 0,
            runsDue: 0,
            receiptsDue: 0,
            deletionPending: false,
            pendingHolds: 1,
            retryAfter: time(86400000),
            unfinished: false,
          };
      if (String(url).includes('/rpc/')) {
        expect(JSON.parse(String(init?.body))).toMatchObject({
          p_owner: invited,
          p_execute: false,
        });
        expect(String(url)).toContain('/rpc/maintain_account_v1');
      }
      return new Response(JSON.stringify(value), {
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const result = await hostedMaintenanceCommand(
      ['--inspect', '--invited-pilot', '--allow-hosted', '--manifest=' + path],
      async () => ({
        publishableKey: 'sb_publishable_synthetic',
        adminKey: 'sb_secret_synthetic',
        limits: {},
        authorization: {
          purpose: 'invited-pilot-maintenance',
          mode: 'inspect',
          targetSHA256: recoveryTargetHash(target),
          owners: [invited],
          expiresAt: time(3600000),
          approved: true,
        },
      }),
      network,
      now,
    );
    expect(result).toMatchObject({
      owners: 1,
      passes: 0,
      deletionSteps: 0,
      reports: [{ status: { pendingHolds: 1, retryAfter: time(86400000) } }],
    });
    expect(network).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(result)).not.toContain(invited);
  });
});

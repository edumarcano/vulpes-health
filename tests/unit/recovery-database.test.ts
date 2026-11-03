import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it, vi } from 'vitest';
import { encryptBytes } from '../../server/security/encryption.js';
import {
  captureDatabase,
  restoreDatabase,
  recoveryRequiredPublicTables,
  type RecoverySnapshot,
  type RecoveryDestination,
} from '../../scripts/recovery-database.js';
import { databaseRecoveryCommand } from '../../scripts/hosted-database-recovery.js';
import { connectionIdentity } from '../../scripts/recovery-postgres.js';
import { targetHash } from '../../scripts/hosting.js';

const target = {
  version: 1,
  purpose: 'synthetic-only',
  supabaseProjectRef: 'abcdefghijklmnopqrst',
  recoveryProjectRef: null,
  databaseRegion: 'us-east-1',
  vercelProjectId: 'prj_SyntheticRecovery',
  appOrigin: 'https://vulpes-synthetic.vercel.app',
} as const;
const traces = {
    activeId: 'current',
    keys: new Map([
      ['current', randomBytes(32)],
      ['previous', randomBytes(32)],
    ]),
  },
  keys = { backup: randomBytes(32), keyId: 'backup', traces },
  now = Date.now();
function state(): RecoverySnapshot {
  const sample = (key_id: string) =>
    encryptBytes(
      {
        id: randomUUID(),
        user_id: randomUUID(),
        purpose: 'ai_request',
        expires_at: new Date(now + 3600000).toISOString(),
      },
      Buffer.from('synthetic private canary'),
      { ...traces, activeId: key_id },
    );
  return {
    serverMajor: 17,
    nonsyntheticUsers: 0,
    storageObjects: 0,
    extensions: [['pg_catalog', 'plpgsql', '1.0']],
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
      ].map((k) => [k, { count: 2, hash: 'a'.repeat(64) }]),
    ),
    traceKeyIds: ['current', 'previous'],
    traceSamples: [sample('current'), sample('previous')],
  };
}
function source(value = state()) {
  return {
    snapshot: vi.fn(async () => value),
    dump: vi.fn(async () => Buffer.from('PGDMPsynthetic custom archive')),
  };
}
function destination(value: RecoverySnapshot): RecoveryDestination {
  return {
    create: vi.fn(async () => {}),
    assertFenced: vi.fn(async () => {}),
    assertEmpty: vi.fn(async () => {}),
    restore: vi.fn(async () => {}),
    snapshot: vi.fn(async () => value),
    normalize: vi.fn(async (value) => value),
    stop: vi.fn(async () => {}),
  };
}
it('has an inert plan and refuses missing/ambiguous opt-in before files, private input or Docker access', async () => {
  const read = vi.fn();
  expect(await databaseRecoveryCommand(['--plan'], read)).toMatchObject({
    networkRequests: 0,
    maximumBackupDays: 30,
  });
  await expect(
    databaseRecoveryCommand(
      ['--capture', '--manifest=missing', '--output=missing'],
      read,
    ),
  ).rejects.toThrow();
  await expect(
    databaseRecoveryCommand(
      ['--restore', '--capture', '--manifest=missing'],
      read,
    ),
  ).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
});
it('binds PostgreSQL identities to only the approved project and region with verified TLS', () => {
  const c = {
    host: 'aws-0-us-east-1.pooler.supabase.com',
    user: 'postgres.' + target.supabaseProjectRef,
    port: 5432,
    password: 'private-password-canary',
    caCertificatePem:
      '-----BEGIN CERTIFICATE-----\n' +
      'a'.repeat(100) +
      '\n-----END CERTIFICATE-----',
  };
  expect(connectionIdentity(target, c)).toMatchObject({
    sslmode: 'verify-full',
    database: 'postgres',
    caCertificateSHA256: createHash('sha256')
      .update(c.caCertificatePem)
      .digest('hex'),
  });
  for (const patch of [
    { host: 'other.example.com' },
    { user: 'postgres.otherproject' },
    { port: 6543 },
    { host: 'aws-0-eu-central-1.pooler.supabase.com' },
    { caCertificatePem: 'missing' },
  ])
    expect(() => connectionIdentity(target, { ...c, ...patch })).toThrow();
  expect(
    connectionIdentity(target, {
      ...c,
      host: 'db.' + target.supabaseProjectRef + '.supabase.co',
      user: 'postgres',
    }),
  ).toMatchObject({ sslmode: 'verify-full' });
});
it('seals a stable source and verifies every present trace-key version without exposing content or retaining dump bytes', async () => {
  const value = state(),
    s = source(value),
    buffer = Buffer.from('PGDMPsynthetic custom archive');
  s.dump.mockResolvedValue(buffer);
  const result = await captureDatabase(target, s, keys, now);
  expect(buffer.every((v) => v === 0)).toBe(true);
  expect(s.snapshot).toHaveBeenCalledTimes(2);
  expect(result.archive.includes(Buffer.from('synthetic private canary'))).toBe(
    false,
  );
  const d = destination(value),
    report = await restoreDatabase(target, result.archive, keys, d, now);
  expect(report).toMatchObject({
    catalogAndRowsMatched: true,
    network: 'none',
    publishedPorts: 0,
    traceKeyVersions: 2,
    restoreAccessAuthorized: false,
  });
  expect(d.stop).toHaveBeenCalledTimes(1);
  expect(d.restore).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(report)).not.toContain(value.traceSamples[0]!.user_id);
});
it.each(['nonsyntheticUsers', 'storageObjects'])(
  'refuses unsupported source %s before dumping',
  async (field) => {
    const value = { ...state(), [field]: 1 },
      s = source(value);
    await expect(captureDatabase(target, s, keys, now)).rejects.toThrow();
    expect(s.dump).not.toHaveBeenCalled();
  },
);
it('refuses missing security inventory or trace keys before any dump', async () => {
  const value = state();
  delete value.inventory['public.profiles'];
  const s = source(value);
  await expect(captureDatabase(target, s, keys, now)).rejects.toThrow();
  expect(s.dump).not.toHaveBeenCalled();
  const missing = source();
  await expect(
    captureDatabase(
      target,
      missing,
      {
        ...keys,
        traces: {
          ...traces,
          keys: new Map([['current', traces.keys.get('current')!]]),
        },
      },
      now,
    ),
  ).rejects.toThrow();
  expect(missing.dump).not.toHaveBeenCalled();
});
it('rejects a changing source and invalid dumps while clearing the returned plaintext buffer', async () => {
  const value = state(),
    s = source(value),
    changed = structuredClone(value);
  changed.inventory['auth.users']!.count++;
  s.snapshot.mockResolvedValueOnce(value).mockResolvedValueOnce(changed);
  const bytes = Buffer.from('PGDMPsynthetic custom archive');
  s.dump.mockResolvedValue(bytes);
  await expect(captureDatabase(target, s, keys, now)).rejects.toThrow();
  expect(bytes.every((v) => v === 0)).toBe(true);
  const invalid = source(),
    raw = Buffer.from('not a PostgreSQL dump');
  invalid.dump.mockResolvedValue(raw);
  await expect(captureDatabase(target, invalid, keys, now)).rejects.toThrow();
  expect(raw.every((v) => v === 0)).toBe(true);
});
it('refuses wrong keys, tampering, expiry and source mismatch before creating a destination', async () => {
  const value = state(),
    result = await captureDatabase(target, source(value), keys, now),
    d = destination(value),
    bad = Buffer.from(result.archive);
  bad[bad.length - 1] = bad[bad.length - 1]! ^ 1;
  await expect(restoreDatabase(target, bad, keys, d, now)).rejects.toThrow();
  await expect(
    restoreDatabase(
      target,
      result.archive,
      { ...keys, backup: randomBytes(32) },
      d,
      now,
    ),
  ).rejects.toThrow();
  await expect(
    restoreDatabase(target, result.archive, keys, d, now + 30 * 86400000),
  ).rejects.toThrow();
  await expect(
    restoreDatabase(
      { ...target, supabaseProjectRef: 'zyxwvutsrqponmlkjihg' },
      result.archive,
      keys,
      d,
      now,
    ),
  ).rejects.toThrow();
  expect(d.create).not.toHaveBeenCalled();
  expect(d.stop).not.toHaveBeenCalled();
});
it.each(['assertFenced', 'assertEmpty', 'restore', 'snapshot'])(
  'stops only the owned destination after failure at %s',
  async (method) => {
    const value = state(),
      result = await captureDatabase(target, source(value), keys, now),
      d = destination(value);
    vi.mocked(d[method as 'assertEmpty']).mockRejectedValue(
      Error('synthetic failure'),
    );
    await expect(
      restoreDatabase(target, result.archive, keys, d, now),
    ).rejects.toThrow();
    expect(d.stop).toHaveBeenCalledTimes(1);
    if (method === 'assertFenced' || method === 'assertEmpty')
      expect(d.restore).not.toHaveBeenCalled();
  },
);
it.each(['catalog', 'inventory', 'extensions'])(
  'refuses a restored %s mismatch and stops the destination',
  async (field) => {
    const value = state(),
      result = await captureDatabase(target, source(value), keys, now),
      different = structuredClone(value);
    if (field === 'catalog') different.catalog.grants = [2];
    else if (field === 'inventory')
      different.inventory['auth.users']!.hash = 'b'.repeat(64);
    else different.extensions = [];
    const d = destination(different);
    await expect(
      restoreDatabase(target, result.archive, keys, d, now),
    ).rejects.toThrow();
    expect(d.stop).toHaveBeenCalledTimes(1);
  },
);
it('refuses a mismatched or expired authorization before any source connection', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vulpes-recovery-approval-'));
  try {
    const manifest = join(root, 'manifest.json');
    await writeFile(
      manifest,
      JSON.stringify({ target, targetSHA256: targetHash(target) }),
    );
    const input = {
      backupKeyB64: keys.backup.toString('base64'),
      keyId: keys.keyId,
      traces: {
        activeId: traces.activeId,
        keys: Object.fromEntries(
          [...traces.keys].map(([k, v]) => [k, v.toString('base64')]),
        ),
      },
      connection: {
        host: 'db.' + target.supabaseProjectRef + '.supabase.co',
        user: 'postgres',
        port: 5432,
        password: 'private-canary',
        caCertificatePem:
          '-----BEGIN CERTIFICATE-----\n' +
          'a'.repeat(100) +
          '\n-----END CERTIFICATE-----',
      },
      independentBackupCustody: true,
      separateKeyCustody: true,
      authorization: {
        purpose: 'synthetic-database-capture',
        targetSHA256: targetHash(target),
        bindingSHA256: 'a'.repeat(64),
        expiresAt: new Date(now - 1000).toISOString(),
        approved: true,
      },
    };
    await expect(
      databaseRecoveryCommand(
        [
          '--capture',
          '--allow-hosted-capture',
          '--manifest=' + manifest,
          '--output=' + join(root, 'new.vpb'),
        ],
        async () => input,
      ),
    ).rejects.toThrow('authorization');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

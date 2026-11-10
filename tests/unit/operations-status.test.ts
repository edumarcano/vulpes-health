import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { expect, it, vi } from 'vitest';
import {
  capacityStatus,
  operationsStatusBinding,
  operationsStatusCommand,
  operationsStatusQuery,
} from '../../scripts/operations-status.js';
import { targetHash } from '../../scripts/hosting.js';
import { sealArchive } from '../../scripts/backup-archive.js';
import { recoveryRequiredPublicTables } from '../../scripts/recovery-database.js';

const target = {
  version: 1,
  purpose: 'synthetic-only',
  supabaseProjectRef: 'abcdefghijklmnopqrst',
  recoveryProjectRef: null,
  databaseRegion: 'us-east-1',
  vercelProjectId: 'prj_StatusTest',
  appOrigin: 'https://status-test.vercel.app',
} as const;
const user = randomUUID(),
  now = Date.now();
const status = () => ({
  capturedAt: new Date(now).toISOString(),
  databaseBytes: 1000,
  userCount: 1,
  nonsyntheticUsers: 0,
  userScope: [{ id: user, synthetic: true }],
  completedDeletionOwners: [],
  relations: [{ name: 'private_payloads', bytes: 10 }],
  payloadsDue: 4,
  importsDue: 3,
  proposalsDue: 2,
  terminalRunsDue: 1,
  pendingHolds: 1,
  pendingDeletions: 1,
  storageObjects: 0,
});
const input = (backup?: unknown) => ({
  accessToken: 'sbp_synthetic',
  ...(backup ? { backup } : {}),
  authorization: {
    purpose: 'synthetic-operations-inspect',
    targetSHA256: targetHash(target),
    bindingSHA256: operationsStatusBinding(
      backup as Parameters<typeof operationsStatusBinding>[0],
    ),
    expiresAt: new Date(now + 3600000).toISOString(),
    approved: true,
  },
});
async function fixture(run: (path: string, dir: string) => Promise<void>) {
  const dir = await mkdtemp(join(tmpdir(), 'vulpes-status-test-')),
    path = join(dir, 'manifest.json');
  try {
    await writeFile(
      path,
      JSON.stringify({ target, targetSHA256: targetHash(target) }),
    );
    await run(path, dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
const args = (path: string) => [
  '--inspect',
  '--allow-hosted',
  '--manifest=' + path,
];
const response = (value = status()) =>
  new Response(JSON.stringify([{ status: value }]), {
    headers: { 'content-type': 'application/json' },
  });

it('keeps plans inert and rejects implicit inspection before secrets or network', async () => {
  const read = vi.fn(),
    send = vi.fn();
  expect(await operationsStatusCommand(['--plan'], read, send)).toMatchObject({
    networkRequests: 0,
    sourceWrites: 0,
  });
  await expect(
    operationsStatusCommand(['--manifest=absent'], read, send),
  ).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});
it('reports the fixed read-only aggregates with unknown disk/backup and omits identity material', async () =>
  fixture(async (path) => {
    const send = vi.fn(async (url, init) => {
      expect(String(url)).toBe(
        'https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/database/query',
      );
      expect(init).toMatchObject({
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
      });
      expect(JSON.parse(String(init?.body))).toEqual({
        query: operationsStatusQuery,
        read_only: true,
      });
      return response();
    }) as typeof fetch;
    const result = await operationsStatusCommand(
      args(path),
      async () => input(),
      send,
      () => now,
    );
    expect(result).toMatchObject({
      sourceWrites: 0,
      requests: 1,
      backup: { state: 'unknown' },
      disk: { state: 'unknown' },
      pendingHolds: 1,
      retention: { payloadsDue: 4 },
      releaseReadiness: 'not_established',
    });
    expect(JSON.stringify(result)).not.toContain(user);
    expect(JSON.stringify(result)).not.toContain('sbp_synthetic');
  }));
it.each([
  { purpose: 'invited-pilot-operations-inspect' },
  { targetSHA256: 'a'.repeat(64) },
  { bindingSHA256: 'b'.repeat(64) },
  { expiresAt: new Date(now).toISOString() },
])('refuses mismatched approval before networking: %j', async (patch) =>
  fixture(async (path) => {
    const send = vi.fn();
    const value = input();
    Object.assign(value.authorization, patch);
    await expect(
      operationsStatusCommand(
        args(path),
        async () => value,
        send,
        () => now,
      ),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  }),
);
it.each([
  { capturedAt: new Date(now - 300001).toISOString() },
  { nonsyntheticUsers: 1, userScope: [{ id: user, synthetic: false }] },
  { databaseBytes: -1 },
])('rejects stale, personal or malformed returned state: %j', async (patch) =>
  fixture(async (path) => {
    await expect(
      operationsStatusCommand(
        args(path),
        async () => input(),
        async () => response({ ...status(), ...patch }),
        () => now,
      ),
    ).rejects.toThrow();
  }),
);
it('uses separate warning and critical boundaries', () => {
  expect(capacityStatus(69, 100).state).toBe('within_threshold');
  expect(capacityStatus(70, 100).state).toBe('warning');
  expect(capacityStatus(85, 100).state).toBe('critical');
});
it('authenticates equal distinct backups, exposes overdue capture and refuses corruption or a same-file copy', async () =>
  fixture(async (path, dir) => {
    const backupKey = randomBytes(32),
      archivePath = join(dir, 'a.enc'),
      copyPath = join(dir, 'b.enc');
    const snapshot = {
      serverMajor: 17,
      nonsyntheticUsers: 0,
      userScope: [{ id: user, synthetic: true }],
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
      inventory: {
        ...Object.fromEntries(
          recoveryRequiredPublicTables.map((t) => [
            'public.' + t,
            { count: 0, hash: 'a'.repeat(64) },
          ]),
        ),
        'auth.users': { count: 1, hash: 'a'.repeat(64) },
      },
      traceKeyIds: [],
      traceSamples: [],
    };
    const bundle = {
      targetSHA256: targetHash(target),
      purpose: 'synthetic-database-recovery',
      snapshot,
      dumpBase64: Buffer.from('PGDMPsynthetic').toString('base64'),
    };
    const invalidArchive = sealArchive(
      Buffer.from(JSON.stringify(bundle)),
      backupKey,
      'test-backup',
      'database',
      now - 8 * 86400000,
    );
    await writeFile(archivePath, invalidArchive);
    await writeFile(copyPath, invalidArchive);
    const backup = {
      archivePath,
      copyPath,
      keyId: 'test-backup',
      backupKeyB64: backupKey.toString('base64'),
      traces: {},
    };
    const run = (b = backup) =>
      operationsStatusCommand(
        args(path),
        async () => input(b),
        async () => response(),
        () => now,
      );
    await expect(run()).rejects.toThrow();
    const archive = sealArchive(
      Buffer.from(JSON.stringify({ version: 1, ...bundle })),
      backupKey,
      'test-backup',
      'database',
      now - 8 * 86400000,
    );
    await writeFile(archivePath, archive);
    await writeFile(copyPath, archive);
    expect(await run()).toMatchObject({
      backup: {
        state: 'overdue',
        copiesAuthenticatedEqual: true,
        independentCustodyVerified: false,
        restoreVerified: false,
      },
    });
    await expect(run({ ...backup, copyPath: archivePath })).rejects.toThrow();
    const corrupt = Buffer.from(archive);
    corrupt[corrupt.length - 1] = corrupt[corrupt.length - 1]! ^ 1;
    await writeFile(copyPath, corrupt);
    await expect(run()).rejects.toThrow();
    await writeFile(archivePath, corrupt);
    await expect(run()).rejects.toThrow();
  }));
it('bounds real streamed HTTP responses and rejects oversized replies', async () =>
  fixture(async (path) => {
    let oversized = false;
    const server = createServer((req, res) => {
      expect(req.method).toBe('POST');
      res.setHeader('content-type', 'application/json');
      res.end(
        oversized ? ' '.repeat(65537) : JSON.stringify([{ status: status() }]),
      );
    });
    await new Promise<void>((resolve) =>
      server.listen(0, '127.0.0.1', resolve),
    );
    const address = server.address();
    if (!address || typeof address === 'string') throw Error();
    try {
      const send: typeof fetch = (_url, init) =>
        fetch(`http://127.0.0.1:${address.port}`, init);
      expect(
        await operationsStatusCommand(
          args(path),
          async () => input(),
          send,
          () => now,
        ),
      ).toMatchObject({ requests: 1 });
      oversized = true;
      await expect(
        operationsStatusCommand(
          args(path),
          async () => input(),
          send,
          () => now,
        ),
      ).rejects.toThrow('bound');
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((e) => (e ? reject(e) : resolve())),
      );
    }
  }));

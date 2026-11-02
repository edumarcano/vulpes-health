import { createServer } from 'node:http';
import { mkdtemp, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes, randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import {
  captureRecoveryJournal,
  verifyRecoveryJournal,
  recoveryJournalCommand,
  recoveryPathHash,
  recoveryJournalQuery,
} from '../../scripts/recovery-journal.js';
import { targetHash } from '../../scripts/hosting.js';
import { sealArchive, openArchive } from '../../scripts/backup-archive.js';

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
  time = (offset = 0) => new Date(now + offset).toISOString();
const secret = randomBytes(32),
  keyId = 'synthetic-recovery',
  key = { keyId, journalKeyB64: secret.toString('base64') },
  backupCreatedAt = time(-60_000),
  path = join(tmpdir(), 'synthetic-current.enc');
const row = {
  user_id: randomUUID(),
  id: randomUUID(),
  phase: 'completed',
  requested_at: time(-40_000),
  updated_at: time(-20_000),
  completed_at: time(-20_000),
  outcome: 'completed',
};
const pending = {
  ...row,
  user_id: randomUUID(),
  id: randomUUID(),
  phase: 'auth_removal_pending',
  completed_at: null,
  outcome: 'auth_unavailable',
};
const snapshot = {
  captured_at: time(),
  nonsynthetic_users: 0,
  storage_objects: 0,
  receipt_count: 2,
  rows: [row, pending],
};
const credentials = (output = path) => ({
  ...key,
  accessToken: 'sbp_private_canary',
  authorization: {
    purpose: 'synthetic-recovery-journal-capture',
    targetSHA256: targetHash(target),
    outputPathSHA256: recoveryPathHash(output),
    expiresAt: time(3600_000),
    approved: true,
    independentJournalCustody: true,
    separateKeyCustody: true,
  },
});
const response = (value: unknown = snapshot) =>
  new Response(JSON.stringify([value]), {
    headers: { 'Content-Type': 'application/json' },
  });
const record = (rows: unknown[] = [row, pending]) => ({
  version: 1,
  purpose: 'synthetic-recovery-journal',
  targetSHA256: targetHash(target),
  journal: { schemaVersion: 1, capturedAt: time(), rows },
});
const archive = (value: unknown = record()) =>
  sealArchive(
    Buffer.from(JSON.stringify(value)),
    secret,
    keyId,
    'deletion_journal',
    now,
  );
async function directory(
  run: (root: string, manifest: string) => Promise<void>,
) {
  const root = await mkdtemp(join(tmpdir(), 'vulpes-recovery-journal-'));
  try {
    const manifest = join(root, 'manifest.json');
    await writeFile(
      manifest,
      JSON.stringify({ target, targetSHA256: targetHash(target) }),
    );
    await run(root, manifest);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

it('is inert in plan mode and refuses capture without opt-in before manifest, secrets or network', async () => {
  const read = vi.fn(),
    send = vi.fn();
  expect(await recoveryJournalCommand(['--plan'], read, send)).toMatchObject({
    networkRequests: 0,
    maximumCaptureRequests: 1,
  });
  await expect(
    recoveryJournalCommand(
      ['--capture', '--manifest=missing', '--output=missing'],
      read,
      send,
    ),
  ).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
  expect(send).not.toHaveBeenCalled();
});
it.each([
  { approved: false },
  { targetSHA256: 'f'.repeat(64) },
  { outputPathSHA256: 'a'.repeat(64) },
  { expiresAt: time(-1) },
  { expiresAt: time(25 * 3600_000) },
  { separateKeyCustody: false },
  { independentJournalCustody: false },
])(
  'refuses unapproved target/path/expiry/custody before network: %j',
  async (patch) => {
    const send = vi.fn(),
      input = credentials();
    await expect(
      captureRecoveryJournal(
        target,
        path,
        { ...input, authorization: { ...input.authorization, ...patch } },
        send,
        () => now,
      ),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
  },
);
it('captures complete and unfinished deletion records in one read-only source statement, sealing rows before persistence', async () => {
  const send = vi.fn<typeof fetch>(async () => response());
  const result = await captureRecoveryJournal(
    target,
    path,
    credentials(),
    send,
    () => now,
  );
  expect(send).toHaveBeenCalledTimes(1);
  const [url, options] = send.mock.calls[0]!;
  expect(url).toBe(
    'https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/database/query',
  );
  expect(options).toMatchObject({
    method: 'POST',
    redirect: 'error',
    credentials: 'omit',
  });
  expect(JSON.parse(String(options?.body))).toEqual({
    query: recoveryJournalQuery,
    read_only: true,
  });
  expect(result.archive.includes(Buffer.from(row.user_id))).toBe(false);
  expect(JSON.stringify(result.report)).not.toContain(row.user_id);
  expect(JSON.stringify(result.report)).not.toContain('private_canary');
  expect(result.report).toMatchObject({
    receipts: 2,
    unfinishedRequests: 1,
    sourceWrites: 0,
    restoreAccessAuthorized: false,
  });
  const verified = verifyRecoveryJournal(
    result.archive,
    target,
    { ...key, backupCreatedAt },
    now,
  );
  expect(verified.journal.rows).toEqual([row, pending]);
  expect(verified.report.restoreAccessAuthorized).toBe(false);
});
it.each([
  { nonsynthetic_users: 1 },
  { storage_objects: 1 },
  { receipt_count: 3 },
  { receipt_count: 10001 },
  { captured_at: time(-301_000) },
  { captured_at: time(-300_000), rows: [], receipt_count: 0 },
  { captured_at: time(6000) },
  { rows: [row, row] },
  { rows: [{ ...row, outcome: 'in_progress' }, pending] },
  { rows: [{ ...row, updated_at: time(1000) }, pending] },
])(
  'refuses incomplete, unsupported or invalid source snapshots: %j',
  async (patch) => {
    await expect(
      captureRecoveryJournal(
        target,
        path,
        credentials(),
        async () => response({ ...snapshot, ...patch }),
        () => now,
      ),
    ).rejects.toThrow();
  },
);
it('rejects authentication/HTML/oversized results and approval expiry during a request without leaking diagnostics', async () => {
  for (const body of [
    new Response('private canary', { status: 403 }),
    new Response('<html>private</html>'),
    new Response(' '.repeat(5 * 1024 * 1024 + 1), {
      headers: { 'Content-Type': 'application/json' },
    }),
  ])
    await expect(
      captureRecoveryJournal(
        target,
        path,
        credentials(),
        async () => body,
        () => now,
      ),
    ).rejects.toThrow();
  let clock = now;
  const input = credentials();
  input.authorization.expiresAt = time(500);
  await expect(
    captureRecoveryJournal(
      target,
      path,
      input,
      async () => {
        clock = now + 1000;
        return response();
      },
      () => clock,
    ),
  ).rejects.toThrow();
});
it('authenticates journal bytes, purpose, source, backup coverage, key and freshness before exposing replay records', () => {
  const value = archive(),
    tampered = Buffer.from(value);
  tampered[tampered.length - 1] = tampered[tampered.length - 1]! ^ 1;
  expect(() =>
    verifyRecoveryJournal(tampered, target, { ...key, backupCreatedAt }, now),
  ).toThrow();
  expect(() =>
    verifyRecoveryJournal(
      value,
      target,
      {
        ...key,
        journalKeyB64: randomBytes(32).toString('base64'),
        backupCreatedAt,
      },
      now,
    ),
  ).toThrow();
  expect(() =>
    verifyRecoveryJournal(
      value,
      { ...target, supabaseProjectRef: 'zyxwvutsrqponmlkjihg' },
      { ...key, backupCreatedAt },
      now,
    ),
  ).toThrow();
  expect(() =>
    verifyRecoveryJournal(
      value,
      target,
      { ...key, backupCreatedAt: time(1) },
      now,
    ),
  ).toThrow();
  expect(() =>
    verifyRecoveryJournal(
      value,
      target,
      { ...key, backupCreatedAt },
      now + 300_000,
    ),
  ).toThrow();
  expect(() =>
    verifyRecoveryJournal(
      sealArchive(Buffer.from('{}'), secret, keyId, 'database', now),
      target,
      { ...key, backupCreatedAt },
      now,
    ),
  ).toThrow();
  const misleading = record();
  misleading.journal.capturedAt = time(-301_000);
  expect(() =>
    verifyRecoveryJournal(
      archive(misleading),
      target,
      { ...key, backupCreatedAt: time(-400_000) },
      now,
    ),
  ).toThrow();
  expect(() =>
    verifyRecoveryJournal(
      archive(record([row, { ...pending, id: row.id }])),
      target,
      { ...key, backupCreatedAt },
      now,
    ),
  ).toThrow();
});
it('writes ciphertext create-only, verifies offline without network, and refuses an existing output before reading credentials', async () => {
  await directory(async (root, manifest) => {
    const output = join(root, 'journal.enc'),
      args = [
        '--capture',
        '--allow-hosted',
        '--manifest=' + manifest,
        '--output=' + output,
      ];
    await recoveryJournalCommand(
      args,
      async () => credentials(output),
      async () => response(),
    );
    const bytes = await readFile(output);
    expect(
      openArchive(
        bytes,
        new Map([[keyId, secret]]),
        'deletion_journal',
      ).bytes.toString(),
    ).toContain(row.user_id);
    expect(bytes.includes(Buffer.from(row.user_id))).toBe(false);
    const read = vi.fn(),
      send = vi.fn();
    await expect(recoveryJournalCommand(args, read, send)).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(await readFile(output)).toEqual(bytes);
    expect(
      await recoveryJournalCommand(
        ['--verify', '--manifest=' + manifest, '--archive=' + output],
        async () => ({ ...key, backupCreatedAt }),
        send,
      ),
    ).toMatchObject({
      networkRequests: 0,
      receipts: 2,
      unfinishedRequests: 1,
      restoreAccessAuthorized: false,
    });
    expect(send).not.toHaveBeenCalled();
  });
});
it('leaves no output after rejected capture and rejects credential extras or ambiguous modes', async () => {
  await directory(async (root, manifest) => {
    const output = join(root, 'journal.enc'),
      send = vi.fn();
    await expect(
      recoveryJournalCommand(
        [
          '--capture',
          '--verify',
          '--allow-hosted',
          '--manifest=' + manifest,
          '--output=' + output,
        ],
        vi.fn(),
        send,
      ),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    await expect(
      captureRecoveryJournal(
        target,
        output,
        { ...credentials(output), providerKey: 'forbidden' },
        send,
      ),
    ).rejects.toThrow();
    expect(send).not.toHaveBeenCalled();
    await expect(
      recoveryJournalCommand(
        [
          '--capture',
          '--allow-hosted',
          '--manifest=' + manifest,
          '--output=' + output,
        ],
        async () => credentials(output),
        async () => response({ ...snapshot, receipt_count: 0 }),
      ),
    ).rejects.toThrow();
    expect(await readdir(root)).toEqual(['manifest.json']);
  });
});
it('exercises the actual request and bounded response over a loopback HTTP server with an injected transport', async () => {
  const seen: { path: string; body: unknown }[] = [];
  const server = createServer(async (request, response) => {
    let body = '';
    for await (const part of request) body += part;
    seen.push({ path: request.url!, body: JSON.parse(body) });
    response.setHeader('Content-Type', 'application/json');
    response.end(JSON.stringify([snapshot]));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string')
    throw Error('Loopback unavailable');
  try {
    const report = await captureRecoveryJournal(
      target,
      path,
      credentials(),
      (url, init) => {
        expect(String(url)).toBe(
          'https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/database/query',
        );
        return fetch(
          'http://127.0.0.1:' + address.port + new URL(String(url)).pathname,
          { ...init, headers: { 'Content-Type': 'application/json' } },
        );
      },
      () => now,
    );
    expect(report.report.receipts).toBe(2);
    expect(seen).toEqual([
      {
        path: '/v1/projects/abcdefghijklmnopqrst/database/query',
        body: { query: recoveryJournalQuery, read_only: true },
      },
    ]);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

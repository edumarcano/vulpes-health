import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { lstat, realpath, readFile, open } from 'node:fs/promises';
import { z } from 'zod';
import { RecoveryHttpSchema, type RecoveryHttpInput } from './recovery-http.js';
import {
  RecoveryTargetSchema,
  recoveryTargetHash,
  checkRecoveryMode,
  recoveryPurpose,
} from './recovery-target.js';
import {
  recoveryPathHash,
  RecoveryJournalCaptureInputSchema,
  recoveryJournalCommand,
} from './recovery-journal.js';
import { captureDatabase, restoreDatabase } from './recovery-database.js';
import {
  RecoveryConnectionSchema,
  connectionIdentity,
  hostedRecoverySource,
  fencedRecoveryDestination,
} from './recovery-postgres.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/),
  key = z.string().regex(/^[A-Za-z0-9+/]{43}=$/);
const keysSchema = z.strictObject({
  backupKeyB64: key,
  keyId: z.string().min(1).max(100),
  traces: z
    .strictObject({
      activeId: z.string().min(1).max(200),
      keys: z.record(z.string().min(1).max(200), key),
    })
    .refine(
      (t) =>
        Object.hasOwn(t.keys, t.activeId) && Object.keys(t.keys).length <= 10,
    ),
});
const authorizationSchema = z.strictObject({
  purpose: z.enum([
    'synthetic-database-capture',
    'synthetic-fenced-database-restore',
    'synthetic-fenced-database-recovery',
    'owner-pilot-database-capture',
    'owner-pilot-fenced-database-restore',
    'owner-pilot-fenced-database-recovery',
  ]),
  targetSHA256: hash,
  bindingSHA256: hash,
  expiresAt: z.iso.datetime(),
  approved: z.literal(true),
});
const captureSchema = keysSchema.extend({
  connection: RecoveryConnectionSchema,
  independentBackupCustody: z.literal(true),
  separateKeyCustody: z.literal(true),
  authorization: authorizationSchema,
});
const restoreSchema = keysSchema.extend({ authorization: authorizationSchema });
const replaySchema = restoreSchema.extend({
  journal: RecoveryJournalCaptureInputSchema,
  httpProof: RecoveryHttpSchema.optional(),
});
const digest = (v: unknown) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const databaseCaptureBinding = (
  connection: ReturnType<typeof connectionIdentity>,
  path: string,
) => digest({ connection, outputPathSHA256: recoveryPathHash(path) });
export const databaseRestoreBinding = (archive: Buffer, image: string) =>
  digest({
    archiveSHA256: createHash('sha256').update(archive).digest('hex'),
    image,
  });
export const databaseRecoveryBinding = (
  archive: Buffer,
  image: string,
  journal: Buffer,
  latestPath: string,
  httpProof?: RecoveryHttpInput,
) =>
  digest({
    ...(httpProof
      ? {
          httpProof: {
            authImage: httpProof.authImage,
            restImage: httpProof.restImage,
            users: httpProof.users.map((u) => ({ id: u.id, email: u.email })),
          },
        }
      : {}),
    restore: databaseRestoreBinding(archive, image),
    journalSHA256: createHash('sha256').update(journal).digest('hex'),
    latestPathSHA256: recoveryPathHash(latestPath),
  });
export const databaseRecoveryPlan = {
  scope: 'synthetic_database_capture_and_fenced_restore',
  networkRequests: 0,
  sourceWrites: 0,
  maximumDumpMiB: 128,
  maximumBackupDays: 30,
  requires:
    'Exact source/connection/output or archive/image approval, separate retained backup/trace keys, existing private output directory and local cached PostgreSQL client image.',
  restoreFence:
    'A fresh local container, network none, no published ports or host bind mounts, stopped after verification. No access-enable command.',
  recovery:
    'Explicit recover mode requires a fresh accounting-bearing journal and approval for one current hosted journal read after replay/revocation. Current ledger fingerprints must match. Optional --verify-http binds cached Auth/API images and synthetic identities to this approval; all traffic remains inside the network-none namespace.',
  excludes: [
    'source-loss/cutover authorization',
    'credential custody attestation',
    'hosted destination',
    'scheduler',
    'provider calls',
    'real data',
    'access activation',
  ],
};

export async function databaseRecoveryCommand(
  args: string[],
  readCredentials: () => Promise<unknown>,
  network: typeof fetch = fetch,
  onFailure?: (bytes: Buffer) => void,
) {
  const v = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      plan: { type: 'boolean' },
      capture: { type: 'boolean' },
      restore: { type: 'boolean' },
      recover: { type: 'boolean' },
      manifest: { type: 'string' },
      output: { type: 'string' },
      archive: { type: 'string' },
      image: { type: 'string' },
      journal: { type: 'string' },
      'journal-latest': { type: 'string' },
      'verify-http': { type: 'boolean' },
      'allow-hosted-capture': { type: 'boolean' },
      'allow-fenced-restore': { type: 'boolean' },
      'allow-hosted-journal-read': { type: 'boolean' },
      'owner-pilot': { type: 'boolean' },
    },
  }).values;
  if (
    v.plan &&
    Object.keys(v).every((k) => ['plan', 'owner-pilot'].includes(k))
  )
    return v['owner-pilot']
      ? {
          ...databaseRecoveryPlan,
          scope: 'owner_pilot_database_capture_and_fenced_restore',
          recovery:
            'Owner-mode replay requires a fresh complete journal, restored-session revocation and current source accounting. HTTP fixture services are synthetic-only; restored access remains blocked.',
          requires:
            databaseRecoveryPlan.requires +
            ' One named owner and at most one declared synthetic peer.',
          excludes: [
            ...databaseRecoveryPlan.excludes.filter((e) => e !== 'real data'),
            'family identities',
            'HTTP test services with owner credentials',
          ],
        }
      : databaseRecoveryPlan;
  if (v['verify-http'] && !v.recover)
    throw new Error('HTTP proof requires explicit recovery mode.');
  if (
    v.plan ||
    !v.manifest ||
    [v.capture, v.restore, v.recover].filter(Boolean).length !== 1 ||
    (v.capture &&
      (!v['allow-hosted-capture'] ||
        v['allow-fenced-restore'] ||
        !v.output ||
        v.archive ||
        v.image)) ||
    (!v.capture &&
      (!v['allow-fenced-restore'] ||
        v['allow-hosted-capture'] ||
        !v.archive ||
        !v.image ||
        v.output)) ||
    (v.recover &&
      (!v['allow-hosted-journal-read'] ||
        !v.journal ||
        !v['journal-latest'])) ||
    (!v.recover &&
      (v['allow-hosted-journal-read'] || v.journal || v['journal-latest']))
  )
    throw new Error('Explicit database recovery mode required.');
  const manifest = z
    .object({ target: RecoveryTargetSchema, targetSHA256: hash })
    .parse(JSON.parse(await readFile(v.manifest, 'utf8')));
  checkRecoveryMode(manifest.target, v['owner-pilot'] ?? false);
  if (manifest.target.purpose === 'owner-pilot' && v['verify-http'])
    throw new Error('HTTP fixture services are synthetic-only.');
  if (manifest.targetSHA256 !== recoveryTargetHash(manifest.target))
    throw new Error('Invalid source manifest.');
  const input = v.capture
    ? captureSchema.parse(await readCredentials())
    : v.recover
      ? replaySchema.parse(await readCredentials())
      : restoreSchema.parse(await readCredentials());
  const authorize = (purpose: string, binding: string) => {
    const a = input.authorization,
      now = Date.now(),
      expiry = Date.parse(a.expiresAt);
    const expected = recoveryPurpose(
      manifest.target,
      purpose,
      purpose.replace(/^synthetic-/, 'owner-pilot-'),
    );
    if (
      a.purpose !== expected ||
      a.targetSHA256 !== manifest.targetSHA256 ||
      a.bindingSHA256 !== binding ||
      expiry <= now ||
      expiry > now + 24 * 3600_000
    )
      throw new Error('Database recovery authorization mismatch.');
  };
  const keys = {
    backup: Buffer.from(input.backupKeyB64, 'base64'),
    keyId: input.keyId,
    traces: {
      activeId: input.traces.activeId,
      keys: new Map(
        Object.entries(input.traces.keys).map(([id, value]) => [
          id,
          Buffer.from(value, 'base64'),
        ]),
      ),
    },
  };
  try {
    if (v.capture) {
      const capture = captureSchema.parse(input),
        path = resolve(v.output!);
      if (
        (await realpath(dirname(path))) !== dirname(path) ||
        (await lstat(path).then(
          () => true,
          (e: NodeJS.ErrnoException) => {
            if (e.code === 'ENOENT') return false;
            throw e;
          },
        ))
      )
        throw new Error('New private output required.');
      const binding = databaseCaptureBinding(
          connectionIdentity(manifest.target, capture.connection),
          path,
        ),
        check = () => authorize('synthetic-database-capture', binding);
      check();
      const result = await captureDatabase(
        manifest.target,
        hostedRecoverySource(manifest.target, capture.connection, check),
        keys,
      );
      try {
        check();
        const file = await open(path, 'wx', 0o600);
        try {
          await file.writeFile(result.archive);
          await file.sync();
        } finally {
          await file.close();
        }
        return result.report;
      } finally {
        result.archive.fill(0);
      }
    }
    const path = v.archive!,
      stat = await lstat(path);
    if (
      !stat.isFile() ||
      stat.isSymbolicLink() ||
      stat.size > 256 * 1024 * 1024 + 4096
    )
      throw new Error('Invalid database archive.');
    const archive = await readFile(path),
      image = v.image!;
    let journal: Buffer | undefined;
    if (v.recover) {
      const stored = await lstat(v.journal!);
      if (
        !stored.isFile() ||
        stored.isSymbolicLink() ||
        stored.size > 5 * 1024 * 1024 + 4096
      )
        throw new Error('Invalid independent journal.');
      journal = await readFile(v.journal!);
    }
    const replayInput = v.recover ? replaySchema.parse(input) : undefined;
    if (!!v['verify-http'] !== !!replayInput?.httpProof)
      throw new Error('Explicit HTTP proof opt-in required.');
    const binding = journal
        ? databaseRecoveryBinding(
            archive,
            image,
            journal,
            v['journal-latest']!,
            replayInput?.httpProof,
          )
        : databaseRestoreBinding(archive, image),
      check = () =>
        authorize(
          v.recover
            ? 'synthetic-fenced-database-recovery'
            : 'synthetic-fenced-database-restore',
          binding,
        );
    check();
    const destination = fencedRecoveryDestination(image, check, onFailure);
    try {
      const replay = replayInput;
      const options =
        replay && journal
          ? {
              journal,
              ...(replay.httpProof ? { httpProof: replay.httpProof } : {}),
              keyId: replay.journal.keyId,
              journalKeyB64: replay.journal.journalKeyB64,
              current: async () => {
                check();
                await recoveryJournalCommand(
                  [
                    '--capture',
                    '--allow-hosted',
                    ...(v['owner-pilot'] ? ['--owner-pilot'] : []),
                    '--manifest=' + v.manifest,
                    '--output=' + v['journal-latest'],
                  ],
                  async () => replay.journal,
                  network,
                );
                return readFile(v['journal-latest']!);
              },
            }
          : undefined;
      return {
        ...(await restoreDatabase(
          manifest.target,
          archive,
          keys,
          destination,
          Date.now(),
          options,
        )),
        destination: destination.name,
      };
    } finally {
      archive.fill(0);
      journal?.fill(0);
    }
  } finally {
    keys.backup.fill(0);
    for (const value of keys.traces.keys.values()) value.fill(0);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  databaseRecoveryCommand(process.argv.slice(2), async () => {
    let raw = '';
    for await (const chunk of process.stdin) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 128 * 1024)
        throw new Error('Private input too large.');
    }
    return JSON.parse(raw) as unknown;
  })
    .then((report) => console.info(JSON.stringify(report, null, 2)))
    .catch(() => {
      console.error(
        'Database recovery refused or failed. Check the reviewed target, private credentials, approval and local owned destination. No credentials, SQL diagnostics or private rows are logged. Restore access is not authorized.',
      );
      process.exitCode = 1;
    });
}

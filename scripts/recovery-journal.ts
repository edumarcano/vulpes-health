import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import { lstat, open, readFile, realpath } from 'node:fs/promises';
import { z } from 'zod';
import { DeletionJournalSchema } from '../server/services/account.js';
import {
  RecoveryTargetSchema,
  recoveryTargetHash,
  checkRecoveryMode,
  checkRecoveryUsers,
  recoveryPurpose,
  RecoveryUserScopeSchema,
  syntheticRecoveryIdentitySql,
  type RecoveryTarget,
} from './recovery-target.js';
import { sealArchive, openArchive } from './backup-archive.js';
import { recoveryAccountingExpression } from './recovery-accounting.js';

const maxRows = 10_000,
  maxBytes = 5 * 1024 * 1024;
const hashSchema = z.string().regex(/^[a-f0-9]{64}$/);
const keySchema = z.string().regex(/^[A-Za-z0-9+/]{43}=$/);
const keysSchema = z.strictObject({
  keyId: z.string().min(1).max(100),
  journalKeyB64: keySchema,
});
const captureSchema = keysSchema.extend({
  accessToken: z
    .string()
    .regex(/^sbp_[\w-]+$/)
    .max(4096),
  authorization: z.strictObject({
    purpose: z.enum([
      'synthetic-recovery-journal-capture',
      'owner-pilot-recovery-journal-capture',
      'invited-pilot-recovery-journal-capture',
    ]),
    targetSHA256: hashSchema,
    outputPathSHA256: hashSchema,
    expiresAt: z.iso.datetime(),
    approved: z.literal(true),
    independentJournalCustody: z.literal(true),
    separateKeyCustody: z.literal(true),
  }),
});
export const RecoveryJournalCaptureInputSchema = captureSchema;
const journalSchema = z
  .strictObject({
    version: z.literal(1),
    purpose: z.enum([
      'synthetic-recovery-journal',
      'owner-pilot-recovery-journal',
      'invited-pilot-recovery-journal',
    ]),
    targetSHA256: hashSchema,
    accountingSHA256: hashSchema.optional(),
    journal: DeletionJournalSchema,
  })
  .superRefine((value, ctx) => {
    const rows = value.journal.rows;
    if (
      rows.length > maxRows ||
      new Set(rows.map((r) => r.user_id.toLowerCase())).size !== rows.length ||
      new Set(rows.map((r) => r.id.toLowerCase())).size !== rows.length
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Journal inventory is invalid.',
      });
    for (const row of rows) {
      const captured = Date.parse(value.journal.capturedAt),
        requested = Date.parse(row.requested_at),
        updated = Date.parse(row.updated_at);
      if (
        updated < requested ||
        updated > captured ||
        (row.completed_at !== null &&
          (Date.parse(row.completed_at) < requested ||
            Date.parse(row.completed_at) > captured)) ||
        (row.phase === 'completed') !== (row.outcome === 'completed')
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Journal lifecycle is invalid.',
        });
    }
  });
const snapshotSchema = z
  .array(
    z.strictObject({
      captured_at: z.iso.datetime({ offset: true }),
      accounting_sha256: hashSchema.optional(),
      nonsynthetic_users: z.number().int().nonnegative(),
      user_scope: RecoveryUserScopeSchema.optional(),
      storage_objects: z.number().int().nonnegative(),
      receipt_count: z.number().int().min(0).max(maxRows),
      rows: z.array(z.unknown()).max(maxRows),
    }),
  )
  .length(1);

// One read-only statement/snapshot, with no pagination gap or omitted unfinished requests.
export const recoveryJournalQuery = `select to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as captured_at,
 ${recoveryAccountingExpression} as accounting_sha256,
 (select count(*) from auth.users where not (${syntheticRecoveryIdentitySql})) as nonsynthetic_users,
 (select coalesce(jsonb_agg(jsonb_build_object('id',id,'synthetic',(${syntheticRecoveryIdentitySql})) order by id),'[]') from auth.users) as user_scope,
 (select count(*) from storage.objects) as storage_objects,
 (select count(*) from public.account_deletion_receipts) as receipt_count,
 coalesce((select jsonb_agg(to_jsonb(d) order by user_id) from (select * from public.account_deletion_receipts order by user_id limit 10001) d),'[]'::jsonb) as rows;`;
export const recoveryJournalPlan = {
  scope: 'independent_synthetic_deletion_journal',
  networkRequests: 0,
  maximumCaptureRequests: 1,
  maximumRows: maxRows,
  maximumResponseBytes: maxBytes,
  maximumJournalAgeSeconds: 300,
  requires:
    'Explicit target/output-bound capture approval, existing private directory, separate retained journal key and independent journal custody.',
  excludes: [
    'database backup',
    'restoration',
    'access activation',
    'source writes',
    'credentials reset',
    'scheduler',
    'provider calls',
    'real data',
  ],
};
export const recoveryPathHash = (path: string) =>
  createHash('sha256').update(resolve(path)).digest('hex');

async function boundedJson(response: Response) {
  if (
    !response.ok ||
    !response.headers
      .get('content-type')
      ?.toLowerCase()
      .startsWith('application/json')
  )
    throw new Error('Journal source unavailable.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Journal body missing.');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.byteLength;
      if (length > maxBytes) throw new Error('Journal response too large.');
      chunks.push(part.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally {
    await reader.cancel();
  }
}
function approval(
  input: z.infer<typeof captureSchema>,
  target: RecoveryTarget,
  path: string,
  now: number,
) {
  const a = input.authorization,
    expires = Date.parse(a.expiresAt);
  if (
    a.purpose !==
      recoveryPurpose(
        target,
        'synthetic-recovery-journal-capture',
        'owner-pilot-recovery-journal-capture',
      ) ||
    a.targetSHA256 !== recoveryTargetHash(target) ||
    a.outputPathSHA256 !== recoveryPathHash(path) ||
    expires <= now ||
    expires > now + 24 * 3600_000
  )
    throw new Error('Journal authorization mismatch.');
}
export async function captureRecoveryJournal(
  target: RecoveryTarget,
  path: string,
  credentials: unknown,
  network: typeof fetch = fetch,
  clock: () => number = Date.now,
) {
  const checked = RecoveryTargetSchema.parse(target),
    input = captureSchema.parse(credentials);
  approval(input, checked, path, clock());
  const response = await network(
    `https://api.supabase.com/v1/projects/${checked.supabaseProjectRef}/database/query`,
    {
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.timeout(25_000),
      headers: {
        Authorization: 'Bearer ' + input.accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: recoveryJournalQuery, read_only: true }),
    },
  );
  const snapshot = snapshotSchema.parse(await boundedJson(response))[0]!;
  approval(input, checked, path, clock());
  if (
    snapshot.storage_objects !== 0 ||
    snapshot.rows.length !== snapshot.receipt_count
  )
    throw new Error('Unsupported or incomplete source.');
  const now = clock(),
    captured = Date.parse(snapshot.captured_at);
  if (captured > now + 5000 || captured <= now - 300_000)
    throw new Error('Source clock or journal freshness unavailable.');
  const journal = journalSchema.parse({
    version: 1,
    purpose: recoveryPurpose(
      checked,
      'synthetic-recovery-journal',
      'owner-pilot-recovery-journal',
    ),
    targetSHA256: recoveryTargetHash(checked),
    accountingSHA256: snapshot.accounting_sha256,
    journal: {
      schemaVersion: 1,
      capturedAt: new Date(captured).toISOString(),
      rows: snapshot.rows,
    },
  });
  checkRecoveryUsers(
    checked,
    snapshot.nonsynthetic_users,
    snapshot.user_scope,
    undefined,
    journal.journal.rows
      .filter((row) => row.phase === 'completed')
      .map((row) => row.user_id),
  );
  const key = Buffer.from(input.journalKeyB64, 'base64'),
    bytes = Buffer.from(JSON.stringify(journal));
  try {
    return {
      archive: sealArchive(bytes, key, input.keyId, 'deletion_journal', now),
      report: {
        scope: recoveryPurpose(
          checked,
          'independent_synthetic_deletion_journal',
          'independent_owner_pilot_deletion_journal',
        ),
        mode: 'capture',
        targetSHA256: journal.targetSHA256,
        requests: 1,
        receipts: journal.journal.rows.length,
        unfinishedRequests: journal.journal.rows.filter(
          (r) => r.phase !== 'completed',
        ).length,
        sourceWrites: 0,
        restoreAccessAuthorized: false,
      },
    };
  } finally {
    key.fill(0);
    bytes.fill(0);
  }
}

// Callers obtain backupCreatedAt from the authenticated backup header. This is
// journal validation only; replay/fencing/current completeness are separate gates.
export function verifyRecoveryJournal(
  archive: Buffer,
  target: RecoveryTarget,
  credentials: unknown,
  now = Date.now(),
) {
  target = RecoveryTargetSchema.parse(target);
  const input = keysSchema
      .extend({ backupCreatedAt: z.iso.datetime() })
      .parse(credentials),
    key = Buffer.from(input.journalKeyB64, 'base64');
  let opened: ReturnType<typeof openArchive> | undefined;
  try {
    opened = openArchive(
      archive,
      new Map([[input.keyId, key]]),
      'deletion_journal',
      now,
    );
    const record = journalSchema.parse(
        JSON.parse(opened.bytes.toString('utf8')),
      ),
      captured = Date.parse(record.journal.capturedAt),
      backup = Date.parse(input.backupCreatedAt);
    if (
      record.purpose !==
        recoveryPurpose(
          target,
          'synthetic-recovery-journal',
          'owner-pilot-recovery-journal',
        ) ||
      record.targetSHA256 !== recoveryTargetHash(target) ||
      captured < backup ||
      captured > now + 5000 ||
      captured <= now - 300_000 ||
      backup > now + 5000 ||
      Math.abs(captured - Date.parse(opened.header.createdAt)) > 300_000
    )
      throw new Error('Journal target/coverage/freshness mismatch.');
    return {
      journal: record.journal,
      accountingSHA256: record.accountingSHA256,
      report: {
        scope: recoveryPurpose(
          target,
          'independent_synthetic_deletion_journal',
          'independent_owner_pilot_deletion_journal',
        ),
        mode: 'verify',
        targetSHA256: record.targetSHA256,
        receipts: record.journal.rows.length,
        unfinishedRequests: record.journal.rows.filter(
          (r) => r.phase !== 'completed',
        ).length,
        networkRequests: 0,
        restoreAccessAuthorized: false,
      },
    };
  } finally {
    key.fill(0);
    opened?.bytes.fill(0);
  }
}

export async function recoveryJournalCommand(
  args: string[],
  readCredentials: () => Promise<unknown>,
  network: typeof fetch = fetch,
) {
  const v = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      plan: { type: 'boolean' },
      capture: { type: 'boolean' },
      verify: { type: 'boolean' },
      manifest: { type: 'string' },
      output: { type: 'string' },
      archive: { type: 'string' },
      'allow-hosted': { type: 'boolean' },
      'owner-pilot': { type: 'boolean' },
      'invited-pilot': { type: 'boolean' },
    },
  }).values;
  if (
    v.plan &&
    !(v['owner-pilot'] && v['invited-pilot']) &&
    Object.keys(v).every((k) =>
      ['plan', 'owner-pilot', 'invited-pilot'].includes(k),
    )
  )
    return v['owner-pilot']
      ? {
          ...recoveryJournalPlan,
          scope: 'independent_owner_pilot_deletion_journal',
          requires:
            recoveryJournalPlan.requires +
            ' One named owner and at most one declared synthetic peer.',
          excludes: recoveryJournalPlan.excludes.filter(
            (e) => e !== 'real data',
          ),
        }
      : v['invited-pilot']
        ? {
            ...recoveryJournalPlan,
            scope: 'independent_invited_pilot_deletion_journal',
            requires:
              recoveryJournalPlan.requires +
              ' At most ten explicitly named owner, invited and synthetic identities.',
            excludes: recoveryJournalPlan.excludes.filter(
              (e) => e !== 'real data',
            ),
          }
        : recoveryJournalPlan;
  if (
    v.plan ||
    !v.manifest ||
    !!v.capture === !!v.verify ||
    (v.capture && (!v['allow-hosted'] || !v.output || v.archive)) ||
    (v.verify && (!v.archive || v.output || v['allow-hosted']))
  )
    throw new Error('Explicit journal mode required.');
  const manifest = z
    .object({ target: RecoveryTargetSchema, targetSHA256: hashSchema })
    .parse(JSON.parse(await readFile(v.manifest, 'utf8')));
  checkRecoveryMode(
    manifest.target,
    v['owner-pilot'] ?? false,
    v['invited-pilot'] ?? false,
  );
  if (manifest.targetSHA256 !== recoveryTargetHash(manifest.target))
    throw new Error('Invalid target manifest.');
  if (v.capture) {
    const path = resolve(v.output!),
      parent = await realpath(dirname(path));
    if (
      parent !== dirname(path) ||
      (await lstat(path).then(
        () => true,
        (e: NodeJS.ErrnoException) => {
          if (e.code === 'ENOENT') return false;
          throw e;
        },
      ))
    )
      throw new Error(
        'Journal destination must be new and use a real directory.',
      );
    const result = await captureRecoveryJournal(
      manifest.target,
      path,
      await readCredentials(),
      network,
    );
    try {
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
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes + 4096)
    throw new Error('Invalid journal file.');
  return verifyRecoveryJournal(
    await readFile(path),
    manifest.target,
    await readCredentials(),
  ).report;
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  recoveryJournalCommand(process.argv.slice(2), async () => {
    let raw = '';
    for await (const chunk of process.stdin) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 16 * 1024)
        throw new Error('Input too large.');
    }
    return JSON.parse(raw) as unknown;
  })
    .then((report) => console.info(JSON.stringify(report, null, 2)))
    .catch(() => {
      console.error(
        'Recovery journal refused or failed. Check the approved target/output, private input, source completeness and archive freshness. No credentials or journal rows are logged; restore access remains blocked.',
      );
      process.exitCode = 1;
    });
}

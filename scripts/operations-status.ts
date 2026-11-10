import { createHash } from 'node:crypto';
import { parseArgs } from 'node:util';
import { open, readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { z } from 'zod';
import {
  inspectDatabaseArchive,
  maximumDumpBytes,
} from './recovery-database.js';
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

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const key = z.string().regex(/^[A-Za-z0-9+/]{43}=$/);
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
const BackupInput = z
  .strictObject({
    archivePath: z.string().min(1),
    copyPath: z.string().min(1),
    keyId: z.string().min(1).max(100),
    backupKeyB64: key,
    traces: z.record(z.string().min(1).max(200), key),
  })
  .refine((v) => Object.keys(v.traces).length <= 10);
const Input = z.strictObject({
  accessToken: z
    .string()
    .regex(/^sbp_[\w-]+$/)
    .max(4096),
  backup: BackupInput.optional(),
  authorization: z.strictObject({
    purpose: z.enum([
      'synthetic-operations-inspect',
      'owner-pilot-operations-inspect',
      'family-pilot-operations-inspect',
    ]),
    targetSHA256: hash,
    bindingSHA256: hash,
    expiresAt: z.iso.datetime(),
    approved: z.literal(true),
  }),
});
const relation = z.enum([
  'private_payloads',
  'measurements',
  'messages',
  'ai_runs',
  'ai_steps',
  'import_batches',
  'goals',
  'usage_buckets',
  'usage_reservations',
  'account_deletion_receipts',
]);
const Status = z.strictObject({
  capturedAt: z.iso.datetime({ offset: true }),
  databaseBytes: count,
  userCount: count,
  nonsyntheticUsers: count,
  userScope: RecoveryUserScopeSchema,
  completedDeletionOwners: z.array(z.uuid()).max(10000),
  relations: z.array(z.strictObject({ name: relation, bytes: count })).max(10),
  payloadsDue: count,
  importsDue: count,
  proposalsDue: count,
  terminalRunsDue: count,
  pendingHolds: count,
  pendingDeletions: count,
  storageObjects: count,
});

// The query checks account scope internally; the report omits identities.
export const operationsStatusQuery = `select jsonb_build_object(
 'capturedAt',to_char(statement_timestamp() at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
 'databaseBytes',pg_database_size(current_database()),
 'userCount',(select count(*) from auth.users),
 'nonsyntheticUsers',(select count(*) from auth.users where not (${syntheticRecoveryIdentitySql})),
 'userScope',(select coalesce(jsonb_agg(jsonb_build_object('id',id,'synthetic',(${syntheticRecoveryIdentitySql})) order by id),'[]') from auth.users),
 'completedDeletionOwners',(select coalesce(jsonb_agg(user_id order by user_id),'[]') from public.account_deletion_receipts where phase='completed'),
 'relations',(select coalesce(jsonb_agg(jsonb_build_object('name',relname,'bytes',bytes) order by bytes desc),'[]') from
  (select relname,pg_total_relation_size(relid) as bytes from pg_catalog.pg_statio_user_tables where schemaname='public' and relname in ('private_payloads','measurements','messages','ai_runs','ai_steps','import_batches','goals','usage_buckets','usage_reservations','account_deletion_receipts')) s),
 'payloadsDue',(select count(*) from public.private_payloads where expires_at<=statement_timestamp()),
 'importsDue',(select count(*) from public.import_batches where status='previewed' and expires_at<=statement_timestamp()),
 'proposalsDue',(select count(*) from public.action_proposals where state='pending' and expires_at<=statement_timestamp()),
 'terminalRunsDue',(select count(*) from public.ai_runs where status in ('completed','failed','cancelled','interrupted') and expires_at<=statement_timestamp()),
 'pendingHolds',(select count(*) from public.usage_reservations where status='pending'),
 'pendingDeletions',(select count(*) from public.account_deletion_receipts where phase<>'completed'),
 'storageObjects',(select count(*) from storage.objects)) as status;`;

export function capacityStatus(bytes: number, limit: number) {
  return {
    bytes,
    limitBytes: limit,
    state:
      bytes >= limit * 0.85
        ? 'critical'
        : bytes >= limit * 0.7
          ? 'warning'
          : 'within_threshold',
  };
}
export function operationsStatusBinding(backup?: z.infer<typeof BackupInput>) {
  return createHash('sha256')
    .update(
      JSON.stringify(
        backup
          ? {
              archivePathSHA256: createHash('sha256')
                .update(resolve(backup.archivePath))
                .digest('hex'),
              copyPathSHA256: createHash('sha256')
                .update(resolve(backup.copyPath))
                .digest('hex'),
              keyId: backup.keyId,
              traceKeyIds: Object.keys(backup.traces).sort(),
            }
          : { backup: null },
      ),
    )
    .digest('hex');
}
async function boundedFile(path: string) {
  const file = await open(path, 'r');
  try {
    const stat = await file.stat();
    if (!stat.isFile() || stat.size > 256 * 1024 * 1024 + 4096)
      throw Error('Archive bound.');
    const bytes = await file.readFile();
    if (bytes.length !== stat.size || bytes.length > 256 * 1024 * 1024 + 4096)
      throw Error('Archive changed.');
    return { bytes, stat };
  } finally {
    await file.close();
  }
}
async function verifyBackup(
  target: RecoveryTarget,
  input: z.infer<typeof BackupInput>,
  now: number,
) {
  const a = await boundedFile(input.archivePath);
  const backupKey = Buffer.from(input.backupKeyB64, 'base64');
  const traces = new Map(
    Object.entries(input.traces).map(([id, value]) => [
      id,
      Buffer.from(value, 'base64'),
    ]),
  );
  let b: Awaited<ReturnType<typeof boundedFile>> | undefined;
  try {
    b = await boundedFile(input.copyPath);
    if (
      resolve(input.archivePath) === resolve(input.copyPath) ||
      (a.stat.dev === b.stat.dev && a.stat.ino === b.stat.ino) ||
      !a.bytes.equals(b.bytes)
    )
      throw Error('Distinct equal backup copies required.');
    const inspected = inspectDatabaseArchive(
      target,
      a.bytes,
      {
        backup: backupKey,
        keyId: input.keyId,
        traces: { activeId: '', keys: traces },
      },
      now,
    );
    try {
      return {
        state:
          now - Date.parse(inspected.header.createdAt) <= 7 * 86400_000
            ? 'within_target'
            : 'overdue',
        createdAt: inspected.header.createdAt,
        verifiedAt: new Date(now).toISOString(),
        archiveSHA256: createHash('sha256').update(a.bytes).digest('hex'),
        copiesAuthenticatedEqual: true,
        independentCustodyVerified: false,
        traceKeyVersionsVerified: inspected.snapshot.traceKeyIds.length,
        dump: capacityStatus(inspected.dump.length, maximumDumpBytes),
        restoreVerified: false,
      };
    } finally {
      inspected.dispose();
    }
  } finally {
    backupKey.fill(0);
    traces.forEach((v) => v.fill(0));
    a.bytes.fill(0);
    b?.bytes.fill(0);
  }
}
export async function operationsStatusCommand(
  args: string[],
  readInput: () => Promise<unknown>,
  network: typeof fetch = fetch,
  clock: () => number = Date.now,
) {
  const v = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      plan: { type: 'boolean' },
      inspect: { type: 'boolean' },
      'allow-hosted': { type: 'boolean' },
      manifest: { type: 'string' },
      'owner-pilot': { type: 'boolean' },
      'family-pilot': { type: 'boolean' },
    },
  }).values;
  if (
    v.plan &&
    Object.keys(v).every((k) =>
      ['plan', 'owner-pilot', 'family-pilot'].includes(k),
    ) &&
    !(v['owner-pilot'] && v['family-pilot'])
  )
    return {
      scope: 'operator_status',
      networkRequests: 0,
      sourceWrites: 0,
      maximumRequests: 1,
      thresholds: { warningPercent: 70, criticalPercent: 85 },
      requires:
        'Exact manifest/mode and expiring status authorization; private stdin. Optional backup/copy and retained keys require their path-bound approval.',
      limitations: [
        'Total disk/WAL usage requires a separate Dashboard reading.',
        'Matching files do not independently prove off-site custody or a successful restore.',
      ],
    };
  if (v.plan || !v.inspect || !v['allow-hosted'] || !v.manifest)
    throw Error('Explicit inspection required.');
  const manifest = z
    .strictObject({ target: RecoveryTargetSchema, targetSHA256: hash })
    .parse(JSON.parse(await readFile(v.manifest, 'utf8')));
  checkRecoveryMode(
    manifest.target,
    v['owner-pilot'] ?? false,
    v['family-pilot'] ?? false,
  );
  if (manifest.targetSHA256 !== recoveryTargetHash(manifest.target))
    throw Error('Target mismatch.');
  const input = Input.parse(await readInput());
  function authorize() {
    const a = input.authorization,
      now = clock(),
      expiry = Date.parse(a.expiresAt);
    if (
      a.targetSHA256 !== manifest.targetSHA256 ||
      a.purpose !==
        recoveryPurpose(
          manifest.target,
          'synthetic-operations-inspect',
          'owner-pilot-operations-inspect',
        ) ||
      a.bindingSHA256 !== operationsStatusBinding(input.backup) ||
      expiry <= now ||
      expiry > now + 86400_000
    )
      throw Error('Status authorization mismatch.');
  }
  authorize();
  const backup = input.backup
    ? await verifyBackup(manifest.target, input.backup, clock())
    : { state: 'unknown' };
  authorize();
  const response = await network(
    `https://api.supabase.com/v1/projects/${manifest.target.supabaseProjectRef}/database/query`,
    {
      method: 'POST',
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.timeout(25_000),
      headers: {
        Authorization: 'Bearer ' + input.accessToken,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query: operationsStatusQuery, read_only: true }),
    },
  );
  if (
    !response.ok ||
    !response.headers.get('content-type')?.startsWith('application/json') ||
    !response.body
  )
    throw Error('Status unavailable.');
  const reader = response.body.getReader(),
    chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      length += part.value.length;
      if (length > 64 * 1024) throw Error('Status response bound.');
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  const data = z
    .array(z.strictObject({ status: Status }))
    .length(1)
    .parse(JSON.parse(Buffer.concat(chunks).toString()))[0]!.status;
  authorize();
  const captured = Date.parse(data.capturedAt);
  if (captured > clock() + 5000 || captured <= clock() - 300_000)
    throw Error('Status stale.');
  checkRecoveryUsers(
    manifest.target,
    data.nonsyntheticUsers,
    data.userScope,
    data.userCount,
    data.completedDeletionOwners,
  );
  return {
    scope: 'operator_status',
    targetSHA256: manifest.targetSHA256,
    capturedAt: data.capturedAt,
    sourceWrites: 0,
    requests: 1,
    database: capacityStatus(data.databaseBytes, 500_000_000),
    disk: {
      state: 'unknown',
      requiredAction:
        'Read total disk and WAL usage in the Supabase Dashboard; database size is not total disk usage.',
    },
    relations: data.relations,
    retention: {
      payloadsDue: data.payloadsDue,
      importsDue: data.importsDue,
      proposalsDue: data.proposalsDue,
      terminalRunsDue: data.terminalRunsDue,
    },
    pendingHolds: data.pendingHolds,
    pendingDeletions: data.pendingDeletions,
    storageObjects: data.storageObjects,
    backup,
    releaseReadiness: 'not_established',
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  operationsStatusCommand(process.argv.slice(2), async () => {
    let raw = '';
    for await (const chunk of process.stdin) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 32768) throw Error('Input bound.');
    }
    return JSON.parse(raw) as unknown;
  })
    .then((v) => console.info(JSON.stringify(v, null, 2)))
    .catch(() => {
      console.error(
        'Operator inspection refused or failed. No source writes; private diagnostics omitted.',
      );
      process.exitCode = 1;
    });
}

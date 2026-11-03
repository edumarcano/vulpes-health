import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  mkdirSync,
  readFileSync,
  writeFileSync,
  mkdtempSync,
  unlinkSync,
  rmdirSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../server/db/database.types.js';
import {
  localStatus,
  localEnvironment,
  projectRoot,
  projectId,
  assertLocalStack,
} from './local-database.js';
import { LocalSupabase } from '../tests/helpers/local-supabase.js';
import { sealArchive, openArchive } from './backup-archive.js';
import {
  recoverySchemaSql as schemaSql,
  recoveryInventorySql,
} from './recovery-inventory.js';
import {
  DeletionJournalSchema,
  beginDeletion,
  continueDeletion,
} from '../server/services/account.js';
import {
  verifyIdentity,
  verifySession,
  serverClientOptions,
} from '../server/auth/session.js';
import {
  encryptBytes,
  decryptBytes,
  type EncryptionKeys,
} from '../server/security/encryption.js';
import { recoverAccount } from '../server/security/account-recovery.js';

assert.equal(
  process.argv.length,
  2,
  'Backup verification accepts no connection overrides.',
);
assertLocalStack();
const source = localStatus();
const fixture = new LocalSupabase();
const require = createRequire(import.meta.url);
const suffix = randomUUID().slice(0, 8);
const targetId = `vulpes-health-pr16-restore-${suffix}`;
const targetRoot = join(projectRoot, '.scratch', targetId);
const sourceContainer = `supabase_db_${projectId}`;
const targetContainer = `supabase_db_${targetId}`;
assert.notEqual(sourceContainer, targetContainer);
mkdirSync(join(projectRoot, '.scratch'), { recursive: true });
mkdirSync(targetRoot);
mkdirSync(join(targetRoot, 'supabase'));
const targetConfig = readFileSync(
  join(projectRoot, 'supabase/config.toml'),
  'utf8',
).replace(/project_id = "[^"]+"/, `project_id = "${targetId}"`);
// Fixed, separate loopback ports; CLI workdir and Docker names are generated internally.
const configured = targetConfig
  .replace(
    /(\[api\][\s\S]*?\nport = )\d+/,
    (_line, prefix: string) => prefix + '28321',
  )
  .replace(
    /(\[db\][\s\S]*?\nport = )\d+/,
    (_line, prefix: string) => prefix + '28322',
  )
  .replace(/shadow_port = \d+/, 'shadow_port = 28320');
writeFileSync(join(targetRoot, 'supabase/config.toml'), configured, {
  flag: 'wx',
});
const backupRoot = join(projectRoot, 'backups', `synthetic-${suffix}`);
mkdirSync(backupRoot, { recursive: true });
const journalRoot = join(
  projectRoot,
  'private-data',
  `deletion-journal-${suffix}`,
);
mkdirSync(journalRoot, { recursive: true });
const keyRoot = mkdtempSync(join(tmpdir(), 'vulpes-backup-keys-'));
const keyPath = join(keyRoot, 'keys.json');
const backupKey = randomBytes(32),
  journalKey = randomBytes(32),
  currentKey = randomBytes(32),
  previousKey = randomBytes(32);
const keys: EncryptionKeys = {
  activeId: 'synthetic-current',
  keys: new Map([
    ['synthetic-current', currentKey],
    ['synthetic-previous', previousKey],
  ]),
};
writeFileSync(
  keyPath,
  JSON.stringify({
    backup: backupKey.toString('base64'),
    journal: journalKey.toString('base64'),
    current: currentKey.toString('base64'),
    previous: previousKey.toString('base64'),
  }),
  { mode: 0o600, flag: 'wx' },
);
function command(binary: string, args: string[], input?: Buffer) {
  const result = spawnSync(binary, args, {
    cwd: projectRoot,
    env: localEnvironment(),
    input,
    encoding: undefined,
    maxBuffer: 300 * 1024 * 1024,
    timeout: 180_000,
  });
  if (result.error || result.status !== 0) {
    // Only a primary pg_restore DDL error is diagnostic; COPY context and CLI output stay private.
    const stderr = result.stderr?.toString() ?? '';
    const detail = args.includes('pg_restore')
      ? stderr
          .match(/could not execute query: ERROR:\s+([^\r\n]+)/)?.[1]
          ?.slice(0, 200)
      : args.includes('psql')
        ? stderr.match(/(?:^|\n)ERROR:\s+([^\r\n]+)/)?.[1]?.slice(0, 200)
        : undefined;
    const ddl = args.includes('pg_restore')
      ? stderr.match(
          /Command was: ((?:ALTER|DROP|CREATE|COMMENT|GRANT|REVOKE)[^\r\n]{1,200})/,
        )?.[1]
      : undefined;
    throw new Error(
      `Guarded local ${args.includes('pg_restore') ? 'pg_restore' : 'command'} failed${detail ? ': ' + detail : ''}${ddl ? ' (' + ddl + ')' : ''}`,
    );
  }
  return Buffer.from(result.stdout);
}
function cli(args: string[]) {
  return command(process.execPath, [
    require.resolve('supabase/dist/supabase.js'),
    ...args,
    '--workdir',
    targetRoot,
  ]);
}
function sql(
  container: string,
  statement: string,
  role: 'postgres' | 'supabase_admin' = 'postgres',
) {
  assert([sourceContainer, targetContainer].includes(container));
  return command(
    'docker',
    [
      'exec',
      '-i',
      container,
      'psql',
      '-X',
      '-qAt',
      '-U',
      role,
      '-d',
      'postgres',
      '-v',
      'ON_ERROR_STOP=1',
    ],
    Buffer.from(statement),
  )
    .toString('utf8')
    .trim();
}
// Reparse CHECK definitions on empty temporary tables. PostgreSQL flattens legacy
// tuple-IN boolean trees during dump/restore; physical attribute holes and ACL order
// likewise do not change schema semantics. All constraints and grants remain compared.
function inventory(container: string) {
  return JSON.parse(sql(container, recoveryInventorySql)) as Record<
    string,
    { count: number; hash: string }
  >;
}
let started = false;
let ownsRoute = false;
let phase = 'source safety checks';
let report: Record<string, unknown> | undefined;
const previousEnv = { ...process.env };
try {
  const users = (await (
    await fixture.admin('/auth/v1/admin/users?page=1&per_page=1', 'GET')
  ).json()) as { users: unknown[] };
  assert.equal(
    users.users.length,
    0,
    'Refusing a populated source, including retained verification accounts.',
  );
  for (const table of [
    'profiles',
    'live_verification_allocations',
    'usage_buckets',
  ])
    assert.equal(
      (
        (await (
          await fixture.admin(`/rest/v1/${table}?limit=1`, 'GET')
        ).json()) as unknown[]
      ).length,
      0,
      'Refusing retained product or verification state.',
    );
  Object.assign(process.env, {
    VITE_SUPABASE_URL: source.apiUrl,
    VITE_SUPABASE_PUBLISHABLE_KEY: source.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: source.adminKey,
    VULPES_TRACE_ENCRYPTION_KEY_ID: keys.activeId,
    VULPES_TRACE_ENCRYPTION_KEY_B64: currentKey.toString('base64'),
    VULPES_TRACE_PREVIOUS_KEYS_JSON: JSON.stringify({
      'synthetic-previous': previousKey.toString('base64'),
    }),
  });
  phase = 'synthetic two-owner fixture';
  const deleted = await fixture.createUser(),
    kept = await fixture.createUser();
  const graphs = [await fixture.seed(deleted.id), await fixture.seed(kept.id)];
  for (const [index, graph] of graphs.entries()) {
    const body = Buffer.from(`Synthetic encrypted restore trace ${index}`);
    const keyring = index ? keys : { ...keys, activeId: 'synthetic-previous' };
    const envelope = encryptBytes(
      {
        id: graph.ids.private_payloads,
        user_id: graph.userId,
        purpose: 'ai_request',
        expires_at: new Date(Date.now() + 3600_000).toISOString(),
      },
      body,
      keyring,
    );
    await fixture.admin(
      `/rest/v1/private_payloads?id=eq.${envelope.id}`,
      'PATCH',
      envelope,
    );
  }
  ownsRoute =
    sql(
      sourceContainer,
      "insert into public.ai_route_cost_blocks(provider,model_id) values('openrouter','synthetic-backup-bound') on conflict do nothing returning true;",
    ) === 't';
  if (
    sql(
      sourceContainer,
      "select to_regclass('storage.objects') is not null",
    ) === 't'
  )
    assert.equal(
      sql(sourceContainer, 'select count(*) from storage.objects'),
      '0',
      'Object Storage backup is unsupported; destination must not open without the object bytes.',
    );
  phase = 'encrypted backup';
  const schema = sql(sourceContainer, schemaSql);
  const before = inventory(sourceContainer);
  const dump = command('docker', [
    'exec',
    sourceContainer,
    'pg_dump',
    '-U',
    'postgres',
    '-d',
    'postgres',
    '--format=custom',
    '--schema=public',
    '--schema=auth',
    '--schema=storage',
    '--schema=supabase_migrations',
  ]);
  const archive = sealArchive(dump, backupKey, 'synthetic-backup', 'database');
  dump.fill(0);
  const archivePath = join(backupRoot, 'database.vpb');
  writeFileSync(archivePath, archive, { mode: 0o600, flag: 'wx' });
  assert.throws(() => openArchive(archive, new Map(), 'database'));
  const tampered = Buffer.from(archive);
  tampered[tampered.length - 20] = tampered[tampered.length - 20]! ^ 1;
  assert.throws(() =>
    openArchive(
      tampered,
      new Map([['synthetic-backup', backupKey]]),
      'database',
    ),
  );
  assert.throws(() =>
    openArchive(
      archive,
      new Map([['synthetic-backup', backupKey]]),
      'database',
      Date.now() + 31 * 24 * 3600_000,
    ),
  );
  phase = 'separate empty destination';
  started = true;
  cli(['start']);
  const targetStatus = JSON.parse(
    cli(['status', '-o', 'json']).toString(),
  ) as Record<string, string>;
  assert.equal(targetStatus.API_URL, 'http://127.0.0.1:28321');
  const targetUrl = new URL(targetStatus.DB_URL!);
  assert.equal(targetUrl.hostname, '127.0.0.1');
  assert.equal(targetUrl.port, '28322');
  assert.equal(
    sql(targetContainer, 'select count(*) from auth.users'),
    '0',
    'Refusing a populated destination.',
  );
  assert.equal(
    sql(
      targetContainer,
      "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'",
    ),
    '0',
    'Destination product schema must be empty.',
  );
  const admin = createClient<Database>(
    targetStatus.API_URL!,
    targetStatus.SERVICE_ROLE_KEY!,
    serverClientOptions,
  );
  const publicClient = createClient<Database>(
    targetStatus.API_URL!,
    targetStatus.ANON_KEY!,
    serverClientOptions,
  );
  // No restored user can connect while restore validation and deletion replay are pending.
  command('docker', [
    'stop',
    `supabase_kong_${targetId}`,
    `supabase_auth_${targetId}`,
    `supabase_rest_${targetId}`,
  ]);
  phase = 'authenticated restore';
  assert(statSync(archivePath).size <= 256 * 1024 * 1024 + 4096);
  const opened = openArchive(
    readFileSync(archivePath),
    new Map([['synthetic-backup', backupKey]]),
    'database',
  );
  // pg_restore --clean cannot drop policies on absent product tables. The verified-empty,
  // disconnected destination gets fresh schemas instead of partially cleaning a mixed schema.
  phase = 'empty destination schema preparation';
  sql(
    targetContainer,
    'drop schema if exists public,auth,storage,supabase_migrations cascade;',
    'supabase_admin',
  );
  phase = 'authenticated restore';
  try {
    command(
      'docker',
      [
        'exec',
        '-i',
        targetContainer,
        'pg_restore',
        '-U',
        'supabase_admin',
        '-d',
        'postgres',
        '--exit-on-error',
        '--single-transaction',
      ],
      opened.bytes,
    );
  } finally {
    opened.bytes.fill(0);
  }
  phase = 'restore schema comparison';
  const expectedSchema = JSON.parse(schema) as Record<string, unknown[]>;
  const actualSchema = JSON.parse(sql(targetContainer, schemaSql)) as Record<
    string,
    unknown[]
  >;
  for (const section of Object.keys(expectedSchema)) {
    if (
      JSON.stringify(expectedSchema[section]) !==
      JSON.stringify(actualSchema[section])
    ) {
      const left = expectedSchema[section]!,
        right = actualSchema[section]!;
      const index = left.findIndex(
        (value, n) => JSON.stringify(value) !== JSON.stringify(right[n]),
      );
      // Schema metadata only, never database rows, credentials or private payloads.
      console.error(
        JSON.stringify({
          schemaDifference: section,
          expectedCount: left.length,
          actualCount: right.length,
          index,
        }),
      );
      throw new Error('Restored schema/functions/owners/grants/RLS differ.');
    }
  }
  phase = 'restore row inventory';
  assert.deepEqual(
    inventory(targetContainer),
    before,
    'Restored rows or storage inventory differ.',
  );
  for (const [index, graph] of graphs.entries()) {
    const restored = JSON.parse(
      sql(
        targetContainer,
        `select to_jsonb(p) from public.private_payloads p where id='${graph.ids.private_payloads}'`,
      ),
    );
    assert.equal(
      decryptBytes(restored, keys).toString(),
      `Synthetic encrypted restore trace ${index}`,
      'Restored trace or retained key failed.',
    );
    assert.throws(() =>
      decryptBytes(restored, { activeId: keys.activeId, keys: new Map() }),
    );
  }
  phase = 'post-backup deletion';
  const identity = await verifyIdentity({
    headers: { authorization: `Bearer ${deleted.token}` },
  });
  await beginDeletion(identity);
  for (let n = 0; n < 100; n++) {
    const state = await continueDeletion(identity);
    if (state.state === 'deleting' && state.phase === 'completed') break;
    assert(n < 99, 'Source deletion did not finish.');
  }
  async function captureJournal() {
    const all: unknown = JSON.parse(
      sql(
        sourceContainer,
        "select coalesce(jsonb_agg(to_jsonb(d) order by user_id),'[]') from public.account_deletion_receipts d",
      ),
    );
    return DeletionJournalSchema.parse({
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      rows: all,
    });
  }
  const journal = await captureJournal();
  const journalPath = join(journalRoot, 'current.enc');
  writeFileSync(
    journalPath,
    sealArchive(
      Buffer.from(JSON.stringify(journal)),
      journalKey,
      'synthetic-journal',
      'deletion_journal',
    ),
    { mode: 0o600, flag: 'wx' },
  );
  function readJournal(
    journalKeys: ReadonlyMap<string, Buffer> = new Map([
      ['synthetic-journal', journalKey],
    ]),
  ) {
    assert(
      statSync(journalPath).size <= 256 * 1024 * 1024 + 4096,
      'Deletion journal exceeds the bounded archive size.',
    );
    const current = openArchive(
      readFileSync(journalPath),
      journalKeys,
      'deletion_journal',
    );
    try {
      const records = DeletionJournalSchema.parse(
        JSON.parse(current.bytes.toString()),
      );
      const captured = Date.parse(records.capturedAt);
      assert(
        captured >= Date.parse(opened.header.createdAt) &&
          captured <= Date.now() + 5000 &&
          Date.now() - captured <= 300_000,
        'Deletion journal is not current.',
      );
      return records;
    } finally {
      current.bytes.fill(0);
    }
  }
  const retainedJournal = readFileSync(journalPath);
  unlinkSync(journalPath);
  try {
    assert.throws(() => readJournal());
    assert.equal(
      command('docker', [
        'inspect',
        '--format',
        '{{.State.Running}}',
        `supabase_kong_${targetId}`,
      ])
        .toString()
        .trim(),
      'false',
      'Missing journal exposed restore access.',
    );
  } finally {
    writeFileSync(journalPath, retainedJournal, { mode: 0o600, flag: 'wx' });
  }
  assert.throws(() => readJournal(new Map()));
  try {
    writeFileSync(
      journalPath,
      sealArchive(
        Buffer.from(
          JSON.stringify({
            ...journal,
            capturedAt: new Date(Date.now() - 600_000).toISOString(),
          }),
        ),
        journalKey,
        'synthetic-journal',
        'deletion_journal',
      ),
    );
    assert.throws(() => readJournal());
  } finally {
    writeFileSync(journalPath, retainedJournal, { mode: 0o600 });
  }
  const records = readJournal();
  phase = 'deletion replay before access';
  for (const receipt of records.rows) {
    const owner = receipt.user_id; // UUID schema validation precedes SQL construction.
    if (
      sql(
        targetContainer,
        `select count(*) from public.profiles where user_id='${owner}'`,
      ) === '0'
    ) {
      assert.equal(
        sql(
          targetContainer,
          `select count(*) from auth.users where id='${owner}'`,
        ),
        '0',
        'Journal identity without profile requires operator investigation.',
      );
      continue;
    }
    sql(
      targetContainer,
      `select public.begin_account_deletion_v1('${owner}',clock_timestamp());`,
    );
    for (let n = 0; n < 100; n++) {
      const state = JSON.parse(
        sql(
          targetContainer,
          `select public.continue_account_deletion_v1('${owner}',100);`,
        ),
      ) as { phase: string; outcome: string };
      assert.notEqual(
        state.outcome,
        'waiting_for_accounting',
        'Restoration remains closed until uncertain holds settle.',
      );
      if (state.phase === 'auth_removal_pending') {
        sql(
          targetContainer,
          `delete from auth.users where id='${owner}';select public.finish_account_deletion_v1('${owner}',true);`,
        );
        break;
      }
      assert(
        n < 99,
        'Deletion replay is unfinished; destination remains closed.',
      );
    }
  }
  const latest = await captureJournal();
  assert.deepEqual(
    latest.rows,
    journal.rows,
    'Deletion journal changed during restoration; repeat before permitting access.',
  );
  // Restored refresh/access sessions are deliberately invalidated before services restart.
  sql(
    targetContainer,
    'delete from auth.refresh_tokens;delete from auth.sessions;',
  );
  for (const table of [
    'profiles',
    'measurements',
    'private_payloads',
    'conversations',
    'messages',
    'goals',
    'goal_revisions',
    'usage_reservations',
  ])
    assert.equal(
      sql(
        targetContainer,
        `select count(*) from public.${table} where user_id='${deleted.id}'`,
      ),
      '0',
      'Deleted data was restored.',
    );
  assert.equal(
    sql(
      targetContainer,
      "select count(*) from public.ai_route_cost_blocks where model_id='synthetic-backup-bound'",
    ),
    '1',
    'Durable cost block was lost.',
  );
  for (const graph of graphs.slice(1)) {
    const envelope = JSON.parse(
      sql(
        targetContainer,
        `select to_jsonb(p) from public.private_payloads p where id='${graph.ids.private_payloads}'`,
      ),
    );
    assert.equal(
      decryptBytes(envelope, keys).toString(),
      'Synthetic encrypted restore trace 1',
    );
    assert.throws(() =>
      decryptBytes(envelope, { activeId: keys.activeId, keys: new Map() }),
    );
  }
  phase = 'restored Auth and two-owner isolation';
  command('docker', [
    'start',
    `supabase_auth_${targetId}`,
    `supabase_rest_${targetId}`,
    `supabase_kong_${targetId}`,
  ]);
  // GoTrue readiness is an actual bounded health check, not a success inferred from start.
  for (let n = 0; n < 60; n++) {
    try {
      const health = await fetch(targetStatus.API_URL + '/auth/v1/health', {
        headers: { apikey: targetStatus.ANON_KEY! },
        signal: AbortSignal.timeout(1000),
      });
      if (health.ok) break;
    } catch {
      /* Local startup only. */
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert(n < 59, 'Restored Auth did not become ready.');
  }
  assert(
    (
      await publicClient.auth.signInWithPassword({
        email: deleted.email,
        password: deleted.password,
      })
    ).error,
    'Deleted account regained access.',
  );
  const signed = await publicClient.auth.signInWithPassword({
    email: kept.email,
    password: kept.password,
  });
  assert(
    !signed.error && signed.data.session,
    'Retained password hash failed recovery.',
  );
  const oldToken = signed.data.session.access_token;
  const owned = await publicClient.from('measurements').select('id');
  assert(
    !owned.error && owned.data.length === 1,
    'Owned restored content is missing.',
  );
  const foreign = await publicClient
    .from('measurements')
    .select('id')
    .eq('user_id', deleted.id);
  assert(!foreign.error && foreign.data.length === 0);
  const third = await admin.auth.admin.createUser({
    email: `pr03-${randomUUID()}@example.test`,
    password: randomBytes(24).toString('base64url'),
    email_confirm: true,
  });
  assert(!third.error && third.data.user);
  const probe = createClient<Database>(
    targetStatus.API_URL!,
    targetStatus.ANON_KEY!,
    serverClientOptions,
  );
  // A second active account is verified through Auth, RLS, and a foreign payload denial.
  const thirdPassword = randomBytes(24).toString('base64url');
  await admin.auth.admin.updateUserById(third.data.user.id, {
    password: thirdPassword,
  });
  await admin.from('profiles').insert({
    user_id: third.data.user.id,
    display_name: 'Synthetic restored isolation',
  });
  assert(
    !(
      await probe.auth.signInWithPassword({
        email: third.data.user.email!,
        password: thirdPassword,
      })
    ).error,
  );
  assert.deepEqual((await probe.from('measurements').select('id')).data, []);
  assert((await probe.from('private_payloads').select('id')).error);
  phase = 'operator-assisted recovery';
  const newPassword = randomBytes(24).toString('base64url');
  assert.deepEqual(
    await recoverAccount(admin, {
      userId: kept.id,
      password: newPassword,
      identityVerified: true,
    }),
    { state: 'credentials_reset', sessionsRevoked: true },
  );
  assert(
    (
      await publicClient.auth.signInWithPassword({
        email: kept.email,
        password: kept.password,
      })
    ).error,
    'Old password remains usable.',
  );
  Object.assign(process.env, {
    VITE_SUPABASE_URL: targetStatus.API_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: targetStatus.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: targetStatus.SERVICE_ROLE_KEY,
  });
  await assert.rejects(() =>
    verifySession({ headers: { authorization: `Bearer ${oldToken}` } }),
  );
  const recovered = await publicClient.auth.signInWithPassword({
    email: kept.email,
    password: newPassword,
  });
  assert(!recovered.error && recovered.data.session);
  assert.equal(
    (
      await verifySession({
        headers: {
          authorization: `Bearer ${recovered.data.session.access_token}`,
        },
      })
    ).userId,
    kept.id,
  );
  report = {
    scope: 'local_synthetic_separate_restore',
    encryptedArchive: true,
    maximumBackupDays: 30,
    schemaFunctionsGrantsRlsOwners: true,
    rowAndStorageInventory: true,
    currentAndRetainedKeys: true,
    missingKeyAndTamperDenied: true,
    postBackupDeletionApplied: true,
    currentIndependentJournalRequired: true,
    restoredSessionsRevoked: true,
    authPasswordRecovery: true,
    twoOwnerIsolation: true,
    operatorAssistedRecovery: true,
    providerRequests: 0,
  };
} catch (error) {
  const reason =
    error instanceof Error ? error.message.split('\n')[0] : 'unavailable';
  console.error(
    `Backup verification failed at ${phase}: ${reason}. The disposable destination is stopped in finally.`,
  );
  process.exitCode = 1;
} finally {
  Object.assign(process.env, previousEnv);
  for (const name of Object.keys(process.env))
    if (!Object.hasOwn(previousEnv, name)) delete process.env[name];
  // Only the fixture owned by this command is cleaned. Retained verification allocations were refused.
  try {
    await fixture.cleanup();
    if (ownsRoute)
      sql(
        sourceContainer,
        "delete from public.ai_route_cost_blocks where provider='openrouter' and model_id='synthetic-backup-bound';",
      );
  } catch {
    process.exitCode = 1;
    console.error('Synthetic source cleanup needs inspection.');
  }
  if (started)
    try {
      cli(['stop']);
    } catch {
      process.exitCode = 1;
      console.error('Disposable restore stack stop needs inspection.');
    }
  for (const key of [backupKey, journalKey, currentKey, previousKey])
    key.fill(0);
  unlinkSync(keyPath);
  rmdirSync(keyRoot);
}
if (report && process.exitCode !== 1) console.info(JSON.stringify(report));

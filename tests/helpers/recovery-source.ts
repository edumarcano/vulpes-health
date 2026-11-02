import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { basename, dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import {
  assertLocalStack,
  localEnvironment,
  projectId,
  projectRoot,
} from '../../scripts/local-database.js';
import { encryptBytes } from '../../server/security/encryption.js';
import { localRecoverySource } from '../../scripts/recovery-postgres.js';

async function cleanupRoot(root: string) {
  if (
    dirname(resolve(root)) !== resolve(tmpdir()) ||
    !basename(root).startsWith('vulpes-database-interface-')
  )
    throw Error('Unexpected test cleanup path.');
  await rm(root, { recursive: true, force: true });
}

export async function withRecoverySource(
  run: (fixture: Awaited<ReturnType<typeof createFixture>>) => Promise<void>,
  owners = 2,
) {
  const fixture = await createFixture(owners);
  try {
    await run(fixture);
  } finally {
    fixture.adminSql('postgres', `drop database ${fixture.database};`);
    await cleanupRoot(fixture.root);
  }
}
async function createFixture(amount: number) {
  assertLocalStack();
  const container = 'supabase_db_' + projectId,
    database = 'vulpes_capture_' + randomUUID().replaceAll('-', '');
  function run(args: string[], input?: Buffer) {
    const r = spawnSync('docker', args, {
      cwd: projectRoot,
      env: localEnvironment(),
      input,
      encoding: undefined,
      timeout: 30000,
      maxBuffer: 64 * 1024 * 1024,
    });
    if (r.status !== 0) {
      mkdirSync(join(projectRoot, '.scratch/recovery-database-proof'), {
        recursive: true,
      });
      writeFileSync(
        join(
          projectRoot,
          '.scratch/recovery-database-proof',
          'fixture-' + randomUUID() + '.private.log',
        ),
        r.stderr ?? String(r.error),
      );
      throw Error(
        'Synthetic recovery fixture failed; raw diagnostics omitted.',
      );
    }
    return Buffer.from(r.stdout);
  }
  const adminSql = (db: string, statement: string) =>
    run(
      [
        'exec',
        '-i',
        container,
        'psql',
        '-X',
        '-qAt',
        '-U',
        'supabase_admin',
        '-d',
        db,
        '-v',
        'ON_ERROR_STOP=1',
      ],
      Buffer.from(statement),
    )
      .toString('utf8')
      .trim();
  const image = run(['inspect', '--format', '{{.Image}}', container])
      .toString()
      .trim(),
    root = await mkdtemp(join(tmpdir(), 'vulpes-database-interface-'));
  adminSql('postgres', `create database ${database};`);
  try {
    adminSql(
      database,
      'create schema extensions;create schema vault;create extension pgcrypto with schema extensions;create extension "uuid-ossp" with schema extensions;create extension pg_stat_statements with schema extensions;create extension supabase_vault with schema vault;',
    );
    const schema = run([
      'exec',
      container,
      'pg_dump',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '--format=custom',
      '--schema-only',
      '--schema=public',
      '--schema=auth',
      '--schema=supabase_migrations',
    ]);
    adminSql(database, 'drop schema public cascade;');
    run(
      [
        'exec',
        '-i',
        container,
        'pg_restore',
        '-U',
        'supabase_admin',
        '-d',
        database,
        '--exit-on-error',
        '--single-transaction',
      ],
      schema,
    );
    schema.fill(0);
    const versions = run([
      'exec',
      container,
      'pg_dump',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '--format=custom',
      '--data-only',
      '--table=auth.schema_migrations',
      '--table=supabase_migrations.schema_migrations',
    ]);
    run(
      [
        'exec',
        '-i',
        container,
        'pg_restore',
        '-U',
        'supabase_admin',
        '-d',
        database,
        '--exit-on-error',
        '--single-transaction',
      ],
      versions,
    );
    versions.fill(0);
    adminSql(
      database,
      'create schema storage;create table storage.objects(id uuid primary key);',
    );
    const traces = {
        activeId: 'synthetic-current',
        keys: new Map([
          ['synthetic-current', randomBytes(32)],
          ['synthetic-previous', randomBytes(32)],
        ]),
      },
      keys = { backup: randomBytes(32), keyId: 'synthetic-backup', traces },
      users: { id: string; session: string }[] = [];
    for (let n = 0; n < amount; n++) {
      const owner = randomUUID(),
        session = randomUUID(),
        keyId = n % 2 ? 'synthetic-previous' : 'synthetic-current',
        envelope = encryptBytes(
          {
            id: randomUUID(),
            user_id: owner,
            purpose: 'ai_request',
            expires_at: new Date(Date.now() + 3600000).toISOString(),
          },
          Buffer.from('Synthetic restored trace ' + keyId),
          { ...traces, activeId: keyId },
        );
      adminSql(
        database,
        `insert into auth.users(created_at,updated_at,instance_id,id,email,encrypted_password,email_confirmed_at,aud,role,raw_app_meta_data,raw_user_meta_data,confirmation_token,recovery_token,email_change_token_new,email_change) values(clock_timestamp(),clock_timestamp(),'00000000-0000-0000-0000-000000000000','${owner}','${owner}@example.invalid',extensions.crypt('synthetic-only-password',extensions.gen_salt('bf')),clock_timestamp(),'authenticated','authenticated','{"provider":"email","providers":["email"]}','{}','','','','');insert into auth.identities(created_at,updated_at,id,user_id,provider_id,provider,identity_data) values(clock_timestamp(),clock_timestamp(),extensions.uuid_generate_v4(),'${owner}','${owner}','email','{"sub":"${owner}","email":"${owner}@example.invalid"}');insert into public.profiles(user_id,display_name) values('${owner}','Synthetic capture');insert into public.conversations(user_id,title) values('${owner}','Synthetic recovery conversation');insert into public.private_payloads select * from jsonb_populate_record(null::public.private_payloads,'${JSON.stringify({ ...envelope, created_at: new Date().toISOString() })}'::jsonb);`,
      );
      users.push({ id: owner, session });
    }
    const target = {
      version: 1,
      purpose: 'synthetic-only',
      supabaseProjectRef: 'abcdefghijklmnopqrst',
      recoveryProjectRef: null,
      databaseRegion: 'us-east-1',
      vercelProjectId: 'prj_SyntheticRecovery',
      appOrigin: 'https://vulpes-synthetic.vercel.app',
    } as const;
    return {
      root,
      container,
      database,
      image,
      keys,
      target,
      users,
      run,
      adminSql,
      sql: (statement: string) => adminSql(database, statement),
      source: localRecoverySource(database),
    };
  } catch (error) {
    adminSql('postgres', `drop database ${database};`);
    await cleanupRoot(root);
    throw error;
  }
}

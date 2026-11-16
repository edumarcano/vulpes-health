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
      adminSql(
        database,
        `
        with source as (
          insert into public.data_sources(user_id,kind,label,source_namespace)
          values('${owner}','csv','Synthetic recovery scale','synthetic-recovery-scale') returning id
        ), batch as (
          insert into public.import_batches(user_id,source_id,file_hash,mapping_hash,payload_hash,contract_version,status,committed_at,result)
          select '${owner}',id,repeat('a',64),repeat('b',64),repeat('c',64),2,'committed',clock_timestamp(),'{}'::jsonb from source returning id,source_id
        ), event as (
          insert into public.weigh_in_events(user_id,source_id,import_batch_id,adapter_version,source_local_time,source_observed_at,source_timezone,source_offset_minutes,observed_at,timezone,offset_minutes,annotations,source_row)
          select '${owner}',source_id,id,'renpho-en-body-composition-v1','2026-09-01 08:00:00','2026-09-01 12:00:00Z','America/New_York',-240,'2026-09-01 12:00:00Z','America/New_York',-240,'{"remarks":"Synthetic restored event"}',2 from batch returning id,source_id,import_batch_id
        ) insert into public.measurements(user_id,source_id,import_batch_id,event_id,metric_key,canonical_value,canonical_unit,original_value,original_unit,observed_at,original_offset_minutes,timezone,granularity,measurement_method,fingerprint)
          select '${owner}',source_id,import_batch_id,id,'weight',68.0388555,'kg','150.0','lb','2026-09-01 12:00:00Z',-240,'America/New_York','instant','device_reported',repeat('d',64) from event;
      `,
      );
      adminSql(
        database,
        `
        do $fixture$
        declare source uuid; reading public.measurements; goal uuid:=gen_random_uuid(); revision uuid:=gen_random_uuid(); proposal uuid:=gen_random_uuid(); grp uuid:=gen_random_uuid(); d jsonb; p jsonb;
        begin
          select * into reading from public.measurements where user_id='${owner}' order by id limit 1;
          source:=reading.source_id;
          d:=jsonb_build_object('schemaVersion',1,'title','Synthetic recovery target','metric','weight','unit','kg','sourceId',source,
            'target',jsonb_build_object('direction','decrease_to','value',67),'baselineMethod','latest_value','baselineFrom','2026-09-01T00:00:00Z','baselineTo','2026-09-08T00:00:00Z',
            'reportedBaseline',null,'timezone','UTC','targetDate',null,'constraints','[]'::jsonb,'proposedStrategy',null,'method','device_reported','granularity','instant','currentMethod','latest_value');
          p:=jsonb_build_object('schemaVersion',2,'definition',d,'state','active','baselineResolution','replace','reviewedDataRevision',0,
            'baseline',jsonb_build_object('schemaVersion',2,'selection',jsonb_build_object('metric','weight','source_id',source,'method','device_reported','granularity','instant','timezone','UTC','from','2026-09-01T00:00:00Z','to','2026-09-08T00:00:00Z'),
              'value',reading.canonical_value::text,'dataRevision',0,'algorithmVersion','latest_value_v1','provenance','calculated','references',jsonb_build_array(jsonb_build_object('id',reading.id,'version',reading.version,'observedAt',reading.observed_at))));
          insert into public.goals(id,user_id,title,metric_key,canonical_unit,direction,target_value,source_id) values(goal,'${owner}','Synthetic recovery target','weight','kg','decrease_to',67,source);
          insert into public.action_proposals(id,user_id,kind,payload_version,canonical_payload,payload_hash,summary,state,expires_at,result)
            values(proposal,'${owner}','goal.create',2,p,encode(sha256(convert_to(p::text,'UTF8')),'hex'),'Synthetic recovery target','approved',clock_timestamp()+interval'1 day',jsonb_build_object('goalId',goal,'revisionId',revision,'version',1));
          insert into public.goal_revisions(id,user_id,goal_id,revision_number,approved_proposal_id,payload_version,payload) values(revision,'${owner}',goal,1,proposal,2,p);
          update public.goals set state='active',current_revision_id=revision,baseline_snapshot=p->'baseline' where id=goal;
          insert into public.goal_groups(id,user_id,name,state) values(grp,'${owner}','Synthetic restored group','archived');
          insert into public.goal_group_members(user_id,group_id,goal_id,position,reviewed_goal_version,reviewed_revision_id) values('${owner}',grp,goal,1,1,revision);
        end;
        $fixture$;
      `,
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

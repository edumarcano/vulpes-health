import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { assertImportUpgradePreserved } from '../tests/helpers/import-upgrade.js';
import {
  databaseGraph,
  databaseTables,
} from '../tests/fixtures/database-graph.js';
import {
  assertLocalStack,
  localEnvironment,
  projectId,
  projectRoot,
} from './local-database.js';

assert.deepEqual(
  process.argv.slice(2),
  ['--allow-disposable-reset'],
  'Explicit disposable rehearsal opt-in required. Only isolated databases are created and dropped.',
);
assertLocalStack();
const container = 'supabase_db_' + projectId;
const database = 'vulpes_m1_replay_' + randomUUID().replaceAll('-', '');
assert.match(database, /^vulpes_m1_replay_[a-f0-9]{32}$/);
function run(args: string[], input?: string): string {
  const result = spawnSync('docker', args, {
    input,
    encoding: 'utf8',
    env: localEnvironment(),
    cwd: projectRoot,
    timeout: 60000,
    maxBuffer: 32 * 1024 * 1024,
  });
  assert.equal(
    result.status,
    0,
    'Isolated migration rehearsal failed: ' + result.stderr.slice(-1500),
  );
  return result.stdout.trim();
}
function sql(statement: string, db = database) {
  return run(
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
    statement,
  );
}
const literal = (text: string) => "'" + text.replaceAll("'", "''") + "'";
function insert(table: string, row: Record<string, unknown>) {
  const columns = Object.keys(row)
    .map((key) => '"' + key + '"')
    .join(',');
  sql(
    'insert into public.' +
      table +
      '(' +
      columns +
      ') select ' +
      columns +
      ' from jsonb_populate_record(null::public.' +
      table +
      ',' +
      literal(JSON.stringify(row)) +
      '::jsonb);',
  );
}
const names = readdirSync(join(projectRoot, 'supabase/migrations'))
  .filter((name) => name.endsWith('.sql'))
  .sort();
const m1 = names.filter((name) => name >= '20261113000100_');
assert(m1.length >= 4);
const auth = run([
  'exec',
  container,
  'pg_dump',
  '-U',
  'postgres',
  '-d',
  'postgres',
  '--schema-only',
  '--schema=auth',
]);
sql('create database ' + database + ' owner postgres;', 'postgres');
try {
  sql(
    'create schema extensions;create extension pgcrypto with schema extensions;create schema supabase_migrations;create table supabase_migrations.schema_migrations(version text primary key,statements text[],name text);',
  );
  sql(auth);
  function apply(files: string[]) {
    for (const file of files) {
      sql(
        'set role postgres;' +
          readFileSync(join(projectRoot, 'supabase/migrations', file), 'utf8'),
      );
      sql(
        'insert into supabase_migrations.schema_migrations(version) values(' +
          literal(file.split('_')[0]!) +
          ');',
      );
    }
  }
  apply(names.filter((name) => !m1.includes(name)));
  const owner = randomUUID(),
    app = randomUUID(),
    graph = databaseGraph(owner, app);
  sql(
    'insert into auth.users(id,email) values(' +
      literal(owner) +
      ",'synthetic-m1-upgrade@example.test');",
  );
  insert('usage_buckets', {
    id: app,
    scope: 'app',
    period_start: '2026-10-01',
    allocated_ceiling_usd: '20',
    reserved_usd: '0.1',
  });
  for (const table of databaseTables) insert(table, graph.rows[table]);
  const staging = randomUUID();
  insert('private_payloads', {
    ...graph.rows.private_payloads,
    id: staging,
    purpose: 'import_staging',
  });
  insert('import_batches', {
    ...graph.rows.import_batches,
    id: randomUUID(),
    staging_payload_id: staging,
  });
  insert('action_proposals', {
    ...graph.rows.action_proposals,
    id: randomUUID(),
    state: 'pending',
  });
  const snapshot = () =>
    Object.fromEntries(
      databaseTables.map((table) => [
        table,
        JSON.parse(
          sql(
            'select coalesce(jsonb_agg(to_jsonb(t) order by ' +
              (table === 'profiles' ? 'user_id' : 'id') +
              "),'[]'::jsonb)::text from public." +
              table +
              ' t;',
          ),
        ) as Array<Record<string, unknown>>,
      ]),
    );
  const productBefore = snapshot();
  const control = () =>
    sql(
      "select jsonb_build_object('auth',(select jsonb_agg(to_jsonb(u)) from auth.users u),'profile',(select jsonb_agg(to_jsonb(p)) from public.profiles p),'buckets',(select jsonb_agg(to_jsonb(b) order by id) from public.usage_buckets b),'reservations',(select jsonb_agg(to_jsonb(r)) from public.usage_reservations r))::text;",
    );
  const before = control();
  apply(m1);
  assertImportUpgradePreserved(productBefore, snapshot());
  assert.equal(
    control(),
    before,
    'Auth, consent, limits, charges and holds must remain unchanged.',
  );
  assert.equal(
    sql(
      "select status||','||(staging_payload_id is null)::text from public.import_batches where id=" +
        literal(graph.ids.import_batches) +
        ';',
    ),
    'failed,true',
  );
  assert.equal(sql('select count(*) from public.weigh_in_events;'), '0');
  assert.equal(sql('select count(*) from public.measurements;'), '1');
  sql(
    'drop schema public cascade;create schema public authorization postgres;truncate supabase_migrations.schema_migrations;',
  );
  apply(names);
  assert.equal(sql('select count(*) from public.weigh_in_events;'), '0');
  assert.equal(
    sql('select count(*) from supabase_migrations.schema_migrations;'),
    String(names.length),
  );
  console.info(
    JSON.stringify({
      artifact: 'm1_forward_and_fresh_replay',
      synthetic: true,
      migrations: m1.length,
      authAndControlsPreserved: true,
      incompatibleStagingInvalidated: true,
      freshReplay: true,
      providerRequests: 0,
    }),
  );
} finally {
  sql('drop database ' + database + ';', 'postgres');
}

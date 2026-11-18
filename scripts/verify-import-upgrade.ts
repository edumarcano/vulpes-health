import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { assertImportUpgradePreserved } from '../tests/helpers/import-upgrade.js';
import {
  databaseGraph,
  databaseTables,
  preGroupDatabaseTables,
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
const checkpointMigration = '20261115000500_group_tool_checkpoint.sql';
assert(names.includes(checkpointMigration));
const checkpointMigrations = names.filter(
  (name) => name >= checkpointMigration,
);
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
  for (const table of preGroupDatabaseTables)
    insert(table, {
      ...graph.rows[table],
      ...(table === 'profiles'
        ? {
            consent_versions: { synthetic_provider: 'retained-consent-v1' },
            monthly_preference_usd: '4.25',
          }
        : {}),
      ...(table === 'usage_reservations'
        ? { status: 'pending', uncertain_since: new Date().toISOString() }
        : {}),
    });
  sql(
    "update public.ai_steps set provider='synthetic-upgrade',model_id='blocked-route',cost_bound_state='exceeded' where id=" +
      literal(graph.ids.ai_steps) +
      ';',
  );
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
        sql(
          'select to_regclass(' + literal('public.' + table) + ') is not null;',
        ) === 'f'
          ? []
          : (JSON.parse(
              sql(
                'select coalesce(jsonb_agg(to_jsonb(t) order by ' +
                  (table === 'profiles' ? 'user_id' : 'id') +
                  "),'[]'::jsonb)::text from public." +
                  table +
                  ' t;',
              ),
            ) as Array<Record<string, unknown>>),
      ]),
    );
  const productBefore = snapshot();
  const control = () =>
    sql(
      "select jsonb_build_object('auth',(select jsonb_agg(to_jsonb(u) order by id) from auth.users u),'profile',(select jsonb_agg(to_jsonb(p) order by user_id) from public.profiles p),'buckets',(select jsonb_agg(to_jsonb(b) order by id) from public.usage_buckets b),'reservations',(select jsonb_agg(to_jsonb(r) order by id) from public.usage_reservations r),'costBlocks',(select jsonb_agg(to_jsonb(c) order by provider,model_id) from public.ai_route_cost_blocks c))::text;",
    );
  const before = control();
  apply(m1.filter((name) => !checkpointMigrations.includes(name)));
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

  // Populate the group-capable schema before the new tool checkpoint exists.
  // Real proposal/approval RPCs produce the retained nested baseline and receipts.
  const foreign = databaseGraph(randomUUID(), app);
  sql(
    'insert into auth.users(id,email) values(' +
      literal(foreign.userId) +
      ",'synthetic-foreign-upgrade@example.test');",
  );
  for (const table of preGroupDatabaseTables)
    insert(table, foreign.rows[table]);
  sql(
    'update public.usage_buckets set reserved_usd=reserved_usd+0.1 where id=' +
      literal(app) +
      ';',
  );
  const json = (value: unknown) => literal(JSON.stringify(value)) + '::jsonb';
  function propose(
    userId: string,
    grouped: boolean,
    payload: Record<string, unknown>,
  ) {
    return sql(
      'select public.register_goal' +
        (grouped ? '_group' : '') +
        '_proposal_v1(' +
        literal(userId) +
        ',' +
        json({
          action: grouped ? 'propose_group_create' : 'propose_create',
          client_request_id: randomUUID(),
        }) +
        ',' +
        json(payload) +
        ');',
    );
  }
  function decide(userId: string, proposalId: string, grouped: boolean) {
    return (
      'public.decide_goal' +
      (grouped ? '_group' : '') +
      '_proposal_v1(' +
      literal(userId) +
      ",jsonb_build_object('action','approve','client_request_id'," +
      literal(randomUUID()) +
      ", 'proposal_id'," +
      literal(proposalId) +
      ",'payload_hash',(select payload_hash from public.action_proposals where id=" +
      literal(proposalId) +
      "),'expected_version',null))"
    );
  }
  const pending: string[] = [];
  let reviewedGoal = '';
  for (const retained of [graph, foreign]) {
    const definition = {
      ...(retained.rows.action_proposals.canonical_payload as Record<
        string,
        unknown
      >),
      baselineMethod: 'user_reported',
      reportedBaseline: 70,
      currentMethod: 'latest_value',
      method: 'unknown',
      granularity: 'instant',
    };
    const payload = {
      schemaVersion: 2,
      definition,
      baseline: {
        schemaVersion: 2,
        selection: {
          metric: 'weight',
          source_id: retained.ids.data_sources,
          method: 'unknown',
          granularity: 'instant',
          timezone: 'UTC',
        },
        value: '70',
        dataRevision: 0,
        algorithmVersion: 'synthetic-upgrade-v1',
        provenance: 'user_reported',
        references: [],
      },
      state: 'active',
      baselineResolution: 'replace',
      reviewedDataRevision: 0,
    };
    const single = propose(retained.userId, false, payload);
    const approved = JSON.parse(
      sql('select ' + decide(retained.userId, single, false) + ';'),
    ) as { goalId: string; revisionId: string; version: number };
    const groupPayload = {
      schemaVersion: 3,
      name: 'Synthetic approved group with retained baseline',
      state: 'active',
      reviewedDataRevision: 0,
      members: [
        {
          kind: 'existing',
          goalId: approved.goalId,
          revisionId: approved.revisionId,
          expectedVersion: approved.version,
          payload,
        },
      ],
    };
    const group = propose(retained.userId, true, groupPayload);
    sql('select ' + decide(retained.userId, group, true) + ';');
    const pendingSingle = propose(retained.userId, false, payload);
    const pendingGroup = propose(retained.userId, true, groupPayload);
    if (retained === graph) {
      pending.push(
        pendingSingle,
        pendingGroup,
        propose(retained.userId, true, {
          ...groupPayload,
          members: [{ kind: 'create', payload }],
        }),
      );
      reviewedGoal = approved.goalId;
    }
    insert('private_payloads', {
      ...retained.rows.private_payloads,
      id: randomUUID(),
      purpose: 'tool_output',
    });
  }
  const interruptedStaging = randomUUID();
  insert('private_payloads', {
    ...graph.rows.private_payloads,
    id: interruptedStaging,
    purpose: 'import_staging',
  });
  insert('import_batches', {
    ...graph.rows.import_batches,
    id: randomUUID(),
    contract_version: 2,
    staging_payload_id: interruptedStaging,
  });
  const populatedBefore = snapshot();
  const populatedControls = control();
  apply(checkpointMigrations);
  assert.deepEqual(
    snapshot(),
    populatedBefore,
    'Group checkpoint upgrade must preserve every retained product row and private copy for both owners.',
  );
  assert.equal(control(), populatedControls);

  function rejects(expression: string, message: string) {
    sql(
      'do $$ begin perform ' +
        expression +
        "; raise exception 'upgrade_rehearsal_expected_rejection'; exception when others then if sqlerrm<>" +
        literal(message) +
        ' then raise; end if; end $$;',
    );
  }
  // Old import writers remain unavailable even while an interrupted preview exists.
  for (const role of ['authenticated', 'service_role'])
    assert.equal(
      sql(
        'select has_function_privilege(' +
          literal(role) +
          ",'public.commit_import_v1(jsonb,text)','execute');",
      ),
      'f',
    );
  const executor = randomUUID();
  sql(
    "update public.ai_runs set fence=2,lease_expires_at=clock_timestamp()+interval '30 seconds',deadline_at=clock_timestamp()+interval '210 seconds',executor_hash=encode(sha256(convert_to(" +
      literal(executor) +
      ",'UTF8')),'hex') where id=" +
      literal(graph.ids.ai_runs) +
      ';',
  );
  rejects(
    'public.checkpoint_goal_proposal_v1(' +
      [owner, graph.ids.ai_runs, executor].map(literal).join(',') +
      ',1,' +
      literal(randomUUID()) +
      ",'{}'::jsonb,'{}'::jsonb,'{}'::jsonb)",
    'run_not_writable',
  );
  rejects(decide(foreign.userId, pending[1]!, true), 'goal_not_found');
  sql(
    "do $$ begin update public.ai_steps set dispatch_state='send_authorized' where id=" +
      literal(graph.ids.ai_steps) +
      "; raise exception 'upgrade_rehearsal_expected_rejection'; exception when others then if sqlerrm<>'cost_bound_exceeded' then raise; end if; end $$;",
  );
  // A changed reviewed data revision invalidates pending single and group bodies,
  // while foreign pending and approved copies remain byte-for-byte unchanged.
  const foreignBefore = snapshot();
  sql(
    'update public.goals set version=version+1 where id=' +
      literal(reviewedGoal) +
      ';',
  );
  rejects(decide(owner, pending[1]!, true), 'goal_conflict');
  sql('select public.expire_goal_proposals_v1(' + literal(owner) + ');');
  assert.equal(
    sql(
      "select state||','||(canonical_payload is null)::text from public.action_proposals where id=" +
        literal(pending[1]!) +
        ';',
    ),
    'conflicted,true',
    'Changed member versions must invalidate pending group review.',
  );
  // The other pending group is a new-child proposal, so only the data revision
  // below invalidates it rather than the changed existing member version.
  sql(
    'update public.profiles set data_revision=data_revision+1 where user_id=' +
      literal(owner) +
      ';',
  );
  for (const [index, proposalId] of pending.entries()) {
    assert.equal(
      sql(
        "select state||','||(canonical_payload is null)::text from public.action_proposals where id=" +
          literal(proposalId) +
          ';',
      ),
      'conflicted,true',
    );
    rejects(decide(owner, proposalId, index !== 0), 'goal_conflict');
  }
  const probedSnapshot = snapshot();
  for (const table of databaseTables)
    assert.deepEqual(
      probedSnapshot[table]!.filter((row) => row.user_id === foreign.userId),
      foreignBefore[table]!.filter((row) => row.user_id === foreign.userId),
      'Stale-owner probes changed foreign ' + table,
    );
  assert.equal(
    sql(
      "select status||','||unknown_cost::text||','||(amount_usd=0.10)::text from public.usage_reservations where id=" +
        literal(graph.ids.usage_reservations) +
        ';',
    ),
    'pending,true,true',
  );
  const expectedControls = JSON.parse(populatedControls) as {
    profile: Array<{ user_id: string; data_revision: number }>;
  };
  expectedControls.profile.find((profile) => profile.user_id === owner)!
    .data_revision++;
  assert.deepEqual(
    JSON.parse(control()),
    expectedControls,
    'Writer/proposal probes must preserve controls except the deliberately advanced data revision.',
  );
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
      groupCheckpointMigrations: checkpointMigrations.length,
      populatedGroupsAndPrivateCopiesPreserved: true,
      foreignOwnersPreserved: true,
      staleWritersAndProposalsRejected: true,
      unsettledChargesAndDurableCostBlocksPreserved: true,
      freshReplay: true,
      providerRequests: 0,
    }),
  );
} finally {
  sql('drop database ' + database + ';', 'postgres');
}

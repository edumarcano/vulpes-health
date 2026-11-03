import assert from 'node:assert/strict';
import { readFileSync, renameSync, mkdtempSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { GoalDefinitionSchema } from '../shared/goals.js';
import { goalDraft } from '../tests/fixtures/contracts.js';
import { LocalSupabase } from '../tests/helpers/local-supabase.js';
import { databaseTables } from '../tests/fixtures/database-graph.js';
import {
  localStatus,
  projectId,
  projectRoot,
  runSupabase,
  localEnvironment,
} from './local-database.js';
const args = process.argv.slice(2);
const fromPR11 = args.includes('--from-pr11');
assert.deepEqual(
  args,
  fromPR11
    ? ['--allow-disposable-reset', '--from-pr11']
    : ['--allow-disposable-reset'],
  'Explicit disposable-reset opt-in required; only --from-pr11 is optional.',
);
localStatus();
const db = new LocalSupabase();
const users = (await (
  await db.admin('/auth/v1/admin/users?page=1&per_page=1', 'GET')
).json()) as { users: unknown[] };
assert.equal(
  users.users.length,
  0,
  'Refusing a populated database, including retained verification accounts.',
);
const names = [
  ...(fromPR11
    ? []
    : [
        '20261028000100_goal_approvals.sql',
        '20261028000200_goal_draft_invalidation.sql',
      ]),
  '20261028000300_chat_goal_proposals.sql',
];
mkdirSync(join(projectRoot, 'test-results'), { recursive: true });
const parked = mkdtempSync(join(projectRoot, 'test-results/goal-upgrade-'));
const moved: string[] = [];
try {
  for (const name of names) {
    renameSync(
      join(projectRoot, 'supabase/migrations', name),
      join(parked, name),
    );
    moved.push(name);
  }
  runSupabase(['db', 'reset', '--local', '--no-seed', '--yes'], true);
  const user = await db.createUser();
  const graph = await db.seed(user.id);
  if (fromPR11) {
    const definition = GoalDefinitionSchema.parse({
      ...goalDraft,
      sourceId: graph.ids.data_sources,
      method: 'device_reported',
      granularity: 'instant',
      currentMethod: 'daily_median_mean_7d',
    });
    const profile = (await (
      await db.admin(`/rest/v1/profiles?user_id=eq.${user.id}`, 'GET')
    ).json()) as { data_revision: number }[];
    const revision = profile[0]!.data_revision;
    await db.admin('/rest/v1/rpc/register_goal_proposal_v1', 'POST', {
      p_owner: user.id,
      p_request: {
        action: 'propose_create',
        client_request_id: randomUUID(),
        definition,
      },
      p_payload: {
        schemaVersion: 2,
        definition,
        baseline: {
          schemaVersion: 2,
          selection: {
            metric: definition.metric,
            source_id: definition.sourceId,
            from: definition.baselineFrom,
            to: definition.baselineTo,
            timezone: definition.timezone,
            method: definition.method,
            granularity: definition.granularity,
          },
          value: null,
          dataRevision: revision,
          algorithmVersion: 'daily_median_mean_7d_v1',
          provenance: 'calculated',
          references: [],
        },
        state: 'needs_data',
        baselineResolution: 'replace',
        reviewedDataRevision: revision,
      },
    });
  }
  const snapshot = async () =>
    Object.fromEntries(
      await Promise.all(
        databaseTables.map(async (table) => [
          table,
          await (
            await db.admin(
              `/rest/v1/${table}?user_id=eq.${user.id}&order=${table === 'profiles' ? 'user_id' : 'id'}`,
              'GET',
            )
          ).json(),
        ]),
      ),
    );
  const before = await snapshot();
  for (const name of names) {
    const result = spawnSync(
      'docker',
      [
        'exec',
        '-i',
        `supabase_db_${projectId}`,
        'psql',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-v',
        'ON_ERROR_STOP=1',
      ],
      {
        env: localEnvironment(),
        input: readFileSync(join(parked, name)),
        encoding: 'utf8',
        timeout: 30000,
      },
    );
    assert.equal(result.status, 0, 'Forward migration failed.');
  }
  const refreshed = spawnSync(
    'docker',
    [
      'exec',
      `supabase_db_${projectId}`,
      'psql',
      '-U',
      'postgres',
      '-d',
      'postgres',
      '-c',
      "notify pgrst, 'reload schema'",
    ],
    { env: localEnvironment(), encoding: 'utf8' },
  );
  assert.equal(refreshed.status, 0, 'Schema refresh failed.');
  const after = await snapshot();
  for (const row of after.action_proposals as Record<string, unknown>[]) {
    if (!fromPR11) delete row.result;
    delete row.source_step_id;
    delete row.source_message_id;
  }
  assert.deepEqual(
    after,
    before,
    'Forward migration changed pre-existing owned rows.',
  );
  console.info(
    `PASS: populated ${fromPR11 ? 'PR 11' : 'pre-M4'} forward upgrade preserved all owned table snapshots.`,
  );
} finally {
  for (const name of moved)
    renameSync(
      join(parked, name),
      join(projectRoot, 'supabase/migrations', name),
    );
  await db.cleanup();
}

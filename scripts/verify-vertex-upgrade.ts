import assert from 'node:assert/strict';
import {
  readFileSync,
  renameSync,
  mkdtempSync,
  mkdirSync,
  readdirSync,
} from 'node:fs';
import { join } from 'node:path';
import { LocalSupabase } from '../tests/helpers/local-supabase.js';
import { localStatus, projectRoot, runSupabase } from './local-database.js';

assert.deepEqual(
  process.argv.slice(2),
  ['--allow-disposable-reset'],
  'Explicit disposable-reset opt-in required.',
);
localStatus();
const original = new LocalSupabase();
const users = (await (
  await original.admin('/auth/v1/admin/users?page=1&per_page=1', 'GET')
).json()) as { users: unknown[] };
assert.equal(
  users.users.length,
  0,
  'Refusing a populated database, including retained verification accounts.',
);
const names = readdirSync(join(projectRoot, 'supabase/migrations'))
  .filter(
    (name) =>
      name.endsWith('.sql') && name >= '20261029000100_vertex_routing.sql',
  )
  .sort();
mkdirSync(join(projectRoot, 'test-results'), { recursive: true });
const parked = mkdtempSync(join(projectRoot, 'test-results/vertex-upgrade-'));
const moved: string[] = [];
const hashes = new Map(
  names.map((name) => [
    name,
    readFileSync(join(projectRoot, 'supabase/migrations', name)),
  ]),
);
let db: LocalSupabase | undefined;
try {
  for (const name of names) {
    renameSync(
      join(projectRoot, 'supabase/migrations', name),
      join(parked, name),
    );
    moved.push(name);
  }
  runSupabase(['db', 'reset', '--local', '--no-seed', '--yes'], true);
  db = new LocalSupabase();
  const a = await db.createUser();
  const b = await db.createUser();
  await db.seed(a.id);
  await db.seed(b.id);
  const tables = [
    'ai_runs',
    'ai_steps',
    'usage_buckets',
    'usage_reservations',
    'private_payloads',
    'goal_revisions',
  ];
  const snapshot = async () => {
    const rows: Record<string, unknown> = {};
    for (const table of tables) {
      const data = (await (
        await db!.admin(`/rest/v1/${table}?order=id`, 'GET')
      ).json()) as Record<string, unknown>[];
      rows[table] = data.map((row) => {
        const { route_history: _history, ...original } = row;
        void _history;
        return original;
      });
    }
    return rows;
  };
  const before = await snapshot();
  for (const name of moved)
    renameSync(
      join(parked, name),
      join(projectRoot, 'supabase/migrations', name),
    );
  moved.length = 0;
  runSupabase(['migration', 'up', '--local'], true);
  assert.deepEqual(
    await snapshot(),
    before,
    'Forward upgrade changed retained rows or accounting.',
  );
  const approval = await (
    await db.admin('/rest/v1/vertex_policy_approval', 'GET')
  ).json();
  assert.deepEqual(approval, []);
  console.info(
    'PASS: populated two-owner M4 upgrade preserved runs, steps, private payloads, goal revisions and paired accounting; no Google approval installed.',
  );
} finally {
  for (const name of moved)
    renameSync(
      join(parked, name),
      join(projectRoot, 'supabase/migrations', name),
    );
  for (const name of names)
    assert(
      readFileSync(join(projectRoot, 'supabase/migrations', name)).equals(
        hashes.get(name)!,
      ),
      'Migration restoration differs.',
    );
  if (db) await db.cleanup();
}

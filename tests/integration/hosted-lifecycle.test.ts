import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { randomBytes, randomUUID } from 'node:crypto';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { localStatus } from '../../scripts/local-database.js';
import {
  hostedLifecycle,
  LifecyclePlanSchema,
  type LifecyclePhase,
} from '../../scripts/hosted-lifecycle.js';
import { localRouter } from '../../server/http/router.js';
import { LocalSupabase } from '../helpers/local-supabase.js';
import { cleanupTables } from '../fixtures/database-graph.js';

const plan = LifecyclePlanSchema.parse({
  purpose: 'owner-pilot-3d2',
  runId: randomUUID(),
  createdAt: new Date().toISOString(),
  projectRef: 'abcdefghijklmnopqrst',
  users: ['vulpes-3d-a@example.invalid', 'vulpes-3d-b@example.invalid'].map(
    (email) => ({
      id: randomUUID(),
      email,
      password: randomBytes(24).toString('base64url'),
      nextPassword: randomBytes(24).toString('base64url'),
    }),
  ),
});
const target = {
  version: 1,
  purpose: 'synthetic-only',
  supabaseProjectRef: plan.projectRef,
  recoveryProjectRef: null,
  databaseRegion: 'us-east-1',
  vercelProjectId: 'prj_SyntheticOnly',
  appOrigin: 'https://vulpes-synthetic.vercel.app',
} as const;
let config: ReturnType<typeof localStatus>, origin: string, db: LocalSupabase;
const server = createServer(localRouter),
  saved = new Map<string, unknown>();
const artifacts = {
  read: async (name: string) => {
    if (!saved.has(name)) throw new Error('Missing artifact');
    return saved.get(name);
  },
  write: async (name: string, value: unknown) => {
    if (saved.has(name)) throw new Error('Refusing overwrite');
    saved.set(name, structuredClone(value));
  },
};
beforeAll(async () => {
  config = localStatus();
  db = new LocalSupabase();
  vi.stubEnv('VITE_SUPABASE_URL', config.apiUrl);
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', config.anonKey);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', config.adminKey);
  vi.stubEnv('VULPES_TRACE_ENCRYPTION_KEY_ID', 'synthetic-hosted-lifecycle');
  vi.stubEnv(
    'VULPES_TRACE_ENCRYPTION_KEY_B64',
    randomBytes(32).toString('base64'),
  );
  vi.stubEnv('VULPES_LIVE_AI_ENABLED', 'false');
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error();
  origin = 'http://127.0.0.1:' + address.port;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    if (db)
      for (const u of plan.users) {
        // Cleanup is restricted to this invocation's preallocated disposable UUIDs.
        await db.admin('/rest/v1/goals?user_id=eq.' + u.id, 'PATCH', {
          state: 'draft',
          current_revision_id: null,
        });
        for (const table of cleanupTables)
          await db.admin('/rest/v1/' + table + '?user_id=eq.' + u.id, 'DELETE');
        const auth = await db.request('/auth/v1/admin/users/' + u.id, 'admin', {
          method: 'DELETE',
        });
        expect([200, 404]).toContain(auth.status);
      }
  } finally {
    vi.unstubAllEnvs();
  }
});
it('rehearses every hosted lifecycle phase against actual local production handlers, transactions and Auth without resetting any stack', async () => {
  const network: typeof fetch = (url, init) => {
    const parsed = new URL(String(url));
    const app = parsed.origin === target.appOrigin;
    return fetch(
      (app ? origin : config.apiUrl) + parsed.pathname + parsed.search,
      init,
    );
  };
  for (const phase of [
    'provision',
    'journey',
    'reset',
    'delete-start',
    'delete-resume',
    'delete-resume',
  ] as const satisfies readonly LifecyclePhase[]) {
    const result = await hostedLifecycle(
      {
        target,
        plan,
        publishableKey: config.anonKey,
        adminKey: config.adminKey,
        phase,
        approved: true,
        csv: readFileSync(
          'docs/spec/v0.1.0/fixtures/measurements-synthetic.csv',
          'utf8',
        ),
        artifacts,
      },
      network,
    );
    expect(result.status, JSON.stringify(result)).toBe('passed');
    expect(result).toMatchObject({
      providerRequests: 0,
      realDataAuthorized: false,
    });
  }
  expect(
    saved.has('export-0') &&
      saved.has('export-1') &&
      saved.has('deletion-start'),
  ).toBe(true);
}, 180_000);

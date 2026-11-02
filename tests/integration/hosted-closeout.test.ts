import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { expect, it, vi } from 'vitest';
import { LocalSupabase } from '../helpers/local-supabase.js';
import { localStatus } from '../../scripts/local-database.js';
import { localRouter } from '../../server/http/router.js';
import {
  closeoutFixture,
  type CloseoutFixture,
} from '../../scripts/closeout-fixture.js';
import { verifyHostedCloseout } from '../../scripts/verify-hosted-closeout.js';
import { administrativeClient } from '../../server/db/administrative.js';
import { continueDeletion } from '../../server/services/account.js';

it('verifies populated inspector/trace/allocation isolation, malformed writes, disabled chat and complete exports through real HTTP', async () => {
  const status = localStatus(),
    db = new LocalSupabase(),
    key = randomBytes(32),
    users: string[] = [],
    actors: { token: string; fixture: CloseoutFixture }[] = [];
  vi.stubEnv('VITE_SUPABASE_URL', status.apiUrl);
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', status.anonKey);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', status.adminKey);
  vi.stubEnv('VULPES_LIVE_AI_ENABLED', 'false');
  vi.stubEnv('VULPES_TRACE_ENCRYPTION_KEY_ID', 'synthetic-closeout');
  vi.stubEnv('VULPES_TRACE_ENCRYPTION_KEY_B64', key.toString('base64'));
  const server = createServer(localRouter);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error('Loopback required');
  const app = 'http://127.0.0.1:' + address.port;
  vi.stubEnv('VULPES_APP_ORIGIN', app);
  const target = {
    version: 1,
    purpose: 'synthetic-only',
    supabaseProjectRef: 'abcdefghijklmnopqrst',
    recoveryProjectRef: null,
    databaseRegion: 'us-east-1',
    vercelProjectId: 'prj_SyntheticCloseout',
    appOrigin: 'https://vulpes-synthetic.vercel.app',
  } as const;
  try {
    for (let i = 0; i < 2; i++) {
      const user = await db.createUser();
      users.push(user.id);
      const fixture = closeoutFixture(user.id, i, {
        activeId: 'synthetic-closeout',
        keys: new Map([['synthetic-closeout', key]]),
      });
      for (const entry of fixture.rows)
        await db.admin('/rest/v1/' + entry.table, 'POST', entry.row);
      actors.push({ token: user.token, fixture });
    }
    let forwarded = 0;
    const network: typeof fetch = async (url, init) => {
      const u = new URL(String(url));
      expect([
        target.appOrigin,
        'https://abcdefghijklmnopqrst.supabase.co',
      ]).toContain(u.origin);
      forwarded++;
      const headers = new Headers(init?.headers);
      headers.set('Origin', app);
      return fetch(
        (u.origin === target.appOrigin ? app : status.apiUrl) +
          u.pathname +
          u.search,
        { ...init, headers },
      );
    };
    const result = await verifyHostedCloseout(
      {
        target,
        publishableKey: status.anonKey,
        actors: actors as [(typeof actors)[number], (typeof actors)[number]],
        approved: true,
      },
      network,
    );
    expect(result).toMatchObject({
      status: 'passed',
      providerRequests: 0,
      paidSpendUSD: '0',
    });
    expect(result.checks).toHaveLength(38);
    expect(result.requests).toBe(forwarded);
    for (const actor of actors) {
      const r = await db.admin(
        '/rest/v1/ai_runs?user_id=eq.' + actor.fixture.owner,
        'GET',
      );
      expect(await r.json()).toHaveLength(1);
      const bucket = await (
        await db.admin(
          '/rest/v1/usage_buckets?user_id=eq.' + actor.fixture.owner,
          'GET',
        )
      ).json();
      expect(bucket[0]).toMatchObject({
        allocated_ceiling_usd: 0.000001,
        spent_usd: 0,
        reserved_usd: 0,
      });
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    const admin = administrativeClient();
    try {
      for (const owner of users) {
        const profile = await admin
          .from('profiles')
          .select('user_id')
          .eq('user_id', owner)
          .maybeSingle();
        if (profile.data) {
          const start = await admin.rpc('begin_account_deletion_v1', {
            p_owner: owner,
            p_password_at: new Date().toISOString(),
          });
          expect(start.error).toBeNull();
          let done = false;
          for (let n = 0; n < 30; n++) {
            const r = await continueDeletion({ userId: owner }, admin);
            if (r.state === 'deleting' && r.phase === 'completed') {
              done = true;
              break;
            }
          }
          expect(done).toBe(true);
        } else
          expect((await admin.auth.admin.deleteUser(owner)).error).toBeNull();
      }
    } finally {
      key.fill(0);
      vi.unstubAllEnvs();
    }
  }
}, 90000);

import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LocalSupabase } from '../helpers/local-supabase.js';
import { localStatus } from '../../scripts/local-database.js';
import { localRouter } from '../../server/http/router.js';
import {
  AuthenticatedStatusSchema,
  DisplayNameSchema,
  SettingsSchema,
  type Settings,
} from '../../shared/auth.js';
import { hasProviderConsent } from '../../server/services/settings.js';
import { verifySession } from '../../server/auth/session.js';

let db: LocalSupabase;
let a: { id: string; token: string };
let b: { id: string; token: string };
const server = createServer(localRouter);
let origin: string;
async function request(
  token: string | null,
  method = 'GET',
  body?: unknown,
  path = '/api/settings',
) {
  return fetch(origin + path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
async function settings(token: string): Promise<Settings> {
  const response = await request(token);
  expect(response.status).toBe(200);
  return SettingsSchema.parse(
    ((await response.json()) as { data: unknown }).data,
  );
}
beforeAll(async () => {
  const config = localStatus();
  vi.stubEnv('VITE_SUPABASE_URL', config.apiUrl);
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', config.anonKey);
  db = new LocalSupabase();
  a = await db.createUser();
  b = await db.createUser();
  await db.seed(a.id);
  await db.seed(b.id);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing local API');
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    if (db) await db.cleanup();
  } finally {
    vi.unstubAllEnvs();
  }
});
describe('real authentication and settings', () => {
  it('denies anonymous/forged auth and returns distinct public and authenticated status', async () => {
    for (const token of [
      null,
      'forged',
      'eyJhbGciOiJub25lIn0.eyJzdWIiOiJmb3JlaWduIn0.',
    ])
      expect((await request(token)).status).toBe(401);
    const publicStatus = await request(null, 'GET', undefined, '/api/status');
    expect(((await publicStatus.json()) as { data: unknown }).data).toEqual({
      status: 'ok',
    });
    const authenticated = await request(
      a.token,
      'GET',
      undefined,
      '/api/status',
    );
    expect(authenticated.status).toBe(200);
    expect(
      AuthenticatedStatusSchema.parse(
        ((await authenticated.json()) as { data: unknown }).data,
      ).features,
    ).toEqual({ settings: true, healthWorkflows: true, inference: false });
    expect(
      (await request('forged', 'GET', undefined, '/api/status')).status,
    ).toBe(401);
  });
  it('persists only owned profile changes and exposes no receipt or arbitrary preferences', async () => {
    const initial = await settings(a.token);
    const patch = {
      client_request_id: randomUUID(),
      expected_updated_at: initial.profile.updatedAt,
      changes: {
        display_name: 'Synthetic A',
        timezone: 'America/New_York',
        units: 'imperial',
      },
    };
    const response = await request(a.token, 'PATCH', patch);
    expect(response.status).toBe(200);
    const current = await settings(a.token);
    expect(current.profile).toMatchObject({
      userId: a.id,
      displayName: 'Synthetic A',
      timezone: 'America/New_York',
      units: 'imperial',
    });
    expect((await settings(b.token)).profile.displayName).toBe(
      'Synthetic user',
    );
    expect(JSON.stringify(current)).not.toContain('_settings_last_write');
    expect((await request(a.token, 'PATCH', patch)).status).toBe(200);
    expect((await settings(a.token)).profile.updatedAt).toBe(
      current.profile.updatedAt,
    );
    expect(
      (
        await request(a.token, 'PATCH', {
          ...patch,
          changes: { units: 'metric' },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await request(a.token, 'PATCH', {
          ...patch,
          client_request_id: randomUUID(),
        })
      ).status,
    ).toBe(409);
  });
  it('accepts current OpenRouter policy, revokes it, and blocks stale reacceptance', async () => {
    const current = await settings(a.token);
    const patch = {
      client_request_id: randomUUID(),
      expected_updated_at: current.profile.updatedAt,
      changes: {
        provider_consent: {
          provider: 'openrouter',
          accepted: true,
          policy_version: 'openrouter_zdr_v2',
        },
      },
    };
    expect((await request(a.token, 'PATCH', patch)).status).toBe(200);
    const context = await verifySession({
      headers: { authorization: `Bearer ${a.token}` },
    });
    expect(await hasProviderConsent(context, 'openrouter')).toBe(true);
    const accepted = await settings(a.token);
    expect(
      (
        await request(a.token, 'PATCH', {
          ...patch,
          client_request_id: randomUUID(),
          expected_updated_at: accepted.profile.updatedAt,
          changes: {
            provider_consent: {
              ...patch.changes.provider_consent,
              accepted: false,
            },
          },
        })
      ).status,
    ).toBe(200);
    expect(await hasProviderConsent(context, 'openrouter')).toBe(false);
    expect((await request(a.token, 'PATCH', patch)).status).toBe(409);
    expect(
      (await settings(b.token)).providerConsents.every(
        (entry) => !entry.accepted,
      ),
    ).toBe(true);
  });
  it('serializes competing settings updates and reports one conflict', async () => {
    const current = await settings(a.token);
    const results = await Promise.all(
      ['metric', 'imperial'].map((units) =>
        request(a.token, 'PATCH', {
          client_request_id: randomUUID(),
          expected_updated_at: current.profile.updatedAt,
          changes: { units },
        }),
      ),
    );
    expect(results.map((response) => response.status).sort()).toEqual([
      200, 409,
    ]);
  });
  it('rejects invalid inputs through API and direct RPC without granting direct writes', async () => {
    const current = await settings(a.token);
    for (const changes of [
      { user_id: b.id },
      { timezone: 'not/a/timezone' },
      { timezone: 'Factory' },
      { units: 'bogus' },
      { account_state: 'deleting' },
      { preferences: {} },
      {
        provider_consent: {
          provider: 'vertex_ai',
          accepted: true,
          policy_version: 'google_cloud_pending_v1',
        },
      },
      {
        provider_consent: {
          provider: 'openrouter',
          accepted: true,
          policy_version: 'future',
        },
      },
      {
        provider_consent: {
          provider: 'openrouter',
          accepted: true,
          policy_version: 'openrouter_zdr_v1',
        },
      },
    ]) {
      const patch = {
        client_request_id: randomUUID(),
        expected_updated_at: current.profile.updatedAt,
        changes,
      };
      expect([400, 403]).toContain(
        (await request(a.token, 'PATCH', patch)).status,
      );
      const rpc = await db.request('/rest/v1/rpc/update_settings_v1', a.token, {
        method: 'POST',
        body: JSON.stringify({ p_request: patch }),
      });
      expect(rpc.ok).toBe(false);
    }
    const denied = await db.request(
      `/rest/v1/profiles?user_id=eq.${a.id}`,
      a.token,
      { method: 'PATCH', body: JSON.stringify({ units: 'metric' }) },
    );
    expect(denied.status).toBe(403);
    const anon = await db.request('/rest/v1/rpc/update_settings_v1', 'anon', {
      method: 'POST',
      body: JSON.stringify({ p_request: {} }),
    });
    expect([401, 403]).toContain(anon.status);
  });
  it('denies foreign browser origins and malformed/oversized JSON', async () => {
    expect(
      (
        await fetch(origin + '/api/settings', {
          headers: {
            Authorization: `Bearer ${a.token}`,
            Origin: 'https://foreign.example.test',
          },
        })
      ).status,
    ).toBe(403);
    for (const [body, expected] of [
      ['{', 400],
      [' '.repeat(2 * 1024 * 1024 + 1), 413],
    ] as const) {
      const response = await fetch(origin + '/api/settings', {
        method: 'PATCH',
        headers: {
          Authorization: `Bearer ${a.token}`,
          'Content-Type': 'application/json',
        },
        body,
      });
      expect(response.status).toBe(expected);
      expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });
  it('denies unprovisioned and deleting identities', async () => {
    const extra = await db.createUser();
    expect((await request(extra.token)).status).toBe(403);
    await db.admin('/rest/v1/profiles', 'POST', {
      user_id: extra.id,
      account_state: 'deleting',
    });
    expect((await request(extra.token)).status).toBe(403);
  });
  it('keeps settings readable and unchanged after invalid direct RPC display names', async () => {
    const before = await settings(a.token);
    const foreignBefore = await settings(b.token);
    for (const display_name of [
      '\t',
      '\n\r',
      '\u00a0',
      '\u2003',
      '\ufeff',
      ' \t\n\u3000 ',
      'x'.repeat(201),
      '🦊'.repeat(201),
      `${'x'.repeat(200)}🦊`,
      true,
      7,
      {},
      [],
    ]) {
      expect(DisplayNameSchema.safeParse(display_name).success).toBe(false);
      const patch = {
        client_request_id: randomUUID(),
        expected_updated_at: before.profile.updatedAt,
        changes: { display_name },
      };
      expect((await request(a.token, 'PATCH', patch)).status).toBe(400);
      const rpc = await db.request('/rest/v1/rpc/update_settings_v1', a.token, {
        method: 'POST',
        body: JSON.stringify({ p_request: patch }),
      });
      expect(rpc.status).toBe(400);
      expect(((await rpc.json()) as { message: string }).message).toBe(
        'invalid_settings',
      );
      expect(await settings(a.token)).toEqual(before);
      expect(await settings(b.token)).toEqual(foreignBefore);
    }
  });
  it('normalizes direct RPC display names with the response contract at Unicode character boundaries', async () => {
    const whitespace =
      '\u0009\u000a\u000b\u000c\u000d\u0020\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a\u2028\u2029\u202f\u205f\u3000\ufeff';
    for (const display_name of [
      `${whitespace}Synthetic 🦊${whitespace}`,
      'x'.repeat(200),
      '🦊'.repeat(200),
      `${'x'.repeat(199)}🦊`,
      'Synthetic\u200bname',
      null,
    ]) {
      const before = await settings(a.token);
      const rpc = await db.request('/rest/v1/rpc/update_settings_v1', a.token, {
        method: 'POST',
        body: JSON.stringify({
          p_request: {
            client_request_id: randomUUID(),
            expected_updated_at: before.profile.updatedAt,
            changes: { display_name },
          },
        }),
      });
      expect(rpc.status).toBe(200);
      const stored = (await rpc.json()) as { display_name: string | null };
      expect(stored.display_name).toBe(DisplayNameSchema.parse(display_name));
      expect((await settings(a.token)).profile.displayName).toBe(
        stored.display_name,
      );
    }
  });
});

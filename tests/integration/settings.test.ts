import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LocalSupabase } from '../helpers/local-supabase.js';
import { localStatus } from '../../scripts/local-database.js';
import { localRouter } from '../../server/http/router.js';
import { AuthenticatedStatusSchema, SettingsSchema, type Settings } from '../../shared/auth.js';
import { hasProviderConsent } from '../../server/services/settings.js';
import { verifySession } from '../../server/auth/session.js';

let db: LocalSupabase;
let a: { id: string; token: string }; let b: { id: string; token: string };
const server = createServer(localRouter);
let origin: string;
async function request(token: string | null, method = 'GET', body?: unknown, path = '/api/settings') {
  return fetch(origin + path, { method, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
}
async function settings(token: string): Promise<Settings> {
  const response = await request(token);
  expect(response.status).toBe(200);
  return SettingsSchema.parse((await response.json() as { data: unknown }).data);
}
beforeAll(async () => {
  const config = localStatus();
  vi.stubEnv('VITE_SUPABASE_URL', config.apiUrl); vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', config.anonKey);
  db = new LocalSupabase(); a = await db.createUser(); b = await db.createUser();
  await db.seed(a.id); await db.seed(b.id);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing local API');
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve()));
  try { if (db) await db.cleanup(); } finally { vi.unstubAllEnvs(); }
});
describe('real authentication and settings', () => {
  it('denies anonymous/forged auth and returns distinct public and authenticated status', async () => {
    for (const token of [null, 'forged', 'eyJhbGciOiJub25lIn0.eyJzdWIiOiJmb3JlaWduIn0.']) expect((await request(token)).status).toBe(401);
    const publicStatus = await request(null, 'GET', undefined, '/api/status');
    expect((await publicStatus.json() as { data: unknown }).data).toEqual({ status: 'ok' });
    const authenticated = await request(a.token, 'GET', undefined, '/api/status');
    expect(authenticated.status).toBe(200);
    expect(AuthenticatedStatusSchema.parse((await authenticated.json() as { data: unknown }).data).features).toEqual({ settings: true, healthWorkflows: false, inference: false });
    expect((await request('forged', 'GET', undefined, '/api/status')).status).toBe(401);
  });
  it('persists only owned profile changes and exposes no receipt or arbitrary preferences', async () => {
    const initial = await settings(a.token);
    const patch = { client_request_id: randomUUID(), expected_updated_at: initial.profile.updatedAt, changes: { display_name: 'Synthetic A', timezone: 'America/New_York', units: 'imperial' } };
    const response = await request(a.token, 'PATCH', patch);
    expect(response.status).toBe(200);
    const current = await settings(a.token);
    expect(current.profile).toMatchObject({ userId: a.id, displayName: 'Synthetic A', timezone: 'America/New_York', units: 'imperial' });
    expect((await settings(b.token)).profile.displayName).toBe('Synthetic user');
    expect(JSON.stringify(current)).not.toContain('_settings_last_write');
    expect((await request(a.token, 'PATCH', patch)).status).toBe(200);
    expect((await settings(a.token)).profile.updatedAt).toBe(current.profile.updatedAt);
    expect((await request(a.token, 'PATCH', { ...patch, changes: { units: 'metric' } })).status).toBe(409);
    expect((await request(a.token, 'PATCH', { ...patch, client_request_id: randomUUID() })).status).toBe(409);
  });
  it('accepts current OpenRouter policy, revokes it, and blocks stale reacceptance', async () => {
    const current = await settings(a.token);
    const patch = { client_request_id: randomUUID(), expected_updated_at: current.profile.updatedAt, changes: { provider_consent: { provider: 'openrouter', accepted: true, policy_version: 'openrouter_zdr_v1' } } };
    expect((await request(a.token, 'PATCH', patch)).status).toBe(200);
    const context = await verifySession({ headers: { authorization: `Bearer ${a.token}` } });
    expect(await hasProviderConsent(context, 'openrouter')).toBe(true);
    const accepted = await settings(a.token);
    expect((await request(a.token, 'PATCH', { ...patch, client_request_id: randomUUID(), expected_updated_at: accepted.profile.updatedAt, changes: { provider_consent: { ...patch.changes.provider_consent, accepted: false } } })).status).toBe(200);
    expect(await hasProviderConsent(context, 'openrouter')).toBe(false);
    expect((await request(a.token, 'PATCH', patch)).status).toBe(409);
    expect((await settings(b.token)).providerConsents.every((entry) => !entry.accepted)).toBe(true);
  });
  it('serializes competing settings updates and reports one conflict', async () => {
    const current = await settings(a.token);
    const results = await Promise.all(['metric','imperial'].map((units) => request(a.token, 'PATCH', { client_request_id: randomUUID(), expected_updated_at: current.profile.updatedAt, changes: { units } })));
    expect(results.map((response) => response.status).sort()).toEqual([200,409]);
  });
  it('rejects invalid inputs through API and direct RPC without granting direct writes', async () => {
    const current = await settings(a.token);
    for (const changes of [{ user_id: b.id }, { timezone: 'not/a/timezone' }, { timezone: 'Factory' }, { units: 'bogus' }, { account_state: 'deleting' }, { preferences: {} }, { provider_consent: { provider: 'vertex_ai', accepted: true, policy_version: 'google_cloud_pending_v1' } }, { provider_consent: { provider: 'openrouter', accepted: true, policy_version: 'future' } }]) {
      const patch = { client_request_id: randomUUID(), expected_updated_at: current.profile.updatedAt, changes };
      expect([400,403]).toContain((await request(a.token, 'PATCH', patch)).status);
      const rpc = await db.request('/rest/v1/rpc/update_settings_v1', a.token, { method: 'POST', body: JSON.stringify({ p_request: patch }) });
      expect(rpc.ok).toBe(false);
    }
    const denied = await db.request(`/rest/v1/profiles?user_id=eq.${a.id}`, a.token, { method: 'PATCH', body: JSON.stringify({ units: 'metric' }) });
    expect(denied.status).toBe(403);
    const anon = await db.request('/rest/v1/rpc/update_settings_v1', 'anon', { method: 'POST', body: JSON.stringify({ p_request: {} }) });
    expect([401,403]).toContain(anon.status);
  });
  it('denies foreign browser origins and malformed/oversized JSON', async () => {
    expect((await fetch(origin + '/api/settings', { headers: { Authorization: `Bearer ${a.token}`, Origin: 'https://foreign.example.test' } })).status).toBe(403);
    for (const [body, expected] of [['{',400], [' '.repeat(2 * 1024 * 1024 + 1),413]] as const) {
      const response = await fetch(origin + '/api/settings', { method: 'PATCH', headers: { Authorization: `Bearer ${a.token}`, 'Content-Type': 'application/json' }, body });
      expect(response.status).toBe(expected); expect(response.headers.get('cache-control')).toBe('no-store');
    }
  });
  it('denies unprovisioned and deleting identities', async () => {
    const extra = await db.createUser();
    expect((await request(extra.token)).status).toBe(403);
    await db.admin('/rest/v1/profiles', 'POST', { user_id: extra.id, account_state: 'deleting' });
    expect((await request(extra.token)).status).toBe(403);
  });
});

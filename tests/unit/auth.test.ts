import { afterEach, describe, expect, it, vi } from 'vitest';
import { publicAuthConfig, SettingsPatchSchema } from '../../shared/auth.js';
import { verifySession } from '../../server/auth/session.js';
import { localRouter } from '../../server/http/router.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
const id = '11111111-1111-4111-8111-111111111111';
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe('auth configuration and settings contracts', () => {
  it('allows absent config and exact public endpoints, rejecting secret keys and URL injection', () => {
    expect(publicAuthConfig(undefined, undefined)).toBeNull();
    expect(publicAuthConfig('http://127.0.0.1:54321', 'sb_publishable_synthetic')?.url).toBe('http://127.0.0.1:54321');
    for (const url of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/path', 'https://example.com?secret=x']) expect(() => publicAuthConfig(url, 'sb_publishable_synthetic')).toThrow('configuration is invalid');
    expect(() => publicAuthConfig('https://example.com', 'sb_secret_synthetic')).toThrow();
    const key = `header.${btoa(JSON.stringify({ role: 'service_role' }))}.signature`;
    expect(() => publicAuthConfig('https://example.com', key)).toThrow();
  });
  it('validates the bounded settings patch and excludes arbitrary policy or ownership fields', () => {
    const patch = { client_request_id: id, expected_updated_at: '2026-10-24T00:00:00Z', changes: { timezone: 'America/New_York' } };
    expect(SettingsPatchSchema.parse(patch)).toEqual(patch);
    for (const changes of [{}, { timezone: 'invented' }, { units: 'unknown' }, { user_id: id }, { preferences: {} }, { traceDays: 90 }, { allocated_ceiling_usd: '900' }]) expect(SettingsPatchSchema.safeParse({ ...patch, changes }).success).toBe(false);
  });
});
describe('server auth', () => {
  it('contains malformed request-target errors at the local router boundary', () => {
    const response = { setHeader:vi.fn(),end:vi.fn() } as unknown as ServerResponse;
    expect(() => localRouter({ url:'http://[bad' } as IncomingMessage,response)).not.toThrow();
    expect(response.statusCode).toBe(400);
  });
  it.each([undefined, '', 'Basic x', 'Bearer x,y', 'Bearer x y'])('rejects invalid bearer syntax %s before transport', async (authorization) => {
    const transport = vi.fn(); vi.stubGlobal('fetch', transport);
    await expect(verifySession({ headers: authorization === undefined ? {} : { authorization } })).rejects.toMatchObject({ status: 401 });
    expect(transport).not.toHaveBeenCalled();
  });
  it('derives the owner from Auth, then uses the original bearer under RLS', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321'); vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_synthetic');
    const transport = vi.fn().mockResolvedValueOnce(Response.json({ id })).mockResolvedValueOnce(Response.json({ account_state: 'active' }));
    vi.stubGlobal('fetch', transport);
    const context = await verifySession({ headers: { authorization: 'Bearer synthetic-token' } });
    expect(context.userId).toBe(id);
    expect(String(transport.mock.calls[0]![0])).toContain('/auth/v1/user');
    expect(String(transport.mock.calls[1]![0])).toContain(`user_id=eq.${id}`);
    for (const call of transport.mock.calls) expect(new Headers(call[1].headers).get('authorization')).toBe('Bearer synthetic-token');
  });
  it.each([null, { account_state: 'deleting' }])('denies an unavailable profile', async (profile) => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321'); vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_synthetic');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(Response.json({ id })).mockResolvedValueOnce(Response.json(profile)));
    await expect(verifySession({ headers: { authorization: 'Bearer synthetic-token' } })).rejects.toMatchObject({ status: 403 });
  });
  it('fails closed when Auth cannot be reached', async () => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321'); vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_synthetic');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('synthetic connection failure')));
    await expect(verifySession({ headers: { authorization: 'Bearer synthetic-token' } })).rejects.toMatchObject({ status: 503 });
  });
  it('maps an expired-token Auth response to safe unauthorized denial', async () => {
    vi.stubEnv('VITE_SUPABASE_URL','http://127.0.0.1:54321'); vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY','sb_publishable_synthetic');
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue(Response.json({ msg:'Synthetic JWT expired',code:'bad_jwt' },{ status:401 })));
    await expect(verifySession({ headers:{ authorization:'Bearer synthetic-expired-token' } })).rejects.toMatchObject({ status:401,message:'Sign in to continue.' });
  });
});

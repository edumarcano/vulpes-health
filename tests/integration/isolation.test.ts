import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { databaseTables, protectedTables, readableTables } from '../fixtures/database-graph.js';
import type { DatabaseGraph } from '../fixtures/database-graph.js';
import { LocalSupabase } from '../helpers/local-supabase.js';

let db: LocalSupabase;
let a: { id: string; token: string };
let b: { id: string; token: string };
let graphA: DatabaseGraph;
let graphB: DatabaseGraph;

beforeAll(async () => {
  db = new LocalSupabase();
  a = await db.createUser();
  b = await db.createUser();
  graphA = await db.seed(a.id);
  graphB = await db.seed(b.id);
});
afterAll(async () => { if (db) await db.cleanup(); });

describe('real password sessions and direct PostgREST isolation', () => {
  it.each(readableTables)('isolates lists, explicit IDs and counts in %s', async (table) => {
    const key = table === 'profiles' ? 'user_id' : 'id';
    for (const [user, own, foreign] of [[a, graphA, graphB], [b, graphB, graphA]] as const) {
      const list = await db.request(`/rest/v1/${table}?select=*`, user.token, { headers: { Prefer: 'count=exact' } });
      expect(list.status).toBe(200);
      const rows = await list.json() as Record<string, unknown>[];
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((row) => row.user_id === user.id)).toBe(true);
      expect(rows.some((row) => row[key] === own.rows[table][key])).toBe(true);
      expect(list.headers.get('content-range')).toMatch(/\/1$/);
      const byForeignId = await db.request(`/rest/v1/${table}?${key}=eq.${String(foreign.rows[table][key])}&select=*`, user.token);
      expect(byForeignId.status).toBe(200);
      expect(await byForeignId.json()).toEqual([]);
      const counted = await db.request(`/rest/v1/${table}?${key}=eq.${String(foreign.rows[table][key])}&select=*`, user.token, { method: 'HEAD', headers: { Prefer: 'count=exact' } });
      expect(counted.status).toBe(200);
      expect(counted.headers.get('content-range')).toMatch(/\/0$/);
    }
  });

  it.each(databaseTables)('denies anonymous reads of %s', async (table) => {
    const response = await db.request(`/rest/v1/${table}?select=*`, 'anon');
    expect([401, 403]).toContain(response.status);
    const error = await response.json() as { code: string };
    expect(error.code).toBe('42501');
  });

  it.each(protectedTables)('denies even owner access to protected %s', async (table) => {
    for (const token of [a.token, b.token]) {
      const response = await db.request(`/rest/v1/${table}?select=*`, token);
      expect(response.status).toBe(403);
      expect((await response.json() as { code: string }).code).toBe('42501');
    }
  });

  it.each(databaseTables)('denies all direct mutations of %s and preserves persisted state', async (table) => {
    const key = table === 'profiles' ? 'user_id' : 'id';
    const route = `/rest/v1/${table}?${key}=eq.${String(graphA.rows[table][key])}`;
    const before = await (await db.admin(`${route}&select=*`, 'GET')).json() as unknown;
    for (const token of ['anon', a.token, b.token]) {
      for (const method of ['POST', 'PATCH', 'DELETE']) {
        const insert = { ...graphA.rows[table], ...(table === 'profiles' ? {} : { id: randomUUID() }) };
        const response = await db.request(method === 'POST' ? `/rest/v1/${table}` : route, token, {
          method, ...(method === 'DELETE' ? {} : { body: JSON.stringify(method === 'POST' ? insert : { user_id: b.id }) }),
        });
        expect([401, 403]).toContain(response.status);
        expect((await response.json() as { code: string }).code).toBe('42501');
      }
      const upsert = await db.request(`/rest/v1/${table}`, token, {
        method: 'POST', headers: { Prefer: 'resolution=merge-duplicates' }, body: JSON.stringify(graphA.rows[table]),
      });
      expect([401, 403]).toContain(upsert.status);
      expect((await upsert.json() as { code: string }).code).toBe('42501');
    }
    expect(await (await db.admin(`${route}&select=*`, 'GET')).json()).toEqual(before);
    const count = await db.admin(`/rest/v1/${table}?user_id=eq.${a.id}&select=${key}`, 'GET');
    expect(await count.json()).toHaveLength(1);
  });

  it('filters embedded joins through both parent and child policies', async () => {
    for (const [user, foreign] of [[a, graphB], [b, graphA]] as const) {
      const response = await db.request('/rest/v1/conversations?select=id,user_id,messages(id,user_id),ai_runs(id,user_id)', user.token);
      expect(response.status).toBe(200);
      const rows = await response.json() as { user_id: string; messages: { user_id: string }[]; ai_runs: { user_id: string }[] }[];
      expect(rows).toHaveLength(1);
      expect(rows[0]?.user_id).toBe(user.id);
      expect(rows[0]?.messages).toHaveLength(1);
      expect(rows[0]?.ai_runs).toHaveLength(1);
      expect(rows[0]?.messages.every((message) => message.user_id === user.id)).toBe(true);
      const hidden = await db.request(`/rest/v1/conversations?id=eq.${foreign.ids.conversations}&select=id,messages(id),ai_runs(id)`, user.token);
      expect(hidden.status).toBe(200);
      expect(await hidden.json()).toEqual([]);
    }
  });

  it('rejects public signup, anonymous sign-in and invalid bearer tokens', async () => {
    const signup = await db.request('/auth/v1/signup', 'anon', { method: 'POST', body: JSON.stringify({ email: `blocked-${randomUUID()}@example.test`, password: 'Synthetic-Blocked-Password-123' }) });
    expect(signup.ok).toBe(false);
    expect([400, 403, 422]).toContain(signup.status);
    const signupError = await signup.json() as { code?: string | number; error_code?: string };
    expect(signupError.error_code ?? signupError.code).toBe('signup_disabled');
    const anonymous = await db.request('/auth/v1/signup', 'anon', { method: 'POST', body: '{}' });
    expect(anonymous.ok).toBe(false);
    const missing = await db.request('/rest/v1/profiles?select=*', null);
    expect([401, 403]).toContain(missing.status);
    expect((await missing.json() as { code: string }).code).toBe('42501');
    for (const token of ['not-a-jwt', 'eyJhbGciOiJub25lIn0.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.']) {
      const response = await db.request('/rest/v1/profiles?select=*', token);
      expect(response.status).toBe(401);
    }
  });

  it('denies explicit consequential writes and keeps balances and goal state unchanged', async () => {
    const cases = [
      ['goals', graphA.ids.goals, { state: 'active', current_revision_id: graphA.ids.goal_revisions }],
      ['action_proposals', graphA.ids.action_proposals, { state: 'approved' }],
      ['ai_runs', graphA.ids.ai_runs, { status: 'completed', finished_at: new Date().toISOString() }],
      ['usage_buckets', graphA.ids.usage_buckets, { allocated_ceiling_usd: '999999' }],
      ['profiles', a.id, { consent_versions: { unapproved: '1' } }],
    ] as const;
    for (const [table, id, body] of cases) {
      const key = table === 'profiles' ? 'user_id' : 'id';
      const route = `/rest/v1/${table}?${key}=eq.${id}`;
      const before = await (await db.admin(`${route}&select=*`, 'GET')).json() as unknown;
      const denied = await db.request(route, a.token, { method: 'PATCH', body: JSON.stringify(body) });
      expect(denied.status).toBe(403);
      expect(await (await db.admin(`${route}&select=*`, 'GET')).json()).toEqual(before);
    }
  });

  it('rejects service-role revision rewrites while permitting trusted reads', async () => {
    const route = `/rest/v1/goal_revisions?id=eq.${graphA.ids.goal_revisions}`;
    const before = await (await db.admin(`${route}&select=*`, 'GET')).json() as unknown;
    const denied = await db.request(route, 'admin', { method: 'PATCH', body: JSON.stringify({ payload: { synthetic: 'rewritten' } }) });
    expect(denied.status).toBe(403);
    expect((await denied.json() as { code: string }).code).toBe('42501');
    expect(await (await db.admin(`${route}&select=*`, 'GET')).json()).toEqual(before);
  });

  it('enforces one active run during simultaneous trusted inserts', async () => {
    const ids = [randomUUID(), randomUUID()];
    await db.admin(`/rest/v1/ai_runs?id=eq.${graphA.ids.ai_runs}`, 'PATCH', { status: 'completed', finished_at: new Date().toISOString() });
    try {
      const responses = await Promise.all(ids.map((id) => db.request('/rest/v1/ai_runs', 'admin', {
        method: 'POST', body: JSON.stringify({ ...graphA.rows.ai_runs, id, client_request_id: randomUUID() }),
      })));
      expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
      const rejected = responses.find((response) => response.status === 409);
      expect((await rejected?.json() as { code: string }).code).toBe('23505');
      const admitted = await (await db.admin(`/rest/v1/ai_runs?user_id=eq.${a.id}&status=eq.admitted&select=id`, 'GET')).json() as { id: string }[];
      expect(admitted).toHaveLength(1);
      expect(ids).toContain(admitted[0]?.id);
    } finally {
      for (const id of ids) await db.admin(`/rest/v1/ai_runs?id=eq.${id}`, 'DELETE');
      await db.admin(`/rest/v1/ai_runs?id=eq.${graphA.ids.ai_runs}`, 'PATCH', { status: 'admitted', finished_at: null });
    }
  });
});

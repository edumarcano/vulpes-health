import { randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LocalSupabase } from '../helpers/local-supabase.js';
import { localStatus } from '../../scripts/local-database.js';
import { verifySession, type AuthContext } from '../../server/auth/session.js';
import {
  cleanupExpiredPayloads,
  readPayload,
  writePayload,
} from '../../server/security/private-payloads.js';
import {
  encryptBytes,
  readEncryptionKeys,
} from '../../server/security/encryption.js';
let db: LocalSupabase;
let a: AuthContext;
let b: AuthContext;
let tokenA: string;
let stepId: string;
beforeAll(async () => {
  const status = localStatus();
  vi.stubEnv('VITE_SUPABASE_URL', status.apiUrl);
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', status.anonKey);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', status.adminKey);
  vi.stubEnv('VULPES_TRACE_ENCRYPTION_KEY_ID', 'synthetic-v1');
  vi.stubEnv(
    'VULPES_TRACE_ENCRYPTION_KEY_B64',
    randomBytes(32).toString('base64'),
  );
  db = new LocalSupabase();
  const ua = await db.createUser();
  const ub = await db.createUser();
  tokenA = ua.token;
  stepId = (await db.seed(ua.id)).ids.ai_steps;
  await db.seed(ub.id);
  a = await verifySession({ headers: { authorization: `Bearer ${ua.token}` } });
  b = await verifySession({ headers: { authorization: `Bearer ${ub.token}` } });
});
afterAll(async () => {
  try {
    if (db) await db.cleanup();
  } finally {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  }
});
describe('real private payload persistence', () => {
  it('round trips exact original bytes through PostgreSQL and denies foreign/wrong-purpose reads', async () => {
    const bytes = Buffer.concat([
      Buffer.from('Synthetic request 🦊\n'),
      randomBytes(500),
    ]);
    const saved = await writePayload(a, 'import_staging', bytes);
    const result = await readPayload(a, saved.id, 'import_staging');
    expect(result.state).toBe('available');
    if (result.state === 'available') expect(result.bytes).toEqual(bytes);
    expect(await readPayload(b, saved.id, 'import_staging')).toEqual({
      state: 'not_found',
    });
    expect(await readPayload(a, saved.id, 'tool_output')).toEqual({
      state: 'not_found',
    });
    expect(await readPayload(a, randomUUID(), 'ai_request')).toEqual({
      state: 'not_found',
    });
    for (const token of ['anon', tokenA]) {
      const response = await db.request(
        '/rest/v1/private_payloads?select=*',
        token,
      );
      expect([401, 403]).toContain(response.status);
      const rpc = await db.request(
        '/rest/v1/rpc/store_private_payload_v1',
        token,
        { method: 'POST', body: JSON.stringify({ p_payload: {} }) },
      );
      expect([401, 403]).toContain(rpc.status);
      const cleanup = await db.request(
        '/rest/v1/rpc/cleanup_private_payloads_v1',
        token,
        { method: 'POST', body: '{}' },
      );
      expect([401, 403]).toContain(cleanup.status);
    }
  });
  it('rejects tampered stored content and unavailable keys without returning plaintext', async () => {
    const saved = await writePayload(
      a,
      'import_staging',
      Buffer.from('Synthetic private result'),
    );
    await db.admin(`/rest/v1/private_payloads?id=eq.${saved.id}`, 'PATCH', {
      encrypted_bytes: `\\x${'00'.repeat(32)}`,
    });
    expect(await readPayload(a, saved.id, 'import_staging')).toEqual({
      state: 'unavailable',
    });
    const intact = await writePayload(
      a,
      'import_staging',
      Buffer.from('Synthetic response'),
    );
    const old = process.env.VULPES_TRACE_ENCRYPTION_KEY_ID!;
    vi.stubEnv('VULPES_TRACE_ENCRYPTION_KEY_ID', 'missing-key');
    expect(await readPayload(a, intact.id, 'import_staging')).toEqual({
      state: 'unavailable',
    });
    vi.stubEnv('VULPES_TRACE_ENCRYPTION_KEY_ID', old);
  });
  it('denies at the exact expiry boundary before any physical cleanup', async () => {
    const saved = await writePayload(
      a,
      'import_staging',
      Buffer.from('Synthetic staging'),
    );
    const clock = vi
      .spyOn(Date, 'now')
      .mockReturnValue(Date.parse(saved.expiresAt));
    try {
      expect(await readPayload(a, saved.id, 'import_staging')).toEqual({
        state: 'expired',
      });
    } finally {
      clock.mockRestore();
    }
    const raw = await db.admin(
      `/rest/v1/private_payloads?id=eq.${saved.id}&select=id`,
      'GET',
    );
    expect(await raw.json()).toHaveLength(1);
  });
  it('physically removes only expired envelopes in bounded owner batches and clears references', async () => {
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    const createdAt = new Date(Date.now() - 120_000).toISOString();
    const envelopes = Array.from({ length: 101 }, () => ({
      ...encryptBytes(
        {
          id: randomUUID(),
          user_id: a.userId,
          purpose: 'ai_request',
          expires_at: expiredAt,
        },
        Buffer.from('Synthetic expired'),
        readEncryptionKeys(),
      ),
      created_at: createdAt,
    }));
    await db.admin('/rest/v1/private_payloads', 'POST', envelopes);
    await db.admin(`/rest/v1/ai_steps?id=eq.${stepId}`, 'PATCH', {
      input_payload_id: envelopes[0]!.id,
    });
    expect(await readPayload(a, envelopes[0]!.id, 'ai_request')).toEqual({
      state: 'expired',
    });
    expect(await cleanupExpiredPayloads(a.userId)).toBe(100);
    expect(await cleanupExpiredPayloads(a.userId)).toBe(1);
    expect(await cleanupExpiredPayloads(a.userId)).toBe(0);
    const step = await db.admin(
      `/rest/v1/ai_steps?id=eq.${stepId}&select=user_id,input_payload_id`,
      'GET',
    );
    expect(await step.json()).toEqual([
      { user_id: a.userId, input_payload_id: null },
    ]);
    expect(await readPayload(a, envelopes[0]!.id, 'ai_request')).toEqual({
      state: 'not_found',
    });
    const live = await writePayload(
      b,
      'import_staging',
      Buffer.from('Synthetic live'),
    );
    expect((await readPayload(b, live.id, 'import_staging')).state).toBe(
      'available',
    );
    const invalid = await db.request(
      '/rest/v1/rpc/cleanup_private_payloads_v1',
      'admin',
      {
        method: 'POST',
        body: JSON.stringify({ p_owner: a.userId, p_batch_size: 101 }),
      },
    );
    expect(invalid.ok).toBe(false);
  });
  it('enforces account state and retention ceilings in the privileged write RPC', async () => {
    const envelope = encryptBytes(
      {
        id: randomUUID(),
        user_id: a.userId,
        purpose: 'import_staging',
        expires_at: new Date(Date.now() + 7 * 24 * 3600_000).toISOString(),
      },
      Buffer.from('Synthetic bounded'),
      readEncryptionKeys(),
    );
    const excessive = await db.request(
      '/rest/v1/rpc/store_private_payload_v1',
      'admin',
      { method: 'POST', body: JSON.stringify({ p_payload: envelope }) },
    );
    expect(excessive.ok).toBe(false);
    await db.admin(`/rest/v1/profiles?user_id=eq.${a.userId}`, 'PATCH', {
      account_state: 'deleting',
    });
    try {
      await expect(
        writePayload(a, 'import_staging', Buffer.from('Synthetic denied')),
      ).rejects.toMatchObject({ status: 503 });
    } finally {
      await db.admin(`/rest/v1/profiles?user_id=eq.${a.userId}`, 'PATCH', {
        account_state: 'active',
      });
    }
  });
  it('runs the actual cleanup CLI and inspects its persisted deletion effects', async () => {
    const expiry = new Date(Date.now() - 60_000).toISOString();
    const envelope = {
      ...encryptBytes(
        {
          id: randomUUID(),
          user_id: a.userId,
          purpose: 'ai_request',
          expires_at: expiry,
        },
        Buffer.from('Synthetic CLI cleanup'),
        readEncryptionKeys(),
      ),
      created_at: new Date(Date.now() - 120_000).toISOString(),
    };
    await db.admin('/rest/v1/private_payloads', 'POST', envelope);
    const npm = process.env.npm_execpath;
    if (!npm) throw new Error('Run the integration suite through npm.');
    const result = spawnSync(
      process.execPath,
      [npm, 'run', 'maintenance:cleanup'],
      { encoding: 'utf8', timeout: 20_000 },
    );
    expect(result.status).toBe(0);
    expect(result.stdout).toContain('"removed":1');
    expect(await readPayload(a, envelope.id, 'ai_request')).toEqual({
      state: 'not_found',
    });
  });
});

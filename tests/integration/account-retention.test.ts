import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { beforeAll, afterAll, expect, it, vi } from 'vitest';
import { LocalSupabase } from '../helpers/local-supabase.js';
import { localStatus } from '../../scripts/local-database.js';
import { verifySession } from '../../server/auth/session.js';
import { readPayload } from '../../server/security/private-payloads.js';
import {
  encryptBytes,
  readEncryptionKeys,
} from '../../server/security/encryption.js';
import { InspectionService } from '../../server/services/inspection.js';
import { recoverAccount } from '../../server/security/account-recovery.js';
import { administrativeClient } from '../../server/db/administrative.js';
import { spawnSync } from 'node:child_process';

let db: LocalSupabase;
let user: Awaited<ReturnType<LocalSupabase['createUser']>>;
let foreign: Awaited<ReturnType<LocalSupabase['createUser']>>;
beforeAll(async () => {
  const config = localStatus();
  vi.stubEnv('VITE_SUPABASE_URL', config.apiUrl);
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', config.anonKey);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', config.adminKey);
  vi.stubEnv('VULPES_TRACE_ENCRYPTION_KEY_ID', 'synthetic-retention');
  vi.stubEnv(
    'VULPES_TRACE_ENCRYPTION_KEY_B64',
    randomBytes(32).toString('base64'),
  );
  db = new LocalSupabase();
  user = await db.createUser();
  foreign = await db.createUser();
});
afterAll(async () => {
  try {
    await db.cleanup();
  } finally {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  }
});
it('enforces trace expiry before physical cleanup and purges bounded backlogs without changing foreign data', async () => {
  const graph = await db.seed(user.id);
  const other = await db.seed(foreign.id);
  const context = await verifySession({
    headers: { authorization: `Bearer ${user.token}` },
  });
  const bytes = Buffer.from('Synthetic exact private request');
  const envelope = encryptBytes(
    {
      id: graph.ids.private_payloads,
      user_id: user.id,
      purpose: 'ai_request',
      expires_at: new Date(Date.now() + 60_000).toISOString(),
    },
    bytes,
    readEncryptionKeys(),
  );
  await db.admin(
    `/rest/v1/private_payloads?id=eq.${envelope.id}`,
    'PATCH',
    envelope,
  );
  await db.admin(`/rest/v1/ai_runs?id=eq.${graph.ids.ai_runs}`, 'PATCH', {
    status: 'completed',
    finished_at: new Date().toISOString(),
    trace_state: 'available',
  });
  await db.admin(`/rest/v1/ai_steps?id=eq.${graph.ids.ai_steps}`, 'PATCH', {
    request_body_hash: createHash('sha256').update(bytes).digest('hex'),
  });
  const inspector = new InspectionService(context);
  const query = {
    view: 'export' as const,
    run: graph.ids.ai_runs,
    step: graph.ids.ai_steps,
    part: 'input' as const,
  };
  const evidence = await inspector.evidence(query);
  expect(evidence.state).toBe('available');
  if (evidence.state === 'available') expect(evidence.bytes).toEqual(bytes);
  // Expiry participates in authenticated encryption, so regenerate the expired envelope.
  const expired = encryptBytes(
    {
      id: graph.ids.private_payloads,
      user_id: user.id,
      purpose: 'ai_request',
      expires_at: new Date(Date.now() - 60_000).toISOString(),
    },
    bytes,
    readEncryptionKeys(),
  );
  await db.admin(`/rest/v1/private_payloads?id=eq.${expired.id}`, 'PATCH', {
    ...expired,
    created_at: new Date(Date.now() - 120_000).toISOString(),
  });
  expect((await inspector.evidence(query)).state).toBe('expired');
  expect((await readPayload(context, expired.id, 'ai_request')).state).toBe(
    'expired',
  );
  expect(
    (
      await (
        await db.admin(`/rest/v1/private_payloads?id=eq.${expired.id}`, 'GET')
      ).json()
    ).length,
  ).toBe(1);
  const payloads = Array.from({ length: 204 }, () => ({
    ...expired,
    id: randomUUID(),
    created_at: new Date(Date.now() - 120_000).toISOString(),
  }));
  for (let n = 0; n < payloads.length; n += 100)
    await db.admin(
      '/rest/v1/private_payloads',
      'POST',
      payloads.slice(n, n + 100),
    );
  const first = await administrativeClient().rpc('cleanup_data_v1', {
    p_owner: user.id,
    p_batch_size: 100,
  });
  expect(first.error).toBeNull();
  expect(first.data).toMatchObject({ workCount: 100, payloadsRemoved: 100 });
  expect(
    (
      await (
        await db.admin(`/rest/v1/private_payloads?user_id=eq.${user.id}`, 'GET')
      ).json()
    ).length,
  ).toBe(105);
  expect(
    (
      await (
        await db.admin(
          `/rest/v1/private_payloads?id=eq.${other.ids.private_payloads}`,
          'GET',
        )
      ).json()
    ).length,
  ).toBe(1);
  await administrativeClient().rpc('cleanup_data_v1', {
    p_owner: user.id,
    p_batch_size: 100,
  });
  await administrativeClient().rpc('cleanup_data_v1', {
    p_owner: user.id,
    p_batch_size: 100,
  });
  expect(
    (
      await (
        await db.admin(`/rest/v1/private_payloads?user_id=eq.${user.id}`, 'GET')
      ).json()
    ).length,
  ).toBe(0);
  const proposals = Array.from({ length: 205 }, () => ({
    user_id: user.id,
    kind: 'goal.create',
    canonical_payload: { schemaVersion: 1 },
    payload_hash: 'a'.repeat(64),
    summary: 'Synthetic expired draft',
    created_at: new Date(Date.now() - 2 * 86400_000).toISOString(),
    expires_at: new Date(Date.now() - 86400_000).toISOString(),
  }));
  for (let n = 0; n < proposals.length; n += 100)
    await db.admin(
      '/rest/v1/action_proposals',
      'POST',
      proposals.slice(n, n + 100),
    );
  const cleanup = await administrativeClient().rpc(
    'cleanup_account_retention_v1',
    { p_batch_size: 100 },
  );
  expect(cleanup.error).toBeNull();
  expect(cleanup.data).toMatchObject({
    proposalsExpired: 100,
    unfinished: true,
  });
  const retained = await (
    await db.admin(
      `/rest/v1/action_proposals?user_id=eq.${user.id}&state=eq.expired`,
      'GET',
    )
  ).json();
  expect(retained).toHaveLength(100);
  expect(
    retained.every(
      (row: { canonical_payload: unknown }) => row.canonical_payload === null,
    ),
  ).toBe(true);
  expect(
    (
      await (
        await db.admin(
          `/rest/v1/action_proposals?id=eq.${other.ids.action_proposals}`,
          'GET',
        )
      ).json()
    )[0].state,
  ).toBe('approved');
});
it('operator reset requires identity verification and revokes app, direct read and mutation access', async () => {
  const admin = administrativeClient();
  const password = randomBytes(24).toString('base64url');
  await expect(
    recoverAccount(admin, {
      userId: user.id,
      password,
      identityVerified: false,
    }),
  ).rejects.toThrow();
  expect(
    await recoverAccount(admin, {
      userId: user.id,
      password,
      identityVerified: true,
    }),
  ).toEqual({ state: 'credentials_reset', sessionsRevoked: true });
  await expect(
    verifySession({ headers: { authorization: `Bearer ${user.token}` } }),
  ).rejects.toMatchObject({ status: 401 });
  expect(
    await (await db.request('/rest/v1/measurements', user.token)).json(),
  ).toEqual([]);
  const patch = await db.request(
    '/rest/v1/rpc/update_settings_v1',
    user.token,
    {
      method: 'POST',
      body: JSON.stringify({
        p_request: {
          client_request_id: randomUUID(),
          expected_updated_at: (
            await (
              await db.admin(`/rest/v1/profiles?user_id=eq.${user.id}`, 'GET')
            ).json()
          )[0].updated_at,
          changes: { display_name: 'Revoked session mutation' },
        },
      }),
    },
  );
  expect(patch.status).toBe(401);
  const old = await db.request('/auth/v1/token?grant_type=password', 'anon', {
    method: 'POST',
    body: JSON.stringify({ email: user.email, password: user.password }),
  });
  expect(old.ok).toBe(false);
  const restored = await db.request(
    '/auth/v1/token?grant_type=password',
    'anon',
    { method: 'POST', body: JSON.stringify({ email: user.email, password }) },
  );
  expect(restored.ok).toBe(true);
  const token = (await restored.json()).access_token;
  expect(
    (await verifySession({ headers: { authorization: `Bearer ${token}` } }))
      .userId,
  ).toBe(user.id);
});

it('retains unfinished and recent deletion journals while removing completed records older than the backup window', async () => {
  const expired = randomUUID(),
    recent = randomUUID(),
    unfinished = randomUUID();
  const sql = (statement: string) =>
    spawnSync(
      'docker',
      [
        'exec',
        'supabase_db_vulpes-health-pr03-test',
        'psql',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-v',
        'ON_ERROR_STOP=1',
        '-c',
        statement,
      ],
      { encoding: 'utf8' },
    ).status;
  expect(
    sql(`insert into public.account_deletion_receipts(user_id,phase,requested_at,updated_at,completed_at,outcome) values
 ('${expired}','completed',now()-interval '33 days',now()-interval '32 days',now()-interval '32 days','completed'),
 ('${recent}','completed',now()-interval '2 days',now()-interval '1 day',now()-interval '1 day','completed'),
 ('${unfinished}','fenced',now()-interval '33 days',now()-interval '32 days',null,'in_progress');`),
  ).toBe(0);
  try {
    const result = await administrativeClient().rpc(
      'cleanup_account_retention_v1',
      { p_batch_size: 100 },
    );
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ receiptsRemoved: 1 });
    for (const [owner, count] of [
      [expired, 0],
      [recent, 1],
      [unfinished, 1],
    ] as const)
      expect(
        (
          await (
            await db.admin(
              `/rest/v1/account_deletion_receipts?user_id=eq.${owner}`,
              'GET',
            )
          ).json()
        ).length,
      ).toBe(count);
  } finally {
    expect(
      sql(
        `delete from public.account_deletion_receipts where user_id in('${expired}','${recent}','${unfinished}')`,
      ),
    ).toBe(0);
  }
});

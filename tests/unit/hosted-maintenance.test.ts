import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { beforeEach, expect, it, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../../server/db/database.types.js';
import { hostedMaintenanceCommand } from '../../scripts/hosted-maintenance.js';
import { targetHash } from '../../scripts/hosting.js';
import { maintainAccounts } from '../../server/services/maintenance.js';
import { continueDeletion } from '../../server/services/account.js';
vi.mock('../../server/services/account.js', () => ({
  continueDeletion: vi.fn(),
}));
const owner = randomUUID(),
  target = {
    version: 1,
    purpose: 'synthetic-only',
    supabaseProjectRef: 'abcdefghijklmnopqrst',
    recoveryProjectRef: null,
    databaseRegion: 'us-east-1',
    vercelProjectId: 'prj_SyntheticOnly',
    appOrigin: 'https://vulpes-synthetic.vercel.app',
  } as const;
const empty = {
  executed: false,
  busy: false,
  payloadsRemoved: 0,
  batchesExpired: 0,
  proposalsExpired: 0,
  receiptsRemoved: 0,
  interrupted: 0,
  conservative: 0,
  runsRemoved: 0,
  payloadsDue: 0,
  importsDue: 0,
  proposalsDue: 0,
  runsDue: 0,
  receiptsDue: 0,
  deletionPending: false,
  pendingHolds: 0,
  retryAfter: null,
  unfinished: false,
};
const authorization = {
  purpose: 'synthetic-maintenance',
  mode: 'inspect',
  targetSHA256: targetHash(target),
  owners: [owner],
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  approved: true,
};
const credentials = {
  publishableKey: 'sb_publishable_synthetic',
  adminKey: 'sb_secret_synthetic',
  authorization,
  limits: {},
};
beforeEach(() => vi.clearAllMocks());
async function manifest(run: (path: string) => Promise<void>) {
  const directory = await mkdtemp(join(tmpdir(), 'vulpes-maintenance-unit-')),
    path = join(directory, 'manifest.json');
  try {
    await writeFile(
      path,
      JSON.stringify({ target, targetSHA256: targetHash(target) }),
      { flag: 'wx' },
    );
    await run(path);
  } finally {
    await unlink(path);
    await rmdir(directory);
  }
}
it('prints an inert plan and refuses missing hosted opt-in before manifest/stdin/network access', async () => {
  const read = vi.fn(),
    network = vi.fn();
  expect(
    await hostedMaintenanceCommand(['--plan'], read, network),
  ).toMatchObject({ networkRequests: 0, maximumOwners: 10 });
  await expect(
    hostedMaintenanceCommand(['--manifest=missing'], read, network),
  ).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
});
it.each([
  { mode: 'execute' },
  { targetSHA256: 'f'.repeat(64) },
  { expiresAt: '2020-01-01T00:00:00Z' },
  { owners: [] },
  { owners: [owner, owner] },
  { approved: false },
])(
  'refuses invalid or mismatched authorization before network',
  async (patch) => {
    await manifest(async (path) => {
      const network = vi.fn();
      await expect(
        hostedMaintenanceCommand(
          ['--manifest=' + path, '--allow-hosted'],
          async () => ({
            ...credentials,
            authorization: { ...authorization, ...patch },
          }),
          network,
        ),
      ).rejects.toThrow();
      expect(network).not.toHaveBeenCalled();
    });
  },
);
it('validates every approved owner as synthetic before issuing any maintenance RPC', async () => {
  await manifest(async (path) => {
    const network = vi.fn<typeof fetch>(
      async () =>
        new Response(
          JSON.stringify({ user: { id: owner, email: 'real@example.com' } }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    );
    await expect(
      hostedMaintenanceCommand(
        ['--manifest=' + path, '--execute', '--allow-hosted'],
        async () => ({
          ...credentials,
          authorization: { ...authorization, mode: 'execute' },
        }),
        network,
      ),
    ).rejects.toThrow();
    expect(network.mock.calls).toHaveLength(1);
    expect(String(network.mock.calls[0]?.[0])).toContain(
      '/auth/v1/admin/users/',
    );
  });
});
it('checks the whole owner allowlist before cleaning the first eligible account', async () => {
  await manifest(async (path) => {
    const other = randomUUID();
    const network = vi.fn<typeof fetch>(async (url) => {
      const id = String(url).split('/').at(-1);
      return new Response(
        JSON.stringify({
          user: {
            id,
            email:
              id === owner ? 'synthetic@example.invalid' : 'real@example.com',
          },
        }),
        { headers: { 'Content-Type': 'application/json' } },
      );
    });
    await expect(
      hostedMaintenanceCommand(
        ['--manifest=' + path, '--execute', '--allow-hosted'],
        async () => ({
          ...credentials,
          authorization: {
            ...authorization,
            mode: 'execute',
            owners: [owner, other],
          },
        }),
        network,
      ),
    ).rejects.toThrow();
    expect(network.mock.calls).toHaveLength(2);
    expect(
      network.mock.calls.every(([url]) =>
        String(url).includes('/auth/v1/admin/users/'),
      ),
    ).toBe(true);
  });
});
it('refuses an absent identity with no deletion journal before any cleanup RPC', async () => {
  await manifest(async (path) => {
    const network = vi.fn<typeof fetch>(async (url) =>
      String(url).includes('/auth/v1/')
        ? new Response(
            JSON.stringify({
              code: 'user_not_found',
              message: 'Missing synthetic user',
            }),
            {
              status: 404,
              headers: {
                'Content-Type': 'application/json',
                'x-supabase-api-version': '2024-01-01',
              },
            },
          )
        : new Response(
            JSON.stringify({ code: 'PGRST116', message: 'No journal' }),
            { status: 406, headers: { 'Content-Type': 'application/json' } },
          ),
    );
    await expect(
      hostedMaintenanceCommand(
        ['--manifest=' + path, '--execute', '--allow-hosted'],
        async () => ({
          ...credentials,
          authorization: { ...authorization, mode: 'execute' },
        }),
        network,
      ),
    ).rejects.toThrow();
    expect(network.mock.calls).toHaveLength(2);
    expect(
      network.mock.calls.every(([url]) => !String(url).includes('/rpc/')),
    ).toBe(true);
  });
});
it('uses only explicit owners and execute=false during inspection', async () => {
  const rpc = vi.fn(async () => ({ data: empty, error: null }));
  const report = await maintainAccounts(
    { rpc } as unknown as SupabaseClient<Database>,
    { owners: [owner], execute: false, limits: {} },
  );
  expect(report.unfinished).toBe(false);
  expect(rpc.mock.calls).toHaveLength(1);
  expect(continueDeletion).not.toHaveBeenCalled();
});
it('caps passes and reports remaining work instead of looping indefinitely', async () => {
  const rpc = vi.fn(async (_name: string, args: { p_execute: boolean }) => ({
    data: {
      ...empty,
      executed: args.p_execute,
      payloadsRemoved: args.p_execute ? 1 : 0,
      payloadsDue: 10,
      unfinished: true,
    },
    error: null,
  }));
  const report = await maintainAccounts(
    { rpc } as unknown as SupabaseClient<Database>,
    { owners: [owner], execute: true, limits: { maxPasses: 2 } },
  );
  expect(report).toMatchObject({
    passes: 2,
    unfinished: true,
    changes: { payloadsRemoved: 2 },
  });
  for (const call of rpc.mock.calls)
    expect(call[1]).toMatchObject({ p_owner: owner, p_batch_size: 100 });
});
it('keeps future uncertain accounting pending and stops without another deletion attempt', async () => {
  const rpc = vi.fn(async (_name: string, args: { p_execute: boolean }) => ({
    data: {
      ...empty,
      executed: args.p_execute,
      deletionPending: true,
      unfinished: true,
    },
    error: null,
  }));
  vi.mocked(continueDeletion).mockResolvedValue({
    state: 'deleting',
    phase: 'awaiting_settlement',
    receiptId: randomUUID(),
    requestedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    retryAfter: new Date(Date.now() + 86400_000).toISOString(),
    outcome: 'waiting_for_accounting',
  });
  const report = await maintainAccounts(
    { rpc } as unknown as SupabaseClient<Database>,
    { owners: [owner], execute: true, limits: {} },
  );
  expect(report).toMatchObject({
    passes: 1,
    deletionSteps: 1,
    unfinished: true,
  });
  expect(continueDeletion).toHaveBeenCalledTimes(1);
});
it('attempts unconfirmed Auth removal at most once per owner per invocation', async () => {
  const rpc = vi.fn(async (_name: string, args: { p_execute: boolean }) => ({
    data: {
      ...empty,
      executed: args.p_execute,
      deletionPending: true,
      unfinished: true,
    },
    error: null,
  }));
  vi.mocked(continueDeletion).mockResolvedValue({
    state: 'deleting',
    phase: 'auth_removal_pending',
    receiptId: randomUUID(),
    requestedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    retryAfter: null,
    outcome: 'auth_unavailable',
  });
  const report = await maintainAccounts(
    { rpc } as unknown as SupabaseClient<Database>,
    { owners: [owner], execute: true, limits: {} },
  );
  expect(report.deletionSteps).toBe(1);
  expect(report.unfinished).toBe(true);
  expect(continueDeletion).toHaveBeenCalledTimes(1);
});
it('refuses a server execution-mode mismatch instead of claiming an inspection pass', async () => {
  const rpc = vi.fn(async () => ({
    data: { ...empty, executed: true },
    error: null,
  }));
  await expect(
    maintainAccounts({ rpc } as unknown as SupabaseClient<Database>, {
      owners: [owner],
      execute: false,
      limits: {},
    }),
  ).rejects.toThrow();
});
it('reports a busy owner without attempting deletion or spinning through more passes', async () => {
  const rpc = vi.fn(async (_name: string, args: { p_execute: boolean }) => ({
    data: { ...empty, busy: args.p_execute, unfinished: true },
    error: null,
  }));
  const report = await maintainAccounts(
    { rpc } as unknown as SupabaseClient<Database>,
    { owners: [owner], execute: true, limits: {} },
  );
  expect(report).toMatchObject({ passes: 1, unfinished: true });
  expect(report.reports[0]?.status.busy).toBe(true);
  expect(continueDeletion).not.toHaveBeenCalled();
});
it('enforces a single global deletion-step ceiling across approved owners', async () => {
  const rpc = vi.fn(async (_name: string, args: { p_execute: boolean }) => ({
    data: {
      ...empty,
      executed: args.p_execute,
      deletionPending: true,
      unfinished: true,
    },
    error: null,
  }));
  vi.mocked(continueDeletion).mockResolvedValue({
    state: 'deleting',
    phase: 'fenced',
    receiptId: randomUUID(),
    requestedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    retryAfter: null,
    outcome: 'in_progress',
  });
  const report = await maintainAccounts(
    { rpc } as unknown as SupabaseClient<Database>,
    {
      owners: [owner, randomUUID()],
      execute: true,
      limits: { maxPasses: 1, maxDeletionSteps: 3 },
    },
  );
  expect(report).toMatchObject({ deletionSteps: 3, unfinished: true });
  expect(continueDeletion).toHaveBeenCalledTimes(3);
});

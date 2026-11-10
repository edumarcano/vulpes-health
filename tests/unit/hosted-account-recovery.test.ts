import { createServer } from 'node:http';
import { mkdtemp, writeFile, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import {
  hostedAccountRecoveryCommand,
  hostedAccountRecoveryBinding,
} from '../../scripts/hosted-account-recovery.js';
import {
  recoveryTargetHash,
  type RecoveryTarget,
} from '../../scripts/recovery-target.js';

const userId = randomUUID();
const otherId = randomUUID();
const base = {
  version: 1,
  supabaseProjectRef: 'abcdefghijklmnopqrst',
  recoveryProjectRef: null,
  databaseRegion: 'us-east-1',
  vercelProjectId: 'prj_SyntheticRecovery',
  appOrigin: 'https://vulpes-recovery-example.vercel.app',
} as const;
const synthetic = { ...base, purpose: 'synthetic-only' } as const;
const owner: RecoveryTarget = {
  ...base,
  purpose: 'owner-pilot',
  ownerUserId: userId,
  syntheticPeerUserIds: [],
};
const invited: RecoveryTarget = {
  ...base,
  purpose: 'invited-pilot',
  ownerUserId: otherId,
  invitedUserIds: [userId],
  syntheticPeerUserIds: [],
};

function input(target: RecoveryTarget = synthetic) {
  const targetSHA256 = recoveryTargetHash(target);
  return {
    publishableKey: 'sb_publishable_synthetic_recovery',
    adminKey: 'sb_secret_synthetic_recovery',
    userId,
    password: 'Synthetic private password 123!',
    identityVerified: true,
    authorization: {
      purpose:
        target.purpose === 'synthetic-only'
          ? 'synthetic-account-recovery'
          : `${target.purpose}-account-recovery`,
      targetSHA256,
      bindingSHA256: hostedAccountRecoveryBinding(targetSHA256, userId),
      expiresAt: new Date(Date.now() + 3600_000).toISOString(),
      approved: true,
    },
  };
}

async function manifest(
  target: RecoveryTarget,
  run: (path: string) => Promise<void>,
) {
  const directory = await mkdtemp(join(tmpdir(), 'vulpes-account-recovery-'));
  const path = join(directory, 'manifest.json');
  try {
    await writeFile(
      path,
      JSON.stringify({ target, targetSHA256: recoveryTargetHash(target) }),
      { flag: 'wx' },
    );
    await run(path);
  } finally {
    await unlink(path);
    await rmdir(directory);
  }
}

type Requests = { method: string; path: string; body: unknown }[];
type Behavior = {
  email?: string;
  scope?: string;
  returnedId?: string;
  accountState?: string | null;
  resetFails?: boolean;
  revocationFails?: boolean;
  afterProfile?: () => void;
};
async function httpHarness(
  behavior: Behavior,
  run: (network: typeof fetch, requests: Requests) => Promise<void>,
) {
  const requests: Requests = [];
  const identity = {
    id: behavior.returnedId ?? userId,
    email: behavior.email ?? 'synthetic@example.invalid',
    app_metadata: { vulpes_data_scope: behavior.scope ?? 'synthetic-only' },
  };
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const raw = Buffer.concat(chunks).toString();
    requests.push({
      method: request.method!,
      path: request.url!,
      body: raw ? (JSON.parse(raw) as unknown) : null,
    });
    response.setHeader('Content-Type', 'application/json');
    response.setHeader('x-supabase-api-version', '2024-01-01');
    if (request.url?.startsWith('/auth/v1/admin/users/')) {
      if (request.method === 'PUT' && behavior.resetFails) {
        response.statusCode = 500;
        response.end(
          JSON.stringify({ code: 'unexpected_failure', msg: 'denied' }),
        );
      } else response.end(JSON.stringify({ user: identity }));
    } else if (request.url?.startsWith('/rest/v1/profiles?')) {
      response.end(
        JSON.stringify(
          behavior.accountState === null
            ? null
            : { account_state: behavior.accountState ?? 'active' },
        ),
      );
      behavior.afterProfile?.();
    } else if (request.url === '/rest/v1/rpc/revoke_account_sessions_v1') {
      response.statusCode = behavior.revocationFails ? 500 : 200;
      response.end(
        JSON.stringify(behavior.revocationFails ? { message: 'denied' } : null),
      );
    } else {
      response.statusCode = 404;
      response.end('{}');
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('No HTTP port');
    const network: typeof fetch = async (url, init) => {
      const parsed = new URL(String(url));
      expect(parsed.origin).toBe('https://abcdefghijklmnopqrst.supabase.co');
      expect(init?.redirect).toBe('error');
      expect(init?.credentials).toBe('omit');
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return fetch(
        `http://127.0.0.1:${address.port}${parsed.pathname}${parsed.search}`,
        init,
      );
    };
    await run(network, requests);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

it('keeps every plan inert and refuses incomplete or ambiguous execute flags before files, secrets or network', async () => {
  const read = vi.fn();
  const network = vi.fn();
  for (const mode of [[], ['--owner-pilot'], ['--invited-pilot']]) {
    expect(
      await hostedAccountRecoveryCommand(['--plan', ...mode], read, network),
    ).toMatchObject({ networkRequests: 0, maximumRequests: 8 });
  }
  for (const flags of [
    [],
    ['--execute', '--manifest=missing'],
    ['--allow-hosted', '--manifest=missing'],
    ['--plan', '--manifest=missing'],
    ['--plan', '--owner-pilot', '--invited-pilot'],
  ])
    await expect(
      hostedAccountRecoveryCommand(flags, read, network),
    ).rejects.toThrow();
  expect(read).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
});

it.each([
  { approved: false },
  { bindingSHA256: 'f'.repeat(64) },
  { targetSHA256: 'f'.repeat(64) },
  { purpose: 'owner-pilot-account-recovery' },
  { expiresAt: '2020-01-01T00:00:00Z' },
  { expiresAt: new Date(Date.now() + 25 * 3600_000).toISOString() },
])('rejects mismatched approval before network: %j', async (patch) => {
  await manifest(synthetic, async (path) => {
    const credentials = input();
    const network = vi.fn();
    await expect(
      hostedAccountRecoveryCommand(
        ['--execute', '--allow-hosted', `--manifest=${path}`],
        async () => ({
          ...credentials,
          authorization: { ...credentials.authorization, ...patch },
        }),
        network,
      ),
    ).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();
  });
});

it.each([
  { identityVerified: false },
  { password: 'short' },
  { unexpectedCredential: 'forbidden' },
  { adminKey: 'sb_publishable_synthetic_recovery' },
])('rejects unsafe private input before network: %j', async (patch) => {
  await manifest(synthetic, async (path) => {
    const network = vi.fn();
    await expect(
      hostedAccountRecoveryCommand(
        ['--execute', '--allow-hosted', `--manifest=${path}`],
        async () => ({ ...input(), ...patch }),
        network,
      ),
    ).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();
  });
});

it('requires explicit matching invited mode and an exact named account before credentials can mutate anything', async () => {
  await manifest(invited, async (path) => {
    const network = vi.fn();
    const read = vi.fn(async () => input(invited));
    await expect(
      hostedAccountRecoveryCommand(
        ['--execute', '--allow-hosted', `--manifest=${path}`],
        read,
        network,
      ),
    ).rejects.toThrow();
    expect(read).not.toHaveBeenCalled();
    await expect(
      hostedAccountRecoveryCommand(
        [
          '--execute',
          '--allow-hosted',
          '--invited-pilot',
          `--manifest=${path}`,
        ],
        async () => ({ ...input(invited), userId: randomUUID() }),
        network,
      ),
    ).rejects.toThrow();
    expect(network).not.toHaveBeenCalled();
  });
});

it.each([
  { email: 'person@example.com' },
  { scope: 'owner-pilot' },
  { scope: 'invited-pilot' },
  { returnedId: otherId },
])(
  'refuses a synthetic identity downgrade or wrong returned ID before any write: %j',
  async (behavior) => {
    await manifest(synthetic, async (path) => {
      await httpHarness(behavior, async (network, requests) => {
        await expect(
          hostedAccountRecoveryCommand(
            ['--execute', '--allow-hosted', `--manifest=${path}`],
            async () => input(),
            network,
          ),
        ).rejects.toThrow();
        expect(requests.map((request) => request.method)).toEqual(['GET']);
      });
    });
  },
);

it.each(['deleting', null])(
  'refuses nonactive account %j before changing a password',
  async (accountState) => {
    await manifest(synthetic, async (path) => {
      await httpHarness({ accountState }, async (network, requests) => {
        await expect(
          hostedAccountRecoveryCommand(
            ['--execute', '--allow-hosted', `--manifest=${path}`],
            async () => input(),
            network,
          ),
        ).rejects.toThrow();
        expect(requests.map((request) => request.method)).toEqual([
          'GET',
          'GET',
        ]);
      });
    });
  },
);

it('requires a declared synthetic peer to remain synthetic even in invited mode', async () => {
  const target: RecoveryTarget = {
    ...base,
    purpose: 'invited-pilot',
    ownerUserId: otherId,
    invitedUserIds: [],
    syntheticPeerUserIds: [userId],
  };
  await manifest(target, async (path) => {
    await httpHarness(
      { email: 'person@example.com' },
      async (network, requests) => {
        await expect(
          hostedAccountRecoveryCommand(
            [
              '--execute',
              '--allow-hosted',
              '--invited-pilot',
              `--manifest=${path}`,
            ],
            async () => input(target),
            network,
          ),
        ).rejects.toThrow();
        expect(requests.map((request) => request.method)).toEqual(['GET']);
      },
    );
  });
});

it.each([synthetic, owner, invited])(
  'uses the production reset/revocation service over real loopback HTTP for scope $purpose',
  async (target) => {
    await manifest(target, async (path) => {
      await httpHarness({}, async (network, requests) => {
        const credentials = input(target);
        const result = await hostedAccountRecoveryCommand(
          [
            '--execute',
            '--allow-hosted',
            `--manifest=${path}`,
            ...(target.purpose === 'synthetic-only'
              ? []
              : [`--${target.purpose}`]),
          ],
          async () => credentials,
          network,
        );
        expect(result).toMatchObject({
          state: 'credentials_reset',
          sessionsRevoked: true,
          requests: 4,
          credentialHandoffAuthorized: true,
        });
        expect(requests.map((request) => request.method)).toEqual([
          'GET',
          'GET',
          'PUT',
          'POST',
        ]);
        expect(requests[1]!.path).toContain(`user_id=eq.${userId}`);
        expect(requests[2]!.body).toEqual({
          password: credentials.password,
        });
        expect(requests[3]).toEqual({
          method: 'POST',
          path: '/rest/v1/rpc/revoke_account_sessions_v1',
          body: { p_owner: userId },
        });
        const output = JSON.stringify(result);
        for (const privateValue of [
          userId,
          credentials.password,
          credentials.adminKey,
          'synthetic@example.invalid',
        ])
          expect(output).not.toContain(privateValue);
      });
    });
  },
);

it.each([{ resetFails: true }, { revocationFails: true }])(
  'never authorizes credential handoff on an unconfirmed mutation: %j',
  async (behavior) => {
    await manifest(synthetic, async (path) => {
      await httpHarness(behavior, async (network, requests) => {
        await expect(
          hostedAccountRecoveryCommand(
            ['--execute', '--allow-hosted', `--manifest=${path}`],
            async () => input(),
            network,
          ),
        ).rejects.toThrow(/unconfirmed/);
        expect(requests.some((request) => request.method === 'PUT')).toBe(true);
        expect(requests.some((request) => request.method === 'POST')).toBe(
          !behavior.resetFails,
        );
      });
    });
  },
);

it('rechecks approval expiry before the password write rather than relying on startup approval', async () => {
  await manifest(synthetic, async (path) => {
    let now = Date.now();
    const credentials = input();
    credentials.authorization.expiresAt = new Date(now + 1000).toISOString();
    await httpHarness(
      { afterProfile: () => (now += 2000) },
      async (network, requests) => {
        await expect(
          hostedAccountRecoveryCommand(
            ['--execute', '--allow-hosted', `--manifest=${path}`],
            async () => credentials,
            network,
            () => now,
          ),
        ).rejects.toThrow();
        expect(requests.map((request) => request.method)).toEqual([
          'GET',
          'GET',
        ]);
      },
    );
  });
});

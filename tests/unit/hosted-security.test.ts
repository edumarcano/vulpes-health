import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import {
  HostedSecurityCredentialsSchema,
  hostedSecurityCommand,
  verifyHostedSecurity,
} from '../../scripts/verify-hosted-security.js';
import type { HostingTarget } from '../../scripts/hosting.js';

const target: HostingTarget = {
  version: 1,
  purpose: 'synthetic-only',
  supabaseProjectRef: 'abcdefghijklmnopqrst',
  recoveryProjectRef: null,
  databaseRegion: 'us-east-1',
  vercelProjectId: 'prj_SyntheticOnly',
  appOrigin: 'https://vulpes-synthetic.vercel.app',
};
const users = [
  {
    id: randomUUID(),
    email: 'owner@example.invalid',
    password: 'Synthetic-Secret-Only-123',
  },
  {
    id: randomUUID(),
    email: 'isolation@example.invalid',
    password: 'Synthetic-Secret-Only-456',
  },
] as const;
const credentials = {
  projectRef: target.supabaseProjectRef,
  publishableKey: 'sb_publishable_synthetic',
  users: [...users] as [(typeof users)[0], (typeof users)[1]],
};
const privateCanary = 'synthetic-private-response-canary';

function fixture(
  fault?:
    | 'foreign-profile'
    | 'anonymous-open'
    | 'revoked-live'
    | 'revoked-unauthorized'
    | 'oversize'
    | 'auth-failure'
    | 'consent'
    | 'allocation'
    | 'redirect'
    | 'network',
) {
  const revoked = new Set<number>();
  const calls: { path: string; method: string }[] = [];
  const network: typeof fetch = async (input, init) => {
    const url = new URL(String(input)),
      path = url.pathname,
      method = init?.method ?? 'GET';
    calls.push({ path, method });
    expect(init).toMatchObject({
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
    });
    const headers = new Headers(init?.headers),
      token = headers.get('Authorization'),
      index = token?.endsWith('1') ? 1 : 0;
    const user = users[index]!;
    const auth = token !== null;
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      });
    if (fault === 'network') throw new Error(privateCanary);
    if (path === '/auth/v1/token')
      return fault === 'auth-failure'
        ? json({ error: privateCanary }, 400)
        : json({
            access_token:
              'synthetic-session-token-' +
              (JSON.parse(String(init?.body)).email === users[0].email ? 0 : 1),
            user: users[
              JSON.parse(String(init?.body)).email === users[0].email ? 0 : 1
            ],
          });
    if (path === '/auth/v1/logout') {
      revoked.add(index);
      return new Response(null, { status: 204 });
    }
    if (path.startsWith('/rest/v1/')) {
      if (!auth)
        return fault === 'anonymous-open'
          ? json([{ privateCanary }])
          : json({ code: '42501' }, 401);
      const table = path.slice('/rest/v1/'.length);
      if (
        [
          'private_payloads',
          'usage_buckets',
          'usage_reservations',
          'audit_events',
          'account_deletion_receipts',
          'ai_route_cost_blocks',
          'live_verification_allocations',
          'vertex_policy_approval',
        ].includes(table)
      )
        return json({ code: '42501' }, 403);
      if (revoked.has(index)) return json([]);
      if (table !== 'profiles') return json([]);
      if (url.searchParams.has('user_id'))
        return fault === 'foreign-profile'
          ? json([{ user_id: users[1 - index]!.id, privateCanary }])
          : json([]);
      return json([{ user_id: user.id }]);
    }
    expect(headers.has('apikey')).toBe(false);
    if (revoked.has(index) && fault !== 'revoked-live')
      return json(
        {
          error: {
            code:
              fault === 'revoked-unauthorized'
                ? 'unauthorized'
                : 'session_revoked',
          },
          request_id: randomUUID(),
        },
        401,
      );
    if (fault === 'oversize')
      return new Response('x'.repeat(65537), {
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        },
      });
    if (fault === 'redirect')
      return new Response(null, {
        status: 302,
        headers: { location: 'https://unapproved.test' },
      });
    if ([...url.searchParams.values()].includes('invalid'))
      return json(
        { error: { code: 'invalid_input' }, request_id: randomUUID() },
        400,
      );
    if (path === '/api/status')
      return json({
        data: {
          status: 'ok',
          features: { settings: true, healthWorkflows: true, inference: false },
          roles: {
            everyday: 'unavailable',
            intermediate: 'unavailable',
            advanced: 'unavailable',
            decision: 'disabled',
          },
        },
      });
    if (path === '/api/settings')
      return json({
        data: {
          profile: {
            userId: user.id,
            displayName: 'Synthetic',
            timezone: 'UTC',
            units: 'metric',
            updatedAt: new Date().toISOString(),
          },
          providerConsents: ['openrouter', 'vertex_ai'].map((provider) => ({
            provider,
            accepted: fault === 'consent',
            acceptedVersion: null,
            acceptedAt: null,
            policyVersion: 'synthetic',
            acceptanceAvailable: false,
            notice: 'Synthetic',
          })),
          retention: { traceDays: 7, importStagingHours: 24 },
          budget: {
            periodStart: '2026-11-01',
            resetsAt: '2026-12-01T00:00:00Z',
            allocationUSD: fault === 'allocation' ? '1' : null,
            preferenceUSD: null,
            spentUSD: '0',
            reservedUSD: '0',
            availableUSD: null,
            state: 'unconfigured',
          },
          inferenceAvailability: { state: 'disabled', reason: 'Synthetic' },
        },
      });
    if (path === '/api/account') return json({ data: { state: 'active' } });
    if (path === '/api/data')
      return json({
        data: { items: [], nextCursor: null, dataRevision: 0, timezone: 'UTC' },
      });
    if (path === '/api/conversations')
      return json({
        data: { items: [], nextCursor: null, availability: 'unavailable' },
      });
    return json({ data: { items: [], nextCursor: null } });
  };
  return { network, calls };
}

it('requires opt-in before credential, file or network access; plan is inert', async () => {
  const read = vi.fn(),
    network = vi.fn();
  await expect(
    hostedSecurityCommand(['--manifest=missing'], read, network),
  ).rejects.toThrow();
  expect(await hostedSecurityCommand(['--plan'], read, network)).toMatchObject({
    networkRequests: 0,
    maximumRequests: 100,
  });
  expect(read).not.toHaveBeenCalled();
  expect(network).not.toHaveBeenCalled();
});
it('rejects non-synthetic identities, duplicate owners, admin extras and mismatched target before network', async () => {
  expect(
    HostedSecurityCredentialsSchema.safeParse({
      ...credentials,
      adminKey: 'private',
    }).success,
  ).toBe(false);
  expect(
    HostedSecurityCredentialsSchema.safeParse({
      ...credentials,
      users: [users[0], users[0]],
    }).success,
  ).toBe(false);
  expect(
    HostedSecurityCredentialsSchema.safeParse({
      ...credentials,
      users: [{ ...users[0], email: 'someone@example.com' }, users[1]],
    }).success,
  ).toBe(false);
  const network = vi.fn();
  await expect(
    verifyHostedSecurity(
      target,
      { ...credentials, projectRef: 'other' },
      true,
      network,
    ),
  ).rejects.toThrow();
  await expect(
    verifyHostedSecurity(target, credentials, false, network),
  ).rejects.toThrow();
  expect(network).not.toHaveBeenCalled();
});
it('keeps executed anonymous checks aligned with every generated public table', async () => {
  const text = readFileSync('server/db/database.types.ts', 'utf8').split(
    'Views:',
  )[0]!;
  const tables = [...text.matchAll(/(?:^\s*|\},)"([a-z_]+)": \{/gm)]
    .map((match) => match[1])
    .filter((name) => name !== 'public');
  expect(tables).toHaveLength(19);
  const report = await verifyHostedSecurity(
    target,
    credentials,
    true,
    fixture().network,
  );
  expect(
    report.checks
      .filter((check) => check.name.startsWith('anonymous-'))
      .map((check) => check.name.slice(10))
      .sort(),
  ).toEqual(tables.sort());
});
it('executes the bounded preflight through real HTTP, preserving empty-table gaps and only creating/revoking its own test sessions', async () => {
  const fake = fixture();
  const server = createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const requestHeaders = new Headers();
    for (const [name, value] of Object.entries(req.headers))
      if (typeof value === 'string') requestHeaders.set(name, value);
    const response = await fake.network('https://fixture.test' + req.url, {
      method: req.method ?? 'GET',
      headers: requestHeaders,
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      ...(body ? { body } : {}),
    });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing listener');
    const network: typeof fetch = (input, init) => {
      const url = new URL(String(input));
      return fetch(
        'http://127.0.0.1:' + address.port + url.pathname + url.search,
        init,
      );
    };
    const report = await verifyHostedSecurity(
      target,
      credentials,
      true,
      network,
    );
    expect(report).toMatchObject({
      status: 'passed',
      sessionCleanupConfirmed: true,
      populatedIsolation: 'pending',
      emptySamples: 20,
      providerRequests: 0,
      realDataAuthorized: false,
    });
    expect(report.requests).toBeLessThanOrEqual(100);
    expect(report.checks).toHaveLength(report.requests);
    expect(
      fake.calls
        .filter((call) => call.method !== 'GET')
        .map((call) => call.path),
    ).toEqual([
      '/auth/v1/token',
      '/auth/v1/logout',
      '/auth/v1/token',
      '/auth/v1/logout',
    ]);
    for (const user of users) {
      expect(JSON.stringify(report)).not.toContain(user.id);
      expect(JSON.stringify(report)).not.toContain(user.password);
    }
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
it.each([
  'foreign-profile',
  'anonymous-open',
  'revoked-live',
  'oversize',
  'auth-failure',
  'consent',
  'allocation',
  'redirect',
  'network',
] as const)(
  'fails closed on %s without logging credentials or response content',
  async (fault) => {
    const fake = fixture(fault);
    const report = await verifyHostedSecurity(
      target,
      credentials,
      true,
      fake.network,
    );
    expect(report.status).toBe('failed');
    expect(report.checks.at(-1)?.status).toBe('failed');
    expect(report.requests).toBeLessThanOrEqual(100);
    const text = JSON.stringify(report);
    expect(text).not.toContain(privateCanary);
    expect(text).not.toContain(users[0].password);
    expect(text).not.toContain('synthetic-session-token-');
  },
);
it('accepts Auth rejecting an ended session before the database revocation check, while still requiring HTTP 401', async () => {
  const report = await verifyHostedSecurity(
    target,
    credentials,
    true,
    fixture('revoked-unauthorized').network,
  );
  expect(report.status).toBe('passed');
  expect(
    report.checks.filter((check) =>
      check.name.startsWith('revoked-api-session-'),
    ),
  ).toHaveLength(2);
});

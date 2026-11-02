import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { z } from 'zod';
import type { Database } from '../server/db/database.types.js';
import {
  AuthenticatedStatusSchema,
  SettingsSchema,
  publicAuthConfig,
} from '../shared/auth.js';
import { AccountStatusSchema } from '../shared/account.js';
import { SourcesPageSchema } from '../shared/data.js';
import { ConversationsPageSchema } from '../shared/chat.js';
import {
  HostingTargetSchema,
  targetHash,
  supabaseOrigin,
  type HostingTarget,
} from './hosting.js';

const readableTables = [
  'profiles',
  'data_sources',
  'import_batches',
  'measurements',
  'conversations',
  'ai_runs',
  'messages',
  'goals',
  'action_proposals',
  'goal_revisions',
  'ai_steps',
] as const satisfies readonly (keyof Database['public']['Tables'])[];
const protectedTables = [
  'private_payloads',
  'usage_buckets',
  'usage_reservations',
  'audit_events',
  'account_deletion_receipts',
  'ai_route_cost_blocks',
  'live_verification_allocations',
  'vertex_policy_approval',
] as const satisfies readonly (keyof Database['public']['Tables'])[];
const identity = z.strictObject({
  id: z.uuid(),
  email: z.email().regex(/@example\.invalid$/),
  password: z.string().min(12).max(200),
});
export const HostedSecurityCredentialsSchema = z
  .strictObject({
    projectRef: z.string(),
    publishableKey: z.string().max(4096),
    users: z.tuple([identity, identity]),
  })
  .refine(
    (c) =>
      c.users[0].id !== c.users[1].id && c.users[0].email !== c.users[1].email,
    'Two distinct synthetic identities required.',
  );
type Credentials = z.infer<typeof HostedSecurityCredentialsSchema>;
const sessionSchema = z.object({
  access_token: z.string().min(20),
  user: z.object({ id: z.uuid(), email: z.email() }),
});
const errorSchema = z.object({
  error: z.object({ code: z.string() }),
  request_id: z.uuid(),
});
const ownedRows = z.array(z.object({ user_id: z.uuid() })).max(2);
const maximumRequests = 100;
export const hostedSecurityPlan = {
  scope: 'hosted-security-preflight',
  networkRequests: 0,
  maximumRequests,
  credentials:
    'stdin only: public key and two synthetic passwords; no admin, provider, database or trace keys',
  effects:
    'GET reads plus password sign-in and local sign-out of only sessions created by this invocation; normal API read-time expiry may run',
  excludes: [
    'fixture writes',
    'account export/deletion',
    'password reset',
    'maintenance',
    'backup/restore',
    'deployment',
    'provider calls',
  ],
  pending: [
    'populated table/parent-ID/write isolation',
    'browser cache/PWA races',
    'synthetic lifecycle and revoked refresh tokens',
    'hosted maintenance and fenced separate recovery',
    'backup/key/current-journal custody',
    'physical devices and formal acceptance',
  ],
};

async function boundedJson(response: Response) {
  if (!response.headers.get('content-type')?.startsWith('application/json'))
    throw new Error('Expected JSON.');
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing body.');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.length;
      if (size > 64 * 1024)
        throw new Error('Response exceeds preflight bound.');
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  } finally {
    await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

export async function verifyHostedSecurity(
  input: HostingTarget,
  credentials: Credentials,
  allowHosted: boolean,
  network: typeof fetch = fetch,
) {
  if (!allowHosted) throw new Error('Hosted approval required.');
  const target = HostingTargetSchema.parse(input),
    c = HostedSecurityCredentialsSchema.parse(credentials);
  const source = supabaseOrigin(target);
  if (
    c.projectRef !== target.supabaseProjectRef ||
    !publicAuthConfig(source, c.publishableKey)
  )
    throw new Error('Credential target mismatch.');
  const checks: { name: string; status: 'passed' | 'failed' }[] = [];
  const samples: {
    identity: number;
    table: (typeof readableTables)[number];
    rows: number;
  }[] = [];
  const sessions: { token: string; loggedOut: boolean }[] = [];
  let requests = 0,
    phase = 'start',
    cleanupConfirmed = true;
  const check = (value: unknown) => {
    if (!value) throw new Error('Preflight assertion failed.');
  };
  const request = async (
    origin: string,
    path: string,
    token?: string,
    body?: unknown,
  ) => {
    if (++requests > maximumRequests) throw new Error('Request limit.');
    return network(origin + path, {
      method: body === undefined ? 'GET' : 'POST',
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(15_000),
      headers: {
        ...(origin === source ? { apikey: c.publishableKey } : {}),
        ...(token ? { Authorization: 'Bearer ' + token } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
  };
  const test = async (name: string, run: () => Promise<void>) => {
    phase = name;
    await run();
    checks.push({ name, status: 'passed' });
  };
  const api = async (path: string, token: string, status = 200) => {
    const response = await request(target.appOrigin, path, token);
    check(
      response.status === status &&
        response.headers.get('cache-control') === 'no-store',
    );
    return boundedJson(response);
  };
  try {
    for (const table of [...readableTables, ...protectedTables])
      await test('anonymous-' + table, async () => {
        const response = await request(
          source,
          '/rest/v1/' + table + '?select=*&limit=1',
        );
        check([401, 403].includes(response.status));
        check(
          z
            .object({ code: z.literal('42501') })
            .safeParse(await boundedJson(response)).success,
        );
      });
    for (const [index, user] of c.users.entries()) {
      await test('sign-in-' + index, async () => {
        const response = await request(
          source,
          '/auth/v1/token?grant_type=password',
          undefined,
          { email: user.email, password: user.password },
        );
        check(response.status === 200);
        const session = sessionSchema.parse(await boundedJson(response));
        // Retain the just-created token for cleanup even if identity binding fails.
        sessions.push({ token: session.access_token, loggedOut: false });
        check(session.user.id === user.id && session.user.email === user.email);
      });
      const session = sessions[index]!,
        foreign = c.users[1 - index]!;
      for (const table of protectedTables)
        await test('protected-' + index + '-' + table, async () => {
          const response = await request(
            source,
            '/rest/v1/' + table + '?select=*&limit=1',
            session.token,
          );
          check(response.status === 403);
          check(
            z
              .object({ code: z.literal('42501') })
              .safeParse(await boundedJson(response)).success,
          );
        });
      for (const table of readableTables)
        await test('owned-sample-' + index + '-' + table, async () => {
          const response = await request(
            source,
            '/rest/v1/' + table + '?select=user_id&limit=2',
            session.token,
          );
          check(response.status === 200);
          const rows = ownedRows.parse(await boundedJson(response));
          check(rows.every((row) => row.user_id === user.id));
          if (table === 'profiles') check(rows.length === 1);
          samples.push({ identity: index, table, rows: rows.length });
        });
      await test('foreign-profile-' + index, async () => {
        const response = await request(
          source,
          '/rest/v1/profiles?select=user_id&user_id=eq.' + foreign.id,
          session.token,
        );
        check(response.status === 200);
        check(z.tuple([]).safeParse(await boundedJson(response)).success);
      });
      await test('status-disabled-' + index, async () => {
        const body = z
          .object({ data: AuthenticatedStatusSchema })
          .parse(await api('/api/status', session.token));
        check(
          body.data.features.inference === false &&
            body.data.roles.everyday === 'unavailable',
        );
      });
      await test('settings-disabled-owned-' + index, async () => {
        const body = z
          .object({ data: SettingsSchema })
          .parse(await api('/api/settings', session.token));
        check(
          body.data.profile.userId === user.id &&
            body.data.inferenceAvailability?.state !== 'available' &&
            body.data.inferenceAvailability !== undefined,
        );
        check(
          body.data.providerConsents.every((consent) => !consent.accepted) &&
            body.data.budget.state === 'unconfigured' &&
            body.data.budget.allocationUSD === null &&
            body.data.budget.availableUSD === null,
        );
      });
      await test('active-account-' + index, async () => {
        check(
          z
            .object({ data: AccountStatusSchema })
            .parse(await api('/api/account', session.token)).data.state ===
            'active',
        );
      });
      await test('data-sources-' + index, async () => {
        z.object({ data: SourcesPageSchema }).parse(
          await api('/api/data?view=sources', session.token),
        );
      });
      await test('conversations-disabled-' + index, async () => {
        check(
          z
            .object({ data: ConversationsPageSchema })
            .parse(await api('/api/conversations', session.token)).data
            .availability === 'unavailable',
        );
      });
      await test('goals-list-' + index, async () => {
        const body = z
          .object({
            data: z.object({
              items: z.array(z.object({ user_id: z.uuid() })),
              nextCursor: z.string().nullable(),
            }),
          })
          .parse(await api('/api/goals', session.token));
        check(body.data.items.every((row) => row.user_id === user.id));
      });
      for (const path of [
        '/api/data?view=invalid',
        '/api/conversations?view=invalid',
        '/api/goals?view=invalid',
        '/api/account?owner=invalid',
      ])
        await test(
          'invalid-query-' + index + '-' + path.slice(5, path.indexOf('?')),
          async () => {
            check(
              errorSchema.parse(await api(path, session.token, 400)).error
                .code === 'invalid_input',
            );
          },
        );
      await test('session-sign-out-' + index, async () => {
        const response = await request(
          source,
          '/auth/v1/logout?scope=local',
          session.token,
          {},
        );
        check(response.status === 204);
        await response.body?.cancel();
        session.loggedOut = true;
      });
      await test('revoked-api-session-' + index, async () => {
        check(
          ['unauthorized', 'session_revoked'].includes(
            errorSchema.parse(await api('/api/settings', session.token, 401))
              .error.code,
          ),
        );
      });
      await test('revoked-direct-profile-' + index, async () => {
        const response = await request(
          source,
          '/rest/v1/profiles?select=user_id',
          session.token,
        );
        check(response.status === 200);
        check(z.tuple([]).safeParse(await boundedJson(response)).success);
      });
    }
  } catch {
    checks.push({ name: phase, status: 'failed' });
  } finally {
    for (const session of sessions)
      if (!session.loggedOut) {
        try {
          const response = await request(
            source,
            '/auth/v1/logout?scope=local',
            session.token,
            {},
          );
          cleanupConfirmed = response.status === 204 && cleanupConfirmed;
          await response.body?.cancel();
        } catch {
          cleanupConfirmed = false;
        }
      }
  }
  return {
    scope: hostedSecurityPlan.scope,
    targetSHA256: targetHash(target),
    status:
      checks.some((item) => item.status === 'failed') || !cleanupConfirmed
        ? 'failed'
        : 'passed',
    checks,
    requests,
    maximumRequests,
    sessionCleanupConfirmed: cleanupConfirmed,
    samples,
    emptySamples: samples.filter((sample) => sample.rows === 0).length,
    populatedIsolation: 'pending',
    remainingGates: hostedSecurityPlan.pending,
    providerRequests: 0,
    realDataAuthorized: false,
  };
}

export async function hostedSecurityCommand(
  args: string[],
  readCredentials: () => Promise<unknown>,
  network: typeof fetch = fetch,
) {
  const v = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      plan: { type: 'boolean' },
      manifest: { type: 'string' },
      'allow-hosted': { type: 'boolean' },
    },
  }).values;
  if (v.plan && Object.keys(v).length === 1) return hostedSecurityPlan;
  if (!v['allow-hosted']) throw new Error('Hosted approval required.');
  if (v.plan || !v.manifest) throw new Error('Manifest required.');
  const manifest = z
    .object({ target: HostingTargetSchema, targetSHA256: z.string() })
    .parse(JSON.parse(await readFile(v.manifest, 'utf8')));
  if (manifest.targetSHA256 !== targetHash(manifest.target))
    throw new Error('Target manifest mismatch.');
  return verifyHostedSecurity(
    manifest.target,
    HostedSecurityCredentialsSchema.parse(await readCredentials()),
    true,
    network,
  );
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  hostedSecurityCommand(process.argv.slice(2), async () => {
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (Buffer.byteLength(input) > 16 * 1024)
        throw new Error('Credential input too large.');
    }
    return JSON.parse(input) as unknown;
  })
    .then((report) => {
      console.info(JSON.stringify(report, null, 2));
      if ('status' in report && report.status === 'failed')
        process.exitCode = 1;
    })
    .catch(() => {
      console.error(
        'Hosted security preflight refused or failed. Check approval, target manifest and synthetic stdin credentials; private responses and credentials are omitted.',
      );
      process.exitCode = 1;
    });
}

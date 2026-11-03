import { parseArgs } from 'node:util';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '../server/db/database.types.js';
import { publicAuthConfig } from '../shared/auth.js';
import { DeletionPhaseSchema } from '../shared/account.js';
import {
  maintainAccounts,
  MaintenanceLimitsSchema,
} from '../server/services/maintenance.js';
import {
  RecoveryTargetSchema,
  recoveryTargetHash,
  checkRecoveryMode,
  recoveryPurpose,
} from './recovery-target.js';

export const HostedMaintenanceInputSchema = z.strictObject({
  publishableKey: z.string().max(4096),
  adminKey: z.string().max(4096),
  authorization: z.strictObject({
    purpose: z.enum(['synthetic-maintenance', 'owner-pilot-maintenance']),
    mode: z.enum(['inspect', 'execute']),
    targetSHA256: z.string().regex(/^[a-f0-9]{64}$/),
    owners: z
      .array(z.uuid())
      .min(1)
      .max(10)
      .refine(
        (ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length,
      ),
    expiresAt: z.iso.datetime(),
    approved: z.literal(true),
  }),
  limits: MaintenanceLimitsSchema,
});
export const hostedMaintenancePlan = {
  scope: 'owned_database_maintenance',
  networkRequests: 0,
  requiresApproval: true,
  defaultMode: 'inspect',
  migration: '20261101000100_owned_maintenance.sql',
  maximumOwners: 10,
  maximumPassesPerOwner: 5,
  maximumRowsPerCategoryPerPass: 100,
  maximumDeletionSteps: 20,
  effects:
    'Execute removes only eligible data of explicitly approved owners, reconciles stale runs conservatively, and resumes only existing deletion requests. Database time owns retention.',
  excludes: [
    'provider calls',
    'new deletion requests',
    'password resets',
    'budget changes',
    'deployment',
    'scheduler',
    'remote export temp files',
    'backups/journal rotation',
  ],
};

export async function hostedMaintenanceCommand(
  args: string[],
  readCredentials: () => Promise<unknown>,
  network: typeof fetch = fetch,
  now = Date.now(),
) {
  const v = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      plan: { type: 'boolean' },
      inspect: { type: 'boolean' },
      execute: { type: 'boolean' },
      manifest: { type: 'string' },
      'allow-hosted': { type: 'boolean' },
      'owner-pilot': { type: 'boolean' },
    },
  }).values;
  if (
    v.plan &&
    Object.keys(v).every((k) => ['plan', 'owner-pilot'].includes(k))
  )
    return v['owner-pilot']
      ? {
          ...hostedMaintenancePlan,
          scope: 'named_owner_pilot_database_maintenance',
          maximumOwners: 1,
        }
      : hostedMaintenancePlan;
  if (!v['allow-hosted'] || v.plan || (v.inspect && v.execute) || !v.manifest)
    throw new Error('Explicit hosted mode/manifest required.');
  const mode = v.execute ? 'execute' : 'inspect';
  const manifest = z
    .object({ target: RecoveryTargetSchema, targetSHA256: z.string() })
    .parse(JSON.parse(await readFile(v.manifest, 'utf8')));
  checkRecoveryMode(manifest.target, v['owner-pilot'] ?? false);
  if (manifest.targetSHA256 !== recoveryTargetHash(manifest.target))
    throw new Error('Invalid manifest binding.');
  const input = HostedMaintenanceInputSchema.parse(await readCredentials()),
    authorization = input.authorization,
    source = `https://${manifest.target.supabaseProjectRef}.supabase.co`;
  if (
    authorization.purpose !==
      recoveryPurpose(
        manifest.target,
        'synthetic-maintenance',
        'owner-pilot-maintenance',
      ) ||
    (manifest.target.purpose === 'owner-pilot' &&
      (authorization.owners.length !== 1 ||
        authorization.owners[0] !== manifest.target.ownerUserId))
  )
    throw new Error('Explicit owner maintenance scope required.');
  const expiry = Date.parse(authorization.expiresAt);
  if (
    authorization.targetSHA256 !== manifest.targetSHA256 ||
    authorization.mode !== mode ||
    expiry <= now ||
    expiry > now + 24 * 3600_000
  )
    throw new Error('Approval binding/expiry mismatch.');
  if (
    !publicAuthConfig(source, input.publishableKey) ||
    input.adminKey === input.publishableKey
  )
    throw new Error('Invalid credentials.');
  if (!/^sb_secret_[\w-]+$/.test(input.adminKey)) {
    const parts = input.adminKey.split('.');
    if (
      parts.length !== 3 ||
      JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()).role !==
        'service_role'
    )
      throw new Error('Invalid administrative key.');
  }
  let requests = 0;
  const send: typeof fetch = (url, init) => {
    if (
      new URL(
        typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
      ).origin !== source ||
      requests >= 400
    )
      throw new Error('Network bound.');
    requests++;
    return network(url, {
      ...init,
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.any([
        AbortSignal.timeout(25_000),
        ...(init?.signal ? [init.signal] : []),
      ]),
    });
  };
  const admin = createClient<Database>(source, input.adminKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: send },
  });
  // Validate the entire allowlist before any execute request; never select all users.
  for (const owner of authorization.owners) {
    const identity = await admin.auth.admin.getUserById(owner);
    if (identity.error?.code === 'user_not_found' && !identity.data.user) {
      const journal = await admin
        .from('account_deletion_receipts')
        .select('user_id,phase')
        .eq('user_id', owner)
        .single();
      if (
        journal.error ||
        journal.data?.user_id !== owner ||
        !DeletionPhaseSchema.safeParse(journal.data.phase).success
      )
        throw new Error('Missing synthetic identity/deletion receipt.');
    } else if (
      identity.error ||
      identity.data.user?.id !== owner ||
      (manifest.target.purpose === 'synthetic-only' &&
        (!identity.data.user.email?.endsWith('@example.invalid') ||
          identity.data.user.app_metadata?.vulpes_data_scope === 'owner-pilot'))
    )
      throw new Error('Approved identity required.');
  }
  const report = await maintainAccounts(admin, {
    owners: authorization.owners,
    execute: mode === 'execute',
    limits: input.limits,
  });
  return {
    ...report,
    targetSHA256: manifest.targetSHA256,
    requests,
    maximumRequests: 400,
  };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  hostedMaintenanceCommand(process.argv.slice(2), async () => {
    let raw = '';
    for await (const chunk of process.stdin) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 16 * 1024) throw new Error('Input bound.');
    }
    return JSON.parse(raw) as unknown;
  })
    .then((report) => console.info(JSON.stringify(report, null, 2)))
    .catch(() => {
      console.error(
        'Hosted maintenance refused or failed. Check explicit approval, target/account binding, required migration and private stdin configuration; no credentials or database content are logged.',
      );
      process.exitCode = 1;
    });
}

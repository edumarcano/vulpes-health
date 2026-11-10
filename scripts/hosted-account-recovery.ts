import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '../server/db/database.types.js';
import { recoverAccount } from '../server/security/account-recovery.js';
import { publicAuthConfig } from '../shared/auth.js';
import {
  RecoveryTargetSchema,
  checkRecoveryMode,
  recoveryAccountIds,
  recoveryTargetHash,
  recoveryPurpose,
  isSyntheticRecoveryIdentity,
} from './recovery-target.js';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const HostedAccountRecoveryInputSchema = z.strictObject({
  publishableKey: z.string().min(1).max(4096),
  adminKey: z.string().min(1).max(4096),
  userId: z.uuid().transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(200),
  identityVerified: z.literal(true),
  authorization: z.strictObject({
    purpose: z.enum([
      'synthetic-account-recovery',
      'owner-pilot-account-recovery',
      'family-pilot-account-recovery',
    ]),
    targetSHA256: hash,
    bindingSHA256: hash,
    expiresAt: z.iso.datetime(),
    approved: z.literal(true),
  }),
});

export const hostedAccountRecoveryBinding = (
  targetSHA256: string,
  userId: string,
) =>
  createHash('sha256')
    .update(
      JSON.stringify({
        action: 'password-reset-and-session-revocation',
        targetSHA256: hash.parse(targetSHA256),
        userId: z.uuid().parse(userId).toLowerCase(),
      }),
    )
    .digest('hex');

export const hostedAccountRecoveryPlan = {
  scope: 'explicit_account_password_recovery',
  networkRequests: 0,
  maximumRequests: 8,
  maximumDurationSeconds: 60,
  requires:
    'Exact target/account/action approval, out-of-band identity verification and private stdin credentials. Handoff only after password reset and session revocation both succeed.',
  effects:
    'Resets one active provisioned account password and revokes that account session/refresh records through the existing recovery service.',
  excludes: [
    'account discovery',
    'account provisioning',
    'public administrative API',
    'email delivery',
    'provider calls',
    'budget changes',
    'deletion initiation',
  ],
};

export async function hostedAccountRecoveryCommand(
  args: string[],
  readCredentials: () => Promise<unknown>,
  network: typeof fetch = fetch,
  clock: () => number = Date.now,
) {
  const flags = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      plan: { type: 'boolean' },
      execute: { type: 'boolean' },
      'allow-hosted': { type: 'boolean' },
      'owner-pilot': { type: 'boolean' },
      'family-pilot': { type: 'boolean' },
      manifest: { type: 'string' },
    },
  }).values;
  if (flags['owner-pilot'] && flags['family-pilot'])
    throw new Error('Select exactly one account scope.');
  if (
    flags.plan &&
    Object.keys(flags).every((key) =>
      ['plan', 'owner-pilot', 'family-pilot'].includes(key),
    )
  )
    return {
      ...hostedAccountRecoveryPlan,
      mode: flags['family-pilot']
        ? 'family-pilot'
        : flags['owner-pilot']
          ? 'owner-pilot'
          : 'synthetic-only',
    };
  if (flags.plan || !flags.execute || !flags['allow-hosted'] || !flags.manifest)
    throw new Error('Explicit hosted recovery mode and manifest required.');
  const rawManifest = await readFile(flags.manifest, 'utf8');
  if (Buffer.byteLength(rawManifest) > 64 * 1024)
    throw new Error('Manifest size bound.');
  const manifest = z
    .strictObject({ target: RecoveryTargetSchema, targetSHA256: hash })
    .parse(JSON.parse(rawManifest));
  checkRecoveryMode(
    manifest.target,
    flags['owner-pilot'] ?? false,
    flags['family-pilot'] ?? false,
  );
  if (manifest.targetSHA256 !== recoveryTargetHash(manifest.target))
    throw new Error('Invalid recovery target binding.');
  const input = HostedAccountRecoveryInputSchema.parse(await readCredentials());
  const target = manifest.target;
  const allowed = recoveryAccountIds(target);
  if (allowed && !allowed.includes(input.userId))
    throw new Error('Account is outside the approved manifest.');
  const started = clock();
  const authorize = () => {
    const current = clock();
    const expiry = Date.parse(input.authorization.expiresAt);
    if (
      input.authorization.purpose !==
        recoveryPurpose(
          target,
          'synthetic-account-recovery',
          'owner-pilot-account-recovery',
        ) ||
      input.authorization.targetSHA256 !== manifest.targetSHA256 ||
      input.authorization.bindingSHA256 !==
        hostedAccountRecoveryBinding(manifest.targetSHA256, input.userId) ||
      expiry <= current ||
      expiry > started + 24 * 3600_000 ||
      current - started >= 60_000
    )
      throw new Error(
        'Recovery approval binding, expiry or duration mismatch.',
      );
  };
  authorize();
  const source = `https://${target.supabaseProjectRef}.supabase.co`;
  if (
    !publicAuthConfig(source, input.publishableKey) ||
    input.adminKey === input.publishableKey
  )
    throw new Error('Invalid recovery credentials.');
  if (!/^sb_secret_[\w-]+$/.test(input.adminKey)) {
    const parts = input.adminKey.split('.');
    if (
      parts.length !== 3 ||
      JSON.parse(Buffer.from(parts[1]!, 'base64url').toString()).role !==
        'service_role'
    )
      throw new Error('Administrative recovery key required.');
  }
  let requests = 0;
  const deadline = AbortSignal.timeout(60_000);
  const send: typeof fetch = (url, init) => {
    authorize();
    const parsed = new URL(
      typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
    );
    if (parsed.origin !== source || requests >= 8)
      throw new Error('Recovery network bound.');
    requests++;
    return network(url, {
      ...init,
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.any([
        deadline,
        AbortSignal.timeout(10_000),
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
  const identity = await admin.auth.admin.getUserById(input.userId);
  const syntheticRequired =
    target.purpose === 'synthetic-only' ||
    target.syntheticPeerUserIds.includes(input.userId);
  if (
    identity.error ||
    identity.data.user?.id !== input.userId ||
    (syntheticRequired && !isSyntheticRecoveryIdentity(identity.data.user))
  )
    throw new Error('Approved recovery identity required.');
  try {
    const result = await recoverAccount(admin, {
      userId: input.userId,
      password: input.password,
      identityVerified: input.identityVerified,
    });
    return {
      ...result,
      targetSHA256: manifest.targetSHA256,
      requests,
      credentialHandoffAuthorized: true,
    };
  } finally {
    input.password = '';
    input.adminKey = '';
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  hostedAccountRecoveryCommand(process.argv.slice(2), async () => {
    let raw = '';
    for await (const chunk of process.stdin) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 16 * 1024)
        throw new Error('Private input size bound.');
    }
    return JSON.parse(raw) as unknown;
  })
    .then((report) => console.info(JSON.stringify(report, null, 2)))
    .catch(() => {
      console.error(
        'Hosted account recovery refused or is unconfirmed. Check the exact target/account approval and private input. Do not hand off credentials until both reset and session revocation are confirmed.',
      );
      process.exitCode = 1;
    });
}

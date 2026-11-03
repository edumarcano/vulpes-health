import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Decimal } from 'decimal.js';
import { localStatus } from './local-database.js';
import { LocalSupabase } from '../tests/helpers/local-supabase.js';
import { UUIDSchema } from '../shared/primitives.js';
import { PreviewCsvSchema } from '../shared/imports.js';
import { verifySession, type AuthContext } from '../server/auth/session.js';
import { administrativeClient } from '../server/db/administrative.js';
import { readEncryptionKeys } from '../server/security/encryption.js';
import { previewCsv, commitImport } from '../server/services/imports.js';
import {
  verificationFixtures,
  type VerificationFixture,
} from '../server/ai/verification-fixture.js';

// Caller must perform the live opt-in and static preflight before invoking this.
// The allocation ID is explicitly supplied and is never replaced automatically.
export async function prepareSyntheticBatch(
  batchId: string,
  ceiling: string,
  fixture: VerificationFixture = 'scale',
): Promise<{ context: AuthContext; fixtureHash: string }> {
  UUIDSchema.parse(batchId);
  if (!new Decimal(ceiling).isPositive())
    throw new Error('invalid_spend_limit');
  const local = localStatus();
  process.env.VITE_SUPABASE_URL = local.apiUrl;
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = local.anonKey;
  process.env.SUPABASE_SERVICE_ROLE_KEY = local.adminKey;
  readEncryptionKeys();
  const db = administrativeClient();
  const helper = new LocalSupabase();
  const period = new Date().toISOString().slice(0, 7) + '-01';
  const selected = verificationFixtures[fixture];
  if (!selected) throw new Error('verification_fixture_invalid');
  const csv =
    selected.csv ??
    (
      await readFile(
        new URL(
          '../docs/spec/v0.1.0/fixtures/measurements-synthetic.csv',
          import.meta.url,
        ),
        'utf8',
      )
    ).replaceAll('\r\n', '\n');
  const displayName = selected.displayLabel;
  const fixtureHash =
    fixture === 'injection'
      ? createHash('sha256')
          .update(
            createHash('sha256').update(csv).digest('hex') +
              'source-injection-v1',
          )
          .digest('hex')
      : fixture === 'empty'
        ? selected.hash
        : createHash('sha256').update(csv).digest('hex');
  if (fixtureHash !== selected.hash)
    throw new Error('verification_fixture_invalid');
  const app = await db
    .from('usage_buckets')
    .select('id')
    .eq('scope', 'app')
    .eq('period_start', period)
    .maybeSingle();
  if (app.error || !app.data)
    throw new Error('verification_app_budget_unconfigured');
  const existing = await db
    .from('live_verification_allocations')
    .select('*,ceiling_text:ceiling_usd::text')
    .eq('id', batchId)
    .maybeSingle();
  if (existing.error) throw new Error('verification_allocation_unavailable');
  let context: AuthContext;
  if (existing.data) {
    const row = existing.data;
    if (
      row.period_start !== period ||
      row.fixture_hash !== fixtureHash ||
      !new Decimal(row.ceiling_text).equals(ceiling)
    )
      throw new Error('verification_allocation_mismatch');
    const user = await db.auth.admin.getUserById(row.user_id);
    if (
      user.error ||
      !/^pr03-[0-9a-f-]{36}@example\.test$/.test(user.data.user?.email ?? '')
    )
      throw new Error('verification_account_unavailable');
    const password = randomBytes(32).toString('base64url');
    const changed = await db.auth.admin.updateUserById(row.user_id, {
      password,
    });
    if (changed.error) throw new Error('verification_account_unavailable');
    const login = await helper.request(
      '/auth/v1/token?grant_type=password',
      'anon',
      {
        method: 'POST',
        body: JSON.stringify({ email: user.data.user.email, password }),
      },
    );
    if (!login.ok) throw new Error('verification_account_unavailable');
    const session = (await login.json()) as { access_token?: unknown };
    if (typeof session.access_token !== 'string')
      throw new Error('verification_account_unavailable');
    context = await verifySession({
      headers: { authorization: `Bearer ${session.access_token}` },
    });
    if (context.userId !== row.user_id)
      throw new Error('verification_account_unavailable');
  } else {
    let registered = false;
    try {
      const user = await helper.createUser();
      await helper.admin('/rest/v1/profiles', 'POST', {
        user_id: user.id,
        display_name: 'Synthetic verification',
        consent_versions: {
          openrouter: {
            accepted_version: 'openrouter_zdr_v2',
            accepted_at: new Date().toISOString(),
          },
        },
      });
      const bucket = randomUUID();
      await helper.admin('/rest/v1/usage_buckets', 'POST', {
        id: bucket,
        user_id: user.id,
        scope: 'account',
        period_start: period,
        allocated_ceiling_usd: ceiling,
      });
      context = await verifySession({
        headers: { authorization: `Bearer ${user.token}` },
      });
      let revision = 0;
      if (selected.rows > 0) {
        const preview = await previewCsv(
          context,
          PreviewCsvSchema.parse({
            action: 'preview_csv',
            client_request_id: randomUUID(),
            csv,
            source: {
              kind: 'new',
              label: displayName,
              origin_app: null,
              device_label: null,
            },
            mapping: {
              schema_version: 1,
              format: 'canonical',
              timezone: 'UTC',
              profile: null,
              single_profile: true,
              review_requested: false,
              source_label: selected.sourceLabel,
            },
          }),
        );
        const imported = await commitImport(context, {
          action: 'commit_import',
          client_request_id: randomUUID(),
          batch_id: preview.batch_id,
          payload_hash: preview.payload_hash,
        });
        if (imported.inserted !== selected.rows || imported.conflict !== 0)
          throw new Error('verification_fixture_invalid');
        revision = imported.dataRevision;
      }
      await helper.admin('/rest/v1/live_verification_allocations', 'POST', {
        id: batchId,
        user_id: user.id,
        account_bucket_id: bucket,
        period_start: period,
        ceiling_usd: ceiling,
        data_revision: revision,
        fixture_hash: fixtureHash,
      });
      registered = true;
    } catch (error) {
      if (!registered) await helper.cleanup();
      throw error;
    }
  }
  const [sources, measurements, goals, profile, allocation] = await Promise.all(
    [
      context.db
        .from('data_sources')
        .select('id,label')
        .eq('user_id', context.userId),
      context.db
        .from('measurements')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', context.userId),
      context.db
        .from('goals')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', context.userId),
      context.db
        .from('profiles')
        .select('data_revision,display_name')
        .eq('user_id', context.userId)
        .single(),
      db
        .from('live_verification_allocations')
        .select('data_revision')
        .eq('id', batchId)
        .eq('user_id', context.userId)
        .single(),
    ],
  );
  if (
    sources.error ||
    measurements.error ||
    goals.error ||
    profile.error ||
    allocation.error ||
    profile.data.display_name !== 'Synthetic verification' ||
    profile.data.data_revision !== allocation.data.data_revision ||
    sources.data.length !== selected.sources ||
    (selected.sources > 0 && sources.data[0]?.label !== displayName) ||
    measurements.count !== selected.rows ||
    goals.count !== 0
  )
    throw new Error('verification_fixture_invalid');
  return { context, fixtureHash };
}

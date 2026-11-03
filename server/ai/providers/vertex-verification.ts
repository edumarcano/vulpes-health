import { assessVertex, vertexEvidence } from '../vertex-readiness.js';
import { vertexEndpoint } from './vertex.js';
import { vertexAuthentication } from './vertex-auth.js';
import { Decimal } from 'decimal.js';
import { UUIDSchema } from '../../../shared/primitives.js';
import type { AuthContext } from '../../auth/session.js';
import { administrativeClient } from '../../db/administrative.js';
import { verificationFixtureHash } from '../verification-fixture.js';
import type { RequestTransport } from '../ledger/dispatcher.js';

const issued = new WeakSet<object>();
export function isVertexVerificationTransport(value: object): boolean {
  return issued.has(value);
}

// The only live transport is issued after the static model/price/privacy checks
// and a service-owned local synthetic allocation have been checked. The
// dispatcher still authorizes and captures every individual request.
export async function issueVertexVerificationTransport(
  role: 'intermediate' | 'advanced',
  context: AuthContext,
  batchId: string,
  ceiling: string,
  fixtureHash: string,
  allowSpend: boolean,
  env: NodeJS.ProcessEnv = process.env,
  send: typeof fetch = fetch,
): Promise<RequestTransport> {
  if (!allowSpend) throw new Error('live_opt_in_required');
  UUIDSchema.parse(batchId);
  const readiness = assessVertex(role, {
    enabled: env.VULPES_LIVE_AI_ENABLED === 'true',
    project: env.GOOGLE_CLOUD_PROJECT,
    location: env.GOOGLE_CLOUD_LOCATION,
    ceiling,
    evidence: vertexEvidence[role],
  });
  if (readiness.state !== 'ready') throw new Error(readiness.reason);
  const endpoint = vertexEndpoint(
    readiness.evidence.project,
    readiness.evidence.location,
    role,
  );
  if (
    env.VITE_SUPABASE_URL !== 'http://127.0.0.1:54321' ||
    process.env.VITE_SUPABASE_URL !== 'http://127.0.0.1:54321'
  )
    throw new Error('verification_requires_local_database');
  const db = administrativeClient();
  const allocation = await db
    .from('live_verification_allocations')
    .select('*,ceiling_text:ceiling_usd::text')
    .eq('id', batchId)
    .eq('user_id', context.userId)
    .maybeSingle();
  if (allocation.error || !allocation.data)
    throw new Error('verification_allocation_unavailable');
  const row = allocation.data;
  const [profile, bucket, user] = await Promise.all([
    context.db
      .from('profiles')
      .select('account_state,display_name,data_revision,consent_versions')
      .eq('user_id', context.userId)
      .single(),
    db
      .from('usage_buckets')
      .select('id,user_id,scope,period_start')
      .eq('id', row.account_bucket_id)
      .single(),
    db.auth.admin.getUserById(context.userId),
  ]);
  if (
    profile.error ||
    bucket.error ||
    user.error ||
    !/^pr03-[0-9a-f-]{36}@example\.test$/.test(user.data.user?.email ?? '') ||
    profile.data.account_state !== 'active' ||
    profile.data.display_name !== 'Synthetic verification' ||
    profile.data.data_revision !== row.data_revision ||
    row.fixture_hash !== fixtureHash ||
    fixtureHash !== verificationFixtureHash ||
    bucket.data.user_id !== context.userId ||
    bucket.data.scope !== 'account' ||
    bucket.data.period_start !== row.period_start ||
    row.period_start !== new Date().toISOString().slice(0, 7) + '-01' ||
    !new Decimal(row.ceiling_text).equals(ceiling)
  )
    throw new Error('verification_allocation_mismatch');
  const consent = profile.data.consent_versions;
  if (
    !consent ||
    typeof consent !== 'object' ||
    Array.isArray(consent) ||
    !('vertex_ai' in consent) ||
    !consent.vertex_ai ||
    typeof consent.vertex_ai !== 'object' ||
    Array.isArray(consent.vertex_ai) ||
    consent.vertex_ai.accepted_version !== readiness.evidence.policyVersion ||
    typeof consent.vertex_ai.accepted_at !== 'string'
  )
    throw new Error('verification_consent_missing');
  const approval = await db
    .from('vertex_policy_approval')
    .select('*')
    .eq('id', true)
    .single();
  if (
    approval.error ||
    approval.data.project !== readiness.evidence.project ||
    approval.data.location !== readiness.evidence.location ||
    approval.data.policy_version !== readiness.evidence.policyVersion ||
    approval.data.privacy_fingerprint !== readiness.evidence.privacyFingerprint
  )
    throw new Error('vertex_policy_unavailable');
  const token = vertexAuthentication();
  const transport: RequestTransport = {
    mode: 'verification',
    async *send(body, signal) {
      const accessToken = await token();
      const current = await db
        .from('vertex_policy_approval')
        .select('*')
        .eq('id', true)
        .abortSignal(signal)
        .single();
      if (
        current.error ||
        current.data.project !== approval.data.project ||
        current.data.location !== approval.data.location ||
        current.data.policy_version !== approval.data.policy_version ||
        current.data.privacy_fingerprint !==
          approval.data.privacy_fingerprint ||
        current.data.notice !== approval.data.notice
      )
        throw new Error('vertex_policy_unavailable');
      const response = await send(endpoint, {
        method: 'POST',
        redirect: 'error',
        cache: 'no-store',
        signal,
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
        },
        body: Buffer.from(body),
      });
      if (
        !response.ok ||
        !response.body ||
        !response.headers
          .get('content-type')
          ?.toLowerCase()
          .startsWith('text/event-stream')
      )
        throw new Error('provider_response_unavailable');
      for await (const chunk of response.body) yield chunk;
    },
  };
  issued.add(transport);
  return Object.freeze(transport);
}

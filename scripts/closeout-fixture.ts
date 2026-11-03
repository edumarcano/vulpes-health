import { createHash, randomUUID } from 'node:crypto';
import {
  encryptBytes,
  type EncryptionKeys,
} from '../server/security/encryption.js';

// Trusted, explicitly labelled synthetic isolation rows. Hosted creation needs
// separate fixture approval; no dispatcher is invoked or enabled here.
export const closeoutAccountCeilingUSD = '0.000001';
export function closeoutFixture(
  owner: string,
  index: number,
  keys: EncryptionKeys,
  now = Date.now(),
) {
  const ids = {
    source: randomUUID(),
    reading: randomUUID(),
    conversation: randomUUID(),
    run: randomUUID(),
    step: randomUUID(),
    bucket: randomUUID(),
    allocation: randomUUID(),
    message: randomUUID(),
  };
  const marker = 'Synthetic closeout ' + index,
    body = Buffer.from(
      JSON.stringify({ synthetic: true, marker, providerRequests: 0 }),
    ),
    digest = createHash('sha256').update(body).digest('hex');
  const payload = encryptBytes(
    {
      id: randomUUID(),
      user_id: owner,
      purpose: 'ai_request',
      expires_at: new Date(now + 86400000).toISOString(),
    },
    body,
    keys,
  );
  const start = new Date(now);
  start.setUTCHours(0, 0, 0, 0);
  const to = start.toISOString();
  start.setUTCDate(start.getUTCDate() - 1);
  const from = start.toISOString(),
    period = new Date(now).toISOString().slice(0, 7) + '-01';
  const rows: { table: string; row: Record<string, unknown> }[] = [
    {
      table: 'profiles',
      row: {
        user_id: owner,
        display_name: 'Synthetic verification',
        timezone: 'UTC',
        units: 'metric',
      },
    },
    {
      table: 'data_sources',
      row: {
        id: ids.source,
        user_id: owner,
        kind: 'manual',
        label: marker,
        source_namespace: 'closeout-' + ids.source,
        measurement_method: 'user_reported',
      },
    },
    {
      table: 'measurements',
      row: {
        id: ids.reading,
        user_id: owner,
        source_id: ids.source,
        metric_key: 'weight',
        canonical_value: '70',
        canonical_unit: 'kg',
        original_value: '70',
        original_unit: 'kg',
        observed_at: new Date(start.getTime() + 12 * 3600000).toISOString(),
        original_offset_minutes: 0,
        timezone: 'UTC',
        granularity: 'instant',
        measurement_method: 'user_reported',
        fingerprint: digest,
      },
    },
    {
      table: 'usage_buckets',
      row: {
        id: ids.bucket,
        user_id: owner,
        scope: 'account',
        period_start: period,
        allocated_ceiling_usd: closeoutAccountCeilingUSD,
      },
    },
    {
      table: 'live_verification_allocations',
      row: {
        id: ids.allocation,
        user_id: owner,
        account_bucket_id: ids.bucket,
        period_start: period,
        ceiling_usd: closeoutAccountCeilingUSD,
        data_revision: 0,
        fixture_hash: digest,
      },
    },
    {
      table: 'conversations',
      row: { id: ids.conversation, user_id: owner, title: marker },
    },
    {
      table: 'private_payloads',
      row: { ...payload, created_at: new Date(now).toISOString() },
    },
    {
      table: 'ai_runs',
      row: {
        id: ids.run,
        user_id: owner,
        conversation_id: ids.conversation,
        client_request_id: randomUUID(),
        request_hash: digest,
        requested_depth: 'everyday',
        policy_version: 'synthetic-closeout-no-dispatch',
        status: 'failed',
        finished_at: new Date(now).toISOString(),
        trace_state: 'available',
        cost_usd: 0,
        cost_status: 'reported',
        data_revision: 0,
      },
    },
    {
      table: 'ai_steps',
      row: {
        id: ids.step,
        user_id: owner,
        run_id: ids.run,
        sequence: 1,
        step_type: 'generation',
        status: 'failed',
        adapter_version: 'synthetic-no-dispatch',
        input_payload_id: payload.id,
        request_body_hash: digest,
        finished_at: new Date(now).toISOString(),
        cost_usd: 0,
        cost_status: 'reported',
        finish_reason: 'synthetic_not_sent',
      },
    },
    {
      table: 'messages',
      row: {
        id: ids.message,
        user_id: owner,
        conversation_id: ids.conversation,
        run_id: ids.run,
        role: 'user',
        content_parts: [
          {
            type: 'text',
            text: marker + '; trusted security fixture, no provider request',
          },
        ],
        status: 'completed',
      },
    },
  ];
  return {
    owner,
    index,
    ids,
    marker,
    inputBase64: body.toString('base64'),
    from,
    to,
    rows,
  };
}
export type CloseoutFixture = ReturnType<typeof closeoutFixture>;

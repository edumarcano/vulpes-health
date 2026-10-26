import { randomUUID } from 'node:crypto';

export const databaseTables = [
  'profiles', 'data_sources', 'private_payloads', 'import_batches', 'measurements',
  'conversations', 'ai_runs', 'messages', 'goals', 'action_proposals', 'goal_revisions',
  'ai_steps', 'usage_buckets', 'usage_reservations', 'audit_events',
] as const;
export type DatabaseTable = typeof databaseTables[number];
export const protectedTables: readonly DatabaseTable[] = ['private_payloads', 'usage_buckets', 'usage_reservations', 'audit_events'];
export const readableTables = databaseTables.filter((table) => !protectedTables.includes(table));

// No production seed: each test creates its own disposable, explicitly synthetic graph.
export function databaseGraph(userId: string, appId: string, period = '2026-10-01') {
  const ids = Object.fromEntries(databaseTables.map((table) => [table, randomUUID()])) as Record<DatabaseTable, string>;
  const hash = 'a'.repeat(64);
  const expiresAt = new Date(Date.now() + 3_600_000).toISOString();
  const payload = {
    schemaVersion: 1, title: 'Synthetic target', metric: 'weight', unit: 'kg', sourceId: ids.data_sources,
    target: { direction: 'decrease_to', value: 69 }, baselineMethod: 'daily_median_mean_7d',
    baselineFrom: null, baselineTo: null, reportedBaseline: null, timezone: 'UTC', targetDate: null,
    constraints: [], proposedStrategy: null,
  };
  const rows: Record<DatabaseTable, Record<string, unknown>> = {
    profiles: { user_id: userId, display_name: 'Synthetic user' },
    data_sources: { kind: 'manual', label: 'Synthetic scale', source_namespace: 'synthetic-scale', measurement_method: 'user_reported' },
    private_payloads: { purpose: 'ai_request', encrypted_bytes: `\\x${'00'.repeat(16)}`, nonce: `\\x${'00'.repeat(12)}`, key_id: 'synthetic-envelope-not-real-encryption', content_hash: hash, encoding: 'identity', expires_at: expiresAt },
    import_batches: { source_id: ids.data_sources, file_hash: hash, mapping_hash: hash, payload_hash: hash, observation_count: 1, new_count: 1, staging_payload_id: ids.private_payloads },
    measurements: { source_id: ids.data_sources, import_batch_id: ids.import_batches, metric_key: 'weight', canonical_value: 70, canonical_unit: 'kg', original_value: '70', original_unit: 'kg', observed_at: '2026-10-01T12:00:00Z', original_offset_minutes: 0, timezone: 'UTC', granularity: 'instant', fingerprint: hash },
    conversations: { title: 'Synthetic conversation' },
    ai_runs: { conversation_id: ids.conversations, client_request_id: randomUUID(), request_hash: hash, requested_depth: 'everyday', policy_version: 'synthetic-v1' },
    messages: { conversation_id: ids.conversations, run_id: ids.ai_runs, role: 'user', content_parts: [{ type: 'text', text: 'Synthetic fixture only' }], status: 'completed' },
    goals: { title: 'Synthetic draft', metric_key: 'weight', canonical_unit: 'kg', direction: 'decrease_to', target_value: 69, source_id: ids.data_sources },
    action_proposals: { kind: 'goal.revise', target_id: ids.goals, target_version: 1, canonical_payload: payload, payload_hash: hash, state: 'approved', summary: 'Synthetic proposal', source_run_id: ids.ai_runs, expires_at: expiresAt },
    goal_revisions: { goal_id: ids.goals, revision_number: 1, approved_proposal_id: ids.action_proposals, payload },
    ai_steps: { run_id: ids.ai_runs, sequence: 1, step_type: 'generation', status: 'started', input_payload_id: ids.private_payloads, output_payload_id: ids.private_payloads },
    usage_buckets: { scope: 'account', period_start: period, allocated_ceiling_usd: '10.00', lower_preference_usd: '5.00', reserved_usd:'0.10' },
    usage_reservations: { run_id: ids.ai_runs, step_id: ids.ai_steps, account_bucket_id: ids.usage_buckets, app_bucket_id: appId, period_start: period, amount_usd: '0.10' },
    audit_events: { event_type: 'synthetic_fixture', object_id: ids.measurements, safe_metadata: { synthetic: true } },
  };
  for (const table of databaseTables) rows[table] = { ...rows[table], user_id: userId, ...(table === 'profiles' ? {} : { id: ids[table] }) };
  return { userId, ids, rows };
}

export type DatabaseGraph = ReturnType<typeof databaseGraph>;

export const cleanupTables: readonly DatabaseTable[] = [
  'usage_reservations', 'audit_events', 'messages', 'ai_steps', 'goal_revisions',
  'action_proposals', 'goals', 'ai_runs', 'conversations', 'measurements', 'import_batches',
  'private_payloads', 'data_sources', 'usage_buckets', 'profiles',
];

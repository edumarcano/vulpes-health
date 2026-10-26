export const id = '11111111-1111-4111-8111-111111111111';
export const otherId = '22222222-2222-4222-8222-222222222222';
export const hash = 'a'.repeat(64);
export const measurement = {
  id, sourceId: otherId, metric: 'weight', value: 69.7, unit: 'kg', originalValue: '69.7', originalUnit: 'kg',
  observedAt: '2026-09-01T08:00:00Z', localDate: null, timezone: 'UTC', granularity: 'instant',
  method: 'device_reported', qualityFlags: [], externalRecordId: null, version: 1,
};
export const analysis = {
  id: `analysis:${id}`, metric: 'weight', unit: 'kg', sourceId: otherId,
  from: '2026-09-01T00:00:00Z', to: '2026-09-08T00:00:00Z', timezone: 'UTC',
  algorithmVersion: 'daily_median_mean_7d:v1', dataRevision: 0, observationCount: 7, validDays: 7,
  coverageStatus: 'sufficient', value: 69.7, previousValue: null, absoluteChange: null, relativeChangePercent: null,
  points: [{ localDate: '2026-09-01', value: 69.7 }], exclusions: [],
  references: [{ id: `measurement:${id}`, kind: 'measurement', label: 'Synthetic measurement' }],
};
export const goalDraft = {
  schemaVersion: 1, title: 'Synthetic goal', metric: 'weight', unit: 'kg', sourceId: otherId,
  target: { direction: 'decrease_to', value: 69 }, baselineMethod: 'daily_median_mean_7d',
  baselineFrom: '2026-09-01T00:00:00Z', baselineTo: '2026-09-08T00:00:00Z', reportedBaseline: null,
  timezone: 'UTC', targetDate: null, constraints: [], proposedStrategy: null,
};
export const proposal = {
  id, kind: 'goal.create', targetId: null, expectedVersion: null, payloadHash: hash,
  status: 'pending', expiresAt: '2026-10-25T00:00:00Z', summary: 'Synthetic proposal', payload: goalDraft,
};
export const usage = {
  inputTokens: 20, outputTokens: 10, reasoningTokens: 4, cacheReadTokens: 5, cacheWriteTokens: null,
  costUSD: null, costStatus: 'pending', reservationUSD: '0.01', priceSnapshotId: 'synthetic-only',knownCostUSD:'0',
};
export const manifest = {
  templateVersion: 'synthetic:v1', included: [{ reference: analysis.references[0], contentHash: hash, tokenEstimate: 20 }],
  excluded: [], retrieval: { ragUsed: false, webUsed: false }, consentVersion: 'synthetic:v1', dataRevision: 0,
};
export const chatSend = {
  action: 'send', client_request_id: id, conversation_id: otherId, message: { id, text: 'How is my weight trend?' }, depth: 'auto',
  context_selection: { metric: 'weight', source_id: null, goal_id: null, from: analysis.from, to: analysis.to, timezone: 'UTC' },
};
export const approval = { action: 'approve', proposal_id: id, payload_hash: hash, expected_version: null, client_request_id: otherId };
export const importCommit = { action: 'commit_import', batch_id: id, payload_hash: hash, client_request_id: otherId };

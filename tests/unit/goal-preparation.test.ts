import { expect, it, vi } from 'vitest';
import { GoalService } from '../../server/services/goals.js';
import {
  GoalDefinitionSchema,
  GoalRevisionPayloadSchema,
} from '../../shared/goals.js';
import { readAnalysis } from '../../server/services/analysis.js';
import { calculateAnalysis } from '../../server/analytics/analysis.js';
import { normalizeObservation } from '../../server/analytics/measurements.js';
import type { AuthContext } from '../../server/auth/session.js';
import { goalDraft } from '../fixtures/contracts.js';

vi.mock('../../server/services/analysis.js', () => ({ readAnalysis: vi.fn() }));
const owner = '00000000-0000-4000-8000-000000000001';
const goalId = '00000000-0000-4000-8000-000000000002';
it('rejects a revision when the baseline crosses the earlier reviewed data revision', async () => {
  const definition = GoalDefinitionSchema.parse({
    ...goalDraft,
    method: 'device_reported',
    granularity: 'instant',
    currentMethod: 'latest_value',
    baselineMethod: 'latest_value',
    reportedBaseline: null,
  });
  const previous = GoalRevisionPayloadSchema.parse({
    schemaVersion: 2,
    definition,
    baseline: {
      schemaVersion: 2,
      selection: {
        metric: definition.metric,
        source_id: definition.sourceId,
        method: definition.method,
        granularity: definition.granularity,
        timezone: definition.timezone,
        from: definition.baselineFrom,
        to: definition.baselineTo,
      },
      value: '70',
      dataRevision: 1,
      algorithmVersion: 'latest_value_v1',
      provenance: 'calculated',
      references: [],
    },
    state: 'active',
    baselineResolution: 'replace',
    reviewedDataRevision: 1,
  });
  const chain = {
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => ({
      data: { id: definition.sourceId },
      error: null,
    }),
    single: async () => ({ data: { data_revision: 1 }, error: null }),
  };
  const context = {
    userId: owner,
    db: { from: () => chain },
  } as unknown as AuthContext;
  const service = new GoalService(context);
  vi.spyOn(service, 'revision').mockResolvedValue({
    goal: { id: goalId, version: 1, state: 'active', review_status: 'clear' },
    revision: { payload: previous },
  } as never);
  const reading = {
    ...normalizeObservation({
      metric: 'weight',
      value: '70',
      unit: 'kg',
      observed_at: '2026-09-02T08:00:00Z',
      timezone: 'UTC',
      local_date: null,
      method: 'device_reported',
      granularity: 'instant',
      quality_flags: [],
    }),
    id: owner,
    source_id: definition.sourceId,
    external_record_id: null,
    version: 1,
  };
  const result = calculateAnalysis(
    owner,
    {
      operation: 'latest_per_metric',
      series: {
        metric: definition.metric,
        source_id: definition.sourceId,
        method: definition.method,
        granularity: definition.granularity,
      },
      timezone: definition.timezone,
      window: { from: definition.baselineFrom!, to: definition.baselineTo! },
    },
    [reading],
    2,
    '2026-11-15T12:00:00Z',
    null,
  );
  vi.mocked(readAnalysis).mockResolvedValue({
    schemaVersion: 1,
    dataRevision: 2,
    results: [result],
  });
  await expect(
    service.prepareProposal({
      action: 'propose_revision',
      client_request_id: owner,
      goal_id: goalId,
      expected_version: 1,
      definition,
      baseline_resolution: 'replace',
    }),
  ).rejects.toMatchObject({ status: 409, code: 'goal_conflict' });
});

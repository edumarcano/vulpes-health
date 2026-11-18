import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '../../server/auth/session.js';
import {
  executeReadTool,
  prepareGoalTool,
  providerToolResult,
  readToolDefinitions,
} from '../../server/ai/tools.js';
import {
  agentToolArguments,
  AgentAnalysisToolResultSchema,
  AgentGoalDefinitionSchema,
  analysisCardSnapshot,
} from '../../shared/agent-tools.js';
import {
  GoalDefinitionSchema,
  type GoalDefinition,
} from '../../shared/goals.js';
import type { Json } from '../../server/db/database.types.js';
import { GoalService } from '../../server/services/goals.js';
import { GoalGroupService } from '../../server/services/goal-groups.js';
import {
  readAnalysis,
  readMetricInventory,
} from '../../server/services/analysis.js';
import { readData } from '../../server/services/measurements.js';
import { calculateAnalysis } from '../../server/analytics/analysis.js';
import {
  METRIC_CONTENT_VERSION,
  metricContent,
  registryMetricKeys,
} from '../../shared/metrics.js';

vi.mock('../../server/services/analysis.js', async (original) => ({
  ...(await original<typeof import('../../server/services/analysis.js')>()),
  readAnalysis: vi.fn(),
  readMetricInventory: vi.fn(),
}));
vi.mock('../../server/services/measurements.js', async (original) => ({
  ...(await original<typeof import('../../server/services/measurements.js')>()),
  readData: vi.fn(),
}));
const owner = '00000000-0000-4000-8000-000000000001';
const source = '00000000-0000-4000-8000-000000000002';
const goalId = '00000000-0000-4000-8000-000000000003';
const revisionId = '00000000-0000-4000-8000-000000000004';
const stepId = '00000000-0000-4000-8000-000000000005';
const selected = {
  source_id: source,
  method: 'device_reported' as const,
  granularity: 'instant' as const,
};
function context(revisions = [7]): AuthContext {
  let reads = 0;
  return {
    userId: owner,
    db: {
      from(table: string) {
        const result = () => ({
          error: null,
          data:
            table === 'profiles'
              ? {
                  timezone: 'America/New_York',
                  data_revision:
                    revisions[Math.min(reads++, revisions.length - 1)],
                }
              : { id: source },
        });
        const query = {
          select: () => query,
          eq: () => query,
          single: async () => result(),
          maybeSingle: async () => result(),
        };
        return query;
      },
    },
  } as unknown as AuthContext;
}
const inputDefinition = {
  metric: 'weight' as const,
  ...selected,
  title: 'Synthetic weight goal',
  target: { direction: 'decrease_to' as const, value: 70 },
  baseline_method: 'latest_value' as const,
  baseline_from: '2026-10-31',
  baseline_to: '2026-11-03',
};
function payload(definition: GoalDefinition) {
  return {
    schemaVersion: 2 as const,
    definition,
    baseline: {
      schemaVersion: 2 as const,
      selection: {
        metric: definition.metric,
        ...selected,
        from: '2026-10-31T04:00:00Z',
        to: '2026-11-03T05:00:00Z',
        timezone: 'America/New_York',
      },
      value: '75',
      dataRevision: 7,
      algorithmVersion: 'explicit-analysis-v2',
      provenance: 'calculated' as const,
      references: [],
    },
    state: 'active' as const,
    baselineResolution: 'replace' as const,
    reviewedDataRevision: 7,
  };
}
function approvedGoal() {
  return {
    id: goalId,
    version: 3,
    current_revision_id: revisionId,
    review_status: 'clear',
  } as Awaited<ReturnType<GoalService['owned']>>;
}
function approvedRevision(definition?: GoalDefinition) {
  return {
    goal: approvedGoal(),
    revision: {
      id: revisionId,
      payload: definition
        ? (JSON.parse(JSON.stringify(payload(definition))) as Json & object)
        : {},
      approved_at: '2026-11-01T12:00:00Z',
      approved_proposal_id: stepId,
      goal_id: goalId,
      payload_version: 2,
      previous_revision_id: null,
      private_content_removed_at: null,
      revision_number: 3,
      user_id: owner,
    },
  } satisfies Awaited<ReturnType<GoalService['revision']>>;
}
afterEach(() => vi.restoreAllMocks());

describe('v0.2 conversation tool contract', () => {
  it('advertises eight bounded tools while validating all numeric and raw-only metric distinctions', () => {
    expect(readToolDefinitions.map((tool) => tool.name)).toEqual([
      'request_escalation',
      'list_metrics',
      'analyze_measurements',
      'get_measurements',
      'explain_metrics',
      'list_goals',
      'get_goal_progress',
      'prepare_goals',
    ]);
    expect(Buffer.byteLength(JSON.stringify(readToolDefinitions))).toBeLessThan(
      6889,
    );
    expect(registryMetricKeys).toHaveLength(29);
    expect(AgentGoalDefinitionSchema.shape.metric.options).toHaveLength(25);
    for (const metric of registryMetricKeys.filter(
      (key) => !metricContent[key].goalEligible,
    ))
      expect(
        AgentGoalDefinitionSchema.safeParse({ ...inputDefinition, metric })
          .success,
      ).toBe(false);
    expect(
      agentToolArguments.get_goal_progress.safeParse({
        goal_id: goalId,
        group_id: source,
      }).success,
    ).toBe(false);
    expect(
      agentToolArguments.prepare_goals.safeParse({
        members: [{ kind: 'existing', goal_id: goalId, expected_version: 3 }],
      }).success,
    ).toBe(false);
  });

  it('forwards raw cursor/revision and resolves profile-local DST boundaries on the server', async () => {
    vi.mocked(readData).mockResolvedValue({
      items: [],
      nextCursor: 'next-owned-page',
      dataRevision: 7,
    });
    expect(
      await executeReadTool(context(), 'get_measurements', {
        metric: 'weight',
        ...selected,
        from: '2026-10-31',
        to: '2026-11-03',
        cursor: 'owned-page',
        data_revision: 7,
        limit: 11,
      }),
    ).toMatchObject({
      kind: 'measurements',
      nextCursor: 'next-owned-page',
      dataRevision: 7,
    });
    expect(readData).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        cursor: 'owned-page',
        data_revision: 7,
        page_size: 11,
        from: '2026-10-31T04:00:00Z',
        to: '2026-11-03T05:00:00Z',
        timezone: 'America/New_York',
      }),
    );
  });

  it('does not choose between ambiguous owned series or perform a partial batch', async () => {
    vi.mocked(readAnalysis).mockClear();
    vi.mocked(readMetricInventory).mockResolvedValue({
      dataRevision: 7,
      nextCursor: null,
      items: [source, goalId].map((source_id) => ({
        metric: 'weight',
        ...selected,
        source_id,
        source_label: 'Synthetic',
        observations: 1,
        first_at: '2026-11-01T12:00:00Z',
        last_at: '2026-11-01T12:00:00Z',
      })),
    } as Awaited<ReturnType<typeof readMetricInventory>>);
    expect(
      await executeReadTool(context(), 'analyze_measurements', {
        operation: 'latest_per_metric',
        metrics: ['weight'],
      }),
    ).toMatchObject({
      kind: 'clarification_required',
      metric: 'weight',
      dataRevision: 7,
    });
    expect(readAnalysis).not.toHaveBeenCalled();
  });

  it('preserves deterministic IDs and coverage while removing large numerical evidence from cards/projection', () => {
    const result = calculateAnalysis(
      owner,
      {
        operation: 'observed_day_mean',
        series: { metric: 'weight', ...selected },
        timezone: 'America/New_York',
        window: { from: '2026-10-31T04:00:00Z', to: '2026-11-03T05:00:00Z' },
        includeSampleMean: false,
      },
      [],
      7,
      '2026-11-03T12:00:00Z',
      null,
    );
    const full = AgentAnalysisToolResultSchema.parse({
      kind: 'analysis_batch',
      data: { schemaVersion: 1, dataRevision: 7, results: [result] },
    });
    const snapshot = analysisCardSnapshot(result);
    expect(snapshot).toMatchObject({
      id: result.id,
      evidence: result.evidence,
      current: { coverageStatus: 'insufficient_data', value: null },
      exclusionCount: 0,
    });
    for (const key of ['points', 'references', 'endpoints', 'exclusions'])
      expect(snapshot).not.toHaveProperty(key);
    const projected = providerToolResult(full) as {
      results: unknown[][];
      resultColumns: string[];
      resultConstants: Record<string, unknown>;
      windowColumns: string[];
    };
    expect(projected.results[0]![projected.resultColumns.indexOf('id')]).toBe(
      result.id,
    );
    const current = projected.results[0]![
      projected.resultColumns.indexOf('current')
    ] as unknown[];
    expect(current[projected.windowColumns.indexOf('value')]).toBeNull();
    expect(full.data.results[0]).toHaveProperty('points');
    const decimal = '0.' + '123456789'.repeat(220);
    const repeating = {
      ...full,
      data: {
        ...full.data,
        results: [{ ...result, relativeChangePercent: decimal }],
      },
    };
    const rounded = providerToolResult(repeating) as typeof projected & {
      numericalPrecision: { significantDigits: number; exactValues: string };
    };
    expect(
      rounded.results[0]![
        rounded.resultColumns.indexOf('relativeChangePercent')
      ],
    ).toBe('0.123456789123');
    expect(rounded.numericalPrecision).toMatchObject({
      significantDigits: 12,
      exactValues: 'owned_trace_and_cards',
    });
    expect(repeating.data.results[0]!.relativeChangePercent).toBe(decimal);
  });

  it('wraps unavailable progress in an owned goal/version/revision vector and rejects a concurrent revision', async () => {
    vi.spyOn(GoalService.prototype, 'revision').mockResolvedValue(
      approvedRevision(),
    );
    vi.spyOn(GoalService.prototype, 'owned').mockResolvedValue(approvedGoal());
    vi.spyOn(GoalService.prototype, 'progress').mockResolvedValue({
      kind: 'unavailable',
      reason: 'needs_review',
    });
    expect(
      await executeReadTool(context(), 'get_goal_progress', {
        goal_id: goalId,
      }),
    ).toEqual({
      kind: 'goal_progress',
      goalId,
      goalVersion: 3,
      revisionId,
      dataRevision: 7,
      progress: { kind: 'unavailable', reason: 'needs_review' },
    });
    await expect(
      executeReadTool(context([7, 8]), 'get_goal_progress', {
        goal_id: goalId,
      }),
    ).rejects.toMatchObject({ status: 409, code: 'data_changed' });
  });
  it('bounds four-member progress decimals while retaining exact goal evidence', () => {
    const decimal = '70.' + '123456789'.repeat(220);
    const progress = {
      kind: 'progress',
      baseline: decimal,
      current: decimal,
      actualChange: decimal,
      relativeChangePercent: decimal,
      result: { kind: 'directional', rawPercent: 0, displayPercent: 0 },
    };
    const output = {
      kind: 'group_progress',
      groupId: goalId,
      groupVersion: 1,
      dataRevision: 7,
      evaluatedAt: '2026-11-16T12:00:00Z',
      administrativeState: 'active',
      conditionStatus: 'not_meeting_conditions',
      members: Array.from({ length: 4 }, (_, index) => ({
        position: index + 1,
        goalId,
        reviewedVersion: 1,
        reviewedRevisionId: revisionId,
        currentVersion: 1,
        currentRevisionId: revisionId,
        state: 'active',
        title: 'Synthetic member',
        outcome: 'not_met',
        progress,
      })),
    };
    const projected = providerToolResult(output);
    expect(Buffer.byteLength(JSON.stringify(projected))).toBeLessThan(8000);
    expect(projected).toMatchObject({
      numericalPrecision: {
        significantDigits: 12,
        exactValues: 'owned_trace_and_cards',
      },
    });
    expect(output.members[0]!.progress.baseline).toBe(decimal);
  });

  it('composes canonical single/group pending requests without registering or activating them', async () => {
    const prepare = vi
      .spyOn(GoalService.prototype, 'prepareProposal')
      .mockImplementation(async (request) => {
        if (request.action === 'propose_state')
          throw new Error('Unexpected state mutation');
        return payload(request.definition);
      });
    const register = vi.spyOn(GoalService.prototype, 'propose');
    const single = await prepareGoalTool(
      context(),
      'prepare_goals',
      { members: [{ kind: 'create', definition: inputDefinition }] },
      stepId,
    );
    expect(single).toMatchObject({
      kind: 'goal_proposal',
      request: {
        action: 'propose_create',
        client_request_id: stepId,
        definition: {
          unit: 'kg',
          timezone: 'America/New_York',
          baselineFrom: '2026-10-31T04:00:00Z',
          baselineTo: '2026-11-03T05:00:00Z',
          currentMethod: 'latest_value',
          reportedBaseline: null,
        },
      },
    });
    const groupPrepare = vi
      .spyOn(GoalGroupService.prototype, 'prepareProposal')
      .mockImplementation(async (request) => {
        if (request.action === 'propose_group_state')
          throw new Error('Unexpected state mutation');
        return {
          schemaVersion: 3,
          name: request.name,
          state: 'active',
          reviewedDataRevision: 7,
          members: request.members.map((member) => {
            if (member.kind === 'existing')
              throw new Error('Unexpected link in synthetic create case');
            return {
              kind: 'create' as const,
              payload: payload(member.definition),
            };
          }),
        };
      });
    const group = await prepareGoalTool(
      context(),
      'prepare_goals',
      {
        group: { name: 'Synthetic group', id: goalId, expected_version: 2 },
        members: [{ kind: 'create', definition: inputDefinition }],
      },
      stepId,
    );
    expect(group).toMatchObject({
      kind: 'goal_group_proposal',
      request: {
        action: 'propose_group_revision',
        client_request_id: stepId,
        group_id: goalId,
        expected_version: 2,
      },
    });
    expect(prepare).toHaveBeenCalledOnce();
    expect(groupPrepare).toHaveBeenCalledOnce();
    expect(register).not.toHaveBeenCalled();
  });

  it('refuses harmful body-fat bounds and invented baseline/result/owner fields before preparation', async () => {
    const prepare = vi.spyOn(GoalService.prototype, 'prepareProposal');
    for (const target of [
      { direction: 'decrease_to', value: 2 },
      { direction: 'maintain_range', lower: 1, upper: 5 },
      { direction: 'maintain_range', lower: 1, upper: 2 },
    ])
      await expect(
        prepareGoalTool(
          context(),
          'prepare_goals',
          {
            members: [
              {
                kind: 'create',
                definition: {
                  ...inputDefinition,
                  metric: 'body_fat_percent',
                  target,
                },
              },
            ],
          },
          stepId,
        ),
      ).rejects.toMatchObject({ code: 'unsafe_goal_target' });
    await expect(
      prepareGoalTool(
        context(),
        'prepare_goals',
        {
          owner_id: owner,
          members: [
            {
              kind: 'create',
              definition: {
                ...inputDefinition,
                result_id: goalId,
                reported_baseline: 80,
              },
            },
          ],
        },
        stepId,
      ),
    ).rejects.toMatchObject({ code: 'invalid_arguments' });
    expect(prepare).not.toHaveBeenCalled();
  });

  it('binds definition-only explanations to data/content versions without needing a measurement', async () => {
    expect(
      await executeReadTool(context(), 'explain_metrics', {
        metrics: ['weight'],
      }),
    ).toMatchObject({
      kind: 'metric_explanations',
      dataRevision: 7,
      contentVersion: METRIC_CONTENT_VERSION,
      items: [{ definition: { metric: 'weight' }, reference: null }],
    });
  });

  it('retains exact approved baseline instants when local-date composition yields equivalent timestamp spelling', async () => {
    const definition = GoalDefinitionSchema.parse({
      schemaVersion: 1,
      title: inputDefinition.title,
      metric: 'weight',
      sourceId: source,
      method: selected.method,
      granularity: selected.granularity,
      unit: 'kg',
      target: inputDefinition.target,
      baselineMethod: 'latest_value',
      currentMethod: 'latest_value',
      baselineFrom: '2026-10-31T04:00:00.000Z',
      baselineTo: '2026-11-03T05:00:00.000Z',
      reportedBaseline: null,
      timezone: 'America/New_York',
      targetDate: null,
      constraints: [],
      proposedStrategy: null,
    });
    vi.spyOn(GoalService.prototype, 'revision').mockResolvedValue(
      approvedRevision(definition),
    );
    vi.spyOn(GoalService.prototype, 'prepareProposal').mockImplementation(
      async (request) => {
        if (request.action !== 'propose_revision')
          throw new Error('Expected revision');
        return payload(request.definition);
      },
    );
    const result = await prepareGoalTool(
      context(),
      'prepare_goals',
      {
        members: [
          {
            kind: 'revise',
            goal_id: goalId,
            expected_version: 3,
            baseline_resolution: 'retain',
            definition: {
              ...inputDefinition,
              target: { direction: 'decrease_to', value: 69 },
            },
          },
        ],
      },
      stepId,
    );
    expect(result).toMatchObject({
      request: {
        definition: {
          baselineFrom: definition.baselineFrom,
          baselineTo: definition.baselineTo,
        },
        baseline_resolution: 'retain',
      },
    });
  });

  it('applies the AI body-fat floor to existing approved group members as well as new targets', async () => {
    const definition = GoalDefinitionSchema.parse({
      schemaVersion: 1,
      title: 'Synthetic body-fat goal',
      metric: 'body_fat_percent',
      sourceId: source,
      method: 'device_estimate',
      granularity: 'instant',
      unit: '%',
      target: { direction: 'decrease_to', value: 2 },
      baselineMethod: 'latest_value',
      currentMethod: 'latest_value',
      baselineFrom: '2026-10-31T04:00:00Z',
      baselineTo: '2026-11-03T05:00:00Z',
      reportedBaseline: null,
      timezone: 'America/New_York',
      targetDate: null,
      constraints: [],
      proposedStrategy: null,
    });
    vi.spyOn(GoalService.prototype, 'revision').mockResolvedValue(
      approvedRevision(definition),
    );
    const prepare = vi.spyOn(GoalGroupService.prototype, 'prepareProposal');
    await expect(
      prepareGoalTool(
        context(),
        'prepare_goals',
        {
          group: { name: 'Synthetic group' },
          members: [{ kind: 'existing', goal_id: goalId, expected_version: 3 }],
        },
        stepId,
      ),
    ).rejects.toMatchObject({ code: 'unsafe_goal_target' });
    expect(prepare).not.toHaveBeenCalled();
  });
});

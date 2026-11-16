import { Temporal } from '@js-temporal/polyfill';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  GoalGroupMutationSchema,
  GoalGroupProposalPayloadSchema,
  type GoalGroupProposalPayload,
} from '../../shared/goal-groups.js';
import {
  GoalDefinitionSchema,
  GoalRevisionPayloadSchema,
} from '../../shared/goals.js';
import {
  GoalGroupService,
  groupConditionStatus,
} from '../../server/services/goal-groups.js';
import {
  GoalService,
  goalApprovalBindsRevision,
} from '../../server/services/goals.js';
import type { AuthContext } from '../../server/auth/session.js';
import { goalDraft } from '../fixtures/contracts.js';

const owner = '00000000-0000-4000-8000-000000000001';
const groupId = '00000000-0000-4000-8000-000000000002';
const goalId = '00000000-0000-4000-8000-000000000003';
const revisionId = '00000000-0000-4000-8000-000000000004';
const approvalId = '00000000-0000-4000-8000-000000000005';
const memberId = '00000000-0000-4000-8000-000000000006';
const now = Temporal.Instant.from('2026-11-15T12:00:00Z');
const definition = GoalDefinitionSchema.parse({
  ...goalDraft,
  baselineMethod: 'user_reported',
  reportedBaseline: 70,
  currentMethod: 'latest_value',
  method: 'device_reported',
  granularity: 'instant',
});
function childPayload(revision = 7) {
  return GoalRevisionPayloadSchema.parse({
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
      dataRevision: revision,
      algorithmVersion: 'user_reported_v1',
      provenance: 'user_reported',
      references: [],
    },
    state: 'active',
    baselineResolution: 'replace',
    reviewedDataRevision: revision,
  });
}
function canonical(revision = 7): GoalGroupProposalPayload {
  return GoalGroupProposalPayloadSchema.parse({
    schemaVersion: 3,
    name: 'Synthetic related targets',
    state: 'active',
    members: [{ kind: 'create', payload: childPayload(revision) }],
    reviewedDataRevision: revision,
  });
}
function fixture() {
  const records: Record<string, Record<string, unknown>[]> = {
    profiles: [{ user_id: owner, account_state: 'active', data_revision: 7 }],
    goal_groups: [
      {
        id: groupId,
        user_id: owner,
        name: 'Synthetic related targets',
        state: 'active',
        version: 1,
        review_status: 'clear',
        current_approval_id: approvalId,
        created_at: now.toString(),
        updated_at: now.toString(),
      },
    ],
    goal_group_members: [
      {
        id: memberId,
        user_id: owner,
        group_id: groupId,
        goal_id: goalId,
        position: 1,
        reviewed_goal_version: 1,
        reviewed_revision_id: revisionId,
      },
    ],
    goals: [
      {
        id: goalId,
        user_id: owner,
        title: definition.title,
        state: 'active',
        review_status: 'clear',
        version: 1,
        current_revision_id: revisionId,
        direction: 'decrease_to',
        canonical_unit: 'kg',
        target_value: 69,
        target_lower: null,
        target_upper: null,
        source_policy: {},
      },
    ],
    action_proposals: [
      {
        id: approvalId,
        user_id: owner,
        kind: 'goal_group.create',
        state: 'approved',
        summary: 'Synthetic related targets',
        expires_at: '2026-11-16T12:00:00Z',
        group_target_id: null,
        target_id: null,
        target_version: null,
        payload_hash: 'a'.repeat(64),
        canonical_payload: canonical(),
        result: {
          proposalId: approvalId,
          outcome: 'approved',
          groupId,
          version: 1,
          members: [
            { goalId, revisionId, version: 1, position: 1, revisionNumber: 1 },
          ],
        },
      },
    ],
    goal_revisions: [
      {
        id: revisionId,
        user_id: owner,
        goal_id: goalId,
        approved_proposal_id: approvalId,
        revision_number: 1,
        payload: childPayload(),
      },
    ],
  };
  const reads: Array<{ table: string; filters: Array<[string, unknown]> }> = [];
  function from(table: string) {
    const filters: Array<[string, unknown]> = [];
    reads.push({ table, filters });
    let limit = Infinity;
    const result = () => ({
      data: (records[table] ?? [])
        .filter((row) => filters.every(([key, value]) => row[key] === value))
        .slice(0, limit)
        .map((row) => structuredClone(row)),
      error: null,
    });
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => {
        filters.push([key, value]);
        return query;
      },
      order: () => query,
      limit: (count: number) => {
        limit = count;
        return query;
      },
      maybeSingle: async () => ({
        data: result().data[0] ?? null,
        error: null,
      }),
      single: async () => ({ data: result().data[0] ?? null, error: null }),
      then: (resolve: (value: ReturnType<typeof result>) => unknown) =>
        Promise.resolve(result()).then(resolve),
    };
    return query;
  }
  const context = { userId: owner, db: { from } } as unknown as AuthContext;
  return {
    records,
    reads,
    context,
    service: new GoalGroupService(context, () => now),
  };
}
afterEach(() => vi.restoreAllMocks());

describe('group request authority and review payloads', () => {
  it('accepts a bounded existing/new/revised union and rejects owner/baseline injection or repeated goals', () => {
    const request = {
      action: 'propose_group_create',
      client_request_id: owner,
      name: 'Synthetic related targets',
      members: [
        { kind: 'existing', goal_id: goalId, expected_version: 1 },
        { kind: 'create', definition },
      ],
    };
    const parsed = GoalGroupMutationSchema.parse(request);
    if (parsed.action !== 'propose_group_create')
      throw new Error('Unexpected group request.');
    expect(parsed.members).toHaveLength(2);
    expect(
      GoalGroupMutationSchema.safeParse({ ...request, ownerId: owner }).success,
    ).toBe(false);
    expect(
      GoalGroupMutationSchema.safeParse({
        ...request,
        members: [
          { kind: 'create', definition, baseline: childPayload().baseline },
        ],
      }).success,
    ).toBe(false);
    expect(
      GoalGroupMutationSchema.safeParse({
        ...request,
        members: Array.from({ length: 5 }, () => ({
          kind: 'create',
          definition,
        })),
      }).success,
    ).toBe(false);
    const letterId = '00000000-0000-4000-8000-0000000000af';
    expect(
      GoalGroupMutationSchema.safeParse({
        ...request,
        members: [
          { kind: 'existing', goal_id: letterId, expected_version: 1 },
          {
            kind: 'revise',
            goal_id: letterId.toUpperCase(),
            expected_version: 1,
            definition,
            baseline_resolution: 'retain',
          },
        ],
      }).success,
    ).toBe(false);
  });
  it('reuses server goal preparation without applying any child or admitting mixed data revisions', async () => {
    const setup = fixture();
    const prepare = vi
      .spyOn(GoalService.prototype, 'prepareProposal')
      .mockResolvedValue(childPayload());
    const request = GoalGroupMutationSchema.parse({
      action: 'propose_group_create',
      client_request_id: owner,
      name: 'Synthetic group',
      members: [{ kind: 'create', definition }],
    });
    const result = await setup.service.prepareProposal(request);
    expect(result.members).toEqual([
      { kind: 'create', payload: childPayload() },
    ]);
    expect(prepare).toHaveBeenCalledWith({
      action: 'propose_create',
      client_request_id: owner,
      definition,
    });
    prepare.mockImplementation(async () => {
      setup.records.profiles![0]!.data_revision = 8;
      return childPayload(8);
    });
    await expect(setup.service.prepareProposal(request)).rejects.toMatchObject({
      status: 409,
      code: 'goal_group_conflict',
    });
  });
  it('captures the exact approved revision and payload for an existing member', async () => {
    const setup = fixture();
    const result = await setup.service.prepareProposal(
      GoalGroupMutationSchema.parse({
        action: 'propose_group_create',
        client_request_id: owner,
        name: 'Synthetic group',
        members: [{ kind: 'existing', goal_id: goalId, expected_version: 1 }],
      }),
    );
    expect(result.members[0]).toEqual({
      kind: 'existing',
      goalId,
      expectedVersion: 1,
      revisionId,
      payload: childPayload(),
    });
    setup.records.goals![0]!.version = 2;
    await expect(
      setup.service.prepareProposal(
        GoalGroupMutationSchema.parse({
          action: 'propose_group_create',
          client_request_id: owner,
          name: 'Synthetic group',
          members: [{ kind: 'existing', goal_id: goalId, expected_version: 1 }],
        }),
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('permits explicit archive using exact redacted approved members after an independent child change', async () => {
    const setup = fixture();
    const old = canonical();
    old.members[0]!.payload.baseline.value = null;
    setup.records.action_proposals![0]!.canonical_payload = old;
    setup.records.goals![0]!.version = 2;
    setup.records.goal_groups![0]!.review_status = 'needs_review';
    setup.records.goal_groups![0]!.version = 2;
    setup.records.profiles![0]!.data_revision = 8;
    const prepare = vi.spyOn(GoalService.prototype, 'prepareProposal');
    const result = await setup.service.prepareProposal({
      action: 'propose_group_state',
      client_request_id: owner,
      group_id: groupId,
      expected_version: 2,
      state: 'archived',
    });
    expect(result).toEqual({
      ...old,
      state: 'archived',
      reviewedDataRevision: 8,
    });
    expect(prepare).not.toHaveBeenCalled();
  });
});

describe('atomic approval binding and all-members progress', () => {
  it('binds group-approved child readers to durable goal/revision receipts after canonical content removal', () => {
    const parent = fixture().records.action_proposals![0]!;
    const approval = {
      state: 'approved',
      kind: 'goal_group.create',
      result: parent.result,
    };
    expect(goalApprovalBindsRevision(approval, goalId, revisionId)).toBe(true);
    expect(goalApprovalBindsRevision(approval, groupId, revisionId)).toBe(
      false,
    );
    expect(goalApprovalBindsRevision(approval, goalId, owner)).toBe(false);
    expect(
      goalApprovalBindsRevision(
        { ...approval, state: 'pending' },
        goalId,
        revisionId,
      ),
    ).toBe(false);
    expect(
      goalApprovalBindsRevision(
        { ...approval, kind: 'goal_group.state' },
        goalId,
        revisionId,
      ),
    ).toBe(false);
    expect(
      goalApprovalBindsRevision(
        { state: 'approved', kind: 'goal.create', result: null },
        goalId,
        revisionId,
      ),
    ).toBe(true);
  });
  it('never averages away a missing, stale, archived or invalid member', () => {
    expect(groupConditionStatus('active', 'clear', ['met', 'met'])).toBe(
      'meeting_conditions',
    );
    expect(groupConditionStatus('active', 'clear', ['met', 'not_met'])).toBe(
      'not_meeting_conditions',
    );
    for (const outcome of [
      'needs_data',
      'stale',
      'archived',
      'needs_review',
      'unavailable',
    ] as const)
      expect(groupConditionStatus('active', 'clear', ['met', outcome])).toBe(
        'unavailable',
      );
    expect(groupConditionStatus('archived', 'clear', ['met'])).toBe(
      'unavailable',
    );
    expect(groupConditionStatus('active', 'needs_review', ['met'])).toBe(
      'unavailable',
    );
    expect(groupConditionStatus('active', 'clear', [])).toBe('unavailable');
  });
  it('reuses current goal evidence and rejects a concurrent version or data change', async () => {
    const setup = fixture();
    const progress = vi
      .spyOn(GoalService.prototype, 'progress')
      .mockResolvedValue({
        kind: 'progress',
        goalId,
        goalVersion: 1,
        baseline: '70',
        current: '69',
        dataRevision: 7,
        result: { kind: 'directional', rawPercent: 100, displayPercent: 100 },
        conditionMet: true,
      });
    const result = await setup.service.progress(groupId);
    expect(result.conditionStatus).toBe('meeting_conditions');
    expect(result.members[0]).toMatchObject({
      goalId,
      outcome: 'met',
      progress: { current: '69' },
    });
    expect(
      setup.reads.every((read) =>
        read.filters.some(
          ([key, value]) => key === 'user_id' && value === owner,
        ),
      ),
    ).toBe(true);
    progress.mockImplementation(async () => {
      setup.records.goals![0]!.version = 2;
      return { kind: 'insufficient_data' };
    });
    await expect(setup.service.progress(groupId)).rejects.toMatchObject({
      status: 409,
      code: 'goal_group_conflict',
    });
    setup.records.goals![0]!.version = 1;
    progress.mockImplementation(async () => {
      setup.records.profiles![0]!.data_revision = 8;
      return { kind: 'insufficient_data' };
    });
    await expect(setup.service.progress(groupId)).rejects.toMatchObject({
      status: 409,
      code: 'goal_group_conflict',
    });
  });
  it('shows reviewed-child changes without evaluating the replacement as already approved', async () => {
    const setup = fixture();
    setup.records.goals![0]!.version = 2;
    const progress = vi.spyOn(GoalService.prototype, 'progress');
    const result = await setup.service.progress(groupId);
    expect(result).toMatchObject({
      conditionStatus: 'unavailable',
      members: [
        { outcome: 'needs_review', reviewedVersion: 1, currentVersion: 2 },
      ],
    });
    expect(progress).not.toHaveBeenCalled();
    setup.records.goals![0]!.state = 'archived';
    expect((await setup.service.progress(groupId)).members[0]!.outcome).toBe(
      'archived',
    );
  });
});

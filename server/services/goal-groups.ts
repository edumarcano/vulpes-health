import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';
import {
  GoalGroupDecisionSchema,
  GoalGroupDetailSchema,
  GoalGroupListQuerySchema,
  GoalGroupMembershipSchema,
  GoalGroupMutationSchema,
  GoalGroupProgressSchema,
  GoalGroupProposalPayloadSchema,
  GoalGroupProposalRowSchema,
  GoalGroupProposalListQuerySchema,
  GoalGroupProposalsPageSchema,
  GoalGroupRowSchema,
  GoalGroupsPageSchema,
  type GoalGroupMembership,
  type GoalGroupMutation,
  type GoalGroupProposalPayload,
  type GoalGroupProgressMember,
  type GoalGroupRow,
  type PreparedGroupMember,
} from '../../shared/goal-groups.js';
import { GoalRevisionPayloadSchema } from '../../shared/goals.js';
import { GoalStateSchema } from '../../shared/domain.js';
import { GoalRowSchema } from '../../shared/goal-views.js';
import { UUIDSchema } from '../../shared/primitives.js';
import type { ApprovalRequest } from '../../shared/api.js';
import type { AuthContext } from '../auth/session.js';
import { administrativeClient } from '../db/administrative.js';
import { HttpFailure } from '../http/failure.js';
import { goalPolicyAllows } from '../security/goal-policy.js';
import { GoalService, goalApprovalBindsRevision } from './goals.js';

export function groupConditionStatus(
  state: 'active' | 'archived',
  reviewStatus: 'clear' | 'needs_review',
  outcomes: GoalGroupProgressMember['outcome'][],
) {
  if (
    state === 'archived' ||
    reviewStatus !== 'clear' ||
    outcomes.length < 1 ||
    outcomes.length > 4 ||
    outcomes.some((outcome) => outcome !== 'met' && outcome !== 'not_met')
  )
    return 'unavailable' as const;
  return outcomes.every((outcome) => outcome === 'met')
    ? ('meeting_conditions' as const)
    : ('not_meeting_conditions' as const);
}

type CurrentGoal = Awaited<ReturnType<GoalService['owned']>>;
type GroupSnapshot = {
  group: GoalGroupRow;
  members: GoalGroupMembership[];
  goals: Map<string, CurrentGoal | null>;
  revision: number;
};

export class GoalGroupService {
  private readonly goals: GoalService;
  constructor(
    private readonly context: AuthContext,
    private readonly clock: () => Temporal.Instant = () =>
      Temporal.Now.instant(),
  ) {
    this.goals = new GoalService(context, clock);
  }
  private fail(message: string): never {
    const status = ['goal_not_found', 'goal_group_not_found'].includes(message)
      ? 404
      : ['goal_conflict', 'goal_group_conflict', 'data_conflict'].includes(
            message,
          )
        ? 409
        : ['invalid_goal', 'invalid_goal_group'].includes(message)
          ? 400
          : message === 'account_unavailable'
            ? 403
            : 503;
    throw new HttpFailure(
      status,
      status === 503 ? 'goal_groups_unavailable' : message,
      'The goal group operation could not proceed. Refresh and review.',
    );
  }
  private async dataRevision() {
    const result = await this.context.db
      .from('profiles')
      .select('data_revision')
      .eq('user_id', this.context.userId)
      .eq('account_state', 'active')
      .maybeSingle();
    if (result.error) this.fail(result.error.message);
    if (!result.data) this.fail('account_unavailable');
    return result.data.data_revision;
  }
  async owned(groupId: string) {
    const result = await this.context.db
      .from('goal_groups')
      .select('*')
      .eq('user_id', this.context.userId)
      .eq('id', UUIDSchema.parse(groupId))
      .maybeSingle();
    if (result.error) this.fail(result.error.message);
    if (!result.data) this.fail('goal_group_not_found');
    return GoalGroupRowSchema.parse(result.data);
  }
  private async memberships(groupId: string) {
    const result = await this.context.db
      .from('goal_group_members')
      .select('*')
      .eq('user_id', this.context.userId)
      .eq('group_id', groupId)
      .order('position')
      .limit(5);
    if (result.error) this.fail(result.error.message);
    return z.array(GoalGroupMembershipSchema).min(1).max(4).parse(result.data);
  }
  private async approvedPayload(group: GoalGroupRow) {
    if (!group.current_approval_id) this.fail('goal_groups_unavailable');
    const result = await this.context.db
      .from('action_proposals')
      .select('*')
      .eq('user_id', this.context.userId)
      .eq('id', group.current_approval_id)
      .maybeSingle();
    if (result.error) this.fail(result.error.message);
    const proposal = GoalGroupProposalRowSchema.safeParse(result.data);
    if (!proposal.success || proposal.data.state !== 'approved')
      this.fail('goal_groups_unavailable');
    const decision = GoalGroupDecisionSchema.safeParse(proposal.data.result);
    if (
      !decision.success ||
      decision.data.outcome !== 'approved' ||
      decision.data.groupId !== group.id ||
      decision.data.proposalId !== proposal.data.id ||
      (decision.data.version !== group.version &&
        !(
          group.review_status === 'needs_review' &&
          decision.data.version < group.version
        ))
    )
      this.fail('goal_groups_unavailable');
    const payload = GoalGroupProposalPayloadSchema.safeParse(
      proposal.data.canonical_payload,
    );
    if (
      !payload.success ||
      payload.data.name !== group.name ||
      payload.data.state !== group.state
    )
      this.fail('goal_groups_unavailable');
    return payload.data;
  }
  async prepareProposal(
    input: GoalGroupMutation,
  ): Promise<GoalGroupProposalPayload> {
    const request = GoalGroupMutationSchema.parse(input);
    const revision = await this.dataRevision();
    const now = this.clock();
    const goals = new GoalService(this.context, () => now);
    let group: GoalGroupRow | null = null;
    if (request.action !== 'propose_group_create') {
      group = await this.owned(request.group_id);
      if (
        group.version !== request.expected_version ||
        group.state === 'archived'
      )
        this.fail('goal_group_conflict');
    }
    if (request.action === 'propose_group_state') {
      const previous = await this.approvedPayload(group!);
      if ((await this.dataRevision()) !== revision)
        this.fail('goal_group_conflict');
      return GoalGroupProposalPayloadSchema.parse({
        ...previous,
        state: 'archived',
        reviewedDataRevision: revision,
      });
    }
    const members: PreparedGroupMember[] = [];
    for (const member of request.members) {
      if (member.kind === 'create') {
        const payload = await goals.prepareProposal({
          action: 'propose_create',
          client_request_id: request.client_request_id,
          definition: member.definition,
        });
        if (payload.reviewedDataRevision !== revision)
          this.fail('goal_group_conflict');
        members.push({ kind: 'create', payload });
      } else {
        const { goal, revision: approved } = await goals.revision(
          member.goal_id,
        );
        if (
          goal.version !== member.expected_version ||
          goal.state === 'archived' ||
          goal.state === 'draft' ||
          (member.kind === 'existing' && goal.review_status !== 'clear')
        )
          this.fail('goal_group_conflict');
        const payload =
          member.kind === 'existing'
            ? GoalRevisionPayloadSchema.parse(approved.payload)
            : await goals.prepareProposal({
                action: 'propose_revision',
                client_request_id: request.client_request_id,
                goal_id: member.goal_id,
                expected_version: member.expected_version,
                definition: member.definition,
                baseline_resolution: member.baseline_resolution,
              });
        if (
          member.kind === 'revise' &&
          payload.reviewedDataRevision !== revision
        )
          this.fail('goal_group_conflict');
        members.push({
          kind: member.kind,
          goalId: goal.id,
          expectedVersion: goal.version,
          revisionId: approved.id,
          payload,
        });
      }
    }
    if ((await this.dataRevision()) !== revision)
      this.fail('goal_group_conflict');
    if (group) {
      const current = await this.owned(group.id);
      if (
        current.version !== group.version ||
        current.current_approval_id !== group.current_approval_id ||
        current.state !== group.state
      )
        this.fail('goal_group_conflict');
    }
    const payload = GoalGroupProposalPayloadSchema.parse({
      schemaVersion: 3,
      name: request.name,
      state: 'active',
      members,
      reviewedDataRevision: revision,
    });
    if (!goalPolicyAllows(payload))
      throw new HttpFailure(
        403,
        'goal_policy',
        'This goal group cannot be proposed.',
      );
    return payload;
  }
  async propose(input: GoalGroupMutation) {
    const request = GoalGroupMutationSchema.parse(input);
    const receipt = await administrativeClient()
      .from('audit_events')
      .select('object_id')
      .eq('user_id', this.context.userId)
      .eq('event_type', 'group_propose_v1')
      .filter('safe_metadata->>request_id', 'eq', request.client_request_id)
      .maybeSingle();
    if (receipt.error) this.fail(receipt.error.message);
    const payload = receipt.data ? {} : await this.prepareProposal(request);
    const result = await administrativeClient().rpc(
      'register_goal_group_proposal_v1',
      { p_owner: this.context.userId, p_request: request, p_payload: payload },
    );
    if (result.error) this.fail(result.error.message);
    return this.proposal(UUIDSchema.parse(result.data));
  }
  async proposal(proposalId: string) {
    await this.goals.expire();
    const result = await this.context.db
      .from('action_proposals')
      .select('*')
      .eq('user_id', this.context.userId)
      .eq('id', UUIDSchema.parse(proposalId))
      .in('kind', [
        'goal_group.create',
        'goal_group.revise',
        'goal_group.state',
      ])
      .maybeSingle();
    if (result.error) this.fail(result.error.message);
    if (!result.data) this.fail('goal_group_not_found');
    return GoalGroupProposalRowSchema.parse(result.data);
  }
  async decide(request: ApprovalRequest) {
    const proposal = await this.proposal(request.proposal_id);
    if (
      request.action === 'approve' &&
      proposal.state === 'pending' &&
      !goalPolicyAllows(proposal.canonical_payload)
    )
      throw new HttpFailure(
        403,
        'goal_policy',
        'This goal group cannot be approved.',
      );
    const result = await administrativeClient().rpc(
      'decide_goal_group_proposal_v1',
      { p_owner: this.context.userId, p_request: request },
    );
    if (result.error) this.fail(result.error.message);
    return GoalGroupDecisionSchema.parse(result.data);
  }
  async list(input: z.input<typeof GoalGroupListQuerySchema> = {}) {
    const query = GoalGroupListQuerySchema.parse(input);
    if (query.cursor) {
      const anchor = await this.owned(query.cursor);
      if (query.state && anchor.state !== query.state)
        throw new HttpFailure(
          400,
          'invalid_cursor',
          'Refresh the goal group list.',
        );
    }
    let read = this.context.db
      .from('goal_groups')
      .select('*')
      .eq('user_id', this.context.userId)
      .order('id')
      .limit(query.page_size + 1);
    if (query.state) read = read.eq('state', query.state);
    if (query.cursor) read = read.gt('id', query.cursor);
    const result = await read;
    if (result.error) this.fail(result.error.message);
    const rows = z.array(GoalGroupRowSchema).max(201).parse(result.data);
    const items = rows.slice(0, query.page_size);
    return GoalGroupsPageSchema.parse({
      items,
      nextCursor: rows.length > query.page_size ? items.at(-1)!.id : null,
    });
  }
  async proposals(
    input: z.input<typeof GoalGroupProposalListQuerySchema> = {},
  ) {
    const query = GoalGroupProposalListQuerySchema.parse(input);
    await this.goals.expire();
    if (query.cursor) {
      try {
        await this.proposal(query.cursor);
      } catch (error) {
        if (error instanceof HttpFailure && error.status === 404)
          throw new HttpFailure(
            400,
            'invalid_cursor',
            'Refresh the goal group proposals.',
          );
        throw error;
      }
    }
    let read = this.context.db
      .from('action_proposals')
      .select('*')
      .eq('user_id', this.context.userId)
      .in('kind', [
        'goal_group.create',
        'goal_group.revise',
        'goal_group.state',
      ])
      .order('id')
      .limit(query.page_size + 1);
    if (query.cursor) read = read.gt('id', query.cursor);
    const result = await read;
    if (result.error) this.fail(result.error.message);
    const rows = z
      .array(GoalGroupProposalRowSchema)
      .max(201)
      .parse(result.data);
    const items = rows.slice(0, query.page_size);
    return GoalGroupProposalsPageSchema.parse({
      items,
      nextCursor: rows.length > query.page_size ? items.at(-1)!.id : null,
    });
  }
  private async snapshot(groupId: string): Promise<GroupSnapshot> {
    const revision = await this.dataRevision();
    const group = await this.owned(groupId);
    await this.approvedPayload(group);
    const members = await this.memberships(group.id);
    const goals = new Map<string, CurrentGoal | null>();
    for (const member of members) {
      try {
        goals.set(member.goal_id, await this.goals.owned(member.goal_id));
      } catch (error) {
        if (error instanceof HttpFailure && error.status === 404)
          goals.set(member.goal_id, null);
        else throw error;
      }
    }
    return { group, members, goals, revision };
  }
  private async unchanged(snapshot: GroupSnapshot) {
    const group = await this.owned(snapshot.group.id);
    if (
      group.version !== snapshot.group.version ||
      group.current_approval_id !== snapshot.group.current_approval_id ||
      group.state !== snapshot.group.state ||
      group.review_status !== snapshot.group.review_status
    )
      this.fail('goal_group_conflict');
    const members = await this.memberships(group.id);
    if (JSON.stringify(members) !== JSON.stringify(snapshot.members))
      this.fail('goal_group_conflict');
    for (const [id, before] of snapshot.goals) {
      if (!before) continue;
      const after = await this.goals.owned(id);
      if (
        after.version !== before.version ||
        after.current_revision_id !== before.current_revision_id ||
        after.state !== before.state ||
        after.review_status !== before.review_status
      )
        this.fail('goal_group_conflict');
    }
    if ((await this.dataRevision()) !== snapshot.revision)
      this.fail('goal_group_conflict');
  }
  private async calculate(snapshot: GroupSnapshot, now: Temporal.Instant) {
    const goals = new GoalService(this.context, () => now);
    const members: GoalGroupProgressMember[] = [];
    for (const member of snapshot.members) {
      const goal = snapshot.goals.get(member.goal_id);
      const base = {
        position: member.position,
        goalId: member.goal_id,
        reviewedVersion: member.reviewed_goal_version,
        reviewedRevisionId: member.reviewed_revision_id,
        currentVersion: goal?.version ?? null,
        currentRevisionId: goal?.current_revision_id ?? null,
        state: goal ? GoalStateSchema.parse(goal.state) : null,
        title: goal?.title ?? 'Unavailable member',
      };
      if (!goal || goal.state === 'draft') {
        members.push({ ...base, outcome: 'unavailable', progress: null });
        continue;
      }
      if (goal.state === 'archived') {
        members.push({ ...base, outcome: 'archived', progress: null });
        continue;
      }
      if (
        goal.version !== member.reviewed_goal_version ||
        goal.current_revision_id !== member.reviewed_revision_id ||
        goal.review_status !== 'clear'
      ) {
        members.push({ ...base, outcome: 'needs_review', progress: null });
        continue;
      }
      let progress;
      try {
        progress = await goals.progress(goal.id);
      } catch (error) {
        if (error instanceof HttpFailure && error.status === 404) {
          members.push({ ...base, outcome: 'unavailable', progress: null });
          continue;
        }
        throw error;
      }
      if (
        progress.kind === 'progress' &&
        progress.dataRevision !== snapshot.revision
      )
        this.fail('goal_group_conflict');
      const outcome =
        progress.kind === 'insufficient_data'
          ? 'needs_data'
          : progress.kind === 'unavailable'
            ? progress.reason === 'needs_review'
              ? 'needs_review'
              : 'unavailable'
            : progress.freshness?.status === 'stale'
              ? 'stale'
              : progress.freshness?.status === 'unavailable' ||
                  progress.conditionMet === undefined
                ? 'unavailable'
                : progress.conditionMet
                  ? 'met'
                  : 'not_met';
      members.push({ ...base, outcome, progress });
    }
    return GoalGroupProgressSchema.parse({
      kind: 'group_progress',
      groupId: snapshot.group.id,
      groupVersion: snapshot.group.version,
      dataRevision: snapshot.revision,
      evaluatedAt: now.toString(),
      administrativeState: snapshot.group.state,
      conditionStatus: groupConditionStatus(
        snapshot.group.state,
        snapshot.group.review_status,
        members.map((member) => member.outcome),
      ),
      members,
    });
  }
  async progress(groupId: string) {
    const snapshot = await this.snapshot(groupId);
    const progress = await this.calculate(snapshot, this.clock());
    await this.unchanged(snapshot);
    return progress;
  }
  async detail(groupId: string) {
    const snapshot = await this.snapshot(groupId);
    const members = [];
    for (const membership of snapshot.members) {
      const row = await this.context.db
        .from('goal_revisions')
        .select('id,payload,approved_proposal_id')
        .eq('user_id', this.context.userId)
        .eq('goal_id', membership.goal_id)
        .eq('id', membership.reviewed_revision_id)
        .maybeSingle();
      if (row.error) this.fail(row.error.message);
      let reviewedPayload = null;
      if (row.data) {
        const approval = await this.context.db
          .from('action_proposals')
          .select('state,kind,result')
          .eq('user_id', this.context.userId)
          .eq('id', row.data.approved_proposal_id)
          .maybeSingle();
        if (approval.error) this.fail(approval.error.message);
        if (
          goalApprovalBindsRevision(
            approval.data,
            membership.goal_id,
            row.data.id,
          )
        ) {
          const parsed = GoalRevisionPayloadSchema.safeParse(row.data.payload);
          if (parsed.success) reviewedPayload = parsed.data;
        }
      }
      const goal = snapshot.goals.get(membership.goal_id);
      members.push({
        membership,
        reviewedPayload,
        goal: goal ? GoalRowSchema.parse(goal) : null,
        currentRevisionId: goal?.current_revision_id ?? null,
      });
    }
    const progress = await this.calculate(snapshot, this.clock());
    await this.unchanged(snapshot);
    return GoalGroupDetailSchema.parse({
      group: snapshot.group,
      members,
      progress,
    });
  }
}

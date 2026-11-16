import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';
import {
  GoalDefinitionSchema,
  GoalRevisionPayloadSchema,
  goalTransitions,
  type GoalDefinition,
  type GoalMutation,
  type FrozenBaseline,
  type GoalRevisionPayload,
} from '../../shared/goals.js';
import { GoalDraftSchema } from '../../shared/domain.js';
import { GoalGroupDecisionSchema } from '../../shared/goal-groups.js';
import { GoalProgressResultSchema } from '../../shared/goal-progress.js';
import {
  type AnalysisOperation,
  type SeriesAnalysisResult,
} from '../../shared/analysis.js';
import { metricRegistry } from '../../shared/metrics.js';
import type { ApprovalRequest } from '../../shared/api.js';
import type { AuthContext } from '../auth/session.js';
import { administrativeClient } from '../db/administrative.js';
import { HttpFailure } from '../http/failure.js';
import { goalPolicyAllows } from '../security/goal-policy.js';
import { readData } from './measurements.js';
import { readAnalysis } from './analysis.js';
import { analysisWindow } from '../analytics/analysis.js';
import { Exact } from '../analytics/measurements.js';
import {
  goalProgress,
  goalConditionMet,
  goalFreshness,
} from '../analytics/goals.js';

export function goalApprovalBindsRevision(
  approval: { state: string; kind: string; result: unknown } | null,
  goalId: string,
  revisionId: string,
): boolean {
  if (approval?.state !== 'approved') return false;
  if (
    approval.kind === 'goal_group.create' ||
    approval.kind === 'goal_group.revise'
  ) {
    const receipt = GoalGroupDecisionSchema.safeParse(approval.result);
    return (
      receipt.success &&
      receipt.data.outcome === 'approved' &&
      receipt.data.members.some(
        (member) =>
          member.goalId === goalId && member.revisionId === revisionId,
      )
    );
  }
  return ['goal.create', 'goal.revise', 'goal.state'].includes(approval.kind);
}

export class GoalService {
  constructor(
    private readonly context: AuthContext,
    private readonly clock: () => Temporal.Instant = () =>
      Temporal.Now.instant(),
  ) {}
  private fail(message: string): never {
    const status =
      message === 'goal_not_found'
        ? 404
        : message === 'goal_conflict'
          ? 409
          : message === 'account_unavailable'
            ? 403
            : message === 'invalid_goal'
              ? 400
              : 503;
    throw new HttpFailure(
      status,
      message.startsWith('goal_') ? message : 'goals_unavailable',
      'The goal operation could not proceed. Refresh and review.',
    );
  }
  async expire() {
    const { error } = await administrativeClient().rpc(
      'expire_goal_proposals_v1',
      { p_owner: this.context.userId },
    );
    if (error) this.fail(error.message);
  }
  async owned(id: string) {
    const { data, error } = await this.context.db
      .from('goals')
      .select('*')
      .eq('user_id', this.context.userId)
      .eq('id', id)
      .maybeSingle();
    if (error) this.fail(error.message);
    if (!data) this.fail('goal_not_found');
    return data;
  }
  async revision(id: string) {
    const goal = await this.owned(id);
    const { data, error } = await this.context.db
      .from('goal_revisions')
      .select('*')
      .eq('user_id', this.context.userId)
      .eq('goal_id', id)
      .eq(
        'id',
        goal.current_revision_id ?? '00000000-0000-4000-8000-000000000000',
      )
      .maybeSingle();
    if (error) this.fail(error.message);
    if (!data) this.fail('goal_not_found');
    const approval = await this.context.db
      .from('action_proposals')
      .select('state,kind,result')
      .eq('user_id', this.context.userId)
      .eq('id', data.approved_proposal_id)
      .maybeSingle();
    if (approval.error) this.fail(approval.error.message);
    if (!goalApprovalBindsRevision(approval.data, goal.id, data.id))
      this.fail('goal_not_found');
    return { goal, revision: data };
  }
  async proposal(id: string) {
    await this.expire();
    const { data, error } = await this.context.db
      .from('action_proposals')
      .select('*')
      .eq('user_id', this.context.userId)
      .eq('id', id)
      .maybeSingle();
    if (error) this.fail(error.message);
    if (!data) this.fail('goal_not_found');
    return data;
  }
  private async valueAnalysis(
    d: GoalDefinition,
    method: 'latest_value' | 'daily_median_mean_7d',
    current: boolean,
    now: Temporal.Instant,
  ): Promise<SeriesAnalysisResult> {
    const series = {
      metric: d.metric,
      source_id: d.sourceId,
      method: d.method,
      granularity: d.granularity,
    };
    const end = now
      .toZonedDateTimeISO(d.timezone)
      .startOfDay()
      .add({ days: 1 });
    let operation: AnalysisOperation;
    if (current && method === 'latest_value') {
      operation = {
        operation: 'latest_per_metric',
        series,
        timezone: d.timezone,
        before:
          d.granularity === 'daily_total'
            ? end.toInstant().toString()
            : now.toString(),
      };
    } else {
      const from = current
        ? end.subtract({ days: 7 }).toInstant().toString()
        : d.baselineFrom;
      const to = current ? end.toInstant().toString() : d.baselineTo;
      if (!from || !to)
        throw new HttpFailure(
          400,
          'invalid_interval',
          'Choose a complete bounded baseline interval.',
        );
      let window;
      try {
        window = analysisWindow({ from, to }, d.timezone);
        if (method === 'daily_median_mean_7d' && window.days !== 7)
          throw new Error();
      } catch {
        throw new HttpFailure(
          400,
          'invalid_interval',
          method === 'daily_median_mean_7d'
            ? 'Choose exactly seven complete local calendar days.'
            : 'Choose 1-366 complete local calendar days for the baseline.',
        );
      }
      operation =
        method === 'latest_value'
          ? {
              operation: 'latest_per_metric',
              series,
              timezone: d.timezone,
              window: window.window,
            }
          : {
              operation: 'rolling_7d',
              series,
              timezone: d.timezone,
              window: window.window,
              ...(current ? { before: now.toString() } : {}),
            };
    }
    const batch = await readAnalysis(
      this.context,
      { action: 'analyze', operations: [operation] },
      now.toString(),
    );
    const result = batch.results[0]!;
    if (result.kind !== 'series_analysis')
      throw new Error('Invalid goal analysis result.');
    return result;
  }
  private async baseline(d: GoalDefinition): Promise<FrozenBaseline> {
    const now = this.clock();
    const selection = {
      metric: d.metric,
      source_id: d.sourceId,
      method: d.method,
      granularity: d.granularity,
      timezone: d.timezone,
      from: d.baselineFrom ?? now.toString(),
      to: d.baselineTo ?? now.add({ seconds: 1 }).toString(),
    };
    let baseline: FrozenBaseline;
    if (d.baselineMethod === 'user_reported') {
      const profile = await this.context.db
        .from('profiles')
        .select('data_revision')
        .eq('user_id', this.context.userId)
        .single();
      if (profile.error) this.fail(profile.error.message);
      baseline = {
        schemaVersion: 2,
        selection,
        value: String(d.reportedBaseline),
        dataRevision: profile.data.data_revision,
        algorithmVersion: 'user_reported_v1',
        provenance: 'user_reported',
        references: [],
      };
    } else {
      const analysis = await this.valueAnalysis(
        d,
        d.baselineMethod,
        false,
        now,
      );
      if (analysis.hasMoreReferences)
        throw new HttpFailure(
          422,
          'baseline_limit',
          'This baseline has more evidence than can be frozen completely. Narrow its interval before proposing a goal.',
        );
      baseline = {
        schemaVersion: 2,
        selection,
        value: analysis.current.value,
        dataRevision: analysis.dataRevision,
        algorithmVersion:
          d.baselineMethod === 'latest_value'
            ? 'latest_value_v2'
            : 'daily_median_mean_7d_v1',
        provenance: 'calculated',
        references: analysis.references.map(({ id, version, observedAt }) => ({
          id,
          version,
          observedAt,
        })),
      };
    }
    if (Buffer.byteLength(JSON.stringify(baseline)) > 65_536)
      throw new HttpFailure(
        422,
        'baseline_limit',
        'The complete baseline exceeds its evidence bound. Narrow the interval before proposing a goal.',
      );
    return baseline;
  }
  async propose(request: GoalMutation) {
    const receipt = await administrativeClient()
      .from('audit_events')
      .select('object_id,safe_metadata')
      .eq('user_id', this.context.userId)
      .eq('event_type', 'goal_propose_v1')
      .filter('safe_metadata->>request_id', 'eq', request.client_request_id)
      .maybeSingle();
    if (receipt.error) this.fail(receipt.error.message);
    if (receipt.data) {
      const result = await administrativeClient().rpc(
        'register_goal_proposal_v1',
        { p_owner: this.context.userId, p_request: request, p_payload: {} },
      );
      if (result.error) this.fail(result.error.message);
      return this.proposal(z.uuid().parse(result.data));
    }
    const payload = await this.prepareProposal(request);
    const { data, error } = await administrativeClient().rpc(
      'register_goal_proposal_v1',
      { p_owner: this.context.userId, p_request: request, p_payload: payload },
    );
    if (error) this.fail(error.message);
    return this.proposal(z.uuid().parse(data));
  }
  async prepareProposal(request: GoalMutation): Promise<GoalRevisionPayload> {
    if (request.action !== 'propose_state') {
      const source = await this.context.db
        .from('data_sources')
        .select('id')
        .eq('user_id', this.context.userId)
        .eq('id', request.definition.sourceId)
        .maybeSingle();
      if (source.error) this.fail(source.error.message);
      if (!source.data) this.fail('goal_not_found');
    }
    let payload: GoalRevisionPayload;
    if (request.action === 'propose_create') {
      const definition = GoalDefinitionSchema.parse(request.definition);
      const baseline = await this.baseline(definition);
      payload = {
        schemaVersion: 2,
        definition,
        baseline,
        state: baseline.value === null ? 'needs_data' : 'active',
        baselineResolution: 'replace',
        reviewedDataRevision: baseline.dataRevision,
      };
    } else {
      const { goal, revision } = await this.revision(request.goal_id);
      if (
        goal.version !== request.expected_version ||
        goal.state === 'archived'
      )
        this.fail('goal_conflict');
      const previous = GoalRevisionPayloadSchema.safeParse(revision.payload);
      if (!previous.success)
        throw new HttpFailure(
          409,
          'unsupported_revision',
          'This historical revision requires a fresh reviewed definition.',
        );
      const profile = await this.context.db
        .from('profiles')
        .select('data_revision')
        .eq('user_id', this.context.userId)
        .single();
      if (profile.error) this.fail(profile.error.message);
      if (request.action === 'propose_state') {
        if (
          !goalTransitions[goal.state]?.includes(request.state) ||
          (request.state === 'active' &&
            (goal.review_status !== 'clear' ||
              previous.data.baseline.value === null))
        )
          this.fail('goal_conflict');
        payload = {
          ...previous.data,
          state: request.state,
          baselineResolution: 'retain',
          reviewedDataRevision: profile.data.data_revision,
        };
      } else {
        const definition = GoalDefinitionSchema.parse(request.definition);
        if (
          request.baseline_resolution === 'retain' &&
          JSON.stringify({
            ...definition,
            title: '',
            target: null,
            targetDate: null,
            constraints: [],
            proposedStrategy: null,
            maxEvidenceAgeDays: null,
          }) !==
            JSON.stringify({
              ...previous.data.definition,
              title: '',
              target: null,
              targetDate: null,
              constraints: [],
              proposedStrategy: null,
              maxEvidenceAgeDays: null,
            })
        )
          throw new HttpFailure(
            400,
            'invalid_baseline',
            'Replace the baseline when changing its series or method.',
          );
        const baseline =
          request.baseline_resolution === 'retain'
            ? previous.data.baseline
            : await this.baseline(definition);
        if (
          request.baseline_resolution === 'replace' &&
          baseline.dataRevision !== profile.data.data_revision
        )
          this.fail('goal_conflict');
        payload = {
          schemaVersion: 2,
          definition,
          baseline,
          state:
            baseline.value === null && goal.state === 'active'
              ? 'needs_data'
              : goal.state === 'needs_data' && baseline.value !== null
                ? 'active'
                : (goal.state as GoalRevisionPayload['state']),
          baselineResolution: request.baseline_resolution,
          reviewedDataRevision: profile.data.data_revision,
        };
      }
    }
    const finalProfile = await this.context.db
      .from('profiles')
      .select('data_revision')
      .eq('user_id', this.context.userId)
      .single();
    if (finalProfile.error) this.fail(finalProfile.error.message);
    if (finalProfile.data.data_revision !== payload.reviewedDataRevision)
      this.fail('goal_conflict');
    if (!goalPolicyAllows(payload.definition))
      throw new HttpFailure(
        403,
        'goal_policy',
        'Vulpes cannot help pursue unsafe treatment or targets.',
      );
    return payload;
  }
  async decide(request: ApprovalRequest) {
    const current = await this.proposal(request.proposal_id);
    if (
      request.action === 'approve' &&
      current.state === 'pending' &&
      !goalPolicyAllows(current.canonical_payload)
    )
      throw new HttpFailure(
        403,
        'goal_policy',
        'This proposal cannot be approved.',
      );
    const { data, error } = await administrativeClient().rpc(
      'decide_goal_proposal_v1',
      { p_owner: this.context.userId, p_request: request },
    );
    if (error) this.fail(error.message);
    return data;
  }
  async chart(id: string) {
    const { revision } = await this.revision(id);
    const payload = GoalRevisionPayloadSchema.parse(revision.payload);
    const d = payload.definition;
    const to = Temporal.Now.instant()
      .toZonedDateTimeISO(d.timezone)
      .startOfDay()
      .add({ days: 1 });
    const selection = {
      metric: d.metric,
      source_id: d.sourceId,
      method: d.method,
      granularity: d.granularity,
      timezone: d.timezone,
      from: to.subtract({ days: 30 }).toInstant().toString(),
      to: to.toInstant().toString(),
    };
    return {
      summary: await readData(this.context, { view: 'summary', ...selection }),
      observations: await readData(this.context, {
        view: 'measurements',
        ...selection,
        page_size: 200,
      }),
    };
  }
  async progress(
    id: string,
  ): Promise<z.infer<typeof GoalProgressResultSchema>> {
    const { goal, revision } = await this.revision(id);
    if (goal.review_status !== 'clear')
      return { kind: 'unavailable', reason: 'needs_review' };
    const parsed = GoalRevisionPayloadSchema.safeParse(revision.payload);
    if (!parsed.success)
      return {
        kind: 'unavailable',
        reason: GoalDraftSchema.safeParse(revision.payload).success
          ? 'unsupported_baseline'
          : 'unsupported_revision',
      };
    const p = parsed.data;
    if (p.baseline.value === null) return { kind: 'insufficient_data' };
    const now = this.clock();
    const analysis = await this.valueAnalysis(
      p.definition,
      p.definition.currentMethod,
      true,
      now,
    );
    const fresh = await this.owned(id);
    if (
      fresh.version !== goal.version ||
      fresh.review_status !== 'clear' ||
      fresh.current_revision_id !== goal.current_revision_id
    )
      return { kind: 'unavailable', reason: 'needs_review' };
    const profile = await this.context.db
      .from('profiles')
      .select('data_revision')
      .eq('user_id', this.context.userId)
      .single();
    if (profile.error) this.fail(profile.error.message);
    if (profile.data.data_revision !== analysis.dataRevision)
      throw new HttpFailure(
        409,
        'data_changed',
        'Your measurements changed. Refresh goal progress.',
      );
    if (analysis.current.value === null) return { kind: 'insufficient_data' };
    const baselineDates = p.baseline.references
      .flatMap((reference) =>
        reference.observedAt ? [reference.observedAt] : [],
      )
      .sort((a, b) =>
        Temporal.Instant.compare(
          Temporal.Instant.from(a),
          Temporal.Instant.from(b),
        ),
      );
    const freshness = goalFreshness(
      analysis.current.oldestContributingAt,
      p.definition.maxEvidenceAgeDays,
      now.toString(),
    );
    const actualChange = new Exact(analysis.current.value).minus(
      p.baseline.value,
    );
    return GoalProgressResultSchema.parse({
      kind: 'progress',
      goalId: goal.id,
      goalVersion: goal.version,
      revision: revision.revision_number,
      baseline: p.baseline.value,
      current: analysis.current.value,
      dataRevision: analysis.dataRevision,
      result: goalProgress(
        p.baseline.value,
        analysis.current.value,
        p.definition.target,
      ),
      actualChange: actualChange.toFixed(),
      absoluteChangeUnit:
        metricRegistry[p.definition.metric].representation === 'percentage'
          ? 'percentage_points'
          : p.definition.unit,
      relativeChangePercent: new Exact(p.baseline.value).isZero()
        ? null
        : actualChange.div(p.baseline.value).mul(100).toFixed(),
      conditionMet:
        freshness.status !== 'stale' &&
        freshness.status !== 'unavailable' &&
        goalConditionMet(analysis.current.value, p.definition.target),
      freshness,
      baselineEvidence: {
        provenance: p.baseline.provenance,
        algorithmVersion: p.baseline.algorithmVersion,
        dataRevision: p.baseline.dataRevision,
        firstMeasuredAt: baselineDates[0] ?? null,
        lastMeasuredAt: baselineDates.at(-1) ?? null,
      },
      currentEvidence: {
        algorithmVersion: analysis.algorithmVersion,
        dataRevision: analysis.dataRevision,
        firstMeasuredAt: analysis.current.firstMeasuredAt,
        lastMeasuredAt: analysis.current.lastMeasuredAt,
        oldestContributingAt: analysis.current.oldestContributingAt,
        observationCount: analysis.current.observationCount,
        observedDays: analysis.current.observedDays,
        calendarDays: analysis.current.calendarDays,
        resultId: analysis.id,
      },
    });
  }
}

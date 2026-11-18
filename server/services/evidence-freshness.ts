import type { AuthContext } from '../auth/session.js';
import {
  ANALYSIS_VERSION,
  AnalysisBatchSchema,
} from '../../shared/analysis.js';
import {
  AgentGoalProgressToolResultSchema,
  AgentMetricExplanationsToolResultSchema,
} from '../../shared/agent-tools.js';
import { GoalGroupProgressSchema } from '../../shared/goal-groups.js';
import {
  METRIC_CONTENT_VERSION,
  METRIC_REGISTRY_VERSION,
} from '../../shared/metrics.js';
import { REFERENCE_RESOLVER_VERSION } from '../../shared/references.js';
import { REFERENCE_REGISTRY_VERSION } from '../config/metric-references.js';
import { GoalService } from './goals.js';
import { GoalGroupService } from './goal-groups.js';
import { GoalRevisionPayloadSchema } from '../../shared/goals.js';
import { ContextManifestSchema } from '../../shared/domain.js';
import { requestHash } from '../ai/ledger/execution.js';
import { readPayload } from '../security/private-payloads.js';
import { HttpFailure } from '../http/failure.js';
import type { GenerationRequest } from '../ai/contracts.js';

export type EvidenceProfile = {
  data_revision: number;
  timezone: string;
  units?: unknown;
};
const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

function compactPayload(input: unknown) {
  const parsed = GoalRevisionPayloadSchema.safeParse(input);
  if (!parsed.success) return null;
  const { references: _references, ...baseline } = parsed.data.baseline;
  void _references;
  return { ...parsed.data, baseline };
}
export async function selectedGoalContext(
  context: AuthContext,
  goalId: string,
) {
  const service = new GoalService(context);
  const goal = await service.owned(goalId);
  if (goal.state === 'draft' || !goal.current_revision_id)
    return {
      id: goal.id,
      version: goal.version,
      state: 'unavailable',
      reason: 'No approved goal revision is available.',
    };
  const { goal: current, revision } = await service.revision(goal.id);
  return {
    id: current.id,
    title: current.title,
    state: current.state,
    version: current.version,
    review_status: current.review_status,
    revision: {
      id: revision.id,
      revisionNumber: revision.revision_number,
      payload: compactPayload(revision.payload),
    },
  };
}
export async function selectedGroupContext(
  context: AuthContext,
  groupId: string,
) {
  const detail = await new GoalGroupService(context).detail(groupId);
  return {
    group: {
      id: detail.group.id,
      name: detail.group.name,
      version: detail.group.version,
      state: detail.group.state,
      review_status: detail.group.review_status,
    },
    members: detail.members.map((member) => ({
      goalId: member.membership.goal_id,
      position: member.membership.position,
      reviewedVersion: member.membership.reviewed_goal_version,
      reviewedRevisionId: member.membership.reviewed_revision_id,
      currentVersion: member.goal?.version ?? null,
      currentRevisionId: member.currentRevisionId,
      currentState: member.goal?.state ?? null,
    })),
  };
}

// Freshness is admission to a new answer, not a claim that an old trace was
// forged. Inspection may still show an authentic historical capture.
export async function evidenceIsCurrent(
  context: AuthContext,
  output: unknown,
  profile: EvidenceProfile,
): Promise<boolean> {
  const value = record(output);
  if (!value) return false;
  if (
    value.dataRevision !== undefined &&
    value.dataRevision !== profile.data_revision
  )
    return false;
  const analysisCurrent = (result: {
    algorithmVersion: string;
    registryVersion: string;
    dataRevision: number;
    timezone: string;
    id: string;
    evidence: { resultId: string; dataRevision: number };
  }) =>
    result.algorithmVersion === ANALYSIS_VERSION &&
    result.registryVersion === METRIC_REGISTRY_VERSION &&
    result.dataRevision === profile.data_revision &&
    result.timezone === profile.timezone &&
    result.evidence.resultId === result.id &&
    result.evidence.dataRevision === result.dataRevision;
  if (value.kind === 'analysis_batch') {
    const parsed = AnalysisBatchSchema.safeParse(value.data);
    return (
      parsed.success &&
      parsed.data.dataRevision === profile.data_revision &&
      parsed.data.results.every(analysisCurrent)
    );
  }
  if (value.kind === 'metric_explanations') {
    const parsed = AgentMetricExplanationsToolResultSchema.safeParse(output);
    if (
      !parsed.success ||
      value.contentVersion !== METRIC_CONTENT_VERSION ||
      value.referenceRegistryVersion !== REFERENCE_REGISTRY_VERSION
    )
      return false;
    return parsed.data.items.every(({ reference }) => {
      if (!reference) return true;
      if (
        reference.contentVersion !== METRIC_CONTENT_VERSION ||
        reference.referenceRegistryVersion !== REFERENCE_REGISTRY_VERSION ||
        reference.resolverVersion !== REFERENCE_RESOLVER_VERSION ||
        reference.dataRevision !== profile.data_revision ||
        reference.selection.timezone !== profile.timezone ||
        reference.evidence.referenceResultId !== reference.id ||
        reference.evidence.dataRevision !== profile.data_revision ||
        (reference.analysis && !analysisCurrent(reference.analysis))
      )
        return false;
      // The current service collects no reference profile attributes. A future
      // profile-based rule must supply a verifiable current basis before reuse.
      return (
        reference.classification.state !== 'applicable' ||
        (reference.classification.basis.kind === 'current_guidance' &&
          reference.classification.basis.profileVersion === null &&
          Object.keys(reference.classification.basis.attributes).length === 0)
      );
    });
  }
  if (value.kind === 'goal_progress') {
    const parsed = AgentGoalProgressToolResultSchema.safeParse(output);
    if (!parsed.success) return false;
    if (
      parsed.data.progress.kind === 'progress' &&
      ((parsed.data.progress.goalId !== undefined &&
        parsed.data.progress.goalId !== parsed.data.goalId) ||
        (parsed.data.progress.goalVersion !== undefined &&
          parsed.data.progress.goalVersion !== parsed.data.goalVersion) ||
        (parsed.data.progress.dataRevision !== undefined &&
          parsed.data.progress.dataRevision !== parsed.data.dataRevision))
    )
      return false;
    try {
      const current = await new GoalService(context).revision(
        parsed.data.goalId,
      );
      return (
        current.goal.version === parsed.data.goalVersion &&
        current.revision.id === parsed.data.revisionId
      );
    } catch (error) {
      if (error instanceof HttpFailure && error.status === 404) return false;
      throw error;
    }
  }
  if (value.kind === 'goal_proposal' || value.kind === 'goal_group_proposal') {
    const request = record(value.request);
    const payload = record(value.payload);
    const kinds: Record<string, string> = {
      propose_create: 'goal.create',
      propose_revision: 'goal.revise',
      propose_group_create: 'goal_group.create',
      propose_group_revision: 'goal_group.revise',
    };
    if (
      !request ||
      !payload ||
      typeof request.client_request_id !== 'string' ||
      payload.reviewedDataRevision !== profile.data_revision
    )
      return false;
    const expectedKind = kinds[String(request.action)];
    if (
      !expectedKind ||
      (value.kind === 'goal_group_proposal') !==
        expectedKind.startsWith('goal_group.')
    )
      return false;
    const proposal = await context.db
      .from('action_proposals')
      .select(
        'kind,state,source_step_id,canonical_payload,expires_at,target_id,group_target_id,target_version',
      )
      .eq('user_id', context.userId)
      .eq('source_step_id', request.client_request_id)
      .maybeSingle();
    if (proposal.error) throw unavailable();
    const current = proposal.data;
    if (
      !current ||
      current.kind !== expectedKind ||
      current.state !== 'pending' ||
      current.source_step_id !== request.client_request_id ||
      Date.parse(current.expires_at) <= Date.now() ||
      requestHash(current.canonical_payload) !== requestHash(payload)
    )
      return false;
    if (current.target_id || current.group_target_id) {
      const target = await context.db
        .from(current.group_target_id ? 'goal_groups' : 'goals')
        .select('version')
        .eq('user_id', context.userId)
        .eq('id', (current.group_target_id ?? current.target_id)!)
        .maybeSingle();
      if (target.error) throw unavailable();
      if (target.data?.version !== current.target_version) return false;
    }
    if (value.kind === 'goal_group_proposal') {
      if (
        !Array.isArray(payload.members) ||
        payload.members.length < 1 ||
        payload.members.length > 4
      )
        return false;
      for (const input of payload.members) {
        const member = record(input);
        if (!member) return false;
        if (member.kind === 'create') continue;
        if (typeof member.goalId !== 'string') return false;
        const goal = await context.db
          .from('goals')
          .select('version,current_revision_id,state')
          .eq('user_id', context.userId)
          .eq('id', member.goalId)
          .maybeSingle();
        if (goal.error) throw unavailable();
        if (
          !goal.data ||
          goal.data.version !== member.expectedVersion ||
          goal.data.current_revision_id !== member.revisionId ||
          goal.data.state === 'archived'
        )
          return false;
      }
    }
    return true;
  }
  if (value.kind === 'group_progress') {
    const parsed = GoalGroupProgressSchema.safeParse(output);
    if (!parsed.success) return false;
    const group = await context.db
      .from('goal_groups')
      .select('version,state')
      .eq('user_id', context.userId)
      .eq('id', parsed.data.groupId)
      .maybeSingle();
    if (group.error) throw unavailable();
    if (
      !group.data ||
      group.data.version !== parsed.data.groupVersion ||
      group.data.state !== parsed.data.administrativeState
    )
      return false;
    const members = await context.db
      .from('goal_group_members')
      .select('goal_id,position,reviewed_goal_version,reviewed_revision_id')
      .eq('user_id', context.userId)
      .eq('group_id', parsed.data.groupId)
      .order('position')
      .limit(5);
    if (members.error) throw unavailable();
    if (members.data.length !== parsed.data.members.length) return false;
    for (const saved of parsed.data.members) {
      const member = members.data.find((m) => m.position === saved.position);
      if (
        !member ||
        member.goal_id !== saved.goalId ||
        member.reviewed_goal_version !== saved.reviewedVersion ||
        member.reviewed_revision_id !== saved.reviewedRevisionId
      )
        return false;
      const goal = await context.db
        .from('goals')
        .select('version,current_revision_id,state')
        .eq('user_id', context.userId)
        .eq('id', saved.goalId)
        .maybeSingle();
      if (goal.error) throw unavailable();
      if (
        (goal.data?.version ?? null) !== saved.currentVersion ||
        (goal.data?.current_revision_id ?? null) !== saved.currentRevisionId ||
        (goal.data?.state ?? null) !== saved.state
      )
        return false;
    }
    return true;
  }
  // Legacy goal progress has no reliable identity for unavailable outcomes.
  // Excluding its complete history group is safer than recycling stale prose.
  if (
    ['progress', 'insufficient_data', 'unavailable'].includes(
      String(value.kind),
    )
  )
    return false;
  if (value.kind === 'metrics' && value.registryVersion !== undefined)
    return value.registryVersion === METRIC_REGISTRY_VERSION;
  if (value.kind === 'summary') {
    const data = record(value.data);
    const selection = record(data?.selection);
    return (
      data?.dataRevision === profile.data_revision &&
      selection?.timezone === profile.timezone
    );
  }
  if (value.kind === 'goals' || value.kind === 'goal_groups') {
    if (!Array.isArray(value.items) || value.items.length > 50) return false;
    for (const item of value.items) {
      const saved = record(item);
      if (
        !saved ||
        typeof saved.id !== 'string' ||
        typeof saved.version !== 'number'
      )
        return false;
      if (value.kind === 'goal_groups') {
        const current = await context.db
          .from('goal_groups')
          .select('version')
          .eq('user_id', context.userId)
          .eq('id', saved.id)
          .maybeSingle();
        if (current.error) throw unavailable();
        if (current.data?.version !== saved.version) return false;
      } else {
        try {
          const current = await new GoalService(context).revision(saved.id);
          if (
            current.goal.version !== saved.version ||
            current.revision.id !== saved.revisionId
          )
            return false;
        } catch (error) {
          if (error instanceof HttpFailure && error.status === 404)
            return false;
          throw error;
        }
      }
    }
    return true;
  }
  // Inventory/raw reads, safe tool errors and clarification outcomes have no
  // mutable goal dependencies; the enclosing run also binds data revision.
  return [
    'metrics',
    'measurements',
    'no_data',
    'clarification_required',
    'tool_error',
    'escalation_unavailable',
    'escalation_requested',
  ].includes(String(value.kind));
}

function unavailable() {
  return new HttpFailure(
    503,
    'context_unavailable',
    'Saved evidence could not be verified.',
  );
}

export interface HistoryEvidenceValidation {
  checked: Map<string, boolean>;
  visiting: Set<string>;
  remaining: number;
}
export async function runEvidenceIsCurrent(
  context: AuthContext,
  runId: string,
  profile: EvidenceProfile,
  saved?: GenerationRequest,
  validation: HistoryEvidenceValidation = {
    checked: new Map(),
    visiting: new Set(),
    remaining: 100,
  },
): Promise<boolean> {
  if (validation.visiting.has(runId) || validation.remaining <= 0) return false;
  if (!saved && validation.checked.has(runId))
    return validation.checked.get(runId)!;
  validation.remaining--;
  validation.visiting.add(runId);
  try {
    const valid = await validateRunEvidence(
      context,
      runId,
      profile,
      saved,
      validation,
    );
    validation.checked.set(runId, valid);
    return valid;
  } finally {
    validation.visiting.delete(runId);
  }
}
async function validateRunEvidence(
  context: AuthContext,
  runId: string,
  profile: EvidenceProfile,
  saved: GenerationRequest | undefined,
  validation: HistoryEvidenceValidation,
): Promise<boolean> {
  const generation = await context.db
    .from('ai_steps')
    .select('context_payload_id')
    .eq('user_id', context.userId)
    .eq('run_id', runId)
    .eq('step_type', 'generation')
    .order('sequence')
    .limit(1)
    .maybeSingle();
  if (generation.error) throw unavailable();
  if (generation.data?.context_payload_id) {
    const capture = await readPayload(
      context,
      generation.data.context_payload_id,
      'provider_state',
    );
    if (capture.state !== 'available') return false;
    let manifest;
    try {
      manifest = ContextManifestSchema.safeParse(
        JSON.parse(capture.bytes.toString('utf8')),
      );
    } catch {
      return false;
    }
    if (!manifest.success) return false;
    for (const item of manifest.data.included.filter(
      (item) =>
        (item.reference.kind === 'message' &&
          item.reference.label === 'Complete conversation group') ||
        (item.reference.kind === 'context_selection' &&
          item.reference.id.startsWith('analysis-scope:')),
    )) {
      const dependencyId = item.reference.id.replace(/^analysis-scope:/, '');
      const dependency = await context.db
        .from('ai_runs')
        .select('status,data_revision,trace_content_removed_at')
        .eq('user_id', context.userId)
        .eq('id', dependencyId)
        .maybeSingle();
      if (dependency.error) throw unavailable();
      if (
        dependency.data?.status !== 'completed' ||
        dependency.data.data_revision !== profile.data_revision ||
        dependency.data.trace_content_removed_at ||
        !(await runEvidenceIsCurrent(
          context,
          dependencyId,
          profile,
          undefined,
          validation,
        ))
      )
        return false;
    }
    const profileBinding = manifest.data.included.find(
      (item) => item.reference.id === 'profile:timezone_units',
    );
    if (
      manifest.data.dataRevision !== profile.data_revision ||
      (profileBinding && profileBinding.contentHash !== requestHash(profile))
    )
      return false;
    for (const item of manifest.data.included.filter(
      (item) => item.reference.kind === 'goal_context',
    )) {
      const [kind, id] = item.reference.id.split(':');
      if (!id || !['goal', 'group'].includes(kind!)) return false;
      try {
        const current =
          kind === 'goal'
            ? await selectedGoalContext(context, id)
            : await selectedGroupContext(context, id);
        if (requestHash(current) !== item.contentHash) return false;
      } catch (error) {
        if (error instanceof HttpFailure && error.status === 404) return false;
        throw error;
      }
    }
  } else if (generation.data) return false;
  const steps = await context.db
    .from('ai_steps')
    .select('id,status,output_payload_id')
    .eq('user_id', context.userId)
    .eq('run_id', runId)
    .eq('step_type', 'tool')
    .order('sequence')
    .limit(7);
  if (steps.error) throw unavailable();
  if (steps.data.length > 6) return false;
  for (const step of steps.data) {
    if (step.status !== 'completed' || !step.output_payload_id) return false;
    const payload = await readPayload(
      context,
      step.output_payload_id,
      'tool_output',
    );
    if (payload.state !== 'available') return false;
    let stored: Record<string, unknown> | null;
    try {
      stored = record(JSON.parse(payload.bytes.toString('utf8')));
    } catch {
      return false;
    }
    const evidence = record(stored?.evidence);
    if (
      !stored ||
      !evidence ||
      evidence.ownerId !== context.userId ||
      evidence.runId !== runId ||
      evidence.stepId !== step.id ||
      evidence.dataRevision !== profile.data_revision
    )
      return false;
    if (!(await evidenceIsCurrent(context, stored.result, profile)))
      return false;
    if (
      saved &&
      !saved.turns.some((turn) => {
        if (turn.type !== 'tool_result') return false;
        const result = record(turn.result);
        if (!result?.evidence || stored.providerResult === undefined)
          return false;
        return (
          requestHash(result?.evidence) === requestHash(stored.evidence) &&
          requestHash(result?.result) === requestHash(stored.providerResult)
        );
      })
    )
      return false;
  }
  return true;
}

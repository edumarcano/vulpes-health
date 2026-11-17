import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AuthContext } from '../../server/auth/session.js';
import {
  evidenceIsCurrent,
  runEvidenceIsCurrent,
} from '../../server/services/evidence-freshness.js';
import { calculateAnalysis } from '../../server/analytics/analysis.js';
import { analysisCardSnapshot } from '../../shared/agent-tools.js';
import { savedCardMatches } from '../../server/services/conversations.js';
import { GoalService } from '../../server/services/goals.js';
import { readPayload } from '../../server/security/private-payloads.js';
import { ChatPartSchema } from '../../shared/chat.js';
import { buildContext } from '../../server/ai/context.js';
import { chatSend } from '../fixtures/contracts.js';
import { ChatSendRequestSchema } from '../../shared/api.js';
import { METRIC_CONTENT_VERSION } from '../../shared/metrics.js';
import { REFERENCE_REGISTRY_VERSION } from '../../server/config/metric-references.js';
import { requestHash } from '../../server/ai/ledger/execution.js';

vi.mock('../../server/db/administrative.js', () => ({
  administrativeClient: () => ({}),
}));
vi.mock('../../server/security/private-payloads.js', () => ({
  readPayload: vi.fn(),
}));

const owner = '00000000-0000-4000-8000-000000000001';
const goalId = '00000000-0000-4000-8000-000000000002';
const revisionId = '00000000-0000-4000-8000-000000000003';
const runId = '00000000-0000-4000-8000-000000000004';
const stepId = '00000000-0000-4000-8000-000000000005';
const groupId = '00000000-0000-4000-8000-000000000006';
const profile = { data_revision: 7, timezone: 'UTC' };
const evidence = {
  version: 1,
  ownerId: owner,
  runId,
  stepId,
  resultId: '00000000-0000-4000-8000-000000000007',
  dataRevision: 7,
};
function fixture(records: Record<string, Record<string, unknown>[]>) {
  return {
    userId: owner,
    db: {
      from(table: string) {
        const filters: [string, unknown][] = [];
        const result = () =>
          (records[table] ?? []).filter((row) =>
            filters.every(
              ([key, value]) => row[key] === undefined || row[key] === value,
            ),
          );
        const query = {
          select: () => query,
          eq: (key: string, value: unknown) => {
            filters.push([key, value]);
            return query;
          },
          neq: () => query,
          order: () => query,
          limit: () => query,
          single: async () => ({ data: result()[0], error: null }),
          maybeSingle: async () => ({ data: result()[0] ?? null, error: null }),
          then: (resolve: (value: unknown) => unknown) =>
            Promise.resolve({ data: result(), error: null }).then(resolve),
        };
        return query;
      },
    } as unknown as AuthContext['db'],
  };
}
function analysis() {
  return calculateAnalysis(
    owner,
    {
      operation: 'latest_per_metric',
      timezone: 'UTC',
      series: {
        metric: 'weight',
        source_id: goalId,
        method: 'device_reported',
        granularity: 'instant',
      },
    },
    [],
    7,
    '2026-11-16T12:00:00Z',
    null,
  );
}
afterEach(() => vi.restoreAllMocks());

describe('saved evidence admission', () => {
  it('binds analysis algorithm, registry, timezone and data revision even without observations', async () => {
    const context = fixture({});
    const result = analysis();
    const output = {
      kind: 'analysis_batch',
      data: { schemaVersion: 1, dataRevision: 7, results: [result] },
    };
    expect(await evidenceIsCurrent(context, output, profile)).toBe(true);
    for (const patch of [
      { algorithmVersion: 'old-algorithm' },
      { registryVersion: 'old-registry' },
      { timezone: 'America/New_York' },
      { dataRevision: 6 },
      {
        evidence: {
          ...result.evidence,
          resultId: 'analysis:' + 'f'.repeat(64),
        },
      },
    ])
      expect(
        await evidenceIsCurrent(
          context,
          {
            ...output,
            data: { ...output.data, results: [{ ...result, ...patch }] },
          },
          profile,
        ),
      ).toBe(false);
  });

  it.each([
    { kind: 'unavailable', reason: 'needs_review' },
    { kind: 'insufficient_data' },
  ])(
    'does not reuse identity-free or independently revised goal outcomes %j',
    async (progress) => {
      const context = fixture({});
      const current = vi
        .spyOn(GoalService.prototype, 'revision')
        .mockResolvedValue({
          goal: { version: 1 },
          revision: { id: revisionId },
        } as Awaited<ReturnType<GoalService['revision']>>);
      const output = {
        kind: 'goal_progress',
        goalId,
        goalVersion: 1,
        revisionId,
        dataRevision: 7,
        progress,
      };
      expect(await evidenceIsCurrent(context, output, profile)).toBe(true);
      current.mockResolvedValue({
        goal: { version: 2 },
        revision: { id: revisionId },
      } as Awaited<ReturnType<GoalService['revision']>>);
      expect(await evidenceIsCurrent(context, output, profile)).toBe(false);
      expect(await evidenceIsCurrent(context, progress, profile)).toBe(false);
    },
  );

  it('checks group version, membership and current/reviewed child vectors separately', async () => {
    const records = {
      goal_groups: [{ id: groupId, version: 1, state: 'active' }],
      goal_group_members: [
        {
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
          version: 1,
          current_revision_id: revisionId,
          state: 'active',
        },
      ],
    };
    const output = {
      kind: 'group_progress',
      groupId,
      groupVersion: 1,
      dataRevision: 7,
      evaluatedAt: '2026-11-16T12:00:00Z',
      administrativeState: 'active',
      conditionStatus: 'unavailable',
      members: [
        {
          position: 1,
          goalId,
          reviewedVersion: 1,
          reviewedRevisionId: revisionId,
          currentVersion: 1,
          currentRevisionId: revisionId,
          state: 'active',
          title: 'Synthetic goal',
          outcome: 'needs_data',
          progress: null,
        },
      ],
    };
    const context = fixture(records);
    expect(await evidenceIsCurrent(context, output, profile)).toBe(true);
    records.goals[0]!.version = 2;
    expect(await evidenceIsCurrent(context, output, profile)).toBe(false);
    records.goals[0]!.version = 1;
    records.goal_group_members[0]!.reviewed_goal_version = 2;
    expect(await evidenceIsCurrent(context, output, profile)).toBe(false);
    records.goal_group_members[0]!.reviewed_goal_version = 1;
    records.goal_groups[0]!.version = 2;
    expect(await evidenceIsCurrent(context, output, profile)).toBe(false);
  });

  it('matches a compact analysis card to its exact encrypted full result and rejects altered values', () => {
    const result = analysis();
    const part = ChatPartSchema.parse({
      type: 'analysis_result',
      evidence,
      result: analysisCardSnapshot(result),
    });
    if (part.type !== 'analysis_result')
      throw new Error('Expected analysis card.');
    const output = {
      kind: 'analysis_batch',
      data: { schemaVersion: 1, dataRevision: 7, results: [result] },
    };
    expect(savedCardMatches(part, output)).toBe(true);
    expect(
      savedCardMatches(
        {
          ...part,
          result: { ...part.result, exclusionCount: 9 },
        } as typeof part,
        output,
      ),
    ).toBe(false);
  });

  it('invalidates definitions with no reference when explanation or reference content changes', async () => {
    const output = {
      kind: 'metric_explanations',
      dataRevision: 7,
      contentVersion: METRIC_CONTENT_VERSION,
      referenceRegistryVersion: REFERENCE_REGISTRY_VERSION,
      items: [
        {
          definition: {
            metric: 'weight',
            label: 'Weight',
            unit: 'kg',
            definition: 'Synthetic explanation',
            displayGroup: 'body_size',
            displayGroupLabel: 'Body size',
            analyticsEligible: true,
            goalEligible: true,
            limitations: [],
          },
          reference: null,
        },
      ],
    };
    const context = fixture({});
    expect(await evidenceIsCurrent(context, output, profile)).toBe(true);
    expect(
      await evidenceIsCurrent(
        context,
        { ...output, contentVersion: 'old' },
        profile,
      ),
    ).toBe(false);
    expect(
      await evidenceIsCurrent(
        context,
        { ...output, referenceRegistryVersion: 'old' },
        profile,
      ),
    ).toBe(false);
  });

  it('rejects removed, incomplete and wrong-owner encrypted tool captures', async () => {
    const records = {
      ai_steps: [
        {
          id: stepId,
          step_type: 'tool',
          status: 'completed',
          output_payload_id: revisionId,
        },
      ],
    };
    const context = fixture(records);
    const stored = {
      evidence,
      result: { kind: 'tool_error', code: 'invalid_arguments' },
      providerResult: { kind: 'tool_error', code: 'invalid_arguments' },
    };
    vi.mocked(readPayload).mockResolvedValue({
      state: 'available',
      bytes: Buffer.from(JSON.stringify(stored)),
    });
    expect(await runEvidenceIsCurrent(context, runId, profile)).toBe(true);
    const saved = {
      turns: [
        {
          type: 'tool_result' as const,
          callId: 'c1',
          name: 'list_metrics',
          result: { evidence, result: stored.providerResult },
        },
      ],
      tools: [],
      continuation: null,
    };
    expect(await runEvidenceIsCurrent(context, runId, profile, saved)).toBe(
      true,
    );
    saved.turns[0]!.result.result.code = 'tampered';
    expect(await runEvidenceIsCurrent(context, runId, profile, saved)).toBe(
      false,
    );
    vi.mocked(readPayload).mockResolvedValue({ state: 'expired' });
    expect(await runEvidenceIsCurrent(context, runId, profile)).toBe(false);
    vi.mocked(readPayload).mockResolvedValue({
      state: 'available',
      bytes: Buffer.from(
        JSON.stringify({
          ...stored,
          evidence: { ...evidence, ownerId: goalId },
        }),
      ),
    });
    expect(await runEvidenceIsCurrent(context, runId, profile)).toBe(false);
    records.ai_steps[0]!.status = 'started';
    expect(await runEvidenceIsCurrent(context, runId, profile)).toBe(false);
  });

  it('excludes the complete prior group after a goal change, preserving tool pairs and fresh user context', async () => {
    const context = fixture({
      profiles: [profile],
      messages: [
        {
          id: revisionId,
          run_id: runId,
          role: 'user',
          status: 'completed',
          context_state: 'eligible',
        },
        {
          id: goalId,
          run_id: runId,
          role: 'assistant',
          status: 'completed',
          context_state: 'eligible',
        },
      ],
      ai_runs: [
        {
          id: runId,
          status: 'completed',
          data_revision: 7,
          trace_content_removed_at: null,
        },
      ],
      ai_steps: [
        {
          id: stepId,
          step_type: 'tool',
          status: 'completed',
          output_payload_id: revisionId,
          continuation_payload_id: groupId,
        },
      ],
    });
    const saved = {
      turns: [
        { type: 'message', role: 'user', text: 'Previous synthetic question' },
        {
          type: 'tool_call',
          callId: 'c1',
          name: 'get_goal_progress',
          arguments: { goal_id: goalId },
        },
        {
          type: 'tool_result',
          callId: 'c1',
          name: 'get_goal_progress',
          result: {},
        },
        {
          type: 'message',
          role: 'assistant',
          text: 'Previous synthetic answer',
        },
      ],
      tools: [],
      continuation: null,
    };
    vi.mocked(readPayload).mockImplementation(async (_context, id) => ({
      state: 'available',
      bytes: Buffer.from(
        JSON.stringify(
          id === groupId
            ? saved
            : {
                evidence,
                result: {
                  kind: 'goal_progress',
                  goalId,
                  goalVersion: 1,
                  revisionId,
                  dataRevision: 7,
                  progress: { kind: 'insufficient_data' },
                },
              },
        ),
      ),
    }));
    vi.spyOn(GoalService.prototype, 'revision').mockResolvedValue({
      goal: { version: 2 },
      revision: { id: revisionId },
    } as Awaited<ReturnType<GoalService['revision']>>);
    const result = await buildContext(
      context,
      ChatSendRequestSchema.parse({ ...chatSend, context_selection: null }),
      evidence.resultId,
      [],
      12000,
    );
    expect(result.selected).toEqual([]);
    expect(result.manifest.excluded).toContainEqual({
      referenceId: runId,
      reason: 'evidence_changed_or_unverifiable',
    });
    expect(result.request.turns.map((turn) => turn.type)).toEqual([
      'message',
      'message',
      'message',
    ]);
  });

  it('invalidates selected-goal context even when the prior answer used no tools', async () => {
    const context = fixture({
      ai_steps: [
        { id: stepId, step_type: 'generation', context_payload_id: revisionId },
      ],
    });
    const saved = {
      id: goalId,
      version: 1,
      state: 'unavailable',
      reason: 'No approved goal revision is available.',
    };
    const owned = vi.spyOn(GoalService.prototype, 'owned').mockResolvedValue({
      id: goalId,
      version: 1,
      state: 'draft',
      current_revision_id: null,
    } as Awaited<ReturnType<GoalService['owned']>>);
    vi.mocked(readPayload).mockResolvedValue({
      state: 'available',
      bytes: Buffer.from(
        JSON.stringify({
          templateVersion: 'test',
          included: [
            {
              reference: {
                id: `goal:${goalId}`,
                kind: 'goal_context',
                label: 'Selected goal',
              },
              contentHash: requestHash(saved),
              tokenEstimate: 100,
            },
          ],
          excluded: [],
          retrieval: { ragUsed: false, webUsed: false },
          consentVersion: 'test',
          dataRevision: 7,
        }),
      ),
    });
    expect(await runEvidenceIsCurrent(context, runId, profile)).toBe(true);
    owned.mockResolvedValue({
      id: goalId,
      version: 2,
      state: 'draft',
      current_revision_id: null,
    } as Awaited<ReturnType<GoalService['owned']>>);
    expect(await runEvidenceIsCurrent(context, runId, profile)).toBe(false);
  });
  it('invalidates an answer derived from earlier goal context after that dependency changes', async () => {
    const dependentRun = evidence.resultId;
    const context = fixture({
      ai_runs: [
        {
          id: runId,
          status: 'completed',
          data_revision: 7,
          trace_content_removed_at: null,
        },
      ],
      ai_steps: [
        {
          id: stepId,
          run_id: runId,
          step_type: 'generation',
          context_payload_id: revisionId,
        },
        {
          id: groupId,
          run_id: dependentRun,
          step_type: 'generation',
          context_payload_id: groupId,
        },
      ],
    });
    const snapshot = {
      id: goalId,
      version: 1,
      state: 'unavailable',
      reason: 'No approved goal revision is available.',
    };
    const owned = vi.spyOn(GoalService.prototype, 'owned').mockResolvedValue({
      id: goalId,
      version: 1,
      state: 'draft',
      current_revision_id: null,
    } as Awaited<ReturnType<GoalService['owned']>>);
    vi.mocked(readPayload).mockImplementation(async (_context, id) => ({
      state: 'available',
      bytes: Buffer.from(
        JSON.stringify({
          templateVersion: 'test',
          included: [
            {
              reference:
                id === groupId
                  ? {
                      id: runId,
                      kind: 'message',
                      label: 'Complete conversation group',
                    }
                  : {
                      id: `goal:${goalId}`,
                      kind: 'goal_context',
                      label: 'Selected goal',
                    },
              contentHash: requestHash(snapshot),
              tokenEstimate: 100,
            },
          ],
          excluded: [],
          retrieval: { ragUsed: false, webUsed: false },
          consentVersion: 'test',
          dataRevision: 7,
        }),
      ),
    }));
    expect(await runEvidenceIsCurrent(context, dependentRun, profile)).toBe(
      true,
    );
    owned.mockResolvedValue({
      id: goalId,
      version: 2,
      state: 'draft',
      current_revision_id: null,
    } as Awaited<ReturnType<GoalService['owned']>>);
    expect(await runEvidenceIsCurrent(context, dependentRun, profile)).toBe(
      false,
    );
  });
  it('retains only the exact owned pending proposal for grounded editing follow-ups', async () => {
    const output = {
      kind: 'goal_proposal',
      request: { action: 'propose_create', client_request_id: stepId },
      payload: {
        reviewedDataRevision: 7,
        definition: { title: 'Synthetic reviewed proposal' },
      },
    };
    const proposal = {
      id: goalId,
      kind: 'goal.create',
      state: 'pending',
      source_step_id: stepId,
      canonical_payload: output.payload,
      expires_at: '2099-01-01T00:00:00Z',
      target_id: null,
      target_version: null,
    };
    const context = fixture({ action_proposals: [proposal] });
    expect(await evidenceIsCurrent(context, output, profile)).toBe(true);
    proposal.state = 'approved';
    expect(await evidenceIsCurrent(context, output, profile)).toBe(false);
    proposal.state = 'pending';
    proposal.canonical_payload = {
      ...output.payload,
      definition: { title: 'Changed terms' },
    };
    expect(await evidenceIsCurrent(context, output, profile)).toBe(false);
  });
});

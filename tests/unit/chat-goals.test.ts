import { describe, expect, it } from 'vitest';
import {
  toolArguments,
  readToolDefinitions,
  providerToolResult,
} from '../../server/ai/tools.js';
import { ChatPartSchema } from '../../shared/chat.js';
import { GoalDefinitionSchema } from '../../shared/goals.js';
import { boundContext } from '../../server/ai/context.js';
import { safetyInstructions } from '../../server/ai/prompts/everyday.js';
import { serializeEveryday } from '../../server/ai/providers/openrouter.js';
import { goalDraft } from '../fixtures/contracts.js';

describe('chat proposal authority and bounded catalogue', () => {
  it('describes comparable goal methods and rejects the observed mixed-method proposal', () => {
    const definition = {
      ...goalDraft,
      method: 'device_reported',
      granularity: 'instant',
      baselineMethod: 'daily_median_mean_7d',
      currentMethod: 'latest_value',
    };
    const mixed = toolArguments.propose_goal.safeParse({ definition });
    expect(mixed.success).toBe(false);
    if (!mixed.success)
      expect(mixed.error.issues).toContainEqual(
        expect.objectContaining({
          message: 'Keep baseline and current methods comparable.',
        }),
      );
    expect(safetyInstructions).toContain(
      'Calculated baselineMethod equals currentMethod; latest-value tracking uses latest_value',
    );
    for (const method of ['latest_value', 'daily_median_mean_7d'])
      expect(
        toolArguments.propose_goal.safeParse({
          definition: {
            ...definition,
            baselineMethod: method,
            currentMethod: method,
          },
        }).success,
      ).toBe(true);
  });
  it('exposes pending proposals only and rejects model-supplied authority', () => {
    const definition = GoalDefinitionSchema.parse({
      ...goalDraft,
      method: 'device_reported',
      granularity: 'instant',
      currentMethod: 'daily_median_mean_7d',
    });
    expect(toolArguments.propose_goal.safeParse({ definition }).success).toBe(
      true,
    );
    for (const extra of [
      { ownerId: goalDraft.sourceId },
      { state: 'active' },
      { baseline: { value: '70' } },
      { client_request_id: goalDraft.sourceId },
      { run_id: goalDraft.sourceId },
    ])
      expect(
        toolArguments.propose_goal.safeParse({ definition, ...extra }).success,
      ).toBe(false);
    expect(readToolDefinitions.map((x) => x.name)).toEqual([
      'request_escalation',
      'list_metrics',
      'get_measurements',
      'summarize_metric',
      'list_goals',
      'get_goal_progress',
      'propose_goal',
      'propose_goal_revision',
    ]);
    expect(
      toolArguments.propose_goal_revision.safeParse({
        goal_id: goalDraft.sourceId,
        expected_revision: 1,
        changes: { title: 'Revised' },
        baseline_resolution: 'retain',
      }).success,
    ).toBe(false);
    expect(
      toolArguments.propose_goal_revision.safeParse({
        goal_id: goalDraft.sourceId,
        expected_version: 1,
        changes: { title: 'Revised' },
        baseline_resolution: 'retain',
        rationale: 'Explain the requested change.',
      }).success,
    ).toBe(true);
    expect(
      ChatPartSchema.safeParse({
        type: 'goal_proposal',
        proposal: { state: 'approved' },
      }).success,
    ).toBe(false);
  });
  it('fits the full catalogue and a proposal continuation without increasing limits', () => {
    const definition = GoalDefinitionSchema.parse({
      ...goalDraft,
      method: 'device_reported',
      granularity: 'instant',
      currentMethod: 'daily_median_mean_7d',
    });
    const essential = {
      turns: [
        {
          type: 'message' as const,
          role: 'system' as const,
          text: safetyInstructions,
        },
        {
          type: 'message' as const,
          role: 'user' as const,
          text: 'Propose a target for my explicit review.',
        },
      ],
      tools: readToolDefinitions,
      continuation: null,
    };
    const result = {
      kind: 'goal_proposal',
      status: 'pending',
      title: 'Synthetic target',
      requiresUserConfirmation: true,
    };
    const request = boundContext(
      {
        ...essential,
        turns: [
          ...essential.turns,
          {
            type: 'tool_call',
            callId: 'proposal',
            name: 'propose_goal',
            arguments: toolArguments.propose_goal.parse({ definition }),
          },
          {
            type: 'tool_result',
            callId: 'proposal',
            name: 'propose_goal',
            result,
          },
        ],
      },
      [],
      11000,
    ).request;
    expect(serializeEveryday(request).byteLength).toBeLessThanOrEqual(12000);
    expect(() =>
      boundContext(
        {
          ...essential,
          turns: [
            ...essential.turns,
            { type: 'message', role: 'user', text: 'x'.repeat(11000) },
          ],
        },
        [],
        11000,
      ),
    ).toThrow('essential context');
  });
  it('keeps trusted baselines and mutation input out of the provider projection', () => {
    const definition = GoalDefinitionSchema.parse({
      ...goalDraft,
      method: 'device_reported',
      granularity: 'instant',
      currentMethod: 'daily_median_mean_7d',
    });
    const result = {
      kind: 'goal_proposal',
      request: {
        action: 'propose_create',
        client_request_id: goalDraft.sourceId,
        definition,
      },
      payload: {
        schemaVersion: 2,
        definition,
        baseline: {
          schemaVersion: 2,
          selection: {
            metric: 'weight',
            source_id: goalDraft.sourceId,
            from: '2026-09-01T00:00:00Z',
            to: '2026-09-08T00:00:00Z',
            timezone: 'UTC',
            method: 'device_reported',
            granularity: 'instant',
          },
          value: '70',
          dataRevision: 0,
          algorithmVersion: 'daily_median_mean_7d_v1',
          provenance: 'calculated',
          references: [],
        },
        state: 'active',
        baselineResolution: 'replace',
        reviewedDataRevision: 0,
      },
    };
    expect(providerToolResult(result)).toEqual({
      kind: 'goal_proposal',
      status: 'pending',
      title: definition.title,
      requiresUserConfirmation: true,
    });
    expect(providerToolResult(result, 2)).toBe(result);
  });
});

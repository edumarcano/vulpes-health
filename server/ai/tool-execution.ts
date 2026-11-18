import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';
import { ChatPartSchema, type ChatPart } from '../../shared/chat.js';
import { DataSummarySchema } from '../../shared/data.js';
import { GoalProgressResultSchema } from '../../shared/goal-progress.js';
import {
  AgentAnalysisToolResultSchema,
  AgentGoalProgressToolResultSchema,
  analysisCardSnapshot,
} from '../../shared/agent-tools.js';
import {
  GoalGroupProgressSchema,
  GoalGroupProposalToolResultSchema,
} from '../../shared/goal-groups.js';
import { GoalProposalToolResultSchema } from '../../shared/goals.js';
import { MAX_PAYLOAD_BYTES } from '../security/encryption.js';
import type { StreamEvent } from '../../shared/stream.js';
import type { AuthContext } from '../auth/session.js';
import { HttpFailure } from '../http/failure.js';
import type { GenerationEvent } from './contracts.js';
import type { ExecutionService, PreparedStep } from './ledger/execution.js';
import {
  executeReadTool,
  prepareGoalTool,
  providerToolResult,
  ToolErrorResultSchema,
  ToolValidationFailure,
  toolProjectionVersion,
} from './tools.js';

type ToolCall = Extract<GenerationEvent, { type: 'tool.call' }>['call'];
type ToolEvent = StreamEvent extends infer E
  ? E extends StreamEvent
    ? Omit<E, 'v' | 'seq' | 'run_id'>
    : never
  : never;

// This boundary catches input validation only. Persistence, authorization,
// cancellation and accounting failures must reach the run's fail-closed path.
async function toolOutput(
  context: AuthContext,
  call: ToolCall,
  stepId: string,
  clock?: () => Temporal.Instant,
) {
  try {
    return call.name === 'prepare_goals' ||
      call.name === 'propose_goal' ||
      call.name === 'propose_goal_revision'
      ? await prepareGoalTool(context, call.name, call.arguments, stepId, clock)
      : await executeReadTool(context, call.name, call.arguments, clock);
  } catch (error) {
    if (error instanceof ToolValidationFailure)
      return ToolErrorResultSchema.parse({
        kind: 'tool_error',
        code: error.code,
        recoverable: true,
        hint: error.hint,
      });
    if (
      error instanceof HttpFailure &&
      error.status === 400 &&
      error.code === 'invalid_interval'
    )
      return ToolErrorResultSchema.parse({
        kind: 'tool_error',
        code: 'invalid_interval',
        recoverable: true,
        hint: 'Use the required complete local-day baseline interval in profile.timezone, with a DST-correct offset at each boundary.',
      });
    throw error;
  }
}

export async function executeToolStep(input: {
  context: AuthContext;
  ledger: ExecutionService;
  step: PreparedStep;
  call: ToolCall;
  dataRevision: number;
  messageId: string;
  parts: ChatPart[];
  signal: AbortSignal;
  clock?: (() => Temporal.Instant) | undefined;
}) {
  const { context, ledger, step, call, dataRevision, messageId, signal } =
    input;
  let parts = [...input.parts];
  signal.throwIfAborted();
  const output = await toolOutput(context, call, step.id, input.clock);
  signal.throwIfAborted();
  const recoverable = ToolErrorResultSchema.safeParse(output).success;
  const proposing =
    !recoverable &&
    (GoalProposalToolResultSchema.safeParse(output).success ||
      GoalGroupProposalToolResultSchema.safeParse(output).success);
  const evidence = {
    version: 1 as const,
    ownerId: context.userId,
    runId: step.lease.runId,
    stepId: step.id,
    resultId: randomUUID(),
    dataRevision,
  };
  const result = {
    evidence,
    result: JSON.parse(JSON.stringify(providerToolResult(output))) as z.infer<
      ReturnType<typeof z.json>
    >,
  };
  const trace = {
    projectionVersion: toolProjectionVersion,
    evidence,
    result: output,
    providerResult: result.result,
  };
  if (Buffer.byteLength(JSON.stringify(trace)) > MAX_PAYLOAD_BYTES)
    throw new HttpFailure(
      413,
      'response_too_large',
      'Narrow the selected metrics or interval to retain complete tool evidence.',
    );
  const events: ToolEvent[] = [];
  const summary = z
    .object({ kind: z.literal('summary'), data: DataSummarySchema })
    .safeParse(output);
  if (summary.success && summary.data.data.dataRevision !== dataRevision)
    throw new Error('data_changed');
  const analysis = AgentAnalysisToolResultSchema.safeParse(output);
  const goalProgress = AgentGoalProgressToolResultSchema.safeParse(output);
  const groupProgress = GoalGroupProgressSchema.safeParse(output);
  if (
    output &&
    typeof output === 'object' &&
    'dataRevision' in output &&
    output.dataRevision !== dataRevision
  )
    throw new Error('data_changed');
  if (
    (analysis.success && analysis.data.data.dataRevision !== dataRevision) ||
    (goalProgress.success && goalProgress.data.dataRevision !== dataRevision) ||
    (groupProgress.success && groupProgress.data.dataRevision !== dataRevision)
  )
    throw new Error('data_changed');
  if (proposing) {
    const saved = await ledger.checkpointGoal(step, output, trace);
    parts = saved.parts;
    events.push({
      type: 'card.ready',
      payload: {
        message_id: messageId,
        card: GoalGroupProposalToolResultSchema.safeParse(output).success
          ? { type: 'goal_group_proposal', reference: saved.reference }
          : { type: 'goal_proposal', reference: saved.reference },
      },
    });
  } else {
    await ledger.checkpoint(step, Buffer.from(JSON.stringify(trace)));
    await ledger.settle(step, null, 'completed');
  }
  const readParts: ChatPart[] = [];
  if (analysis.success) {
    for (const item of analysis.data.data.results) {
      const result =
        item.kind === 'series_analysis' ? analysisCardSnapshot(item) : item;
      readParts.push({ type: 'analysis_result', evidence, result });
      events.push({
        type: 'card.ready',
        payload: {
          message_id: messageId,
          card: { type: 'analysis_result', evidence, result },
        },
      });
    }
  }
  if (goalProgress.success) {
    const {
      goalId,
      goalVersion,
      revisionId,
      progress: result,
    } = goalProgress.data;
    readParts.push({
      type: 'goal_progress',
      evidence,
      goalId,
      goalVersion,
      revisionId,
      result,
    });
    events.push({
      type: 'card.ready',
      payload: {
        message_id: messageId,
        card: {
          type: 'goal_progress',
          evidence,
          goalId,
          goalVersion,
          revisionId,
          result,
        },
      },
    });
  }
  if (groupProgress.success) {
    readParts.push({
      type: 'goal_group_progress',
      evidence,
      result: groupProgress.data,
    });
    events.push({
      type: 'card.ready',
      payload: {
        message_id: messageId,
        card: {
          type: 'goal_group_progress',
          evidence,
          result: groupProgress.data,
        },
      },
    });
  }
  if (readParts.length) {
    parts.push(...readParts.map((part) => ChatPartSchema.parse(part)));
    await ledger.checkpointMessage(step.lease, parts);
  }
  if (summary.success) {
    parts.push(
      ChatPartSchema.parse({
        type: 'metric_summary',
        evidence,
        result: summary.data.data,
      }),
    );
    await ledger.checkpointMessage(step.lease, parts);
    events.push({
      type: 'card.ready',
      payload: {
        message_id: messageId,
        card: { type: 'metric_trend', result: summary.data.data.analysis },
      },
    });
  }
  if (
    call.name === 'get_goal_progress' &&
    !recoverable &&
    !goalProgress.success &&
    !groupProgress.success
  ) {
    const goalId = z
      .strictObject({ goal_id: z.uuid() })
      .parse(call.arguments).goal_id;
    const progress = GoalProgressResultSchema.parse(output);
    parts.push({ type: 'goal_progress', evidence, goalId, result: progress });
    await ledger.checkpointMessage(step.lease, parts);
    events.push({
      type: 'card.ready',
      payload: {
        message_id: messageId,
        card: { type: 'goal_progress', goalId, result: progress },
      },
    });
  }
  signal.throwIfAborted();
  events.push({
    type: 'tool.result',
    payload: {
      step_id: step.id,
      tool_name: call.name,
      result_reference: `analysis:${step.id}`,
      summary: recoverable
        ? 'Tool arguments need correction; safe feedback saved.'
        : proposing
          ? 'Pending proposal saved. Explicit review and confirmation required.'
          : summary.success
            ? 'Deterministic summary saved with source and coverage.'
            : 'Read-only result saved.',
    },
  });
  return { parts, evidence, output, result, events };
}

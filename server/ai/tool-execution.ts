import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { ChatPartSchema, type ChatPart } from '../../shared/chat.js';
import { DataSummarySchema } from '../../shared/data.js';
import { GoalProgressResultSchema } from '../../shared/goal-progress.js';
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
) {
  try {
    return call.name === 'propose_goal' || call.name === 'propose_goal_revision'
      ? await prepareGoalTool(context, call.name, call.arguments, stepId)
      : await executeReadTool(context, call.name, call.arguments);
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
}) {
  const { context, ledger, step, call, dataRevision, messageId, signal } =
    input;
  let parts = [...input.parts];
  signal.throwIfAborted();
  const output = await toolOutput(context, call, step.id);
  signal.throwIfAborted();
  const recoverable = ToolErrorResultSchema.safeParse(output).success;
  const proposing =
    !recoverable &&
    (call.name === 'propose_goal' || call.name === 'propose_goal_revision');
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
  const events: ToolEvent[] = [];
  const summary = z
    .object({ kind: z.literal('summary'), data: DataSummarySchema })
    .safeParse(output);
  if (summary.success && summary.data.data.dataRevision !== dataRevision)
    throw new Error('data_changed');
  if (proposing) {
    const saved = await ledger.checkpointGoal(step, output, trace);
    parts = saved.parts;
    events.push({
      type: 'card.ready',
      payload: {
        message_id: messageId,
        card: { type: 'goal_proposal', reference: saved.reference },
      },
    });
  } else {
    await ledger.checkpoint(step, Buffer.from(JSON.stringify(trace)));
    await ledger.settle(step, null, 'completed');
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
  if (call.name === 'get_goal_progress' && !recoverable) {
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

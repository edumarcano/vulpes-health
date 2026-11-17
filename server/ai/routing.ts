import { z } from 'zod';
import { DataSummarySchema } from '../../shared/data.js';
import { GoalProgressResultSchema } from '../../shared/goal-progress.js';
import {
  AgentAnalysisToolResultSchema,
  AgentGoalProgressToolResultSchema,
} from '../../shared/agent-tools.js';
import { GoalGroupProgressSchema } from '../../shared/goal-groups.js';

export const EscalationRequestSchema = z.strictObject({
  task: z.enum(['goal_progress_review', 'multi_metric_comparison']),
  rationale: z.string().trim().min(1).max(400),
  evidenceIds: z.array(z.uuid()).min(1).max(6),
});
export type EscalationRequest = z.infer<typeof EscalationRequestSchema>;
export interface RoutingEvidence {
  id: string;
  result: unknown;
}
export function qualifiesForFlash(
  request: EscalationRequest,
  evidence: RoutingEvidence[],
): boolean {
  const selected = request.evidenceIds.map((id) =>
    evidence.find((item) => item.id === id),
  );
  if (
    new Set(request.evidenceIds).size !== request.evidenceIds.length ||
    selected.some((item) => !item)
  )
    return false;
  if (request.task === 'goal_progress_review')
    return selected.some(
      (item) =>
        GoalProgressResultSchema.safeParse(item!.result).data?.kind ===
          'progress' ||
        AgentGoalProgressToolResultSchema.safeParse(item!.result).data?.progress
          .kind === 'progress' ||
        GoalGroupProgressSchema.safeParse(item!.result).success,
    );
  const metrics = new Set<string>();
  for (const item of selected) {
    const batch = AgentAnalysisToolResultSchema.safeParse(item!.result);
    if (batch.success)
      for (const result of batch.data.data.results)
        if (result.kind === 'series_analysis' && result.current.value !== null)
          metrics.add(result.series.metric);
    const summary = z
      .object({ kind: z.literal('summary'), data: DataSummarySchema })
      .safeParse(item!.result);
    if (summary.success && summary.data.data.analysis.value !== null)
      metrics.add(summary.data.data.selection.metric);
  }
  return metrics.size >= 2;
}

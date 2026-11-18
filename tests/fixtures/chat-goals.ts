import type { RequestTransport } from '../../server/ai/ledger/dispatcher.js';
import {
  responseFrame,
  assistantOutput,
  syntheticInventorySeries,
} from './chat.js';
import { Temporal } from '@js-temporal/polyfill';
import { GoalDefinitionSchema } from '../../shared/goals.js';

// Scripted provider boundary, never imported by production composition.
export class SyntheticGoalTransport implements RequestTransport {
  readonly mode = 'mock';
  readonly requests: Buffer[] = [];
  constructor(
    private readonly scenario:
      | 'goal_create'
      | 'goal_revise'
      | 'goal_progress'
      | 'goal_yes' = 'goal_create',
  ) {}
  async *send(body: Uint8Array, signal: AbortSignal) {
    signal.throwIfAborted();
    this.requests.push(Buffer.from(body));
    const request = JSON.parse(Buffer.from(body).toString());
    const input = request.input as Array<{
      type?: string;
      output?: string;
      role?: string;
      content?: string;
    }>;
    const start = input.findLastIndex((x) => x.role === 'user');
    const text = String(input[start]?.content ?? '');
    const results = input
      .slice(start)
      .filter((x) => x.type === 'function_call_output')
      .map((x) => JSON.parse(x.output!).result);
    const call = (name: string, args: unknown) => ({
      type: 'function_call',
      id: 'item-' + name,
      call_id: 'call-' + name,
      name,
      arguments: JSON.stringify(args),
    });
    if (this.scenario === 'goal_yes') {
      yield responseFrame([
        assistantOutput(
          'Use the matching goal proposal card to review and explicitly approve. Your message alone applies no change.',
        ),
      ]);
      return;
    }
    if (results.some((x) => x.kind === 'goal_proposal')) {
      yield responseFrame([
        assistantOutput(
          'A pending goal proposal is ready. Review every field and use its confirmation button; no goal has changed.',
        ),
      ]);
      return;
    }
    if (this.scenario === 'goal_create') {
      const inventory = results.findLast((x) => x.kind === 'metrics');
      if (!inventory) {
        yield responseFrame([call('list_metrics', {})]);
        return;
      }
      const wanted = text.match(/source:([0-9a-f-]{36})/i)?.[1];
      const series = syntheticInventorySeries(inventory).find(
        (x: { metric: string; source_id: string }) =>
          x.metric === 'weight' && (!wanted || x.source_id === wanted),
      );
      if (!series) {
        yield responseFrame([
          assistantOutput('Choose an observed source before proposing a goal.'),
        ]);
        return;
      }
      yield responseFrame([
        call('prepare_goals', {
          members: [
            {
              kind: 'create',
              definition: {
                title: 'Synthetic chat goal',
                metric: 'weight',
                source_id: series.source_id,
                method: series.method,
                granularity: series.granularity,
                target: { direction: 'decrease_to', value: 68 },
                baseline_method: 'daily_median_mean_7d',
                baseline_from: '2026-09-01',
                baseline_to: '2026-09-08',
                target_date: null,
                constraints: ['Keep the selected source'],
                strategy: 'Review observed trends',
              },
            },
          ],
        }),
      ]);
      return;
    }
    const goals = results.findLast((x) => x.kind === 'goals');
    if (!goals) {
      yield responseFrame([call('list_goals', { kind: 'single' })]);
      return;
    }
    const goal = goals.items.find(
      (x: { title: string }) => x.title === 'Synthetic chat goal',
    );
    if (!goal) {
      yield responseFrame([assistantOutput('Choose an approved goal first.')]);
      return;
    }
    if (this.scenario === 'goal_revise') {
      const definition = GoalDefinitionSchema.parse(goal.definition);
      const localDate = (instant: string | null) => {
        if (!instant)
          throw new Error(
            'Synthetic computed baseline requires its approved interval.',
          );
        return Temporal.Instant.from(instant)
          .toZonedDateTimeISO(definition.timezone)
          .toPlainDate()
          .toString();
      };
      yield responseFrame([
        call('prepare_goals', {
          members: [
            {
              kind: 'revise',
              goal_id: goal.id,
              expected_version: goal.version,
              baseline_resolution: 'retain',
              definition: {
                title: definition.title,
                metric: definition.metric,
                source_id: definition.sourceId,
                method: definition.method,
                granularity: definition.granularity,
                target: { direction: 'decrease_to', value: 67 },
                baseline_method: definition.baselineMethod,
                ...(definition.baselineMethod === 'user_reported'
                  ? { reported_baseline: definition.reportedBaseline }
                  : {
                      baseline_from: localDate(definition.baselineFrom),
                      baseline_to: localDate(definition.baselineTo),
                    }),
                target_date: definition.targetDate,
                constraints: definition.constraints,
                strategy: definition.proposedStrategy,
                max_evidence_age_days: definition.maxEvidenceAgeDays,
              },
            },
          ],
        }),
      ]);
      return;
    }
    if (results.some((x) => x.kind === 'goal_progress')) {
      yield responseFrame([
        assistantOutput(
          'The deterministic goal progress is saved with its calculation status.',
        ),
      ]);
      return;
    }
    yield responseFrame([call('get_goal_progress', { goal_id: goal.id })]);
  }
}

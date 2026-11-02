import type { RequestTransport } from '../../server/ai/ledger/dispatcher.js';
import { responseFrame, assistantOutput } from './chat.js';

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
      const series = inventory.items.find(
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
        call('propose_goal', {
          definition: {
            schemaVersion: 1,
            title: 'Synthetic chat goal',
            metric: 'weight',
            unit: 'kg',
            sourceId: series.source_id,
            method: series.method,
            granularity: series.granularity,
            target: { direction: 'decrease_to', value: 68 },
            baselineMethod: 'daily_median_mean_7d',
            currentMethod: 'daily_median_mean_7d',
            baselineFrom: '2026-09-01T00:00:00Z',
            baselineTo: '2026-09-08T00:00:00Z',
            reportedBaseline: null,
            timezone: 'UTC',
            targetDate: null,
            constraints: ['Keep the selected source'],
            proposedStrategy: 'Review observed trends',
          },
        }),
      ]);
      return;
    }
    const goals = results.findLast((x) => x.kind === 'goals');
    if (!goals) {
      yield responseFrame([call('list_goals', {})]);
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
      yield responseFrame([
        call('propose_goal_revision', {
          goal_id: goal.id,
          expected_version: goal.version,
          changes: { target: { direction: 'decrease_to', value: 67 } },
          baseline_resolution: 'retain',
          rationale: 'Review the requested target adjustment.',
        }),
      ]);
      return;
    }
    if (
      results.some((x) =>
        ['progress', 'insufficient_data', 'unavailable'].includes(x.kind),
      )
    ) {
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

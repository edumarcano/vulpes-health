import type { RequestTransport } from '../../server/ai/ledger/dispatcher.js';
import {
  assistantOutput,
  responseFrame,
  syntheticInventorySeries,
} from './chat.js';

export type V020ChatScenario =
  'v020_panel' | 'v020_group_create' | 'v020_group_progress';

// This scripted boundary exercises application orchestration and never scores
// the answer quality or safety of an actual provider model.
export class SyntheticV020Transport implements RequestTransport {
  readonly mode = 'mock';
  readonly requests: Buffer[] = [];
  constructor(private readonly scenario: V020ChatScenario) {}
  async *send(body: Uint8Array, signal: AbortSignal) {
    signal.throwIfAborted();
    this.requests.push(Buffer.from(body));
    const request = JSON.parse(Buffer.from(body).toString());
    const input = request.input as {
      role?: string;
      content?: string;
      type?: string;
      output?: string;
    }[];
    const start = input.findLastIndex((item) => item.role === 'user');
    const text = input[start]?.content ?? '';
    const results = input
      .slice(start)
      .filter((item) => item.type === 'function_call_output')
      .map((item) => JSON.parse(item.output!).result);
    const call = (name: string, args: unknown) => ({
      type: 'function_call',
      id: 'item-' + name,
      call_id: 'call-' + name,
      name,
      arguments: JSON.stringify(args),
    });
    if (
      results.some((result) =>
        ['analysis_batch', 'goal_group_proposal', 'group_progress'].includes(
          result.kind,
        ),
      )
    ) {
      yield responseFrame([
        assistantOutput(
          this.scenario === 'v020_group_create'
            ? 'The pending group proposal is ready. Review every member and approve the matching card explicitly; no goal has changed.'
            : 'The deterministic evidence is saved below with its dates and coverage. This is personal wellness information, not a diagnosis.',
        ),
      ]);
      return;
    }
    if (this.scenario === 'v020_group_progress') {
      const groups = results.findLast(
        (result) => result.kind === 'goal_groups',
      );
      if (!groups) yield responseFrame([call('list_goals', { kind: 'group' })]);
      else {
        const selected = text.match(/group:([0-9a-f-]{36})/i)?.[1];
        const group = groups.items.find((item: { id: string; name: string }) =>
          selected
            ? item.id === selected
            : item.name === 'Synthetic v0.2 Ask group',
        );
        if (!group) throw new Error('Synthetic group selection is missing.');
        yield responseFrame([
          call('get_goal_progress', { group_id: group.id }),
        ]);
      }
      return;
    }
    const inventory = results.findLast((result) => result.kind === 'metrics');
    if (!inventory) {
      yield responseFrame([call('list_metrics', {})]);
      return;
    }
    const series = syntheticInventorySeries(inventory);
    const selected = text.match(/source:([0-9a-f-]{36})/i)?.[1];
    const source =
      selected ?? series.find((item) => item.metric === 'weight')?.source_id;
    if (!source) throw new Error('Synthetic source selection is missing.');
    if (this.scenario === 'v020_panel') {
      yield responseFrame([
        call('analyze_measurements', {
          operation: 'latest_event',
          source_id: source,
        }),
      ]);
      return;
    }
    yield responseFrame([
      call('prepare_goals', {
        group: { name: 'Synthetic v0.2 Ask group' },
        members: [
          {
            metric: 'weight',
            title: 'Synthetic v0.2 weight target',
            baseline: 70,
            target: 65,
          },
          {
            metric: 'body_fat_percent',
            title: 'Synthetic v0.2 body-fat target',
            baseline: 25,
            target: 18,
          },
        ].map((member) => {
          const observed = series.find(
            (item) =>
              item.source_id === source && item.metric === member.metric,
          );
          if (!observed)
            throw new Error('Synthetic goal member series is missing.');
          return {
            kind: 'create',
            definition: {
              metric: member.metric,
              source_id: source,
              method: observed.method,
              granularity: observed.granularity,
              title: member.title,
              target: { direction: 'decrease_to', value: member.target },
              baseline_method: 'user_reported',
              reported_baseline: member.baseline,
              constraints: [
                'Synthetic user-reported baseline, reviewed explicitly',
              ],
            },
          };
        }),
      }),
    ]);
  }
}

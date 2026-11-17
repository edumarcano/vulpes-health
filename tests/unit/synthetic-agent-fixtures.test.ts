import { describe, expect, it } from 'vitest';
import { SyntheticChatTransport } from '../fixtures/chat.js';
import { SyntheticGoalTransport } from '../fixtures/chat-goals.js';
import { agentToolArguments } from '../../shared/agent-tools.js';
import { GoalDefinitionSchema } from '../../shared/goals.js';
import { goalDraft } from '../fixtures/contracts.js';
import { providerToolResult } from '../../server/ai/tools.js';
import type { RequestTransport } from '../../server/ai/ledger/dispatcher.js';

const source = '00000000-0000-4000-8000-000000000001';
const inventory = providerToolResult({
  kind: 'metrics',
  dataRevision: 7,
  registryVersion: 'synthetic-registry',
  items: [
    {
      metric: 'weight',
      source_id: source,
      source_label: 'Synthetic scale',
      method: 'device_reported',
      granularity: 'instant',
      observations: 7,
      first_at: '2026-09-01T00:00:00Z',
      last_at: '2026-09-14T00:00:00Z',
    },
  ],
  registry: [{ metric: 'weight', unit: 'kg', analyticsEligible: true }],
  nextCursor: null,
  limits: {},
});
async function output(transport: RequestTransport, results: unknown[]) {
  const chunks: Uint8Array[] = [];
  for await (const chunk of transport.send(
    Buffer.from(
      JSON.stringify({
        input: [
          { role: 'user', content: 'Synthetic test request' },
          ...results.map((result) => ({
            type: 'function_call_output',
            output: JSON.stringify({ result }),
          })),
        ],
      }),
    ),
    new AbortController().signal,
  ))
    chunks.push(chunk);
  return JSON.parse(Buffer.concat(chunks).toString().split('data: ')[1]!.trim())
    .response.output as {
    name?: string;
    arguments?: string;
    content?: { text: string }[];
  }[];
}
describe('scripted provider fixtures use the frozen v0.2 tools', () => {
  it('uses columnar inventory and explicit rolling comparison, preserving its grounded answer', async () => {
    const transport = new SyntheticChatTransport();
    expect((await output(transport, []))[0]).toMatchObject({
      name: 'list_metrics',
    });
    const call = (await output(transport, [inventory])).find(
      (item) => item.name,
    )!;
    expect(call.name).toBe('analyze_measurements');
    expect(
      agentToolArguments.analyze_measurements.parse(
        JSON.parse(call.arguments!),
      ),
    ).toMatchObject({
      operation: 'period_comparison',
      metrics: ['weight'],
      source_id: source,
      comparison_method: 'rolling_7d',
      from: '2026-09-08',
      to: '2026-09-15',
    });
    const answer = await output(transport, [
      inventory,
      {
        kind: 'analysis_batch',
        windowColumns: ['value'],
        resultColumns: ['current', 'absoluteChange'],
        resultConstants: {},
        results: [[['69'], '-0.7']],
      },
    ]);
    expect(answer[0]?.content?.[0]?.text).toContain(
      'seven-day mean 69 kg; change -0.7 kg',
    );
  });
  it('requests raw rows with profile-local date inputs', async () => {
    const call = (
      await output(new SyntheticChatTransport('measurements'), [inventory])
    )[0]!;
    expect(call.name).toBe('get_measurements');
    expect(
      agentToolArguments.get_measurements.parse(JSON.parse(call.arguments!)),
    ).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-15',
      source_id: source,
    });
  });
  it('prepares one canonical pending goal and retains approved baseline terms on revision', async () => {
    const create = (
      await output(new SyntheticGoalTransport(), [inventory])
    )[0]!;
    expect(create.name).toBe('prepare_goals');
    expect(
      agentToolArguments.prepare_goals.parse(JSON.parse(create.arguments!)),
    ).toMatchObject({
      members: [
        {
          kind: 'create',
          definition: {
            title: 'Synthetic chat goal',
            baseline_method: 'daily_median_mean_7d',
            baseline_from: '2026-09-01',
            baseline_to: '2026-09-08',
            target: { value: 68 },
          },
        },
      ],
    });
    const definition = GoalDefinitionSchema.parse({
      ...goalDraft,
      title: 'Synthetic chat goal',
      baselineMethod: 'daily_median_mean_7d',
      currentMethod: 'daily_median_mean_7d',
      baselineFrom: '2026-09-01T00:00:00Z',
      baselineTo: '2026-09-08T00:00:00Z',
      timezone: 'UTC',
      method: 'device_reported',
      granularity: 'instant',
    });
    const revise = (
      await output(new SyntheticGoalTransport('goal_revise'), [
        {
          kind: 'goals',
          items: [
            { id: source, version: 2, title: definition.title, definition },
          ],
        },
      ])
    )[0]!;
    expect(revise.name).toBe('prepare_goals');
    expect(
      agentToolArguments.prepare_goals.parse(JSON.parse(revise.arguments!)),
    ).toMatchObject({
      members: [
        {
          kind: 'revise',
          expected_version: 2,
          baseline_resolution: 'retain',
          definition: {
            title: definition.title,
            target: { value: 67 },
            baseline_from: '2026-09-01',
            baseline_to: '2026-09-08',
          },
        },
      ],
    });
  });
  it('recognizes wrapped unavailable goal progress and finishes without repeating a read', async () => {
    const answer = await output(new SyntheticGoalTransport('goal_progress'), [
      { kind: 'goals', items: [{ id: source, title: 'Synthetic chat goal' }] },
      {
        kind: 'goal_progress',
        goalId: source,
        goalVersion: 2,
        progress: { kind: 'unavailable' },
      },
    ]);
    expect(answer[0]?.content?.[0]?.text).toContain('calculation status');
    expect(answer.some((item) => item.name)).toBe(false);
  });
});

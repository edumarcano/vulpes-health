import type { RequestTransport } from '../../server/ai/ledger/dispatcher.js';
import type { AgentDependencies } from '../../server/ai/VulpesAgent.js';
import { OpenRouterResponsesAdapter } from '../../server/ai/providers/openrouter.js';
import { models } from '../../server/config/models.js';
import { syntheticPrice } from './executions.js';

export function responseFrame(
  output: unknown[],
  usage: unknown = { input_tokens: 50, output_tokens: 20, cost: '0.001' },
  type = 'response.completed',
): Buffer {
  return Buffer.from(
    `event: ${type}\ndata: ${JSON.stringify({ type, response: { status: type === 'response.completed' ? 'completed' : 'incomplete', output, usage } })}\n\n`,
  );
}
export const assistantOutput = (text: string) => ({
  type: 'message',
  id: 'message-synthetic',
  role: 'assistant',
  content: [{ type: 'output_text', text }],
});
export class SyntheticChatTransport implements RequestTransport {
  readonly mode = 'mock';
  readonly requests: Buffer[] = [];
  constructor(
    private readonly scenario:
      | 'complete'
      | 'measurements'
      | 'truncated'
      | 'missing_usage'
      | 'malformed'
      | 'repeated_call'
      | 'unsafe_text'
      | 'markdown'
      | 'slow' = 'complete',
    private readonly barrier?: { started: () => void; wait: Promise<void> },
  ) {}
  async *send(body: Uint8Array, signal: AbortSignal) {
    signal.throwIfAborted();
    this.requests.push(Buffer.from(body));
    if (this.scenario === 'slow') {
      yield Buffer.from(
        'data: ' +
          JSON.stringify({
            type: 'response.output_text.delta',
            delta: 'Saved synthetic partial response.',
          }) +
          '\n\n',
      );
      await new Promise<never>((_, reject) => {
        if (signal.aborted) reject(new Error('aborted'));
        else
          signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
      });
      return;
    }
    if (this.barrier) {
      this.barrier.started();
      await Promise.race([
        this.barrier.wait,
        new Promise<never>((_, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')), {
            once: true,
          });
        }),
      ]);
      signal.throwIfAborted();
    }
    if (this.scenario === 'malformed') {
      yield Buffer.from('data: {invalid}\n\n');
      return;
    }
    if (this.scenario === 'repeated_call' && this.requests.length > 1) {
      yield responseFrame([
        {
          type: 'function_call',
          id: 'repeated',
          call_id: 'call-inventory',
          name: 'list_metrics',
          arguments: '{}',
        },
      ]);
      return;
    }
    if (this.scenario === 'truncated') {
      yield Buffer.from(
        'data: ' +
          JSON.stringify({
            type: 'response.output_text.delta',
            delta: 'Durable synthetic prefix 🦊',
          }) +
          '\n\n',
      );
      return;
    }
    if (this.scenario === 'unsafe_text') {
      yield responseFrame([
        assistantOutput(
          '<img src=x onerror=alert(1)> [unsafe](javascript:alert(1)) analysis:00000000-0000-4000-8000-000000000000',
        ),
      ]);
      return;
    }
    if (this.scenario === 'markdown') {
      const text =
        '## Synthetic Markdown\n\nA **bold** and *emphasized* response with `inline code`.\n\n- First item\n- Second item\n\n1. Ordered item\n\n> Synthetic quote\n\n| Metric | Value |\n| --- | --- |\n| Weight | 70 kg |\n\n```ts\nconst value = 70;\n```\n\n[Documentation](https://example.com/docs)\n\n![Synthetic image](https://example.com/private-image.png)';
      for (const delta of [text.slice(0, 40), text.slice(40)]) {
        yield Buffer.from(
          'data: ' +
            JSON.stringify({ type: 'response.output_text.delta', delta }) +
            '\n\n',
        );
      }
      yield responseFrame([assistantOutput(text)]);
      return;
    }
    if (this.scenario === 'missing_usage') {
      yield responseFrame(
        [assistantOutput('Synthetic response with unknown usage.')],
        null,
      );
      return;
    }
    const request = JSON.parse(Buffer.from(body).toString()) as {
      input: Array<{
        type?: string;
        output?: string;
        role?: string;
        content?: string;
      }>;
    };
    const results = request.input
      .filter((item) => item.type === 'function_call_output')
      .map(
        (item) =>
          JSON.parse(item.output!) as {
            result: {
              kind: string;
              items?: Array<{
                source_id: string;
                method: string;
                granularity: string;
                metric: string;
              }>;
              data?: {
                analysis: {
                  value: number | null;
                  absoluteChange: number | null;
                  coverageStatus: string;
                };
              };
            };
          },
      );
    const summary = results.findLast((item) => item.result.kind === 'summary');
    const metrics = results.findLast((item) => item.result.kind === 'metrics');
    let output: unknown[];
    if (summary) {
      const analysis = summary.result.data!.analysis;
      output = [
        assistantOutput(
          analysis.value === null
            ? 'There are not enough observed days to calculate this trend.'
            : `Calculated from your imported measurements: seven-day mean ${analysis.value} kg; change ${analysis.absoluteChange} kg. This is a deterministic summary, not a diagnosis.`,
        ),
      ];
    } else if (
      metrics &&
      this.scenario === 'measurements' &&
      !results.some((item) => item.result.kind === 'measurements')
    ) {
      const source = metrics.result.items!.find(
        (item) => item.metric === 'weight',
      )!;
      output = [
        {
          type: 'function_call',
          id: 'item-measurements',
          call_id: 'call-measurements',
          name: 'get_measurements',
          arguments: JSON.stringify({
            metric: 'weight',
            source_id: source.source_id,
            method: source.method,
            granularity: source.granularity,
            from: '2026-09-01T00:00:00Z',
            to: '2026-09-15T00:00:00Z',
            timezone: 'UTC',
            limit: 200,
          }),
        },
      ];
    } else if (metrics) {
      const source = metrics.result.items?.find(
        (item) => item.metric === 'weight',
      );
      output = source
        ? [
            {
              type: 'reasoning',
              id: 'reasoning-synthetic',
              encrypted_content: 'synthetic-opaque-continuation',
            },
            {
              type: 'function_call',
              id: 'item-summary',
              call_id:
                this.scenario === 'repeated_call'
                  ? 'call-inventory'
                  : 'call-summary',
              name: 'summarize_metric',
              arguments: JSON.stringify({
                metric: 'weight',
                source_id: source.source_id,
                method: source.method,
                granularity: source.granularity,
                from: '2026-09-08T00:00:00Z',
                to: '2026-09-15T00:00:00Z',
                timezone: 'UTC',
              }),
            },
          ]
        : [
            assistantOutput(
              'There are no weight measurements available. I cannot invent a trend.',
            ),
          ];
    } else
      output = [
        {
          type: 'function_call',
          id: 'item-inventory',
          call_id: 'call-inventory',
          name: 'list_metrics',
          arguments: '{}',
        },
      ];
    const bytes = responseFrame(output);
    const midpoint = Math.min(27, bytes.length);
    yield bytes.subarray(0, midpoint);
    yield bytes.subarray(midpoint);
  }
}
export function syntheticChatDependencies(
  transport: RequestTransport = new SyntheticChatTransport(),
): AgentDependencies {
  return {
    adapter: new OpenRouterResponsesAdapter(),
    transport,
    maxRunCostUSD: '0.25',
    price: {
      ...syntheticPrice,
      inputPerMillion: '0.1',
      outputPerMillion: '0.1',
      cacheReadPerMillion: '0.1',
      inputBoundTokens: models.everyday.maxInputTokens,
      outputBoundTokens: models.everyday.maxOutputTokens,
    },
  };
}

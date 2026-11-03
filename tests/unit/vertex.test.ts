import { issueVertexVerificationTransport } from '../../server/ai/providers/vertex-verification.js';
import type { AuthContext } from '../../server/auth/session.js';
import { describe, it, expect } from 'vitest';
import {
  VertexGenerationAdapter,
  vertexEndpoint,
  serializeVertex,
  isVertexEndpoint,
  vertexUsage,
} from '../../server/ai/providers/vertex.js';
import {
  EscalationRequestSchema,
  qualifiesForFlash,
} from '../../server/ai/routing.js';
import type {
  GenerationRequest,
  GenerationEvent,
} from '../../server/ai/contracts.js';

const request: GenerationRequest = {
  turns: [
    { type: 'message', role: 'system', text: 'Synthetic safety' },
    { type: 'message', role: 'user', text: 'Synthetic question' },
  ],
  tools: [],
  continuation: null,
};
const endpoint = vertexEndpoint('synthetic-project', 'us', 'intermediate');
async function run(frames: unknown[], input = request) {
  const bodies: Uint8Array[] = [];
  const events: GenerationEvent[] = [];
  const wire = Buffer.from(
    frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join(''),
  );
  const adapter = new VertexGenerationAdapter('intermediate', endpoint);
  for await (const event of adapter.generate(input, {
    signal: new AbortController().signal,
    dispatch: {
      async *send(value) {
        bodies.push(value.body);
        for (let i = 0; i < wire.length; i += 3) yield wire.subarray(i, i + 3);
      },
    },
  }))
    events.push(event);
  return { bodies, events };
}
describe('Vertex wire boundary', () => {
  it('rejects live issuance before credential discovery or network access', async () => {
    const context = null as unknown as AuthContext;
    const batch = '11111111-1111-4111-8111-111111111111';
    await expect(
      issueVertexVerificationTransport(
        'intermediate',
        context,
        batch,
        '0.01',
        'synthetic',
        false,
        {},
      ),
    ).rejects.toThrow('live_opt_in_required');
    await expect(
      issueVertexVerificationTransport(
        'advanced',
        context,
        batch,
        '0.01',
        'synthetic',
        true,
        { VULPES_LIVE_AI_ENABLED: 'true' },
      ),
    ).rejects.toThrow('price_unverified');
  });
  it('maps catalog controls without generic sampling parameters or provider storage', () => {
    const body = JSON.parse(
      Buffer.from(
        serializeVertex(
          {
            ...request,
            tools: [
              {
                name: 'synthetic_tool',
                description: 'Synthetic JSON tool',
                parameters: {
                  type: 'object',
                  properties: { mode: { const: 'safe' } },
                  additionalProperties: false,
                },
              },
            ],
          },
          'advanced',
        ),
      ).toString(),
    );
    expect(
      body.tools[0].functionDeclarations[0].parametersJsonSchema.properties
        .mode,
    ).toEqual({ const: 'safe' });
    expect(body.tools[0].functionDeclarations[0]).not.toHaveProperty(
      'parameters',
    );
    expect(body.generationConfig).toEqual({
      maxOutputTokens: 12288,
      thinkingConfig: { thinkingLevel: 'MEDIUM' },
    });
    expect(body.systemInstruction.parts).toEqual([
      { text: 'Synthetic safety' },
    ]);
    expect(body.contents).toHaveLength(1);
    expect(isVertexEndpoint(endpoint)).toBe(true);
    for (const value of [
      endpoint.replace('https:', 'http:'),
      endpoint.replace('us-aiplatform', 'evil'),
      endpoint + '&key=secret',
      endpoint.replace('synthetic-project', 'x'),
    ])
      expect(isVertexEndpoint(value)).toBe(false);
  });
  it('parses fragmented UTF-8, hides thought text and retains signed tool parts in continuation', async () => {
    const signature = 'synthetic-signature';
    const call = { id: 'call-1', name: 'list_metrics', args: {} };
    const result = await run([
      {
        candidates: [
          {
            content: {
              role: 'model',
              parts: [
                { text: 'Private thought', thought: true },
                { functionCall: call, thoughtSignature: signature },
              ],
            },
            finishReason: 'STOP',
          },
        ],
        usageMetadata: {
          promptTokenCount: 20,
          candidatesTokenCount: 2,
          thoughtsTokenCount: 3,
          cachedContentTokenCount: 0,
        },
        modelVersion: 'synthetic-model',
        responseId: 'synthetic-request',
      },
    ]);
    expect(result.bodies).toHaveLength(1);
    expect(result.events.some((e) => e.type === 'text.delta')).toBe(false);
    expect(result.events.find((e) => e.type === 'tool.call')).toEqual({
      type: 'tool.call',
      call: { callId: 'call-1', name: 'list_metrics', arguments: {} },
    });
    const done = result.events.at(-1);
    expect(done?.type).toBe('completed');
    if (done?.type !== 'completed') throw new Error('missing completion');
    const follow = {
      ...request,
      turns: [
        ...request.turns,
        {
          type: 'tool_call' as const,
          callId: 'call-1',
          name: 'list_metrics',
          arguments: {},
        },
        {
          type: 'tool_result' as const,
          callId: 'call-1',
          name: 'list_metrics',
          result: { kind: 'metrics' },
        },
      ],
      continuation: done.continuation,
    };
    const body = JSON.parse(
      Buffer.from(serializeVertex(follow, 'intermediate')).toString(),
    );
    expect(body.contents[1].parts[1].thoughtSignature).toBe(signature);
    expect(() => serializeVertex(follow, 'advanced')).toThrow(
      'incompatible_continuation',
    );
    expect(body.contents[2].parts[0].functionResponse.id).toBe('call-1');
  });
  it.each(['CONTINUATION', 'MAX_TOKENS'])(
    'stops %s without dispatching a long decode',
    async (finishReason) => {
      const result = await run([
        {
          candidates: [
            {
              content: { parts: [{ text: 'partial' }] },
              finishReason,
              continuationToken: 'synthetic-token',
            },
          ],
        },
      ]);
      expect(result.bodies).toHaveLength(1);
      expect(result.events.at(-1)).toMatchObject({
        type: 'completed',
        finishReason: 'length',
      });
    },
  );
  it('fails truncated and malformed output without a retry', async () => {
    await expect(
      run([{ candidates: [{ content: { parts: [{ text: 'partial' }] } }] }]),
    ).rejects.toThrow('provider_stream_truncated');
    await expect(
      run([
        {
          candidates: [
            {
              content: {
                parts: [{ functionCall: { name: 'list_metrics', args: {} } }],
              },
              finishReason: 'STOP',
            },
          ],
        },
      ]),
    ).rejects.toThrow();
  });
  it.each(['provider_auth_denied', 'provider_timeout'])(
    'propagates %s once without retry',
    async (code) => {
      let sends = 0;
      const adapter = new VertexGenerationAdapter('intermediate', endpoint);
      const execute = async () => {
        for await (const event of adapter.generate(request, {
          signal: new AbortController().signal,
          dispatch: {
            async *send() {
              sends++;
              yield* [];
              throw new Error(code);
            },
          },
        }))
          void event;
      };
      await expect(execute()).rejects.toThrow(code);
      expect(sends).toBe(1);
    },
  );
  it('preserves unknown usage rather than assuming cache writes or reasoning are free', () => {
    expect(
      vertexUsage({
        promptTokenCount: 20,
        candidatesTokenCount: 2,
        thoughtsTokenCount: 3,
      }),
    ).toMatchObject({
      inputTokens: 20,
      outputTokens: 2,
      reasoningTokens: 3,
      reasoningIsOutputSubset: false,
      cacheWriteTokens: null,
      reportedCostUSD: null,
    });
  });
});
describe('bounded Flash eligibility', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  const input = EscalationRequestSchema.parse({
    task: 'goal_progress_review',
    rationale: 'Review the observed progress',
    evidenceIds: [id],
  });
  it('rejects absent, foreign and insufficient evidence', () => {
    expect(qualifiesForFlash(input, [])).toBe(false);
    expect(
      qualifiesForFlash(input, [{ id, result: { kind: 'insufficient_data' } }]),
    ).toBe(false);
    expect(
      EscalationRequestSchema.safeParse({ ...input, target: 'advanced' })
        .success,
    ).toBe(false);
  });
});

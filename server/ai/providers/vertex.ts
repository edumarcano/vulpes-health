import { z } from 'zod';
import { models } from '../../config/models.js';
import { blocksOf, continuationFor } from '../continuation.js';
import {
  normalizeUsage,
  requireGenerationCapabilities,
  ToolCallSchema,
  type GenerationAdapter,
  type GenerationEvent,
  type GenerationRequest,
} from '../contracts.js';
import type { PaidRequestDispatcher } from '../ledger/dispatcher.js';

export const vertexAdapterVersion = 'vertex-generate-content-v1';
export {
  vertexEndpoint,
  isVertexEndpoint,
} from '../../config/vertex-endpoint.js';
import { isVertexEndpoint } from '../../config/vertex-endpoint.js';
export function serializeVertex(
  input: GenerationRequest,
  role: 'intermediate' | 'advanced',
): Uint8Array {
  const request = requireGenerationCapabilities(
    {
      family: 'vertex_generate_content',
      capabilities: { streaming: true, tools: true },
    },
    input,
  );
  if (
    request.continuation?.model &&
    request.continuation.model !== models[role].modelId
  )
    throw new Error('incompatible_continuation');
  const system: string[] = [];
  const contents: unknown[] = [];
  const blocks = blocksOf(request.continuation);
  let end = 0;
  for (const block of blocks) {
    if (block.at < end || block.at + block.count > request.turns.length)
      throw new Error('invalid_continuation');
    end = block.at + block.count;
  }
  for (let i = 0; i < request.turns.length; i++) {
    const block = blocks.find((item) => item.at === i);
    if (block) {
      contents.push(...block.items);
      i += block.count - 1;
      continue;
    }
    const turn = request.turns[i]!;
    if (turn.type === 'message' && turn.role === 'system') {
      system.push(turn.text);
      continue;
    }
    const part =
      turn.type === 'message'
        ? { text: turn.text }
        : turn.type === 'tool_call'
          ? {
              functionCall: {
                id: turn.callId,
                name: turn.name,
                args: turn.arguments,
              },
            }
          : {
              functionResponse: {
                id: turn.callId,
                name: turn.name,
                response: { result: turn.result },
              },
            };
    contents.push({
      role:
        turn.type === 'tool_call' ||
        (turn.type === 'message' && turn.role === 'assistant')
          ? 'model'
          : 'user',
      parts: [part],
    });
  }
  return Buffer.from(
    JSON.stringify({
      systemInstruction: { parts: system.map((text) => ({ text })) },
      contents,
      ...(request.tools.length
        ? {
            tools: [
              {
                functionDeclarations: request.tools.map((tool) => ({
                  name: tool.name,
                  description: tool.description,
                  parametersJsonSchema: tool.parameters,
                })),
              },
            ],
          }
        : {}),
      generationConfig: {
        maxOutputTokens: models[role].maxOutputTokens,
        thinkingConfig: { thinkingLevel: models[role].thinking.level },
      },
    }),
  );
}
const count = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export function vertexUsage(raw: unknown) {
  const usage = z
    .object({
      promptTokenCount: count.optional(),
      candidatesTokenCount: count.optional(),
      thoughtsTokenCount: count.optional(),
      cachedContentTokenCount: count.optional(),
    })
    .passthrough()
    .parse(raw);
  // Vertex reports thoughts separately from candidates. Unknown categories stay unknown.
  return normalizeUsage({
    inputTokens: usage.promptTokenCount ?? null,
    outputTokens: usage.candidatesTokenCount ?? null,
    reasoningTokens: usage.thoughtsTokenCount ?? null,
    cacheReadTokens: usage.cachedContentTokenCount ?? null,
    cacheWriteTokens: null,
    reasoningIsOutputSubset: false,
    cacheReadIsInputSubset: true,
    cacheWriteIsInputSubset: null,
    rawUsage: raw,
  });
}
export class VertexGenerationAdapter implements GenerationAdapter {
  readonly family = 'vertex_generate_content';
  readonly capabilities = { streaming: true, tools: true };
  constructor(
    readonly role: 'intermediate' | 'advanced',
    readonly endpoint: string,
  ) {
    if (
      !isVertexEndpoint(endpoint) ||
      !endpoint.includes(`/models/${models[role].modelId}:`)
    )
      throw new Error('unapproved_endpoint');
  }
  async *generate(
    request: GenerationRequest,
    options: { signal: AbortSignal; dispatch: PaidRequestDispatcher },
  ): AsyncIterable<GenerationEvent> {
    const decoder = new TextDecoder('utf-8', { fatal: true });
    let buffer = '';
    let size = 0;
    let finished: string | null = null;
    let usage: unknown = null;
    let responseId: string | null = null;
    let model: string | null = null;
    const parts: z.infer<ReturnType<typeof z.json>>[] = [];
    const calls: z.infer<typeof ToolCallSchema>[] = [];
    let text = '';
    const parse = (frame: string): GenerationEvent[] => {
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trimStart())
        .join('\n');
      if (!data) return [];
      const raw = z
        .object({
          responseId: z.string().optional(),
          modelVersion: z.string().optional(),
          usageMetadata: z.json().optional(),
          promptFeedback: z
            .object({ blockReason: z.string().optional() })
            .optional(),
          candidates: z
            .array(
              z.object({
                index: z.number().optional(),
                finishReason: z.string().optional(),
                content: z
                  .object({
                    role: z.literal('model').optional(),
                    parts: z.array(z.json()),
                  })
                  .optional(),
              }),
            )
            .max(1)
            .optional(),
        })
        .parse(JSON.parse(data));
      if (raw.responseId) responseId = raw.responseId;
      if (raw.modelVersion) model = raw.modelVersion;
      if (raw.usageMetadata !== undefined) usage = raw.usageMetadata;
      if (raw.promptFeedback?.blockReason) {
        if (finished) throw new Error('duplicate_finish');
        finished = 'SAFETY';
      }
      const candidate = raw.candidates?.[0];
      if (!candidate) return [];
      if (finished) throw new Error('provider_event_after_terminal');
      const events: GenerationEvent[] = [];
      for (const value of candidate.content?.parts ?? []) {
        const part = z
          .object({
            text: z.string().optional(),
            thought: z.boolean().optional(),
            thoughtSignature: z.string().optional(),
            functionCall: z
              .object({
                id: z.string().min(1),
                name: z.string().min(1),
                args: z.json(),
              })
              .optional(),
          })
          .passthrough()
          .parse(value);
        parts.push(value);
        if (part.functionCall) {
          const call = ToolCallSchema.parse({
            callId: part.functionCall.id,
            name: part.functionCall.name,
            arguments: part.functionCall.args,
          });
          if (calls.some((item) => item.callId === call.callId))
            throw new Error('repeated_tool_call');
          calls.push(call);
        }
        if (part.text && !part.thought) {
          text += part.text;
          if (Buffer.byteLength(text) > 65536) throw new Error('output_limit');
          events.push({ type: 'text.delta', text: part.text });
        }
      }
      if (candidate.finishReason) finished = candidate.finishReason;
      return events;
    };
    for await (const chunk of options.dispatch.send(
      {
        body: serializeVertex(request, this.role),
        adapterVersion: vertexAdapterVersion,
        requestedEffort: models[this.role].thinking.level,
        metadata: {
          endpoint: this.endpoint,
          headers: {
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          redactedHeaders: ['authorization'],
        },
      },
      options.signal,
    )) {
      options.signal.throwIfAborted();
      size += chunk.byteLength;
      if (size > 4 * 1024 * 1024) throw new Error('provider_stream_limit');
      buffer = (buffer + decoder.decode(chunk, { stream: true })).replace(
        /\r\n/g,
        '\n',
      );
      let boundary: number;
      while ((boundary = buffer.indexOf('\n\n')) !== -1) {
        const frame = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        yield* parse(frame);
      }
    }
    buffer += decoder.decode();
    if (buffer.trim() || !finished)
      throw new Error('provider_stream_truncated');
    const blocked = [
      'SAFETY',
      'RECITATION',
      'BLOCKLIST',
      'PROHIBITED_CONTENT',
      'SPII',
    ].includes(finished);
    const length = ['MAX_TOKENS', 'CONTINUATION'].includes(finished);
    if (!blocked && !length && finished !== 'STOP')
      throw new Error('unsupported_finish_reason');
    if (!blocked && !length && !text && !calls.length)
      throw new Error('empty_response');
    if (!blocked && !length)
      for (const call of calls) yield { type: 'tool.call', call };
    if (usage !== null) yield { type: 'usage', usage: vertexUsage(usage) };
    const logicalCount = (text ? 1 : 0) + calls.length;
    yield {
      type: 'completed',
      finishReason: blocked
        ? 'blocked'
        : length
          ? 'length'
          : calls.length
            ? 'tool_calls'
            : 'stop',
      continuation: continuationFor(
        [
          ...blocksOf(request.continuation),
          ...(logicalCount
            ? [
                {
                  at: request.turns.length,
                  count: logicalCount,
                  items: [{ role: 'model', parts }],
                },
              ]
            : []),
        ],
        this.family,
        models[this.role].modelId,
      ),
      metadata: {
        providerRequestId: responseId,
        effectiveModel: model,
        effectiveEffort: null,
      },
    };
  }
}

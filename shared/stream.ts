import { z } from 'zod';
import { API_JSON_LIMIT_BYTES } from './api.js';
import { UsageSummarySchema } from './domain.js';
import { VulpesCardSchema } from './cards.js';
import { ModelRoleSchema, UUIDSchema, VersionSchema } from './primitives.js';

function eventSchema<T extends string, P extends z.ZodType>(type: T, payload: P) {
  return z.strictObject({ v: z.literal(1), type: z.literal(type), run_id: UUIDSchema, seq: VersionSchema, payload });
}
export const StreamEventSchema = z.discriminatedUnion('type', [
  eventSchema('run.started', z.strictObject({ assistant_message_id: UUIDSchema })),
  eventSchema('route.selected', z.strictObject({ role: ModelRoleSchema, model: z.string().min(1), provider: z.string().min(1), effort: z.string().nullable(), reason: z.string() })),
  eventSchema('step.started', z.strictObject({ step_id: UUIDSchema, step_type: z.enum(['generation', 'decision', 'tool']), label: z.string() })),
  eventSchema('tool.result', z.strictObject({ step_id: UUIDSchema, tool_name: z.string().min(1), result_reference: z.string().min(1), summary: z.string() })),
  eventSchema('card.ready', z.strictObject({ message_id: UUIDSchema, card: VulpesCardSchema })),
  eventSchema('text.delta', z.strictObject({ message_id: UUIDSchema, text: z.string() })),
  eventSchema('run.usage', UsageSummarySchema),
  eventSchema('run.completed', z.strictObject({ message_id: UUIDSchema })),
  eventSchema('run.failed', z.strictObject({ code: z.string().min(1), message: z.string(), partial_output: z.boolean(), retryable: z.boolean() })),
  eventSchema('run.cancelled', z.strictObject({ partial_output: z.boolean(), cost_status: UsageSummarySchema.shape.costStatus })),
]);
export type StreamEvent = z.infer<typeof StreamEventSchema>;
export function isTerminalEvent(event: StreamEvent): boolean {
  return event.type === 'run.completed' || event.type === 'run.failed' || event.type === 'run.cancelled';
}
export function encodeStreamEvent(input: StreamEvent): string {
  const { type, ...data } = StreamEventSchema.parse(input);
  const frame = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
  if (new TextEncoder().encode(frame).byteLength > API_JSON_LIMIT_BYTES) throw new Error('SSE event exceeds limit.');
  return frame;
}

export class StreamDecoder {
  private decoder = new TextDecoder('utf-8', { fatal: true });
  private line = '';
  private event = '';
  private data: string[] = [];
  private frameBytes = 0;
  private afterCR = false;
  private ended = false;

  push(chunk: Uint8Array): StreamEvent[] {
    if (this.ended) throw new Error('SSE decoder has ended.');
    const events: StreamEvent[] = [];
    // Bound bytes before decoding, including an unfinished UTF-8 character.
    for (const byte of chunk) {
      this.frameBytes += 1;
      if (this.frameBytes > API_JSON_LIMIT_BYTES) throw new Error('SSE event exceeds limit.');
      const text = this.decoder.decode(new Uint8Array([byte]), { stream: true });
      for (const character of text) {
        if (this.afterCR && character === '\n') { this.afterCR = false; continue; }
        this.afterCR = character === '\r';
        if (character === '\r' || character === '\n') {
          const event = this.consumeLine();
          if (event) events.push(event);
        } else this.line += character;
      }
    }
    return events;
  }

  finish(): void {
    if (this.ended) throw new Error('SSE decoder has ended.');
    this.ended = true;
    this.decoder.decode();
    if (this.line || this.event || this.data.length) throw new Error('Incomplete SSE event.');
  }

  private consumeLine(): StreamEvent | undefined {
    const line = this.line;
    this.line = '';
    if (line === '') {
      this.frameBytes = 0;
      if (!this.data.length && !this.event) return;
      const name = this.event;
      const data = this.data.join('\n');
      this.event = '';
      this.data = [];
      const parsed: unknown = JSON.parse(data);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Invalid SSE data.');
      if ('type' in parsed && parsed.type !== name) throw new Error('SSE event type mismatch.');
      return StreamEventSchema.parse({ ...parsed, type: name });
    }
    if (line.startsWith(':')) return;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const raw = colon === -1 ? '' : line.slice(colon + 1);
    const value = raw.startsWith(' ') ? raw.slice(1) : raw;
    if (field === 'event') this.event = value;
    if (field === 'data') this.data.push(value);
  }
}

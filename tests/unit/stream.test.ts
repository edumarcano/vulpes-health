import { describe, expect, it } from 'vitest';
import { API_JSON_LIMIT_BYTES } from '../../shared/api.js';
import {
  encodeStreamEvent,
  isTerminalEvent,
  StreamDecoder,
  StreamEventSchema,
} from '../../shared/stream.js';
import type { StreamEvent } from '../../shared/stream.js';
import { id, usage } from '../fixtures/contracts.js';

const payloads: Record<StreamEvent['type'], unknown> = {
  'run.started': { assistant_message_id: id },
  'route.selected': {
    role: 'everyday',
    model: 'synthetic',
    provider: 'synthetic',
    effort: 'low',
    reason: 'fixture',
  },
  'step.started': { step_id: id, step_type: 'tool', label: 'Synthetic read' },
  'tool.result': {
    step_id: id,
    tool_name: 'list_metrics',
    result_reference: `analysis:${id}`,
    summary: 'Synthetic result',
  },
  'card.ready': {
    message_id: id,
    card: { type: 'data_quality', message: 'Synthetic gap', references: [] },
  },
  'text.delta': { message_id: id, text: 'Fox 🦊\nvalue: 69.7' },
  'run.usage': usage,
  'run.completed': { message_id: id },
  'run.failed': {
    code: 'synthetic_error',
    message: 'Unavailable.',
    partial_output: true,
    retryable: false,
  },
  'run.cancelled': { partial_output: false, cost_status: 'pending' },
};
const textEvent = StreamEventSchema.parse({
  v: 1,
  run_id: id,
  seq: 5,
  type: 'text.delta',
  payload: payloads['text.delta'],
});
const bytes = (text: string) => new TextEncoder().encode(text);

describe('SSE v1 contracts and codec', () => {
  it.each(Object.entries(payloads))(
    'round-trips %s without a duplicate wire type',
    (type, payload) => {
      const event = StreamEventSchema.parse({
        v: 1,
        run_id: id,
        seq: 1,
        type,
        payload,
      });
      const encoded = encodeStreamEvent(event);
      expect(JSON.parse(encoded.split('data: ')[1]!.trim())).not.toHaveProperty(
        'type',
      );
      const decoder = new StreamDecoder();
      expect(decoder.push(bytes(encoded))).toEqual([event]);
      decoder.finish();
      expect(isTerminalEvent(event)).toBe(
        ['run.completed', 'run.failed', 'run.cancelled'].includes(type),
      );
    },
  );
  it('handles every byte split, including emoji, CRLF, multiline JSON, and comments', () => {
    const { type, ...data } = textEvent;
    const frame = `: comment\r\nevent: ${type}\r\ndata: ${JSON.stringify(data, null, 2).split('\n').join('\r\ndata: ')}\r\n\r\n`;
    const encoded = bytes(frame);
    for (let split = 0; split <= encoded.length; split++) {
      const decoder = new StreamDecoder();
      expect([
        ...decoder.push(encoded.slice(0, split)),
        ...decoder.push(encoded.slice(split)),
      ]).toEqual([textEvent]);
      decoder.finish();
    }
  });
  it('handles multiple events and a matching duplicate type', () => {
    const decoder = new StreamDecoder();
    const frame = `event: text.delta\ndata: ${JSON.stringify(textEvent)}\n\n`;
    expect(decoder.push(bytes(frame + frame))).toEqual([textEvent, textEvent]);
    decoder.finish();
  });
  it.each([
    { v: 2 },
    { run_id: 'fake' },
    { seq: 0 },
    { seq: 1.5 },
    { type: 'unknown' },
    { payload: { text: 'missing message ID' } },
  ])('rejects invalid event fields %j', (patch) => {
    const decoder = new StreamDecoder();
    const candidate = { ...textEvent, ...patch };
    expect(() =>
      decoder.push(
        bytes(
          `event: ${candidate.type}\ndata: ${JSON.stringify(candidate)}\n\n`,
        ),
      ),
    ).toThrow();
  });
  it.each([
    'event: text.delta\ndata: invalid\n\n',
    'event: text.delta\ndata: []\n\n',
    `event: run.completed\ndata: ${JSON.stringify(textEvent)}\n\n`,
    `event: card.ready\ndata: ${JSON.stringify({ v: 1, run_id: id, seq: 1, payload: { message_id: id, card: { type: 'html' } } })}\n\n`,
  ])('rejects malformed frames (%#)', (frame) => {
    expect(() => new StreamDecoder().push(bytes(frame))).toThrow();
  });
  it('rejects invalid UTF-8 and truncated input', () => {
    expect(() => new StreamDecoder().push(new Uint8Array([0xff]))).toThrow();
    const unicode = new StreamDecoder();
    unicode.push(new Uint8Array([0xf0]));
    expect(() => unicode.finish()).toThrow();
    const incomplete = new StreamDecoder();
    incomplete.push(bytes('event: text.delta\ndata: {}\n'));
    expect(() => incomplete.finish()).toThrow('Incomplete');
    expect(() => incomplete.push(bytes('\n'))).toThrow('ended');
  });
  it('bounds unfinished events and oversized encoded events', () => {
    expect(() =>
      new StreamDecoder().push(bytes(`:${'x'.repeat(API_JSON_LIMIT_BYTES)}`)),
    ).toThrow('exceeds limit');
    expect(() =>
      encodeStreamEvent({
        ...textEvent,
        payload: { message_id: id, text: 'x'.repeat(API_JSON_LIMIT_BYTES) },
      } as StreamEvent),
    ).toThrow('exceeds limit');
  });
});

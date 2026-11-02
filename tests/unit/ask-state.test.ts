import { describe, expect, it } from 'vitest';
import { askReducer, initialAskState } from '../../src/features/ask/state';
import type { StreamEvent } from '../../shared/stream';
const id = '11111111-1111-4111-8111-111111111111';
const message = '22222222-2222-4222-8222-222222222222';
const start: StreamEvent = {
  v: 1,
  type: 'run.started',
  run_id: id,
  seq: 1,
  payload: { assistant_message_id: message },
};
const text: StreamEvent = {
  v: 1,
  type: 'text.delta',
  run_id: id,
  seq: 2,
  payload: { message_id: message, text: 'Synthetic 🦊' },
};
describe('Ask stream reducer', () => {
  it('advances explicitly, deduplicates by sequence and never restarts inference', () => {
    const submitting = askReducer(initialAskState, {
      type: 'submit',
      text: 'Question',
    });
    expect(submitting.phase).toBe('submitting');
    const started = askReducer(submitting, { type: 'event', event: start });
    expect(started.phase).toBe('streaming');
    const next = askReducer(started, { type: 'event', event: text });
    expect(askReducer(next, { type: 'event', event: text })).toBe(next);
    expect(askReducer(next, { type: 'stop' }).phase).toBe('stopping');
    const final = askReducer(next, {
      type: 'event',
      event: {
        v: 1,
        type: 'run.completed',
        run_id: id,
        seq: 3,
        payload: { message_id: message },
      },
    });
    expect(final.phase).toBe('terminal');
    expect(
      askReducer(final, { type: 'event', event: { ...text, seq: 4 } }).phase,
    ).toBe('recovering');
  });
  it('recovers mismatched run, message, gaps and events before admission', () => {
    const started = askReducer(initialAskState, {
      type: 'event',
      event: start,
    });
    for (const event of [
      { ...text, seq: 3 },
      { ...text, run_id: message },
      { ...text, payload: { ...text.payload, message_id: id } },
    ])
      expect(askReducer(started, { type: 'event', event }).phase).toBe(
        'recovering',
      );
    expect(
      askReducer(initialAskState, { type: 'event', event: text }).phase,
    ).toBe('recovering');
  });
});

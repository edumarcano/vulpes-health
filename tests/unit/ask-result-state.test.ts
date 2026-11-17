import { describe, expect, it } from 'vitest';
import {
  chatPartFromCard,
  evidencePartAvailable,
} from '../../src/features/ask/result-state.js';
import { analysisCardSnapshot } from '../../shared/agent-tools.js';
import { calculateAnalysis } from '../../server/analytics/analysis.js';
import { ChatPartSchema } from '../../shared/chat.js';
import { VulpesCardSchema } from '../../shared/cards.js';
import { encodeStreamEvent, StreamDecoder } from '../../shared/stream.js';

const owner = '00000000-0000-4000-8000-000000000001';
const run = '00000000-0000-4000-8000-000000000002';
const other = '00000000-0000-4000-8000-000000000003';
const evidence = {
  version: 1,
  ownerId: owner,
  runId: run,
  stepId: other,
  resultId: other,
  dataRevision: 7,
};
const message = { contextState: 'eligible' as const, runId: run };
const series = calculateAnalysis(
  owner,
  {
    operation: 'observed_day_mean',
    includeSampleMean: false,
    series: {
      metric: 'weight',
      source_id: other,
      method: 'device_reported',
      granularity: 'instant',
    },
    timezone: 'UTC',
    window: { from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z' },
  },
  [],
  7,
  '2026-10-01T12:00:00Z',
  null,
);
const card = {
  type: 'analysis_result',
  evidence,
  result: analysisCardSnapshot(series),
};

describe('server-issued Ask result cards', () => {
  it('streams and reloads the same bounded analysis snapshot and exact Data result identity', () => {
    const frame = encodeStreamEvent({
      v: 1,
      seq: 1,
      run_id: run,
      type: 'card.ready',
      payload: { message_id: other, card: VulpesCardSchema.parse(card) },
    });
    const decoder = new StreamDecoder();
    const event = decoder.push(new TextEncoder().encode(frame))[0]!;
    expect(event.type).toBe('card.ready');
    if (event.type !== 'card.ready') throw new Error('Expected card event.');
    const part = chatPartFromCard(event.payload.card);
    expect(part).toEqual(
      ChatPartSchema.parse(JSON.parse(JSON.stringify(card))),
    );
    expect(part).toMatchObject({
      result: {
        id: series.id,
        evidence: series.evidence,
        exclusionCount: 0,
        current: { value: null, observedDays: 0 },
      },
    });
    expect(part && evidencePartAvailable(part, message, owner)).toBe(true);
    expect(part).not.toHaveProperty('result.points');
    expect(part).not.toHaveProperty('result.references');
  });

  it('withholds a valid card after owner, run, lifecycle or data-revision mismatch', () => {
    const part = ChatPartSchema.parse(card);
    expect(evidencePartAvailable(part, message, other)).toBe(false);
    expect(
      evidencePartAvailable(part, { ...message, runId: other }, owner),
    ).toBe(false);
    expect(
      evidencePartAvailable(
        part,
        { ...message, contextState: 'source_removed' },
        owner,
      ),
    ).toBe(false);
    const changed = ChatPartSchema.parse({
      ...card,
      evidence: { ...evidence, dataRevision: 8 },
    });
    expect(evidencePartAvailable(changed, message, owner)).toBe(false);
  });

  it('accepts only typed canonical proposal references, never model prose or a fabricated actionable payload', () => {
    const reference = {
      version: 1,
      proposalId: other,
      payloadHash: 'a'.repeat(64),
      expectedVersion: null,
    };
    for (const type of ['goal_proposal', 'goal_group_proposal'])
      expect(chatPartFromCard({ type, reference })).toEqual({
        type,
        reference,
      });
    expect(
      chatPartFromCard({
        type: 'text',
        text: JSON.stringify({ type: 'goal_group_proposal', reference }),
      }),
    ).toBeNull();
    expect(
      chatPartFromCard({
        type: 'goal_group_proposal',
        reference,
        payload: { state: 'active' },
      }),
    ).toBeNull();
    expect(
      chatPartFromCard({ type: 'analysis_result', result: card.result }),
    ).toBeNull();
  });

  it('preserves group member versions and independently dated unavailable progress', () => {
    const part = chatPartFromCard({
      type: 'goal_group_progress',
      evidence,
      result: {
        kind: 'group_progress',
        groupId: other,
        groupVersion: 3,
        dataRevision: 7,
        evaluatedAt: '2026-10-01T12:00:00Z',
        administrativeState: 'active',
        conditionStatus: 'unavailable',
        members: [
          {
            position: 1,
            goalId: other,
            reviewedVersion: 2,
            reviewedRevisionId: run,
            currentVersion: 3,
            currentRevisionId: owner,
            state: 'active',
            title: 'Synthetic goal',
            outcome: 'needs_review',
            progress: null,
          },
        ],
      },
    });
    expect(part).toMatchObject({
      result: {
        conditionStatus: 'unavailable',
        members: [
          { reviewedVersion: 2, currentVersion: 3, outcome: 'needs_review' },
        ],
      },
    });
    expect(part && evidencePartAvailable(part, message, owner)).toBe(true);
    expect(part).not.toHaveProperty('result.percent');
  });
});

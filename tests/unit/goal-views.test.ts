import { expect, it } from 'vitest';
import {
  GoalProposalRowSchema,
  GoalRevisionRowSchema,
} from '../../shared/goal-views.js';
import { GoalProgressResultSchema } from '../../shared/goal-progress.js';

const id = '00000000-0000-4000-8000-000000000001';
it('retains terminal proposals with removed bodies and historical revisions for explicit payload review', () => {
  expect(
    GoalProposalRowSchema.parse({
      id,
      state: 'expired',
      summary: 'Synthetic proposal',
      expires_at: '2026-09-01T00:00:00Z',
      target_id: null,
      target_version: null,
      payload_hash: 'a'.repeat(64),
      canonical_payload: null,
      result: null,
    }).canonical_payload,
  ).toBeNull();
  expect(
    GoalRevisionRowSchema.parse({
      id,
      revision_number: 1,
      approved_at: '2026-09-01T00:00:00Z',
      payload: { schemaVersion: 1, historical: true },
    }).payload,
  ).toEqual({ schemaVersion: 1, historical: true });
});

it('rejects incomplete directional progress and invalid display bounds instead of displaying a valid-looking bar', () => {
  const base = { kind: 'progress', baseline: '70', current: '68' };
  expect(
    GoalProgressResultSchema.safeParse({
      ...base,
      result: { kind: 'directional', rawPercent: 150, displayPercent: 150 },
    }).success,
  ).toBe(false);
  expect(
    GoalProgressResultSchema.safeParse({
      ...base,
      result: { kind: 'directional', displayPercent: 50 },
    }).success,
  ).toBe(false);
  expect(
    GoalProgressResultSchema.safeParse({
      ...base,
      result: { kind: 'directional', rawPercent: 150, displayPercent: 100 },
    }).success,
  ).toBe(true);
});

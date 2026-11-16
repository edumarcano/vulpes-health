import { describe, expect, it } from 'vitest';
import {
  GoalDefinitionSchema,
  FrozenBaselineSchema,
} from '../../shared/goals.js';
import {
  goalEligibleMetricKeys,
  metricRegistry,
  registryMetricKeys,
} from '../../shared/metrics.js';
import {
  goalConditionMet,
  goalFreshness,
  goalProgress,
} from '../../server/analytics/goals.js';
import { goalDraft } from '../fixtures/contracts.js';

const definition = {
  ...goalDraft,
  method: 'device_reported',
  granularity: 'instant',
  currentMethod: 'latest_value',
  baselineMethod: 'user_reported',
  reportedBaseline: 70,
};
describe('resolved numeric goal eligibility and representation', () => {
  it('accepts all25 reviewed metrics in three target modes without adding defaults', () => {
    expect(goalEligibleMetricKeys).toHaveLength(25);
    for (const metric of goalEligibleMetricKeys) {
      const sample = metric === 'renpho.waist_hip_ratio' ? 0.9 : 20;
      const d = {
        ...definition,
        metric,
        unit: metricRegistry[metric].canonicalUnit,
        method: metricRegistry[metric].method,
        granularity:
          metric === 'steps_daily'
            ? 'daily_total'
            : metric === 'sleep_duration'
              ? 'session_total'
              : 'instant',
        reportedBaseline: sample,
      };
      for (const target of [
        { direction: 'increase_to', value: sample },
        { direction: 'decrease_to', value: sample },
        { direction: 'maintain_range', lower: sample, upper: sample + 1 },
      ]) {
        const parsed = GoalDefinitionSchema.parse({ ...d, target });
        expect(parsed).not.toHaveProperty('maxEvidenceAgeDays');
      }
    }
  });
  it('rejects all unresolved metrics, wrong units and invalid bounds independently', () => {
    for (const metric of registryMetricKeys.filter(
      (key) => !goalEligibleMetricKeys.includes(key),
    ))
      expect(
        GoalDefinitionSchema.safeParse({
          ...definition,
          metric,
          unit: metricRegistry[metric].canonicalUnit,
        }).success,
      ).toBe(false);
    for (const target of [
      { direction: 'increase_to', value: -1 },
      { direction: 'maintain_range', lower: 10, upper: 101 },
    ])
      expect(
        GoalDefinitionSchema.safeParse({
          ...definition,
          metric: 'renpho.muscle_percent',
          unit: '%',
          target,
        }).success,
      ).toBe(false);
    expect(
      GoalDefinitionSchema.safeParse({
        ...definition,
        metric: 'renpho.metabolic_age',
        unit: 'years',
        reportedBaseline: 20.5,
        target: { direction: 'increase_to', value: 21.25 },
      }).success,
    ).toBe(true);
    expect(
      GoalDefinitionSchema.safeParse({
        ...definition,
        metric: 'steps_daily',
        unit: 'count',
        granularity: 'daily_total',
        target: { direction: 'increase_to', value: 10.5 },
      }).success,
    ).toBe(false);
    expect(
      GoalDefinitionSchema.safeParse({ ...definition, unit: '%' }).success,
    ).toBe(false);
    expect(
      GoalDefinitionSchema.safeParse({
        ...definition,
        metric: 'renpho.visceral_fat_index',
        unit: 'index',
        target: { direction: 'decrease_to', value: 1.25 },
      }).success,
    ).toBe(true);
  });
  it('bounds an optional reviewed age policy and permits direct bodyfat targets at2%', () => {
    for (const age of [0, -1, 0.5, 3661])
      expect(
        GoalDefinitionSchema.safeParse({
          ...definition,
          maxEvidenceAgeDays: age,
        }).success,
      ).toBe(false);
    expect(
      GoalDefinitionSchema.parse({ ...definition, maxEvidenceAgeDays: null })
        .maxEvidenceAgeDays,
    ).toBeNull();
    expect(
      GoalDefinitionSchema.parse({ ...definition, maxEvidenceAgeDays: 2 })
        .maxEvidenceAgeDays,
    ).toBe(2);
    expect(
      GoalDefinitionSchema.safeParse({
        ...definition,
        metric: 'body_fat_percent',
        unit: '%',
        target: { direction: 'decrease_to', value: 2 },
      }).success,
    ).toBe(true);
  });
});

describe('dated evidence and actual goal conditions', () => {
  it('gates current evidence by elapsed time from the oldest required reading', () => {
    const old = '2026-09-01T12:00:00Z';
    expect(goalFreshness(old, 2, '2026-09-03T12:00:00Z')).toMatchObject({
      status: 'fresh',
      ageDays: 2,
    });
    expect(goalFreshness(old, 2, '2026-09-03T12:00:01Z')).toMatchObject({
      status: 'stale',
    });
    expect(goalFreshness(old, undefined, '2026-11-01T12:00:00Z')).toMatchObject(
      { status: 'dated', maxEvidenceAgeDays: null, ageDays: 61 },
    );
    expect(goalFreshness(null, 2, '2026-09-03T12:00:00Z')).toMatchObject({
      status: 'unavailable',
      ageDays: null,
    });
  });
  it('keeps zero-distance percentage undefined while evaluating the condition exactly', () => {
    const target = { direction: 'decrease_to' as const, value: 70 };
    expect(goalProgress('70', '69', target)).toEqual({
      kind: 'undefined',
      reason: 'zero_denominator',
    });
    expect(goalConditionMet('69', target)).toBe(true);
    expect(goalConditionMet('71', target)).toBe(false);
    expect(
      goalConditionMet('0.90', {
        direction: 'maintain_range',
        lower: 0.9,
        upper: 1,
      }),
    ).toBe(true);
    expect(
      goalProgress('70', '75', { direction: 'decrease_to', value: 65 }),
    ).toMatchObject({ rawPercent: -100, displayPercent: 0 });
    expect(
      goalProgress('70', '60', { direction: 'decrease_to', value: 65 }),
    ).toMatchObject({ rawPercent: 200, displayPercent: 100 });
  });
  it('keeps old frozen references valid and contains new evidence dates inside redactable references', () => {
    const baseline = {
      schemaVersion: 2,
      selection: {
        metric: 'weight',
        source_id: definition.sourceId,
        from: '2026-09-01T00:00:00Z',
        to: '2026-09-08T00:00:00Z',
        timezone: 'UTC',
        method: 'device_reported',
        granularity: 'instant',
      },
      value: '70',
      dataRevision: 3,
      algorithmVersion: 'latest_value_v1',
      provenance: 'calculated',
      references: [{ id: '00000000-0000-4000-8000-000000000001', version: 1 }],
    };
    expect(
      FrozenBaselineSchema.parse(baseline).references[0],
    ).not.toHaveProperty('observedAt');
    expect(
      FrozenBaselineSchema.parse({
        ...baseline,
        references: [
          { ...baseline.references[0], observedAt: '2026-09-01T08:00:00Z' },
        ],
      }).references[0]?.observedAt,
    ).toBe('2026-09-01T08:00:00Z');
    expect(
      FrozenBaselineSchema.safeParse({
        ...baseline,
        references: Array.from({ length: 201 }, () => baseline.references[0]),
      }).success,
    ).toBe(true);
  });
});

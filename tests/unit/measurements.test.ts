import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  normalizeObservation,
  type StoredObservation,
} from '../../server/analytics/measurements.js';
import { summarizeMeasurements } from '../../server/analytics/summary.js';
import { goalProgress } from '../../server/analytics/goals.js';
import type { DataSelection, ObservationInput } from '../../shared/data.js';
import {
  canonicalFixtureObservation,
  healthConnectWeightFixture,
} from '../helpers/measurement-adapters.js';
import { VulpesCardSchema } from '../../shared/domain.js';

const source = '00000000-0000-4000-8000-000000000001';
export const input: ObservationInput = {
  metric: 'weight',
  value: '150.0',
  unit: 'lb',
  observed_at: '2026-09-01T08:00:00Z',
  timezone: 'UTC',
  local_date: null,
  granularity: 'instant',
  method: 'device_reported',
  quality_flags: [],
};
const selection: DataSelection = {
  metric: 'weight',
  source_id: source,
  from: '2026-09-01T00:00:00Z',
  to: '2026-09-15T00:00:00Z',
  timezone: 'UTC',
  method: 'device_reported',
  granularity: 'instant',
};
function stored(
  patch: Partial<ObservationInput>,
  index = 1,
): StoredObservation {
  return {
    ...normalizeObservation({ ...input, ...patch }),
    id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    source_id: source,
    external_record_id: null,
    version: 1,
  };
}
describe('normalization and replacement boundaries', () => {
  it('converts exact decimals and preserves source representation', () => {
    expect(normalizeObservation(input)).toMatchObject({
      canonical_value: '68.0388555',
      original_value: '150.0',
      original_unit: 'lb',
    });
    expect(
      normalizeObservation({
        ...input,
        metric: 'height',
        value: '72',
        unit: 'in',
      }).canonical_value,
    ).toBe('182.88');
    expect(
      normalizeObservation({
        ...input,
        metric: 'sleep_duration',
        value: '7.5',
        unit: 'h',
        granularity: 'session_total',
      }).canonical_value,
    ).toBe('450');
    expect(
      normalizeObservation({
        ...input,
        value: '600',
        unit: 'kg',
        quality_flags: ['review_requested'],
      }),
    ).toMatchObject({
      canonical_value: '600',
      quality_flags: ['review_requested'],
    });
  });
  it.each([
    { metric: 'resting_heart_rate', unit: 'bpm', value: '60', expected: '60' },
    {
      metric: 'renpho.visceral_fat_index',
      unit: 'index',
      value: '-1',
      expected: '-1',
    },
    { metric: 'height', unit: 'm', value: '1.8', expected: '180' },
    {
      metric: 'steps_daily',
      unit: 'count',
      value: '0',
      granularity: 'daily_total',
      local_date: '2026-09-01',
      expected: '0',
    },
  ])(
    'normalizes the remaining supported representations %j',
    ({ expected, ...patch }) =>
      expect(
        normalizeObservation({ ...input, ...patch } as ObservationInput)
          .canonical_value,
      ).toBe(expected),
  );
  it.each([
    { value: '' },
    { value: 'NaN' },
    { value: 'Infinity' },
    { value: '0' },
    { value: '-1' },
    { unit: 'bpm' },
    { metric: 'body_fat_percent', unit: '%', value: '101' },
    {
      metric: 'steps_daily',
      unit: 'count',
      value: '1.5',
      granularity: 'daily_total',
      local_date: '2026-09-01',
    },
    { metric: 'sleep_duration', unit: 'min', value: '10' },
    { observed_at: '2026-02-30T08:00:00Z' },
  ])('rejects hard representation violation %j', (patch) =>
    expect(() =>
      normalizeObservation({ ...input, ...patch } as ObservationInput),
    ).toThrow(),
  );
  it('does not rescale a percentage or invent a zero', () =>
    expect(
      normalizeObservation({
        ...input,
        metric: 'body_fat_percent',
        unit: '%',
        value: '0.20',
      }).canonical_value,
    ).toBe('0.2'));
  it.each([
    {
      metric: 'body_fat_percent',
      unit: '%',
      value: '100.000000000000000000000001',
    },
    {
      metric: 'steps_daily',
      unit: 'count',
      value: '1.000000000000000000000001',
      granularity: 'daily_total',
      local_date: '2026-09-01',
    },
  ])('checks exact representation before numeric DTO conversion %j', (patch) =>
    expect(() =>
      normalizeObservation({ ...input, ...patch } as ObservationInput),
    ).toThrow(),
  );
  it.each(['2026-11-01T01:30:00', '2026-03-08T02:30:00'])(
    'rejects DST ambiguity/nonexistence %s',
    (observed_at) =>
      expect(() =>
        normalizeObservation({
          ...input,
          observed_at,
          timezone: 'America/New_York',
        }),
      ).toThrow(),
  );
  it('accepts explicit DST offset and resolves unique naive time', () => {
    expect(
      normalizeObservation({
        ...input,
        observed_at: '2026-11-01T01:30:00-04:00',
        timezone: 'America/New_York',
      }).original_offset_minutes,
    ).toBe(-240);
    expect(
      normalizeObservation({
        ...input,
        observed_at: '2026-09-01T08:00:00',
        timezone: 'America/New_York',
      }).observed_at,
    ).toBe('2026-09-01T12:00:00Z');
  });
  it.each([
    '2026-09-01T23:59:60Z',
    '2026-09-01T23:59:60.123456Z',
    '2026-09-01T23:59:60+00:00',
    '2026-09-01T23:59:60-04:00',
    '2026-09-01T23:59:60',
  ])('rejects unsupported second-60 timestamps: %s', (observed_at) => {
    expect(() => normalizeObservation({ ...input, observed_at })).toThrow();
  });
  it('preserves the last ordinary second and microseconds at midnight boundaries', () => {
    expect(
      normalizeObservation({
        ...input,
        observed_at: '2026-09-01T23:59:59.123456Z',
      }).observed_at,
    ).toBe('2026-09-01T23:59:59.123456Z');
  });
  it('manual, fixture CSV and fixture-only Health Connect inputs normalize identically', () => {
    const csvFixture = {
      observed_at: input.observed_at,
      metric: input.metric,
      value: input.value,
      unit: input.unit,
      timezone: input.timezone,
      method: input.method,
    };
    const healthConnectFixture = {
      time: input.observed_at,
      zone: input.timezone,
      mass: { amount: input.value, unit: 'lb' as const },
    };
    expect(canonicalFixtureObservation(csvFixture)).toEqual(
      normalizeObservation(input),
    );
    expect(healthConnectWeightFixture(healthConnectFixture)).toEqual(
      normalizeObservation(input),
    );
  });
});
describe('deterministic analytics and progress', () => {
  const fixture = readFileSync(
    'docs/spec/v0.1.0/fixtures/measurements-synthetic.csv',
    'utf8',
  )
    .trim()
    .split(/\r?\n/)
    .slice(1);
  const rows = fixture.map((line, index) => {
    const [observed_at, metric, value, unit] = line.split(',');
    return stored(
      { observed_at, metric, value, unit } as Partial<ObservationInput>,
      index + 1,
    );
  });
  it('matches the canonical oracle before display rounding', () => {
    const result = summarizeMeasurements(rows, selection, 7).analysis;
    expect(result.previousValue).toBeCloseTo(69.7, 9);
    expect(result.value).toBeCloseTo(69, 9);
    expect(result.absoluteChange).toBeCloseTo(-0.7, 9);
    const fat = summarizeMeasurements(
      rows.map((row) => ({ ...row, measurement_method: 'device_estimate' })),
      { ...selection, metric: 'body_fat_percent', method: 'device_estimate' },
      7,
    ).analysis;
    expect(fat.absoluteChange).toBeCloseTo(-0.7, 9);
    expect(
      goalProgress('69.7', '69', { direction: 'decrease_to', value: 68 }),
    ).toMatchObject({
      kind: 'directional',
      rawPercent: expect.closeTo(41.1764705882353, 9),
    });
    expect(
      VulpesCardSchema.safeParse({ type: 'metric_trend', result }).success,
    ).toBe(true);
  });
  it('weights days equally and uses even/odd daily medians', () => {
    const data = [
      stored(
        { value: '10', unit: 'kg', observed_at: '2026-09-08T08:00:00Z' },
        1,
      ),
      stored(
        { value: '30', unit: 'kg', observed_at: '2026-09-08T09:00:00Z' },
        2,
      ),
      stored(
        { value: '40', unit: 'kg', observed_at: '2026-09-09T08:00:00Z' },
        3,
      ),
      stored(
        { value: '60', unit: 'kg', observed_at: '2026-09-10T08:00:00Z' },
        4,
      ),
    ];
    expect(summarizeMeasurements(data, selection, 1).analysis.value).toBe(40);
    expect(
      summarizeMeasurements(data.slice(0, 3), selection, 1).analysis,
    ).toMatchObject({ value: null, coverageStatus: 'insufficient_data' });
  });
  it('isolates source and method, preserves gaps and labels observed heart rate', () => {
    const data = rows.map((row) => ({ ...row, source_id: 'foreign' }));
    expect(summarizeMeasurements(data, selection, 1).analysis.value).toBeNull();
    const hr = [
      stored({ metric: 'heart_rate', unit: 'bpm', value: '60' }, 1),
      stored({ metric: 'heart_rate', unit: 'bpm', value: '100' }, 2),
    ];
    expect(
      summarizeMeasurements(hr, { ...selection, metric: 'heart_rate' }, 1)
        .analysis,
    ).toMatchObject({
      statistic: 'observed_samples',
      statistics: { median: 80, min: 60, max: 100 },
    });
    expect(
      summarizeMeasurements([], selection, 1).series.every(
        (point) => point.value === null,
      ),
    ).toBe(true);
  });
  it('does not sum conflicting daily totals or sleep sessions', () => {
    const steps = ['100', '200'].map((value, index) =>
      stored(
        {
          metric: 'steps_daily',
          unit: 'count',
          value,
          granularity: 'daily_total',
          local_date: '2026-09-01',
        },
        index + 1,
      ),
    );
    const result = summarizeMeasurements(
      steps,
      { ...selection, metric: 'steps_daily', granularity: 'daily_total' },
      1,
    );
    expect(result.series[0]!.value).toBeNull();
    expect(result.analysis.exclusions).toHaveLength(2);
    expect(result.analysis.validDays).toBe(0);
    expect(result.analysis.coverageStatus).toBe('insufficient_data');
    const sleep = [
      stored({
        metric: 'sleep_duration',
        unit: 'min',
        value: '60',
        granularity: 'session_total',
      }),
    ];
    expect(
      summarizeMeasurements(
        sleep,
        {
          ...selection,
          metric: 'sleep_duration',
          granularity: 'session_total',
        },
        1,
      ).analysis.value,
    ).toBeNull();
  });
  it('uses declared local dates for daily totals without shifting them into another day', () => {
    const row = stored({
      metric: 'steps_daily',
      unit: 'count',
      value: '100',
      granularity: 'daily_total',
      observed_at: '2026-09-02T03:00:00Z',
      timezone: 'America/New_York',
      local_date: '2026-09-01',
    });
    const result = summarizeMeasurements(
      [row],
      {
        ...selection,
        metric: 'steps_daily',
        granularity: 'daily_total',
        to: '2026-09-02T00:00:00Z',
      },
      1,
    );
    expect(result.series).toEqual([{ localDate: '2026-09-01', value: 100 }]);
  });
  it('uses seven local days across DST rather than subtracting 168 hours', () => {
    const result = summarizeMeasurements(
      [],
      {
        ...selection,
        from: '2026-11-01T04:00:00Z',
        to: '2026-11-08T05:00:00Z',
        timezone: 'America/New_York',
      },
      1,
    );
    expect(result.analysis.from).toBe('2026-11-01T04:00:00Z');
    expect(result.series).toHaveLength(7);
  });
  it('guards zero division, preserves regression/overshoot, and returns range states', () => {
    expect(
      goalProgress('70', '69', { direction: 'decrease_to', value: 70 }),
    ).toEqual({ kind: 'undefined', reason: 'zero_denominator' });
    expect(
      goalProgress('70', '75', { direction: 'decrease_to', value: 65 }),
    ).toMatchObject({ rawPercent: -100, displayPercent: 0 });
    expect(
      goalProgress('70', '60', { direction: 'decrease_to', value: 65 }),
    ).toMatchObject({ rawPercent: 200, displayPercent: 100 });
    expect(
      goalProgress(null, '70', {
        direction: 'maintain_range',
        lower: 69,
        upper: 71,
      }),
    ).toEqual({ kind: 'within_range' });
    expect(
      goalProgress(null, null, { direction: 'increase_to', value: 75 }),
    ).toEqual({ kind: 'insufficient_data' });
  });
});

import { describe, expect, it } from 'vitest';
import {
  AnalysisOperationSchema,
  AnalyzeRequestSchema,
  type AnalysisOperation,
} from '../../shared/analysis.js';
import {
  analysisResultId,
  analysisWindow,
  calculateAnalysis,
  operationWindows,
} from '../../server/analytics/analysis.js';
import {
  normalizeObservation,
  type StoredObservation,
} from '../../server/analytics/measurements.js';
import type { ObservationInput } from '../../shared/data.js';

const owner = '00000000-0000-4000-8000-000000000001';
const source = '00000000-0000-4000-8000-000000000002';
const clock = '2026-10-01T12:00:00Z';
const month = { from: '2026-09-01T00:00:00Z', to: '2026-10-01T00:00:00Z' };
const previousMonth = {
  from: '2026-08-01T00:00:00Z',
  to: '2026-09-01T00:00:00Z',
};
const series = {
  metric: 'weight' as const,
  source_id: source,
  method: 'device_reported' as const,
  granularity: 'instant' as const,
};
let nextId = 10;
function row(
  value: string,
  date: string,
  patch: Partial<ObservationInput> = {},
): StoredObservation {
  const input: ObservationInput = {
    metric: 'weight',
    value,
    unit: 'kg',
    observed_at: date,
    timezone: 'UTC',
    local_date: null,
    method: 'device_reported',
    granularity: 'instant',
    quality_flags: [],
    ...patch,
  };
  return {
    ...normalizeObservation(input),
    id: `00000000-0000-4000-8000-${String(nextId++).padStart(12, '0')}`,
    source_id: source,
    external_record_id: null,
    version: 1,
  };
}
function calculation(operation: AnalysisOperation, rows: StoredObservation[]) {
  if (operation.operation === 'latest_event')
    throw new Error('Event calculation belongs to owned service.');
  return calculateAnalysis(
    owner,
    operation,
    rows,
    7,
    clock,
    '2026-10-01T11:00:00Z',
  );
}

describe('explicit deterministic analysis', () => {
  const september = [
    row('68', '2026-09-01T08:00:00Z'),
    row('72', '2026-09-01T09:00:00Z'),
    row('80', '2026-09-01T10:00:00Z'),
    row('70', '2026-09-02T08:00:00Z'),
    row('74', '2026-09-08T08:00:00Z'),
  ];
  const august = [
    row('78', '2026-08-01T08:00:00Z'),
    row('80', '2026-08-15T08:00:00Z'),
    row('82', '2026-08-30T08:00:00Z'),
  ];
  it('weights observed days equally and exposes sample mean only when requested', () => {
    const result = calculation(
      {
        operation: 'observed_day_mean',
        series,
        timezone: 'UTC',
        window: month,
        includeSampleMean: true,
      },
      september,
    );
    expect(result.current).toMatchObject({
      value: '72',
      sampleMean: '72.8',
      observedDays: 3,
      calendarDays: 30,
      observationCount: 5,
      partialCurrentDay: false,
    });
    expect(result.points).toHaveLength(30);
    expect(result.points[0]).toEqual({ localDate: '2026-09-01', value: '72' });
    expect(result.points[2]).toEqual({ localDate: '2026-09-03', value: null });
    expect(result.current.oldestContributingAt).toBe('2026-09-01T08:00:00Z');
    expect(result.lastSuccessfulImportAt).toBe('2026-10-01T11:00:00Z');
    expect(result.current.ageSeconds).toBe(30 * 86400 + 4 * 3600);
  });
  it('compares actual calendar-month selections and withholds either insufficient side', () => {
    const operation: AnalysisOperation = {
      operation: 'period_comparison',
      series,
      timezone: 'UTC',
      window: month,
      comparisonWindow: previousMonth,
      comparisonMethod: 'observed_day_mean',
    };
    const result = calculation(operation, [...september, ...august]);
    expect(result).toMatchObject({
      current: { value: '72', calendarDays: 30 },
      previous: { value: '80', calendarDays: 31 },
      absoluteChange: '-8',
      relativeChangePercent: '-10',
      alignment: 'independent_windows',
    });
    expect(calculation(operation, september)).toMatchObject({
      previous: { value: null },
      absoluteChange: null,
      relativeChangePercent: null,
    });
  });
  it('requires three observed days in each actual rolling window', () => {
    const sparse = calculation(
      {
        operation: 'rolling_7d',
        series,
        timezone: 'UTC',
        window: { from: '2026-09-01T00:00:00Z', to: '2026-09-10T00:00:00Z' },
      },
      september,
    );
    expect(sparse).toMatchObject({
      requestedWindow: { from: '2026-09-01T00:00:00Z' },
      effectiveWindow: {
        from: '2026-09-03T00:00:00Z',
        to: '2026-09-10T00:00:00Z',
      },
      current: {
        value: null,
        coverageStatus: 'insufficient_data',
        observedDays: 1,
        calendarDays: 7,
      },
      absoluteChange: null,
    });
    const covered = calculation(
      {
        operation: 'rolling_7d',
        series,
        timezone: 'UTC',
        window: { from: '2026-09-01T00:00:00Z', to: '2026-09-09T00:00:00Z' },
      },
      [...september, row('72', '2026-09-04T09:00:00Z')],
    );
    expect(covered.current).toMatchObject({ value: '72', observedDays: 3 });
  });
  it('labels every percentage change in points and zero relative denominator as unavailable', () => {
    const first = row('25', '2026-08-01T08:00:00Z', {
      metric: 'renpho.muscle_percent',
      unit: '%',
      method: 'device_estimate',
    });
    const last = row('20', '2026-09-01T08:00:00Z', {
      metric: 'renpho.muscle_percent',
      unit: '%',
      method: 'device_estimate',
    });
    const op: AnalysisOperation = {
      operation: 'endpoint_difference',
      series: {
        ...series,
        metric: 'renpho.muscle_percent',
        method: 'device_estimate',
      },
      timezone: 'UTC',
      endpointIds: [first.id, last.id],
    };
    expect(calculation(op, [first, last])).toMatchObject({
      absoluteChange: '-5',
      absoluteChangeUnit: 'percentage_points',
      relativeChangePercent: '-20',
      endpoints: [
        { id: first.id, version: 1 },
        { id: last.id, version: 1 },
      ],
    });
    const zero = { ...first, canonical_value: '0', original_value: '0' };
    expect(calculation(op, [zero, last])).toMatchObject({
      absoluteChange: '20',
      relativeChangePercent: null,
    });
  });
  it('uses explicit endpoint IDs instead of daily medians and filters foreign series', () => {
    const first = row('50', '2026-09-01T08:00:00Z'),
      last = row('51', '2026-09-01T12:00:00Z');
    const distractor = row('100', '2026-09-01T10:00:00Z');
    expect(
      calculation(
        {
          operation: 'endpoint_difference',
          series,
          timezone: 'UTC',
          endpointIds: [first.id, last.id],
        },
        [first, last, distractor],
      ),
    ).toMatchObject({
      current: { value: '51' },
      previous: { value: '50' },
      absoluteChange: '1',
      relativeChangePercent: '2',
    });
    expect(
      calculation({ operation: 'latest_per_metric', series, timezone: 'UTC' }, [
        first,
        last,
        { ...distractor, source_id: owner },
      ]),
    ).toMatchObject({ current: { value: '51', observationCount: 1 } });
  });
  it('preserves heart-rate sample statistics, daily-total conflicts and uncombined sessions', () => {
    const hr = [
      row('50', '2026-09-01T08:00:00Z', { metric: 'heart_rate', unit: 'bpm' }),
      row('70', '2026-09-01T09:00:00Z', { metric: 'heart_rate', unit: 'bpm' }),
      row('110', '2026-09-02T08:00:00Z', { metric: 'heart_rate', unit: 'bpm' }),
    ];
    expect(
      calculation(
        {
          operation: 'observed_day_mean',
          series: { ...series, metric: 'heart_rate' },
          timezone: 'UTC',
          window: month,
          includeSampleMean: false,
        },
        hr,
      ).current,
    ).toMatchObject({
      value: '70',
      statistic: 'observed_samples',
      sampleStatistics: { median: '70', min: '50', max: '110' },
    });
    const daily = [
      row('100', '2026-09-01T12:00:00Z', {
        metric: 'steps_daily',
        unit: 'count',
        granularity: 'daily_total',
        local_date: '2026-09-02',
        timezone: 'Pacific/Kiritimati',
      }),
      row('200', '2026-09-01T14:00:00Z', {
        metric: 'steps_daily',
        unit: 'count',
        granularity: 'daily_total',
        local_date: '2026-09-02',
        timezone: 'Pacific/Kiritimati',
      }),
    ];
    const conflicting = calculation(
      {
        operation: 'observed_day_mean',
        series: {
          ...series,
          metric: 'steps_daily',
          granularity: 'daily_total',
        },
        timezone: 'UTC',
        window: month,
        includeSampleMean: false,
      },
      daily,
    );
    expect(conflicting.current.value).toBeNull();
    expect(conflicting.exclusions.map((item) => item.referenceId)).toEqual(
      daily.map((item) => item.id),
    );
    const dailyTotals = calculation(
      {
        operation: 'observed_day_mean',
        series: {
          ...series,
          metric: 'steps_daily',
          granularity: 'daily_total',
        },
        timezone: 'UTC',
        window: month,
        includeSampleMean: false,
      },
      [daily[0]!],
    );
    expect(dailyTotals.current).toMatchObject({
      value: null,
      statistic: 'uncombined_daily_totals',
      coverageStatus: 'unsupported',
      observationCount: 1,
    });
    const sleep = row('420', '2026-09-02T08:00:00Z', {
      metric: 'sleep_duration',
      unit: 'min',
      granularity: 'session_total',
    });
    expect(
      calculation(
        {
          operation: 'observed_day_mean',
          series: {
            ...series,
            metric: 'sleep_duration',
            granularity: 'session_total',
          },
          timezone: 'UTC',
          window: month,
          includeSampleMean: false,
        },
        [sleep],
      ).current,
    ).toMatchObject({
      value: null,
      statistic: 'uncombined_sessions',
      coverageStatus: 'unsupported',
      observationCount: 1,
    });
  });
});

describe('analysis bounds and identities', () => {
  it('withholds conflicting latest ties and orders daily values by their declared date', () => {
    const a = row('70', '2026-09-01T08:00:00Z');
    const b = row('72', '2026-09-01T08:00:00Z');
    expect(
      calculation({ operation: 'latest_per_metric', series, timezone: 'UTC' }, [
        a,
        b,
      ]).current.value,
    ).toBeNull();
    const newerDay = row('200', '2026-09-01T12:00:00Z', {
      metric: 'steps_daily',
      unit: 'count',
      granularity: 'daily_total',
      local_date: '2026-09-02',
      timezone: 'Pacific/Kiritimati',
    });
    const olderDay = row('100', '2026-09-01T22:00:00Z', {
      metric: 'steps_daily',
      unit: 'count',
      granularity: 'daily_total',
      local_date: '2026-09-01',
    });
    expect(
      calculation(
        {
          operation: 'latest_per_metric',
          series: {
            ...series,
            metric: 'steps_daily',
            granularity: 'daily_total',
          },
          timezone: 'UTC',
        },
        [olderDay, newerDay],
      ).current.value,
    ).toBe('200');
  });
  it('binds explicit current cutoffs and excludes later instants or declared local days', () => {
    const past = row('70', '2026-09-01T08:00:00Z');
    const future = row('80', '2026-09-01T10:00:00Z');
    const op: AnalysisOperation = {
      operation: 'latest_per_metric',
      series,
      timezone: 'UTC',
      before: '2026-09-01T09:00:00Z',
    };
    expect(calculation(op, [past, future]).current.value).toBe('70');
    expect(analysisResultId(owner, op, 7)).not.toBe(
      analysisResultId(owner, { ...op, before: '2026-09-01T11:00:00Z' }, 7),
    );
    const daily = row('100', '2026-09-01T12:00:00Z', {
      metric: 'steps_daily',
      unit: 'count',
      granularity: 'daily_total',
      local_date: '2026-09-02',
      timezone: 'Pacific/Kiritimati',
    });
    expect(
      calculation(
        {
          operation: 'latest_per_metric',
          series: {
            ...series,
            metric: 'steps_daily',
            granularity: 'daily_total',
          },
          timezone: 'UTC',
          before: '2026-09-02T00:00:00Z',
        },
        [daily],
      ).current.value,
    ).toBeNull();
    expect(() =>
      operationWindows({
        operation: 'latest_per_metric',
        series: {
          ...series,
          metric: 'steps_daily',
          granularity: 'daily_total',
        },
        timezone: 'UTC',
        before: '2026-09-02T12:00:00Z',
      }),
    ).toThrow();
    const rolled = calculation(
      {
        operation: 'rolling_7d',
        series,
        timezone: 'UTC',
        window: { from: '2026-09-01T00:00:00Z', to: '2026-09-08T00:00:00Z' },
        before: '2026-09-03T12:00:00Z',
      },
      [
        past,
        row('72', '2026-09-02T08:00:00Z'),
        row('74', '2026-09-03T08:00:00Z'),
        row('90', '2026-09-04T08:00:00Z'),
      ],
    );
    expect(rolled.current).toMatchObject({
      value: '72',
      observationCount: 3,
      observedDays: 3,
    });
  });
  it('resolves complete local days independently across DST and fractional offsets', () => {
    expect(
      analysisWindow(
        { from: '2026-03-01T05:00:00Z', to: '2026-04-01T04:00:00Z' },
        'America/New_York',
      ).days,
    ).toBe(31);
    expect(
      analysisWindow(
        { from: '2026-09-01T18:15:00Z', to: '2026-09-02T18:15:00Z' },
        'Asia/Kathmandu',
      ).days,
    ).toBe(1);
    const operation: AnalysisOperation = {
      operation: 'period_comparison',
      series,
      timezone: 'America/New_York',
      window: { from: '2026-03-08T05:00:00Z', to: '2026-03-10T04:00:00Z' },
      comparisonMethod: 'observed_day_mean',
    };
    expect(operationWindows(operation).previous?.window).toEqual({
      from: '2026-03-06T05:00:00Z',
      to: '2026-03-08T05:00:00Z',
    });
    expect(() =>
      analysisWindow({ from: '2026-09-01T00:00:01Z', to: month.to }, 'UTC'),
    ).toThrow();
    expect(() =>
      analysisWindow({ from: '2025-01-01T00:00:00Z', to: month.to }, 'UTC'),
    ).toThrow();
  });
  it('binds owner/revision/operation and canonical aliases, while excluding age evaluation time', () => {
    const op = AnalysisOperationSchema.parse({
      operation: 'observed_day_mean',
      series,
      timezone: 'UTC',
      window: month,
    });
    const id = analysisResultId(owner, op, 7);
    const alias = AnalysisOperationSchema.parse({
      operation: 'observed_day_mean',
      timezone: 'UTC',
      series: { ...series, source_id: source.toUpperCase() },
      window: {
        from: '2026-09-01T00:00:00+00:00',
        to: '2026-10-01T00:00:00+00:00',
      },
      includeSampleMean: false,
    });
    expect(analysisResultId(owner, alias, 7)).toBe(id);
    expect(analysisResultId(source, op, 7)).not.toBe(id);
    expect(analysisResultId(owner, op, 8)).not.toBe(id);
    expect(
      analysisResultId(
        owner,
        { operation: 'rolling_7d', series, timezone: 'UTC', window: month },
        7,
      ),
    ).not.toBe(id);
  });
  it('rejects duplicates after UUID normalization, unknown fields and oversized batches', () => {
    const id = '00000000-0000-4000-8000-0000000000af';
    expect(
      AnalysisOperationSchema.safeParse({
        operation: 'endpoint_difference',
        series,
        timezone: 'UTC',
        endpointIds: [id, id.toUpperCase()],
      }).success,
    ).toBe(false);
    expect(
      AnalyzeRequestSchema.safeParse({
        action: 'analyze',
        operations: Array.from({ length: 25 }, () => ({
          operation: 'latest_per_metric',
          series,
          timezone: 'UTC',
        })),
      }).success,
    ).toBe(false);
    expect(
      AnalyzeRequestSchema.safeParse({
        action: 'analyze',
        owner,
        operations: [
          { operation: 'latest_per_metric', series, timezone: 'UTC' },
        ],
      }).success,
    ).toBe(false);
  });
});

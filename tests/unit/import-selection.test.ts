import { expect, it } from 'vitest';
import { importSelections } from '../../server/analytics/import-selection.js';

const weight = {
  metric_key: 'weight' as const,
  measurement_method: 'device_reported' as const,
  granularity: 'instant' as const,
  observed_at: '2024-01-01T00:00:00Z',
  local_date: null,
};

it('finds series beyond the 20-row preview and bounds each range to 366 inclusive days', () => {
  const rows = Array.from({ length: 21 }, () => weight);
  rows.push({ ...weight, observed_at: '2026-09-14T00:00:00Z' });
  const selections = importSelections(
    [
      ...rows,
      {
        ...weight,
        metric_key: 'body_fat_percent',
        measurement_method: 'device_estimate',
        observed_at: '2026-09-15T00:00:00Z',
      },
      { ...weight, metric_key: 'heart_rate' },
    ],
    [...rows.map(() => 'new'), 'duplicate', 'conflict'],
    'UTC',
  );
  expect(selections).toEqual([
    {
      metric: 'weight',
      method: 'device_reported',
      granularity: 'instant',
      timezone: 'UTC',
      from: '2025-09-14',
      to: '2026-09-14',
    },
    {
      metric: 'body_fat_percent',
      method: 'device_estimate',
      granularity: 'instant',
      timezone: 'UTC',
      from: '2026-09-15',
      to: '2026-09-15',
    },
  ]);
});

it('uses declared days for daily totals and the viewing timezone for timestamped readings', () => {
  expect(
    importSelections(
      [
        {
          ...weight,
          metric_key: 'steps_daily',
          granularity: 'daily_total',
          local_date: '2026-09-01',
          observed_at: '2026-09-02T01:00:00Z',
        },
        { ...weight, observed_at: '2026-09-02T01:00:00Z' },
      ],
      ['new', 'new'],
      'America/New_York',
    ).map(({ from, to }) => ({ from, to })),
  ).toEqual([
    { from: '2026-09-01', to: '2026-09-01' },
    { from: '2026-09-01', to: '2026-09-01' },
  ]);
  expect(importSelections([weight], ['conflict'], 'UTC')).toEqual([]);
});

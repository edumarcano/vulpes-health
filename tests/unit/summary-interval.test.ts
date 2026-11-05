import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { DataSummarySchema } from '../../shared/data.js';
import { providerToolResult } from '../../server/ai/tools.js';

const data = DataSummarySchema.parse(
  JSON.parse(
    readFileSync(
      new URL('../fixtures/luna-v8-summary.json', import.meta.url),
      'utf8',
    ),
  ),
);

it('withholds rolling values when the selected day differs from the calculation interval', () => {
  expect(data.analysis.value).toBe(78);
  expect(data.series).toEqual([{ localDate: '2026-11-04', value: 73 }]);
  const projected = providerToolResult({ kind: 'summary', data }) as {
    data: { requestedIntervalMatches: boolean; analysis: typeof data.analysis };
  };
  expect(projected.data.requestedIntervalMatches).toBe(false);
  expect(projected.data.analysis.value).toBeNull();
  expect(projected.data.analysis.statistics).toBeNull();
  expect(projected.data.analysis.absoluteChange).toBeNull();
  expect(data.analysis.value).toBe(78);
});

it('keeps matching seven-day calculations and historical projection bytes', () => {
  const matching = {
    ...data,
    selection: {
      ...data.selection,
      from: data.analysis.from,
      to: data.analysis.to,
    },
  };
  const projected = providerToolResult({ kind: 'summary', data: matching }) as {
    data: { requestedIntervalMatches: boolean; analysis: typeof data.analysis };
  };
  expect(projected.data.requestedIntervalMatches).toBe(true);
  expect(projected.data.analysis.value).toBe(78);
  const historical = providerToolResult({ kind: 'summary', data }, 3) as {
    data: { analysis: typeof data.analysis };
  };
  expect(historical.data.analysis.value).toBe(78);
  expect(historical.data).not.toHaveProperty('requestedIntervalMatches');
});

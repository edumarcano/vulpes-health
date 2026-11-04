import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { describe, expect, it } from 'vitest';
import { parseCsv } from '../../server/services/csv.js';
import {
  ImportMappingSchema,
  isRenphoHeader,
  type ImportMapping,
} from '../../shared/imports.js';
const fixture = readFileSync(
  'docs/spec/v0.1.0/fixtures/renpho-synthetic.csv',
  'utf8',
);
const records = parse(fixture) as string[][];
const headers = records[0]!;
const mapping = {
  schema_version: 1,
  format: 'renpho',
  timezone: 'America/New_York',
  profile: null,
  single_profile: true,
  timezone_confirmed: true,
  review_requested: false,
} satisfies ImportMapping;
function row(overrides: Record<string, string> = {}, order = headers) {
  return order
    .map((h) =>
      JSON.stringify(overrides[h] ?? records[1]![headers.indexOf(h)]!),
    )
    .join(',');
}
function csv(overrides: Record<string, string> = {}, order = headers) {
  return (
    order.map((h) => JSON.stringify(h)).join(',') + '\n' + row(overrides, order)
  );
}
describe('English RENPHO Health CSV', () => {
  it('normalizes only weight and body fat with exact decimals, offsets and original-column provenance', () => {
    const result = parseCsv(fixture, mapping);
    expect(result.counts).toMatchObject({
      observations: 4,
      blank: 2,
      invalid: 0,
    });
    expect(result.observations.map((o) => o.metric_key)).toEqual([
      'weight',
      'body_fat_percent',
      'weight',
      'body_fat_percent',
    ]);
    expect(result.observations[0]).toMatchObject({
      canonical_value: '68.0388555',
      original_value: '150.0',
      original_unit: 'lb',
      observed_at: '2026-09-01T12:00:00Z',
      original_offset_minutes: -240,
      timezone: 'America/New_York',
      local_date: null,
      granularity: 'instant',
      measurement_method: 'device_reported',
      external_record_id: null,
      provenance: { adapter: 'csv', row: 2, column: 'Weight(lb)', mapping },
    });
    expect(result.observations[1]).toMatchObject({
      canonical_value: '20',
      measurement_method: 'device_estimate',
      external_record_id: null,
      provenance: { column: 'Body Fat Percentage(%)' },
    });
    expect(result.ignored_columns).toEqual(
      headers.filter(
        (h) =>
          h &&
          !['Date', 'Time', 'Weight(lb)', 'Body Fat Percentage(%)'].includes(h),
      ),
    );
    expect(JSON.stringify(result)).not.toContain('Synthetic, ignored note');
    expect(
      parseCsv(csv(), { ...mapping, review_requested: true }).observations[0]!
        .quality_flags,
    ).toEqual(['review_requested']);
  });
  it('resolves reordered named headers and supports BOM, CRLF and quoted ignored cells', () => {
    const reordered = [...headers.slice(0, -1).reverse(), ''];
    expect(isRenphoHeader(reordered)).toBe(true);
    const result = parseCsv(
      '\uFEFF' +
        csv({ Remarks: 'Synthetic, quoted' }, reordered).replaceAll(
          '\n',
          '\r\n',
        ),
      mapping,
    );
    expect(result.observations[0]!.canonical_value).toBe('68.0388555');
    expect(result.counts.invalid).toBe(0);
  });
  it('requires explicit single profile and timezone confirmation, rejecting inferred or fixed-offset zones', () => {
    for (const override of [
      { single_profile: false },
      { timezone_confirmed: false },
      { timezone_confirmed: undefined },
      { profile: { column: 'No.', value: '1' } },
      { timezone: '+04:00' },
      { timezone: 'not/a_zone' },
    ])
      expect(
        ImportMappingSchema.safeParse({ ...mapping, ...override }).success,
      ).toBe(false);
  });
  it.each([
    { Date: '2026.11.01', Time: '01:30:00' },
    { Date: '2026.03.08', Time: '02:30:00' },
    { Date: '2026.02.30' },
    { Date: '2026-09-01' },
    { Date: '' },
    { Time: '08:00' },
    { Time: '08:00:00Z' },
    { Time: '23:59:60' },
    { Time: '24:00:00' },
  ])('excludes malformed or ambiguous local time %j', (override) => {
    const result = parseCsv(csv(override), mapping);
    expect(result.observations).toEqual([]);
    expect(result.counts.invalid).toBe(2);
    expect(result.errors.map((e) => e.column)).toEqual([
      'Weight(lb)',
      'Body Fat Percentage(%)',
    ]);
  });
  it('accepts valid time boundaries and zero/100 percent without treating blanks as zero', () => {
    for (const value of ['0', '100']) {
      const result = parseCsv(
        csv({ 'Body Fat Percentage(%)': value, Time: '23:59:59' }),
        mapping,
      );
      expect(result.counts.invalid).toBe(0);
      expect(result.observations[1]!.canonical_value).toBe(value);
    }
    expect(
      parseCsv(
        csv({ 'Weight(lb)': '', 'Body Fat Percentage(%)': '' }),
        mapping,
      ),
    ).toMatchObject({
      observations: [],
      counts: { observations: 0, blank: 2, invalid: 0 },
    });
  });
  it.each(['NaN', 'Infinity', '1e3', '-1', '0'])(
    'rejects invalid weight %s',
    (value) => {
      expect(
        parseCsv(csv({ 'Weight(lb)': value }), mapping).counts.invalid,
      ).toBe(1);
    },
  );
  it.each(['-0.1', '100.1'])('rejects out-of-range body fat %s', (value) => {
    expect(
      parseCsv(csv({ 'Body Fat Percentage(%)': value }), mapping).counts
        .invalid,
    ).toBe(1);
  });
  it('rejects nonempty terminal cells, extra/missing/duplicate/blank/unknown headers and mismatched widths', () => {
    expect(() => parseCsv(csv({ '': 'never discard' }), mapping)).toThrow(
      'terminal-column',
    );
    expect(() => parseCsv(csv({ '': ' ' }), mapping)).toThrow(
      'terminal-column',
    );
    for (const order of [
      headers.slice(0, -1),
      [...headers, 'Extra'],
      headers.map((h) => (h === 'BMI' ? '' : h)),
      headers.map((h) => (h === 'BMI' ? 'Date' : h)),
      headers.map((h) => (h === 'BMI' ? 'Unknown' : h)),
    ])
      expect(() => parseCsv(csv({}, order), mapping)).toThrow();
    expect(() => parseCsv(csv() + ',extra', mapping)).toThrow('malformed');
    expect(() => parseCsv(csv().slice(0, -3), mapping)).toThrow('malformed');
    expect(() =>
      parseCsv(fixture, {
        schema_version: 1,
        format: 'canonical',
        timezone: 'UTC',
        profile: null,
        single_profile: true,
        review_requested: false,
        source_label: 'Synthetic',
      }),
    ).toThrow('nonblank');
  });
  it('enforces original byte, record and row limits without truncation', () => {
    expect(() => parseCsv('x'.repeat(1024 * 1024 + 1), mapping)).toThrow(
      '1 MiB',
    );
    expect(() =>
      parseCsv(csv({ Remarks: 'x'.repeat(65536) }), mapping),
    ).toThrow('malformed');
    const empty = ','.repeat(30);
    expect(() =>
      parseCsv(
        headers.join(',') + '\n' + (empty + '\n').repeat(10001),
        mapping,
      ),
    ).toThrow('10,000');
  });
  it('accepts exactly 5,000 observations without truncation', () => {
    expect(
      parseCsv(headers.join(',') + '\n' + (row() + '\n').repeat(2500), mapping)
        .observations,
    ).toHaveLength(5000);
  });
  it('rejects input exceeding 5,000 observations', () => {
    expect(() =>
      parseCsv(headers.join(',') + '\n' + (row() + '\n').repeat(2501), mapping),
    ).toThrow('5,000');
  });
});

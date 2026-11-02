import { parse } from 'csv-parse/sync';
import { z } from 'zod';
import {
  CSV_LIMIT_BYTES,
  IMPORT_LIMIT,
  ImportMappingSchema,
  type ImportMapping,
} from '../../shared/imports.js';
import { normalizeObservation } from '../analytics/measurements.js';

const required = [
  'observed_at',
  'metric',
  'value',
  'unit',
  'source',
  'granularity',
];
const canonicalColumns = [
  ...required,
  'external_record_id',
  'local_date',
  'timezone',
  'method',
  'quality_flags',
];
export function parseCsv(csv: string, input: ImportMapping) {
  const mapping = ImportMappingSchema.parse(input);
  if (
    Buffer.byteLength(csv, 'utf8') > CSV_LIMIT_BYTES ||
    !Buffer.from(csv).toString('utf8').includes(csv)
  )
    throw new Error('CSV must be valid UTF-8 text of at most 1 MiB.');
  let records: string[][];
  try {
    records = z.array(z.array(z.string())).parse(
      parse(csv, {
        bom: true,
        skip_empty_lines: true,
        max_record_size: 65536,
      }),
    );
  } catch {
    throw new Error(
      'CSV is malformed or a record exceeds 64 KiB. Use comma-separated fields with consistent columns and valid quotes.',
    );
  }
  const headers = records.shift();
  if (
    !headers ||
    headers.length > 100 ||
    headers.some((h) => !h || h.length > 200) ||
    new Set(headers).size !== headers.length
  )
    throw new Error(
      'Use 1–100 unique, nonblank column names of at most 200 characters.',
    );
  if (records.length > 10000) throw new Error('CSV exceeds 10,000 data rows.');
  const used =
    mapping.format === 'canonical'
      ? [...canonicalColumns]
      : [
          mapping.timestamp_column,
          mapping.local_date_column,
          mapping.external_id_column,
          ...mapping.metrics.map((m) => m.column),
        ];
  const needed =
    mapping.format === 'canonical'
      ? [...required]
      : used.filter((v): v is string => v !== null);
  if (mapping.profile) {
    used.push(mapping.profile.column);
    needed.push(mapping.profile.column);
  }
  if (needed.some((column) => !headers.includes(column)))
    throw new Error(
      'Required or mapped columns are missing. Choose an explicit mapping; vendor layouts are not inferred.',
    );
  if (
    mapping.format === 'wide' &&
    new Set(mapping.metrics.map((m) => m.column)).size !==
      mapping.metrics.length
  )
    throw new Error('Map each numeric column once.');
  const counts = {
    observations: 0,
    new: 0,
    duplicate: 0,
    conflict: 0,
    invalid: 0,
    profileExcluded: 0,
    sourceExcluded: 0,
    blank: 0,
  };
  const errors: Array<{ row: number; column: string; message: string }> = [];
  let errorsOmitted = 0;
  const observations: Array<
    ReturnType<typeof normalizeObservation> & {
      external_record_id: string | null;
      provenance: {
        schema_version: 1;
        adapter: 'csv';
        row: number;
        column: string;
        mapping: ImportMapping;
      };
    }
  > = [];
  function invalid(row: number, column: string, message: string) {
    counts.invalid++;
    if (errors.length < 50) errors.push({ row, column, message });
    else errorsOmitted++;
  }
  for (const [index, values] of records.entries()) {
    const row = index + 2;
    const get = (key: string) => values[headers.indexOf(key)] ?? '';
    if (
      mapping.profile &&
      get(mapping.profile.column) !== mapping.profile.value
    ) {
      counts.profileExcluded++;
      continue;
    }
    if (
      mapping.format === 'canonical' &&
      get('source') !== mapping.source_label
    ) {
      counts.sourceExcluded++;
      continue;
    }
    const cells =
      mapping.format === 'canonical'
        ? [
            {
              column: 'value',
              metric: get('metric'),
              unit: get('unit'),
              method: get('method') || 'unknown',
            },
          ]
        : mapping.metrics;
    for (const cell of cells) {
      const value = get(cell.column).trim();
      if (!value) {
        counts.blank++;
        continue;
      }
      if (++counts.observations > IMPORT_LIMIT)
        throw new Error(
          'CSV exceeds 5,000 normalized observations. Split the file; nothing was staged.',
        );
      try {
        const observed_at = get(
          mapping.format === 'canonical'
            ? 'observed_at'
            : mapping.timestamp_column,
        ).trim();
        if (
          mapping.format === 'canonical' &&
          !/(?:Z|[+-]\d{2}:\d{2})$/.test(observed_at)
        )
          throw new Error();
        const flags =
          mapping.format === 'canonical'
            ? get('quality_flags').split(';').filter(Boolean)
            : [];
        const observation = normalizeObservation({
          metric: cell.metric,
          unit: cell.unit,
          value,
          observed_at,
          timezone:
            mapping.format === 'canonical'
              ? get('timezone').trim() || mapping.timezone
              : mapping.timezone,
          local_date:
            get(
              mapping.format === 'canonical'
                ? 'local_date'
                : (mapping.local_date_column ?? ''),
            ).trim() || null,
          granularity:
            mapping.format === 'canonical'
              ? get('granularity')
              : mapping.granularity,
          method: cell.method,
          quality_flags: [
            ...new Set([
              ...flags,
              ...(mapping.review_requested ? ['review_requested'] : []),
            ]),
          ],
        } as Parameters<typeof normalizeObservation>[0]);
        const external =
          get(
            mapping.format === 'canonical'
              ? 'external_record_id'
              : (mapping.external_id_column ?? ''),
          ).trim() || null;
        if (external && external.length > 500) throw new Error();
        observations.push({
          ...observation,
          external_record_id: external,
          provenance: {
            schema_version: 1,
            adapter: 'csv',
            row,
            column: cell.column,
            mapping,
          },
        });
      } catch {
        invalid(
          row,
          cell.column,
          'Invalid value, unit, method, granularity, flags or time. Check DST offsets and daily dates.',
        );
      }
    }
  }
  return {
    observations,
    counts,
    errors,
    errors_omitted: errorsOmitted,
    ignored_columns: headers.filter((h) => !used.includes(h)),
  };
}

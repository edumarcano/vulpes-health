import { readCsvRecords } from './csv-records.js';
import {
  CSV_LIMIT_BYTES,
  IMPORT_LIMIT,
  ImportMappingSchema,
  type ImportMapping,
} from '../../shared/imports.js';
import { normalizeObservation } from '../analytics/measurements.js';
import { validPrivateText } from './imports/renpho-v1.js';

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
  if (mapping.format === 'renpho')
    throw new Error('Use the versioned RENPHO adapter.');
  if (
    Buffer.byteLength(csv, 'utf8') > CSV_LIMIT_BYTES ||
    !Buffer.from(csv).toString('utf8').includes(csv)
  )
    throw new Error('CSV must be valid UTF-8 text of at most 1 MiB.');
  let records: string[][];
  try {
    records = readCsvRecords(csv);
  } catch {
    throw new Error(
      'CSV is malformed or a record exceeds 64 KiB. Check quotes and consistent row widths.',
    );
  }
  const headers = records.shift();
  if (
    !headers ||
    headers.length > 100 ||
    headers.some((h) => !h || h.length > 200 || !validPrivateText(h)) ||
    new Set(headers).size !== headers.length
  )
    throw new Error(
      'Use 1–100 unique, nonblank column names of at most 200 characters.',
    );
  if (records.length > 10000) throw new Error('CSV exceeds 10,000 data rows.');
  const used: Array<string | null> =
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
  const allErrors: Array<{ row: number; column: string; message: string }> = [];
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
  for (const [index, values] of records.entries()) {
    const row = index + 2,
      get = (key: string) => values[headers.indexOf(key)] ?? '';
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
      const value = get(cell.column);
      if (value === '' || value === '--') {
        counts.blank++;
        continue;
      }
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
        if (external && (external.length > 500 || !validPrivateText(external)))
          throw new Error();
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
        counts.invalid++;
        allErrors.push({
          row,
          column: cell.column,
          message:
            'Invalid value, unit, method, granularity, flags or time. Check DST offsets and daily dates.',
        });
      }
      if (observations.length > IMPORT_LIMIT)
        throw new Error(
          'CSV exceeds 25,000 normalized observations. Nothing was staged.',
        );
    }
  }
  counts.observations = observations.length;
  const ignored = headers.filter((h) => !used.includes(h));
  return {
    observations,
    counts,
    errors: allErrors.slice(0, 50),
    errors_omitted: Math.max(0, allErrors.length - 50),
    all_errors: allErrors,
    source_rows: records.length,
    ignored_columns: ignored,
    populated_unknown_columns: ignored.filter((header) =>
      records.some((values) => (values[headers.indexOf(header)] ?? '') !== ''),
    ),
  };
}

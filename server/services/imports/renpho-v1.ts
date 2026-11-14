import { readCsvRecords } from '../csv-records.js';
import { Temporal } from '@js-temporal/polyfill';
import {
  CSV_LIMIT_BYTES,
  RENPHO_COLUMNS,
  IMPORT_OBSERVATION_LIMIT,
  IMPORT_ROW_LIMIT,
  type AnnotationKey,
  type ParsedRenpho,
  type RenphoEvent,
} from '../../../shared/imports.js';
import { metricRegistry, registryMetricKeys } from '../../../shared/metrics.js';
import { normalizeObservation } from '../../analytics/measurements.js';
import { isPrivatePlainText } from '../../../shared/primitives.js';

const fields = registryMetricKeys.flatMap((key) => {
  const metric = metricRegistry[key];
  return metric.renphoHeader === null
    ? []
    : [
        {
          key,
          header: metric.renphoHeader,
          unit: metric.renphoUnit!,
          method: metric.method,
        },
      ];
});
const annotationFields: ReadonlyArray<[string, AnnotationKey, number]> = [
  ['Weight Level', 'weight_level', 200],
  ['Body Type', 'body_type', 200],
  ['Remarks', 'remarks', 4096],
];

export function parseRenphoV1(
  bytes: Uint8Array,
  timezone: string,
  reviewRequested: boolean,
): ParsedRenpho {
  if (bytes.byteLength === 0 || bytes.byteLength > CSV_LIMIT_BYTES)
    throw new Error('Choose a nonempty UTF-8 CSV of at most 1 MiB.');
  let csv: string;
  try {
    csv = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(
      bytes,
    );
  } catch {
    throw new Error(
      'The CSV is not valid UTF-8. Export it as UTF-8 without replacing invalid characters.',
    );
  }
  let rows: string[][];
  try {
    rows = readCsvRecords(csv);
  } catch {
    throw new Error(
      'CSV is malformed or a record exceeds 64 KiB. Check quotes and row widths.',
    );
  }
  const headers = rows.shift();
  if (
    !headers ||
    headers.length > 100 ||
    new Set(headers).size !== headers.length ||
    headers.some(
      (header, index) =>
        header.length > 200 ||
        !isPrivatePlainText(header) ||
        (!header && index !== headers.length - 1),
    )
  )
    throw new Error(
      'Use at most 100 unique, nonblank column names, with only one optional empty terminal column.',
    );
  if (rows.length > IMPORT_ROW_LIMIT)
    throw new Error('CSV exceeds 10,000 source rows. Nothing was staged.');
  if (rows.some((row) => row.length !== headers.length))
    throw new Error(
      'CSV row widths do not match the header. Nothing was staged.',
    );
  if (headers.at(-1) === '') {
    if (rows.some((row) => row.at(-1) !== ''))
      throw new Error(
        'The terminal-column header and every value must be exactly empty.',
      );
    headers.pop();
    for (const row of rows) row.pop();
  }
  if (
    !['Date', 'Time', 'Weight(lb)'].every((header) => headers.includes(header))
  )
    throw new Error(
      'RENPHO requires Date, Time and the supported Weight(lb) header. Other units and locales are unverified.',
    );
  if (
    headers.some(
      (header) => /^Weight\(/.test(header) && header !== 'Weight(lb)',
    )
  )
    throw new Error(
      'The weight-unit mapping is ambiguous or unsupported. Use the verified Weight(lb) export.',
    );
  // Validate the zone independently even if every source row has unavailable cells.
  Temporal.Now.instant().toZonedDateTimeISO(timezone);
  const positions = new Map(headers.map((header, i) => [header, i]));
  const unknown = headers.filter(
    (header) => !(RENPHO_COLUMNS as readonly string[]).includes(header),
  );
  const result: ParsedRenpho = {
    events: [],
    issues: [],
    unknown_columns: unknown,
    populated_unknown_columns: unknown.filter((header) =>
      rows.some((row) => row[positions.get(header)!] !== ''),
    ),
    absent_columns: fields
      .filter((field) => !positions.has(field.header))
      .map((field) => field.header),
    source_rows: rows.length,
    unavailable_cells: 0,
    empty_events: 0,
    numeric_observations: 0,
  };
  for (const [index, row] of rows.entries()) {
    const line = index + 2;
    const cell = (header: string) =>
      positions.has(header) ? row[positions.get(header)!]! : '';
    const local = `${cell('Date').replaceAll('.', '-')}T${cell('Time')}`;
    let event: RenphoEvent;
    try {
      if (
        !/^\d{4}\.\d{2}\.\d{2}$/.test(cell('Date')) ||
        !/^\d{2}:\d{2}:[0-5]\d$/.test(cell('Time'))
      )
        throw new Error();
      const zoned = Temporal.PlainDateTime.from(local, {
        overflow: 'reject',
      }).toZonedDateTime(timezone, { disambiguation: 'reject' });
      if (zoned.offsetNanoseconds % 60_000_000_000 !== 0) throw new Error();
      const no = cell('No.');
      if (!isPrivatePlainText(no) || no.length > 500) throw new Error();
      event = {
        row: line,
        no: no || null,
        local,
        instant: zoned.toInstant().toString(),
        offset: zoned.offsetNanoseconds / 60_000_000_000,
        annotations: {},
        values: [],
      };
    } catch {
      result.issues.push({
        row: line,
        column: 'Date/Time',
        message:
          'Exclude this whole row: invalid local time, calendar, row identifier, or ambiguous/nonexistent DST time.',
      });
      continue;
    }
    for (const [header, key, maximum] of annotationFields) {
      const text = cell(header);
      if (!text) continue;
      if (
        !isPrivatePlainText(text) ||
        (key === 'remarks' ? Buffer.byteLength(text) : [...text].length) >
          maximum
      ) {
        result.issues.push({
          row: line,
          column: header,
          message: `Exclude this annotation: invalid text or more than ${maximum} ${key === 'remarks' ? 'UTF-8 bytes' : 'characters'}.`,
        });
      } else event.annotations[key] = text;
    }
    for (const field of fields) {
      if (!positions.has(field.header)) continue;
      const original = cell(field.header);
      if (original === '' || original === '--') {
        result.unavailable_cells++;
        continue;
      }
      try {
        const normalized = normalizeObservation({
          metric: field.key,
          value: original,
          unit: field.unit,
          observed_at: local,
          timezone,
          local_date: null,
          granularity: 'instant',
          method: field.method,
          quality_flags: reviewRequested ? ['review_requested'] : [],
        });
        event.values.push([field.key, original, normalized.canonical_value]);
        result.numeric_observations++;
      } catch {
        result.issues.push({
          row: line,
          column: field.header,
          message:
            'Exclude this invalid numeric cell. Check its decimal value, unit and representation.',
        });
      }
      if (result.numeric_observations > IMPORT_OBSERVATION_LIMIT)
        throw new Error(
          'CSV exceeds 25,000 normalized numeric observations. Nothing was staged.',
        );
    }
    if (event.values.length) result.events.push(event);
    else result.empty_events++;
  }
  return result;
}

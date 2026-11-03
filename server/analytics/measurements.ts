import { Temporal } from '@js-temporal/polyfill';
import { Decimal } from 'decimal.js';
import {
  ObservationInputSchema,
  measurementRegistry,
  type ObservationInput,
} from '../../shared/data.js';
import {
  metricUnits,
  MeasurementDTOSchema,
  type MeasurementDTO,
} from '../../shared/domain.js';

// Inputs are bounded to 1024 characters. This retains all input digits and exact
// conversion products, with guard digits for subsequent division.
export const Exact = Decimal.clone({
  precision: 2100,
  rounding: Decimal.ROUND_HALF_EVEN,
});
export type Exact = Decimal;
export function normalizeObservation(input: ObservationInput) {
  const value = ObservationInputSchema.parse(input);
  if (
    !(measurementRegistry[value.metric].units as readonly string[]).includes(
      value.unit,
    )
  )
    throw new Error('Choose a supported unit for this metric.');
  const original = new Exact(value.value);
  const factor =
    value.unit === 'lb'
      ? '0.45359237'
      : value.unit === 'm'
        ? '100'
        : value.unit === 'in'
          ? '2.54'
          : value.unit === 'h'
            ? '60'
            : '1';
  const canonical = original.mul(factor);
  if (
    value.metric === 'body_fat_percent' &&
    (canonical.lt(0) || canonical.gt(100))
  )
    throw new Error('Percentages must be between zero and 100.');
  if (
    value.metric === 'steps_daily' &&
    (!canonical.isInteger() ||
      canonical.lt(0) ||
      canonical.gt(Number.MAX_SAFE_INTEGER))
  )
    throw new Error('Daily steps must be a nonnegative safe integer.');
  if (
    !Number.isFinite(canonical.toNumber()) ||
    (!canonical.isZero() && canonical.toNumber() === 0)
  )
    throw new Error(
      'This value cannot be represented by the measurement interface.',
    );
  // Temporal constrains second 60 while PostgreSQL rolls it into the next minute.
  // Reject it before parsing so every ingestion path preserves the same instant.
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::[0-5]\d(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(
      value.observed_at,
    )
  )
    throw new Error('Enter an ISO date/time with seconds from 00 to 59.');
  const hasOffset = /(?:Z|[+-]\d{2}:\d{2})$/.test(value.observed_at);
  const zoned = hasOffset
    ? Temporal.Instant.from(value.observed_at).toZonedDateTimeISO(
        value.timezone,
      )
    : Temporal.PlainDateTime.from(value.observed_at, {
        overflow: 'reject',
      }).toZonedDateTime(value.timezone, { disambiguation: 'reject' });
  if (!hasOffset && zoned.offsetNanoseconds % 60_000_000_000 !== 0)
    throw new Error(
      'This historical timezone requires an explicit minute offset.',
    );
  const offsetText = hasOffset
    ? value.observed_at.match(/(Z|[+-]\d{2}:\d{2})$/)![1]!
    : zoned.offset;
  const offsetMinutes =
    offsetText === 'Z'
      ? 0
      : (offsetText.startsWith('-') ? -1 : 1) *
        (Number(offsetText.slice(1, 3)) * 60 + Number(offsetText.slice(4, 6)));
  if (Math.abs(offsetMinutes) > 840)
    throw new Error('Choose an offset within 14 hours of UTC.');
  if (
    value.granularity === 'daily_total' &&
    (!value.local_date || value.local_date !== zoned.toPlainDate().toString())
  )
    throw new Error(
      'Daily totals require the declared date in the selected timezone.',
    );
  const observedAt = zoned.toInstant().toString();
  const dto = MeasurementDTOSchema.parse({
    id: '00000000-0000-4000-8000-000000000000',
    sourceId: '00000000-0000-4000-8000-000000000000',
    metric: value.metric,
    value: canonical.toNumber(),
    unit: metricUnits[value.metric],
    originalValue: value.value,
    originalUnit: value.unit,
    observedAt,
    localDate: value.local_date,
    timezone: value.timezone,
    granularity: value.granularity,
    method: value.method,
    qualityFlags: value.quality_flags,
    externalRecordId: null,
    version: 1,
  });
  return {
    metric_key: dto.metric,
    canonical_value: canonical.toFixed(),
    canonical_unit: dto.unit,
    original_value: value.value,
    original_unit: value.unit,
    observed_at: observedAt,
    original_offset_minutes: offsetMinutes,
    timezone: value.timezone,
    local_date: value.local_date,
    granularity: value.granularity,
    measurement_method: value.method,
    quality_flags: value.quality_flags,
  };
}
export type NormalizedObservation = ReturnType<typeof normalizeObservation>;
export type StoredObservation = NormalizedObservation & {
  id: string;
  source_id: string;
  external_record_id: string | null;
  version: number;
};
export function measurementDTO(row: StoredObservation): MeasurementDTO {
  return MeasurementDTOSchema.parse({
    id: row.id,
    sourceId: row.source_id,
    metric: row.metric_key,
    value: new Exact(row.canonical_value).toNumber(),
    unit: row.canonical_unit,
    originalValue: row.original_value,
    originalUnit: row.original_unit,
    observedAt: row.observed_at,
    localDate: row.local_date,
    timezone: row.timezone,
    granularity: row.granularity,
    method: row.measurement_method,
    qualityFlags: row.quality_flags,
    externalRecordId: row.external_record_id,
    version: row.version,
  });
}

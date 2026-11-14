import { Temporal } from '@js-temporal/polyfill';
import type {
  MetricKey,
  MeasurementMethod,
  Granularity,
} from '../../shared/domain.js';
import type { ImportSelection } from '../../shared/imports.js';

export function importSelections(
  rows: readonly {
    metric_key: MetricKey;
    measurement_method: MeasurementMethod;
    granularity: Granularity;
    observed_at: string;
    local_date: string | null;
  }[],
  classifications: readonly string[],
  timezone: string,
): ImportSelection[] {
  const groups = new Map<string, ImportSelection>();
  rows.forEach((row, index) => {
    if (
      !['new', 'enrichment', 'duplicate'].includes(classifications[index] ?? '')
    )
      return;
    const date =
      row.granularity === 'daily_total' && row.local_date
        ? row.local_date
        : Temporal.Instant.from(row.observed_at)
            .toZonedDateTimeISO(timezone)
            .toPlainDate()
            .toString();
    const key = JSON.stringify([
      row.metric_key,
      row.measurement_method,
      row.granularity,
    ]);
    const group = groups.get(key);
    if (group) {
      if (date < group.from) group.from = date;
      if (date > group.to) group.to = date;
    } else
      groups.set(key, {
        metric: row.metric_key,
        method: row.measurement_method,
        granularity: row.granularity,
        timezone,
        from: date,
        to: date,
      });
  });
  return [...groups.values()].map((group) => {
    const earliest = Temporal.PlainDate.from(group.to)
      .subtract({ days: 365 })
      .toString();
    return { ...group, from: group.from < earliest ? earliest : group.from };
  });
}

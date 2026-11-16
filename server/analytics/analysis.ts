import { createHash } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import {
  ANALYSIS_VERSION,
  SeriesAnalysisResultSchema,
  type AnalysisOperation,
  type AnalysisWindow,
  type SeriesAnalysisResult,
} from '../../shared/analysis.js';
import {
  METRIC_REGISTRY_VERSION,
  metricRegistry,
} from '../../shared/metrics.js';
import {
  Exact,
  measurementDTO,
  type StoredObservation,
} from './measurements.js';

export function analysisWindow(window: AnalysisWindow, timezone: string) {
  const from = Temporal.Instant.from(window.from).toZonedDateTimeISO(timezone);
  const to = Temporal.Instant.from(window.to).toZonedDateTimeISO(timezone);
  const days = from.toPlainDate().until(to.toPlainDate()).days;
  if (
    days < 1 ||
    days > 366 ||
    !from.equals(from.startOfDay()) ||
    !to.equals(to.startOfDay())
  )
    throw new Error('Select 1-366 complete local calendar days.');
  return {
    from,
    to,
    days,
    window: {
      from: from.toInstant().toString(),
      to: to.toInstant().toString(),
    },
  };
}
export function operationWindows(operation: AnalysisOperation) {
  if (
    (operation.operation === 'latest_per_metric' ||
      operation.operation === 'rolling_7d') &&
    operation.before
  ) {
    const cutoff = Temporal.Instant.from(operation.before).toZonedDateTimeISO(
      operation.timezone,
    );
    if (
      operation.series.granularity === 'daily_total' &&
      !cutoff.equals(cutoff.startOfDay())
    )
      throw new Error('Daily latest cutoffs require exclusive local midnight.');
  }
  const requested =
    'window' in operation && operation.window
      ? analysisWindow(operation.window, operation.timezone)
      : null;
  if (!requested) return { requested: null, effective: null, previous: null };
  const rolling =
    operation.operation === 'rolling_7d' ||
    (operation.operation === 'period_comparison' &&
      operation.comparisonMethod === 'rolling_7d');
  const effective = rolling
    ? analysisWindow(
        {
          from: requested.to.subtract({ days: 7 }).toInstant().toString(),
          to: requested.window.to,
        },
        operation.timezone,
      )
    : requested;
  if (operation.operation !== 'period_comparison')
    return { requested, effective, previous: null };
  const previousRequested = operation.comparisonWindow
    ? analysisWindow(operation.comparisonWindow, operation.timezone)
    : analysisWindow(
        {
          from: requested.from
            .subtract({ days: requested.days })
            .toInstant()
            .toString(),
          to: requested.window.from,
        },
        operation.timezone,
      );
  const previous = rolling
    ? analysisWindow(
        {
          from: previousRequested.to
            .subtract({ days: 7 })
            .toInstant()
            .toString(),
          to: previousRequested.window.to,
        },
        operation.timezone,
      )
    : previousRequested;
  return { requested, effective, previous };
}
function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)]),
    );
  return value;
}
export function analysisResultId(
  owner: string,
  operation: AnalysisOperation,
  revision: number,
) {
  const normalized = {
    ...operation,
    ...((operation.operation === 'latest_per_metric' ||
      operation.operation === 'rolling_7d') &&
    operation.before
      ? { before: Temporal.Instant.from(operation.before).toString() }
      : {}),
    ...('window' in operation && operation.window
      ? { window: analysisWindow(operation.window, operation.timezone).window }
      : {}),
    ...(operation.operation === 'period_comparison' &&
    operation.comparisonWindow
      ? {
          comparisonWindow: analysisWindow(
            operation.comparisonWindow,
            operation.timezone,
          ).window,
        }
      : {}),
  };
  return `analysis:${createHash('sha256')
    .update(
      JSON.stringify(
        canonical([
          owner,
          ANALYSIS_VERSION,
          METRIC_REGISTRY_VERSION,
          normalized,
          revision,
        ]),
      ),
    )
    .digest('hex')}`;
}
export function analysisBase(
  owner: string,
  operation: AnalysisOperation,
  revision: number,
  evaluatedAt: string,
  lastSuccessfulImportAt: string | null,
) {
  const id = analysisResultId(owner, operation, revision);
  return {
    schemaVersion: 1 as const,
    id,
    algorithmVersion: ANALYSIS_VERSION,
    registryVersion: METRIC_REGISTRY_VERSION,
    dataRevision: revision,
    timezone: operation.timezone,
    evaluatedAt,
    lastSuccessfulImportAt,
    evidence: { operation, resultId: id, dataRevision: revision },
  };
}
export function medianExact(values: Exact[]): Exact {
  const sorted = [...values].sort((a, b) => a.comparedTo(b));
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : sorted[middle - 1]!.plus(sorted[middle]!).div(2);
}
const mean = (values: Exact[]) =>
  values.length
    ? values
        .reduce((sum, value) => sum.plus(value), new Exact(0))
        .div(values.length)
    : null;
function localDate(row: StoredObservation, timezone: string) {
  return row.granularity === 'daily_total'
    ? row.local_date!
    : Temporal.Instant.from(row.observed_at)
        .toZonedDateTimeISO(timezone)
        .toPlainDate()
        .toString();
}
function inside(
  row: StoredObservation,
  window: AnalysisWindow,
  timezone: string,
) {
  if (row.granularity === 'daily_total') {
    const resolved = analysisWindow(window, timezone);
    return (
      row.local_date! >= resolved.from.toPlainDate().toString() &&
      row.local_date! < resolved.to.toPlainDate().toString()
    );
  }
  return (
    Temporal.Instant.compare(
      Temporal.Instant.from(row.observed_at),
      Temporal.Instant.from(window.from),
    ) >= 0 &&
    Temporal.Instant.compare(
      Temporal.Instant.from(row.observed_at),
      Temporal.Instant.from(window.to),
    ) < 0
  );
}
export function calculateAnalysis(
  owner: string,
  operation: Exclude<AnalysisOperation, { operation: 'latest_event' }>,
  rows: StoredObservation[],
  revision: number,
  evaluatedAt: string,
  lastSuccessfulImportAt: string | null,
): SeriesAnalysisResult {
  const { requested, effective, previous } = operationWindows(operation);
  const exclusions = new Map<string, { referenceId: string; reason: string }>();
  const eligible = rows.filter(
    (row) =>
      row.source_id === operation.series.source_id &&
      row.metric_key === operation.series.metric &&
      row.measurement_method === operation.series.method &&
      row.granularity === operation.series.granularity &&
      ((operation.operation !== 'latest_per_metric' &&
        operation.operation !== 'rolling_7d') ||
        !operation.before ||
        (row.granularity === 'daily_total'
          ? row.local_date! <
            Temporal.Instant.from(operation.before)
              .toZonedDateTimeISO(operation.timezone)
              .toPlainDate()
              .toString()
          : Temporal.Instant.compare(
              Temporal.Instant.from(row.observed_at),
              Temporal.Instant.from(operation.before),
            ) < 0)),
  );
  const selected = (window: AnalysisWindow | null) =>
    window
      ? eligible.filter((row) => inside(row, window, operation.timezone))
      : eligible;
  function windowValue(
    window: AnalysisWindow | null,
    records: StoredObservation[],
    statistic: 'latest_value' | 'observed_day_mean' | 'rolling_7d' | 'endpoint',
  ) {
    const groups = new Map<string, StoredObservation[]>();
    for (const row of records) {
      const date = localDate(row, operation.timezone);
      const group = groups.get(date) ?? [];
      group.push(row);
      groups.set(date, group);
    }
    const values = new Map<string, Exact>();
    for (const [date, group] of groups) {
      if (
        operation.series.granularity === 'session_total' &&
        !['latest_value', 'endpoint'].includes(statistic)
      )
        continue;
      if (
        operation.series.granularity === 'daily_total' &&
        new Set(group.map((row) => new Exact(row.canonical_value).toFixed()))
          .size > 1
      ) {
        for (const row of group)
          exclusions.set(row.id, {
            referenceId: row.id,
            reason:
              'Conflicting daily totals; select or correct the source records.',
          });
        continue;
      }
      values.set(
        date,
        medianExact(group.map((row) => new Exact(row.canonical_value))),
      );
    }
    if (
      statistic === 'latest_value' &&
      new Set(records.map((row) => new Exact(row.canonical_value).toFixed()))
        .size > 1
    ) {
      values.clear();
      for (const row of records)
        exclusions.set(row.id, {
          referenceId: row.id,
          reason:
            'Conflicting latest readings; review the tied source records.',
        });
    }
    const contributes = records.filter((row) =>
      values.has(localDate(row, operation.timezone)),
    );
    const dates = records
      .map((row) => row.observed_at)
      .sort((a, b) =>
        Temporal.Instant.compare(
          Temporal.Instant.from(a),
          Temporal.Instant.from(b),
        ),
      );
    const oldest =
      contributes
        .map((row) => row.observed_at)
        .sort((a, b) =>
          Temporal.Instant.compare(
            Temporal.Instant.from(a),
            Temporal.Instant.from(b),
          ),
        )[0] ?? null;
    const sample =
      operation.series.metric === 'heart_rate' &&
      !['latest_value', 'endpoint'].includes(statistic);
    const unsupported =
      (operation.series.granularity !== 'instant' &&
        !['latest_value', 'endpoint'].includes(statistic)) ||
      (sample && statistic === 'rolling_7d');
    const enough = values.size >= (statistic === 'rolling_7d' ? 3 : 1);
    const samples = records.map((row) => new Exact(row.canonical_value));
    const scalar =
      unsupported || !enough
        ? null
        : ['latest_value', 'endpoint'].includes(statistic)
          ? new Exact(records.at(-1)!.canonical_value)
          : sample
            ? medianExact(samples)
            : mean([...values.values()]);
    const bounds = window ? analysisWindow(window, operation.timezone) : null;
    const now = Temporal.Instant.from(evaluatedAt);
    return {
      value: {
        window,
        value: scalar?.toFixed() ?? null,
        statistic: sample
          ? ('observed_samples' as const)
          : unsupported
            ? operation.series.granularity === 'daily_total'
              ? ('uncombined_daily_totals' as const)
              : ('uncombined_sessions' as const)
            : statistic,
        coverageStatus: unsupported
          ? ('unsupported' as const)
          : scalar === null
            ? ('insufficient_data' as const)
            : ('sufficient' as const),
        observationCount: records.length,
        observedDays:
          operation.series.granularity === 'session_total'
            ? groups.size
            : values.size,
        calendarDays: bounds?.days ?? null,
        partialCurrentDay:
          !!bounds &&
          Temporal.Instant.compare(now, bounds.from.toInstant()) >= 0 &&
          Temporal.Instant.compare(now, bounds.to.toInstant()) < 0,
        firstMeasuredAt: dates[0] ?? null,
        lastMeasuredAt: dates.at(-1) ?? null,
        oldestContributingAt: oldest,
        ageSeconds: oldest
          ? Math.max(
              0,
              now.since(Temporal.Instant.from(oldest)).total('seconds'),
            )
          : null,
        sampleMean:
          operation.operation === 'observed_day_mean' &&
          operation.includeSampleMean &&
          !unsupported
            ? (mean(samples)?.toFixed() ?? null)
            : null,
        sampleStatistics:
          operation.series.metric === 'heart_rate' && samples.length
            ? {
                median: medianExact(samples).toFixed(),
                min: Exact.min(...samples).toFixed(),
                max: Exact.max(...samples).toFixed(),
              }
            : null,
      },
      values,
    };
  }
  let currentRecords = selected(effective?.window ?? null);
  let previousRecords: StoredObservation[] = previous
    ? selected(previous.window)
    : [];
  if (operation.operation === 'latest_per_metric') {
    const ordered = [...currentRecords].sort(
      (a, b) =>
        (operation.series.granularity === 'daily_total'
          ? a.local_date!.localeCompare(b.local_date!)
          : 0) ||
        Temporal.Instant.compare(
          Temporal.Instant.from(a.observed_at),
          Temporal.Instant.from(b.observed_at),
        ) ||
        a.id.localeCompare(b.id),
    );
    const last = ordered.at(-1);
    currentRecords = last
      ? ordered.filter((row) =>
          operation.series.granularity === 'daily_total'
            ? row.local_date === last.local_date
            : Temporal.Instant.compare(
                Temporal.Instant.from(row.observed_at),
                Temporal.Instant.from(last.observed_at),
              ) === 0,
        )
      : [];
  }
  if (operation.operation === 'endpoint_difference') {
    previousRecords = eligible.filter(
      (row) => row.id === operation.endpointIds[0],
    );
    currentRecords = eligible.filter(
      (row) => row.id === operation.endpointIds[1],
    );
  }
  const statistic =
    operation.operation === 'latest_per_metric'
      ? 'latest_value'
      : operation.operation === 'endpoint_difference'
        ? 'endpoint'
        : operation.operation === 'rolling_7d' ||
            (operation.operation === 'period_comparison' &&
              operation.comparisonMethod === 'rolling_7d')
          ? 'rolling_7d'
          : 'observed_day_mean';
  const current = windowValue(
    effective?.window ?? null,
    currentRecords,
    statistic,
  );
  const old =
    previous || operation.operation === 'endpoint_difference'
      ? windowValue(previous?.window ?? null, previousRecords, statistic)
      : null;
  const delta =
    current.value.value !== null &&
    old?.value.value !== null &&
    old?.value.value !== undefined
      ? new Exact(current.value.value).minus(old.value.value)
      : null;
  const used = [
    ...new Map(
      [...currentRecords, ...previousRecords].map((row) => [row.id, row]),
    ).values(),
  ];
  const points: Array<{ localDate: string; value: string | null }> = [];
  if (effective)
    for (
      let date = effective.from.toPlainDate();
      Temporal.PlainDate.compare(date, effective.to.toPlainDate()) < 0;
      date = date.add({ days: 1 })
    )
      points.push({
        localDate: date.toString(),
        value: current.values.get(date.toString())?.toFixed() ?? null,
      });
  return SeriesAnalysisResultSchema.parse({
    ...analysisBase(
      owner,
      operation,
      revision,
      evaluatedAt,
      lastSuccessfulImportAt,
    ),
    kind: 'series_analysis',
    operation: operation.operation,
    series: operation.series,
    unit: metricRegistry[operation.series.metric].canonicalUnit,
    requestedWindow: requested?.window ?? null,
    effectiveWindow: effective?.window ?? null,
    current: current.value,
    previous: old?.value ?? null,
    absoluteChange: delta?.toFixed() ?? null,
    absoluteChangeUnit:
      metricRegistry[operation.series.metric].representation === 'percentage'
        ? 'percentage_points'
        : metricRegistry[operation.series.metric].canonicalUnit,
    relativeChangePercent:
      delta !== null && old?.value.value && !new Exact(old.value.value).isZero()
        ? delta.div(old.value.value).mul(100).toFixed()
        : null,
    alignment:
      operation.operation === 'endpoint_difference'
        ? 'explicit_endpoints'
        : previous
          ? 'independent_windows'
          : 'single_series',
    endpoints:
      operation.operation === 'endpoint_difference'
        ? [...previousRecords, ...currentRecords].map(measurementDTO)
        : operation.operation === 'latest_per_metric'
          ? currentRecords.slice(-1).map(measurementDTO)
          : [],
    points,
    references: used.slice(0, 200).map((row) => ({
      id: row.id,
      version: row.version,
      observedAt: row.observed_at,
      eventId: row.event_id ?? null,
      qualityFlags: row.quality_flags,
    })),
    hasMoreReferences: used.length > 200,
    exclusions: [...exclusions.values()],
    limitations: [
      metricRegistry[operation.series.metric].limitation,
      ...(operation.operation === 'endpoint_difference'
        ? [
            'Observed endpoint difference; this does not establish a sustained trend.',
          ]
        : []),
      ...(previous
        ? [
            'Windows are summarized independently; values are not a paired weigh-in or evidence of causation.',
          ]
        : []),
      ...(used.length > 200
        ? [
            'Evidence references are bounded; use the owned selection and revision to page through all source observations.',
          ]
        : []),
    ],
  });
}

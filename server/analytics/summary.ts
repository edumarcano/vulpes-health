import { Temporal } from '@js-temporal/polyfill';
import { DataSummarySchema, type DataSelection } from '../../shared/data.js';
import { metricUnits } from '../../shared/domain.js';
import { Exact, measurementDTO, type StoredObservation } from './measurements.js';

export function selectionWindows(selection: DataSelection) {
  const from = Temporal.Instant.from(selection.from).toZonedDateTimeISO(selection.timezone);
  const to = Temporal.Instant.from(selection.to).toZonedDateTimeISO(selection.timezone);
  if (Temporal.ZonedDateTime.compare(from,to) >= 0 || from.toPlainDate().until(to.toPlainDate()).days > 366) throw new Error('Choose a nonempty interval of at most 366 days.');
  if (!from.equals(from.startOfDay()) || !to.equals(to.startOfDay())) throw new Error('Select complete local calendar days.');
  const current = to.subtract({ days: 7 }); const previous = current.subtract({ days: 7 });
  return { from, to, current, previous, readFrom: Temporal.ZonedDateTime.compare(from,previous) < 0 ? from : previous };
}
function median(values: Exact[]): Exact {
  const sorted = [...values].sort((a,b) => a.comparedTo(b));
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : sorted[mid-1]!.plus(sorted[mid]!).div(2);
}
function finite(value: Exact | null): number | null {
  if (value === null) return null;
  const number = value.toNumber(); return Number.isFinite(number) ? number : null;
}
export function summarizeMeasurementsExact(rows: StoredObservation[], selection: DataSelection, revision: number) {
  const windows = selectionWindows(selection);
  const allowed = rows.filter((row) => row.source_id === selection.source_id && row.metric_key === selection.metric && row.measurement_method === selection.method && row.granularity === selection.granularity);
  const between = (row: StoredObservation, from: Temporal.ZonedDateTime, to: Temporal.ZonedDateTime) => {
    if (row.granularity === 'daily_total') return row.local_date! >= from.toPlainDate().toString() && row.local_date! < to.toPlainDate().toString();
    const instant = Temporal.Instant.from(row.observed_at);
    return Temporal.Instant.compare(instant,from.toInstant()) >= 0 && Temporal.Instant.compare(instant,to.toInstant()) < 0;
  };
  const selected = allowed.filter((row) => between(row,windows.from,windows.to));
  const exclusions: Array<{referenceId: string; reason: string}> = [];
  function daily(from: Temporal.ZonedDateTime, to: Temporal.ZonedDateTime) {
    const groups = new Map<string, StoredObservation[]>();
    for (const row of allowed.filter((item) => between(item,from,to))) {
      const date = row.granularity === 'daily_total' ? row.local_date! : Temporal.Instant.from(row.observed_at).toZonedDateTimeISO(selection.timezone).toPlainDate().toString();
      const group = groups.get(date) ?? []; group.push(row); groups.set(date,group);
    }
    const values = new Map<string, Exact>();
    for (const [date,group] of groups) {
      if (selection.granularity === 'session_total') continue; // No interval information permits safe aggregation.
      if (selection.granularity === 'daily_total' && new Set(group.map((row) => new Exact(row.canonical_value).toFixed())).size > 1) {
        for (const row of group) exclusions.push({ referenceId: `measurement:${row.id}`, reason: 'Conflicting daily totals; select/correct the source records.' });
        continue;
      }
      values.set(date,median(group.map((row) => new Exact(row.canonical_value))));
    }
    return values;
  }
  const current = daily(windows.current,windows.to); const previous = daily(windows.previous,windows.current);
  const plot = daily(windows.from,windows.to);
  const mean = (days: Map<string,Exact>) => days.size >= 3 ? [...days.values()].reduce((sum,value) => sum.plus(value),new Exact(0)).div(days.size) : null;
  const sample = selection.metric === 'heart_rate';
  const scalar = !sample && selection.granularity === 'instant';
  const sampleValues = selected.map((row) => new Exact(row.canonical_value));
  const value = sample ? sampleValues.length ? median(sampleValues) : null : scalar ? mean(current) : null;
  const old = scalar ? mean(previous) : null;
  const change = value !== null && old !== null ? value.minus(old) : null;
  const points = (from: Temporal.ZonedDateTime,to: Temporal.ZonedDateTime,values: Map<string,Exact>) => {
    const result = [];
    for (let date = from.toPlainDate(); Temporal.PlainDate.compare(date,to.toPlainDate()) < 0; date = date.add({ days:1 })) result.push({ localDate: date.toString(), value: finite(values.get(date.toString()) ?? null) });
    return result;
  };
  const latest = [...selected].sort((a,b) => Temporal.Instant.compare(Temporal.Instant.from(b.observed_at),Temporal.Instant.from(a.observed_at)) || b.id.localeCompare(a.id))[0];
  const contributing = scalar ? allowed.filter((row) => between(row,windows.previous,windows.to)) : selected;
  const result = DataSummarySchema.parse({
    selection, dataRevision: revision, latest: latest ? measurementDTO(latest) : null,
    series: points(windows.from,windows.to,plot),
    analysis: {
      id: `analysis:${selection.source_id}:${revision}:${selection.metric}:${selection.method}:${selection.granularity}:${selection.timezone}:${selection.from}:${selection.to}`,
      metric: selection.metric, unit: metricUnits[selection.metric], sourceId: selection.source_id,
      from: scalar ? windows.current.toInstant().toString() : selection.from, to: selection.to, timezone: selection.timezone,
      algorithmVersion: scalar ? 'daily_median_mean_7d_v1' : sample ? 'observed_samples_v1' : 'uncombined_totals_v1', dataRevision: revision,
      observationCount: (scalar ? allowed.filter((row) => between(row,windows.current,windows.to)) : selected).length,
      validDays: scalar ? current.size : selection.granularity==='daily_total' ? plot.size : new Set(selected.map((row) => row.local_date ?? Temporal.Instant.from(row.observed_at).toZonedDateTimeISO(selection.timezone).toPlainDate().toString())).size,
      coverageStatus: scalar ? value === null ? 'insufficient_data' : 'sufficient' : (selection.granularity==='daily_total' ? plot.size : selected.length) ? 'sufficient' : 'insufficient_data',
      value: finite(value), previousValue: finite(old), absoluteChange: finite(change), relativeChangePercent: change !== null && old !== null && !old.isZero() ? finite(change.div(old).mul(100)) : null,
      points: scalar ? points(windows.current,windows.to,current) : points(windows.from,windows.to,plot),
      exclusions: [...new Map(exclusions.map((item) => [item.referenceId,item])).values()],
      references: contributing.map((row) => ({ id:`measurement:${row.id}`, kind:'measurement', label:`${row.observed_at} ${metricUnits[selection.metric]}` })),
      method: selection.method, granularity: selection.granularity, statistic: scalar ? 'daily_median_mean_7d' : sample ? 'observed_samples' : selection.granularity === 'daily_total' ? 'daily_totals' : 'session_observations',
      statistics: sampleValues.length && sample ? { median:finite(median(sampleValues)), min:finite(sampleValues.reduce((a,b)=>Exact.min(a,b))), max:finite(sampleValues.reduce((a,b)=>Exact.max(a,b))) } : null,
      previousWindow: { from:windows.previous.toInstant().toString(), to:windows.current.toInstant().toString(), validDays:previous.size, coverageStatus:previous.size >= 3 ? 'sufficient' : 'insufficient_data' },
    },
  });
  return {result,exactValue:value?.toFixed()??null};
}
export function summarizeMeasurements(rows: StoredObservation[],selection:DataSelection,revision:number){return summarizeMeasurementsExact(rows,selection,revision).result;}

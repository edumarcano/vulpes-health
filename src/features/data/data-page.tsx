import { useRef, useState } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ownedJson, ownedDownload } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-context';
import { successEnvelopeSchema } from '../../../shared/api';
import {
  DataSummarySchema,
  MeasurementsPageSchema,
  MutationResultSchema,
  SourcesPageSchema,
  measurementRegistry,
  type AddMeasurement,
  type DataSelection,
} from '../../../shared/data';
import type {
  MetricKey,
  MeasurementMethod,
  Granularity,
  MeasurementDTO,
} from '../../../shared/domain';
import { ManualForm } from './manual-form';
import { ImportForm } from './import-form';
import { MeasurementEditor } from './measurement-editor';
import { DataChartView } from './data-chart-view';
import { formatMeasurement as number } from './format';

export function DataPage() {
  const { state, scope } = useAuth();
  const session = state.kind === 'signed_in' ? state.session : null;
  const epoch = scope.epoch;
  const client = useQueryClient();
  const root = ['data', session?.user.id, epoch];
  const [source, setSource] = useState('');
  const [metric, setMetric] = useState<MetricKey>('weight');
  const [method, setMethod] = useState<MeasurementMethod>('user_reported');
  const [granularity, setGranularity] = useState<Granularity>('instant');
  const [zone, setZone] = useState<string | null>(null);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [notice, setNotice] = useState('');
  const [editing, setEditing] = useState<{
    reading: MeasurementDTO;
    mode: 'correct' | 'delete';
  } | null>(null);
  const [download, setDownload] = useState<
    { kind: 'idle' | 'loading' | 'done' } | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  const tableHeading = useRef<HTMLHeadingElement>(null);
  const sources = useInfiniteQuery({
    queryKey: [...root, 'sources'],
    enabled: !!session,
    initialPageParam: null as string | null,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal, pageParam }) =>
      successEnvelopeSchema(SourcesPageSchema).parse(
        await ownedJson(
          '/api/data?' +
            new URLSearchParams({
              view: 'sources',
              ...(pageParam ? { cursor: pageParam } : {}),
            }),
          session!.access_token,
          scope,
          epoch,
          { signal },
        ),
      ).data,
    getNextPageParam: (page) => page.nextCursor,
  });
  const allSources = sources.data?.pages.flatMap((page) => page.items) ?? [];
  const chosenSource = source || allSources[0]?.id || '';
  const timezone = zone ?? sources.data?.pages[0]?.timezone ?? 'UTC';
  let selection: DataSelection | null = null;
  let intervalError = '';
  let displayFrom = from;
  let displayTo = to;
  try {
    const today = Temporal.Now.plainDateISO(timezone);
    displayFrom = from || today.subtract({ days: 13 }).toString();
    displayTo = to || today.toString();
    selection = {
      metric,
      source_id: chosenSource,
      from: Temporal.PlainDate.from(displayFrom)
        .toZonedDateTime(timezone)
        .toInstant()
        .toString(),
      to: Temporal.PlainDate.from(displayTo)
        .add({ days: 1 })
        .toZonedDateTime(timezone)
        .toInstant()
        .toString(),
      timezone,
      method,
      granularity,
    };
    const days = Temporal.PlainDate.from(displayFrom).until(
      Temporal.PlainDate.from(displayTo),
    ).days;
    if (days < 0 || days >= 366) {
      selection = null;
      intervalError = 'Select 1–366 local calendar days.';
    }
  } catch {
    selection = null;
    intervalError = 'Choose valid dates and an IANA timezone.';
  }
  const selectionKey = selection ? JSON.stringify(selection) : null;
  const summary = useQuery({
    queryKey: [...root, 'summary', selectionKey],
    enabled: !!session && !!chosenSource && !!selection,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal }) =>
      successEnvelopeSchema(DataSummarySchema).parse(
        await ownedJson(
          '/api/data?' +
            new URLSearchParams({ view: 'summary', ...selection! }),
          session!.access_token,
          scope,
          epoch,
          { signal },
        ),
      ).data,
  });
  const readings = useInfiniteQuery({
    queryKey: [
      ...root,
      'measurements',
      selectionKey,
      summary.data?.dataRevision,
    ],
    enabled: !!session && !!chosenSource && !!selection && !!summary.data,
    initialPageParam: null as string | null,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal, pageParam }) =>
      successEnvelopeSchema(MeasurementsPageSchema).parse(
        await ownedJson(
          '/api/data?' +
            new URLSearchParams({
              view: 'measurements',
              ...selection!,
              data_revision: String(summary.data!.dataRevision),
              ...(pageParam ? { cursor: pageParam } : {}),
            }),
          session!.access_token,
          scope,
          epoch,
          { signal },
        ),
      ).data,
    getNextPageParam: (page) => page.nextCursor,
  });
  const mutation = useMutation({
    retry: false,
    mutationFn: async (request: AddMeasurement) =>
      successEnvelopeSchema(MutationResultSchema).parse(
        await ownedJson('/api/data', session!.access_token, scope, epoch, {
          method: 'POST',
          body: JSON.stringify(request),
        }),
      ).data,
    onSuccess: (result, request) => {
      scope.commit(epoch, () => {
        setSource(result.sourceId);
        setMetric(request.observation.metric);
        setMethod(request.observation.method);
        setGranularity(request.observation.granularity);
        setNotice(
          result.outcome === 'created'
            ? 'Measurement saved. Your selected date range is unchanged.'
            : 'This reading already exists; no duplicate was saved.',
        );
        void client.invalidateQueries({ queryKey: root });
      });
    },
  });
  const data = summary.data;
  const items = readings.data?.pages.flatMap((page) => page.items) ?? [];
  function refresh() {
    void client.invalidateQueries({ queryKey: root });
  }
  function closeEditor() {
    setEditing(null);
    tableHeading.current?.focus();
  }
  async function exportSelection() {
    if (!session || !selection || !data) return;
    setDownload({ kind: 'loading' });
    try {
      await ownedDownload(
        '/api/data?' +
          new URLSearchParams({
            view: 'export',
            ...selection,
            data_revision: String(data.dataRevision),
          }),
        session.access_token,
        scope,
        epoch,
      );
      scope.commit(epoch, () => setDownload({ kind: 'done' }));
    } catch (e) {
      scope.commit(epoch, () =>
        setDownload({
          kind: 'error',
          message:
            e instanceof Error
              ? e.message
              : 'Export failed. Refresh and try again.',
        }),
      );
    }
  }
  return (
    <>
      <header className="page-heading">
        <h1 tabIndex={-1}>Data</h1>
      </header>
      <div className="data-stack">
        {sources.isPending ? (
          <p role="status">Loading your sources…</p>
        ) : sources.isError ? (
          <Card>
            <p role="alert">Sources could not be loaded.</p>
            <Button onClick={refresh}>Retry data</Button>
          </Card>
        ) : (
          <>
            <Card>
              <ManualForm
                sources={allSources}
                timezone={sources.data.pages[0]!.timezone}
                busy={mutation.isPending}
                save={async (request) => {
                  await mutation.mutateAsync(request);
                }}
              />
              <p role="status">{notice}</p>
            </Card>
            <Card>
              <ImportForm
                sources={allSources}
                timezone={timezone}
                dataRevision={sources.data.pages[0]!.dataRevision}
                onSaved={(result) => {
                  setSource(result.source_id);
                  void client.invalidateQueries({ queryKey: root });
                }}
              />
            </Card>
            {sources.hasNextPage && (
              <Button
                variant="outline"
                disabled={sources.isFetchingNextPage}
                onClick={() => void sources.fetchNextPage()}
              >
                Load more sources
              </Button>
            )}
            <Card>
              <h2>Explore measurements</h2>
              <div className="settings-form data-filters">
                <label htmlFor="data-source">Source</label>
                <select
                  id="data-source"
                  value={chosenSource}
                  onChange={(event) => setSource(event.target.value)}
                >
                  <option value="" disabled>
                    Select a source
                  </option>
                  {allSources.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label} · {item.deviceLabel ?? item.kind} ·{' '}
                      {item.id.slice(0, 8)}
                    </option>
                  ))}
                </select>
                <label htmlFor="data-metric">Metric</label>
                <select
                  id="data-metric"
                  value={metric}
                  onChange={(event) => {
                    const next = event.target.value as MetricKey;
                    setMetric(next);
                    setGranularity(
                      next === 'steps_daily'
                        ? 'daily_total'
                        : next === 'sleep_duration'
                          ? 'session_total'
                          : 'instant',
                    );
                  }}
                >
                  {Object.entries(measurementRegistry).map(([key, item]) => (
                    <option key={key} value={key}>
                      {item.label}
                    </option>
                  ))}
                </select>
                <label htmlFor="data-method">Method</label>
                <select
                  id="data-method"
                  value={method}
                  onChange={(event) =>
                    setMethod(event.target.value as MeasurementMethod)
                  }
                >
                  <option value="user_reported">User reported</option>
                  <option value="device_reported">Device reported</option>
                  <option value="device_estimate">Device estimate</option>
                  <option value="unknown">Unknown</option>
                </select>
                <label htmlFor="data-granularity">Granularity</label>
                <select
                  id="data-granularity"
                  value={granularity}
                  onChange={(event) =>
                    setGranularity(event.target.value as Granularity)
                  }
                >
                  <option value="instant">Instant reading</option>
                  <option value="daily_total">Daily total</option>
                  <option value="session_total">Session total</option>
                </select>
                <label>
                  From date
                  <input
                    type="date"
                    value={displayFrom}
                    onChange={(event) => setFrom(event.target.value)}
                  />
                </label>
                <label>
                  Through date
                  <input
                    type="date"
                    value={displayTo}
                    onChange={(event) => setTo(event.target.value)}
                  />
                </label>
                <label>
                  Analysis timezone
                  <input
                    value={timezone}
                    onChange={(event) => setZone(event.target.value)}
                  />
                </label>
                <Button variant="outline" onClick={refresh}>
                  Refresh data
                </Button>
              </div>
              {intervalError && <p role="alert">{intervalError}</p>}
              <p>
                Export includes only the selected source, metric, method,
                granularity and date range. It contains private measurement
                content; store it securely. Formula-sensitive text is prefixed
                with an apostrophe; numeric values keep their meaning.
              </p>
              <Button
                variant="outline"
                disabled={
                  !data ||
                  !selection ||
                  summary.isError ||
                  summary.isFetching ||
                  download.kind === 'loading'
                }
                onClick={() => void exportSelection()}
              >
                {download.kind === 'loading'
                  ? 'Preparing CSV…'
                  : 'Export selected measurements'}
              </Button>
              {download.kind === 'done' && (
                <p role="status">
                  CSV download started for the selection at the time you clicked
                  Export.
                </p>
              )}
              {download.kind === 'error' && (
                <p role="alert">{download.message}</p>
              )}
              {!chosenSource ? (
                <section>
                  <h2>No measurements loaded</h2>
                  <p>Add a manual reading to create your first source.</p>
                </section>
              ) : !selection ? null : summary.isPending ? (
                <p role="status">Calculating your selected data…</p>
              ) : summary.isError ? (
                <p role="alert">
                  The summary could not be loaded. Refresh to retry; no previous
                  result is presented as current.
                </p>
              ) : (
                data && (
                  <>
                    <section
                      aria-label="Deterministic summary"
                      className="data-summary"
                    >
                      <h3>
                        {data.analysis.statistic === 'daily_median_mean_7d'
                          ? 'Seven-day mean of daily medians'
                          : data.analysis.statistic === 'observed_samples'
                            ? 'Observed sample distribution'
                            : 'Uncombined observations'}
                      </h3>
                      {summary.isFetching && (
                        <p role="status">
                          Refreshing data. The displayed result may be stale.
                        </p>
                      )}
                      <p>
                        Source:{' '}
                        {
                          allSources.find((item) => item.id === chosenSource)
                            ?.label
                        }{' '}
                        · {method} · {granularity}
                      </p>
                      <p>
                        Analysis interval: {data.analysis.from} to{' '}
                        {data.analysis.to} (end excluded), {timezone}.
                      </p>
                      <p>
                        {data.analysis.coverageStatus ===
                        'insufficient_data' ? (
                          data.analysis.statistic === 'daily_median_mean_7d' ? (
                            'Insufficient data. A seven-day mean requires at least three valid days.'
                          ) : (
                            'Insufficient data. No observations are available for this selection.'
                          )
                        ) : data.analysis.value === null ? (
                          'Totals and sessions are not combined into a headline mean.'
                        ) : (
                          <>
                            Current:{' '}
                            <strong data-testid="headline-value">
                              {number(data.analysis.value)} {data.analysis.unit}
                            </strong>
                          </>
                        )}
                      </p>
                      {data.analysis.previousValue !== null && (
                        <p>
                          Previous seven days:{' '}
                          {number(data.analysis.previousValue)}{' '}
                          {data.analysis.unit}.
                        </p>
                      )}
                      {data.analysis.absoluteChange !== null && (
                        <p>
                          Absolute change:{' '}
                          {number(data.analysis.absoluteChange)}{' '}
                          {metric === 'body_fat_percent'
                            ? 'percentage points'
                            : data.analysis.unit}
                          .
                          {data.analysis.relativeChangePercent !== null && (
                            <>
                              {' '}
                              Relative change:{' '}
                              {number(data.analysis.relativeChangePercent)}%.
                            </>
                          )}
                        </p>
                      )}
                      {data.analysis.statistics && (
                        <p>
                          Observed median{' '}
                          {number(data.analysis.statistics.median)} bpm; range{' '}
                          {number(data.analysis.statistics.min)}–
                          {number(data.analysis.statistics.max)} bpm. These
                          samples do not establish resting rate or continuous
                          coverage.
                        </p>
                      )}
                      <p>
                        {data.analysis.observationCount} observations;{' '}
                        {data.analysis.validDays} valid days. Algorithm{' '}
                        {data.analysis.algorithmVersion}; data revision{' '}
                        {data.dataRevision}.
                      </p>
                      <p>
                        {data.latest ? (
                          <>
                            Latest in selection: {number(data.latest.value)}{' '}
                            {data.latest.unit} at {data.latest.observedAt}.
                          </>
                        ) : (
                          'No readings in this selection.'
                        )}
                      </p>
                      {data.analysis.exclusions.length > 0 && (
                        <p role="status">
                          {data.analysis.exclusions.length} conflicting daily
                          observations excluded from the chart. Review the
                          table.
                        </p>
                      )}
                    </section>
                    <DataChartView data={data} />
                  </>
                )
              )}
            </Card>
            {chosenSource && selection && (
              <Card>
                <h2 ref={tableHeading} tabIndex={-1}>
                  Measurement table
                </h2>
                {readings.isError ? (
                  <p role="alert">
                    The readings changed or could not be loaded. Refresh the
                    selection.
                  </p>
                ) : readings.isPending ? (
                  <p role="status">Loading readings…</p>
                ) : items.length === 0 ? (
                  <p>No readings in this selection.</p>
                ) : (
                  <>
                    <div
                      className="data-table-scroll"
                      tabIndex={0}
                      role="region"
                      aria-label="Scrollable measurement table"
                    >
                      <table>
                        <caption>
                          Individual observations with original units and source
                          context
                        </caption>
                        <thead>
                          <tr>
                            <th scope="col">Timestamp</th>
                            <th scope="col">Value</th>
                            <th scope="col">Original</th>
                            <th scope="col">Source / method</th>
                            <th scope="col">Quality</th>
                            <th scope="col">Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {items.map((item) => (
                            <tr key={item.id}>
                              <td>
                                {item.observedAt}
                                <br />
                                {item.timezone}
                                {item.localDate && (
                                  <>
                                    <br />
                                    {item.localDate}
                                  </>
                                )}
                              </td>
                              <td>
                                {number(item.value)} {item.unit}
                              </td>
                              <td>
                                {item.originalValue} {item.originalUnit}
                              </td>
                              <td>
                                {
                                  allSources.find(
                                    (entry) => entry.id === item.sourceId,
                                  )?.label
                                }
                                <br />
                                {item.method}
                                <br />
                                {item.granularity}
                              </td>
                              <td>
                                {item.qualityFlags.join(', ') || 'No flags'}
                              </td>
                              <td>
                                <div className="data-actions">
                                  <Button
                                    variant="outline"
                                    onClick={() =>
                                      setEditing({
                                        reading: item,
                                        mode: 'correct',
                                      })
                                    }
                                  >
                                    Correct
                                  </Button>
                                  <Button
                                    variant="outline"
                                    onClick={() =>
                                      setEditing({
                                        reading: item,
                                        mode: 'delete',
                                      })
                                    }
                                  >
                                    Delete
                                  </Button>
                                </div>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {readings.hasNextPage && (
                      <Button
                        variant="outline"
                        disabled={readings.isFetchingNextPage}
                        onClick={() => void readings.fetchNextPage()}
                      >
                        Load more readings
                      </Button>
                    )}
                  </>
                )}
                {editing && (
                  <MeasurementEditor
                    key={`${editing.reading.id}:${editing.reading.version}:${editing.mode}`}
                    {...editing}
                    source={
                      allSources.find((s) => s.id === editing.reading.sourceId)
                        ?.label ?? 'Selected source'
                    }
                    onCancel={closeEditor}
                    onRefresh={() => {
                      closeEditor();
                      refresh();
                    }}
                    onSaved={(message) => {
                      setNotice(message);
                      closeEditor();
                      refresh();
                    }}
                  />
                )}
              </Card>
            )}
          </>
        )}
        <p className="detail-note">
          Manual measurements, CSV import, correction, deletion and
          selected-data export are available. Android Health Connect is planned
          for a later release. Calculations are not medical diagnoses.
        </p>
      </div>
    </>
  );
}

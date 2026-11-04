import { useRef, useState } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import { Plus, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { cn } from '@/lib/utils';
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
  const [manualOpen, setManualOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const tableHeading = useRef<HTMLHeadingElement>(null);
  const manualTrigger = useRef<HTMLButtonElement>(null);
  const importTrigger = useRef<HTMLButtonElement>(null);
  function applyQuickRange(range: '7D' | '14D' | '30D' | '90D' | '365D') {
    const today = Temporal.Now.plainDateISO(timezone);
    let fromDate: Temporal.PlainDate;
    if (range === '7D') fromDate = today.subtract({ days: 6 });
    else if (range === '14D') fromDate = today.subtract({ days: 13 });
    else if (range === '30D') fromDate = today.subtract({ days: 29 });
    else if (range === '90D') fromDate = today.subtract({ days: 89 });
    else fromDate = today.subtract({ days: 364 });
    setFrom(fromDate.toString());
    setTo(today.toString());
  }
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
  function isQuickRange(range: string) {
    try {
      const today = Temporal.Now.plainDateISO(timezone);
      return (
        displayTo === today.toString() &&
        displayFrom ===
          today.subtract({ days: Number.parseInt(range) - 1 }).toString()
      );
    } catch {
      return false;
    }
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
      <header className="page-heading flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 tabIndex={-1}>Data</h1>
          <p className="text-sm text-muted-foreground">
            Deterministic health analytics and audited observations
          </p>
        </div>
        <div className="header-actions flex flex-wrap items-center gap-2">
          <Button
            ref={importTrigger}
            variant="outline"
            onClick={() => {
              importTrigger.current?.focus();
              setImportOpen(true);
              setManualOpen(false);
            }}
          >
            <Upload className="h-4 w-4 mr-1.5" />
            Import CSV
          </Button>
          <Button
            ref={manualTrigger}
            onClick={() => {
              manualTrigger.current?.focus();
              setManualOpen(true);
              setImportOpen(false);
            }}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Log Reading
          </Button>
        </div>
      </header>

      {/* Metric Selector Horizontal Pills */}
      <nav className="metric-pills-bar" aria-label="Select metric">
        {Object.entries(measurementRegistry).map(([key, item]) => (
          <button
            key={key}
            type="button"
            className={cn(
              'metric-pill',
              metric === key && 'metric-pill-active',
            )}
            onClick={() => {
              const next = key as MetricKey;
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
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      {/* Quick Time Ranges & Interval Bar */}
      <div className="time-range-bar">
        <div className="range-pills">
          {(['7D', '14D', '30D', '90D', '365D'] as const).map((r) => (
            <Button
              key={r}
              variant="ghost"
              size="sm"
              aria-pressed={isQuickRange(r)}
              onClick={() => applyQuickRange(r)}
            >
              {r}
            </Button>
          ))}
        </div>
      </div>

      {notice && <p role="status">{notice}</p>}

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
            {/* Deterministic Summary Grid */}
            {data && (
              <section
                aria-label="Deterministic summary"
                className="summary-grid"
              >
                <Card className="summary-card">
                  <span className="text-xs text-muted-foreground uppercase font-semibold">
                    {data.analysis.statistic === 'daily_median_mean_7d'
                      ? 'Seven-day Mean'
                      : data.analysis.statistic === 'observed_samples'
                        ? 'Observed Median'
                        : data.analysis.statistic === 'daily_totals'
                          ? 'Daily Totals'
                          : 'Session Observations'}
                  </span>
                  {data.analysis.coverageStatus === 'insufficient_data' ? (
                    <span className="text-sm font-medium">
                      {data.analysis.statistic === 'daily_median_mean_7d'
                        ? 'Insufficient data. A seven-day mean requires at least three valid days.'
                        : 'Insufficient data. No observations are available for this selection.'}
                    </span>
                  ) : data.analysis.value === null ? (
                    <span className="text-sm font-medium">
                      Totals and sessions are not combined into a headline mean.
                    </span>
                  ) : (
                    <strong
                      data-testid="headline-value"
                      className="text-2xl font-bold"
                    >
                      {number(data.analysis.value)} {data.analysis.unit}
                    </strong>
                  )}
                  {data.latest ? (
                    <span className="text-xs text-muted-foreground">
                      Latest in selection: {number(data.latest.value)}{' '}
                      {data.latest.unit} at {data.latest.observedAt}.
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      No readings in this selection.
                    </span>
                  )}
                </Card>

                <Card className="summary-card">
                  <span className="text-xs text-muted-foreground uppercase font-semibold">
                    Period Trend
                  </span>
                  <span className="text-lg font-semibold">
                    {data.analysis.absoluteChange !== null ? (
                      <>
                        {number(data.analysis.absoluteChange)}{' '}
                        {metric === 'body_fat_percent'
                          ? 'percentage points'
                          : data.analysis.unit}
                        {data.analysis.relativeChangePercent !== null && (
                          <> ({number(data.analysis.relativeChangePercent)}%)</>
                        )}
                      </>
                    ) : data.analysis.statistic !== 'daily_median_mean_7d' ? (
                      'Not calculated for this measurement type'
                    ) : data.analysis.previousWindow.validDays < 3 ? (
                      'Comparison unavailable: insufficient prior data'
                    ) : (
                      'Comparison unavailable'
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Across {data.analysis.validDays} valid days
                  </span>
                  {data.analysis.previousValue !== null && (
                    <span className="text-xs text-muted-foreground">
                      Previous seven days: {number(data.analysis.previousValue)}{' '}
                      {data.analysis.unit}.
                    </span>
                  )}
                </Card>

                <Card className="summary-card">
                  <span className="text-xs text-muted-foreground uppercase font-semibold">
                    Observations
                  </span>
                  <span className="text-lg font-semibold">
                    {data.analysis.observationCount} observations
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {data.analysis.validDays} valid days
                  </span>
                  {data.analysis.statistics && (
                    <span className="text-xs text-muted-foreground">
                      Observed median {number(data.analysis.statistics.median)}{' '}
                      bpm (range {number(data.analysis.statistics.min)}–
                      {number(data.analysis.statistics.max)} bpm).
                    </span>
                  )}
                </Card>

                <Card className="summary-card">
                  <span className="text-xs text-muted-foreground uppercase font-semibold">
                    Data Revision
                  </span>
                  <span className="text-lg font-semibold font-mono text-sm">
                    revision {data.dataRevision}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    Algorithm {data.analysis.algorithmVersion}
                  </span>
                </Card>

                <div className="col-span-full sm:col-span-2 md:col-span-4 text-xs text-muted-foreground space-y-1">
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
                    {allSources.find((item) => item.id === chosenSource)?.label}{' '}
                    · {method} · {granularity}
                  </p>
                  <p>
                    Analysis interval: {data.analysis.from} to{' '}
                    {data.analysis.to} (end excluded), {timezone}.
                  </p>
                  <p>
                    {data.analysis.observationCount} observations;{' '}
                    {data.analysis.validDays} valid days. Algorithm{' '}
                    {data.analysis.algorithmVersion}; data revision{' '}
                    {data.dataRevision}.
                  </p>
                  {data.analysis.exclusions.length > 0 && (
                    <p role="status">
                      {data.analysis.exclusions.length} conflicting daily
                      observations excluded from the chart. Review the table.
                    </p>
                  )}
                </div>
              </section>
            )}

            {/* Interactive Trend Chart */}
            {data && (
              <section className="chart-card-container">
                <DataChartView data={data} />
              </section>
            )}

            {/* Observation Ledger Table */}
            {chosenSource && selection && (
              <Card className="table-card-container">
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

            {/* Preserved Filter Controls */}
            <Card className="data-filter-card">
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
              ) : null}
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
          </>
        )}
        <p className="detail-note">
          Manual measurements, CSV import, correction, deletion and
          selected-data export are available. Android Health Connect is planned
          for a later release. Calculations are not medical diagnoses.
        </p>
      </div>

      {/* Modal Sheets for Manual Entry and CSV Import */}
      <Sheet open={manualOpen} onOpenChange={setManualOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-lg overflow-y-auto"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            manualTrigger.current?.focus();
          }}
        >
          <SheetHeader>
            <SheetTitle>Manual measurement</SheetTitle>
            <SheetDescription>
              Log a verified health reading into your account
            </SheetDescription>
          </SheetHeader>
          <ManualForm
            initialMetric={metric}
            initialSource={chosenSource || 'new'}
            sources={allSources}
            timezone={sources.data?.pages[0]?.timezone ?? 'UTC'}
            busy={mutation.isPending}
            save={async (request) => {
              await mutation.mutateAsync(request);
              setManualOpen(false);
            }}
          />
          {notice && <p role="status">{notice}</p>}
        </SheetContent>
      </Sheet>

      <Sheet open={importOpen} onOpenChange={setImportOpen}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-md md:max-w-2xl overflow-y-auto"
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            importTrigger.current?.focus();
          }}
        >
          <SheetHeader>
            <SheetTitle>Import CSV</SheetTitle>
            <SheetDescription>
              Preview, map columns, and confirm batch records
            </SheetDescription>
          </SheetHeader>
          <ImportForm
            sources={allSources}
            timezone={timezone}
            dataRevision={sources.data?.pages[0]?.dataRevision ?? 0}
            onView={(sourceId, selection) => {
              setSource(sourceId);
              setMetric(selection.metric);
              setMethod(selection.method);
              setGranularity(selection.granularity);
              setZone(selection.timezone);
              setFrom(selection.from);
              setTo(selection.to);
              setImportOpen(false);
              setNotice('Showing the selected imported series.');
            }}
            onSaved={(result) => {
              setSource(result.source_id);
              void client.invalidateQueries({ queryKey: root });
            }}
          />
        </SheetContent>
      </Sheet>
    </>
  );
}

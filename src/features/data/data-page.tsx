import { useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { z } from 'zod';
import { ImportSelectionSchema } from '../../../shared/imports';
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
import { EventEditor } from './event-editor';
import { MeasurementEditor } from './measurement-editor';
import { DataChartView } from './data-chart-view';
import { formatMeasurement as number } from './format';
import {
  AnalysisBatchSchema,
  ANALYSIS_VERSION,
  type AnalysisOperation,
} from '../../../shared/analysis';
import {
  metricContent,
  metricDisplayGroups,
  METRIC_CONTENT_VERSION,
} from '../../../shared/metrics';
import { AnalysisResultView } from './analysis-result-view';
import { AnalysisEvidence } from './analysis-evidence';
import { DataOverview } from './data-overview';
import { MetricGuidance } from './metric-guidance';

export function DataPage() {
  const { scope } = useAuth();
  const location = useLocation();
  return new URLSearchParams(location.search).has('evidence') ? (
    <AnalysisEvidence
      key={`evidence:${scope.userId}:${scope.epoch}:${location.key}`}
    />
  ) : (
    <OwnedDataPage key={`data:${scope.userId}:${scope.epoch}`} />
  );
}
function OwnedDataPage() {
  const { state, scope } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const imported = z
    .object({
      ownerId: z.uuid(),
      sourceId: z.uuid(),
      selection: ImportSelectionSchema,
    })
    .safeParse(location.state);
  const initial =
    imported.success && imported.data.ownerId === scope.userId
      ? imported.data
      : null;
  const session = state.kind === 'signed_in' ? state.session : null;
  const epoch = scope.epoch;
  const client = useQueryClient();
  const root = ['data', session?.user.id, epoch];
  const [source, setSource] = useState(initial?.sourceId ?? '');
  const [metric, setMetric] = useState<MetricKey>(
    initial?.selection.metric ?? 'weight',
  );
  const [method, setMethod] = useState<MeasurementMethod>(
    initial?.selection.method ?? 'user_reported',
  );
  const [granularity, setGranularity] = useState<Granularity>(
    initial?.selection.granularity ?? 'instant',
  );
  const [zone, setZone] = useState<string | null>(
    initial?.selection.timezone ?? null,
  );
  const [from, setFrom] = useState(initial?.selection.from ?? '');
  const [to, setTo] = useState(initial?.selection.to ?? '');
  const [notice, setNotice] = useState('');
  const [calculation, setCalculation] = useState<
    'observed_day_mean' | 'rolling_7d'
  >('observed_day_mean');
  const [comparison, setComparison] = useState<
    'none' | 'previous_period' | 'previous_month' | 'custom'
  >('none');
  const [previousFrom, setPreviousFrom] = useState('');
  const [previousThrough, setPreviousThrough] = useState('');
  const [editing, setEditing] = useState<{
    reading: MeasurementDTO;
    mode: 'correct' | 'delete';
  } | null>(null);
  const [eventId, setEventId] = useState<string | null>(null);
  const [download, setDownload] = useState<
    { kind: 'idle' | 'loading' | 'done' } | { kind: 'error'; message: string }
  >({ kind: 'idle' });
  const [manualOpen, setManualOpen] = useState(false);
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
    refetchOnWindowFocus: true,
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
  let operation: AnalysisOperation | null = null;
  let comparisonError = '';
  if (selection) {
    try {
      const series = {
        metric: selection.metric,
        source_id: selection.source_id,
        method: selection.method,
        granularity: selection.granularity,
      };
      const window = { from: selection.from, to: selection.to };
      if (comparison === 'none')
        operation =
          calculation === 'observed_day_mean'
            ? {
                operation: calculation,
                series,
                timezone,
                window,
                includeSampleMean: false,
              }
            : { operation: calculation, series, timezone, window };
      else {
        let comparisonWindow;
        if (comparison === 'previous_month') {
          const start = Temporal.PlainDate.from(displayFrom).with({ day: 1 });
          if (
            displayFrom !== start.toString() ||
            Temporal.PlainDate.from(displayTo).add({ days: 1 }).toString() !==
              start.add({ months: 1 }).toString()
          )
            throw new Error(
              'Select one complete calendar month to compare with its previous month.',
            );
          comparisonWindow = {
            from: start
              .subtract({ months: 1 })
              .toZonedDateTime(timezone)
              .toInstant()
              .toString(),
            to: start.toZonedDateTime(timezone).toInstant().toString(),
          };
        } else if (comparison === 'custom') {
          const a = Temporal.PlainDate.from(previousFrom),
            b = Temporal.PlainDate.from(previousThrough).add({ days: 1 });
          const days = a.until(b).days;
          if (days < 1 || days > 366)
            throw new Error('Choose 1–366 local days for the comparison.');
          comparisonWindow = {
            from: a.toZonedDateTime(timezone).toInstant().toString(),
            to: b.toZonedDateTime(timezone).toInstant().toString(),
          };
        }
        operation = {
          operation: 'period_comparison',
          series,
          timezone,
          window,
          comparisonMethod: calculation,
          ...(comparisonWindow ? { comparisonWindow } : {}),
        };
      }
    } catch (error) {
      comparisonError =
        error instanceof Error
          ? error.message
          : 'Choose valid comparison dates.';
    }
  }
  const summary = useQuery({
    queryKey: [
      ...root,
      'explicit-analysis',
      sources.data?.pages[0]?.dataRevision,
      operation,
      ANALYSIS_VERSION,
      METRIC_CONTENT_VERSION,
    ],
    enabled:
      !!session &&
      !!chosenSource &&
      !!operation &&
      measurementRegistry[metric].analyticsOperand,
    retry: false,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) => {
      const result = successEnvelopeSchema(AnalysisBatchSchema).parse(
        await ownedJson('/api/data', session!.access_token, scope, epoch, {
          method: 'POST',
          signal,
          body: JSON.stringify({ action: 'analyze', operations: [operation!] }),
        }),
      ).data.results[0]!;
      if (result.kind !== 'series_analysis')
        throw new Error('Expected a metric result.');
      return result;
    },
  });
  const readRevision =
    summary.data?.dataRevision ?? sources.data?.pages[0]?.dataRevision;
  const readings = useInfiniteQuery({
    queryKey: [...root, 'measurements', selectionKey, readRevision],
    enabled:
      !!session && !!chosenSource && !!selection && readRevision !== undefined,
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
              data_revision: String(readRevision),
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
        void client.invalidateQueries({
          queryKey: ['goals', session?.user.id, epoch],
        });
        void client.invalidateQueries({
          queryKey: ['conversations', session?.user.id, epoch],
        });
        void client.invalidateQueries({
          queryKey: ['inspection', session?.user.id, epoch],
        });
      });
    },
  });
  const data = summary.isError || comparisonError ? undefined : summary.data;
  const items = readings.data?.pages.flatMap((page) => page.items) ?? [];
  const needsSelectedPlot =
    !!data &&
    !!selection &&
    !!data.effectiveWindow &&
    (data.effectiveWindow.from !== selection.from ||
      data.effectiveWindow.to !== selection.to);
  const plotOperation: AnalysisOperation | null =
    needsSelectedPlot && selection
      ? {
          operation: 'observed_day_mean',
          series: {
            metric: selection.metric,
            source_id: selection.source_id,
            method: selection.method,
            granularity: selection.granularity,
          },
          timezone: selection.timezone,
          window: { from: selection.from, to: selection.to },
          includeSampleMean: false,
        }
      : null;
  const selectedPlot = useQuery({
    queryKey: [
      ...root,
      'selected-plot',
      plotOperation,
      data?.dataRevision,
      ANALYSIS_VERSION,
    ],
    enabled: !!session && !!plotOperation,
    retry: false,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) => {
      const result = successEnvelopeSchema(AnalysisBatchSchema).parse(
        await ownedJson('/api/data', session!.access_token, scope, epoch, {
          method: 'POST',
          signal,
          body: JSON.stringify({
            action: 'analyze',
            operations: [plotOperation!],
          }),
        }),
      ).data.results[0]!;
      if (
        result.kind !== 'series_analysis' ||
        result.dataRevision !== data?.dataRevision
      )
        throw new Error(
          'The chart and summary data revisions differ. Refresh data to retry.',
        );
      return result;
    },
  });
  const plot = needsSelectedPlot
    ? !selectedPlot.isError &&
      !selectedPlot.isFetching &&
      selectedPlot.data?.dataRevision === data?.dataRevision
      ? selectedPlot.data
      : undefined
    : data;
  function refresh() {
    void client.invalidateQueries({ queryKey: root });
    void client.invalidateQueries({
      queryKey: ['goals', session?.user.id, epoch],
    });
    void client.invalidateQueries({
      queryKey: ['conversations', session?.user.id, epoch],
    });
    void client.invalidateQueries({
      queryKey: ['inspection', session?.user.id, epoch],
    });
  }
  function closeEditor() {
    setEditing(null);
    tableHeading.current?.focus();
  }
  async function exportSelection() {
    if (!session || !selection || readRevision === undefined) return;
    setDownload({ kind: 'loading' });
    try {
      await ownedDownload(
        '/api/data?' +
          new URLSearchParams({
            view: 'export',
            ...selection,
            data_revision: String(readRevision),
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
              navigate('/data/import');
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
            }}
          >
            <Plus className="h-4 w-4 mr-1.5" />
            Log Reading
          </Button>
        </div>
      </header>

      <nav aria-label="Select metric" className="space-y-2">
        <p className="text-sm">
          Choose a category and metric to explore. Every supported series
          remains available.
        </p>
        <div className="flex flex-wrap gap-3">
          {Object.entries(metricDisplayGroups).map(([group, label]) => (
            <details key={group} className="min-w-0">
              <summary className="cursor-pointer rounded-md border px-3 py-2 text-sm">
                {label}
              </summary>
              <div className="flex flex-wrap gap-2 py-2">
                {Object.entries(measurementRegistry)
                  .filter(
                    ([key]) =>
                      metricContent[key as MetricKey].displayGroup === group,
                  )
                  .map(([key, item]) => (
                    <button
                      key={key}
                      type="button"
                      className={cn(
                        'metric-pill',
                        metric === key && 'metric-pill-active',
                      )}
                      aria-pressed={metric === key}
                      onClick={() => {
                        const next = key as MetricKey;
                        setMetric(next);
                        setMethod(measurementRegistry[next].method);
                        setGranularity(
                          next === 'steps_daily'
                            ? 'daily_total'
                            : next === 'sleep_duration'
                              ? 'session_total'
                              : 'instant',
                        );
                      }}
                    >
                      {item.label}
                    </button>
                  ))}
              </div>
            </details>
          ))}
        </div>
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
              disabled={sources.isPending || sources.isError}
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
            {chosenSource && (
              <DataOverview
                sourceId={chosenSource}
                timezone={timezone}
                revision={readRevision}
                inspectEvent={setEventId}
                exploreSeries={(series) => {
                  setMetric(series.metric);
                  setMethod(series.method);
                  setGranularity(series.granularity);
                }}
              />
            )}
            <Card className="p-4 space-y-3 min-w-0">
              <h2>Selected-period analysis</h2>
              <div className="settings-form data-filters">
                <label htmlFor="analysis-calculation">Calculation</label>
                <select
                  id="analysis-calculation"
                  value={calculation}
                  onChange={(event) =>
                    setCalculation(event.target.value as typeof calculation)
                  }
                >
                  <option value="observed_day_mean">
                    Selected-period mean
                  </option>
                  <option value="rolling_7d">Seven-day rolling mean</option>
                </select>
                <label htmlFor="analysis-comparison">Compare with</label>
                <select
                  id="analysis-comparison"
                  value={comparison}
                  onChange={(event) =>
                    setComparison(event.target.value as typeof comparison)
                  }
                >
                  <option value="none">No comparison</option>
                  <option value="previous_period">
                    Previous equal-length period
                  </option>
                  <option value="previous_month">
                    Previous calendar month
                  </option>
                  <option value="custom">Custom period</option>
                </select>
                {comparison === 'custom' && (
                  <>
                    <label>
                      Comparison from date
                      <input
                        type="date"
                        value={previousFrom}
                        onChange={(event) =>
                          setPreviousFrom(event.target.value)
                        }
                      />
                    </label>
                    <label>
                      Comparison through date
                      <input
                        type="date"
                        value={previousThrough}
                        onChange={(event) =>
                          setPreviousThrough(event.target.value)
                        }
                      />
                    </label>
                  </>
                )}
              </div>
              {comparisonError && <p role="alert">{comparisonError}</p>}
              {summary.isFetching && (
                <p role="status">
                  Refreshing data. The displayed result is being checked.
                </p>
              )}
              {data && (
                <AnalysisResultView
                  result={data}
                  sourceLabel={
                    allSources.find((item) => item.id === chosenSource)?.label
                  }
                />
              )}
              {needsSelectedPlot && selectedPlot.isFetching && (
                <p role="status">Checking the full selected-period chart…</p>
              )}
              {needsSelectedPlot && selectedPlot.isError && (
                <p role="alert">
                  The selected-period chart could not be verified at the summary
                  revision. Refresh data to retry; the seven-day points have not
                  been substituted.
                </p>
              )}
              {plot && <DataChartView analysis={plot} readings={items} />}
              {selection && chosenSource && (
                <MetricGuidance selection={selection} revision={readRevision} />
              )}
            </Card>

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
                                {item.canonicalValue ?? number(item.value)}{' '}
                                {item.unit}
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
                                  {item.eventId && (
                                    <Button
                                      variant="outline"
                                      onClick={() => setEventId(item.eventId!)}
                                    >
                                      Inspect weigh-in
                                    </Button>
                                  )}
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
                {!measurementRegistry[metric].analyticsOperand && (
                  <p role="status">
                    {measurementRegistry[metric].limitation} Raw values remain
                    available; summaries and goal operands are unavailable.
                  </p>
                )}
                {eventId && (
                  <EventEditor
                    key={eventId}
                    eventId={eventId}
                    onClose={() => {
                      setEventId(null);
                      tableHeading.current?.focus();
                    }}
                    onSaved={(message) => {
                      setNotice(message);
                      refresh();
                    }}
                  />
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
                  readRevision === undefined ||
                  !selection ||
                  (measurementRegistry[metric].analyticsOperand &&
                    summary.isError) ||
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
              ) : !selection ? null : measurementRegistry[metric]
                  .analyticsOperand && summary.isPending ? (
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
          selected-data export are available. Native health-platform
          integrations are deferred. Calculations are not medical diagnoses.
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
    </>
  );
}

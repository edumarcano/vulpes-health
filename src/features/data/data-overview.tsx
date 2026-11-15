import { useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import {
  AnalysisBatchSchema,
  MetricInventorySchema,
  type AnalysisOperation,
  type AnalysisSeries,
} from '../../../shared/analysis';
import { successEnvelopeSchema } from '../../../shared/api';
import {
  metricContent,
  metricDisplayGroups,
  metricRegistry,
} from '../../../shared/metrics';
import { useAuth } from '@/lib/auth/auth-context';
import { ownedJson } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { displayExact } from './format';

export function DataOverview({
  sourceId,
  timezone,
  revision,
  inspectEvent,
  exploreSeries,
}: {
  sourceId: string;
  timezone: string;
  revision: number | undefined;
  inspectEvent: (id: string) => void;
  exploreSeries: (series: AnalysisSeries) => void;
}) {
  const { state, scope } = useAuth();
  const session = state.kind === 'signed_in' ? state.session : null;
  const epoch = scope.epoch;
  const root = ['data', session?.user.id, epoch];
  const [expanded, setExpanded] = useState(false);
  const inventory = useInfiniteQuery({
    queryKey: [...root, 'inventory', revision],
    enabled: !!session && !!sourceId,
    initialPageParam: null as string | null,
    retry: false,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal, pageParam }) =>
      successEnvelopeSchema(MetricInventorySchema).parse(
        await ownedJson(
          '/api/data?' +
            new URLSearchParams({
              view: 'inventory',
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
  const available =
    inventory.data?.pages
      .flatMap((page) => page.items)
      .filter(
        (item) =>
          item.source_id === sourceId &&
          metricRegistry[item.metric].analyticsOperand,
      ) ?? [];
  const choices = expanded ? available : available.slice(0, 6);
  const operations: AnalysisOperation[] = choices.map((item) => ({
    operation: 'latest_per_metric',
    series: {
      metric: item.metric,
      source_id: sourceId,
      method: item.method,
      granularity: item.granularity,
    },
    timezone,
  }));
  const latest = useQuery({
    queryKey: [...root, 'latest-event', sourceId, timezone, revision],
    enabled: !!session && !!sourceId,
    retry: false,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) =>
      successEnvelopeSchema(AnalysisBatchSchema).parse(
        await ownedJson('/api/data', session!.access_token, scope, epoch, {
          method: 'POST',
          signal,
          body: JSON.stringify({
            action: 'analyze',
            operations: [
              { operation: 'latest_event', source_id: sourceId, timezone },
            ],
          }),
        }),
      ).data.results[0]!,
  });
  const metrics = useQuery({
    queryKey: [
      ...root,
      'latest-per-metric',
      sourceId,
      timezone,
      revision,
      inventory.data?.pages[0]?.dataRevision,
      expanded,
      operations,
    ],
    enabled: !!session && operations.length > 0,
    retry: false,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) => {
      const results = [];
      let currentRevision: number | undefined;
      for (let index = 0; index < operations.length; index += 24) {
        const batch = successEnvelopeSchema(AnalysisBatchSchema).parse(
          await ownedJson('/api/data', session!.access_token, scope, epoch, {
            method: 'POST',
            signal,
            body: JSON.stringify({
              action: 'analyze',
              operations: operations.slice(index, index + 24),
            }),
          }),
        ).data;
        if (
          currentRevision !== undefined &&
          currentRevision !== batch.dataRevision
        )
          throw new Error('Data changed. Refresh the overview.');
        currentRevision = batch.dataRevision;
        results.push(...batch.results);
      }
      return results;
    },
  });
  const event = latest.data?.kind === 'event_analysis' ? latest.data : null;
  return (
    <section aria-label="Measurement overview" className="space-y-4 min-w-0">
      <h2>Measurement overview</h2>
      <Card className="p-4 space-y-2 break-words" aria-label="Latest weigh-in">
        <h3 className="font-semibold">Latest weigh-in</h3>
        {latest.isFetching ? (
          <p role="status">Checking the latest imported event…</p>
        ) : latest.isError ? (
          <p role="alert">
            Latest weigh-in unavailable. Refresh data to retry.
          </p>
        ) : event?.event ? (
          <>
            <p>
              {event.event.event.observed_at}; {event.event.observations.length}{' '}
              observations from this event only.
            </p>
            <p className="text-xs">
              Measured{' '}
              {Math.max(
                0,
                Math.floor(
                  (Date.parse(event.evaluatedAt) -
                    Date.parse(event.event.event.observed_at)) /
                    86400000,
                ),
              )}{' '}
              days before the evaluation at {event.evaluatedAt}. Last successful
              import: {event.lastSuccessfulImportAt ?? 'Unavailable'}.
            </p>
            <p>Absent fields are not filled from older weigh-ins.</p>
            <p className="text-sm">
              {event.event.observations
                .slice(0, 4)
                .map(
                  (reading) =>
                    `${metricRegistry[reading.metric].label}: ${displayExact(reading.canonicalValue ?? String(reading.value))} ${reading.unit}`,
                )
                .join(' · ')}
            </p>
            <Button
              variant="outline"
              onClick={() => inspectEvent(event.event!.event.id)}
            >
              Inspect latest weigh-in
            </Button>
          </>
        ) : (
          <p>
            {event?.status === 'ambiguous'
              ? 'Several events share the latest timestamp. Inspect the individual readings to choose an event.'
              : 'No imported weigh-in exists for this source. Individual measurements remain available below.'}
          </p>
        )}
      </Card>
      <Card
        className="p-4 space-y-3 break-words"
        aria-label="Latest per metric"
      >
        <h3 className="font-semibold">Latest per metric</h3>
        <p className="text-sm">
          These readings may have different dates and do not form one weigh-in.
        </p>
        {inventory.isError || metrics.isError ? (
          <p role="alert">
            Overview changed or could not be loaded. Refresh data to retry.
          </p>
        ) : inventory.isFetching || metrics.isFetching ? (
          <p role="status">Checking dated metric readings…</p>
        ) : metrics.data?.length ? (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {metrics.data.map(
              (result) =>
                result.kind === 'series_analysis' && (
                  <li className="rounded-md border p-3 min-w-0" key={result.id}>
                    <p className="text-xs text-muted-foreground">
                      {
                        metricDisplayGroups[
                          metricContent[result.series.metric].displayGroup
                        ]
                      }
                    </p>
                    <p className="font-medium">
                      {metricRegistry[result.series.metric].label}
                    </p>
                    <p>
                      {result.current.value === null
                        ? 'Unavailable'
                        : `${displayExact(result.current.value)} ${result.unit}`}
                    </p>
                    <p className="text-xs">
                      Measured{' '}
                      {result.current.lastMeasuredAt ?? 'date unavailable'}
                    </p>
                    {result.current.ageSeconds !== null && (
                      <p className="text-xs">
                        Evidence age:{' '}
                        {Math.floor(result.current.ageSeconds / 86400)} days as
                        of {result.evaluatedAt}.
                      </p>
                    )}
                    <p className="text-xs">
                      {result.series.method} · {result.series.granularity}
                    </p>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => exploreSeries(result.series)}
                    >
                      Explore {metricRegistry[result.series.metric].label}
                    </Button>
                  </li>
                ),
            )}
          </ul>
        ) : (
          <p>
            No resolved metric readings found on the loaded inventory pages.
          </p>
        )}
        {available.length > 6 && (
          <Button variant="outline" onClick={() => setExpanded(!expanded)}>
            {expanded ? 'Show compact overview' : 'Show all available series'}
          </Button>
        )}
        {inventory.hasNextPage && (
          <Button
            variant="outline"
            disabled={inventory.isFetchingNextPage}
            onClick={() => void inventory.fetchNextPage()}
          >
            Load more inventory
          </Button>
        )}
        <p className="text-xs">
          Unresolved vendor values remain available in weigh-in detail and the
          raw measurement table. Manufacturer estimates are not independent
          corroborating measurements.
        </p>
      </Card>
    </section>
  );
}

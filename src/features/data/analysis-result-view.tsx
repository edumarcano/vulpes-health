import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { SeriesAnalysisResult } from '../../../shared/analysis';
import { metricRegistry } from '../../../shared/metrics';
import { displayExact } from './format';

export function AnalysisResultView({
  result,
  sourceLabel,
  evidenceLink = true,
}: {
  result: SeriesAnalysisResult;
  sourceLabel?: string | undefined;
  evidenceLink?: boolean;
}) {
  const navigate = useNavigate();
  const current = result.current;
  const label =
    current.statistic === 'rolling_7d'
      ? 'Seven-day mean'
      : current.statistic === 'observed_day_mean'
        ? 'Selected-period mean'
        : current.statistic === 'observed_samples'
          ? 'Observed median'
          : current.statistic === 'latest_value'
            ? 'Latest reading'
            : current.statistic === 'endpoint'
              ? 'Observed endpoint'
              : 'Uncombined observations';
  return (
    <section
      aria-label="Deterministic summary"
      className="space-y-3 min-w-0 break-words"
    >
      <div className="summary-grid">
        <Card className="summary-card">
          <h2 className="text-sm font-semibold">{label}</h2>
          <p>{metricRegistry[result.series.metric].label}</p>
          {current.value !== null ? (
            <strong data-testid="headline-value" className="text-2xl font-bold">
              {displayExact(current.value)} {result.unit}
            </strong>
          ) : (
            <p>
              {current.coverageStatus === 'unsupported'
                ? 'Totals and sessions are not combined into a headline mean.'
                : current.statistic === 'rolling_7d'
                  ? 'Insufficient data. A seven-day mean requires at least three observed days.'
                  : 'Insufficient data. No observations are available for this selection.'}
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            {current.observedDays}/{current.calendarDays ?? 'unbounded'}{' '}
            observed/calendar days; {current.observationCount} observations.
          </p>
          {current.partialCurrentDay && (
            <p className="text-xs">The current local day is partial.</p>
          )}
          {current.observedDays === 1 && (
            <p className="text-xs">
              One observed day is descriptive, not evidence of a sustained
              trend.
            </p>
          )}
        </Card>
        <Card className="summary-card">
          <h3 className="text-sm font-semibold">Period comparison</h3>
          {result.absoluteChange === null ? (
            <p>
              Comparison unavailable
              {result.previous
                ? ': both windows need sufficient evidence.'
                : '. Select a comparison to calculate change.'}
            </p>
          ) : (
            <p className="text-lg font-semibold">
              {displayExact(result.absoluteChange)}{' '}
              {result.absoluteChangeUnit === 'percentage_points'
                ? 'percentage points'
                : result.absoluteChangeUnit}
              {result.relativeChangePercent !== null && (
                <>
                  {' '}
                  ({displayExact(result.relativeChangePercent)}% relative
                  change)
                </>
              )}
            </p>
          )}
          {result.previous && (
            <>
              <p>
                Previous:{' '}
                {result.previous.value === null
                  ? 'Unavailable'
                  : `${displayExact(result.previous.value)} ${result.unit}`}
              </p>
              <p className="text-xs">
                {result.previous.observedDays}/
                {result.previous.calendarDays ?? 'unbounded'} observed/calendar
                days; {result.previous.observationCount} observations.
              </p>
              <p className="text-xs">
                {result.previous.window?.from} to {result.previous.window?.to}{' '}
                (end excluded).
              </p>
            </>
          )}
          {result.previous?.value === '0' && (
            <p className="text-xs">
              Relative change is unavailable with a zero previous value.
            </p>
          )}
        </Card>
        <Card className="summary-card">
          <h3 className="text-sm font-semibold">Evidence dates</h3>
          <p className="text-xs">
            Last measurement: {current.lastMeasuredAt ?? 'Unavailable'}.
          </p>
          <p className="text-xs">
            Oldest contributing measurement:{' '}
            {current.oldestContributingAt ?? 'Unavailable'}.
          </p>
          {current.ageSeconds !== null && (
            <p className="text-xs">
              Oldest contributing evidence age:{' '}
              {Math.floor(current.ageSeconds / 86400)} days, evaluated{' '}
              {result.evaluatedAt}.
            </p>
          )}
          <p className="text-xs">
            Last successful import:{' '}
            {result.lastSuccessfulImportAt ?? 'No committed import'}.
          </p>
        </Card>
      </div>
      <p className="text-xs">
        Source: {sourceLabel ?? result.series.source_id} ·{' '}
        {result.series.method} · {result.series.granularity}.
      </p>
      {result.requestedWindow && (
        <p className="text-xs">
          Requested interval: {result.requestedWindow.from} to{' '}
          {result.requestedWindow.to} (end excluded), {result.timezone}.
        </p>
      )}
      {result.effectiveWindow && (
        <p className="text-xs">
          Analysis interval: {result.effectiveWindow.from} to{' '}
          {result.effectiveWindow.to} (end excluded). Method:{' '}
          {current.statistic}.
        </p>
      )}
      {current.sampleStatistics && (
        <p>
          Observed median {displayExact(current.sampleStatistics.median)} bpm
          (range {displayExact(current.sampleStatistics.min)}–
          {displayExact(current.sampleStatistics.max)} bpm).
        </p>
      )}
      {result.exclusions.length > 0 && (
        <p role="status">
          {result.exclusions.length} conflicting daily observations excluded.
          Review the measurement table.
        </p>
      )}
      <details>
        <summary>Calculation and provenance</summary>
        <p>
          Algorithm {result.algorithmVersion}; registry {result.registryVersion}
          ; data revision {result.dataRevision}.
        </p>
        <p className="break-all">Result {result.id}</p>
        <p>
          Exact value: {current.value ?? 'Unavailable'} {result.unit}.
        </p>
        {result.limitations.map((limitation) => (
          <p key={limitation}>{limitation}</p>
        ))}
        <p>
          Missing days remain missing. Independently summarized metrics do not
          form a single weigh-in.
        </p>
      </details>
      {evidenceLink && (
        <Button
          variant="outline"
          onClick={() =>
            navigate(`/data?evidence=${encodeURIComponent(result.id)}`, {
              state: { analysisEvidence: result.evidence },
            })
          }
        >
          Open result evidence
        </Button>
      )}
    </section>
  );
}

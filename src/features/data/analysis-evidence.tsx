import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import {
  AnalysisBatchSchema,
  AnalysisOperationSchema,
} from '../../../shared/analysis';
import { successEnvelopeSchema } from '../../../shared/api';
import { CountSchema } from '../../../shared/primitives';
import { useAuth } from '@/lib/auth/auth-context';
import { ownedJson } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { AnalysisResultView } from './analysis-result-view';
import { DataChartView } from './data-chart-view';

const descriptor = z.object({
  analysisEvidence: z.strictObject({
    operation: AnalysisOperationSchema,
    resultId: z.string().regex(/^analysis:[a-f0-9]{64}$/),
    dataRevision: CountSchema,
  }),
});
export function AnalysisEvidence() {
  const { state, scope } = useAuth();
  const session = state.kind === 'signed_in' ? state.session : null;
  const location = useLocation();
  const navigate = useNavigate();
  const parsed = descriptor.safeParse(location.state);
  const expected = new URLSearchParams(location.search).get('evidence');
  const selection =
    parsed.success && parsed.data.analysisEvidence.resultId === expected
      ? parsed.data.analysisEvidence
      : null;
  const epoch = scope.epoch;
  const result = useQuery({
    queryKey: ['data', session?.user.id, epoch, 'resolved-evidence', selection],
    enabled: !!session && !!selection,
    retry: false,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) =>
      successEnvelopeSchema(AnalysisBatchSchema).parse(
        await ownedJson('/api/data', session!.access_token, scope, epoch, {
          method: 'POST',
          signal,
          body: JSON.stringify({
            action: 'resolve_analysis',
            operation: selection!.operation,
            expectedResultId: selection!.resultId,
            dataRevision: selection!.dataRevision,
          }),
        }),
      ).data.results[0]!,
  });
  return (
    <div className="data-stack min-w-0 break-words">
      <h1 tabIndex={-1}>Result evidence</h1>
      {!selection || result.isError ? (
        <p role="alert">
          Original result unavailable. The selection, data revision or
          calculation version is no longer available. Current data has not been
          substituted.
        </p>
      ) : result.isFetching ? (
        <p role="status">Verifying the owned result and revision…</p>
      ) : result.data?.kind === 'series_analysis' ? (
        <>
          <AnalysisResultView result={result.data} evidenceLink={false} />
          <DataChartView analysis={result.data} />
        </>
      ) : result.data?.kind === 'event_analysis' ? (
        <section aria-label="Weigh-in evidence">
          <p>
            {result.data.status === 'available'
              ? `${result.data.event?.observations.length} observations from ${result.data.event?.event.observed_at}.`
              : 'The original event is unavailable or ambiguous.'}
          </p>
          <p className="break-all">{result.data.id}</p>
        </section>
      ) : (
        <p role="status">Loading result…</p>
      )}
      <Button
        variant="outline"
        onClick={() => navigate('/data', { replace: true, state: null })}
      >
        Request current data
      </Button>
    </div>
  );
}

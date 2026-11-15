import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth/auth-context';
import { ownedJson } from '@/lib/api';
import { successEnvelopeSchema } from '../../../shared/api';
import type { DataSelection } from '../../../shared/data';
import {
  metricContent,
  metricRegistry,
  METRIC_CONTENT_VERSION,
} from '../../../shared/metrics';
import { MetricReferenceResultSchema } from '../../../shared/references';

export function MetricGuidance({
  selection,
  revision,
}: {
  selection: DataSelection;
  revision: number | undefined;
}) {
  const { state, scope } = useAuth();
  const session = state.kind === 'signed_in' ? state.session : null;
  const epoch = scope.epoch;
  const reference = useQuery({
    queryKey: [
      'data',
      session?.user.id,
      epoch,
      'reference',
      selection,
      revision,
      METRIC_CONTENT_VERSION,
    ],
    enabled: !!session && !!selection.source_id,
    retry: false,
    refetchOnWindowFocus: true,
    queryFn: async ({ signal }) =>
      successEnvelopeSchema(MetricReferenceResultSchema).parse(
        await ownedJson(
          '/api/data?' +
            new URLSearchParams({ view: 'reference', ...selection }),
          session!.access_token,
          scope,
          epoch,
          { signal },
        ),
      ).data,
  });
  const classification = reference.data?.classification;
  return (
    <section
      aria-label="Metric guidance"
      className="space-y-2 text-sm break-words"
    >
      <h2 className="font-semibold">
        About {metricRegistry[selection.metric].label}
      </h2>
      <p>{metricContent[selection.metric].definition}</p>
      <p>{metricRegistry[selection.metric].limitation}</p>
      {reference.isFetching ? (
        <p role="status">Checking manufacturer reference…</p>
      ) : reference.isError ? (
        <p role="alert">
          Reference information could not be verified. No classification is
          shown.
        </p>
      ) : classification?.state === 'applicable' ? (
        <>
          <p>
            Manufacturer guidance: {classification.band.label}.{' '}
            {classification.label}.{' '}
            {classification.basis.kind === 'current_guidance'
              ? 'Compared with current guidance, not the manufacturer’s original historical classification.'
              : 'Historical reference and profile basis retained.'}
          </p>
          <p>
            Source:{' '}
            <a
              href={classification.rule.source.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {classification.rule.source.title}
            </a>
            , verified {classification.rule.source.verifiedOn}. Reference{' '}
            {classification.rule.version}.
          </p>
          <p>{classification.rule.limitation}</p>
        </>
      ) : (
        <p>{classification?.message ?? 'Manufacturer reference unavailable'}</p>
      )}
      <p className="text-xs">
        Guidance is separate from recorded values and user-approved goals. No
        medical diagnosis or recommended target is implied.
      </p>
      <details>
        <summary>Definition version and reference evidence</summary>
        <p>
          {METRIC_CONTENT_VERSION};{' '}
          {reference.data?.referenceRegistryVersion ?? 'reference not loaded'}.
        </p>
        {reference.data && <p className="break-all">{reference.data.id}</p>}
      </details>
    </section>
  );
}

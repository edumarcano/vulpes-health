import { Link } from 'react-router-dom';
import { Card } from '@/components/ui/card';
import { ChatPartSchema } from '../../../shared/chat';
import { metricRegistry } from '../../../shared/metrics';
import { AnalysisResultView } from '../data/analysis-result-view';
import { displayExact } from '../data/format';
import { GroupProgress } from '../goals/group-progress';
import { OwnedGroupProposal } from '../goals/group-review';

export function GroupProposalPart({ data }: { data: unknown }) {
  const parsed = ChatPartSchema.safeParse(data);
  if (!parsed.success || parsed.data.type !== 'goal_group_proposal')
    return <p>Group proposal unavailable.</p>;
  return (
    <OwnedGroupProposal
      key={parsed.data.reference.proposalId}
      reference={parsed.data.reference}
    />
  );
}

export function GroupProgressPart({ data }: { data: unknown }) {
  const parsed = ChatPartSchema.safeParse(data);
  if (!parsed.success || parsed.data.type !== 'goal_group_progress')
    return <p>Group progress unavailable.</p>;
  return (
    <Card className="chat-evidence min-w-0 break-words space-y-3">
      <GroupProgress value={parsed.data.result} />
      <Link to={'/goals?group=' + parsed.data.result.groupId}>
        Open Goals for current group progress
      </Link>
    </Card>
  );
}

export function AnalysisPart({ data }: { data: unknown }) {
  const parsed = ChatPartSchema.safeParse(data);
  if (!parsed.success || parsed.data.type !== 'analysis_result')
    return <p>Evidence is unavailable.</p>;
  const { result } = parsed.data;
  if (result.kind === 'series_analysis')
    return (
      <div className="chat-evidence min-w-0">
        <AnalysisResultView result={result} />
      </div>
    );
  const detail = result.event;
  return (
    <Card
      className="chat-evidence min-w-0 break-words space-y-3"
      aria-label="Latest weigh-in result"
    >
      <h3>Latest weigh-in</h3>
      <p>
        Source: {result.sourceId} · Evaluated {result.evaluatedAt}
      </p>
      {detail ? (
        <>
          <p>
            Measured {detail.event.observed_at} ({detail.event.timezone});{' '}
            {detail.observations.length} observations from this event only.
          </p>
          <p>Absent fields are not filled from older weigh-ins.</p>
          <dl className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {detail.observations.map((reading) => (
              <div key={reading.id}>
                <dt>{metricRegistry[reading.metric].label}</dt>
                <dd>
                  {displayExact(
                    reading.canonicalValue ?? String(reading.value),
                  )}{' '}
                  {reading.unit}
                </dd>
              </div>
            ))}
          </dl>
        </>
      ) : (
        <p>
          {result.status === 'ambiguous'
            ? 'Several events share the latest timestamp. Choose an event in Data.'
            : 'No imported weigh-in is available for this source.'}
        </p>
      )}
      <p>
        Last successful import: {result.lastSuccessfulImportAt ?? 'Unavailable'}
        .
      </p>
      <details>
        <summary>Calculation and provenance</summary>
        <p>
          Algorithm {result.algorithmVersion}; registry {result.registryVersion}
          ; data revision {result.dataRevision}.
        </p>
        <p className="break-all">Result {result.id}</p>
      </details>
      <Link
        to={`/data?evidence=${encodeURIComponent(result.id)}`}
        state={{ analysisEvidence: result.evidence }}
      >
        Open result evidence in Data
      </Link>
    </Card>
  );
}

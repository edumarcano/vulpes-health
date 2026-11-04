import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { useAuth } from '@/lib/auth/auth-context';
import { ownedJson } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { GoalRevisionPayloadSchema } from '../../../shared/goals';
import { SourcesPageSchema } from '../../../shared/data';
import { successEnvelopeSchema } from '../../../shared/api';
import {
  GoalDetailSchema,
  type GoalProposalRow,
} from '../../../shared/goal-views';
export function GoalDefinitionView({
  value,
}: {
  value: z.infer<typeof GoalRevisionPayloadSchema>;
}) {
  const d = value.definition;
  const { state, scope } = useAuth();
  const epoch = scope.epoch;
  const sources = useQuery({
    queryKey: ['goals', scope.userId, epoch, 'sources'],
    enabled: state.kind === 'signed_in',
    queryFn: async () =>
      z
        .object({ data: SourcesPageSchema })
        .parse(
          await ownedJson(
            '/api/data?view=sources&page_size=200',
            state.kind === 'signed_in' ? state.session.access_token : '',
            scope,
            epoch,
          ),
        ).data,
  });
  const source = sources.data?.items.find((x) => x.id === d.sourceId);
  return (
    <dl style={{ overflowWrap: 'anywhere' }}>
      <dt>Target</dt>
      <dd>
        {d.target.direction === 'maintain_range'
          ? `${d.target.lower}–${d.target.upper}`
          : `${d.target.direction === 'increase_to' ? 'Increase to' : 'Decrease to'} ${d.target.value}`}{' '}
        {d.unit}
      </dd>
      <dt>Source and calculation</dt>
      <dd>
        {source
          ? `${source.label}${source.deviceLabel ? ' · ' + source.deviceLabel : ''}`
          : 'Selected source'}{' '}
        · {d.method.replaceAll('_', ' ')} · {d.granularity.replaceAll('_', ' ')}{' '}
        · {d.timezone} · Source ID: {d.sourceId}
      </dd>
      <dt>Baseline</dt>
      <dd>
        {value.baseline.value ?? 'Insufficient data'} · {d.baselineMethod} ·{' '}
        {d.baselineFrom} to {d.baselineTo} · {value.baseline.provenance}
      </dd>
      <dt>Current method</dt>
      <dd>{d.currentMethod.replaceAll('_', ' ')}</dd>
      <dt>Target date</dt>
      <dd>{d.targetDate ?? 'None'}</dd>
      <dt>Constraints and strategy</dt>
      <dd>
        {d.constraints.join('; ')} · {d.proposedStrategy ?? 'None'}
      </dd>
      <dt>Resulting state</dt>
      <dd>
        {value.state} · Baseline: {value.baselineResolution}
      </dd>
    </dl>
  );
}
export function GoalProposalReview({
  proposal,
  busy,
  decide,
}: {
  proposal: GoalProposalRow;
  busy: boolean;
  decide: (action: 'approve' | 'reject') => Promise<void>;
}) {
  const { state, scope } = useAuth();
  const epoch = scope.epoch;
  const before = useQuery({
    queryKey: ['goals', scope.userId, epoch, 'before', proposal.target_id],
    enabled:
      !!proposal.target_id &&
      state.kind === 'signed_in' &&
      proposal.state === 'pending',
    queryFn: async () =>
      successEnvelopeSchema(GoalDetailSchema).parse(
        await ownedJson(
          '/api/goals?view=detail&id=' + String(proposal.target_id),
          state.kind === 'signed_in' ? state.session.access_token : '',
          scope,
          epoch,
        ),
      ).data,
  });
  const previous = GoalRevisionPayloadSchema.safeParse(
    before.data?.revision.payload,
  );
  const payload = GoalRevisionPayloadSchema.safeParse(
    proposal.canonical_payload,
  );
  return (
    <section aria-label="Review goal proposal">
      <h3>{String(proposal.summary)}</h3>
      <p>
        {String(proposal.state)} · Expires {String(proposal.expires_at)}
      </p>
      {previous.success && (
        <>
          <h4>Before</h4>
          <GoalDefinitionView value={previous.data} />
          <h4>Proposed</h4>
        </>
      )}
      {payload.success && <GoalDefinitionView value={payload.data} />}
      <p>
        Approval applies these displayed fields only. Changed data or a newer
        goal version requires fresh review.
      </p>
      {proposal.state === 'pending' && payload.success && (
        <>
          <Button
            disabled={busy || (!!proposal.target_id && !previous.success)}
            onClick={() => void decide('approve')}
          >
            Approve goal proposal
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void decide('reject')}
          >
            Reject goal proposal
          </Button>
        </>
      )}
    </section>
  );
}

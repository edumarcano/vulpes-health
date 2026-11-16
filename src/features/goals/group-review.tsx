import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '@/lib/auth/auth-context';
import { ownedJson } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { successEnvelopeSchema } from '../../../shared/api';
import {
  GoalGroupDecisionSchema,
  GoalGroupProposalPayloadSchema,
  GoalGroupProposalReferenceSchema,
  GoalGroupProposalRowSchema,
} from '../../../shared/goal-groups';
import { GoalDefinitionView } from './goal-review';

type Proposal = z.infer<typeof GoalGroupProposalRowSchema>;
type Reference = z.infer<typeof GoalGroupProposalReferenceSchema>;

export function GroupProposalReview({
  proposal,
  busy,
  decide,
}: {
  proposal: Proposal;
  busy: boolean;
  decide: (action: 'approve' | 'reject') => Promise<void>;
}) {
  const parsed = GoalGroupProposalPayloadSchema.safeParse(
    proposal.canonical_payload,
  );
  return (
    <section
      aria-label="Review group proposal"
      className="space-y-3 break-words"
    >
      <h3>{proposal.summary}</h3>
      <p>
        {proposal.state} · Expires {proposal.expires_at}
      </p>
      {proposal.private_content_removed_at && (
        <p role="status">
          Private baseline evidence was removed after this proposal was
          recorded. Retained fields describe the original approval; missing
          evidence does not establish current conditions.
        </p>
      )}
      {parsed.success ? (
        <>
          <h4>{parsed.data.name}</h4>
          <p>
            Resulting group state: {parsed.data.state} · Reviewed data revision{' '}
            {parsed.data.reviewedDataRevision}
          </p>
          {proposal.target_version !== null && (
            <p>Expected group version: {proposal.target_version}</p>
          )}
          <ol className="space-y-4">
            {parsed.data.members.map((member, index) => (
              <li key={index}>
                <h4>
                  Member {index + 1}: {member.payload.definition.title}
                </h4>
                <p>
                  {parsed.data.state === 'archived'
                    ? 'Retained reviewed member; current goal state is unchanged.'
                    : member.kind === 'create'
                      ? 'Create a new goal'
                      : member.kind === 'revise'
                        ? 'Revise approved goal'
                        : 'Link existing approved goal'}
                </p>
                {member.kind !== 'create' && (
                  <p>
                    Goal ID: {member.goalId} · Expected goal version:{' '}
                    {member.expectedVersion} · Reviewed revision:{' '}
                    {member.revisionId}
                  </p>
                )}
                <GoalDefinitionView
                  value={member.payload}
                  historical={parsed.data.state === 'archived'}
                />
              </li>
            ))}
          </ol>
          <p>
            {parsed.data.state === 'archived'
              ? 'Archiving this group does not change any member goal. The retained reviewed snapshots are shown for reference; current member definitions and states may differ.'
              : 'Approval applies this name, order and every displayed member together. Changed data or versions require fresh review. No member is activated separately.'}
          </p>
        </>
      ) : (
        <p role="alert">
          The reviewed group fields are unavailable. Create a fresh proposal to
          approve changes.
        </p>
      )}
      {proposal.state === 'pending' && (
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={busy || !parsed.success}
            onClick={() => void decide('approve')}
          >
            Approve group proposal
          </Button>
          <Button
            variant="outline"
            disabled={busy}
            onClick={() => void decide('reject')}
          >
            Reject group proposal
          </Button>
        </div>
      )}
    </section>
  );
}

export function OwnedGroupProposal({ reference }: { reference: Reference }) {
  const { state, scope } = useAuth();
  const epoch = scope.epoch;
  const token = state.kind === 'signed_in' ? state.session.access_token : '';
  const client = useQueryClient();
  const root = ['goals', scope.userId, epoch];
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const status = useRef<HTMLParagraphElement>(null);
  const decisionId = useRef<{
    action: 'approve' | 'reject';
    id: string;
  } | null>(null);
  useEffect(() => {
    if (notice) status.current?.focus();
  }, [notice]);
  const query = useQuery({
    queryKey: [...root, 'group-proposal', reference.proposalId],
    enabled: !!token,
    retry: false,
    queryFn: async () =>
      successEnvelopeSchema(GoalGroupProposalRowSchema).parse(
        await ownedJson(
          '/api/goals?view=group_proposal&id=' + reference.proposalId,
          token,
          scope,
          epoch,
        ),
      ).data,
    refetchInterval: (q) => (q.state.data?.state === 'pending' ? 5000 : false),
  });
  const proposal = query.data;
  const valid =
    proposal?.id === reference.proposalId &&
    proposal.payload_hash === reference.payloadHash &&
    proposal.target_version === reference.expectedVersion;
  async function decide(action: 'approve' | 'reject') {
    if (!valid) return;
    setBusy(true);
    setNotice('');
    if (decisionId.current?.action !== action)
      decisionId.current = { action, id: crypto.randomUUID() };
    try {
      await ownedJson('/api/approvals', token, scope, epoch, {
        method: 'POST',
        body: JSON.stringify({
          action,
          proposal_id: reference.proposalId,
          payload_hash: reference.payloadHash,
          expected_version: reference.expectedVersion,
          client_request_id: decisionId.current.id,
        }),
      });
      scope.commit(epoch, () =>
        setNotice(
          action === 'approve'
            ? 'Group approved atomically.'
            : 'Group proposal rejected.',
        ),
      );
    } catch (error) {
      scope.commit(epoch, () =>
        setNotice(
          error instanceof Error
            ? error.message
            : 'Refresh and review the group proposal.',
        ),
      );
    } finally {
      scope.commit(epoch, () => {
        setBusy(false);
        void client.invalidateQueries({ queryKey: root });
        void client.invalidateQueries({
          queryKey: ['conversations', scope.userId, epoch],
        });
      });
    }
  }
  const result = GoalGroupDecisionSchema.safeParse(proposal?.result);
  return (
    <Card className="min-w-0 break-words space-y-3" aria-label="Group proposal">
      {query.isPending ? (
        <p role="status">Loading group proposal…</p>
      ) : valid ? (
        <GroupProposalReview
          proposal={proposal}
          busy={busy || query.isFetching}
          decide={decide}
        />
      ) : (
        <p role="alert">
          The group proposal is unavailable. Refresh to review saved state.
        </p>
      )}
      <p ref={status} tabIndex={-1} role="status">
        {notice}
      </p>
      {valid &&
        result.success &&
        result.data.outcome === 'approved' &&
        result.data.proposalId === reference.proposalId && (
          <>
            <p>
              Approved group version {result.data.version} ·{' '}
              {result.data.members.length} member receipts
            </p>
            <Link to={'/goals?group=' + result.data.groupId}>
              Open approved group
            </Link>
          </>
        )}
      <Button
        variant="outline"
        disabled={query.isFetching}
        onClick={() => void query.refetch()}
      >
        Refresh group proposal
      </Button>
    </Card>
  );
}

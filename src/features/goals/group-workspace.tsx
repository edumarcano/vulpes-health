import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { useAuth } from '@/lib/auth/auth-context';
import { ownedJson } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { successEnvelopeSchema } from '../../../shared/api';
import {
  GoalGroupDetailSchema,
  GoalGroupProposalsPageSchema,
  GoalGroupProposalRowSchema,
  GoalGroupsPageSchema,
  type GoalGroupMutation,
} from '../../../shared/goal-groups';
import { GroupForm } from './group-form';
import { GroupProgress } from './group-progress';
import { OwnedGroupProposal } from './group-review';
import { GoalDefinitionView } from './goal-review';

export function GroupWorkspace({
  sources,
}: {
  sources: { id: string; label: string }[];
}) {
  const { state, scope } = useAuth();
  const epoch = scope.epoch;
  const token = state.kind === 'signed_in' ? state.session.access_token : '';
  const client = useQueryClient();
  const root = ['goals', scope.userId, epoch];
  const [params, setParams] = useSearchParams();
  const id = z.uuid().safeParse(params.get('group'));
  const selected = id.success ? id.data : null;
  const [cursor, setCursor] = useState<string | null>(null);
  const [proposalCursor, setProposalCursor] = useState<string | null>(null);
  const [editor, setEditor] = useState<
    'create' | z.infer<typeof GoalGroupDetailSchema> | null
  >(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [recent, setRecent] = useState<z.infer<
    typeof GoalGroupProposalRowSchema
  > | null>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);
  const detailFocusRequest = useRef(selected);
  const status = useRef<HTMLParagraphElement>(null);
  const editorOpener = useRef<HTMLButtonElement | null>(null);
  const editorClosure = useRef<'cancel' | 'submitted' | 'outside'>('cancel');
  const load = (path: string) => ownedJson(path, token, scope, epoch);
  const list = useQuery({
    queryKey: [...root, 'groups', cursor],
    queryFn: async () =>
      successEnvelopeSchema(GoalGroupsPageSchema).parse(
        await load(
          '/api/goals?view=groups' + (cursor ? '&cursor=' + cursor : ''),
        ),
      ).data,
  });
  const proposals = useQuery({
    queryKey: [...root, 'group-proposals', proposalCursor],
    queryFn: async () =>
      successEnvelopeSchema(GoalGroupProposalsPageSchema).parse(
        await load(
          '/api/goals?view=group_proposals' +
            (proposalCursor ? '&cursor=' + proposalCursor : ''),
        ),
      ).data,
  });
  const detail = useQuery({
    queryKey: [...root, 'group-detail', selected],
    enabled: !!selected,
    queryFn: async () =>
      successEnvelopeSchema(GoalGroupDetailSchema).parse(
        await load('/api/goals?view=group_detail&id=' + selected),
      ).data,
  });
  useEffect(() => {
    detailFocusRequest.current = selected;
  }, [selected]);
  useEffect(() => {
    if (
      detail.data &&
      selected &&
      detailFocusRequest.current === selected &&
      !editor
    ) {
      detailFocusRequest.current = null;
      detailHeading.current?.focus();
    }
  }, [detail.data, selected, editor]);
  useEffect(() => {
    if (notice) status.current?.focus();
  }, [notice]);
  async function propose(request: GoalGroupMutation) {
    setBusy(true);
    setNotice('');
    try {
      const proposal = successEnvelopeSchema(GoalGroupProposalRowSchema).parse(
        await ownedJson('/api/goals', token, scope, epoch, {
          method: 'POST',
          body: JSON.stringify(request),
        }),
      ).data;
      scope.commit(epoch, () => {
        editorClosure.current = 'submitted';
        setRecent(proposal);
        setEditor(null);
        setCursor(null);
        setProposalCursor(null);
        setNotice(
          'Group proposal saved. Inspect every member below before approving.',
        );
        void client.invalidateQueries({ queryKey: root });
      });
    } catch (error) {
      scope.commit(epoch, () =>
        setNotice(
          error instanceof Error
            ? error.message
            : 'The group proposal could not be saved.',
        ),
      );
    } finally {
      scope.commit(epoch, () => setBusy(false));
    }
  }
  const displayed = proposals.data?.items ?? [];
  const rows =
    recent && !displayed.some((proposal) => proposal.id === recent.id)
      ? [recent, ...displayed]
      : displayed;
  return (
    <section aria-label="Goal groups" className="space-y-4 min-w-0">
      <Card className="space-y-3">
        <div className="flex flex-wrap justify-between gap-2">
          <h2>Your goal groups</h2>
          <Button
            disabled={busy}
            onClick={(event) => {
              editorOpener.current = event.currentTarget;
              editorClosure.current = 'cancel';
              detailFocusRequest.current = null;
              setNotice('');
              setEditor('create');
            }}
          >
            New Group
          </Button>
        </div>
        <p>
          One to four required goals, each with its own target and evidence.
        </p>
        <p ref={status} role="status" tabIndex={-1}>
          {notice}
        </p>
        {list.isPending && <p role="status">Loading groups…</p>}
        {list.error && (
          <>
            <p role="alert">{list.error.message}</p>
            <Button variant="outline" onClick={() => void list.refetch()}>
              Retry groups
            </Button>
          </>
        )}
        {list.data?.items.length === 0 && <p>No approved groups yet.</p>}
        <div className="flex flex-wrap gap-2">
          {list.data?.items.map((group) => (
            <Button
              variant="outline"
              key={group.id}
              onClick={() => setParams({ group: group.id })}
            >
              {group.name} · {group.state} ·{' '}
              {group.review_status.replaceAll('_', ' ')}
            </Button>
          ))}
        </div>
        {list.data?.nextCursor && (
          <Button
            variant="outline"
            onClick={() => setCursor(list.data!.nextCursor)}
          >
            Next groups
          </Button>
        )}
        {cursor && (
          <Button variant="outline" onClick={() => setCursor(null)}>
            First groups page
          </Button>
        )}
      </Card>
      {detail.isPending && selected && (
        <p role="status">Loading group detail…</p>
      )}
      {detail.error && (
        <>
          <p role="alert">{detail.error.message}</p>
          <Button variant="outline" onClick={() => void detail.refetch()}>
            Retry group detail
          </Button>
        </>
      )}
      {detail.data && (
        <Card className="space-y-4 break-words min-w-0">
          <h2 ref={detailHeading} tabIndex={-1}>
            {detail.data.group.name}
          </h2>
          <p>
            Group state: {detail.data.group.state} · Review:{' '}
            {detail.data.group.review_status.replaceAll('_', ' ')} · Version:{' '}
            {detail.data.group.version}
          </p>
          <GroupProgress value={detail.data.progress} />
          <details>
            <summary>Reviewed member definitions</summary>
            {detail.data.members.map((member) => (
              <section key={member.membership.id}>
                <h3>Reviewed member {member.membership.position}</h3>
                {member.reviewedPayload ? (
                  <GoalDefinitionView value={member.reviewedPayload} />
                ) : (
                  <p>Reviewed private definition unavailable.</p>
                )}
              </section>
            ))}
          </details>
          {detail.data.group.state !== 'archived' && (
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy || detail.isFetching}
                onClick={(event) => {
                  editorOpener.current = event.currentTarget;
                  editorClosure.current = 'cancel';
                  detailFocusRequest.current = null;
                  setNotice('');
                  setEditor(detail.data);
                }}
              >
                Edit group
              </Button>
              <Button
                variant="outline"
                disabled={busy || detail.isFetching}
                onClick={() =>
                  void propose({
                    action: 'propose_group_state',
                    client_request_id: crypto.randomUUID(),
                    group_id: detail.data.group.id,
                    expected_version: detail.data.group.version,
                    state: 'archived',
                  })
                }
              >
                Review group archive
              </Button>
            </div>
          )}
        </Card>
      )}
      <Card className="space-y-4 min-w-0">
        <h2>Group proposals</h2>
        {proposals.isPending && <p role="status">Loading group proposals…</p>}
        {proposals.error && (
          <>
            <p role="alert">{proposals.error.message}</p>
            <Button variant="outline" onClick={() => void proposals.refetch()}>
              Retry group proposals
            </Button>
          </>
        )}
        {rows.length === 0 && !proposals.isPending && (
          <p>No group proposals to review.</p>
        )}
        {rows.map((proposal) => (
          <OwnedGroupProposal
            key={proposal.id}
            reference={{
              version: 1,
              proposalId: proposal.id,
              payloadHash: proposal.payload_hash,
              expectedVersion: proposal.target_version,
            }}
          />
        ))}
        {proposals.data?.nextCursor && (
          <Button
            variant="outline"
            onClick={() => setProposalCursor(proposals.data!.nextCursor)}
          >
            Next group proposals
          </Button>
        )}
        {proposalCursor && (
          <Button variant="outline" onClick={() => setProposalCursor(null)}>
            First group proposals page
          </Button>
        )}
      </Card>
      <Sheet
        open={editor !== null}
        onOpenChange={(open) => {
          if (!open && !busy) setEditor(null);
        }}
        modal={false}
      >
        <SheetContent
          side="right"
          className="w-full sm:max-w-xl overflow-y-auto"
          onInteractOutside={(event) => {
            if (busy) event.preventDefault();
            else editorClosure.current = 'outside';
          }}
          onEscapeKeyDown={(event) => {
            if (busy) event.preventDefault();
            else editorClosure.current = 'cancel';
          }}
          onCloseAutoFocus={(event) => {
            event.preventDefault();
            if (editorClosure.current === 'submitted') status.current?.focus();
            else if (editorClosure.current === 'cancel')
              editorOpener.current?.focus();
          }}
        >
          <SheetHeader>
            <SheetTitle>
              {editor === 'create' ? 'Create new group' : 'Edit group'}
            </SheetTitle>
            <SheetDescription>
              Prepare every required member for one explicit approval.
            </SheetDescription>
          </SheetHeader>
          {editor && (
            <GroupForm
              key={
                editor === 'create'
                  ? 'create'
                  : editor.group.id + ':' + editor.group.version
              }
              initial={editor === 'create' ? null : editor}
              sources={sources}
              busy={busy}
              submit={propose}
              cancel={() => setEditor(null)}
            />
          )}
        </SheetContent>
      </Sheet>
    </section>
  );
}

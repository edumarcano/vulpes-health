import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { z } from 'zod';
import { useAuth } from '@/lib/auth/auth-context';
import { ownedJson } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { successEnvelopeSchema } from '../../../shared/api';
import {
  GoalDefinitionSchema,
  GoalRevisionPayloadSchema,
  type GoalDefinition,
} from '../../../shared/goals';
import { GoalDetailSchema, GoalsPageSchema } from '../../../shared/goal-views';
import {
  GoalGroupDetailSchema,
  GoalGroupMutationSchema,
  type GoalGroupMemberInput,
  type GoalGroupMutation,
} from '../../../shared/goal-groups';
import { GoalForm } from './goal-form';
import { GoalDefinitionView } from './goal-review';

type Detail = z.infer<typeof GoalGroupDetailSchema>;
type DraftMember = {
  key: string;
  input: GoalGroupMemberInput;
  title: string;
  definition: GoalDefinition | null;
  needsAdoption: boolean;
};

export function GroupForm({
  initial,
  sources,
  busy,
  submit,
  cancel,
}: {
  initial: Detail | null;
  sources: { id: string; label: string }[];
  busy: boolean;
  submit: (request: GoalGroupMutation) => Promise<void>;
  cancel: () => void;
}) {
  const { state, scope } = useAuth();
  const epoch = scope.epoch;
  const token = state.kind === 'signed_in' ? state.session.access_token : '';
  const [name, setName] = useState(initial?.group.name ?? '');
  const [members, setMembers] = useState<DraftMember[]>(
    () =>
      initial?.members.map((member) => ({
        key: member.membership.id,
        input: {
          kind: 'existing',
          goal_id: member.membership.goal_id,
          expected_version: member.membership.reviewed_goal_version,
        },
        title:
          member.reviewedPayload?.definition.title ??
          member.goal?.title ??
          'Unavailable member',
        definition: member.reviewedPayload?.definition ?? null,
        needsAdoption:
          !member.goal ||
          member.goal.review_status !== 'clear' ||
          member.goal.state === 'archived' ||
          member.goal.version !== member.membership.reviewed_goal_version ||
          member.currentRevisionId !== member.membership.reviewed_revision_id,
      })) ?? [],
  );
  const [editor, setEditor] = useState<
    | { kind: 'create' }
    | { kind: 'select'; replaceKey?: string | undefined }
    | { kind: 'draft'; member: DraftMember }
    | {
        kind: 'revise';
        goal: z.infer<typeof GoalDetailSchema>;
        replaceKey?: string | undefined;
      }
    | null
  >(null);
  const [candidate, setCandidate] = useState('');
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState('');
  const requestId = useState(() => crypto.randomUUID())[0];
  const choices = useQuery({
    queryKey: ['goals', scope.userId, epoch, 'group-choices', cursor],
    enabled: editor?.kind === 'select',
    queryFn: async () =>
      successEnvelopeSchema(GoalsPageSchema).parse(
        await ownedJson(
          '/api/goals?page_size=50' + (cursor ? '&cursor=' + cursor : ''),
          token,
          scope,
          epoch,
        ),
      ).data,
  });
  const current = useQuery({
    queryKey: ['goals', scope.userId, epoch, 'group-candidate', candidate],
    enabled: !!candidate && editor?.kind === 'select',
    queryFn: async () =>
      successEnvelopeSchema(GoalDetailSchema).parse(
        await ownedJson(
          '/api/goals?view=detail&id=' + candidate,
          token,
          scope,
          epoch,
        ),
      ).data,
  });
  function save(
    input: GoalGroupMemberInput,
    definition: GoalDefinition,
    replaceKey?: string,
  ) {
    const key = replaceKey ?? crypto.randomUUID();
    const next = {
      key,
      input,
      title: definition.title,
      definition,
      needsAdoption: false,
    };
    setMembers((previous) =>
      replaceKey
        ? previous.map((member) => (member.key === replaceKey ? next : member))
        : [...previous, next],
    );
    setEditor(null);
    setCandidate('');
    setError('');
  }
  function select(replaceKey?: string) {
    setCandidate('');
    setEditor({ kind: 'select', replaceKey });
  }
  const selected = current.data;
  const selectedPayload = GoalRevisionPayloadSchema.safeParse(
    selected?.revision.payload,
  );
  const canLink =
    selected &&
    selectedPayload.success &&
    selected.goal.state !== 'archived' &&
    selected.goal.review_status === 'clear';
  const canRevise =
    selected && selectedPayload.success && selected.goal.state !== 'archived';
  return (
    <section
      aria-label="Group editor"
      className="settings-form space-y-4 min-w-0"
    >
      <label>
        Group name
        <input
          value={name}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
          required
        />
      </label>
      <p>
        Choose one to four required members. Saving a member keeps a local
        draft; nothing is activated before the complete group is approved.
      </p>
      <ol className="space-y-3">
        {members.map((member, index) => (
          <li key={member.key} className="break-words">
            <h3>
              Member {index + 1}: {member.title}
            </h3>
            <p>
              {member.input.kind === 'existing'
                ? 'Link approved goal'
                : member.input.kind === 'create'
                  ? 'Create new goal'
                  : 'Revise approved goal'}
            </p>
            {member.needsAdoption && (
              <p role="alert">
                This member changed or requires review. Explicitly choose its
                current approved version or prepare a revision before
                submitting.
              </p>
            )}
            {member.definition && (
              <p>
                Target:{' '}
                {member.definition.target.direction === 'maintain_range'
                  ? `${member.definition.target.lower}–${member.definition.target.upper}`
                  : member.definition.target.value}{' '}
                {member.definition.unit} · {member.definition.currentMethod}
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              {member.input.kind !== 'existing' && (
                <Button
                  variant="outline"
                  disabled={busy || !!editor}
                  onClick={() => setEditor({ kind: 'draft', member })}
                >
                  Edit member {index + 1} draft
                </Button>
              )}
              <Button
                variant="outline"
                disabled={busy || !!editor}
                onClick={() => select(member.key)}
              >
                Choose or revise member {index + 1}
              </Button>
              <Button
                variant="outline"
                disabled={busy || !!editor || index === 0}
                onClick={() =>
                  setMembers((previous) => {
                    const next = [...previous];
                    [next[index - 1], next[index]] = [
                      next[index]!,
                      next[index - 1]!,
                    ];
                    return next;
                  })
                }
              >
                Move member {index + 1} up
              </Button>
              <Button
                variant="outline"
                disabled={busy || !!editor}
                onClick={() =>
                  setMembers((previous) =>
                    previous.filter((item) => item.key !== member.key),
                  )
                }
              >
                Remove member {index + 1}
              </Button>
            </div>
          </li>
        ))}
      </ol>
      {!editor && (
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={busy || members.length >= 4}
            onClick={() => select()}
          >
            Add approved goal
          </Button>
          <Button
            variant="outline"
            disabled={busy || members.length >= 4}
            onClick={() => setEditor({ kind: 'create' })}
          >
            Add new member
          </Button>
        </div>
      )}
      {editor?.kind === 'select' && (
        <Card className="space-y-3">
          <h3>Choose an approved goal</h3>
          <label>
            Approved goal
            <select
              value={candidate}
              onChange={(e) => setCandidate(e.target.value)}
            >
              <option value="">Select a goal</option>
              {choices.data?.items
                .filter(
                  (goal) =>
                    goal.state !== 'archived' &&
                    !members.some(
                      (member) =>
                        member.key !== editor.replaceKey &&
                        member.input.kind !== 'create' &&
                        member.input.goal_id === goal.id,
                    ),
                )
                .map((goal) => (
                  <option key={goal.id} value={goal.id}>
                    {goal.title} · {goal.state} · v{goal.version}
                  </option>
                ))}
            </select>
          </label>
          {choices.isPending && <p role="status">Loading approved goals…</p>}
          {choices.error && <p role="alert">{choices.error.message}</p>}
          {choices.error && (
            <Button variant="outline" onClick={() => void choices.refetch()}>
              Retry approved goals
            </Button>
          )}
          {choices.data?.nextCursor && (
            <Button
              variant="outline"
              onClick={() => {
                setCandidate('');
                setCursor(choices.data!.nextCursor);
              }}
            >
              Next approved goals
            </Button>
          )}
          {cursor && (
            <Button
              variant="outline"
              onClick={() => {
                setCandidate('');
                setCursor(null);
              }}
            >
              First approved goals page
            </Button>
          )}
          {candidate && current.isPending && (
            <p role="status">Loading exact approved definition…</p>
          )}
          {current.error && <p role="alert">{current.error.message}</p>}
          {selected && selectedPayload.success && (
            <>
              <h4>Current approved definition</h4>
              <p>
                Version {selected.goal.version} · Revision{' '}
                {selected.revision.id} · Review {selected.goal.review_status}
              </p>
              <GoalDefinitionView value={selectedPayload.data} />
              <Button
                disabled={!canLink || busy || current.isFetching}
                onClick={() =>
                  save(
                    {
                      kind: 'existing',
                      goal_id: selected.goal.id,
                      expected_version: selected.goal.version,
                    },
                    selectedPayload.data.definition,
                    editor.replaceKey,
                  )
                }
              >
                Use current approved goal
              </Button>
              <Button
                variant="outline"
                disabled={!canRevise || busy || current.isFetching}
                onClick={() =>
                  setEditor({
                    kind: 'revise',
                    goal: selected,
                    replaceKey: editor.replaceKey,
                  })
                }
              >
                Prepare member revision
              </Button>
            </>
          )}
        </Card>
      )}
      {(editor?.kind === 'create' ||
        editor?.kind === 'revise' ||
        editor?.kind === 'draft') && (
        <MemberDefinitionEditor
          key={
            editor.kind === 'create'
              ? 'new'
              : editor.kind === 'draft'
                ? editor.member.key
                : editor.goal.revision.id
          }
          editor={editor}
          sources={sources}
          busy={busy}
          save={save}
        />
      )}
      {editor && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => setEditor(null)}
        >
          Cancel member editing
        </Button>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={
            busy ||
            !!editor ||
            members.length === 0 ||
            members.some((member) => member.needsAdoption)
          }
          onClick={() => {
            const parsed = GoalGroupMutationSchema.safeParse({
              action: initial
                ? 'propose_group_revision'
                : 'propose_group_create',
              client_request_id: requestId,
              name,
              members: members.map((member) => member.input),
              ...(initial
                ? {
                    group_id: initial.group.id,
                    expected_version: initial.group.version,
                  }
                : {}),
            });
            if (!parsed.success) {
              setError(
                parsed.error.issues.map((issue) => issue.message).join(' '),
              );
              return;
            }
            setError('');
            void submit(parsed.data);
          }}
        >
          Review complete group
        </Button>
        <Button variant="outline" disabled={busy} onClick={cancel}>
          Cancel group editing
        </Button>
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

function MemberDefinitionEditor({
  editor,
  sources,
  busy,
  save,
}: {
  editor:
    | { kind: 'create' }
    | { kind: 'draft'; member: DraftMember }
    | {
        kind: 'revise';
        goal: z.infer<typeof GoalDetailSchema>;
        replaceKey?: string | undefined;
      };
  sources: { id: string; label: string }[];
  busy: boolean;
  save: (
    input: GoalGroupMemberInput,
    definition: GoalDefinition,
    replaceKey?: string,
  ) => void;
}) {
  const [resolution, setResolution] = useState<'retain' | 'replace'>(
    editor.kind === 'draft' && editor.member.input.kind === 'revise'
      ? editor.member.input.baseline_resolution
      : 'replace',
  );
  const initial =
    editor.kind === 'revise'
      ? GoalRevisionPayloadSchema.parse(editor.goal.revision.payload).definition
      : editor.kind === 'draft'
        ? editor.member.definition
        : null;
  return (
    <>
      {(editor.kind === 'revise' ||
        (editor.kind === 'draft' && editor.member.input.kind === 'revise')) && (
        <label>
          Member baseline resolution
          <select
            value={resolution}
            onChange={(e) => setResolution(e.target.value as typeof resolution)}
          >
            <option value="replace">
              Replace with a newly calculated baseline
            </option>
            <option value="retain">
              Retain the approved historical baseline
            </option>
          </select>
        </label>
      )}
      <GoalForm
        initial={initial}
        sources={sources}
        busy={busy}
        submitLabel="Save member draft"
        submit={async (definition) => {
          const valid = GoalDefinitionSchema.parse(definition);
          if (editor.kind === 'draft') {
            if (editor.member.input.kind === 'existing') return;
            save(
              {
                ...editor.member.input,
                definition: valid,
                ...(editor.member.input.kind === 'revise'
                  ? { baseline_resolution: resolution }
                  : {}),
              },
              valid,
              editor.member.key,
            );
            return;
          }
          save(
            editor.kind === 'create'
              ? { kind: 'create', definition: valid }
              : {
                  kind: 'revise',
                  goal_id: editor.goal.goal.id,
                  expected_version: editor.goal.goal.version,
                  definition: valid,
                  baseline_resolution: resolution,
                },
            valid,
            editor.kind === 'revise' ? editor.replaceKey : undefined,
          );
        }}
      />
    </>
  );
}

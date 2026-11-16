import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { useSearchParams } from 'react-router-dom';
import { Plus } from 'lucide-react';
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
import {
  GoalRevisionPayloadSchema,
  goalTransitions,
  type GoalDefinition,
} from '../../../shared/goals';
import { SourcesPageSchema } from '../../../shared/data';
import { DataChartView } from '../data/data-chart-view';
import { successEnvelopeSchema } from '../../../shared/api';
import {
  GoalsPageSchema,
  GoalProposalsPageSchema,
  GoalRevisionsPageSchema,
  GoalDetailSchema,
} from '../../../shared/goal-views';
import { GoalDefinitionView, GoalProposalReview } from './goal-review';
import { GoalListItem, Progress } from './goal-progress';
import { GoalForm } from './goal-form';
import { GroupWorkspace } from './group-workspace';
export function GoalsPage() {
  const { state, scope } = useAuth();
  const session = state.kind === 'signed_in' ? state.session : null;
  const epoch = scope.epoch;
  return (
    <div className="goals-page">
      <GoalsWorkspace
        key={`${session?.user.id}:${epoch}`}
        token={session?.access_token ?? ''}
      />
    </div>
  );
}
function GoalsWorkspace({ token }: { token: string }) {
  const [params] = useSearchParams();
  const { scope } = useAuth();
  const epoch = scope.epoch;
  const client = useQueryClient();
  const root = ['goals', scope.userId, epoch];
  const [goalCursor, setGoalCursor] = useState<string | null>(null);
  const [proposalCursor, setProposalCursor] = useState<string | null>(null);
  const [historyCursor, setHistoryCursor] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<string | null>(() => {
    const id = z.uuid().safeParse(params.get('goal'));
    return id.success ? id.data : null;
  });
  const requestedGoal = params.get('goal');
  useEffect(() => {
    const id = z.uuid().safeParse(requestedGoal);
    setSelected(id.success ? id.data : null);
    setHistoryCursor(null);
  }, [requestedGoal]);
  const [editing, setEditing] = useState<GoalDefinition | null>(null);
  const [goalFormOpen, setGoalFormOpen] = useState(false);
  const load = (path: string) => ownedJson(path, token, scope, epoch);
  const list = useQuery({
    queryKey: [...root, 'list', goalCursor],
    queryFn: async () =>
      successEnvelopeSchema(GoalsPageSchema).parse(
        await load('/api/goals' + (goalCursor ? '?cursor=' + goalCursor : '')),
      ).data,
  });
  const proposals = useQuery({
    queryKey: [...root, 'proposals', proposalCursor],
    queryFn: async () =>
      successEnvelopeSchema(GoalProposalsPageSchema).parse(
        await load(
          '/api/goals?view=proposals' +
            (proposalCursor ? '&cursor=' + proposalCursor : ''),
        ),
      ).data,
  });
  const sources = useQuery({
    queryKey: [...root, 'sources'],
    queryFn: async () =>
      z
        .object({ data: SourcesPageSchema })
        .parse(await load('/api/data?view=sources&page_size=200')).data,
  });
  const detail = useQuery({
    queryKey: [...root, 'detail', selected],
    enabled: !!selected,
    queryFn: async () =>
      successEnvelopeSchema(GoalDetailSchema).parse(
        await load('/api/goals?view=detail&id=' + selected),
      ).data,
  });
  const detailHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (detail.data) detailHeading.current?.focus();
  }, [detail.data]);
  const history = useQuery({
    queryKey: [...root, 'history', selected, historyCursor],
    enabled: !!selected,
    queryFn: async () =>
      successEnvelopeSchema(GoalRevisionsPageSchema).parse(
        await load(
          '/api/goals?view=revisions&id=' +
            selected +
            (historyCursor ? '&cursor=' + historyCursor : ''),
        ),
      ).data,
  });
  async function mutate(path: string, body: unknown) {
    setBusy(true);
    setNotice('');
    try {
      await ownedJson(path, token, scope, epoch, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      scope.commit(epoch, () => {
        setNotice('Saved. Review the current state below.');
        setEditing(null);
        setGoalCursor(null);
        setProposalCursor(null);
        setHistoryCursor(null);
        void client.invalidateQueries({ queryKey: root });
      });
      setGoalFormOpen(false);
    } catch (e) {
      scope.commit(epoch, () =>
        setNotice(
          e instanceof Error ? e.message : 'The goal could not be saved.',
        ),
      );
    } finally {
      scope.commit(epoch, () => setBusy(false));
    }
  }
  const g = detail.data?.goal;
  const payload = GoalRevisionPayloadSchema.safeParse(
    detail.data?.revision.payload,
  );
  const chart = detail.data?.chart;
  return (
    <>
      <header className="page-heading flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 tabIndex={-1}>Goals</h1>
          <p className="text-sm text-muted-foreground">
            Personal health targets and audited deterministic progress
          </p>
        </div>
        <Button
          onClick={() => {
            setEditing(null);
            setGoalFormOpen(true);
          }}
        >
          <Plus className="h-4 w-4 mr-1.5" />
          New Goal
        </Button>
      </header>
      {notice && <p role="status">{notice}</p>}
      {[list.error, proposals.error, sources.error, detail.error]
        .filter(Boolean)
        .map((e, i) => (
          <p key={i} role="alert">
            {e?.message}
          </p>
        ))}

      <div className="goals-stack">
        {/* Active Goals Section First */}
        <Card>
          <h2>Your goals</h2>
          {list.isPending ? (
            <p role="status">Loading goals…</p>
          ) : list.isError ? (
            <Button variant="outline" onClick={() => void list.refetch()}>
              Retry goals
            </Button>
          ) : !list.data?.items.length ? (
            <p>No approved goals yet.</p>
          ) : (
            <div className="active-goals-grid">
              {list.data.items.map((goal) => (
                <GoalListItem
                  key={String(goal.id)}
                  goal={goal}
                  open={() => setSelected(String(goal.id))}
                />
              ))}
            </div>
          )}
          {list.data?.nextCursor && (
            <Button
              variant="outline"
              onClick={() => setGoalCursor(list.data!.nextCursor)}
            >
              Next goals
            </Button>
          )}
          {goalCursor && (
            <Button variant="outline" onClick={() => setGoalCursor(null)}>
              First goals page
            </Button>
          )}
        </Card>

        {/* Focused Detail View */}
        {g && payload.success && (
          <Card className="goal-detail-card">
            <h2 ref={detailHeading} tabIndex={-1}>
              {String(g.title)}
            </h2>
            <p>
              State: {String(g.state)} · Review: {String(g.review_status)} ·
              Version: {String(g.version)}
            </p>
            <GoalDefinitionView value={payload.data} />
            <Progress value={detail.data?.progress} />
            <div className="flex flex-wrap gap-2 my-2">
              <Button
                disabled={busy || g.state === 'archived'}
                onClick={() => {
                  setEditing(payload.data.definition);
                  setGoalFormOpen(true);
                }}
              >
                Edit goal
              </Button>
              {['active', 'paused', 'completed', 'archived'].map((next) => (
                <Button
                  key={next}
                  variant="outline"
                  disabled={
                    busy ||
                    !goalTransitions[String(g.state)]?.includes(next) ||
                    (next === 'active' && g.review_status !== 'clear')
                  }
                  onClick={() =>
                    void mutate('/api/goals', {
                      action: 'propose_state',
                      goal_id: g.id,
                      expected_version: g.version,
                      state: next,
                      client_request_id: crypto.randomUUID(),
                    })
                  }
                >
                  Review {next}
                </Button>
              ))}
              {g.review_status === 'needs_review' && (
                <Button
                  disabled={busy}
                  onClick={() =>
                    void mutate('/api/goals', {
                      action: 'propose_revision',
                      goal_id: g.id,
                      expected_version: g.version,
                      definition: payload.data.definition,
                      baseline_resolution: 'retain',
                      client_request_id: crypto.randomUUID(),
                    })
                  }
                >
                  Review retaining historical baseline
                </Button>
              )}
            </div>
            {chart && (
              <>
                <DataChartView data={chart.summary} />
                <div
                  className="data-table-scroll"
                  role="region"
                  aria-label="Goal observations"
                  tabIndex={0}
                >
                  <table>
                    <caption>Observations in the last 30 local days</caption>
                    <thead>
                      <tr>
                        <th>Date</th>
                        <th>Value</th>
                      </tr>
                    </thead>
                    <tbody>
                      {chart.observations.items.map((x) => (
                        <tr key={x.id}>
                          <td>{x.observedAt}</td>
                          <td>
                            {x.value} {x.unit}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {chart.observations.nextCursor && (
                  <p>
                    Showing the first 200 observations. Open Data for the
                    complete series.
                  </p>
                )}
              </>
            )}
            <h3>Revision history</h3>
            {history.data?.items.map((r) => (
              <p key={String(r.id)}>
                Revision {String(r.revision_number)} · {String(r.approved_at)}
              </p>
            ))}
            {history.data?.nextCursor && (
              <Button
                variant="outline"
                onClick={() => setHistoryCursor(history.data!.nextCursor)}
              >
                Next revisions
              </Button>
            )}
          </Card>
        )}

        <GroupWorkspace sources={sources.data?.items ?? []} />

        {/* Proposals Section */}
        <Card>
          <h2>Proposals</h2>
          {proposals.isPending && <p role="status">Loading proposals…</p>}
          {proposals.isError && (
            <div role="alert">
              <p>Proposals could not be loaded.</p>
              <Button
                variant="outline"
                onClick={() => void proposals.refetch()}
              >
                Retry proposals
              </Button>
            </div>
          )}
          {proposals.data?.items.length === 0 && <p>No proposals to review.</p>}
          {proposals.data?.items.map((p) => (
            <GoalProposalReview
              key={String(p.id)}
              proposal={p}
              busy={busy}
              decide={(action) =>
                mutate('/api/approvals', {
                  action,
                  proposal_id: p.id,
                  payload_hash: p.payload_hash,
                  expected_version: p.target_version,
                  client_request_id: crypto.randomUUID(),
                })
              }
            />
          ))}
          {proposals.data?.nextCursor && (
            <Button
              variant="outline"
              onClick={() => setProposalCursor(proposals.data!.nextCursor)}
            >
              Next proposals
            </Button>
          )}
          {proposalCursor && (
            <Button variant="outline" onClick={() => setProposalCursor(null)}>
              First proposals page
            </Button>
          )}
        </Card>
      </div>

      {/* Modal Sheet for Goal Form */}
      <Sheet open={goalFormOpen} onOpenChange={setGoalFormOpen} modal={false}>
        <SheetContent
          side="right"
          className="w-full sm:max-w-xl overflow-y-auto"
        >
          <SheetHeader>
            <SheetTitle>{editing ? 'Edit goal' : 'Create new goal'}</SheetTitle>
            <SheetDescription>
              Configure a personal target, baseline window, and strategy
            </SheetDescription>
          </SheetHeader>
          <GoalForm
            key={editing ? JSON.stringify(editing) : 'new'}
            initial={editing}
            sources={sources.data?.items ?? []}
            busy={busy}
            submit={(definition) =>
              mutate(
                '/api/goals',
                editing && g
                  ? {
                      action: 'propose_revision',
                      goal_id: g.id,
                      expected_version: g.version,
                      definition,
                      baseline_resolution: 'replace',
                      client_request_id: crypto.randomUUID(),
                    }
                  : {
                      action: 'propose_create',
                      definition,
                      client_request_id: crypto.randomUUID(),
                    },
              )
            }
          />
        </SheetContent>
      </Sheet>
    </>
  );
}

import { useState, useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Temporal } from '@js-temporal/polyfill';
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
  GoalDefinitionSchema,
  GoalRevisionPayloadSchema,
  goalTransitions,
  type GoalDefinition,
} from '../../../shared/goals';
import { metricUnits, type MetricKey } from '../../../shared/domain';
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
function GoalForm({
  initial,
  sources,
  busy,
  submit,
}: {
  initial: GoalDefinition | null;
  sources: { id: string; label: string }[];
  busy: boolean;
  submit: (d: GoalDefinition) => Promise<void>;
}) {
  const [error, setError] = useState('');
  const [metric, setMetric] = useState<MetricKey>(initial?.metric ?? 'weight');
  const now = Temporal.Now.zonedDateTimeISO('UTC')
    .startOfDay()
    .add({ days: 1 });
  return (
    <Card>
      <h2>{initial ? 'Revise goal' : 'Create a goal'}</h2>
      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          const text = (k: string) => String(data.get(k) ?? '');
          const numeric = (key: string) =>
            text(key).trim() === '' ? NaN : Number(text(key));
          const direction = text('direction');
          const method = text('baselineMethod');
          const parsed = GoalDefinitionSchema.safeParse({
            schemaVersion: 1,
            title: text('title'),
            metric,
            unit: metricUnits[metric],
            sourceId: text('source'),
            target:
              direction === 'maintain_range'
                ? {
                    direction,
                    lower: numeric('lower'),
                    upper: numeric('upper'),
                  }
                : { direction, value: numeric('target') },
            method: text('method'),
            granularity: text('granularity'),
            baselineMethod: method,
            currentMethod:
              method === 'user_reported' ? text('currentMethod') : method,
            baselineFrom: text('from'),
            baselineTo: text('to'),
            reportedBaseline:
              method === 'user_reported' ? numeric('reported') : null,
            timezone: text('timezone'),
            targetDate: text('date') || null,
            constraints: text('constraints').split('\n').filter(Boolean),
            proposedStrategy: text('strategy') || null,
          });
          if (!parsed.success) {
            setError(parsed.error.issues.map((x) => x.message).join(' '));
            return;
          }
          setError('');
          void submit(parsed.data);
        }}
      >
        <label>
          Title
          <input
            required
            name="title"
            maxLength={200}
            defaultValue={initial?.title}
          />
        </label>
        <label>
          Metric
          <select
            aria-label="Metric"
            value={metric}
            onChange={(e) => setMetric(e.target.value as MetricKey)}
          >
            {Object.keys(metricUnits).map((x) => (
              <option key={x} value={x}>
                {x.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label>
          Source
          <select
            aria-label="Source"
            required
            name="source"
            defaultValue={initial?.sourceId}
          >
            {sources.map((s) => (
              <option key={s.id} value={s.id}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Direction
          <select
            aria-label="Direction"
            name="direction"
            defaultValue={initial?.target.direction ?? 'decrease_to'}
          >
            {['decrease_to', 'increase_to', 'maintain_range'].map((x) => (
              <option key={x} value={x}>
                {x.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        {['target', 'lower', 'upper'].map((x) => (
          <label key={x}>
            {x}
            <input
              name={x}
              type="number"
              step="any"
              defaultValue={
                initial?.target.direction === 'maintain_range'
                  ? x === 'lower'
                    ? initial.target.lower
                    : x === 'upper'
                      ? initial.target.upper
                      : undefined
                  : x === 'target'
                    ? initial?.target.value
                    : undefined
              }
            />
          </label>
        ))}
        <label>
          Measurement method
          <select
            aria-label="Measurement method"
            name="method"
            defaultValue={initial?.method ?? 'device_reported'}
          >
            {[
              'device_reported',
              'device_estimate',
              'user_reported',
              'unknown',
            ].map((x) => (
              <option key={x} value={x}>
                {x.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label>
          Granularity
          <select
            aria-label="Granularity"
            name="granularity"
            defaultValue={initial?.granularity ?? 'instant'}
          >
            {['instant', 'daily_total', 'session_total'].map((x) => (
              <option key={x} value={x}>
                {x.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        <label>
          Baseline method
          <select
            aria-label="Baseline method"
            name="baselineMethod"
            defaultValue={initial?.baselineMethod ?? 'daily_median_mean_7d'}
          >
            {['daily_median_mean_7d', 'latest_value', 'user_reported'].map(
              (x) => (
                <option key={x} value={x}>
                  {x.replaceAll('_', ' ')}
                </option>
              ),
            )}
          </select>
        </label>
        <label>
          Current method for reported baseline
          <select
            aria-label="Current method for reported baseline"
            name="currentMethod"
            defaultValue={initial?.currentMethod ?? 'daily_median_mean_7d'}
          >
            <option value="daily_median_mean_7d">Seven-day mean</option>
            <option value="latest_value">Latest observation</option>
          </select>
        </label>
        <label>
          Reported baseline
          <input
            name="reported"
            type="number"
            step="any"
            defaultValue={initial?.reportedBaseline ?? undefined}
          />
        </label>
        <label>
          Baseline from
          <input
            name="from"
            required
            defaultValue={
              initial?.baselineFrom ??
              now.subtract({ days: 7 }).toInstant().toString()
            }
          />
        </label>
        <label>
          Baseline to
          <input
            name="to"
            required
            defaultValue={initial?.baselineTo ?? now.toInstant().toString()}
          />
        </label>
        <label>
          Timezone
          <input
            name="timezone"
            required
            defaultValue={initial?.timezone ?? 'UTC'}
          />
        </label>
        <label>
          Target date
          <input
            type="date"
            name="date"
            defaultValue={initial?.targetDate ?? ''}
          />
        </label>
        <label>
          Constraints, one per line
          <textarea
            name="constraints"
            defaultValue={initial?.constraints.join('\n')}
          />
        </label>
        <label>
          Proposed strategy
          <textarea
            name="strategy"
            defaultValue={initial?.proposedStrategy ?? ''}
          />
        </label>
        <Button disabled={busy || !sources.length}>Review proposal</Button>
        {!sources.length && <p>Add a source in Data before creating a goal.</p>}
        {error && <p role="alert">{error}</p>}
      </form>
    </Card>
  );
}

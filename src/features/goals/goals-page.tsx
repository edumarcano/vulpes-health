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
import {
  DataSummarySchema,
  MeasurementsPageSchema,
  SourcesPageSchema,
} from '../../../shared/data';
import { DataChartView } from '../data/data-chart-view';
const rows = z.object({
  data: z.object({
    items: z.array(z.record(z.string(), z.json())),
    nextCursor: z.string().nullable(),
  }),
});
const envelope = z.object({ data: z.record(z.string(), z.json()) });
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
      rows.parse(
        await load('/api/goals' + (goalCursor ? '?cursor=' + goalCursor : '')),
      ).data,
  });
  const proposals = useQuery({
    queryKey: [...root, 'proposals', proposalCursor],
    queryFn: async () =>
      rows.parse(
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
      envelope.parse(await load('/api/goals?view=detail&id=' + selected)).data,
  });
  const detailHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (detail.data) detailHeading.current?.focus();
  }, [detail.data]);
  const history = useQuery({
    queryKey: [...root, 'history', selected, historyCursor],
    enabled: !!selected,
    queryFn: async () =>
      rows.parse(
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
  const g = detail.data?.goal as
    Record<string, z.infer<ReturnType<typeof z.json>>> | undefined;
  const rev = detail.data?.revision as
    Record<string, z.infer<ReturnType<typeof z.json>>> | undefined;
  const payload = GoalRevisionPayloadSchema.safeParse(rev?.payload);
  const chart = z
    .object({
      summary: DataSummarySchema,
      observations: MeasurementsPageSchema,
    })
    .safeParse(detail.data?.chart);
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
          + New Goal
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
          <Definition value={payload.data} />
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
          {chart.success && (
            <>
              <DataChartView data={chart.data.summary} />
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
                    {chart.data.observations.items.map((x) => (
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
              {chart.data.observations.nextCursor && (
                <p>
                  Showing the first 200 observations. Open Data for the complete
                  series.
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
            <Button variant="outline" onClick={() => void proposals.refetch()}>
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

      {/* Modal Sheet for Goal Form */}
      <Sheet open={goalFormOpen} onOpenChange={setGoalFormOpen} modal={false}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
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
function Definition({
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
  proposal: Record<string, z.infer<ReturnType<typeof z.json>>>;
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
      envelope.parse(
        await ownedJson(
          '/api/goals?view=detail&id=' + String(proposal.target_id),
          state.kind === 'signed_in' ? state.session.access_token : '',
          scope,
          epoch,
        ),
      ).data,
  });
  const previous = GoalRevisionPayloadSchema.safeParse(
    (before.data?.revision as Record<string, unknown> | undefined)?.payload,
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
          <Definition value={previous.data} />
          <h4>Proposed</h4>
        </>
      )}
      {payload.success && <Definition value={payload.data} />}
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

export function Progress({ value }: { value: unknown }) {
  const p = z
    .object({
      kind: z.string(),
      baseline: z.string().optional(),
      current: z.string().optional(),
      result: z
        .object({
          kind: z.string(),
          rawPercent: z.number().optional(),
          displayPercent: z.number().optional(),
        })
        .optional(),
    })
    .safeParse(value);
  if (!p.success) return <p>Progress unavailable.</p>;
  if (p.data.kind !== 'progress')
    return (
      <p>
        {p.data.kind === 'insufficient_data'
          ? 'Insufficient data for progress.'
          : 'Progress requires review of the baseline or revision.'}
      </p>
    );
  const r = p.data.result;
  return (
    <section aria-label="Goal progress">
      <h3>Progress</h3>
      <p>
        Baseline: {p.data.baseline} · Current: {p.data.current}
      </p>
      {r?.kind === 'directional' ? (
        <>
          <p>
            {r.rawPercent?.toLocaleString(undefined, {
              maximumFractionDigits: 2,
            })}
            % progress
          </p>
          <progress
            max={100}
            value={r.displayPercent}
            aria-label="Goal progress"
          />
          <p>
            The bar is limited to 0–100%; the calculation above preserves
            regression and overshoot.
          </p>
        </>
      ) : (
        <p>
          {r?.kind === 'undefined'
            ? 'Progress is undefined because the target equals the baseline.'
            : r?.kind.replaceAll('_', ' ')}
        </p>
      )}
    </section>
  );
}

function GoalListItem({
  goal,
  open,
}: {
  goal: Record<string, z.infer<ReturnType<typeof z.json>>>;
  open: () => void;
}) {
  const { state, scope } = useAuth();
  const epoch = scope.epoch;
  const progress = useQuery({
    queryKey: ['goals', scope.userId, epoch, 'progress', goal.id],
    enabled: state.kind === 'signed_in',
    queryFn: async () =>
      z
        .object({
          data: z.object({
            kind: z.string(),
            current: z.string().optional(),
            baseline: z.string().optional(),
            result: z
              .object({
                kind: z.string(),
                rawPercent: z.number().optional(),
                displayPercent: z.number().optional(),
              })
              .optional(),
          }),
        })
        .parse(
          await ownedJson(
            '/api/goals?view=progress&id=' + String(goal.id),
            state.kind === 'signed_in' ? state.session.access_token : '',
            scope,
            epoch,
          ),
        ).data,
  });
  const policy = goal.source_policy as Record<string, unknown> | null;
  const progressPercent = progress.data?.result?.displayPercent ?? 0;
  return (
    <Card className="goal-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" onClick={open}>
          {String(goal.title)} · {String(goal.state)}
        </Button>
        <span className="text-xs uppercase font-semibold text-muted-foreground">
          {String(goal.state)}
        </span>
      </div>
      <span style={{ display: 'block' }}>
        Target:{' '}
        {goal.direction === 'maintain_range'
          ? `${String(goal.target_lower)}–${String(goal.target_upper)}`
          : String(goal.target_value)}{' '}
        {String(goal.canonical_unit)} · Current method:{' '}
        {String(policy?.currentMethod ?? 'historical').replaceAll('_', ' ')}
      </span>
      <div className="space-y-1 my-2">
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>Progress</span>
          <span className="font-semibold">
            {progress.data?.result?.rawPercent !== undefined
              ? `${progress.data.result.rawPercent.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
              : progress.data?.kind === 'insufficient_data'
                ? 'Insufficient data'
                : 'Pending'}
          </span>
        </div>
        <progress
          className="goal-progress-bar"
          max={100}
          value={progressPercent}
          aria-label={`${String(goal.title)} progress`}
        />
      </div>
      <span style={{ display: 'block' }}>
        {progress.isPending
          ? 'Loading current value…'
          : progress.error
            ? 'Current value unavailable.'
            : progress.data?.kind === 'progress'
              ? `Current: ${progress.data.current} ${String(goal.canonical_unit)} · Enough data for this method.`
              : progress.data?.kind === 'insufficient_data'
                ? 'Insufficient data for progress.'
                : 'Baseline review required.'}
      </span>
    </Card>
  );
}

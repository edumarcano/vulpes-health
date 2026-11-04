import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth/auth-context';
import { ownedJson } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { successEnvelopeSchema } from '../../../shared/api';
import { GoalProgressResultSchema } from '../../../shared/goal-progress';
import type { GoalRow } from '../../../shared/goal-views';
export function Progress({ value }: { value: unknown }) {
  const p = GoalProgressResultSchema.safeParse(value);
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
      {r.kind === 'directional' ? (
        <>
          <p>
            {r.rawPercent.toLocaleString(undefined, {
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
          {r.kind === 'undefined'
            ? 'Progress is undefined because the target equals the baseline.'
            : r.kind.replaceAll('_', ' ')}
        </p>
      )}
    </section>
  );
}

export function GoalListItem({
  goal,
  open,
}: {
  goal: GoalRow;
  open: () => void;
}) {
  const { state, scope } = useAuth();
  const epoch = scope.epoch;
  const progress = useQuery({
    queryKey: ['goals', scope.userId, epoch, 'progress', goal.id],
    enabled: state.kind === 'signed_in',
    queryFn: async () =>
      successEnvelopeSchema(GoalProgressResultSchema).parse(
        await ownedJson(
          '/api/goals?view=progress&id=' + String(goal.id),
          state.kind === 'signed_in' ? state.session.access_token : '',
          scope,
          epoch,
        ),
      ).data,
  });
  const policy = goal.source_policy;
  const result =
    progress.data?.kind === 'progress' ? progress.data.result : undefined;
  const progressPercent =
    result?.kind === 'directional' ? result.displayPercent : undefined;
  return (
    <Card className="goal-card">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button variant="outline" onClick={open}>
          {goal.title} · {goal.state}
        </Button>
        <span className="text-xs uppercase font-semibold text-muted-foreground">
          {goal.state}
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
            {progress.isPending
              ? 'Loading'
              : progress.error
                ? 'Unavailable'
                : progress.data?.kind === 'insufficient_data'
                  ? 'Insufficient data'
                  : result?.kind === 'directional'
                    ? `${result.rawPercent.toLocaleString(undefined, { maximumFractionDigits: 1 })}%`
                    : result?.kind === 'undefined'
                      ? 'Undefined'
                      : result?.kind === 'within_range'
                        ? 'Within range'
                        : result?.kind === 'below_range'
                          ? 'Below range'
                          : result?.kind === 'above_range'
                            ? 'Above range'
                            : 'Unavailable'}
          </span>
        </div>
        {progressPercent !== undefined && (
          <progress
            className="goal-progress-bar"
            max={100}
            value={progressPercent}
            aria-label={`${String(goal.title)} progress`}
          />
        )}
      </div>
      <span style={{ display: 'block' }}>
        {progress.isPending
          ? 'Loading current value…'
          : progress.error
            ? 'Current value unavailable.'
            : progress.data?.kind === 'progress'
              ? result?.kind === 'directional'
                ? `Current: ${progress.data.current} ${String(goal.canonical_unit)} · Enough data for this method.`
                : result?.kind === 'undefined'
                  ? 'Progress is undefined because the target equals the baseline.'
                  : result?.kind === 'within_range'
                    ? `Current: ${progress.data.current} ${String(goal.canonical_unit)} · Within the target range.`
                    : result?.kind === 'below_range'
                      ? `Current: ${progress.data.current} ${String(goal.canonical_unit)} · Below the target range.`
                      : result?.kind === 'above_range'
                        ? `Current: ${progress.data.current} ${String(goal.canonical_unit)} · Above the target range.`
                        : 'Progress unavailable.'
              : progress.data?.kind === 'insufficient_data'
                ? 'Insufficient data for progress.'
                : 'Baseline review required.'}
      </span>
    </Card>
  );
}

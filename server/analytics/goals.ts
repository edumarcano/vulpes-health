import type { GoalTarget } from '../../shared/domain.js';
import { Exact } from './measurements.js';
import { Temporal } from '@js-temporal/polyfill';
import { GoalFreshnessSchema } from '../../shared/goal-progress.js';

export function goalConditionMet(current: string, target: GoalTarget): boolean {
  const value = new Exact(current);
  return target.direction === 'maintain_range'
    ? value.gte(target.lower) && value.lte(target.upper)
    : target.direction === 'increase_to'
      ? value.gte(target.value)
      : value.lte(target.value);
}
export function goalFreshness(
  oldestContributingAt: string | null,
  maxEvidenceAgeDays: number | null | undefined,
  evaluatedAt: string,
) {
  const ageDays =
    oldestContributingAt === null
      ? null
      : Math.max(
          0,
          Temporal.Instant.from(evaluatedAt)
            .since(Temporal.Instant.from(oldestContributingAt))
            .total('seconds') / 86400,
        );
  return GoalFreshnessSchema.parse({
    policyVersion: 'elapsed_measurement_age_v1',
    status:
      ageDays === null
        ? 'unavailable'
        : maxEvidenceAgeDays == null
          ? 'dated'
          : ageDays > maxEvidenceAgeDays
            ? 'stale'
            : 'fresh',
    maxEvidenceAgeDays: maxEvidenceAgeDays ?? null,
    evaluatedAt,
    oldestContributingAt,
    ageDays,
  });
}

export function goalProgress(
  baseline: string | null,
  current: string | null,
  target: GoalTarget,
) {
  if (
    current === null ||
    (target.direction !== 'maintain_range' && baseline === null)
  )
    return { kind: 'insufficient_data' } as const;
  const value = new Exact(current);
  if (target.direction === 'maintain_range')
    return {
      kind: value.lt(target.lower)
        ? 'below_range'
        : value.gt(target.upper)
          ? 'above_range'
          : 'within_range',
    } as const;
  const denominator = new Exact(target.value).minus(baseline!);
  if (denominator.isZero())
    return { kind: 'undefined', reason: 'zero_denominator' } as const;
  const progress = value.minus(baseline!).div(denominator).mul(100);
  const rawPercent = progress.toNumber();
  if (!Number.isFinite(rawPercent))
    return { kind: 'undefined', reason: 'unrepresentable_result' } as const;
  return {
    kind: 'directional',
    rawPercent,
    displayPercent: Exact.max(0, Exact.min(100, progress)).toNumber(),
  } as const;
}

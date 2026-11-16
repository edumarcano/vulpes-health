import { useState, useId } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import {
  goalEligibleMetricKeys,
  metricContent,
  metricGoalCaution,
  metricRegistry,
} from '../../../shared/metrics';
import {
  GoalDefinitionSchema,
  type GoalDefinition,
} from '../../../shared/goals';
import {
  metricUnits,
  type MetricKey,
  type MeasurementMethod,
} from '../../../shared/domain';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
export function GoalForm({
  initial,
  sources,
  busy,
  submit,
  submitLabel = 'Review proposal',
}: {
  initial: GoalDefinition | null;
  sources: { id: string; label: string }[];
  busy: boolean;
  submit: (d: GoalDefinition) => Promise<void>;
  submitLabel?: string;
}) {
  const helpId = useId();
  const [error, setError] = useState('');
  const [metric, setMetric] = useState<MetricKey>(initial?.metric ?? 'weight');
  const [direction, setDirection] = useState(
    initial?.target.direction ?? 'decrease_to',
  );
  const [measurementMethod, setMeasurementMethod] = useState<MeasurementMethod>(
    initial?.method ?? metricRegistry[metric].method,
  );
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
            ...(text('maxEvidenceAgeDays').trim()
              ? { maxEvidenceAgeDays: numeric('maxEvidenceAgeDays') }
              : initial && 'maxEvidenceAgeDays' in initial
                ? { maxEvidenceAgeDays: null }
                : {}),
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
            onChange={(e) => {
              const next = e.target.value as MetricKey;
              setMetric(next);
              setMeasurementMethod(metricRegistry[next].method);
            }}
          >
            {goalEligibleMetricKeys.map((x) => (
              <option key={x} value={x}>
                {metricRegistry[x].label} ({metricUnits[x]})
              </option>
            ))}
          </select>
        </label>
        <p>{metricContent[metric].definition}</p>
        <p className="text-sm text-muted-foreground">
          {metricRegistry[metric].limitation} {metricGoalCaution}
        </p>
        <p>Target unit: {metricUnits[metric]}</p>
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
            value={direction}
            onChange={(e) => setDirection(e.target.value as typeof direction)}
          >
            {['decrease_to', 'increase_to', 'maintain_range'].map((x) => (
              <option key={x} value={x}>
                {x.replaceAll('_', ' ')}
              </option>
            ))}
          </select>
        </label>
        {(direction === 'maintain_range' ? ['lower', 'upper'] : ['target']).map(
          (x) => (
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
          ),
        )}
        <label>
          Measurement method
          <select
            aria-label="Measurement method"
            name="method"
            value={measurementMethod}
            onChange={(e) =>
              setMeasurementMethod(e.target.value as MeasurementMethod)
            }
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
          Maximum evidence age (days, optional)
          <input
            name="maxEvidenceAgeDays"
            type="number"
            min={1}
            max={3660}
            step={1}
            defaultValue={initial?.maxEvidenceAgeDays ?? ''}
            aria-describedby={helpId}
          />
        </label>
        <p id={helpId} className="text-sm text-muted-foreground">
          Leave blank for dated evidence without an age cutoff. If set, the
          oldest contributing reading must be within this elapsed age before the
          goal can be described as currently meeting its condition. Changing
          this policy requires approval.
        </p>
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
        <Button disabled={busy || !sources.length}>{submitLabel}</Button>
        {!sources.length && <p>Add a source in Data before creating a goal.</p>}
        {error && <p role="alert">{error}</p>}
      </form>
    </Card>
  );
}

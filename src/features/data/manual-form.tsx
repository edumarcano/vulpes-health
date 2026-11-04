import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { Temporal } from '@js-temporal/polyfill';
import { Button } from '@/components/ui/button';
import {
  AddMeasurementSchema,
  measurementRegistry,
  type AddMeasurement,
  type Source,
} from '../../../shared/data';
import type {
  MetricKey,
  MeasurementMethod,
  Granularity,
} from '../../../shared/domain';

export function ManualForm({
  sources,
  timezone,
  busy,
  save,
  initialMetric = 'weight',
  initialSource = 'new',
}: {
  sources: Source[];
  timezone: string;
  busy: boolean;
  save: (request: AddMeasurement) => Promise<void>;
  initialMetric?: MetricKey;
  initialSource?: string;
}) {
  const [metric, setMetric] = useState<MetricKey>(initialMetric);
  const [unit, setUnit] = useState<string>(
    measurementRegistry[initialMetric].units[0],
  );
  const [value, setValue] = useState('');
  const [source, setSource] = useState(initialSource);
  const [label, setLabel] = useState('');
  const [device, setDevice] = useState('');
  const [app, setApp] = useState('');
  const [zone, setZone] = useState(timezone);
  const [observed, setObserved] = useState(() =>
    Temporal.Now.zonedDateTimeISO(timezone)
      .toPlainDateTime()
      .toString({ smallestUnit: 'minute' }),
  );
  const [date, setDate] = useState('');
  const [method, setMethod] = useState<MeasurementMethod>('user_reported');
  const [granularity, setGranularity] = useState<Granularity>(
    initialMetric === 'steps_daily'
      ? 'daily_total'
      : initialMetric === 'sleep_duration'
        ? 'session_total'
        : 'instant',
  );
  const [review, setReview] = useState(false);
  const [stage, setStage] = useState<
    { kind: 'editing' } | { kind: 'confirming'; request: AddMeasurement }
  >({ kind: 'editing' });
  const [error, setError] = useState('');
  const confirmButton = useRef<HTMLButtonElement>(null);
  const valueField = useRef<HTMLInputElement>(null);
  const previousStage = useRef(stage.kind);
  useEffect(() => {
    if (stage.kind === 'confirming') confirmButton.current?.focus();
    else if (previousStage.current === 'confirming')
      valueField.current?.focus();
    previousStage.current = stage.kind;
  }, [stage.kind]);
  const locked = busy || stage.kind === 'confirming';
  function changeMetric(next: MetricKey) {
    setMetric(next);
    setUnit(measurementRegistry[next].units[0]);
    setGranularity(
      next === 'steps_daily'
        ? 'daily_total'
        : next === 'sleep_duration'
          ? 'session_total'
          : 'instant',
    );
  }
  function preview(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const parsed = AddMeasurementSchema.safeParse({
      action: 'add_measurement',
      client_request_id: crypto.randomUUID(),
      source:
        source === 'new'
          ? {
              kind: 'new',
              label,
              origin_app: app.trim() || null,
              device_label: device.trim() || null,
            }
          : { kind: 'existing', id: source },
      observation: {
        metric,
        value,
        unit,
        observed_at: observed,
        timezone: zone,
        local_date: date || null,
        granularity,
        method,
        quality_flags: review ? ['review_requested'] : [],
      },
    });
    if (!parsed.success) {
      setError(
        'Check every field, including the source, decimal value and IANA timezone.',
      );
      return;
    }
    setStage({ kind: 'confirming', request: parsed.data });
  }
  async function confirm() {
    if (stage.kind !== 'confirming') return;
    setError('');
    try {
      await save(stage.request);
      setStage({ kind: 'editing' });
      setValue('');
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : 'The reading could not be saved.',
      );
    }
  }
  return (
    <section className="data-panel">
      <h2>Manual measurement</h2>
      <p>
        Enter and review a numeric observation. Vulpes does not validate a
        reading as medically normal.
      </p>
      <form className="settings-form data-form" onSubmit={preview}>
        <label htmlFor="entry-source">Entry source</label>
        <select
          id="entry-source"
          value={source}
          disabled={locked}
          onChange={(event) => setSource(event.target.value)}
        >
          <option value="new">New source</option>
          {sources.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label} · {item.deviceLabel ?? item.kind}
            </option>
          ))}
        </select>
        {source === 'new' && (
          <>
            <label>
              Source label
              <input
                required
                maxLength={200}
                value={label}
                disabled={locked}
                onChange={(event) => setLabel(event.target.value)}
              />
            </label>
            <label>
              Origin app (optional)
              <input
                maxLength={200}
                value={app}
                disabled={locked}
                onChange={(event) => setApp(event.target.value)}
              />
            </label>
            <label>
              Device label (optional)
              <input
                maxLength={200}
                value={device}
                disabled={locked}
                onChange={(event) => setDevice(event.target.value)}
              />
            </label>
          </>
        )}
        <label htmlFor="entry-metric">Entry metric</label>
        <select
          id="entry-metric"
          value={metric}
          disabled={locked}
          onChange={(event) => changeMetric(event.target.value as MetricKey)}
        >
          {Object.entries(measurementRegistry).map(([key, item]) => (
            <option key={key} value={key}>
              {item.label}
            </option>
          ))}
        </select>
        <label>
          Value
          <input
            ref={valueField}
            required
            inputMode="decimal"
            maxLength={1024}
            value={value}
            disabled={locked}
            onChange={(event) => setValue(event.target.value)}
          />
        </label>
        <label htmlFor="entry-unit">Entry unit</label>
        <select
          id="entry-unit"
          value={unit}
          disabled={locked}
          onChange={(event) => setUnit(event.target.value)}
        >
          {measurementRegistry[metric].units.map((item) => (
            <option key={item}>{item}</option>
          ))}
        </select>
        <label>
          Observation date/time
          <input
            required
            maxLength={100}
            value={observed}
            disabled={locked}
            aria-describedby="entry-time-hint"
            onChange={(event) => setObserved(event.target.value)}
          />
        </label>
        <p id="entry-time-hint" className="field-hint">
          ISO date/time, for example 2026-09-08T08:00:00-04:00. Local times use
          the entry timezone; ambiguous or nonexistent times require correction.
        </p>
        <label>
          Entry timezone
          <input
            required
            value={zone}
            maxLength={100}
            disabled={locked}
            onChange={(event) => setZone(event.target.value)}
          />
        </label>
        <label htmlFor="entry-granularity">Entry granularity</label>
        <select
          id="entry-granularity"
          value={granularity}
          disabled={locked}
          onChange={(event) =>
            setGranularity(event.target.value as Granularity)
          }
        >
          <option value="instant">Instant reading</option>
          <option value="daily_total">Daily total</option>
          <option value="session_total">Session total</option>
        </select>
        <label>
          Declared local date
          <input
            type="date"
            required={granularity === 'daily_total'}
            value={date}
            disabled={locked}
            onChange={(event) => setDate(event.target.value)}
          />
        </label>
        <label htmlFor="entry-method">Entry method</label>
        <select
          id="entry-method"
          value={method}
          disabled={locked}
          onChange={(event) =>
            setMethod(event.target.value as MeasurementMethod)
          }
        >
          <option value="user_reported">User reported</option>
          <option value="device_reported">Device reported</option>
          <option value="device_estimate">Device estimate</option>
          <option value="unknown">Unknown</option>
        </select>
        <label className="data-checkbox">
          <input
            type="checkbox"
            checked={review}
            disabled={locked}
            onChange={(event) => setReview(event.target.checked)}
          />
          Flag this reading for review
        </label>
        {stage.kind === 'editing' && (
          <Button type="submit" disabled={busy}>
            Review measurement
          </Button>
        )}
      </form>
      {stage.kind === 'confirming' && (
        <div
          className="data-confirm"
          role="region"
          aria-label="Confirm measurement"
        >
          <h3>Confirm measurement</h3>
          <p>
            {measurementRegistry[stage.request.observation.metric].label}:{' '}
            {stage.request.observation.value} {stage.request.observation.unit}
          </p>
          <p>
            {stage.request.observation.observed_at} ·{' '}
            {stage.request.observation.timezone} ·{' '}
            {stage.request.observation.method}
          </p>
          <p>
            Source:{' '}
            {stage.request.source.kind === 'new'
              ? stage.request.source.label
              : sources.find((item) => item.id === source)?.label}
            . No unusual value will be silently changed.
          </p>
          <div className="data-actions">
            <Button
              ref={confirmButton}
              type="button"
              disabled={busy}
              onClick={() => void confirm()}
            >
              {busy ? 'Saving…' : 'Confirm and save'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => {
                setStage({ kind: 'editing' });
                setError('');
              }}
            >
              Back to editing
            </Button>
          </div>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

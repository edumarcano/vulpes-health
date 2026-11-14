import { useEffect, useRef, useState, type SubmitEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { ownedJson } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-context';
import { successEnvelopeSchema } from '../../../shared/api';
import {
  EventDetailSchema,
  EventMutationSchema,
  EventMutationResultSchema,
  type EventDetail,
} from '../../../shared/events';
import { measurementRegistry } from '../../../shared/data';
import type { z } from 'zod';

export function EventEditor({
  eventId,
  onClose,
  onSaved,
}: {
  eventId: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}) {
  const { state, scope } = useAuth();
  const session = state.kind === 'signed_in' ? state.session : null;
  const epoch = scope.epoch;
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);
  const detail = useQuery({
    queryKey: ['data', session?.user.id, epoch, 'event', eventId],
    enabled: !!session,
    retry: false,
    queryFn: async ({ signal }) =>
      successEnvelopeSchema(EventDetailSchema).parse(
        await ownedJson(
          '/api/data?' +
            new URLSearchParams({ view: 'event', event_id: eventId }),
          session!.access_token,
          scope,
          epoch,
          { signal },
        ),
      ).data,
  });
  return (
    <section aria-label="Weigh-in detail" className="min-w-0 break-words">
      <h3 ref={heading} tabIndex={-1}>
        Weigh-in detail
      </h3>
      {detail.isError ? (
        <p role="alert">Weigh-in unavailable. Close and refresh the data.</p>
      ) : detail.data ? (
        <EventFields
          key={detail.data.event.version}
          detail={detail.data}
          save={async (request) => {
            const result = successEnvelopeSchema(
              EventMutationResultSchema,
            ).parse(
              await ownedJson(
                '/api/data',
                session!.access_token,
                scope,
                epoch,
                { method: 'POST', body: JSON.stringify(request) },
              ),
            ).data;
            scope.commit(epoch, () => {
              onSaved(
                `Weigh-in updated: ${result.observations} observations affected. Private copies removed; approved targets and accounting retained.`,
              );
              onClose();
            });
          }}
        />
      ) : (
        <p role="status">Loading weigh-in…</p>
      )}
      <Button variant="outline" onClick={onClose}>
        Close weigh-in
      </Button>
    </section>
  );
}

function EventFields({
  detail,
  save,
}: {
  detail: EventDetail;
  save: (request: z.infer<typeof EventMutationSchema>) => Promise<void>;
}) {
  const e = detail.event;
  const [time, setTime] = useState(e.observed_at),
    [zone, setZone] = useState(e.timezone);
  const [annotations, setAnnotations] = useState(e.annotations);
  const [stage, setStage] = useState<
    | { kind: 'editing' }
    | {
        kind: 'review' | 'saving';
        request: z.infer<typeof EventMutationSchema>;
      }
  >({ kind: 'editing' });
  const [error, setError] = useState('');
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    if (stage.kind === 'review') reviewHeading.current?.focus();
  }, [stage.kind]);
  function review(
    action: 'correct_event_time' | 'update_event_annotations' | 'delete_event',
  ) {
    const parsed = EventMutationSchema.safeParse({
      action,
      event_id: e.id,
      expected_version: e.version,
      client_request_id: crypto.randomUUID(),
      ...(action === 'correct_event_time'
        ? { changes: { observed_at: time, timezone: zone } }
        : action === 'update_event_annotations'
          ? { changes: annotations }
          : {}),
    });
    if (!parsed.success) {
      setError('Check the time, IANA timezone and annotation limits.');
      return;
    }
    setError('');
    setStage({ kind: 'review', request: parsed.data });
  }
  async function confirm(event: SubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    if (stage.kind !== 'review') return;
    const request = stage.request;
    setStage({ kind: 'saving', request });
    try {
      await save(request);
    } catch (e) {
      setStage({ kind: 'review', request });
      setError(
        e instanceof Error
          ? e.message
          : 'Save not confirmed. Retry the same change or refresh the weigh-in.',
      );
    }
  }
  return (
    <>
      <p>
        Source-local: {e.source_local_time}; {e.source_timezone}; offset{' '}
        {e.source_offset_minutes} minutes. Original instant:{' '}
        {e.source_observed_at}. Effective instant: {e.observed_at}. Version{' '}
        {e.version}.
      </p>
      <p>
        Adapter: {e.adapter_version}. Import batch: {e.import_batch_id}. Source
        row: {e.source_row}; No.: {e.source_row_id ?? 'unavailable'}.
      </p>
      <div
        className="data-table-scroll"
        role="region"
        aria-label="Weigh-in values"
        tabIndex={0}
      >
        <table>
          <caption>Exact imported values</caption>
          <thead>
            <tr>
              <th>Metric</th>
              <th>Original</th>
              <th>Canonical</th>
            </tr>
          </thead>
          <tbody>
            {detail.observations.map((o) => (
              <tr key={o.id}>
                <td>
                  {measurementRegistry[o.metric].label}
                  <p>{measurementRegistry[o.metric].limitation}</p>
                </td>
                <td>
                  {o.originalValue} {o.originalUnit}
                </td>
                <td>
                  {o.canonicalValue} {o.unit}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <fieldset disabled={stage.kind !== 'editing'} className="settings-form">
        <legend>Correct weigh-in</legend>
        <label>
          Whole weigh-in time
          <input
            value={time}
            maxLength={100}
            onChange={(v) => setTime(v.target.value)}
          />
        </label>
        <label>
          Whole weigh-in timezone
          <input
            value={zone}
            maxLength={100}
            onChange={(v) => setZone(v.target.value)}
          />
        </label>
        <p>
          Use ISO time. Ambiguous local time requires an explicit offset. All
          linked readings move together; imported interpretation stays in
          provenance.
        </p>
        <Button onClick={() => review('correct_event_time')}>
          Review weigh-in time
        </Button>
        {(['weight_level', 'body_type', 'remarks'] as const).map((key) => (
          <label key={key}>
            {key.replaceAll('_', ' ')}
            <textarea
              aria-label={key.replaceAll('_', ' ')}
              value={annotations[key] ?? ''}
              onChange={(v) =>
                setAnnotations({ ...annotations, [key]: v.target.value })
              }
            />
          </label>
        ))}
        <p>
          Labels: 200 characters. Remarks: 4,096 UTF-8 bytes. Empty text clears
          an annotation.
        </p>
        <Button onClick={() => review('update_event_annotations')}>
          Review annotations
        </Button>
        <Button variant="outline" onClick={() => review('delete_event')}>
          Review delete whole weigh-in
        </Button>
      </fieldset>
      {stage.kind !== 'editing' && (
        <form onSubmit={confirm}>
          <h4 ref={reviewHeading} tabIndex={-1}>
            Review weigh-in change
          </h4>
          <p>
            {stage.request.action === 'delete_event'
              ? `Delete this weigh-in and all ${detail.observations.length} linked readings?`
              : stage.request.action === 'correct_event_time'
                ? `Move all readings to ${time} in ${zone}?`
                : 'Replace the annotations with the text shown above?'}
          </p>
          <p>
            Affected private baseline values and retained conversation copies
            are removed. Approved targets, states and accounting remain.
          </p>
          <Button type="submit" disabled={stage.kind === 'saving'}>
            Confirm weigh-in change
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={stage.kind === 'saving'}
            onClick={() => setStage({ kind: 'editing' })}
          >
            Back to weigh-in
          </Button>
        </form>
      )}
      {error && <p role="alert">{error}</p>}
    </>
  );
}

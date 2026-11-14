import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';
import {
  EventDetailSchema,
  EventSchema,
  EventMutationResultSchema,
  type EventMutationSchema,
  type EventReadSchema,
  type SourceDefaultsMutationSchema,
} from '../../shared/events.js';
import { CountSchema, UUIDSchema } from '../../shared/primitives.js';
import type { AuthContext } from '../auth/session.js';
import type { Json } from '../db/database.types.js';
import {
  measurementDTO,
  type StoredObservation,
} from '../analytics/measurements.js';
import { selectionWindows } from '../analytics/summary.js';
import { HttpFailure } from '../http/failure.js';

function failure(message: string): never {
  if (message === 'data_not_found')
    throw new HttpFailure(
      404,
      'not_found',
      'The owned source or weigh-in was not found.',
    );
  if (message === 'data_conflict')
    throw new HttpFailure(
      409,
      'data_conflict',
      'The weigh-in or source changed. Refresh and review.',
    );
  if (message === 'invalid_measurement' || message === 'invalid_import')
    throw new HttpFailure(
      400,
      'invalid_input',
      'Check the event time, annotations or source settings.',
    );
  throw new HttpFailure(
    503,
    'data_unavailable',
    'The weigh-in operation could not be verified.',
  );
}
export async function readEvents(
  context: AuthContext,
  query: z.infer<typeof EventReadSchema>,
) {
  if (query.view === 'events') {
    try {
      selectionWindows({
        metric: 'weight',
        source_id: query.source_id,
        from: query.from,
        to: query.to,
        timezone: query.timezone,
        method: 'device_reported',
        granularity: 'instant',
      });
    } catch {
      throw new HttpFailure(
        400,
        'invalid_interval',
        'Select 1–366 complete local days.',
      );
    }
    const result = await context.db.rpc('read_events_v2', {
      p_source: query.source_id,
      p_from: query.from,
      p_to: query.to,
      p_limit: query.page_size,
      ...(query.cursor ? { p_after: query.cursor } : {}),
      ...(query.data_revision === undefined
        ? {}
        : { p_revision: query.data_revision }),
    });
    if (result.error) failure(result.error.message);
    return z
      .strictObject({
        items: z.array(EventSchema).max(200),
        nextCursor: UUIDSchema.nullable(),
        dataRevision: CountSchema,
      })
      .parse(result.data);
  }
  const result = await context.db.rpc('read_event_v2', {
    p_event: query.event_id,
  });
  if (result.error) failure(result.error.message);
  const data = z
    .object({
      event: EventSchema,
      observations: z.array(z.record(z.string(), z.unknown())).max(24),
      dataRevision: CountSchema,
    })
    .parse(result.data);
  const rows = data.observations as Array<
    StoredObservation & { provenance: Record<string, unknown> }
  >;
  return EventDetailSchema.parse({
    ...data,
    observations: rows.map(measurementDTO),
    provenance: Object.fromEntries(rows.map((row) => [row.id, row.provenance])),
  });
}
export async function mutateEvent(
  context: AuthContext,
  request: z.infer<typeof EventMutationSchema>,
) {
  let changes: Json | undefined =
    'changes' in request ? request.changes : undefined;
  if (request.action === 'correct_event_time') {
    try {
      const value = request.changes.observed_at;
      if (
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::[0-5]\d(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:\d{2})?$/.test(
          value,
        )
      )
        throw new Error();
      const zoned = /(?:Z|[+-]\d{2}:\d{2})$/.test(value)
        ? Temporal.Instant.from(value).toZonedDateTimeISO(
            request.changes.timezone,
          )
        : Temporal.PlainDateTime.from(value, {
            overflow: 'reject',
          }).toZonedDateTime(request.changes.timezone, {
            disambiguation: 'reject',
          });
      if (zoned.offsetNanoseconds % 60_000_000_000 !== 0) throw new Error();
      changes = {
        observed_at: zoned.toInstant().toString(),
        timezone: request.changes.timezone,
        offset_minutes: zoned.offsetNanoseconds / 60_000_000_000,
      };
    } catch {
      throw new HttpFailure(
        400,
        'invalid_time',
        'Choose a valid time and timezone. Ambiguous/nonexistent local times require an explicit offset.',
      );
    }
  }
  const result = await context.db.rpc('mutate_event_v2', {
    p_request: {
      ...request,
      ...(changes === undefined ? {} : { changes }),
      schema_version: 2,
    },
  });
  if (result.error) failure(result.error.message);
  return EventMutationResultSchema.parse(result.data);
}
export async function updateSourceDefaults(
  context: AuthContext,
  request: z.infer<typeof SourceDefaultsMutationSchema>,
) {
  const result = await context.db.rpc('update_source_defaults_v2', {
    p_request: { ...request, schema_version: 2 },
  });
  if (result.error) failure(result.error.message);
  return z
    .strictObject({
      source_id: UUIDSchema,
      settings_version: CountSchema,
      dataRevision: CountSchema,
    })
    .parse(result.data);
}

import { z } from 'zod';
import { ImportMappingSchema } from './imports.js';
import { MeasurementDTOSchema } from './domain.js';
import {
  CountSchema,
  IanaTimezoneSchema,
  ISOInstantSchema,
  UUIDSchema,
  VersionSchema,
  isPrivatePlainText,
} from './primitives.js';

const privateText = z
  .string()
  .refine(isPrivatePlainText, 'Use valid plain text without NUL.');
export const EventAnnotationsSchema = z.strictObject({
  weight_level: privateText
    .refine((value) => [...value].length <= 200)
    .optional(),
  body_type: privateText.refine((value) => [...value].length <= 200).optional(),
  remarks: privateText
    .refine((value) => new TextEncoder().encode(value).length <= 4096)
    .optional(),
});
export const EventSchema = z.strictObject({
  id: UUIDSchema,
  source_id: UUIDSchema,
  import_batch_id: UUIDSchema,
  adapter_version: z.literal('renpho-en-body-composition-v1'),
  source_local_time: z.string(),
  source_observed_at: ISOInstantSchema,
  source_timezone: IanaTimezoneSchema,
  source_offset_minutes: z.number().int().min(-840).max(840),
  observed_at: ISOInstantSchema,
  timezone: IanaTimezoneSchema,
  offset_minutes: z.number().int().min(-840).max(840),
  annotations: EventAnnotationsSchema,
  annotation_provenance: z.record(z.string(), z.unknown()),
  source_row: CountSchema,
  source_row_id: z.string().nullable(),
  version: VersionSchema,
  created_at: ISOInstantSchema,
});
export const EventDetailSchema = z.strictObject({
  event: EventSchema,
  observations: z.array(MeasurementDTOSchema).min(1).max(24),
  provenance: z.record(z.string(), z.record(z.string(), z.unknown())),
  dataRevision: CountSchema,
});
export type EventDetail = z.infer<typeof EventDetailSchema>;
export const EventReadSchema = z.discriminatedUnion('view', [
  z.strictObject({ view: z.literal('event'), event_id: UUIDSchema }),
  z.strictObject({
    view: z.literal('events'),
    source_id: UUIDSchema,
    from: ISOInstantSchema,
    to: ISOInstantSchema,
    timezone: IanaTimezoneSchema,
    page_size: VersionSchema.max(200).default(100),
    cursor: UUIDSchema.optional(),
    data_revision: CountSchema.optional(),
  }),
]);
const target = {
  event_id: UUIDSchema,
  expected_version: VersionSchema,
  client_request_id: UUIDSchema,
};
export const EventMutationSchema = z.discriminatedUnion('action', [
  z.strictObject({ ...target, action: z.literal('delete_event') }),
  z.strictObject({
    ...target,
    action: z.literal('update_event_annotations'),
    changes: EventAnnotationsSchema,
  }),
  z.strictObject({
    ...target,
    action: z.literal('correct_event_time'),
    changes: z.strictObject({
      observed_at: z.string().min(1).max(100),
      timezone: IanaTimezoneSchema,
    }),
  }),
]);
export const EventMutationResultSchema = z.strictObject({
  id: UUIDSchema,
  sourceId: UUIDSchema,
  outcome: z.enum([
    'delete_event',
    'update_event_annotations',
    'correct_event_time',
  ]),
  version: VersionSchema,
  dataRevision: CountSchema,
  observations: CountSchema,
  baselinesMarked: CountSchema,
  previewsInvalidated: CountSchema,
  tracePayloadsRemoved: CountSchema,
});
export const SourceDefaultsMutationSchema = z.strictObject({
  action: z.literal('update_source_defaults'),
  source_id: UUIDSchema,
  expected_version: VersionSchema,
  client_request_id: UUIDSchema,
  mapping: ImportMappingSchema,
});

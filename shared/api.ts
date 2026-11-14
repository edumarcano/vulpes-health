import { GoalMutationSchema } from './goals.js';
import { z } from 'zod';
import { SettingsPatchSchema } from './auth.js';
import { LegacyMetricKeySchema } from './metrics.js';
import {
  AddMeasurementSchema,
  CorrectMeasurementSchema,
  DeleteMeasurementSchema,
  DataQuerySchema,
} from './data.js';
import {
  PreviewCsvWireSchema,
  ReviewImportSchema,
  DiscardImportSchema,
  ImportReadSchema,
} from './import-v2.js';
import {
  EventReadSchema,
  EventMutationSchema,
  SourceDefaultsMutationSchema,
} from './events.js';
import {
  AnalysisDepthSchema,
  HashSchema,
  IanaTimezoneSchema,
  ISOInstantSchema,
  UUIDSchema,
  VersionSchema,
} from './primitives.js';
import { InspectionQuerySchema } from './inspection.js';

export const API_JSON_LIMIT_BYTES = 2 * 1024 * 1024;
export function successEnvelopeSchema<T extends z.ZodType>(data: T) {
  return z.strictObject({ data, request_id: UUIDSchema });
}
export const ErrorEnvelopeSchema = z.strictObject({
  error: z.strictObject({
    code: z.string().min(1),
    message: z.string().min(1),
    retryable: z.boolean(),
  }),
  request_id: UUIDSchema,
});
export const LivenessResponseSchema = successEnvelopeSchema(
  z.strictObject({ status: z.literal('ok') }),
);
export type LivenessResponse = z.infer<typeof LivenessResponseSchema>;
export type ErrorEnvelope = z.infer<typeof ErrorEnvelopeSchema>;
export const ChatSendRequestSchema = z.strictObject({
  action: z.literal('send'),
  client_request_id: UUIDSchema,
  conversation_id: UUIDSchema,
  message: z.strictObject({
    id: UUIDSchema,
    text: z
      .string()
      .max(16000)
      .refine((text) => /\S/.test(text), 'Expected nonblank text.'),
  }),
  depth: AnalysisDepthSchema,
  context_selection: z
    .strictObject({
      metric: LegacyMetricKeySchema,
      source_id: UUIDSchema.nullable(),
      goal_id: UUIDSchema.nullable(),
      from: ISOInstantSchema,
      to: ISOInstantSchema,
      timezone: IanaTimezoneSchema,
    })
    .refine(
      (value) => Date.parse(value.from) < Date.parse(value.to),
      'Expected a nonempty half-open interval.',
    )
    .nullish()
    .transform((value) => value ?? null),
});
export const ApprovalRequestSchema = z.strictObject({
  action: z.enum(['approve', 'reject']),
  proposal_id: UUIDSchema,
  payload_hash: HashSchema,
  expected_version: VersionSchema.nullable(),
  client_request_id: UUIDSchema,
});
export const ImportCommitRequestSchema = z.strictObject({
  schema_version: z.literal(2),
  action: z.literal('commit_import'),
  batch_id: UUIDSchema,
  payload_hash: HashSchema,
  client_request_id: UUIDSchema,
});
export type ChatSendRequest = z.infer<typeof ChatSendRequestSchema>;
export type ApprovalRequest = z.infer<typeof ApprovalRequestSchema>;
export type ImportCommitRequest = z.infer<typeof ImportCommitRequestSchema>;

interface Operation {
  method: 'GET' | 'POST' | 'PATCH';
  selector: 'default' | `action=${string}` | `view=${string}`;
  owningPR: number;
  schema?: z.ZodType;
}
// Contract inventory, not deployed routes. GET defaults are descriptive labels, not new wire parameters.
export const apiOperations = {
  '/api/status': [
    {
      method: 'GET',
      selector: 'default',
      owningPR: 1,
      schema: z.strictObject({}),
    },
  ],
  '/api/conversations': [
    { method: 'GET', selector: 'default', owningPR: 9 },
    { method: 'GET', selector: 'view=messages', owningPR: 9 },
    ...['create', 'archive', 'delete'].map((action) => ({
      method: 'POST' as const,
      selector: `action=${action}` as const,
      owningPR: 9,
    })),
  ],
  '/api/chat': [
    {
      method: 'POST',
      selector: 'action=send',
      owningPR: 9,
      schema: ChatSendRequestSchema,
    },
    { method: 'POST', selector: 'action=cancel', owningPR: 9 },
  ],
  '/api/data': [
    ...['import_status', 'import_items'].map((view) => ({
      method: 'GET' as const,
      selector: `view=${view}` as const,
      owningPR: 6,
      schema: ImportReadSchema.refine((value) => value.view === view),
    })),
    ...['event', 'events'].map((view) => ({
      method: 'GET' as const,
      selector: `view=${view}` as const,
      owningPR: 7,
      schema: EventReadSchema.refine((value) => value.view === view),
    })),
    {
      method: 'POST',
      selector: 'action=review_import',
      owningPR: 6,
      schema: ReviewImportSchema,
    },
    {
      method: 'POST',
      selector: 'action=discard_import',
      owningPR: 6,
      schema: DiscardImportSchema,
    },
    ...['correct_event_time', 'update_event_annotations', 'delete_event'].map(
      (action) => ({
        method: 'POST' as const,
        selector: `action=${action}` as const,
        owningPR: 7,
        schema: EventMutationSchema.refine((value) => value.action === action),
      }),
    ),
    {
      method: 'POST',
      selector: 'action=update_source_defaults',
      owningPR: 6,
      schema: SourceDefaultsMutationSchema,
    },
    {
      method: 'GET',
      selector: 'view=sources',
      owningPR: 5,
      schema: DataQuerySchema.options[0],
    },
    {
      method: 'GET',
      selector: 'view=measurements',
      owningPR: 5,
      schema: DataQuerySchema.options[1],
    },
    {
      method: 'GET',
      selector: 'view=summary',
      owningPR: 5,
      schema: DataQuerySchema.options[2],
    },
    {
      method: 'GET',
      selector: 'view=export',
      owningPR: 7,
      schema: DataQuerySchema.options[3],
    },
    {
      method: 'POST',
      selector: 'action=preview_csv',
      owningPR: 6,
      schema: PreviewCsvWireSchema,
    },
    {
      method: 'POST',
      selector: 'action=commit_import',
      owningPR: 6,
      schema: ImportCommitRequestSchema,
    },
    {
      method: 'POST',
      selector: 'action=add_measurement',
      owningPR: 5,
      schema: AddMeasurementSchema,
    },
    {
      method: 'POST',
      selector: 'action=correct_measurement',
      owningPR: 7,
      schema: CorrectMeasurementSchema,
    },
    {
      method: 'POST',
      selector: 'action=delete_measurement',
      owningPR: 7,
      schema: DeleteMeasurementSchema,
    },
  ],
  '/api/goals': [
    { method: 'GET', selector: 'default', owningPR: 11 },
    ...['propose_create', 'propose_revision', 'propose_state'].map(
      (action) => ({
        method: 'POST' as const,
        selector: `action=${action}` as const,
        owningPR: 11,
        schema: GoalMutationSchema,
      }),
    ),
  ],
  '/api/approvals': [
    {
      method: 'POST',
      selector: 'action=approve',
      owningPR: 11,
      schema: ApprovalRequestSchema,
    },
    {
      method: 'POST',
      selector: 'action=reject',
      owningPR: 11,
      schema: ApprovalRequestSchema,
    },
  ],
  '/api/settings': [
    {
      method: 'GET',
      selector: 'default',
      owningPR: 4,
      schema: z.strictObject({}),
    },
    {
      method: 'PATCH',
      selector: 'default',
      owningPR: 4,
      schema: SettingsPatchSchema,
    },
  ],
  '/api/executions': [
    {
      method: 'GET',
      selector: 'default',
      owningPR: 10,
      schema: InspectionQuerySchema.refine(
        (value) => value.view === 'overview',
      ),
    },
    {
      method: 'GET',
      selector: 'view=payload',
      owningPR: 10,
      schema: InspectionQuerySchema.refine((value) => value.view === 'payload'),
    },
    {
      method: 'GET',
      selector: 'view=export',
      owningPR: 10,
      schema: InspectionQuerySchema.refine((value) => value.view === 'export'),
    },
  ],
  '/api/account': [
    { method: 'POST', selector: 'action=export', owningPR: 16 },
    { method: 'POST', selector: 'action=delete', owningPR: 16 },
  ],
} as const satisfies Record<string, readonly Operation[]>;

export type OperationValidation =
  | { kind: 'validated'; value: unknown }
  | { kind: 'invalid' }
  | { kind: 'not_implemented'; owningPR: number };
export function validateOperation(
  route: string,
  method: string,
  selector: string,
  input: unknown,
): OperationValidation {
  if (!Object.hasOwn(apiOperations, route)) return { kind: 'invalid' };
  const operations: readonly Operation[] =
    apiOperations[route as keyof typeof apiOperations];
  const operation = operations.find(
    (entry) => entry.method === method && entry.selector === selector,
  );
  if (!operation) return { kind: 'invalid' };
  if (!operation.schema)
    return { kind: 'not_implemented', owningPR: operation.owningPR };
  const result = operation.schema.safeParse(input);
  if (!result.success) return { kind: 'invalid' };
  if (
    selector.startsWith('action=') &&
    (result.data as { action: string }).action !== selector.slice(7)
  )
    return { kind: 'invalid' };
  return { kind: 'validated', value: result.data };
}

import { z } from 'zod';

export const DeletionPhaseSchema = z.enum(['fenced','private_content_purged','awaiting_settlement','app_data_purged','auth_removal_pending','completed']);
export const AccountStatusSchema = z.discriminatedUnion('state',[
  z.strictObject({state:z.literal('active')}),
  z.strictObject({state:z.literal('deleting'),receiptId:z.uuid(),phase:DeletionPhaseSchema,requestedAt:z.iso.datetime({offset:true}),updatedAt:z.iso.datetime({offset:true}),retryAfter:z.iso.datetime({offset:true}).nullable(),outcome:z.enum(['in_progress','waiting_for_accounting','auth_unavailable','completed'])}),
]);
export type AccountStatus = z.infer<typeof AccountStatusSchema>;
export const AccountRequestSchema = z.discriminatedUnion('action',[
  z.strictObject({action:z.literal('export'),trace_parts:z.array(z.enum(['input','output','context','usage'])).max(4).refine(parts=>new Set(parts).size===parts.length),sensitive_content_acknowledged:z.boolean()}).refine(value=>value.trace_parts.length===0 || value.sensitive_content_acknowledged,'Acknowledge sensitive trace content.'),
  z.strictObject({action:z.literal('delete'),confirmation:z.literal('DELETE MY VULPES ACCOUNT')}),
  z.strictObject({action:z.literal('continue_delete')}),
]);
export type AccountRequest = z.infer<typeof AccountRequestSchema>;

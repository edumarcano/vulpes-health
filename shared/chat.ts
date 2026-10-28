import { z } from 'zod';
import { CountSchema, ISOInstantSchema, PageSizeSchema, UUIDSchema } from './primitives.js';
import { RunSummarySchema } from './executions.js';
import { DataSummarySchema } from './data.js';
import { GoalProposalReferenceSchema } from './goals.js';
import { GoalProgressResultSchema } from './goal-progress.js';

export const EvidenceSchema = z.strictObject({ version:z.literal(1),ownerId:UUIDSchema,runId:UUIDSchema,stepId:UUIDSchema,resultId:UUIDSchema,dataRevision:CountSchema });
export const ChatPartSchema = z.discriminatedUnion('type',[
  z.strictObject({type:z.literal('text'),text:z.string().max(65536)}),
  z.strictObject({type:z.literal('metric_summary'),evidence:EvidenceSchema,result:DataSummarySchema}),
  z.strictObject({type:z.literal('goal_proposal'),reference:GoalProposalReferenceSchema}),
  z.strictObject({type:z.literal('goal_progress'),evidence:EvidenceSchema,goalId:UUIDSchema,result:GoalProgressResultSchema}),
]);
export const ChatMessageSchema = z.strictObject({id:UUIDSchema,role:z.enum(['user','assistant']),parts:z.array(ChatPartSchema),runId:UUIDSchema.nullable(),status:z.enum(['streaming','completed','interrupted','failed']),contextState:z.enum(['eligible','source_removed']),createdAt:ISOInstantSchema});
export const ConversationSchema = z.strictObject({id:UUIDSchema,title:z.string().min(1).max(200),archived:z.boolean(),createdAt:ISOInstantSchema,updatedAt:ISOInstantSchema});
export const ConversationsPageSchema = z.strictObject({items:z.array(ConversationSchema).max(200),nextCursor:z.string().nullable(),availability:z.enum(['unavailable','synthetic'])});
export const MessagesPageSchema = z.strictObject({conversation:ConversationSchema,items:z.array(ChatMessageSchema).max(200),nextCursor:z.string().nullable(),run:RunSummarySchema.nullable()});
const mutation = {client_request_id:UUIDSchema};
export const ConversationMutationSchema = z.discriminatedUnion('action',[
  z.strictObject({...mutation,action:z.literal('create'),id:UUIDSchema}),
  z.strictObject({...mutation,action:z.literal('archive'),id:UUIDSchema}),
  z.strictObject({...mutation,action:z.literal('delete'),id:UUIDSchema,confirm:z.literal(true)}),
]);
export const ConversationQuerySchema = z.discriminatedUnion('view',[
  z.strictObject({view:z.literal('list').default('list'),page_size:PageSizeSchema.default(50),cursor:z.string().max(4096).optional(),archived:z.enum(['true','false']).default('false')}),
  z.strictObject({view:z.literal('messages'),id:UUIDSchema,page_size:PageSizeSchema.default(100),cursor:z.string().max(4096).optional()}),
]);
export const CancelRequestSchema = z.strictObject({action:z.literal('cancel'),run_id:UUIDSchema,client_request_id:UUIDSchema});
export type ChatMessage = z.infer<typeof ChatMessageSchema>;
export type ChatPart = z.infer<typeof ChatPartSchema>;
export type MessagesPage = z.infer<typeof MessagesPageSchema>;
export type ConversationMutation = z.infer<typeof ConversationMutationSchema>;
export type ConversationQuery = z.infer<typeof ConversationQuerySchema>;

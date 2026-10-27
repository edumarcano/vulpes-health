import { z } from 'zod';
import { AnalysisDepthSchema,CountSchema, DecimalUSDSchema, HashSchema, ISOInstantSchema, UUIDSchema } from './primitives.js';

export const RunStateSchema = z.enum(['admitted', 'running', 'cancellation_requested', 'completed', 'failed', 'cancelled', 'interrupted']);
export const TerminalRunStateSchema = RunStateSchema.extract(['completed', 'failed', 'cancelled', 'interrupted']);
export const TraceStateSchema = z.enum(['available', 'expired', 'removed', 'incomplete', 'unavailable']);
export const RunSummarySchema = z.strictObject({
  id: UUIDSchema, conversationId: UUIDSchema.nullable(), state: RunStateSchema,
  assistantMessageId:UUIDSchema.nullable(),requestedDepth:AnalysisDepthSchema,
  route:z.strictObject({role:z.enum(['everyday','intermediate','advanced']),provider:z.enum(['openrouter','vertex_ai']),model:z.string(),effort:z.string().nullable()}).nullable(),
  admittedAt: ISOInstantSchema, deadlineAt: ISOInstantSchema, finishedAt: ISOInstantSchema.nullable(),
  accountingPeriod: z.iso.date(), traceState: TraceStateSchema, partialOutput: z.boolean(),
  costUSD: DecimalUSDSchema.nullable(), knownCostUSD: DecimalUSDSchema, reservationUSD: DecimalUSDSchema,
  costStatus: z.enum(['reported', 'estimated', 'pending', 'conservative']),
});
export const AdmissionResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('admitted'), run: RunSummarySchema }),
  z.strictObject({ kind: z.literal('existing'), run: RunSummarySchema }),
  z.strictObject({ kind: z.literal('busy'), run: RunSummarySchema }),
  z.strictObject({ kind:z.literal('retained'),conversationId:UUIDSchema,message:z.strictObject({id:UUIDSchema,status:z.literal('completed')}) }),
]);
export const BudgetStateSchema = z.strictObject({
  periodStart: z.iso.date(), resetsAt: ISOInstantSchema, allocationUSD: DecimalUSDSchema.nullable(),
  preferenceUSD: DecimalUSDSchema.nullable(), spentUSD: DecimalUSDSchema, reservedUSD: DecimalUSDSchema,
  availableUSD: DecimalUSDSchema.nullable(), state: z.enum(['configured', 'unconfigured']),
});
export const StepEvidenceSchema = z.strictObject({
  version: CountSchema, hash: HashSchema, source: z.enum(['reported', 'estimated', 'conservative', 'not_sent', 'pending']),
  costUSD: DecimalUSDSchema.nullable(),
});
export type RunSummary = z.infer<typeof RunSummarySchema>;
export type AdmissionResult = z.infer<typeof AdmissionResultSchema>;
export type TerminalRunState = z.infer<typeof TerminalRunStateSchema>;
export type BudgetState = z.infer<typeof BudgetStateSchema>;

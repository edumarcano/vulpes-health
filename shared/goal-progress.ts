import { z } from 'zod';
import { DataSelectionSchema, DataSummarySchema } from './data.js';
import { CountSchema, UUIDSchema, VersionSchema } from './primitives.js';

export const GoalCalculationSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('directional'),rawPercent:z.number().finite(),displayPercent:z.number().min(0).max(100)}),
  z.strictObject({kind:z.enum(['below_range','above_range','within_range'])}),
  z.strictObject({kind:z.literal('undefined'),reason:z.enum(['zero_denominator','unrepresentable_result'])}),
]);
export const GoalProgressResultSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('unavailable'),reason:z.enum(['unsupported_baseline','needs_review','unsupported_revision'])}),
  z.strictObject({kind:z.literal('insufficient_data'),coverage:DataSummarySchema.optional()}),
  z.strictObject({kind:z.literal('progress'),goalId:UUIDSchema.optional(),goalVersion:VersionSchema.optional(),revision:CountSchema.optional(),baseline:z.string(),current:z.string(),coverage:DataSummarySchema.optional(),selection:DataSelectionSchema.optional(),dataRevision:CountSchema.optional(),result:GoalCalculationSchema}),
]);

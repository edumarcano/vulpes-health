import { z } from 'zod';
import { GoalStateSchema } from './domain.js';
import { DataSummarySchema, MeasurementsPageSchema } from './data.js';
import { GoalProgressResultSchema } from './goal-progress.js';
import {
  UUIDSchema,
  VersionSchema,
  HashSchema,
  ISOInstantSchema,
} from './primitives.js';

// Read views validate consumed fields while allowing historical JSON payloads.
export const GoalRowSchema = z.object({
  id: UUIDSchema,
  title: z.string(),
  state: GoalStateSchema,
  review_status: z.enum(['clear', 'needs_review']),
  version: VersionSchema,
  direction: z.enum(['increase_to', 'decrease_to', 'maintain_range']),
  canonical_unit: z.string(),
  target_value: z.number().nullable(),
  target_lower: z.number().nullable(),
  target_upper: z.number().nullable(),
  source_policy: z.record(z.string(), z.json()),
});
export const GoalRevisionRowSchema = z.object({
  id: UUIDSchema,
  revision_number: VersionSchema,
  approved_at: ISOInstantSchema,
  payload: z.json(),
});
export const GoalProposalRowSchema = z.object({
  id: UUIDSchema,
  state: z.enum(['pending', 'approved', 'rejected', 'expired', 'conflicted']),
  summary: z.string(),
  expires_at: ISOInstantSchema,
  target_id: UUIDSchema.nullable(),
  target_version: VersionSchema.nullable(),
  payload_hash: HashSchema,
  canonical_payload: z.json(),
  result: z.json(),
});
function page<T extends z.ZodType>(row: T) {
  return z.object({
    items: z.array(row).max(200),
    nextCursor: UUIDSchema.nullable(),
  });
}
export const GoalsPageSchema = page(GoalRowSchema);
export const GoalProposalsPageSchema = page(GoalProposalRowSchema);
export const GoalRevisionsPageSchema = page(GoalRevisionRowSchema);
export const GoalDetailSchema = z.object({
  goal: GoalRowSchema,
  revision: GoalRevisionRowSchema,
  progress: GoalProgressResultSchema,
  chart: z.object({
    summary: DataSummarySchema,
    observations: MeasurementsPageSchema,
  }),
});
export type GoalRow = z.infer<typeof GoalRowSchema>;
export type GoalProposalRow = z.infer<typeof GoalProposalRowSchema>;

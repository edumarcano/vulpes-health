import { z } from 'zod';
import { VulpesCardSchema as LegacyCardSchema } from './domain.js';
import { GoalProposalReferenceSchema } from './goals.js';
import { GoalProgressResultSchema } from './goal-progress.js';
import { UUIDSchema } from './primitives.js';
import { VersionSchema } from './primitives.js';
import { EvidenceSchema } from './chat.js';
import { AnalysisCardSnapshotSchema } from './agent-tools.js';
import { EventAnalysisResultSchema } from './analysis.js';
import {
  GoalGroupProgressSchema,
  GoalGroupProposalReferenceSchema,
} from './goal-groups.js';

export const VulpesCardSchema = z.union([
  LegacyCardSchema,
  z.strictObject({
    type: z.literal('analysis_result'),
    evidence: EvidenceSchema,
    result: z.union([AnalysisCardSnapshotSchema, EventAnalysisResultSchema]),
  }),
  z.strictObject({
    type: z.literal('goal_group_progress'),
    evidence: EvidenceSchema,
    result: GoalGroupProgressSchema,
  }),
  z.strictObject({
    type: z.literal('goal_group_proposal'),
    reference: GoalGroupProposalReferenceSchema,
  }),
  z.strictObject({
    type: z.literal('goal_proposal'),
    reference: GoalProposalReferenceSchema,
  }),
  z.strictObject({
    type: z.literal('goal_progress'),
    evidence: EvidenceSchema.optional(),
    goalId: UUIDSchema,
    goalVersion: VersionSchema.optional(),
    revisionId: UUIDSchema.optional(),
    result: GoalProgressResultSchema,
  }),
]);

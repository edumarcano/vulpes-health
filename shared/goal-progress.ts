import { z } from 'zod';
import { DataSelectionSchema, DataSummarySchema } from './data.js';
import {
  CountSchema,
  UUIDSchema,
  VersionSchema,
  ISOInstantSchema,
} from './primitives.js';

export const GoalFreshnessSchema = z.strictObject({
  policyVersion: z.literal('elapsed_measurement_age_v1'),
  status: z.enum(['dated', 'fresh', 'stale', 'unavailable']),
  maxEvidenceAgeDays: z.number().int().min(1).max(3660).nullable(),
  evaluatedAt: ISOInstantSchema,
  oldestContributingAt: ISOInstantSchema.nullable(),
  ageDays: z.number().finite().nonnegative().nullable(),
});
export const GoalBaselineEvidenceSchema = z.strictObject({
  provenance: z.enum(['calculated', 'user_reported']),
  algorithmVersion: z.string(),
  dataRevision: CountSchema,
  firstMeasuredAt: ISOInstantSchema.nullable(),
  lastMeasuredAt: ISOInstantSchema.nullable(),
});
export const GoalCurrentEvidenceSchema = z.strictObject({
  algorithmVersion: z.string(),
  dataRevision: CountSchema,
  firstMeasuredAt: ISOInstantSchema.nullable(),
  lastMeasuredAt: ISOInstantSchema.nullable(),
  oldestContributingAt: ISOInstantSchema.nullable(),
  observationCount: CountSchema,
  observedDays: CountSchema,
  calendarDays: CountSchema.nullable(),
  resultId: z.string(),
});

export const GoalCalculationSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('directional'),
    rawPercent: z.number().finite(),
    displayPercent: z.number().min(0).max(100),
  }),
  z.strictObject({
    kind: z.enum(['below_range', 'above_range', 'within_range']),
  }),
  z.strictObject({
    kind: z.literal('undefined'),
    reason: z.enum(['zero_denominator', 'unrepresentable_result']),
  }),
]);
export const GoalProgressResultSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('unavailable'),
    reason: z.enum([
      'unsupported_baseline',
      'needs_review',
      'unsupported_revision',
    ]),
  }),
  z.strictObject({
    kind: z.literal('insufficient_data'),
    coverage: DataSummarySchema.optional(),
  }),
  z.strictObject({
    kind: z.literal('progress'),
    goalId: UUIDSchema.optional(),
    goalVersion: VersionSchema.optional(),
    revision: CountSchema.optional(),
    baseline: z.string(),
    current: z.string(),
    coverage: DataSummarySchema.optional(),
    selection: DataSelectionSchema.optional(),
    dataRevision: CountSchema.optional(),
    result: GoalCalculationSchema,
    actualChange: z.string().optional(),
    absoluteChangeUnit: z.string().optional(),
    relativeChangePercent: z.string().nullable().optional(),
    conditionMet: z.boolean().optional(),
    freshness: GoalFreshnessSchema.optional(),
    baselineEvidence: GoalBaselineEvidenceSchema.optional(),
    currentEvidence: GoalCurrentEvidenceSchema.optional(),
  }),
]);

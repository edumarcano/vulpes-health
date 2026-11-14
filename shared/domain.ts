import { z } from 'zod';
import {
  metricUnits,
  MetricKeySchema,
  CanonicalUnitSchema,
  LegacyMetricKeySchema,
  LegacyCanonicalUnitSchema,
  validMetricNumber,
} from './metrics.js';
export {
  metricUnits,
  MetricKeySchema,
  CanonicalUnitSchema,
} from './metrics.js';
import {
  CountSchema,
  DecimalUSDSchema,
  FiniteNumberSchema,
  HashSchema,
  IanaTimezoneSchema,
  ISOInstantSchema,
  LocalDateSchema,
  UUIDSchema,
  VersionSchema,
} from './primitives.js';

export const GranularitySchema = z.enum([
  'instant',
  'daily_total',
  'session_total',
]);
export const MeasurementMethodSchema = z.enum([
  'device_reported',
  'device_estimate',
  'user_reported',
  'unknown',
]);
export type MetricKey = z.infer<typeof MetricKeySchema>;
export type CanonicalUnit = z.infer<typeof CanonicalUnitSchema>;
export type Granularity = z.infer<typeof GranularitySchema>;
export type MeasurementMethod = z.infer<typeof MeasurementMethodSchema>;

function metricUnit(
  value: { metric: MetricKey; unit: string },
  ctx: z.RefinementCtx,
) {
  if (metricUnits[value.metric] !== value.unit)
    ctx.addIssue({
      code: 'custom',
      path: ['unit'],
      message: 'Unit does not match metric.',
    });
}

function measurementValue(metric: MetricKey, value: number): boolean {
  return validMetricNumber(metric, value);
}

export const MeasurementDTOSchema = z
  .strictObject({
    id: UUIDSchema,
    sourceId: UUIDSchema,
    metric: MetricKeySchema,
    value: FiniteNumberSchema,
    canonicalValue: z
      .string()
      .regex(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/)
      .optional(),
    eventId: UUIDSchema.nullable().optional(),
    unit: CanonicalUnitSchema,
    originalValue: z.string().regex(/\S/),
    originalUnit: z.string().regex(/\S/),
    observedAt: ISOInstantSchema,
    localDate: LocalDateSchema.nullable(),
    timezone: IanaTimezoneSchema.nullable(),
    granularity: GranularitySchema,
    method: MeasurementMethodSchema,
    qualityFlags: z.array(z.string()),
    externalRecordId: z.string().nullable(),
    version: VersionSchema,
  })
  .superRefine((value, ctx) => {
    metricUnit(value, ctx);
    if (!measurementValue(value.metric, value.value))
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Invalid metric representation.',
      });
    if (
      value.granularity === 'daily_total' &&
      (!value.localDate || !value.timezone)
    ) {
      ctx.addIssue({
        code: 'custom',
        message: 'Daily totals require local date and timezone.',
      });
    }
    if (value.metric === 'steps_daily' && value.granularity !== 'daily_total') {
      ctx.addIssue({
        code: 'custom',
        path: ['granularity'],
        message: 'Daily steps require daily_total.',
      });
    }
    if (value.metric === 'sleep_duration' && value.granularity === 'instant') {
      ctx.addIssue({
        code: 'custom',
        path: ['granularity'],
        message: 'Sleep requires a labelled session or daily total.',
      });
    }
  });

export const DataReferenceSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum([
    'measurement',
    'analysis',
    'goal_revision',
    'message',
    'profile_field',
  ]),
  label: z.string(),
});
export const AnalysisMetadataSchema = z.strictObject({
  method: MeasurementMethodSchema,
  granularity: GranularitySchema,
  statistic: z.enum([
    'daily_median_mean_7d',
    'observed_samples',
    'daily_totals',
    'session_observations',
  ]),
  statistics: z
    .strictObject({
      median: FiniteNumberSchema,
      min: FiniteNumberSchema,
      max: FiniteNumberSchema,
    })
    .nullable(),
  previousWindow: z.strictObject({
    from: ISOInstantSchema,
    to: ISOInstantSchema,
    validDays: CountSchema,
    coverageStatus: z.enum(['sufficient', 'insufficient_data']),
  }),
});
export const AnalysisResultSchema = z
  .strictObject({
    ...AnalysisMetadataSchema.partial().shape,
    id: z.string().min(1),
    metric: MetricKeySchema,
    unit: CanonicalUnitSchema,
    sourceId: UUIDSchema,
    from: ISOInstantSchema,
    to: ISOInstantSchema,
    timezone: IanaTimezoneSchema,
    algorithmVersion: z.string().min(1),
    dataRevision: CountSchema,
    observationCount: CountSchema,
    validDays: CountSchema,
    coverageStatus: z.enum(['sufficient', 'insufficient_data']),
    value: FiniteNumberSchema.nullable(),
    previousValue: FiniteNumberSchema.nullable(),
    absoluteChange: FiniteNumberSchema.nullable(),
    relativeChangePercent: FiniteNumberSchema.nullable(),
    points: z.array(
      z.strictObject({
        localDate: LocalDateSchema,
        value: FiniteNumberSchema.nullable(),
      }),
    ),
    exclusions: z.array(
      z.strictObject({ referenceId: z.string().min(1), reason: z.string() }),
    ),
    references: z.array(DataReferenceSchema),
  })
  .superRefine((value, ctx) => {
    metricUnit(value, ctx);
    if (Date.parse(value.from) >= Date.parse(value.to))
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'Expected a nonempty half-open interval.',
      });
    if (value.coverageStatus === 'insufficient_data' && value.value !== null)
      ctx.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'Insufficient coverage cannot supply a headline value.',
      });
  });

export const GoalTargetSchema = z.discriminatedUnion('direction', [
  z.strictObject({
    direction: z.literal('increase_to'),
    value: FiniteNumberSchema,
  }),
  z.strictObject({
    direction: z.literal('decrease_to'),
    value: FiniteNumberSchema,
  }),
  z
    .strictObject({
      direction: z.literal('maintain_range'),
      lower: FiniteNumberSchema,
      upper: FiniteNumberSchema,
    })
    .refine((value) => value.lower <= value.upper, 'Goal range is reversed.'),
]);
export const GoalDraftSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    title: z.string().min(1),
    metric: LegacyMetricKeySchema,
    unit: LegacyCanonicalUnitSchema,
    sourceId: UUIDSchema,
    target: GoalTargetSchema,
    baselineMethod: z.enum([
      'daily_median_mean_7d',
      'latest_value',
      'user_reported',
    ]),
    baselineFrom: ISOInstantSchema.nullable(),
    baselineTo: ISOInstantSchema.nullable(),
    reportedBaseline: FiniteNumberSchema.nullable(),
    timezone: IanaTimezoneSchema,
    targetDate: LocalDateSchema.nullable(),
    constraints: z.array(z.string()),
    proposedStrategy: z.string().nullable(),
  })
  .superRefine((value, ctx) => {
    metricUnit(value, ctx);
    const targets =
      value.target.direction === 'maintain_range'
        ? [value.target.lower, value.target.upper]
        : [value.target.value];
    if (targets.some((target) => !measurementValue(value.metric, target))) {
      ctx.addIssue({
        code: 'custom',
        path: ['target'],
        message: 'Invalid metric representation.',
      });
    }
    if (
      value.reportedBaseline !== null &&
      !measurementValue(value.metric, value.reportedBaseline)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['reportedBaseline'],
        message: 'Invalid metric representation.',
      });
    }
    if (
      value.baselineFrom &&
      value.baselineTo &&
      Date.parse(value.baselineFrom) >= Date.parse(value.baselineTo)
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['baselineTo'],
        message: 'Baseline interval is reversed or empty.',
      });
    }
  });
export const GoalStateSchema = z.enum([
  'draft',
  'needs_data',
  'active',
  'paused',
  'completed',
  'archived',
]);
export const ProposalKindSchema = z.enum([
  'goal.create',
  'goal.revise',
  'goal.state',
]);
export const ProposalMetadataSchema = z.strictObject({
  id: UUIDSchema,
  kind: ProposalKindSchema,
  targetId: UUIDSchema.nullable(),
  expectedVersion: VersionSchema.nullable(),
  payloadHash: HashSchema,
  status: z.enum(['pending', 'approved', 'rejected', 'expired', 'conflicted']),
  expiresAt: ISOInstantSchema,
  summary: z.string(),
});
// Historical version-1 card payload. Current mutation/revision contracts live
// in shared/goals.ts; actionable chat cards carry server-issued references.
export const ActionProposalSchema = ProposalMetadataSchema.extend({
  kind: z.literal('goal.create'),
  targetId: z.null(),
  expectedVersion: z.null(),
  payload: GoalDraftSchema,
});
export const UsageSummarySchema = z.strictObject({
  inputTokens: CountSchema.nullable(),
  outputTokens: CountSchema.nullable(),
  reasoningTokens: CountSchema.nullable(),
  cacheReadTokens: CountSchema.nullable(),
  cacheWriteTokens: CountSchema.nullable(),
  costUSD: DecimalUSDSchema.nullable(),
  costStatus: z.enum(['reported', 'estimated', 'pending', 'conservative']),
  reservationUSD: DecimalUSDSchema,
  priceSnapshotId: z.string().min(1).nullable(),
  knownCostUSD: DecimalUSDSchema.default('0'),
});
const ContextReferenceSchema = DataReferenceSchema.extend({
  kind: z.enum([
    'measurement',
    'analysis',
    'goal_revision',
    'message',
    'profile_field',
    'instruction',
    'context_selection',
    'goal_context',
    'tool_result',
  ]),
});
export const ContextManifestSchema = z.strictObject({
  captureVersion: z.literal(2).optional(),
  templateVersion: z.string().min(1),
  included: z.array(
    z.strictObject({
      reference: ContextReferenceSchema,
      contentHash: HashSchema,
      tokenEstimate: CountSchema,
    }),
  ),
  excluded: z.array(
    z.strictObject({ referenceId: z.string().min(1), reason: z.string() }),
  ),
  retrieval: z.strictObject({
    ragUsed: z.literal(false),
    webUsed: z.literal(false),
  }),
  consentVersion: z.string().min(1),
  dataRevision: CountSchema,
});
export const VulpesCardSchema = z.discriminatedUnion('type', [
  z.strictObject({
    type: z.literal('metric_trend'),
    result: AnalysisResultSchema,
  }),
  z.strictObject({
    type: z.literal('goal_progress'),
    goalId: UUIDSchema,
    revision: VersionSchema,
    result: AnalysisResultSchema,
  }),
  z.strictObject({
    type: z.literal('goal_proposal'),
    proposal: ActionProposalSchema,
  }),
  z.strictObject({
    type: z.literal('data_quality'),
    message: z.string(),
    references: z.array(DataReferenceSchema),
  }),
]);

export type MeasurementDTO = z.infer<typeof MeasurementDTOSchema>;
export type DataReference = z.infer<typeof DataReferenceSchema>;
export type AnalysisResult = z.infer<typeof AnalysisResultSchema>;
export type GoalTarget = z.infer<typeof GoalTargetSchema>;
export type GoalDraft = z.infer<typeof GoalDraftSchema>;
export type GoalState = z.infer<typeof GoalStateSchema>;
export type ActionProposal = z.infer<typeof ActionProposalSchema>;
export type UsageSummary = z.infer<typeof UsageSummarySchema>;
export type ContextManifest = z.infer<typeof ContextManifestSchema>;
export type VulpesCard = z.infer<typeof VulpesCardSchema>;

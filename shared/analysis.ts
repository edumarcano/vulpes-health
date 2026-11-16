import { z } from 'zod';
import {
  CanonicalUnitSchema,
  GranularitySchema,
  MeasurementDTOSchema,
  MeasurementMethodSchema,
  MetricKeySchema,
  metricUnits,
} from './domain.js';
import { EventDetailSchema } from './events.js';
import {
  CountSchema,
  IanaTimezoneSchema,
  ISOInstantSchema,
  LocalDateSchema,
  PageSizeSchema,
  UUIDSchema,
} from './primitives.js';

export const ANALYSIS_VERSION = 'explicit-analysis-v2';
export const ANALYSIS_OBSERVATION_BUDGET = 25_000;
export const ANALYSIS_BATCH_LIMIT = 24;
export const AnalysisWindowSchema = z.strictObject({
  from: ISOInstantSchema,
  to: ISOInstantSchema,
});
export const AnalysisSeriesSchema = z.strictObject({
  metric: MetricKeySchema,
  source_id: UUIDSchema.transform((id) => id.toLowerCase()),
  method: MeasurementMethodSchema,
  granularity: GranularitySchema,
});
const seriesFields = {
  series: AnalysisSeriesSchema,
  timezone: IanaTimezoneSchema,
};
export const AnalysisOperationSchema = z.discriminatedUnion('operation', [
  z.strictObject({
    operation: z.literal('latest_event'),
    source_id: UUIDSchema.transform((id) => id.toLowerCase()),
    timezone: IanaTimezoneSchema,
    window: AnalysisWindowSchema.optional(),
  }),
  z.strictObject({
    operation: z.literal('latest_per_metric'),
    ...seriesFields,
    window: AnalysisWindowSchema.optional(),
    before: ISOInstantSchema.optional(),
  }),
  z.strictObject({
    operation: z.literal('observed_day_mean'),
    ...seriesFields,
    window: AnalysisWindowSchema,
    includeSampleMean: z.boolean().default(false),
  }),
  z.strictObject({
    operation: z.literal('rolling_7d'),
    ...seriesFields,
    window: AnalysisWindowSchema,
    before: ISOInstantSchema.optional(),
  }),
  z.strictObject({
    operation: z.literal('period_comparison'),
    ...seriesFields,
    window: AnalysisWindowSchema,
    comparisonWindow: AnalysisWindowSchema.optional(),
    comparisonMethod: z.enum(['observed_day_mean', 'rolling_7d']),
  }),
  z.strictObject({
    operation: z.literal('endpoint_difference'),
    ...seriesFields,
    endpointIds: z
      .tuple([
        UUIDSchema.transform((id) => id.toLowerCase()),
        UUIDSchema.transform((id) => id.toLowerCase()),
      ])
      .refine(([a, b]) => a !== b, 'Choose two distinguishable observations.'),
  }),
]);
export type AnalysisOperation = z.infer<typeof AnalysisOperationSchema>;
export type AnalysisSeries = z.infer<typeof AnalysisSeriesSchema>;
export type AnalysisWindow = z.infer<typeof AnalysisWindowSchema>;

export const AnalyzeRequestSchema = z
  .strictObject({
    action: z.literal('analyze'),
    operations: z
      .array(AnalysisOperationSchema)
      .min(1)
      .max(ANALYSIS_BATCH_LIMIT),
  })
  .superRefine(({ operations }, ctx) => {
    const keys = operations.map((op) =>
      op.operation === 'latest_event'
        ? `event:${op.source_id}`
        : JSON.stringify(op.series),
    );
    if (new Set(keys).size !== keys.length)
      ctx.addIssue({
        code: 'custom',
        path: ['operations'],
        message: 'Use one operation per unique series in a batch.',
      });
  });
export const ResolveAnalysisRequestSchema = z.strictObject({
  action: z.literal('resolve_analysis'),
  operation: AnalysisOperationSchema,
  expectedResultId: z.string().regex(/^analysis:[a-f0-9]{64}$/),
  dataRevision: CountSchema,
});
export const AnalysisReadRequestSchema = z.union([
  AnalyzeRequestSchema,
  ResolveAnalysisRequestSchema,
]);
export const InventoryQuerySchema = z.strictObject({
  view: z.literal('inventory'),
  page_size: PageSizeSchema.default(200),
  cursor: z.string().min(1).max(4096).optional(),
  data_revision: CountSchema.optional(),
});
export const InventoryItemSchema = z.strictObject({
  metric: MetricKeySchema,
  source_id: UUIDSchema,
  source_label: z.string(),
  method: MeasurementMethodSchema,
  granularity: GranularitySchema,
  observations: CountSchema,
  first_at: ISOInstantSchema,
  last_at: ISOInstantSchema,
});
export const MetricInventorySchema = z.strictObject({
  dataRevision: CountSchema,
  items: z.array(InventoryItemSchema).max(200),
  nextCursor: z.string().nullable(),
  registryVersion: z.string(),
  registry: z
    .array(
      z.strictObject({
        metric: MetricKeySchema,
        label: z.string(),
        unit: CanonicalUnitSchema,
        analyticsEligible: z.boolean(),
        limitation: z.string(),
      }),
    )
    .max(64),
  limits: z.strictObject({
    localDays: z.literal(366),
    observations: z.literal(25000),
    batch: z.literal(24),
    rawPage: z.literal(200),
  }),
});

const ExactValueSchema = z.string().regex(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/);
export const AnalysisWindowValueSchema = z.strictObject({
  window: AnalysisWindowSchema.nullable(),
  value: ExactValueSchema.nullable(),
  statistic: z.enum([
    'latest_value',
    'observed_day_mean',
    'rolling_7d',
    'endpoint',
    'uncombined_sessions',
    'uncombined_daily_totals',
    'observed_samples',
  ]),
  coverageStatus: z.enum(['sufficient', 'insufficient_data', 'unsupported']),
  observationCount: CountSchema,
  observedDays: CountSchema,
  calendarDays: CountSchema.nullable(),
  partialCurrentDay: z.boolean(),
  firstMeasuredAt: ISOInstantSchema.nullable(),
  lastMeasuredAt: ISOInstantSchema.nullable(),
  oldestContributingAt: ISOInstantSchema.nullable(),
  ageSeconds: z.number().nonnegative().nullable(),
  sampleMean: ExactValueSchema.nullable(),
  sampleStatistics: z
    .strictObject({
      median: ExactValueSchema,
      min: ExactValueSchema,
      max: ExactValueSchema,
    })
    .nullable(),
});
const baseResult = {
  schemaVersion: z.literal(1),
  id: z.string().regex(/^analysis:[a-f0-9]{64}$/),
  algorithmVersion: z.literal(ANALYSIS_VERSION),
  registryVersion: z.string(),
  dataRevision: CountSchema,
  timezone: IanaTimezoneSchema,
  evaluatedAt: ISOInstantSchema,
  lastSuccessfulImportAt: ISOInstantSchema.nullable(),
  evidence: z.strictObject({
    operation: AnalysisOperationSchema,
    resultId: z.string().regex(/^analysis:[a-f0-9]{64}$/),
    dataRevision: CountSchema,
  }),
};
export const SeriesAnalysisResultSchema = z
  .strictObject({
    ...baseResult,
    kind: z.literal('series_analysis'),
    operation: z.enum([
      'latest_per_metric',
      'observed_day_mean',
      'rolling_7d',
      'period_comparison',
      'endpoint_difference',
    ]),
    series: AnalysisSeriesSchema,
    unit: CanonicalUnitSchema,
    requestedWindow: AnalysisWindowSchema.nullable(),
    effectiveWindow: AnalysisWindowSchema.nullable(),
    current: AnalysisWindowValueSchema,
    previous: AnalysisWindowValueSchema.nullable(),
    absoluteChange: ExactValueSchema.nullable(),
    absoluteChangeUnit: z.string(),
    relativeChangePercent: ExactValueSchema.nullable(),
    alignment: z.enum([
      'single_series',
      'independent_windows',
      'explicit_endpoints',
    ]),
    endpoints: z.array(MeasurementDTOSchema).max(2),
    points: z
      .array(
        z.strictObject({
          localDate: LocalDateSchema,
          value: ExactValueSchema.nullable(),
        }),
      )
      .max(366),
    references: z
      .array(
        z.strictObject({
          id: UUIDSchema,
          version: CountSchema,
          observedAt: ISOInstantSchema,
          eventId: UUIDSchema.nullable(),
          qualityFlags: z.array(z.string()),
        }),
      )
      .max(200),
    hasMoreReferences: z.boolean(),
    exclusions: z
      .array(z.strictObject({ referenceId: UUIDSchema, reason: z.string() }))
      .max(25000),
    limitations: z.array(z.string()),
  })
  .superRefine((result, ctx) => {
    if (result.unit !== metricUnits[result.series.metric])
      ctx.addIssue({
        code: 'custom',
        path: ['unit'],
        message: 'Unit does not match the selected metric.',
      });
    if (
      result.evidence.resultId !== result.id ||
      result.evidence.dataRevision !== result.dataRevision
    )
      ctx.addIssue({
        code: 'custom',
        path: ['evidence'],
        message: 'Evidence must bind this result and revision.',
      });
    if (
      result.current.coverageStatus !== 'sufficient' &&
      result.current.value !== null
    )
      ctx.addIssue({
        code: 'custom',
        path: ['current', 'value'],
        message: 'Unavailable coverage cannot supply a scalar.',
      });
    if (
      (result.current.value === null || result.previous?.value === null) &&
      result.absoluteChange !== null
    )
      ctx.addIssue({
        code: 'custom',
        path: ['absoluteChange'],
        message: 'Both sides must supply values before comparison.',
      });
  });
export const EventAnalysisResultSchema = z.strictObject({
  ...baseResult,
  kind: z.literal('event_analysis'),
  operation: z.literal('latest_event'),
  sourceId: UUIDSchema,
  requestedWindow: AnalysisWindowSchema.nullable(),
  status: z.enum(['available', 'ambiguous', 'insufficient_data']),
  event: EventDetailSchema.nullable(),
  candidates: z.array(UUIDSchema).max(2),
});
export const ExplicitAnalysisResultSchema = z.union([
  SeriesAnalysisResultSchema,
  EventAnalysisResultSchema,
]);
export const AnalysisBatchSchema = z.strictObject({
  schemaVersion: z.literal(1),
  dataRevision: CountSchema,
  results: z
    .array(ExplicitAnalysisResultSchema)
    .min(1)
    .max(ANALYSIS_BATCH_LIMIT),
});
export type SeriesAnalysisResult = z.infer<typeof SeriesAnalysisResultSchema>;
export type ExplicitAnalysisResult = z.infer<
  typeof ExplicitAnalysisResultSchema
>;
export type AnalysisBatch = z.infer<typeof AnalysisBatchSchema>;

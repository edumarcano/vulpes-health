import { z } from 'zod';
import { SeriesAnalysisResultSchema } from './analysis.js';
import {
  CanonicalUnitSchema,
  GranularitySchema,
  MeasurementMethodSchema,
  MetricKeySchema,
} from './domain.js';
import {
  CountSchema,
  IanaTimezoneSchema,
  ISOInstantSchema,
  LocalDateSchema,
  UUIDSchema,
} from './primitives.js';

export const REFERENCE_RESOLVER_VERSION = 'manufacturer-reference-v1';
export const ReferenceProfileAttributeSchema = z.enum(['ageYears', 'sex']);
export const ReferenceAttributesSchema = z.strictObject({
  ageYears: z.number().int().min(0).max(130).optional(),
  sex: z.enum(['female', 'male']).optional(),
});
const DecimalSchema = z
  .string()
  .max(1024)
  .regex(/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/);
export const ReferenceBandSchema = z.strictObject({
  id: z.string().min(1).max(100),
  label: z.string().min(1).max(100),
  lower: DecimalSchema.nullable(),
  upper: DecimalSchema.nullable(),
  lowerInclusive: z.boolean(),
  upperInclusive: z.boolean(),
});
export const ReferenceRuleSchema = z.strictObject({
  id: z.string().min(1).max(100),
  version: z.string().min(1).max(100),
  metric: MetricKeySchema,
  unit: CanonicalUnitSchema,
  sourceKind: z.enum(['manufacturer', 'synthetic']),
  source: z.strictObject({
    title: z.string().min(1).max(300),
    url: z.url().refine((url) => new URL(url).protocol === 'https:'),
    verifiedOn: LocalDateSchema,
    reuseRecord: z.string().min(1).max(500),
  }),
  scope: z.strictObject({
    app: z.string().min(1).max(100),
    appVersions: z.array(z.string().min(1).max(100)).min(1).max(20).nullable(),
    models: z.array(z.string().min(1).max(100)).min(1).max(20).nullable(),
    modes: z.array(z.string().min(1).max(100)).min(1).max(20).nullable(),
  }),
  requiredProfileAttributes: z.array(ReferenceProfileAttributeSchema).max(2),
  profile: z.strictObject({
    minimumAgeYears: z.number().int().min(0).max(130).nullable(),
    maximumAgeYears: z.number().int().min(0).max(130).nullable(),
    sex: z.enum(['female', 'male']).nullable(),
  }),
  bands: z.array(ReferenceBandSchema).min(1).max(16),
  limitation: z.string().min(1).max(1000),
});
export type ReferenceRule = z.infer<typeof ReferenceRuleSchema>;

export const ReferenceBasisSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('current_guidance'),
    profileVersion: z.string().min(1).max(100).nullable(),
    attributes: ReferenceAttributesSchema,
  }),
  z.strictObject({
    kind: z.literal('historical'),
    referenceVersion: z.string().min(1).max(100),
    profileVersion: z.string().min(1).max(100),
    attributes: ReferenceAttributesSchema,
  }),
]);
export type ReferenceBasis = z.infer<typeof ReferenceBasisSchema>;
export const ReferenceScopeSchema = z.strictObject({
  app: z.string().max(100).nullable(),
  appVersion: z.string().max(100).nullable(),
  model: z.string().max(100).nullable(),
  mode: z.string().max(100).nullable(),
});
export type ReferenceScope = z.infer<typeof ReferenceScopeSchema>;

export const ReferenceClassificationSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('applicable'),
    rule: ReferenceRuleSchema,
    band: ReferenceBandSchema,
    basis: ReferenceBasisSchema,
    label: z.string(),
  }),
  z.strictObject({
    state: z.literal('missing_profile'),
    requiredAttributes: z.array(ReferenceProfileAttributeSchema).min(1).max(2),
    message: z.literal('More profile information needed'),
  }),
  z.strictObject({
    state: z.literal('not_applicable'),
    reason: z.enum(['scope_mismatch', 'profile_mismatch', 'unit_mismatch']),
    message: z.string(),
  }),
  z.strictObject({
    state: z.literal('unavailable'),
    reason: z.enum([
      'unverified_reference',
      'unresolved_semantics',
      'applicability_unverified',
      'historical_basis_unavailable',
      'reference_version_unavailable',
      'ambiguous_reference',
      'no_measurement',
      'invalid_measurement',
      'outside_verified_bands',
    ]),
    message: z.literal('Manufacturer reference unavailable'),
  }),
]);
export type ReferenceClassification = z.infer<
  typeof ReferenceClassificationSchema
>;

export const ReferenceSelectionSchema = z.strictObject({
  view: z.literal('reference'),
  metric: MetricKeySchema,
  source_id: UUIDSchema.transform((id) => id.toLowerCase()),
  method: MeasurementMethodSchema,
  granularity: GranularitySchema,
  timezone: IanaTimezoneSchema,
  from: ISOInstantSchema.optional(),
  to: ISOInstantSchema.optional(),
});
export const ReferenceQuerySchema = ReferenceSelectionSchema.extend({
  expected_result_id: z
    .string()
    .regex(/^reference:[a-f0-9]{64}$/)
    .optional(),
  data_revision: CountSchema.optional(),
}).superRefine((query, ctx) => {
  if ((query.from === undefined) !== (query.to === undefined))
    ctx.addIssue({ code: 'custom', message: 'Supply both window boundaries.' });
  if (
    (query.expected_result_id === undefined) !==
    (query.data_revision === undefined)
  )
    ctx.addIssue({
      code: 'custom',
      message: 'Resolve with both the result ID and data revision.',
    });
});
export type ReferenceQuery = z.infer<typeof ReferenceQuerySchema>;

export const MetricDefinitionSchema = z.strictObject({
  metric: MetricKeySchema,
  label: z.string(),
  unit: CanonicalUnitSchema,
  definition: z.string(),
  displayGroup: z.string(),
  displayGroupLabel: z.string(),
  analyticsEligible: z.boolean(),
  goalEligible: z.boolean(),
  limitations: z.array(z.string()).max(4),
});
export const MetricReferenceResultSchema = z.strictObject({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^reference:[a-f0-9]{64}$/),
  contentVersion: z.string(),
  referenceRegistryVersion: z.string(),
  resolverVersion: z.literal(REFERENCE_RESOLVER_VERSION),
  dataRevision: CountSchema,
  evaluatedAt: ISOInstantSchema,
  selection: ReferenceSelectionSchema,
  definition: MetricDefinitionSchema,
  analysis: SeriesAnalysisResultSchema.nullable(),
  classification: ReferenceClassificationSchema,
  evidence: z.strictObject({
    analysisResultId: z
      .string()
      .regex(/^analysis:[a-f0-9]{64}$/)
      .nullable(),
    referenceResultId: z.string().regex(/^reference:[a-f0-9]{64}$/),
    dataRevision: CountSchema,
  }),
});
export type MetricReferenceResult = z.infer<typeof MetricReferenceResultSchema>;

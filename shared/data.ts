import { z } from 'zod';
import {
  AnalysisMetadataSchema,
  AnalysisResultSchema,
  GranularitySchema,
  MeasurementDTOSchema,
  MeasurementMethodSchema,
  MetricKeySchema,
} from './domain.js';
import {
  CountSchema,
  IanaTimezoneSchema,
  ISOInstantSchema,
  LocalDateSchema,
  PageSizeSchema,
  UUIDSchema,
  VersionSchema,
} from './primitives.js';

export const measurementRegistry = {
  weight: { label: 'Weight', units: ['kg', 'lb'] },
  body_fat_percent: { label: 'Body fat (device estimate)', units: ['%'] },
  'renpho.visceral_fat_index': {
    label: 'RENPHO visceral fat index (device estimate)',
    units: ['index'],
  },
  heart_rate: { label: 'Observed heart rate', units: ['bpm'] },
  resting_heart_rate: {
    label: 'Explicitly resting heart rate',
    units: ['bpm'],
  },
  height: { label: 'Height', units: ['cm', 'm', 'in'] },
  steps_daily: { label: 'Daily steps', units: ['count'] },
  sleep_duration: { label: 'Sleep duration', units: ['min', 'h'] },
} as const;
export const DecimalInputSchema = z
  .string()
  .max(1024)
  .regex(
    /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/,
    'Enter a decimal number without separators.',
  );
export const ObservationInputSchema = z.strictObject({
  metric: MetricKeySchema,
  value: DecimalInputSchema,
  unit: z.enum([
    'kg',
    'lb',
    '%',
    'index',
    'bpm',
    'cm',
    'm',
    'in',
    'count',
    'min',
    'h',
  ]),
  observed_at: z.string().min(1).max(100),
  timezone: IanaTimezoneSchema,
  local_date: LocalDateSchema.nullable(),
  granularity: GranularitySchema,
  method: MeasurementMethodSchema,
  quality_flags: z.array(z.string().min(1).max(100).regex(/\S/)).max(20),
});
export const SourceSelectionSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('existing'),
    id: UUIDSchema.transform((id) => id.toLowerCase()),
  }),
  z.strictObject({
    kind: z.literal('new'),
    label: z.string().trim().min(1).max(200),
    origin_app: z.string().trim().min(1).max(200).nullable(),
    device_label: z.string().trim().min(1).max(200).nullable(),
  }),
]);
export const AddMeasurementSchema = z.strictObject({
  action: z.literal('add_measurement'),
  client_request_id: UUIDSchema,
  source: SourceSelectionSchema,
  observation: ObservationInputSchema.extend({
    quality_flags: z.array(z.literal('review_requested')).max(1),
  }),
});
export const MeasurementEditSchema = ObservationInputSchema.pick({
  value: true,
  unit: true,
  observed_at: true,
  timezone: true,
  local_date: true,
});
const MeasurementTargetSchema = z.strictObject({
  measurement_id: UUIDSchema.transform((id) => id.toLowerCase()),
  expected_version: VersionSchema,
  client_request_id: UUIDSchema,
});
export const CorrectMeasurementSchema = MeasurementTargetSchema.extend({
  action: z.literal('correct_measurement'),
  changes: MeasurementEditSchema,
});
export const DeleteMeasurementSchema = MeasurementTargetSchema.extend({
  action: z.literal('delete_measurement'),
});
export const MeasurementMutationSchema = z.discriminatedUnion('action', [
  CorrectMeasurementSchema,
  DeleteMeasurementSchema,
]);
export const MeasurementMutationResultSchema = z.strictObject({
  id: UUIDSchema,
  sourceId: UUIDSchema,
  outcome: z.enum(['corrected', 'deleted']),
  version: VersionSchema,
  dataRevision: CountSchema,
  baselinesMarked: CountSchema,
  previewsInvalidated: CountSchema,
  tracePayloadsRemoved: CountSchema,
});
export const SourceSchema = z.strictObject({
  id: UUIDSchema,
  kind: z.enum(['manual', 'csv']),
  label: z.string(),
  namespace: z.string(),
  originApp: z.string().nullable(),
  deviceLabel: z.string().nullable(),
  method: MeasurementMethodSchema,
});
export const MutationResultSchema = z.strictObject({
  id: UUIDSchema,
  sourceId: UUIDSchema,
  outcome: z.enum(['created', 'duplicate']),
  version: VersionSchema,
  dataRevision: CountSchema,
});
export const DataSelectionSchema = z.strictObject({
  metric: MetricKeySchema,
  source_id: UUIDSchema.transform((id) => id.toLowerCase()),
  from: ISOInstantSchema,
  to: ISOInstantSchema,
  timezone: IanaTimezoneSchema,
  method: MeasurementMethodSchema,
  granularity: GranularitySchema,
});
const PageSchema = z.strictObject({
  page_size: PageSizeSchema.default(100),
  cursor: z.string().min(1).max(4096).optional(),
  data_revision: CountSchema.optional(),
});
export const DataQuerySchema = z.discriminatedUnion('view', [
  PageSchema.extend({ view: z.literal('sources') }),
  PageSchema.extend(DataSelectionSchema.shape).extend({
    view: z.literal('measurements'),
  }),
  DataSelectionSchema.extend({ view: z.literal('summary') }),
  DataSelectionSchema.extend({
    view: z.literal('export'),
    data_revision: CountSchema.optional(),
  }),
]);
export const SourcesPageSchema = z.strictObject({
  items: z.array(SourceSchema).max(200),
  nextCursor: z.string().nullable(),
  dataRevision: CountSchema,
  timezone: IanaTimezoneSchema,
});
export const MeasurementsPageSchema = z.strictObject({
  items: z.array(MeasurementDTOSchema).max(200),
  nextCursor: z.string().nullable(),
  dataRevision: CountSchema,
});
export const DataAnalysisSchema = AnalysisResultSchema.safeExtend(
  AnalysisMetadataSchema.shape,
);
export const DataSummarySchema = z.strictObject({
  selection: DataSelectionSchema,
  dataRevision: CountSchema,
  latest: MeasurementDTOSchema.nullable(),
  analysis: DataAnalysisSchema,
  series: z
    .array(
      z.strictObject({
        localDate: LocalDateSchema,
        value: z.number().finite().nullable(),
      }),
    )
    .max(366),
});
export type ObservationInput = z.infer<typeof ObservationInputSchema>;
export type AddMeasurement = z.infer<typeof AddMeasurementSchema>;
export type DataSelection = z.infer<typeof DataSelectionSchema>;
export type DataQuery = z.infer<typeof DataQuerySchema>;
export type Source = z.infer<typeof SourceSchema>;
export type DataSummary = z.infer<typeof DataSummarySchema>;
export type MeasurementMutation = z.infer<typeof MeasurementMutationSchema>;

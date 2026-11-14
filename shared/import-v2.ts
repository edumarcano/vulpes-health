import { z } from 'zod';
import {
  ImportMappingSchema,
  ImportPreviewSchema,
  ImportResultSchema,
  CSV_LIMIT_BYTES,
} from './imports.js';
import { SourceSelectionSchema } from './data.js';
import {
  CountSchema,
  HashSchema,
  UUIDSchema,
  ISOInstantSchema,
} from './primitives.js';
import { MetricKeySchema, CanonicalUnitSchema } from './metrics.js';
import { GranularitySchema, MeasurementMethodSchema } from './domain.js';

export const DATA_CONTRACT_VERSION = '2';
export const IMPORT_OBSERVATION_LIMIT = 25_000;
export const IMPORT_ROW_LIMIT = 10_000;
export const IMPORT_METADATA_LIMIT_BYTES = 65_536;
export const CSV_BASE64_LIMIT = 4 * Math.ceil(CSV_LIMIT_BYTES / 3);

export const ImportReviewSchema = z.strictObject({
  exclude_invalid: z.boolean(),
  exclude_conflicts: z.boolean(),
  acknowledge_unknown: z.boolean(),
});
export const initialImportReview = {
  exclude_invalid: false,
  exclude_conflicts: false,
  acknowledge_unknown: false,
} as const;
export const PreviewCsvWireSchema = z.strictObject({
  action: z.literal('preview_csv'),
  schema_version: z.literal(2),
  client_request_id: UUIDSchema,
  csv_base64: z.string().min(4).max(CSV_BASE64_LIMIT),
  source: SourceSelectionSchema,
  mapping: ImportMappingSchema,
});
export const ReviewImportSchema = z.strictObject({
  action: z.literal('review_import'),
  batch_id: UUIDSchema,
  payload_hash: HashSchema,
  review: ImportReviewSchema,
});
export const DiscardImportSchema = z.strictObject({
  action: z.literal('discard_import'),
  batch_id: UUIDSchema,
});
export const ImportReadSchema = z.discriminatedUnion('view', [
  z
    .strictObject({
      view: z.literal('import_status'),
      batch_id: UUIDSchema.optional(),
      client_request_id: UUIDSchema.optional(),
    })
    .refine(
      (v) => Boolean(v.batch_id) !== Boolean(v.client_request_id),
      'Choose one import identifier.',
    ),
  z.strictObject({
    view: z.literal('import_items'),
    batch_id: UUIDSchema,
    payload_hash: HashSchema,
    offset: CountSchema.max(250_000).default(0),
    limit: z.number().int().min(1).max(200).default(100),
  }),
]);

export type ImportReview = z.infer<typeof ImportReviewSchema>;
export type PreviewCsvWire = z.infer<typeof PreviewCsvWireSchema>;
export type ImportIssue = { row: number; column: string; message: string };
export type AnnotationKey = 'weight_level' | 'body_type' | 'remarks';
export type EventAnnotations = Partial<Record<AnnotationKey, string>>;
export type ImportClassification =
  'new' | 'enrichment' | 'duplicate' | 'conflict';
export type RenphoValue = [
  metric: z.infer<typeof MetricKeySchema>,
  original: string,
  canonical: string,
];
export type RenphoEvent = {
  row: number;
  no: string | null;
  local: string;
  instant: string;
  offset: number;
  annotations: EventAnnotations;
  values: RenphoValue[];
};
export type ParsedRenpho = {
  events: RenphoEvent[];
  issues: ImportIssue[];
  unknown_columns: string[];
  populated_unknown_columns: string[];
  absent_columns: string[];
  source_rows: number;
  unavailable_cells: number;
  empty_events: number;
  numeric_observations: number;
};

export const ImportPreviewV2Schema = ImportPreviewSchema.safeExtend({
  schema_version: z.literal(2),
  adapter_version: z.string(),
  registry_version: z.string(),
  review: ImportReviewSchema,
  ready_to_commit: z.boolean(),
  source_rows: CountSchema,
  events: z.strictObject({
    total: CountSchema,
    new: CountSchema,
    existing: CountSchema,
    conflict: CountSchema,
  }),
  enrichment_count: CountSchema,
  annotation_additions: CountSchema,
  annotation_conflicts: CountSchema,
  unavailable_cells: CountSchema,
  empty_events: CountSchema,
  absent_columns: z.array(z.string()).max(100),
  populated_unknown_columns: z.array(z.string()).max(100),
  observed_from: ISOInstantSchema.nullable(),
  observed_to: ISOInstantSchema.nullable(),
});
export type ImportPreviewV2 = z.infer<typeof ImportPreviewV2Schema>;

export const ImportStatusSchema = z.object({
  batch_id: UUIDSchema,
  status: z.enum(['previewed', 'committed', 'discarded', 'expired', 'failed']),
  result: ImportResultSchema.nullable(),
  preview: ImportPreviewV2Schema.nullable().optional(),
});
export const ImportItemsSchema = z.strictObject({
  batch_id: UUIDSchema,
  payload_hash: HashSchema,
  dataRevision: CountSchema,
  items: z.array(
    z.object({
      kind: z.enum(['issue', 'annotation', 'observation']),
      row: CountSchema,
      column: z.string(),
      message: z.string().optional(),
      value: z.string().optional(),
      original_value: z.string().optional(),
      original_unit: z.string().optional(),
      unit: z.string().optional(),
      observed_at: z.string().optional(),
      classification: z.string().optional(),
    }),
  ),
  next_offset: CountSchema.nullable(),
  total: CountSchema,
});

export const GenericObservationTupleSchema = z.tuple([
  MetricKeySchema,
  z.string().max(1024),
  z.string(),
  z.string().max(2100),
  CanonicalUnitSchema,
  ISOInstantSchema,
  z.number().int().min(-840).max(840),
  z.string().max(100),
  z.string().nullable(),
  GranularitySchema,
  MeasurementMethodSchema,
  z.array(z.string()).max(20),
  z.string().max(500).nullable(),
  CountSchema,
  z.string().max(200),
]);
export type GenericObservationTuple = z.infer<
  typeof GenericObservationTupleSchema
>;

export const RenphoEventSchema = z.strictObject({
  row: CountSchema,
  no_base64: z.string().max(2668).nullable(),
  local: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:[0-5]\d$/),
  instant: ISOInstantSchema,
  offset: z.number().int().min(-840).max(840),
  annotations_base64: z.strictObject({
    weight_level: z.string().max(1068).optional(),
    body_type: z.string().max(1068).optional(),
    remarks: z.string().max(5464).optional(),
  }),
  values: z
    .array(
      z.tuple([MetricKeySchema, z.string().max(1024), z.string().max(2100)]),
    )
    .min(1)
    .max(24),
});
export const InspectionSchema = z.strictObject({
  revision: CountSchema,
  classifications: z
    .array(z.enum(['new', 'enrichment', 'duplicate', 'conflict']))
    .max(IMPORT_OBSERVATION_LIMIT),
  event_ids: z.array(UUIDSchema.nullable()).max(IMPORT_ROW_LIMIT),
  time_conflicts: z.array(z.boolean()).max(IMPORT_ROW_LIMIT),
  annotation_classes: z
    .array(z.record(z.string(), z.enum(['new', 'duplicate', 'conflict'])))
    .max(IMPORT_ROW_LIMIT),
});
export const ImportBundleSchema = z.strictObject({
  schema_version: z.literal(2),
  adapter_version: z.string(),
  registry_version: z.string(),
  client_request_id: UUIDSchema,
  source: SourceSelectionSchema,
  mapping: ImportMappingSchema,
  file_hash: HashSchema,
  mapping_hash: HashSchema,
  data_revision: CountSchema,
  events: z.array(RenphoEventSchema).max(IMPORT_ROW_LIMIT),
  observations: z
    .array(GenericObservationTupleSchema)
    .max(IMPORT_OBSERVATION_LIMIT),
  issues: z
    .array(
      z.strictObject({
        row: CountSchema,
        column: z.string().max(200),
        message: z.string().max(300),
      }),
    )
    .max(250_000),
  unknown_columns: z.array(z.string().max(200)).max(100),
  populated_unknown_columns: z.array(z.string().max(200)).max(100),
  absent_columns: z.array(z.string().max(200)).max(100),
  source_rows: CountSchema.max(IMPORT_ROW_LIMIT),
  unavailable_cells: CountSchema,
  empty_events: CountSchema,
  profile_excluded: CountSchema,
  source_excluded: CountSchema,
  review: ImportReviewSchema,
  inspection: InspectionSchema,
});
export type ImportBundle = z.infer<typeof ImportBundleSchema>;

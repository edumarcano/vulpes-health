import { z } from 'zod';
import { ObservationInputSchema, SourceSelectionSchema } from './data.js';
import { GranularitySchema, MeasurementMethodSchema, MetricKeySchema } from './domain.js';
import { CountSchema, HashSchema, IanaTimezoneSchema, ISOInstantSchema, UUIDSchema } from './primitives.js';

export const CSV_LIMIT_BYTES = 1024 * 1024;
export const IMPORT_LIMIT = 5000;
const ColumnSchema = z.string().min(1).max(200);
const commonMapping = {
  schema_version: z.literal(1), timezone: IanaTimezoneSchema,
  profile: z.strictObject({ column: ColumnSchema, value: z.string().min(1).max(200) }).nullable(),
  single_profile: z.boolean(), review_requested: z.boolean(),
};
export const ImportMappingSchema = z.discriminatedUnion('format', [
  z.strictObject({ ...commonMapping, format: z.literal('canonical'), source_label: z.string().min(1).max(200) }),
  z.strictObject({ ...commonMapping, format: z.literal('wide'), timestamp_column: ColumnSchema,
    local_date_column: ColumnSchema.nullable(), external_id_column: ColumnSchema.nullable(), granularity: GranularitySchema,
    metrics: z.array(z.strictObject({ column: ColumnSchema, metric: MetricKeySchema, unit: ObservationInputSchema.shape.unit, method: MeasurementMethodSchema })).min(1).max(8),
  }),
]).refine((mapping) => mapping.profile !== null || mapping.single_profile, 'Confirm that the file contains one profile or choose a profile filter.');
export const PreviewCsvSchema = z.strictObject({ action: z.literal('preview_csv'), client_request_id: UUIDSchema,
  csv: z.string().min(1).max(CSV_LIMIT_BYTES), source: SourceSelectionSchema, mapping: ImportMappingSchema,
});
export const ImportCountsSchema = z.strictObject({ observations: CountSchema, new: CountSchema, duplicate: CountSchema, conflict: CountSchema,
  invalid: CountSchema, profileExcluded: CountSchema, sourceExcluded: CountSchema, blank: CountSchema,
});
export const ImportResultSchema = z.strictObject({ batch_id: UUIDSchema, source_id: UUIDSchema, outcome: z.literal('committed'),
  inserted: CountSchema, duplicate: CountSchema, conflict: CountSchema, dataRevision: CountSchema,
});
export const ImportPreviewSchema = z.strictObject({ batch_id: UUIDSchema, source_id: UUIDSchema, payload_hash: HashSchema,
  expires_at: ISOInstantSchema, dataRevision: CountSchema, counts: ImportCountsSchema,
  ignored_columns: z.array(ColumnSchema).max(100), errors: z.array(z.strictObject({ row: CountSchema, column: z.string().max(200), message: z.string().max(300) })).max(50),
  errors_omitted: CountSchema, preview: z.array(z.strictObject({ row: CountSchema, metric: MetricKeySchema, value: z.string(), unit: z.string(), observed_at: z.string(), classification: z.enum(['new','duplicate','conflict']) })).max(20),
  historical_result: ImportResultSchema.nullable(),
});
export type ImportMapping = z.infer<typeof ImportMappingSchema>;
export type PreviewCsv = z.infer<typeof PreviewCsvSchema>;
export type ImportPreview = z.infer<typeof ImportPreviewSchema>;
export type ImportResult = z.infer<typeof ImportResultSchema>;

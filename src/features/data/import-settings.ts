import {
  SavedImportDefaultsSchema,
  type ImportMapping,
} from '../../../shared/imports';
import type { Source } from '../../../shared/data';

export function savedMapping(
  source: Source | undefined,
  format: ImportMapping['format'],
  headers: string[],
): ImportMapping | null {
  if (source?.kind !== 'csv') return null;
  const parsed = SavedImportDefaultsSchema.safeParse(source.importDefaults);
  if (!parsed.success || parsed.data.mapping.format !== format) return null;
  const mapping = parsed.data.mapping;
  if (mapping.profile && !headers.includes(mapping.profile.column)) return null;
  if (
    mapping.format === 'wide' &&
    [
      mapping.timestamp_column,
      mapping.local_date_column,
      mapping.external_id_column,
      ...mapping.metrics.map((v) => v.column),
    ].some((column) => column && !headers.includes(column))
  )
    return null;
  return mapping;
}

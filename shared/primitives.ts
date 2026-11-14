import { z } from 'zod';

// Shared schemas run under script-src 'self'. Disable eval probes before schema construction.
z.config({ jitless: true });

export function isPrivatePlainText(value: string): boolean {
  return (
    !value.includes('\0') &&
    !/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
      value,
    )
  );
}

export const UUIDSchema = z.uuid();
export const ISOInstantSchema = z.iso.datetime({ offset: true });
export const LocalDateSchema = z.iso.date();
export const IanaTimezoneSchema = z
  .string()
  .min(1)
  .refine((value) => {
    if (/^[+-]/.test(value)) return false;
    try {
      new Intl.DateTimeFormat('en', { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, 'Expected an IANA timezone or UTC.');
export const DecimalUSDSchema = z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/);
export const HashSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const FiniteNumberSchema = z.number().finite();
export const CountSchema = z
  .number()
  .int()
  .nonnegative()
  .max(Number.MAX_SAFE_INTEGER);
export const VersionSchema = CountSchema.min(1);
export const PageSizeSchema = VersionSchema.max(200);
// Shape only. Authenticity and owner binding require the server's later cursor implementation.
export const OpaqueCursorSchema = z.string().min(1);
export const ModelRoleSchema = z.enum([
  'everyday',
  'intermediate',
  'advanced',
  'decision',
]);
export const AnalysisDepthSchema = z.enum([
  'auto',
  'everyday',
  'intermediate',
  'advanced',
]);
export type UUID = z.infer<typeof UUIDSchema>;
export type ISOInstant = z.infer<typeof ISOInstantSchema>;
export type IanaTimezone = z.infer<typeof IanaTimezoneSchema>;
export type DecimalUSD = z.infer<typeof DecimalUSDSchema>;
export type ModelRole = z.infer<typeof ModelRoleSchema>;
export type AnalysisDepth = z.infer<typeof AnalysisDepthSchema>;

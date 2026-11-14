import { parse } from 'csv-parse/sync';
import { z } from 'zod';

export function readCsvRecords(csv: string): string[][] {
  const records = z
    .array(z.object({ record: z.array(z.string()), raw: z.string() }))
    .parse(
      parse(csv, {
        bom: true,
        skip_empty_lines: true,
        max_record_size: 65536,
        raw: true,
      }),
    );
  if (records.some((row) => Buffer.byteLength(row.raw) > 65536))
    throw new Error('CSV record exceeds 64 KiB.');
  return records.map((row) => row.record);
}

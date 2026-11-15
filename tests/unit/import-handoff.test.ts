import { describe, expect, it } from 'vitest';
import {
  handoffReference,
  importReturnPath,
} from '../../shared/import-handoff';
import { SavedImportDefaultsSchema } from '../../shared/imports';

describe('import continuation and saved assumptions', () => {
  it('carries only an opaque share reference through an allowlisted import destination', () => {
    const hash = '#handoff=12345678-1234-4123-8123-123456789abc';
    expect(handoffReference(hash)).toBe(hash.slice(9));
    expect(importReturnPath('/data/import', hash)).toBe('/data/import' + hash);
    for (const path of [
      '//example.invalid',
      '/data/import?owner=x',
      '/data/../ask',
      'https://example.invalid',
      '/%64ata/import',
    ])
      expect(importReturnPath(path, hash)).toBe('/ask');
    for (const hash of [
      '#handoff=filename.csv',
      '#owner=private',
      '#handoff=12345678-1234-4123-8123-123456789abc&x=y',
    ])
      expect(importReturnPath('/data/import', hash)).toBe('/data/import');
    expect(importReturnPath('/ask', hash)).toBe('/ask');
  });
  it('refuses defaults whose format and adapter disagree or whose confirmation is missing', () => {
    const defaults = {
      schema_version: 2,
      adapter_version: 'renpho-en-body-composition-v1',
      mapping: {
        schema_version: 1,
        format: 'renpho',
        timezone: 'Asia/Kolkata',
        timezone_confirmed: true,
        single_profile: true,
        profile: null,
        review_requested: false,
      },
    };
    expect(SavedImportDefaultsSchema.safeParse(defaults).success).toBe(true);
    expect(
      SavedImportDefaultsSchema.safeParse({
        ...defaults,
        adapter_version: 'csv-v2',
      }).success,
    ).toBe(false);
    expect(
      SavedImportDefaultsSchema.safeParse({
        ...defaults,
        mapping: { ...defaults.mapping, timezone_confirmed: false },
      }).success,
    ).toBe(false);
  });
});

import { describe, expect, it } from 'vitest';
import { savedMapping } from '../../src/features/data/import-settings';
import type { Source } from '../../shared/data';

const source: Source = {
  id: '12345678-1234-4123-8123-123456789abc',
  kind: 'csv',
  label: 'Synthetic source',
  namespace: 'synthetic',
  originApp: null,
  deviceLabel: null,
  method: 'unknown',
  settingsVersion: 2,
  importDefaults: {
    schema_version: 2,
    adapter_version: 'renpho-en-body-composition-v1',
    mapping: {
      schema_version: 1,
      format: 'renpho',
      timezone: 'America/New_York',
      timezone_confirmed: true,
      profile: null,
      single_profile: true,
      review_requested: false,
    },
  },
};
describe('saved import settings', () => {
  it('reuses confirmed timezone/person assumptions across reorder and optional composition fields', () => {
    const a = savedMapping(source, 'renpho', ['Date', 'Time', 'Weight(lb)']);
    expect(a?.timezone).toBe('America/New_York');
    expect(a?.single_profile).toBe(true);
    expect(
      savedMapping(source, 'renpho', ['BMI', 'Time', 'Weight(lb)', 'Date']),
    ).toEqual(a);
  });
  it('requires setup for another format, unsupported adapter, malformed or missing defaults', () => {
    expect(savedMapping(source, 'canonical', [])).toBeNull();
    expect(
      savedMapping(
        {
          ...source,
          importDefaults: {
            ...source.importDefaults,
            adapter_version: 'unknown-v9',
          },
        },
        'renpho',
        [],
      ),
    ).toBeNull();
    expect(
      savedMapping({ ...source, importDefaults: null }, 'renpho', []),
    ).toBeNull();
    expect(
      savedMapping({ ...source, kind: 'manual' }, 'renpho', []),
    ).toBeNull();
  });
});

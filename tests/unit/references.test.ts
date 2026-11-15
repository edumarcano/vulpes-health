import { describe, expect, it } from 'vitest';
import {
  METRIC_CONTENT_VERSION,
  METRIC_REGISTRY_VERSION,
  goalEligibleMetricKeys,
  metricContent,
  metricDisplayGroups,
  metricRegistry,
  registryMetricKeys,
} from '../../shared/metrics.js';
import {
  ReferenceBasisSchema,
  ReferenceQuerySchema,
  type ReferenceBasis,
  type ReferenceRule,
  type ReferenceScope,
} from '../../shared/references.js';
import {
  referenceResultId,
  resolveManufacturerReference,
} from '../../server/analytics/references.js';
import { manufacturerReferenceRules } from '../../server/config/metric-references.js';

// Invented boundaries and source: these fixtures prove resolver mechanics, not
// manufacturer guidance or permission to adopt a production range.
const rule: ReferenceRule = {
  id: 'synthetic-test-index',
  version: 'synthetic-v1',
  metric: 'renpho.visceral_fat_index',
  unit: 'index',
  sourceKind: 'synthetic',
  source: {
    title: 'Synthetic resolver fixture',
    url: 'https://example.invalid/synthetic-only',
    verifiedOn: '2026-11-15',
    reuseRecord: 'Original synthetic fixture; no manufacturer content.',
  },
  scope: {
    app: 'Synthetic app',
    appVersions: ['test-1'],
    models: ['Synthetic model'],
    modes: ['standard'],
  },
  requiredProfileAttributes: [],
  profile: { minimumAgeYears: null, maximumAgeYears: null, sex: null },
  bands: [
    {
      id: 'first',
      label: 'Synthetic first',
      lower: '0',
      upper: '11.25',
      lowerInclusive: true,
      upperInclusive: false,
    },
    {
      id: 'second',
      label: 'Synthetic second',
      lower: '11.25',
      upper: '22.5',
      lowerInclusive: true,
      upperInclusive: false,
    },
    {
      id: 'third',
      label: 'Synthetic third',
      lower: '22.5',
      upper: null,
      lowerInclusive: true,
      upperInclusive: false,
    },
  ],
  limitation: 'Synthetic numerical test, not a health reference.',
};
const scope: ReferenceScope = {
  app: 'Synthetic app',
  appVersion: 'test-1',
  model: 'Synthetic model',
  mode: 'standard',
};
const basis: ReferenceBasis = {
  kind: 'current_guidance',
  profileVersion: null,
  attributes: {},
};
function resolve(
  value: string | null,
  patch: {
    scope?: ReferenceScope;
    basis?: ReferenceBasis | null;
    unit?: string;
  } = {},
  rules: readonly ReferenceRule[] = [rule],
) {
  return resolveManufacturerReference(
    {
      metric: 'renpho.visceral_fat_index',
      unit: 'index',
      value,
      scope,
      basis,
      ...patch,
    },
    rules,
  );
}

describe('reviewed metric content', () => {
  it('covers all 29 registry entries and retains precisely four raw-only fields', () => {
    expect(Object.keys(metricContent).sort()).toEqual(
      [...registryMetricKeys].sort(),
    );
    expect(registryMetricKeys).toHaveLength(29);
    expect(goalEligibleMetricKeys).toHaveLength(25);
    expect(
      registryMetricKeys.filter(
        (metric) => !metricContent[metric].goalEligible,
      ),
    ).toEqual([
      'renpho.bmr',
      'renpho.target_weight_delta',
      'renpho.target_muscle_delta',
      'renpho.target_fat_delta',
    ]);
    for (const metric of registryMetricKeys) {
      expect(metricContent[metric].definition.length).toBeGreaterThan(30);
      expect(
        metricDisplayGroups[metricContent[metric].displayGroup],
      ).toBeTruthy();
      expect(metricContent[metric].goalEligible).toBe(
        metricRegistry[metric].analyticsOperand,
      );
    }
    expect(METRIC_REGISTRY_VERSION).toBe('body-composition-v1');
    expect(METRIC_CONTENT_VERSION).toBe('metric-explanations-v1');
  });
  it('does not adopt a synthetic or unverified manufacturer rule', () => {
    expect(manufacturerReferenceRules).toEqual([]);
    expect(resolve('8', {}, manufacturerReferenceRules)).toMatchObject({
      state: 'unavailable',
      reason: 'unverified_reference',
    });
    expect(
      resolveManufacturerReference(
        { metric: 'renpho.bmr', unit: 'kcal', value: '1600', scope, basis },
        [],
      ),
    ).toMatchObject({ state: 'unavailable', reason: 'unresolved_semantics' });
  });
});

describe('deterministic reference boundaries and applicability', () => {
  it.each([
    ['0', 'first'],
    ['11.249999', 'first'],
    ['11.25', 'second'],
    ['11.250001', 'second'],
    ['22.499999', 'second'],
    ['22.5', 'third'],
    ['22.500001', 'third'],
  ])('classifies %s using explicit endpoint inclusivity', (value, band) => {
    const result = resolve(value);
    expect(result.state).toBe('applicable');
    if (result.state === 'applicable') {
      expect(result.band.id).toBe(band);
      expect(result.rule.sourceKind).toBe('synthetic');
      expect(result.label).toBe(
        'Comparison with current manufacturer guidance',
      );
    }
  });
  it('honors an inclusive upper boundary and exclusive lower boundary', () => {
    const upperInclusive = {
      ...rule,
      bands: [
        { ...rule.bands[0]!, upperInclusive: true },
        { ...rule.bands[1]!, lowerInclusive: false },
        rule.bands[2]!,
      ],
    };
    const result = resolve('11.25', {}, [upperInclusive]);
    expect(result.state === 'applicable' && result.band.id).toBe('first');
    const after = resolve('11.25001', {}, [upperInclusive]);
    expect(after.state === 'applicable' && after.band.id).toBe('second');
  });
  it('refuses overlapping, reversed, duplicate or unit-inconsistent rules', () => {
    const invalid: ReferenceRule[] = [
      {
        ...rule,
        bands: [
          { ...rule.bands[0]!, upperInclusive: true },
          ...rule.bands.slice(1),
        ],
      },
      { ...rule, bands: [{ ...rule.bands[0]!, lower: '30' }] },
      { ...rule, bands: [rule.bands[0]!, { ...rule.bands[1]!, id: 'first' }] },
      { ...rule, unit: '%' },
    ];
    for (const candidate of invalid)
      expect(resolve('8', {}, [candidate])).toMatchObject({
        state: 'unavailable',
        reason: 'unverified_reference',
      });
  });
  it('keeps gaps, missing measurements and invalid values unavailable', () => {
    const gap = {
      ...rule,
      bands: [{ ...rule.bands[0]!, upper: '8' }, ...rule.bands.slice(1)],
    };
    expect(resolve('8.5', {}, [gap])).toMatchObject({
      state: 'unavailable',
      reason: 'outside_verified_bands',
    });
    expect(resolve(null)).toMatchObject({
      state: 'unavailable',
      reason: 'no_measurement',
    });
    expect(resolve('NaN')).toMatchObject({
      state: 'unavailable',
      reason: 'invalid_measurement',
    });
  });
  it.each(['app', 'appVersion', 'model', 'mode'] as const)(
    'rejects mismatched %s without guessing applicability',
    (field) => {
      expect(
        resolve('8', { scope: { ...scope, [field]: 'different' } }),
      ).toMatchObject({ state: 'not_applicable', reason: 'scope_mismatch' });
      expect(
        resolve('8', { scope: { ...scope, [field]: null } }),
      ).toMatchObject({
        state: 'unavailable',
        reason: 'applicability_unverified',
      });
    },
  );
  it('requires correct units rather than converting an index into a percentage', () => {
    expect(resolve('8', { unit: '%' })).toMatchObject({
      state: 'not_applicable',
      reason: 'unit_mismatch',
    });
  });
  it('handles declined attributes and exact profile limits', () => {
    const profiled: ReferenceRule = {
      ...rule,
      requiredProfileAttributes: ['ageYears', 'sex'],
      profile: { minimumAgeYears: 20, maximumAgeYears: 40, sex: 'female' },
    };
    expect(resolve('8', {}, [profiled])).toMatchObject({
      state: 'missing_profile',
      requiredAttributes: ['ageYears', 'sex'],
    });
    for (const ageYears of [20, 40])
      expect(
        resolve(
          '8',
          {
            basis: {
              kind: 'current_guidance',
              profileVersion: 'synthetic-profile-1',
              attributes: { ageYears, sex: 'female' },
            },
          },
          [profiled],
        ),
      ).toMatchObject({ state: 'applicable' });
    for (const ageYears of [19, 41])
      expect(
        resolve(
          '8',
          {
            basis: {
              kind: 'current_guidance',
              profileVersion: 'synthetic-profile-1',
              attributes: { ageYears, sex: 'female' },
            },
          },
          [profiled],
        ),
      ).toMatchObject({ state: 'not_applicable', reason: 'profile_mismatch' });
    expect(
      resolve(
        '8',
        {
          basis: {
            kind: 'current_guidance',
            profileVersion: 'synthetic-profile-1',
            attributes: { ageYears: 30, sex: 'male' },
          },
        },
        [profiled],
      ),
    ).toMatchObject({ state: 'not_applicable', reason: 'profile_mismatch' });
  });
  it('distinguishes current comparison from genuinely recorded historical basis', () => {
    expect(resolve('8', { basis: null })).toMatchObject({
      state: 'unavailable',
      reason: 'historical_basis_unavailable',
    });
    const historical: ReferenceBasis = {
      kind: 'historical',
      referenceVersion: 'synthetic-v1',
      profileVersion: 'recorded-profile-v1',
      attributes: {},
    };
    expect(resolve('8', { basis: historical })).toMatchObject({
      state: 'applicable',
      label: 'Historical manufacturer guidance with recorded profile basis',
    });
    expect(
      resolve('8', {
        basis: { ...historical, referenceVersion: 'missing-v0' },
      }),
    ).toMatchObject({
      state: 'unavailable',
      reason: 'reference_version_unavailable',
    });
    expect(
      ReferenceBasisSchema.safeParse({
        kind: 'historical',
        referenceVersion: 'synthetic-v1',
        attributes: {},
      }).success,
    ).toBe(false);
  });
  it('refuses ambiguous applicable rules instead of choosing one by array order', () => {
    expect(resolve('8', {}, [rule, { ...rule, id: 'another' }])).toMatchObject({
      state: 'unavailable',
      reason: 'ambiguous_reference',
    });
  });
});

describe('reference identity and selection contracts', () => {
  const identity = {
    owner: '00000000-0000-4000-8000-000000000001',
    selection: {
      metric: 'renpho.visceral_fat_index',
      source_id: '00000000-0000-4000-8000-000000000002',
    },
    analysisResultId: `analysis:${'a'.repeat(64)}`,
    dataRevision: 7,
    referenceRegistryVersion: 'synthetic-registry-v1',
    basis,
  };
  it('binds the owned numerical result, content, reference and profile versions separately', () => {
    const id = referenceResultId(identity);
    expect(id).toBe(
      referenceResultId({
        ...identity,
        selection: {
          source_id: identity.selection.source_id,
          metric: identity.selection.metric,
        },
      }),
    );
    const changes = [
      { ...identity, owner: '00000000-0000-4000-8000-000000000003' },
      { ...identity, dataRevision: 8 },
      { ...identity, analysisResultId: `analysis:${'b'.repeat(64)}` },
      { ...identity, referenceRegistryVersion: 'synthetic-registry-v2' },
      { ...identity, basis: { ...basis, profileVersion: 'new-basis' } },
    ];
    for (const change of changes)
      expect(referenceResultId(change)).not.toBe(id);
  });
  it('requires complete window and expected result pairs and rejects profile/account inputs', () => {
    const query = {
      view: 'reference',
      metric: 'weight',
      source_id: identity.selection.source_id,
      method: 'device_reported',
      granularity: 'instant',
      timezone: 'UTC',
    };
    expect(ReferenceQuerySchema.safeParse(query).success).toBe(true);
    expect(
      ReferenceQuerySchema.safeParse({ ...query, from: '2026-09-01T00:00:00Z' })
        .success,
    ).toBe(false);
    expect(
      ReferenceQuerySchema.safeParse({
        ...query,
        expected_result_id: `reference:${'a'.repeat(64)}`,
      }).success,
    ).toBe(false);
    expect(
      ReferenceQuerySchema.safeParse({ ...query, owner: identity.owner })
        .success,
    ).toBe(false);
    expect(
      ReferenceQuerySchema.safeParse({ ...query, profile: { ageYears: 30 } })
        .success,
    ).toBe(false);
  });
});

import { createHash } from 'node:crypto';
import {
  REFERENCE_RESOLVER_VERSION,
  ReferenceClassificationSchema,
  ReferenceRuleSchema,
  type ReferenceBasis,
  type ReferenceClassification,
  type ReferenceRule,
  type ReferenceScope,
} from '../../shared/references.js';
import {
  METRIC_CONTENT_VERSION,
  metricRegistry,
  type RegistryMetric,
} from '../../shared/metrics.js';
import { Exact } from './measurements.js';

const unavailable = (
  reason: Extract<ReferenceClassification, { state: 'unavailable' }>['reason'],
): ReferenceClassification => ({
  state: 'unavailable',
  reason,
  message: 'Manufacturer reference unavailable',
});

function validRule(rule: ReferenceRule): boolean {
  if (!ReferenceRuleSchema.safeParse(rule).success) return false;
  if (rule.unit !== metricRegistry[rule.metric].canonicalUnit) return false;
  if (
    rule.requiredProfileAttributes.length !==
      new Set(rule.requiredProfileAttributes).size ||
    (rule.profile.minimumAgeYears !== null &&
      !rule.requiredProfileAttributes.includes('ageYears')) ||
    (rule.profile.maximumAgeYears !== null &&
      !rule.requiredProfileAttributes.includes('ageYears')) ||
    (rule.profile.sex !== null &&
      !rule.requiredProfileAttributes.includes('sex')) ||
    (rule.profile.minimumAgeYears !== null &&
      rule.profile.maximumAgeYears !== null &&
      rule.profile.minimumAgeYears > rule.profile.maximumAgeYears) ||
    new Set(rule.bands.map((band) => band.id)).size !== rule.bands.length
  )
    return false;
  const bands = rule.bands;
  for (const [index, band] of bands.entries()) {
    if (band.lower !== null && band.upper !== null) {
      const order = new Exact(band.lower).comparedTo(band.upper);
      if (
        order > 0 ||
        (order === 0 && (!band.lowerInclusive || !band.upperInclusive))
      )
        return false;
    }
    const previous = bands[index - 1];
    if (previous) {
      if (previous.upper === null || band.lower === null) return false;
      const order = new Exact(previous.upper).comparedTo(band.lower);
      if (
        order > 0 ||
        (order === 0 && previous.upperInclusive && band.lowerInclusive)
      )
        return false;
    }
  }
  return true;
}

export function resolveManufacturerReference(
  input: {
    metric: RegistryMetric;
    unit: string;
    value: string | null;
    scope: ReferenceScope;
    basis: ReferenceBasis | null;
  },
  rules: readonly ReferenceRule[],
): ReferenceClassification {
  const definition = metricRegistry[input.metric];
  if (!definition.analyticsOperand) return unavailable('unresolved_semantics');
  if (input.unit !== definition.canonicalUnit)
    return {
      state: 'not_applicable',
      reason: 'unit_mismatch',
      message: 'The reference unit does not match this reading.',
    };
  let candidates = rules.filter((rule) => rule.metric === input.metric);
  if (!candidates.length) return unavailable('unverified_reference');
  if (candidates.some((rule) => !validRule(rule)))
    return unavailable('unverified_reference');
  if (input.basis?.kind === 'historical') {
    const version = input.basis.referenceVersion;
    candidates = candidates.filter((rule) => rule.version === version);
    if (!candidates.length) return unavailable('reference_version_unavailable');
  }
  if (input.basis === null) return unavailable('historical_basis_unavailable');
  if (input.scope.app === null) return unavailable('applicability_unverified');
  const scopeCandidates = candidates.filter(
    (rule) =>
      rule.scope.app === input.scope.app &&
      (!rule.scope.appVersions ||
        input.scope.appVersion === null ||
        rule.scope.appVersions.includes(input.scope.appVersion)) &&
      (!rule.scope.models ||
        input.scope.model === null ||
        rule.scope.models.includes(input.scope.model)) &&
      (!rule.scope.modes ||
        input.scope.mode === null ||
        rule.scope.modes.includes(input.scope.mode)),
  );
  if (!scopeCandidates.length)
    return {
      state: 'not_applicable',
      reason: 'scope_mismatch',
      message:
        'This manufacturer reference does not apply to the recorded app, model or mode.',
    };
  if (
    scopeCandidates.some(
      (rule) =>
        (rule.scope.appVersions && input.scope.appVersion === null) ||
        (rule.scope.models && input.scope.model === null) ||
        (rule.scope.modes && input.scope.mode === null),
    )
  )
    return unavailable('applicability_unverified');
  const missing = [
    ...new Set(
      scopeCandidates.flatMap((rule) =>
        rule.requiredProfileAttributes.filter(
          (attribute) => input.basis!.attributes[attribute] === undefined,
        ),
      ),
    ),
  ];
  if (missing.length)
    return ReferenceClassificationSchema.parse({
      state: 'missing_profile',
      requiredAttributes: missing,
      message: 'More profile information needed',
    });
  const profileCandidates = scopeCandidates.filter((rule) => {
    const { ageYears, sex } = input.basis!.attributes;
    return (
      (rule.profile.minimumAgeYears === null ||
        (ageYears !== undefined && ageYears >= rule.profile.minimumAgeYears)) &&
      (rule.profile.maximumAgeYears === null ||
        (ageYears !== undefined && ageYears <= rule.profile.maximumAgeYears)) &&
      (rule.profile.sex === null || sex === rule.profile.sex)
    );
  });
  if (!profileCandidates.length)
    return {
      state: 'not_applicable',
      reason: 'profile_mismatch',
      message:
        'This manufacturer reference does not apply to the supplied profile basis.',
    };
  if (profileCandidates.length !== 1) return unavailable('ambiguous_reference');
  if (input.value === null) return unavailable('no_measurement');
  if (
    !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(input.value) ||
    input.value.length > 1024
  )
    return unavailable('invalid_measurement');
  const value = new Exact(input.value);
  const rule = profileCandidates[0]!;
  const band = rule.bands.find(
    (item) =>
      (item.lower === null ||
        (item.lowerInclusive ? value.gte(item.lower) : value.gt(item.lower))) &&
      (item.upper === null ||
        (item.upperInclusive ? value.lte(item.upper) : value.lt(item.upper))),
  );
  if (!band) return unavailable('outside_verified_bands');
  return ReferenceClassificationSchema.parse({
    state: 'applicable',
    rule,
    band,
    basis: input.basis,
    label:
      input.basis.kind === 'current_guidance'
        ? 'Comparison with current manufacturer guidance'
        : 'Historical manufacturer guidance with recorded profile basis',
  });
}

export function referenceResultId(input: {
  owner: string;
  selection: unknown;
  analysisResultId: string | null;
  dataRevision: number;
  referenceRegistryVersion: string;
  basis: ReferenceBasis | null;
}) {
  function canonical(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object')
      return Object.fromEntries(
        Object.entries(value)
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([key, item]) => [key, canonical(item)]),
      );
    return value;
  }
  return `reference:${createHash('sha256')
    .update(
      JSON.stringify(
        canonical([REFERENCE_RESOLVER_VERSION, METRIC_CONTENT_VERSION, input]),
      ),
    )
    .digest('hex')}`;
}

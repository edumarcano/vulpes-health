import { z } from 'zod';

export const METRIC_REGISTRY_VERSION = 'body-composition-v1';
export const RENPHO_ADAPTER_VERSION = 'renpho-en-body-composition-v1';
export const METRIC_CONTENT_VERSION = 'metric-explanations-v1';

export const metricRegistry = {
  weight: {
    label: 'Weight',
    canonicalUnit: 'kg',
    units: ['kg', 'lb'],
    representation: 'positive',
    method: 'device_reported',
    group: 'weight_size',
    semantics: 'resolved_for_tracking',
    analyticsOperand: true,
    limitation: 'Mass reported by source; no clinical range.',
    renphoHeader: 'Weight(lb)',
    renphoUnit: 'lb',
  },
  'renpho.bmi': {
    label: 'BMI',
    canonicalUnit: 'kg/m2',
    units: ['kg/m2'],
    representation: 'positive',
    method: 'device_estimate',
    group: 'weight_size',
    semantics: 'resolved_for_tracking',
    analyticsOperand: true,
    limitation:
      'Vendor-calculated BMI; do not substitute a Vulpes calculation.',
    renphoHeader: 'BMI',
    renphoUnit: 'kg/m2',
  },
  body_fat_percent: {
    label: 'Body fat (device estimate)',
    canonicalUnit: '%',
    units: ['%'],
    representation: 'percentage',
    method: 'device_estimate',
    group: 'composition',
    semantics: 'resolved_for_tracking',
    analyticsOperand: true,
    limitation: 'Vendor estimate; distinct from fat mass.',
    renphoHeader: 'Body Fat Percentage(%)',
    renphoUnit: '%',
  },
  'renpho.body_fat_mass': {
    label: 'Body Fat Mass',
    canonicalUnit: 'kg',
    units: ['kg', 'lb'],
    representation: 'nonnegative',
    method: 'device_estimate',
    group: 'composition',
    semantics: 'resolved_for_tracking',
    analyticsOperand: true,
    limitation: 'Distinct from body-fat percentage.',
    renphoHeader: 'Body Fat Mass(lb)',
    renphoUnit: 'lb',
  },
  'renpho.muscle_percent': {
    label: 'Muscle Percentage',
    canonicalUnit: '%',
    units: ['%'],
    representation: 'percentage',
    method: 'device_estimate',
    group: 'composition',
    semantics: 'resolved_for_tracking',
    analyticsOperand: true,
    limitation: 'Vendor muscle definition; not skeletal muscle.',
    renphoHeader: 'Muscle Percentage(%)',
    renphoUnit: '%',
  },
  'renpho.muscle_mass': {
    label: 'Muscle Mass',
    canonicalUnit: 'kg',
    units: ['kg', 'lb'],
    representation: 'nonnegative',
    method: 'device_estimate',
    group: 'composition',
    semantics: 'resolved_for_tracking',
    analyticsOperand: true,
    limitation: 'Not fat-free mass or skeletal muscle mass.',
    renphoHeader: 'Muscle Mass(lb)',
    renphoUnit: 'lb',
  },
  'renpho.skeletal_muscle_percent': {
    label: 'Skeletal Muscle Percentage',
    canonicalUnit: '%',
    units: ['%'],
    representation: 'percentage',
    method: 'device_estimate',
    group: 'composition',
    semantics: 'resolved_for_tracking',
    analyticsOperand: true,
    limitation: 'Distinct from total muscle percentage.',
    renphoHeader: 'Skeletal Muscle Percentage(%)',
    renphoUnit: '%',
  },
  'renpho.skeletal_muscle_mass': {
    label: 'Skeletal Muscle Mass',
    canonicalUnit: 'kg',
    units: ['kg', 'lb'],
    representation: 'nonnegative',
    method: 'device_estimate',
    group: 'composition',
    semantics: 'resolved_for_tracking',
    analyticsOperand: true,
    limitation: 'Distinct from total muscle mass.',
    renphoHeader: 'Skeletal Muscle Mass(lb)',
    renphoUnit: 'lb',
  },
  'renpho.bone_percent': {
    label: 'Bone Percentage',
    canonicalUnit: '%',
    units: ['%'],
    representation: 'percentage',
    method: 'device_estimate',
    group: 'composition',
    semantics: 'resolved_for_tracking',
    analyticsOperand: true,
    limitation: 'Vendor estimate; not bone density.',
    renphoHeader: 'Bone Percentage(%)',
    renphoUnit: '%',
  },
  'renpho.bone_mass': {
    label: 'Bone Mass',
    canonicalUnit: 'kg',
    units: ['kg', 'lb'],
    representation: 'nonnegative',
    method: 'device_estimate',
    group: 'composition',
    semantics: 'resolved_for_tracking',
    analyticsOperand: true,
    limitation: 'Not bone mineral density.',
    renphoHeader: 'Bone Mass(lb)',
    renphoUnit: 'lb',
  },
  'renpho.protein_percent': {
    label: 'Protein Percentage',
    canonicalUnit: '%',
    units: ['%'],
    representation: 'percentage',
    method: 'device_estimate',
    group: 'composition',
    semantics: 'resolved_for_tracking',
    analyticsOperand: true,
    limitation: 'Body-composition estimate; not dietary protein.',
    renphoHeader: 'Protein Percentage(%)',
    renphoUnit: '%',
  },
  'renpho.protein_mass': {
    label: 'Protein Mass',
    canonicalUnit: 'kg',
    units: ['kg', 'lb'],
    representation: 'nonnegative',
    method: 'device_estimate',
    group: 'composition',
    semantics: 'resolved_for_tracking',
    analyticsOperand: true,
    limitation: 'Body-composition estimate; not dietary intake.',
    renphoHeader: 'Protein Mass(lb)',
    renphoUnit: 'lb',
  },
  'renpho.body_water_percent': {
    label: 'Body Water Percentage',
    canonicalUnit: '%',
    units: ['%'],
    representation: 'percentage',
    method: 'device_estimate',
    group: 'composition',
    semantics: 'resolved_for_tracking',
    analyticsOperand: true,
    limitation: 'Estimate; not a hydration diagnosis.',
    renphoHeader: 'Body Water Percentage(%)',
    renphoUnit: '%',
  },
  'renpho.body_water_mass': {
    label: 'Body Water Mass',
    canonicalUnit: 'kg',
    units: ['kg', 'lb'],
    representation: 'nonnegative',
    method: 'device_estimate',
    group: 'composition',
    semantics: 'resolved_for_tracking',
    analyticsOperand: true,
    limitation: 'Preserve separately from water percentage.',
    renphoHeader: 'Body Water Mass(lb)',
    renphoUnit: 'lb',
  },
  'renpho.fat_free_mass': {
    label: 'Fat-Free Mass',
    canonicalUnit: 'kg',
    units: ['kg', 'lb'],
    representation: 'nonnegative',
    method: 'device_estimate',
    group: 'composition',
    semantics: 'resolved_for_tracking',
    analyticsOperand: true,
    limitation: 'Not muscle mass; components need not partition the body.',
    renphoHeader: 'Fat-Free Mass(lb)',
    renphoUnit: 'lb',
  },
  'renpho.subcutaneous_fat_percent': {
    label: 'Subcutaneous Fat',
    canonicalUnit: '%',
    units: ['%'],
    representation: 'percentage',
    method: 'device_estimate',
    group: 'composition',
    semantics: 'resolved_for_tracking',
    analyticsOperand: true,
    limitation: 'Source-specific estimate.',
    renphoHeader: 'Subcutaneous Fat(%)',
    renphoUnit: '%',
  },
  'renpho.visceral_fat_index': {
    label: 'RENPHO visceral fat index (device estimate)',
    canonicalUnit: 'index',
    units: ['index'],
    representation: 'nonnegative',
    method: 'device_estimate',
    group: 'vendor_estimates',
    semantics: 'resolved_for_tracking',
    analyticsOperand: true,
    limitation:
      'Proprietary index; no clinical conversion or integer truncation.',
    renphoHeader: 'Visceral Fat',
    renphoUnit: 'index',
  },
  'renpho.bmr': {
    label: 'BMR',
    canonicalUnit: 'kcal',
    units: ['kcal'],
    representation: 'positive',
    method: 'device_estimate',
    group: 'vendor_estimates',
    semantics: 'unresolved_time_basis',
    analyticsOperand: false,
    limitation:
      'Preserve raw kcal; export-specific time basis unverified; not intake advice.',
    renphoHeader: 'BMR(kcal)',
    renphoUnit: 'kcal',
  },
  'renpho.metabolic_age': {
    label: 'Metabolic Age',
    canonicalUnit: 'years',
    units: ['years'],
    representation: 'nonnegative',
    method: 'device_estimate',
    group: 'vendor_estimates',
    semantics: 'resolved_for_tracking',
    analyticsOperand: true,
    limitation:
      'Vendor age-like estimate; not chronological age; preserve decimals.',
    renphoHeader: 'Metabolic Age',
    renphoUnit: 'years',
  },
  'renpho.waist_hip_ratio': {
    label: 'WHR (Waist-to-Hip Ratio)',
    canonicalUnit: 'ratio',
    units: ['ratio'],
    representation: 'positive',
    method: 'device_estimate',
    group: 'vendor_estimates',
    semantics: 'resolved_for_tracking',
    analyticsOperand: true,
    limitation: 'Do not infer waist/hip measurements.',
    renphoHeader: 'WHR (Waist-to-Hip Ratio)',
    renphoUnit: 'ratio',
  },
  'renpho.optimal_weight': {
    label: 'Optimal Weight',
    canonicalUnit: 'kg',
    units: ['kg', 'lb'],
    representation: 'positive',
    method: 'device_estimate',
    group: 'vendor_estimates',
    semantics: 'resolved_for_tracking',
    analyticsOperand: true,
    limitation: 'Manufacturer reference; not an approved/recommended goal.',
    renphoHeader: 'Optimal Weight(lb)',
    renphoUnit: 'lb',
  },
  'renpho.target_weight_delta': {
    label: 'Target to optimal weight',
    canonicalUnit: 'kg',
    units: ['kg', 'lb'],
    representation: 'signed',
    method: 'device_estimate',
    group: 'vendor_estimates',
    semantics: 'unresolved_direction',
    analyticsOperand: false,
    limitation: 'Sign preserved; precise source direction remains unverified.',
    renphoHeader: 'Target to optimal weight(lb)',
    renphoUnit: 'lb',
  },
  'renpho.target_muscle_delta': {
    label: 'Target to optimal muscle mass',
    canonicalUnit: 'kg',
    units: ['kg', 'lb'],
    representation: 'signed',
    method: 'device_estimate',
    group: 'vendor_estimates',
    semantics: 'unresolved_direction',
    analyticsOperand: false,
    limitation: 'Sign preserved; precise source direction remains unverified.',
    renphoHeader: 'Target to optimal muscle mass(lb)',
    renphoUnit: 'lb',
  },
  'renpho.target_fat_delta': {
    label: 'Target to optimal fat mass',
    canonicalUnit: 'kg',
    units: ['kg', 'lb'],
    representation: 'signed',
    method: 'device_estimate',
    group: 'vendor_estimates',
    semantics: 'unresolved_direction',
    analyticsOperand: false,
    limitation: 'Sign preserved; precise source direction remains unverified.',
    renphoHeader: 'Target to optimal fat mass(lb)',
    renphoUnit: 'lb',
  },
  heart_rate: {
    label: 'Observed heart rate',
    canonicalUnit: 'bpm',
    units: ['bpm'],
    representation: 'positive',
    method: 'unknown',
    group: 'other',
    semantics: 'resolved_for_tracking',
    analyticsOperand: true,
    limitation: 'Keep the recorded source and method.',
    renphoHeader: null,
    renphoUnit: null,
  },
  resting_heart_rate: {
    label: 'Explicitly resting heart rate',
    canonicalUnit: 'bpm',
    units: ['bpm'],
    representation: 'positive',
    method: 'unknown',
    group: 'other',
    semantics: 'resolved_for_tracking',
    analyticsOperand: true,
    limitation: 'Keep the recorded source and method.',
    renphoHeader: null,
    renphoUnit: null,
  },
  height: {
    label: 'Height',
    canonicalUnit: 'cm',
    units: ['cm', 'm', 'in'],
    representation: 'positive',
    method: 'unknown',
    group: 'other',
    semantics: 'resolved_for_tracking',
    analyticsOperand: true,
    limitation: 'Keep the recorded source and method.',
    renphoHeader: null,
    renphoUnit: null,
  },
  steps_daily: {
    label: 'Daily steps',
    canonicalUnit: 'count',
    units: ['count'],
    representation: 'integer',
    method: 'unknown',
    group: 'other',
    semantics: 'resolved_for_tracking',
    analyticsOperand: true,
    limitation: 'Keep the recorded source and method.',
    renphoHeader: null,
    renphoUnit: null,
  },
  sleep_duration: {
    label: 'Sleep duration',
    canonicalUnit: 'min',
    units: ['min', 'h'],
    representation: 'nonnegative',
    method: 'unknown',
    group: 'other',
    semantics: 'resolved_for_tracking',
    analyticsOperand: true,
    limitation: 'Keep the recorded source and method.',
    renphoHeader: null,
    renphoUnit: null,
  },
} as const;

export type RegistryMetric = keyof typeof metricRegistry;
export const metricDisplayGroups = {
  weight_size: 'Weight and body size',
  fat: 'Fat',
  muscle: 'Muscle',
  water: 'Water',
  bone_protein: 'Bone and protein',
  estimates: 'Other estimates and references',
  other: 'Other measurements',
} as const;

// Product explanations are versioned separately from import representation.
export const metricContent = {
  weight: {
    displayGroup: 'weight_size',
    definition: 'The body mass recorded by the source at a particular time.',
    goalEligible: true,
  },
  'renpho.bmi': {
    displayGroup: 'weight_size',
    definition:
      "The source's body mass index, relating body mass to height. Vulpes preserves this exported value rather than recalculating it.",
    goalEligible: true,
  },
  body_fat_percent: {
    displayGroup: 'fat',
    definition:
      'The estimated share of body mass represented by fat. This percentage is distinct from the mass of fat.',
    goalEligible: true,
  },
  'renpho.body_fat_mass': {
    displayGroup: 'fat',
    definition:
      "The source's estimated mass of body fat. It is a mass value, not a percentage.",
    goalEligible: true,
  },
  'renpho.muscle_percent': {
    displayGroup: 'muscle',
    definition:
      "The share of body mass assigned to muscle by the vendor's estimation method. Its definition differs from skeletal muscle percentage.",
    goalEligible: true,
  },
  'renpho.muscle_mass': {
    displayGroup: 'muscle',
    definition:
      "The mass assigned to muscle by the vendor's estimation method. It is distinct from skeletal muscle mass and fat-free mass.",
    goalEligible: true,
  },
  'renpho.skeletal_muscle_percent': {
    displayGroup: 'muscle',
    definition:
      "The vendor's estimated share of body mass associated with skeletal muscle, the muscles that move the skeleton.",
    goalEligible: true,
  },
  'renpho.skeletal_muscle_mass': {
    displayGroup: 'muscle',
    definition:
      "The vendor's estimated mass of skeletal muscle. Do not substitute total muscle mass for this value.",
    goalEligible: true,
  },
  'renpho.bone_percent': {
    displayGroup: 'bone_protein',
    definition:
      "The share of body mass assigned to bone by the vendor's estimate. It does not measure bone density.",
    goalEligible: true,
  },
  'renpho.bone_mass': {
    displayGroup: 'bone_protein',
    definition:
      "The vendor's estimated bone mass. This scale output is not a bone mineral density examination.",
    goalEligible: true,
  },
  'renpho.protein_percent': {
    displayGroup: 'bone_protein',
    definition:
      "The share of body mass assigned to protein by the vendor's estimate. It is not the percentage of protein in the diet.",
    goalEligible: true,
  },
  'renpho.protein_mass': {
    displayGroup: 'bone_protein',
    definition:
      "The vendor's estimate of protein mass in the body. It does not describe dietary protein intake.",
    goalEligible: true,
  },
  'renpho.body_water_percent': {
    displayGroup: 'water',
    definition:
      "The vendor's estimated share of body mass represented by water. A single value cannot diagnose hydration status.",
    goalEligible: true,
  },
  'renpho.body_water_mass': {
    displayGroup: 'water',
    definition:
      "The vendor's estimated mass of water in the body, preserved separately from water percentage.",
    goalEligible: true,
  },
  'renpho.fat_free_mass': {
    displayGroup: 'fat',
    definition:
      "The vendor's estimated body mass excluding fat. It includes more than muscle and must not be treated as muscle mass.",
    goalEligible: true,
  },
  'renpho.subcutaneous_fat_percent': {
    displayGroup: 'fat',
    definition:
      "The vendor's estimate associated with fat beneath the skin. Its scope is distinct from total body fat and visceral fat.",
    goalEligible: true,
  },
  'renpho.visceral_fat_index': {
    displayGroup: 'estimates',
    definition:
      'A proprietary vendor index estimating fat around abdominal organs. It is not a mass, percentage or score comparable across manufacturers.',
    goalEligible: true,
  },
  'renpho.bmr': {
    displayGroup: 'estimates',
    definition:
      "The exported basal-metabolism estimate in kcal. This export's time basis is unverified, so Vulpes preserves it as a raw value only.",
    goalEligible: false,
  },
  'renpho.metabolic_age': {
    displayGroup: 'estimates',
    definition:
      "An age-like vendor estimate derived from its body-composition model. It is not the person's chronological age or a diagnosis.",
    goalEligible: true,
  },
  'renpho.waist_hip_ratio': {
    displayGroup: 'estimates',
    definition:
      "The source's waist-to-hip ratio value. Vulpes does not infer actual waist or hip measurements from this output.",
    goalEligible: true,
  },
  'renpho.optimal_weight': {
    displayGroup: 'estimates',
    definition:
      'A weight reference produced by the vendor. Its name does not make it a Vulpes recommendation or an approved personal goal.',
    goalEligible: true,
  },
  'renpho.target_weight_delta': {
    displayGroup: 'estimates',
    definition:
      'The exported signed weight delta. Its direction relative to the vendor reference is unverified; Vulpes does not interpret the sign as an instruction.',
    goalEligible: false,
  },
  'renpho.target_muscle_delta': {
    displayGroup: 'estimates',
    definition:
      'The exported signed muscle-mass delta. Its direction relative to the vendor reference is unverified, so it remains a raw value.',
    goalEligible: false,
  },
  'renpho.target_fat_delta': {
    displayGroup: 'estimates',
    definition:
      'The exported signed fat-mass delta. Its direction relative to the vendor reference is unverified, so it remains a raw value.',
    goalEligible: false,
  },
  heart_rate: {
    displayGroup: 'other',
    definition:
      'The recorded heart rate at observation time. A resting state is not assumed unless the source explicitly identifies it.',
    goalEligible: true,
  },
  resting_heart_rate: {
    displayGroup: 'other',
    definition:
      'A heart-rate reading explicitly identified by its source as resting, rather than an arbitrary observed pulse.',
    goalEligible: true,
  },
  height: {
    displayGroup: 'weight_size',
    definition:
      'The stature recorded by the source, with its original unit retained.',
    goalEligible: true,
  },
  steps_daily: {
    displayGroup: 'other',
    definition:
      'The number of steps recorded for one local calendar day. Daily totals remain separate from instantaneous readings.',
    goalEligible: true,
  },
  sleep_duration: {
    displayGroup: 'other',
    definition:
      'The duration of recorded sleep. Session totals and daily totals retain their separate meanings.',
    goalEligible: true,
  },
} as const satisfies Record<
  RegistryMetric,
  {
    displayGroup: keyof typeof metricDisplayGroups;
    definition: string;
    goalEligible: boolean;
  }
>;

export const goalEligibleMetricKeys = (
  Object.keys(metricContent) as RegistryMetric[]
).filter((metric) => metricContent[metric].goalEligible);
export const metricEstimateCaution =
  'Device estimates may overlap and are not independent corroborating measurements. Do not add components together or infer physiological change from one estimate.';
export const metricGoalCaution =
  'Eligibility for tracking does not mean that increasing or decreasing this value is advisable. Manufacturer references do not set personal goals.';
export const legacyMetricKeys = [
  'weight',
  'body_fat_percent',
  'renpho.visceral_fat_index',
  'heart_rate',
  'resting_heart_rate',
  'height',
  'steps_daily',
  'sleep_duration',
] as const;
export const LegacyMetricKeySchema = z.enum(legacyMetricKeys);
export const LegacyCanonicalUnitSchema = z.enum([
  'kg',
  '%',
  'index',
  'bpm',
  'cm',
  'count',
  'min',
]);
export const registryMetricKeys = Object.keys(metricRegistry) as [
  RegistryMetric,
  ...RegistryMetric[],
];
export const MetricKeySchema = z.enum(registryMetricKeys);
export const CanonicalUnitSchema = z.enum([
  'kg',
  '%',
  'index',
  'bpm',
  'cm',
  'count',
  'min',
  'kg/m2',
  'ratio',
  'kcal',
  'years',
]);
export const InputUnitSchema = z.enum([
  ...CanonicalUnitSchema.options,
  'lb',
  'm',
  'in',
  'h',
]);
export const metricUnits = Object.fromEntries(
  registryMetricKeys.map((key) => [key, metricRegistry[key].canonicalUnit]),
) as { [K in RegistryMetric]: (typeof metricRegistry)[K]['canonicalUnit'] };

export function validMetricNumber(
  metric: RegistryMetric,
  value: number,
): boolean {
  if (!Number.isFinite(value)) return false;
  switch (metricRegistry[metric].representation) {
    case 'positive':
      return value > 0;
    case 'nonnegative':
      return value >= 0;
    case 'percentage':
      return value >= 0 && value <= 100;
    case 'integer':
      return Number.isSafeInteger(value) && value >= 0;
    case 'signed':
      return true;
  }
}

export const unitFactors: Readonly<Record<string, string>> = {
  lb: '0.45359237',
  m: '100',
  in: '2.54',
  h: '60',
};

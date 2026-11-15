import type { ReferenceRule } from '../../shared/references.js';

export const REFERENCE_REGISTRY_VERSION =
  'manufacturer-references-unavailable-v1';

// No reviewed source currently establishes complete applicability, boundaries
// and a reuse basis. Synthetic resolver fixtures never enter this registry.
export const manufacturerReferenceRules: readonly ReferenceRule[] = [];

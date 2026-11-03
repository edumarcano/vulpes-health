import { normalizeObservation } from '../../server/analytics/measurements.js';
import type { ObservationInput } from '../../shared/data.js';

// Fixture adapters only: no CSV importer, platform SDK, permissions, or sync.
export function canonicalFixtureObservation(row: {
  observed_at: string;
  metric: ObservationInput['metric'];
  value: string;
  unit: ObservationInput['unit'];
  timezone: string;
  method: ObservationInput['method'];
}) {
  return normalizeObservation({
    ...row,
    local_date: null,
    granularity: 'instant',
    quality_flags: [],
  });
}
export function healthConnectWeightFixture(record: {
  time: string;
  zone: string;
  mass: { amount: string; unit: 'kg' | 'lb' };
}) {
  return normalizeObservation({
    metric: 'weight',
    value: record.mass.amount,
    unit: record.mass.unit,
    observed_at: record.time,
    timezone: record.zone,
    local_date: null,
    granularity: 'instant',
    method: 'device_reported',
    quality_flags: [],
  });
}

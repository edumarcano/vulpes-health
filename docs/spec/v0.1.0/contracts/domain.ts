/** Vulpes domain contract reference. Not runtime validation or an implementation. */
export type UUID = string;
export type ISOInstant = string;
export type IanaTimezone = string;
export type DecimalUSD = string;
export type ModelRole = 'everyday' | 'intermediate' | 'advanced' | 'decision';
export type AnalysisDepth = 'auto' | Exclude<ModelRole, 'decision'>;
export type MetricKey =
  | 'weight'
  | 'body_fat_percent'
  | 'renpho.visceral_fat_index'
  | 'heart_rate'
  | 'resting_heart_rate'
  | 'height'
  | 'steps_daily'
  | 'sleep_duration';
export type CanonicalUnit =
  'kg' | '%' | 'index' | 'bpm' | 'cm' | 'count' | 'min';
export type Granularity = 'instant' | 'daily_total' | 'session_total';
export type MeasurementMethod =
  'device_reported' | 'device_estimate' | 'user_reported' | 'unknown';

export interface MeasurementDTO {
  id: UUID;
  sourceId: UUID;
  metric: MetricKey;
  value: number;
  unit: CanonicalUnit;
  originalValue: string;
  originalUnit: string;
  observedAt: ISOInstant;
  localDate: string | null;
  timezone: IanaTimezone | null;
  granularity: Granularity;
  method: MeasurementMethod;
  qualityFlags: string[];
  externalRecordId: string | null;
  version: number;
}
// user_id is derived server-side, not a trusted field in client/tool DTOs.
export interface DataReference {
  id: string;
  kind:
    'measurement' | 'analysis' | 'goal_revision' | 'message' | 'profile_field';
  label: string;
}
export interface AnalysisResult {
  method?: 'device_reported' | 'device_estimate' | 'user_reported' | 'unknown';
  granularity?: Granularity;
  statistic?:
    | 'daily_median_mean_7d'
    | 'observed_samples'
    | 'daily_totals'
    | 'session_observations';
  statistics?: { median: number; min: number; max: number } | null;
  previousWindow?: {
    from: ISOInstant;
    to: ISOInstant;
    validDays: number;
    coverageStatus: 'sufficient' | 'insufficient_data';
  };
  id: string;
  metric: MetricKey;
  unit: CanonicalUnit;
  sourceId: UUID;
  from: ISOInstant;
  to: ISOInstant;
  timezone: IanaTimezone;
  algorithmVersion: string;
  dataRevision: number;
  observationCount: number;
  validDays: number;
  coverageStatus: 'sufficient' | 'insufficient_data';
  value: number | null;
  previousValue: number | null;
  absoluteChange: number | null;
  relativeChangePercent: number | null;
  points: Array<{ localDate: string; value: number | null }>;
  exclusions: Array<{ referenceId: string; reason: string }>;
  references: DataReference[];
}
export type GoalTarget =
  | { direction: 'increase_to' | 'decrease_to'; value: number }
  | { direction: 'maintain_range'; lower: number; upper: number };
export interface GoalDraft {
  schemaVersion: 1;
  title: string;
  metric: MetricKey;
  unit: CanonicalUnit;
  sourceId: UUID;
  target: GoalTarget;
  baselineMethod: 'daily_median_mean_7d' | 'latest_value' | 'user_reported';
  baselineFrom: ISOInstant | null;
  baselineTo: ISOInstant | null;
  reportedBaseline: number | null;
  timezone: IanaTimezone;
  targetDate: string | null;
  constraints: string[];
  proposedStrategy: string | null;
}
export type GoalState =
  'draft' | 'needs_data' | 'active' | 'paused' | 'completed' | 'archived';
export interface ActionProposal<T = GoalDraft> {
  id: UUID;
  kind: 'goal.create' | 'goal.revise' | 'goal.state';
  targetId: UUID | null;
  expectedVersion: number | null;
  payloadHash: string;
  status: 'pending' | 'approved' | 'rejected' | 'expired' | 'conflicted';
  expiresAt: ISOInstant;
  summary: string;
  payload: T;
}
export interface UsageSummary {
  inputTokens: number | null;
  outputTokens: number | null;
  reasoningTokens: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
  costUSD: DecimalUSD | null;
  costStatus: 'reported' | 'estimated' | 'pending' | 'conservative';
  reservationUSD: DecimalUSD;
  priceSnapshotId: string | null;
  knownCostUSD: DecimalUSD;
}
export interface ContextManifest {
  templateVersion: string;
  included: Array<{
    reference: DataReference;
    contentHash: string;
    tokenEstimate: number;
  }>;
  excluded: Array<{ referenceId: string; reason: string }>;
  retrieval: { ragUsed: false; webUsed: false };
  consentVersion: string;
  dataRevision: number;
}
export type VulpesCard =
  | { type: 'metric_trend'; result: AnalysisResult }
  | {
      type: 'goal_progress';
      goalId: UUID;
      revision: number;
      result: AnalysisResult;
    }
  | { type: 'goal_proposal'; proposal: ActionProposal }
  | { type: 'data_quality'; message: string; references: DataReference[] };

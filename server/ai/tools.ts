import { z } from 'zod';
import {
  LegacyMetricKeySchema,
  LegacyCanonicalUnitSchema,
} from '../../shared/metrics.js';
import {
  GoalDraftSchema,
  GoalStateSchema,
  GoalTargetSchema,
  MeasurementMethodSchema,
  GranularitySchema,
} from '../../shared/domain.js';
import { GoalProgressResultSchema } from '../../shared/goal-progress.js';
import {
  UUIDSchema,
  LocalDateSchema,
  ISOInstantSchema,
} from '../../shared/primitives.js';
import { EscalationRequestSchema } from './routing.js';
import { goalApprovalBindsRevision } from '../services/goals.js';
import { goalProgress } from '../analytics/goals.js';
import { Temporal } from '@js-temporal/polyfill';
import { Decimal } from 'decimal.js';
import {
  agentToolArguments,
  agentToolDefinitions,
  AgentAnalysisToolResultSchema,
  AgentGoalProgressToolResultSchema,
  AgentMetricExplanationsToolResultSchema,
  type AgentGoalDefinition,
} from '../../shared/agent-tools.js';
import type {
  SeriesAnalysisResult,
  AnalysisOperation,
  AnalysisSeries,
} from '../../shared/analysis.js';
import {
  DataSelectionSchema,
  DecimalInputSchema,
  DataSummarySchema,
  MeasurementsPageSchema,
} from '../../shared/data.js';
import {
  GoalDefinitionSchema,
  GoalRevisionPayloadSchema,
  GoalProposalToolResultSchema,
  type GoalDefinition,
  type GoalMutation,
} from '../../shared/goals.js';
import {
  GoalGroupProposalToolResultSchema,
  GoalGroupProgressSchema,
  type GoalGroupMemberInput,
  type GoalGroupMutation,
} from '../../shared/goal-groups.js';
import { CountSchema, IanaTimezoneSchema } from '../../shared/primitives.js';
import { MetricDefinitionSchema } from '../../shared/references.js';
import {
  METRIC_CONTENT_VERSION,
  metricRegistry,
  metricContent,
  metricDisplayGroups,
  metricEstimateCaution,
  metricGoalCaution,
} from '../../shared/metrics.js';
import { API_JSON_LIMIT_BYTES } from '../../shared/api.js';
import type { AuthContext } from '../auth/session.js';
import { GoalService } from '../services/goals.js';
import { GoalGroupService } from '../services/goal-groups.js';
import { readAnalysis, readMetricInventory } from '../services/analysis.js';
import { readData } from '../services/measurements.js';
import { readMetricReference } from '../services/references.js';
import { HttpFailure } from '../http/failure.js';
import { REFERENCE_REGISTRY_VERSION } from '../config/metric-references.js';
export { GoalProgressResultSchema } from '../../shared/goal-progress.js';

export const readToolDefinitions = agentToolDefinitions;
export const toolProjectionVersion = 5;
export const ToolErrorResultSchema = z.strictObject({
  kind: z.literal('tool_error'),
  code: z.enum([
    'invalid_arguments',
    'invalid_interval',
    'timezone_mismatch',
    'unsafe_goal_target',
    'result_too_large',
  ]),
  recoverable: z.literal(true),
  hint: z.string(),
});
export class ToolValidationFailure extends Error {
  constructor(
    readonly code: z.infer<typeof ToolErrorResultSchema>['code'],
    readonly hint: string,
  ) {
    super(hint);
  }
}
async function legacyProfileTimezone(context: AuthContext, supplied: string) {
  const profile = await context.db
    .from('profiles')
    .select('timezone')
    .eq('user_id', context.userId)
    .single();
  if (profile.error)
    throw new HttpFailure(
      503,
      'context_unavailable',
      'Profile timezone could not be checked.',
    );
  const timezone = IanaTimezoneSchema.parse(profile.data.timezone);
  if (timezone !== supplied)
    throw new ToolValidationFailure(
      'timezone_mismatch',
      'Use the owned profile.timezone exactly; never substitute UTC or another timezone.',
    );
  return timezone;
}
function legacyResolveInterval(from: string, to: string, timezone: string) {
  const boundary = (value: string) => {
    if (!LocalDateSchema.safeParse(value).success)
      return Temporal.Instant.from(value).toZonedDateTimeISO(timezone);
    const date = Temporal.PlainDate.from(value);
    const zoned = date.toZonedDateTime(timezone);
    if (!date.equals(zoned.toPlainDate()))
      throw new Error('nonexistent_local_date');
    return zoned;
  };
  try {
    const a = boundary(from);
    const b = boundary(to);
    if (
      Temporal.ZonedDateTime.compare(a, b) >= 0 ||
      a.toPlainDate().until(b.toPlainDate()).days > 366 ||
      !a.equals(a.startOfDay()) ||
      !b.equals(b.startOfDay())
    )
      throw new Error('invalid_local_interval');
    return {
      from: a.toInstant().toString(),
      to: b.toInstant().toString(),
      timezone,
    };
  } catch {
    throw new ToolValidationFailure(
      'invalid_interval',
      'Use 1-366 complete local calendar days: inclusive from, exclusive to, preferably YYYY-MM-DD. Each instant must be profile-local midnight with its own DST offset.',
    );
  }
}

const selection = z.strictObject({
  metric: LegacyMetricKeySchema,
  source_id: UUIDSchema.nullish(),
  from: z.union([LocalDateSchema, ISOInstantSchema]),
  to: z.union([LocalDateSchema, ISOInstantSchema]),
  timezone: IanaTimezoneSchema,
  method: MeasurementMethodSchema.optional(),
  granularity: GranularitySchema.optional(),
});
// Retained historical/offline-control arguments are never advertised in the
// current provider catalog. New conversations use the shared compact contracts.
const toolGoalDefinitionSchema = z
  .strictObject({
    ...GoalDefinitionSchema.shape,
    metric: LegacyMetricKeySchema,
    unit: LegacyCanonicalUnitSchema,
  })
  .omit({ maxEvidenceAgeDays: true })
  .superRefine((definition, ctx) => {
    const parsed = GoalDefinitionSchema.safeParse(definition);
    if (!parsed.success)
      for (const issue of parsed.error.issues)
        ctx.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
        });
  });
const legacyToolArguments = {
  request_escalation: EscalationRequestSchema,
  list_metrics: z.strictObject({}),
  get_measurements: selection.extend({
    limit: z.number().int().min(1).max(200).default(200),
  }),
  summarize_metric: selection,
  list_goals: z.strictObject({
    status: GoalStateSchema.exclude(['draft']).optional(),
  }),
  get_goal_progress: z.strictObject({ goal_id: UUIDSchema }),
  propose_goal: z.strictObject({ definition: toolGoalDefinitionSchema }),
  propose_goal_revision: z.strictObject({
    goal_id: UUIDSchema,
    expected_version: z.number().int().positive(),
    changes: z.strictObject(toolGoalDefinitionSchema.shape).partial(),
    baseline_resolution: z.enum(['retain', 'replace']),
    rationale: z.string().trim().min(1).max(1000),
  }),
};
export const toolArguments = {
  ...agentToolArguments,
  summarize_metric: legacyToolArguments.summarize_metric,
  propose_goal: legacyToolArguments.propose_goal,
  propose_goal_revision: legacyToolArguments.propose_goal_revision,
};
const InventorySchema = z.strictObject({
  dataRevision: CountSchema,
  items: z
    .array(
      z.strictObject({
        metric: LegacyMetricKeySchema,
        source_id: UUIDSchema,
        source_label: z.string(),
        method: MeasurementMethodSchema,
        granularity: GranularitySchema,
        observations: CountSchema,
        first_at: ISOInstantSchema,
        last_at: ISOInstantSchema,
      }),
    )
    .max(201),
});
async function legacyInventory(context: AuthContext) {
  const { data, error } = await context.db.rpc('read_metric_inventory_v1');
  if (error)
    throw new HttpFailure(
      503,
      'data_unavailable',
      'Measurement legacyInventory could not be read.',
    );
  const value = InventorySchema.parse(data);
  return {
    ...value,
    items: value.items.slice(0, 200),
    truncated: value.items.length > 200,
    limitations:
      'Source-specific observations; no inferred visceral fat, clinical diagnosis, resting heart-rate relabeling, or continuous coverage.',
  };
}
async function legacyApprovedGoals(
  context: AuthContext,
  status?: string,
  id?: string,
) {
  let query = context.db
    .from('goals')
    .select(
      'id,title,state,version,metric_key,source_id,current_revision_id,review_status,baseline_snapshot',
    )
    .eq('user_id', context.userId)
    .neq('state', 'draft')
    .not('current_revision_id', 'is', null)
    .order('created_at')
    .order('id')
    .limit(200);
  if (status) query = query.eq('state', status);
  if (id) query = query.eq('id', id);
  const { data, error } = await query;
  if (error)
    throw new HttpFailure(
      503,
      'goals_unavailable',
      'Goals could not be loaded.',
    );
  const result = [];
  for (const goal of data) {
    const revision = await context.db
      .from('goal_revisions')
      .select('id,revision_number,payload,approved_proposal_id')
      .eq('user_id', context.userId)
      .eq('goal_id', goal.id)
      .eq('id', goal.current_revision_id!)
      .maybeSingle();
    if (revision.error)
      throw new HttpFailure(
        503,
        'goals_unavailable',
        'Goal revisions could not be loaded.',
      );
    if (!revision.data) continue;
    const approval = await context.db
      .from('action_proposals')
      .select('state,kind,result')
      .eq('user_id', context.userId)
      .eq('id', revision.data.approved_proposal_id)
      .maybeSingle();
    if (approval.error)
      throw new HttpFailure(
        503,
        'goals_unavailable',
        'Goal approval could not be checked.',
      );
    if (goalApprovalBindsRevision(approval.data, goal.id, revision.data.id))
      result.push({ ...goal, revision: revision.data });
  }
  return result;
}
async function legacyExecuteReadTool(
  context: AuthContext,
  name: string,
  args: unknown,
): Promise<unknown> {
  if (
    !Object.hasOwn(legacyToolArguments, name) ||
    name === 'propose_goal' ||
    name === 'propose_goal_revision'
  )
    throw new HttpFailure(
      400,
      'unsupported_tool',
      'This read tool is unavailable.',
    );
  if (name === 'list_metrics') {
    parseArguments(legacyToolArguments.list_metrics, args);
    return { kind: 'metrics', ...(await legacyInventory(context)) };
  }
  if (name === 'list_goals') {
    const parsed = parseArguments(legacyToolArguments.list_goals, args);
    return {
      kind: 'goals',
      items: (await legacyApprovedGoals(context, parsed.status)).map((g) => ({
        id: g.id,
        title: g.title,
        state: g.state,
        version: g.version,
        metric: g.metric_key,
        sourceId: g.source_id,
        revisionId: g.revision.id,
        revisionNumber: g.revision.revision_number,
        reviewStatus: g.review_status,
        definition: GoalRevisionPayloadSchema.safeParse(g.revision.payload)
          .success
          ? GoalRevisionPayloadSchema.parse(g.revision.payload).definition
          : null,
      })),
      limit: 200,
    };
  }
  if (name === 'get_goal_progress') {
    const parsed = parseArguments(legacyToolArguments.get_goal_progress, args);
    const goal = (
      await legacyApprovedGoals(context, undefined, parsed.goal_id)
    )[0];
    if (!goal)
      throw new HttpFailure(
        404,
        'goal_not_found',
        'The approved goal was not found.',
      );
    if (
      goal.revision.payload &&
      typeof goal.revision.payload === 'object' &&
      !Array.isArray(goal.revision.payload) &&
      goal.revision.payload.schemaVersion === 2
    )
      return new GoalService(context).progress(parsed.goal_id);
    if (goal.review_status !== 'clear')
      return GoalProgressResultSchema.parse({
        kind: 'unavailable',
        reason: 'needs_review',
      });
    const payload = GoalDraftSchema.safeParse(goal.revision.payload);
    const baseline = ApprovedBaselineSchema.safeParse(goal.baseline_snapshot);
    if (
      !payload.success ||
      payload.data.sourceId !== goal.source_id ||
      payload.data.metric !== goal.metric_key
    )
      return GoalProgressResultSchema.parse({
        kind: 'unavailable',
        reason: 'unsupported_revision',
      });
    if (
      !baseline.success ||
      baseline.data.selection.source_id !== goal.source_id ||
      baseline.data.selection.metric !== goal.metric_key
    )
      return GoalProgressResultSchema.parse({
        kind: 'unavailable',
        reason: 'unsupported_baseline',
      });
    const currentDay = Temporal.Now.instant()
      .toZonedDateTimeISO(baseline.data.selection.timezone)
      .startOfDay();
    const data = DataSummarySchema.parse(
      await readData(context, {
        ...baseline.data.selection,
        view: 'summary',
        from: currentDay.subtract({ days: 6 }).toInstant().toString(),
        to: currentDay.add({ days: 1 }).toInstant().toString(),
      }),
    );
    if (data.analysis.value === null)
      return GoalProgressResultSchema.parse({
        kind: 'insufficient_data',
        coverage: data,
      });
    const result = goalProgress(
      baseline.data.value,
      String(data.analysis.value),
      GoalTargetSchema.parse(payload.data.target),
    );
    return GoalProgressResultSchema.parse({
      kind: 'progress',
      goalId: goal.id,
      revision: goal.revision.revision_number,
      baseline: baseline.data.value,
      current: String(data.analysis.value),
      coverage: data,
      result,
    });
  }
  const parsed =
    name === 'get_measurements'
      ? parseArguments(legacyToolArguments.get_measurements, args)
      : parseArguments(legacyToolArguments.summarize_metric, args);
  const timezone = await legacyProfileTimezone(context, parsed.timezone);
  const interval = legacyResolveInterval(parsed.from, parsed.to, timezone);
  const available = await legacyInventory(context);
  const candidates = available.items.filter(
    (item) =>
      item.metric === parsed.metric &&
      (!parsed.source_id || item.source_id === parsed.source_id) &&
      (!parsed.method || item.method === parsed.method) &&
      (!parsed.granularity || item.granularity === parsed.granularity),
  );
  if (parsed.source_id) {
    const source = await context.db
      .from('data_sources')
      .select('id')
      .eq('user_id', context.userId)
      .eq('id', parsed.source_id)
      .maybeSingle();
    if (source.error)
      throw new HttpFailure(
        503,
        'data_unavailable',
        'The source could not be checked.',
      );
    if (!source.data)
      throw new HttpFailure(
        404,
        'source_not_found',
        'The source was not found.',
      );
  }
  if (candidates.length !== 1 || available.truncated)
    return {
      kind:
        candidates.length === 0 && !available.truncated
          ? 'no_data'
          : 'clarification_required',
      candidates,
      dataRevision: available.dataRevision,
      reason: available.truncated
        ? 'inventory_truncated'
        : 'Choose an explicit source, method, granularity, and interval.',
    };
  const chosen = candidates[0]!;
  const query = {
    metric: parsed.metric,
    ...interval,
    source_id: chosen.source_id,
    method: chosen.method,
    granularity: chosen.granularity,
  };
  if (name === 'get_measurements')
    return {
      kind: 'measurements',
      selection: DataSelectionSchema.parse(query),
      ...((await readData(context, {
        ...query,
        view: 'measurements',
        page_size: parseArguments(legacyToolArguments.get_measurements, args)
          .limit,
        data_revision: available.dataRevision,
      })) as object),
    };
  return {
    kind: 'summary',
    data: DataSummarySchema.parse(
      await readData(context, { ...query, view: 'summary' }),
    ),
  };
}

async function legacyPrepareGoalTool(
  context: AuthContext,
  name: 'propose_goal' | 'propose_goal_revision',
  args: unknown,
  requestId: string,
) {
  const service = new GoalService(context);
  const request =
    name === 'propose_goal'
      ? {
          action: 'propose_create' as const,
          client_request_id: requestId,
          ...parseArguments(legacyToolArguments.propose_goal, args),
        }
      : await (async () => {
          const input = parseArguments(
            legacyToolArguments.propose_goal_revision,
            args,
          );
          const previous = await service.revision(input.goal_id);
          const payload = GoalRevisionPayloadSchema.parse(
            previous.revision.payload,
          );
          return {
            action: 'propose_revision' as const,
            client_request_id: requestId,
            goal_id: input.goal_id,
            expected_version: input.expected_version,
            definition: parseArguments(GoalDefinitionSchema, {
              ...payload.definition,
              ...input.changes,
            }),
            baseline_resolution: input.baseline_resolution,
          };
        })();
  await legacyProfileTimezone(context, request.definition.timezone);
  const { metric, target } = request.definition;
  const values =
    target.direction === 'maintain_range'
      ? [target.lower, target.upper]
      : [target.value];
  if (metric === 'body_fat_percent' && values.some((value) => value <= 2))
    throw new ToolValidationFailure(
      'unsafe_goal_target',
      'Vulpes will not propose body-fat targets at or below 2%. This is a conservative product rule, not a medical reference range. Higher targets are not necessarily safe. Do not substitute another target; ask the user to discuss an appropriate target with a qualified clinician.',
    );
  return GoalProposalToolResultSchema.parse({
    kind: 'goal_proposal',
    request,
    payload: await service.prepareProposal(request),
  });
}

function parseArguments<S extends z.ZodType>(
  schema: S,
  args: unknown,
): z.output<S> {
  const parsed = schema.safeParse(args);
  if (!parsed.success) {
    const unsafe = parsed.error.issues.some((issue) =>
      issue.message.includes('Body-fat targets'),
    );
    throw new ToolValidationFailure(
      unsafe ? 'unsafe_goal_target' : 'invalid_arguments',
      unsafe
        ? 'Body-fat targets must exceed 2%, including both range bounds. Do not substitute another target; ask for an appropriate target with qualified clinical guidance.'
        : 'Match the advertised schema. Select canonical metric keys and explicit target/baseline fields; remove extra fields. Existing and revised goals require their owned IDs and expected versions.',
    );
  }
  return parsed.data;
}
async function profile(context: AuthContext) {
  const result = await context.db
    .from('profiles')
    .select('timezone,data_revision')
    .eq('user_id', context.userId)
    .eq('account_state', 'active')
    .single();
  if (result.error || !result.data)
    throw new HttpFailure(
      503,
      'context_unavailable',
      'Profile context could not be checked.',
    );
  return z
    .object({ timezone: IanaTimezoneSchema, data_revision: CountSchema })
    .parse(result.data);
}
function resolveInterval(from: string, to: string, timezone: string) {
  try {
    const a = Temporal.PlainDate.from(from);
    const b = Temporal.PlainDate.from(to);
    if (Temporal.PlainDate.compare(a, b) >= 0 || a.until(b).days > 366)
      throw new Error();
    const start = a.toZonedDateTime(timezone),
      end = b.toZonedDateTime(timezone);
    if (!a.equals(start.toPlainDate()) || !b.equals(end.toPlainDate()))
      throw new Error();
    return {
      from: start.toInstant().toString(),
      to: end.toInstant().toString(),
    };
  } catch {
    throw new ToolValidationFailure(
      'invalid_interval',
      'Choose 1–366 complete profile-local calendar days, inclusive from and exclusive to.',
    );
  }
}
async function ownedSource(context: AuthContext, id: string) {
  const result = await context.db
    .from('data_sources')
    .select('id')
    .eq('user_id', context.userId)
    .eq('id', id)
    .maybeSingle();
  if (result.error)
    throw new HttpFailure(
      503,
      'data_unavailable',
      'The owned source could not be checked.',
    );
  if (!result.data)
    throw new HttpFailure(404, 'not_found', 'The owned source was not found.');
}
type SeriesFilter = {
  source_id?: string | undefined;
  method?: AnalysisSeries['method'] | undefined;
  granularity?: AnalysisSeries['granularity'] | undefined;
};
export async function inventory(context: AuthContext) {
  return readMetricInventory(context);
}
async function resolveSeries(
  context: AuthContext,
  metrics: AnalysisSeries['metric'][],
  filter: SeriesFilter,
) {
  if (filter.source_id) await ownedSource(context, filter.source_id);
  if (filter.source_id && filter.method && filter.granularity)
    return {
      series: metrics.map((metric) => ({
        metric,
        source_id: filter.source_id!,
        method: filter.method!,
        granularity: filter.granularity!,
      })),
    };
  const available = await inventory(context);
  const selected: AnalysisSeries[] = [];
  for (const metric of metrics) {
    const candidates = available.items.filter(
      (item) =>
        item.metric === metric &&
        (!filter.source_id ||
          item.source_id.toLowerCase() === filter.source_id.toLowerCase()) &&
        (!filter.method || item.method === filter.method) &&
        (!filter.granularity || item.granularity === filter.granularity),
    );
    if (candidates.length !== 1 || available.nextCursor)
      return {
        clarification: {
          kind:
            candidates.length === 0 && !available.nextCursor
              ? 'no_data'
              : 'clarification_required',
          metric,
          candidates,
          dataRevision: available.dataRevision,
          nextCursor: available.nextCursor,
          reason: available.nextCursor
            ? 'Inventory is paged; supply an explicit source, method and granularity or page list_metrics.'
            : 'Choose an explicit owned source, method and granularity.',
        },
      };
    const chosen = candidates[0]!;
    selected.push({
      metric,
      source_id: chosen.source_id,
      method: chosen.method,
      granularity: chosen.granularity,
    });
  }
  return { series: selected };
}
function boundedOutput<T>(output: T): T {
  // Leave room for encrypted trace metadata and the sent projection. Never
  // remove numerical evidence to make an oversized exact result fit.
  if (
    Buffer.byteLength(JSON.stringify(output)) >
    API_JSON_LIMIT_BYTES - 64 * 1024
  )
    throw new ToolValidationFailure(
      'result_too_large',
      'The exact evidence exceeds the private trace bound. Narrow the selected dates or metrics; no partial statistic was returned.',
    );
  return output;
}
export const ApprovedBaselineSchema = z.strictObject({
  schemaVersion: z.literal(1),
  selection: DataSelectionSchema,
  value: DecimalInputSchema,
  dataRevision: CountSchema,
  algorithmVersion: z.literal('daily_median_mean_7d_v1'),
});
const MeasurementResultSchema = MeasurementsPageSchema.extend({
  kind: z.literal('measurements'),
  selection: DataSelectionSchema,
});
function legacyProviderToolResult(
  output: unknown,
  version: 1 | 2 | 3 | 4 = 4,
): unknown {
  if (version >= 3) {
    const proposal = GoalProposalToolResultSchema.safeParse(output);
    if (proposal.success)
      return {
        kind: 'goal_proposal',
        status: 'pending',
        title: proposal.data.payload.definition.title,
        requiresUserConfirmation: true,
      };
    const goals = z
      .object({
        kind: z.literal('goals'),
        items: z.array(z.record(z.string(), z.json())),
        limit: z.number(),
      })
      .safeParse(output);
    if (goals.success)
      return {
        ...goals.data,
        items: goals.data.items.map((goal) => {
          const definition = GoalDefinitionSchema.safeParse(goal.definition);
          if (!definition.success) return goal;
          const {
            schemaVersion: _schema,
            title: _title,
            sourceId: _source,
            metric: _metric,
            ...fields
          } = definition.data;
          void _schema;
          void _title;
          void _source;
          void _metric;
          return {
            ...goal,
            definition: Object.fromEntries(
              Object.entries(fields).filter(([, value]) => value !== null),
            ),
          };
        }),
      };
  }
  if (version >= 2) {
    const measurements = MeasurementResultSchema.safeParse(output);
    if (measurements.success) {
      const { selection, dataRevision, items, nextCursor } = measurements.data;
      const units = [...new Set(items.map((item) => item.unit))];
      return {
        kind: 'measurements',
        selection,
        dataRevision,
        units,
        columns: [
          'id',
          'value',
          'unitIndex',
          'observedAt',
          'localDate',
          'timezone',
          'qualityFlags',
        ],
        rows: items.map((item) => [
          item.id,
          item.value,
          units.indexOf(item.unit),
          item.observedAt,
          item.localDate,
          item.timezone,
          item.qualityFlags,
        ]),
        nextCursor,
      };
    }
  }
  const summary = z
    .object({ kind: z.literal('summary'), data: DataSummarySchema })
    .safeParse(output);
  if (!summary.success) return output;
  const { selection, dataRevision, analysis } = summary.data.data;
  const {
    points: _points,
    references: _references,
    exclusions,
    ...calculation
  } = analysis;
  void _points;
  void _references;
  const requestedIntervalMatches =
    Temporal.Instant.compare(selection.from, analysis.from) === 0 &&
    Temporal.Instant.compare(selection.to, analysis.to) === 0;
  const projectedCalculation =
    version >= 4 && !requestedIntervalMatches
      ? {
          ...calculation,
          value: null,
          previousValue: null,
          absoluteChange: null,
          relativeChangePercent: null,
          statistics: null,
        }
      : calculation;
  return {
    kind: 'summary',
    data: {
      selection,
      dataRevision,
      ...(version >= 4 ? { requestedIntervalMatches } : {}),
      analysis: {
        ...projectedCalculation,
        excludedObservations: exclusions.length,
      },
    },
    detail:
      version >= 4 && !requestedIntervalMatches
        ? 'The calculation interval differs from the requested selection. Scalar values are withheld; this summary cannot answer a mean or change for the requested interval. Explain the limitation instead of substituting another period. Full calculation evidence remains in the owned tool trace.'
        : version >= 4
          ? 'Full dated evidence remains in the owned tool trace.'
          : 'Full dated observations, exclusions and evidence remain in the owned tool trace; this projection supplies the qualified calculation.',
  };
}

const coverageColumns = [
  'windowIndex',
  'statistic',
  'coverageStatus',
  'observationCount',
  'observedDays',
  'calendarDays',
  'partialCurrentDay',
  'firstDateIndex',
  'lastDateIndex',
  'oldestDateIndex',
  'ageSeconds',
];
const windowColumns = [
  'coverageIndex',
  'value',
  'sampleMean',
  'sampleStatistics',
];
// Provider-facing precision is declared separately from the retained exact
// calculation. Repeating decimal expansions otherwise consume the whole input.
const projectedDecimal = (input: string | null) =>
  input === null
    ? null
    : new Decimal(input)
        .toSignificantDigits(12, Decimal.ROUND_HALF_UP)
        .toString();
const numericalPrecision = {
  significantDigits: 12,
  rounding: 'half_up',
  exactValues: 'owned_trace_and_cards',
} as const;
function projectedGoalProgress(
  progress: z.infer<typeof GoalProgressResultSchema>,
) {
  if (progress.kind !== 'progress') return progress;
  return {
    ...progress,
    baseline: projectedDecimal(progress.baseline),
    current: projectedDecimal(progress.current),
    ...(progress.actualChange !== undefined
      ? { actualChange: projectedDecimal(progress.actualChange) }
      : {}),
    ...(progress.relativeChangePercent !== undefined
      ? {
          relativeChangePercent: projectedDecimal(
            progress.relativeChangePercent,
          ),
        }
      : {}),
  };
}
function projectedAnalysis(
  output: z.infer<typeof AgentAnalysisToolResultSchema>,
) {
  const sources: string[] = [],
    methods: string[] = [],
    granularities: string[] = [],
    units: string[] = [],
    dates: string[] = [],
    windows: unknown[] = [],
    limitations: string[] = [],
    identities: unknown[] = [],
    coverages: unknown[] = [];
  const index = <T>(dictionary: T[], value: T) => {
    const key = JSON.stringify(value);
    const found = dictionary.findIndex(
      (entry) => JSON.stringify(entry) === key,
    );
    if (found !== -1) return found;
    dictionary.push(value);
    return dictionary.length - 1;
  };
  const date = (value: string | null) =>
    value === null ? null : index(dates, value);
  const window = (value: { from: string; to: string } | null) =>
    value === null ? null : index(windows, [date(value.from), date(value.to)]);
  const value = (current: SeriesAnalysisResult['current']) => [
    index(coverages, [
      window(current.window),
      current.statistic,
      current.coverageStatus,
      current.observationCount,
      current.observedDays,
      current.calendarDays,
      current.partialCurrentDay,
      date(current.firstMeasuredAt),
      date(current.lastMeasuredAt),
      date(current.oldestContributingAt),
      current.ageSeconds,
    ]),
    projectedDecimal(current.value),
    projectedDecimal(current.sampleMean),
    current.sampleStatistics
      ? {
          median: projectedDecimal(current.sampleStatistics.median),
          min: projectedDecimal(current.sampleStatistics.min),
          max: projectedDecimal(current.sampleStatistics.max),
        }
      : null,
  ];
  const resultColumns = [
    'id',
    'identityIndex',
    'kind',
    'operation',
    'series',
    'unitIndex',
    'requestedWindowIndex',
    'effectiveWindowIndex',
    'current',
    'previous',
    'absoluteChange',
    'absoluteChangeUnitIndex',
    'relativeChangePercent',
    'alignment',
    'exclusionCount',
    'hasMoreReferences',
    'limitationIndexes',
    'event',
    'status',
    'candidates',
  ];
  const results = output.data.results.map((result) => {
    const identity = index(identities, {
      schemaVersion: result.schemaVersion,
      algorithmVersion: result.algorithmVersion,
      registryVersion: result.registryVersion,
      timezone: result.timezone,
      evaluatedAt: result.evaluatedAt,
      lastSuccessfulImportAt: result.lastSuccessfulImportAt,
    });
    if (result.kind === 'event_analysis')
      return [
        result.id,
        identity,
        result.kind,
        result.operation,
        [null, index(sources, result.sourceId), null, null],
        null,
        window(result.requestedWindow),
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        null,
        [],
        result.event
          ? {
              id: result.event.event.id,
              observedAt: result.event.event.observed_at,
              columns: [
                'metric',
                'value',
                'unitIndex',
                'methodIndex',
                'granularityIndex',
                'qualityFlags',
              ],
              rows: result.event.observations.map((item) => [
                item.metric,
                projectedDecimal(item.canonicalValue ?? String(item.value)),
                index(units, item.unit),
                index(methods, item.method),
                index(granularities, item.granularity),
                item.qualityFlags,
              ]),
            }
          : null,
        result.status,
        result.candidates,
      ];
    return [
      result.id,
      identity,
      result.kind,
      result.operation,
      [
        result.series.metric,
        index(sources, result.series.source_id),
        index(methods, result.series.method),
        index(granularities, result.series.granularity),
      ],
      index(units, result.unit),
      window(result.requestedWindow),
      window(result.effectiveWindow),
      value(result.current),
      result.previous ? value(result.previous) : null,
      projectedDecimal(result.absoluteChange),
      index(units, result.absoluteChangeUnit),
      projectedDecimal(result.relativeChangePercent),
      result.alignment,
      result.exclusions.length,
      result.hasMoreReferences,
      result.limitations.map((entry) => index(limitations, entry)),
      null,
      null,
      [],
    ];
  });
  const resultConstants: Record<string, unknown> = {};
  const variableColumns = resultColumns.flatMap((column, columnIndex) => {
    const first = results[0]?.[columnIndex];
    if (
      results.length > 1 &&
      results.every(
        (row) => JSON.stringify(row[columnIndex]) === JSON.stringify(first),
      )
    ) {
      resultConstants[column] = first;
      return [];
    }
    return [columnIndex];
  });
  return {
    kind: output.kind,
    numericalPrecision,
    schemaVersion: output.data.schemaVersion,
    dataRevision: output.data.dataRevision,
    identities,
    sources,
    methods,
    granularities,
    units,
    dates,
    windows,
    coverages,
    coverageColumns,
    limitations,
    seriesColumns: ['metric', 'sourceIndex', 'methodIndex', 'granularityIndex'],
    windowColumns,
    resultColumns: variableColumns.map((column) => resultColumns[column]),
    resultConstants,
    results: results.map((row) => variableColumns.map((column) => row[column])),
  };
}
export function providerToolResult(
  output: unknown,
  version: 1 | 2 | 3 | 4 | 5 = toolProjectionVersion,
): unknown {
  if (version !== 5) return legacyProviderToolResult(output, version);
  const analysis = AgentAnalysisToolResultSchema.safeParse(output);
  if (analysis.success) return projectedAnalysis(analysis.data);
  const proposal = GoalProposalToolResultSchema.safeParse(output);
  if (proposal.success)
    return {
      kind: 'goal_proposal',
      status: 'pending',
      title: proposal.data.payload.definition.title,
      requiresUserConfirmation: true,
    };
  const groupProposal = GoalGroupProposalToolResultSchema.safeParse(output);
  if (groupProposal.success)
    return {
      kind: 'goal_group_proposal',
      status: 'pending',
      name: groupProposal.data.payload.name,
      members: groupProposal.data.payload.members.map((member) => ({
        kind: member.kind,
        title: member.payload.definition.title,
      })),
      requiresUserConfirmation: true,
    };
  const progress = AgentGoalProgressToolResultSchema.safeParse(output);
  if (progress.success)
    return {
      ...progress.data,
      numericalPrecision,
      progress: projectedGoalProgress(progress.data.progress),
    };
  const groupProgress = GoalGroupProgressSchema.safeParse(output);
  if (groupProgress.success)
    return {
      ...groupProgress.data,
      numericalPrecision,
      members: groupProgress.data.members.map((member) => ({
        ...member,
        progress: member.progress
          ? projectedGoalProgress(member.progress)
          : null,
      })),
    };
  const explanations =
    AgentMetricExplanationsToolResultSchema.safeParse(output);
  if (explanations.success)
    return {
      kind: explanations.data.kind,
      dataRevision: explanations.data.dataRevision,
      contentVersion: explanations.data.contentVersion,
      referenceRegistryVersion: explanations.data.referenceRegistryVersion,
      items: explanations.data.items.map(({ definition, reference }) => ({
        definition,
        reference: reference
          ? {
              id: reference.id,
              contentVersion: reference.contentVersion,
              referenceRegistryVersion: reference.referenceRegistryVersion,
              resolverVersion: reference.resolverVersion,
              dataRevision: reference.dataRevision,
              evaluatedAt: reference.evaluatedAt,
              selection: reference.selection,
              classification: reference.classification,
              evidence: reference.evidence,
              value: reference.analysis?.current.value ?? null,
            }
          : null,
      })),
    };
  const metrics = z
    .object({
      kind: z.literal('metrics'),
      dataRevision: CountSchema,
      items: z.array(
        z.object({
          metric: z.string(),
          source_id: z.string(),
          source_label: z.string(),
          method: z.string(),
          granularity: z.string(),
          observations: z.number(),
          first_at: z.string(),
          last_at: z.string(),
        }),
      ),
      registry: z.array(
        z.object({
          metric: z.string(),
          unit: z.string(),
          analyticsEligible: z.boolean(),
        }),
      ),
      registryVersion: z.string(),
      nextCursor: z.string().nullable(),
      limits: z.json(),
    })
    .safeParse(output);
  if (metrics.success) {
    const data = metrics.data;
    const sources = [
      ...new Map(
        data.items.map((item) => [
          item.source_id,
          [item.source_id, item.source_label],
        ]),
      ).values(),
    ];
    const methods = [...new Set(data.items.map((item) => item.method))];
    const granularities = [
      ...new Set(data.items.map((item) => item.granularity)),
    ];
    const dates = [
      ...new Set(data.items.flatMap((item) => [item.first_at, item.last_at])),
    ];
    return {
      kind: 'metrics',
      dataRevision: data.dataRevision,
      registryVersion: data.registryVersion,
      registryColumns: ['metric', 'unit', 'analyticsEligible'],
      registry: data.registry.map((item) => [
        item.metric,
        item.unit,
        item.analyticsEligible,
      ]),
      sources,
      methods,
      granularities,
      dates,
      seriesColumns: [
        'metricIndex',
        'sourceIndex',
        'methodIndex',
        'granularityIndex',
        'observations',
        'firstDateIndex',
        'lastDateIndex',
      ],
      series: data.items.map((item) => [
        data.registry.findIndex((metric) => metric.metric === item.metric),
        sources.findIndex(([id]) => id === item.source_id),
        methods.indexOf(item.method),
        granularities.indexOf(item.granularity),
        item.observations,
        dates.indexOf(item.first_at),
        dates.indexOf(item.last_at),
      ]),
      nextCursor: data.nextCursor,
      limits: data.limits,
      detail:
        'Raw-only metrics cannot be analytical operands or goals. Definitions: explain_metrics.',
    };
  }
  if (
    output &&
    typeof output === 'object' &&
    'kind' in output &&
    (output.kind === 'goals' || output.kind === 'goal_groups')
  )
    return output;
  return legacyProviderToolResult(output, 4);
}

export async function executeReadTool(
  context: AuthContext,
  name: string,
  args: unknown,
): Promise<unknown> {
  if (
    name === 'summarize_metric' ||
    (name === 'get_measurements' &&
      !!args &&
      typeof args === 'object' &&
      'timezone' in args) ||
    (name === 'list_goals' &&
      !!args &&
      typeof args === 'object' &&
      !('kind' in args))
  )
    return legacyExecuteReadTool(context, name, args);
  if (
    !Object.hasOwn(toolArguments, name) ||
    name === 'prepare_goals' ||
    name === 'request_escalation'
  )
    throw new HttpFailure(
      400,
      'unsupported_tool',
      'This read tool is unavailable.',
    );
  if (name === 'list_metrics') {
    const input = parseArguments(toolArguments.list_metrics, args);
    return boundedOutput({
      kind: 'metrics',
      ...(await readMetricInventory(context, { view: 'inventory', ...input })),
    });
  }
  if (name === 'list_goals') {
    const input = parseArguments(toolArguments.list_goals, args);
    const start = await profile(context);
    if (input.kind === 'group') {
      if (
        input.status &&
        input.status !== 'active' &&
        input.status !== 'archived'
      )
        throw new ToolValidationFailure(
          'invalid_arguments',
          'Groups support active or archived status.',
        );
      const service = new GoalGroupService(context);
      const page = await service.list({
        page_size: input.limit,
        ...(input.cursor ? { cursor: input.cursor } : {}),
        ...(input.status
          ? { state: input.status as 'active' | 'archived' }
          : {}),
      });
      for (const item of page.items) {
        const fresh = await service.owned(item.id);
        if (
          fresh.version !== item.version ||
          fresh.current_approval_id !== item.current_approval_id
        )
          throw new HttpFailure(
            409,
            'data_changed',
            'Your goal groups changed. Refresh the list.',
          );
      }
      const end = await profile(context);
      if (
        start.data_revision !== end.data_revision ||
        start.timezone !== end.timezone
      )
        throw new HttpFailure(
          409,
          'data_changed',
          'Your data changed. Refresh the list.',
        );
      return {
        kind: 'goal_groups',
        ...page,
        dataRevision: end.data_revision,
      };
    }
    const service = new GoalService(context);
    if (input.cursor) {
      const anchor = await service.owned(input.cursor);
      if (
        anchor.state === 'draft' ||
        (input.status && anchor.state !== input.status)
      )
        throw new ToolValidationFailure(
          'invalid_arguments',
          'Refresh the owned goal list cursor.',
        );
    }
    let query = context.db
      .from('goals')
      .select('id')
      .eq('user_id', context.userId)
      .neq('state', 'draft')
      .not('current_revision_id', 'is', null)
      .order('id')
      .limit(input.limit + 1);
    if (input.status) query = query.eq('state', input.status);
    if (input.cursor) query = query.gt('id', input.cursor);
    const page = await query;
    if (page.error)
      throw new HttpFailure(
        503,
        'goals_unavailable',
        'Goals could not be loaded.',
      );
    const rows = page.data ?? [];
    const items = [];
    for (const row of rows.slice(0, input.limit)) {
      const { goal, revision } = await service.revision(row.id);
      const payload = GoalRevisionPayloadSchema.safeParse(revision.payload);
      items.push({
        id: goal.id,
        title: goal.title,
        state: goal.state,
        version: goal.version,
        metric: goal.metric_key,
        sourceId: goal.source_id,
        revisionId: revision.id,
        reviewStatus: goal.review_status,
        definition: payload.success ? payload.data.definition : null,
      });
    }
    for (const item of items) {
      const fresh = await service.owned(item.id);
      if (
        fresh.version !== item.version ||
        fresh.current_revision_id !== item.revisionId ||
        fresh.review_status !== item.reviewStatus
      )
        throw new HttpFailure(
          409,
          'data_changed',
          'Your goals changed. Refresh the list.',
        );
    }
    const end = await profile(context);
    if (
      start.data_revision !== end.data_revision ||
      start.timezone !== end.timezone
    )
      throw new HttpFailure(
        409,
        'data_changed',
        'Your data changed. Refresh the list.',
      );
    return boundedOutput({
      kind: 'goals',
      dataRevision: end.data_revision,
      items,
      nextCursor: rows.length > input.limit ? items.at(-1)!.id : null,
      limit: input.limit,
    });
  }
  if (name === 'get_goal_progress') {
    const input = parseArguments(toolArguments.get_goal_progress, args);
    if (input.group_id)
      return boundedOutput(
        await new GoalGroupService(context).progress(input.group_id),
      );
    const service = new GoalService(context);
    const before = await service.revision(input.goal_id!);
    const start = await profile(context);
    // Retained v1 approvals use their original frozen baseline contract. New
    // revisions always use GoalService's versioned deterministic calculation.
    const progress = GoalDraftSchema.safeParse(before.revision.payload).success
      ? GoalProgressResultSchema.parse(
          await legacyExecuteReadTool(context, name, args),
        )
      : await service.progress(input.goal_id!);
    const after = await service.owned(input.goal_id!);
    const end = await profile(context);
    if (
      before.goal.version !== after.version ||
      before.revision.id !== after.current_revision_id ||
      before.goal.review_status !== after.review_status ||
      start.data_revision !== end.data_revision ||
      start.timezone !== end.timezone ||
      (progress.kind === 'progress' &&
        progress.dataRevision !== undefined &&
        progress.dataRevision !== end.data_revision)
    )
      throw new HttpFailure(
        409,
        'data_changed',
        'Goal progress changed. Refresh the goal and measurements.',
      );
    return boundedOutput(
      AgentGoalProgressToolResultSchema.parse({
        kind: 'goal_progress',
        goalId: after.id,
        goalVersion: after.version,
        revisionId: before.revision.id,
        dataRevision: end.data_revision,
        progress,
      }),
    );
  }
  const ownedProfile = await profile(context);
  if (name === 'analyze_measurements') {
    const input = parseArguments(toolArguments.analyze_measurements, args);
    const window =
      input.from && input.to
        ? resolveInterval(input.from, input.to, ownedProfile.timezone)
        : undefined;
    const comparisonWindow =
      input.comparison_from && input.comparison_to
        ? resolveInterval(
            input.comparison_from,
            input.comparison_to,
            ownedProfile.timezone,
          )
        : undefined;
    let operations: AnalysisOperation[];
    if (input.operation === 'latest_event') {
      let source = input.source_id;
      if (source) await ownedSource(context, source);
      else {
        const available = await inventory(context);
        const sources = [
          ...new Set(available.items.map((item) => item.source_id)),
        ];
        if (sources.length !== 1 || available.nextCursor)
          return {
            kind: 'clarification_required',
            candidates: sources,
            dataRevision: available.dataRevision,
            nextCursor: available.nextCursor,
            reason: 'Choose one explicit owned event source.',
          };
        source = sources[0]!;
      }
      operations = [
        {
          operation: 'latest_event',
          source_id: source,
          timezone: ownedProfile.timezone,
          ...(window ? { window } : {}),
        },
      ];
    } else {
      const resolved = await resolveSeries(context, input.metrics!, input);
      if (resolved.clarification) return resolved.clarification;
      operations = resolved.series!.map((series): AnalysisOperation => {
        const base = { series, timezone: ownedProfile.timezone };
        switch (input.operation) {
          case 'latest_per_metric':
            return {
              ...base,
              operation: input.operation,
              ...(window ? { window } : {}),
              ...(input.before ? { before: input.before } : {}),
            };
          case 'rolling_7d':
            return {
              ...base,
              operation: input.operation,
              window: window!,
              ...(input.before ? { before: input.before } : {}),
            };
          case 'observed_day_mean':
            return {
              ...base,
              operation: input.operation,
              window: window!,
              includeSampleMean: input.include_sample_mean ?? false,
            };
          case 'period_comparison':
            return {
              ...base,
              operation: input.operation,
              window: window!,
              comparisonMethod: input.comparison_method ?? 'observed_day_mean',
              ...(comparisonWindow ? { comparisonWindow } : {}),
            };
          case 'endpoint_difference':
            return {
              ...base,
              operation: input.operation,
              endpointIds: input.endpoint_ids!,
            };
          default:
            throw new ToolValidationFailure(
              'invalid_arguments',
              'Choose a supported operation.',
            );
        }
      });
    }
    return boundedOutput(
      AgentAnalysisToolResultSchema.parse({
        kind: 'analysis_batch',
        data: await readAnalysis(context, { action: 'analyze', operations }),
      }),
    );
  }
  if (name === 'explain_metrics') {
    const input = parseArguments(toolArguments.explain_metrics, args);
    const items = [];
    let selections: AnalysisSeries[] = [];
    if (input.include_reference) {
      const resolved = await resolveSeries(context, input.metrics, input);
      if (resolved.clarification) return resolved.clarification;
      selections = resolved.series!;
    }
    for (const metric of input.metrics) {
      const registry = metricRegistry[metric],
        content = metricContent[metric];
      const reference = input.include_reference
        ? await readMetricReference(context, {
            view: 'reference',
            ...selections.find((item) => item.metric === metric)!,
            timezone: ownedProfile.timezone,
          })
        : null;
      const definition =
        reference?.definition ??
        MetricDefinitionSchema.parse({
          metric,
          label: registry.label,
          unit: registry.canonicalUnit,
          definition: content.definition,
          displayGroup: content.displayGroup,
          displayGroupLabel: metricDisplayGroups[content.displayGroup],
          analyticsEligible: registry.analyticsOperand,
          goalEligible: content.goalEligible,
          limitations: [
            registry.limitation,
            ...(registry.method === 'device_estimate'
              ? [metricEstimateCaution]
              : []),
            metricGoalCaution,
          ],
        });
      items.push({ definition, reference });
    }
    const end = await profile(context);
    if (
      end.data_revision !== ownedProfile.data_revision ||
      end.timezone !== ownedProfile.timezone ||
      items.some(
        ({ reference }) =>
          reference && reference.dataRevision !== end.data_revision,
      )
    )
      throw new HttpFailure(
        409,
        'data_changed',
        'Your data changed. Refresh metric references.',
      );
    return boundedOutput(
      AgentMetricExplanationsToolResultSchema.parse({
        kind: 'metric_explanations',
        dataRevision: end.data_revision,
        contentVersion: METRIC_CONTENT_VERSION,
        referenceRegistryVersion: REFERENCE_REGISTRY_VERSION,
        items,
      }),
    );
  }
  const input = parseArguments(toolArguments.get_measurements, args);
  const resolved = await resolveSeries(context, [input.metric], input);
  if (resolved.clarification) return resolved.clarification;
  const selected = resolved.series![0]!;
  const selection = DataSelectionSchema.parse({
    ...selected,
    ...resolveInterval(input.from, input.to, ownedProfile.timezone),
    timezone: ownedProfile.timezone,
  });
  return boundedOutput({
    kind: 'measurements',
    selection,
    ...MeasurementsPageSchema.parse(
      await readData(context, {
        view: 'measurements',
        ...selection,
        page_size: input.limit,
        ...(input.cursor ? { cursor: input.cursor } : {}),
        ...(input.data_revision !== undefined
          ? { data_revision: input.data_revision }
          : { data_revision: ownedProfile.data_revision }),
      }),
    ),
  });
}

async function composeDefinition(
  context: AuthContext,
  input: AgentGoalDefinition,
  retained?: GoalDefinition,
) {
  const ownedProfile = await profile(context);
  const selected = await resolveSeries(context, [input.metric], input);
  if (selected.clarification)
    throw new ToolValidationFailure(
      'invalid_arguments',
      selected.clarification.reason,
    );
  const series = selected.series![0]!;
  const interval =
    input.baseline_from && input.baseline_to
      ? resolveInterval(
          input.baseline_from,
          input.baseline_to,
          ownedProfile.timezone,
        )
      : null;
  const definition = parseArguments(GoalDefinitionSchema, {
    schemaVersion: 1,
    title: input.title,
    metric: input.metric,
    sourceId: series.source_id,
    method: series.method,
    granularity: series.granularity,
    unit: metricRegistry[input.metric].canonicalUnit,
    target: input.target,
    baselineMethod: input.baseline_method,
    baselineFrom:
      retained?.baselineMethod === 'user_reported' &&
      input.baseline_method === 'user_reported'
        ? retained.baselineFrom
        : interval &&
            retained?.baselineFrom &&
            Temporal.Instant.compare(interval.from, retained.baselineFrom) === 0
          ? retained.baselineFrom
          : (interval?.from ?? null),
    baselineTo:
      retained?.baselineMethod === 'user_reported' &&
      input.baseline_method === 'user_reported'
        ? retained.baselineTo
        : interval &&
            retained?.baselineTo &&
            Temporal.Instant.compare(interval.to, retained.baselineTo) === 0
          ? retained.baselineTo
          : (interval?.to ?? null),
    reportedBaseline: input.reported_baseline ?? null,
    timezone: ownedProfile.timezone,
    currentMethod:
      input.baseline_method === 'user_reported'
        ? retained?.baselineMethod === 'user_reported'
          ? retained.currentMethod
          : 'latest_value'
        : input.baseline_method,
    targetDate: input.target_date ?? null,
    constraints: input.constraints ?? [],
    proposedStrategy: input.strategy ?? null,
    maxEvidenceAgeDays: input.max_evidence_age_days ?? null,
  });
  const values =
    definition.target.direction === 'maintain_range'
      ? [definition.target.lower, definition.target.upper]
      : [definition.target.value];
  if (
    definition.metric === 'body_fat_percent' &&
    values.some((value) => value <= 2)
  )
    throw new ToolValidationFailure(
      'unsafe_goal_target',
      'Body-fat targets must exceed 2%, including both range bounds. Do not substitute another target.',
    );
  return definition;
}
export function prepareGoalTool(
  context: AuthContext,
  name: 'propose_goal' | 'propose_goal_revision',
  args: unknown,
  requestId: string,
): Promise<z.infer<typeof GoalProposalToolResultSchema>>;
export function prepareGoalTool(
  context: AuthContext,
  name: string,
  args: unknown,
  requestId: string,
): Promise<
  | z.infer<typeof GoalProposalToolResultSchema>
  | z.infer<typeof GoalGroupProposalToolResultSchema>
>;
export async function prepareGoalTool(
  context: AuthContext,
  name: string,
  args: unknown,
  requestId: string,
) {
  if (name === 'propose_goal' || name === 'propose_goal_revision')
    return legacyPrepareGoalTool(context, name, args, requestId);
  if (name !== 'prepare_goals')
    throw new HttpFailure(
      400,
      'unsupported_tool',
      'This proposal tool is unavailable.',
    );
  const input = parseArguments(toolArguments.prepare_goals, args);
  const members: GoalGroupMemberInput[] = [];
  for (const member of input.members) {
    if (member.kind === 'existing') {
      // Linking an approved goal still supplies an AI-prepared target. Apply the
      // same product floor to its canonical approved definition.
      const existing = await new GoalService(context).revision(member.goal_id!);
      const definition = GoalRevisionPayloadSchema.parse(
        existing.revision.payload,
      ).definition;
      const values =
        definition.target.direction === 'maintain_range'
          ? [definition.target.lower, definition.target.upper]
          : [definition.target.value];
      if (
        definition.metric === 'body_fat_percent' &&
        values.some((value) => value <= 2)
      )
        throw new ToolValidationFailure(
          'unsafe_goal_target',
          'Body-fat targets must exceed 2%, including both range bounds.',
        );
      members.push({
        kind: 'existing',
        goal_id: member.goal_id!,
        expected_version: member.expected_version!,
      });
    } else {
      const retained =
        member.kind === 'revise' && member.baseline_resolution === 'retain'
          ? GoalRevisionPayloadSchema.parse(
              (await new GoalService(context).revision(member.goal_id!))
                .revision.payload,
            ).definition
          : undefined;
      const definition = await composeDefinition(
        context,
        member.definition!,
        retained,
      );
      members.push(
        member.kind === 'create'
          ? { kind: 'create', definition }
          : {
              kind: 'revise',
              goal_id: member.goal_id!,
              expected_version: member.expected_version!,
              definition,
              baseline_resolution: member.baseline_resolution!,
            },
      );
    }
  }
  if (input.group) {
    const common = {
      client_request_id: requestId,
      name: input.group.name,
      members,
    };
    const request: GoalGroupMutation = input.group.id
      ? {
          ...common,
          action: 'propose_group_revision',
          group_id: input.group.id,
          expected_version: input.group.expected_version!,
        }
      : { ...common, action: 'propose_group_create' };
    return boundedOutput(
      GoalGroupProposalToolResultSchema.parse({
        kind: 'goal_group_proposal',
        request,
        payload: await new GoalGroupService(context).prepareProposal(request),
      }),
    );
  }
  const member = members[0]!;
  if (member.kind === 'existing')
    throw new ToolValidationFailure(
      'invalid_arguments',
      'A single proposal must create or revise a goal.',
    );
  const request: GoalMutation =
    member.kind === 'create'
      ? {
          action: 'propose_create',
          client_request_id: requestId,
          definition: member.definition,
        }
      : {
          action: 'propose_revision',
          client_request_id: requestId,
          goal_id: member.goal_id,
          expected_version: member.expected_version,
          definition: member.definition,
          baseline_resolution: member.baseline_resolution,
        };
  return boundedOutput(
    GoalProposalToolResultSchema.parse({
      kind: 'goal_proposal',
      request,
      payload: await new GoalService(context).prepareProposal(request),
    }),
  );
}

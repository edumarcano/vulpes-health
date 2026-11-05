import { EscalationRequestSchema } from './routing.js';
import { GoalService } from '../services/goals.js';
import {
  GoalDefinitionSchema,
  GoalRevisionPayloadSchema,
  GoalProposalToolResultSchema,
} from '../../shared/goals.js';
export { GoalProgressResultSchema } from '../../shared/goal-progress.js';
import { GoalProgressResultSchema } from '../../shared/goal-progress.js';
import { z } from 'zod';
import { Temporal } from '@js-temporal/polyfill';
import {
  DataSelectionSchema,
  DecimalInputSchema,
  DataSummarySchema,
  MeasurementsPageSchema,
} from '../../shared/data.js';
import {
  MetricKeySchema,
  MeasurementMethodSchema,
  GranularitySchema,
  GoalDraftSchema,
  GoalStateSchema,
  GoalTargetSchema,
} from '../../shared/domain.js';
import {
  CountSchema,
  IanaTimezoneSchema,
  ISOInstantSchema,
  LocalDateSchema,
  UUIDSchema,
} from '../../shared/primitives.js';
import type { AuthContext } from '../auth/session.js';
import { readData } from '../services/measurements.js';
import { goalProgress } from '../analytics/goals.js';
import { HttpFailure } from '../http/failure.js';
import type { GenerationRequest } from './contracts.js';

export const ToolErrorResultSchema = z.strictObject({
  kind: z.literal('tool_error'),
  code: z.enum([
    'invalid_arguments',
    'invalid_interval',
    'timezone_mismatch',
    'unsafe_goal_target',
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
function parseArguments<S extends z.ZodType>(
  schema: S,
  args: unknown,
): z.output<S> {
  const parsed = schema.safeParse(args);
  if (!parsed.success)
    throw new ToolValidationFailure(
      'invalid_arguments',
      'Match the advertised tool schema: use valid metric, UUID, numeric target/unit, and date fields; remove extra fields. Targets must satisfy metric representation limits, not clinical reference ranges.',
    );
  return parsed.data;
}
async function profileTimezone(context: AuthContext, supplied: string) {
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
function resolveInterval(from: string, to: string, timezone: string) {
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
  metric: MetricKeySchema,
  source_id: UUIDSchema.nullish(),
  from: z.union([LocalDateSchema, ISOInstantSchema]),
  to: z.union([LocalDateSchema, ISOInstantSchema]),
  timezone: IanaTimezoneSchema,
  method: MeasurementMethodSchema.optional(),
  granularity: GranularitySchema.optional(),
});
export const toolArguments = {
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
  propose_goal: z.strictObject({ definition: GoalDefinitionSchema }),
  propose_goal_revision: z.strictObject({
    goal_id: UUIDSchema,
    expected_version: z.number().int().positive(),
    changes: z.strictObject(GoalDefinitionSchema.shape).partial(),
    baseline_resolution: z.enum(['retain', 'replace']),
    rationale: z.string().trim().min(1).max(1000),
  }),
};
const descriptions = {
  request_escalation:
    'Request Flash once using current-run progress or two metric-summary evidence IDs. Tool-only turn; no medical judgment or approval.',
  list_metrics: 'List owned series, counts, dates and source limits.',
  get_measurements:
    'Read up to 200 rows for profile-local [from,to) dates; clarify ambiguous series.',
  summarize_metric:
    'Summarize complete local days; sparse coverage stays insufficient.',
  list_goals: 'List approved owned goals and versions.',
  get_goal_progress:
    'Read approved progress; qualify stale/unsupported baselines.',
  propose_goal: 'Prepare a pending goal; explicit user review required.',
  propose_goal_revision:
    'Propose changed fields of an approved goal. expected_version is its version, not revision number. Never applies changes.',
};
export const readToolDefinitions: GenerationRequest['tools'] = Object.entries(
  toolArguments,
).map(([name, schema]) => {
  // Advertise the preferred date-only input; retain validated instant support
  // server-side for existing callers without duplicating both forms on wire.
  const advertised =
    name === 'get_measurements'
      ? toolArguments.get_measurements.extend({
          from: LocalDateSchema,
          to: LocalDateSchema,
        })
      : name === 'summarize_metric'
        ? toolArguments.summarize_metric.extend({
            from: LocalDateSchema,
            to: LocalDateSchema,
          })
        : schema;
  // Formats already describe these values to the model. Keep Zod's full
  // calendar/UUID validation server-side rather than repeating its regex on wire.
  const parameters = z.toJSONSchema(advertised, {
    override: ({ jsonSchema, zodSchema }) => {
      if (zodSchema === GoalTargetSchema && jsonSchema.oneOf) {
        jsonSchema.oneOf = [
          {
            type: 'object',
            properties: {
              direction: { enum: ['increase_to', 'decrease_to'] },
              value: { type: 'number' },
            },
            required: ['direction', 'value'],
            additionalProperties: false,
          },
          jsonSchema.oneOf[2]!,
        ];
      }
      if (jsonSchema.format) delete jsonSchema.pattern;
      if (jsonSchema.enum || jsonSchema.const !== undefined)
        delete jsonSchema.type;
    },
  });
  delete parameters.$schema;
  return {
    name,
    description: descriptions[name as keyof typeof descriptions],
    parameters: parameters as Record<
      string,
      z.infer<ReturnType<typeof z.json>>
    >,
  };
});
export const toolProjectionVersion = 4;
const MeasurementResultSchema = MeasurementsPageSchema.extend({
  kind: z.literal('measurements'),
  selection: DataSelectionSchema,
});
export function providerToolResult(
  output: unknown,
  version: 1 | 2 | 3 | 4 = toolProjectionVersion,
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
const InventorySchema = z.strictObject({
  dataRevision: CountSchema,
  items: z
    .array(
      z.strictObject({
        metric: MetricKeySchema,
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
export const ApprovedBaselineSchema = z.strictObject({
  schemaVersion: z.literal(1),
  selection: DataSelectionSchema,
  value: DecimalInputSchema,
  dataRevision: CountSchema,
  algorithmVersion: z.literal('daily_median_mean_7d_v1'),
});
export async function inventory(context: AuthContext) {
  const { data, error } = await context.db.rpc('read_metric_inventory_v1');
  if (error)
    throw new HttpFailure(
      503,
      'data_unavailable',
      'Measurement inventory could not be read.',
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
async function approvedGoals(
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
      .select('state')
      .eq('user_id', context.userId)
      .eq('id', revision.data.approved_proposal_id)
      .maybeSingle();
    if (approval.error)
      throw new HttpFailure(
        503,
        'goals_unavailable',
        'Goal approval could not be checked.',
      );
    if (approval.data?.state === 'approved')
      result.push({ ...goal, revision: revision.data });
  }
  return result;
}
export async function executeReadTool(
  context: AuthContext,
  name: string,
  args: unknown,
): Promise<unknown> {
  if (
    !Object.hasOwn(toolArguments, name) ||
    name === 'propose_goal' ||
    name === 'propose_goal_revision'
  )
    throw new HttpFailure(
      400,
      'unsupported_tool',
      'This read tool is unavailable.',
    );
  if (name === 'list_metrics') {
    parseArguments(toolArguments.list_metrics, args);
    return { kind: 'metrics', ...(await inventory(context)) };
  }
  if (name === 'list_goals') {
    const parsed = parseArguments(toolArguments.list_goals, args);
    return {
      kind: 'goals',
      items: (await approvedGoals(context, parsed.status)).map((g) => ({
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
    const parsed = parseArguments(toolArguments.get_goal_progress, args);
    const goal = (await approvedGoals(context, undefined, parsed.goal_id))[0];
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
      ? parseArguments(toolArguments.get_measurements, args)
      : parseArguments(toolArguments.summarize_metric, args);
  const timezone = await profileTimezone(context, parsed.timezone);
  const interval = resolveInterval(parsed.from, parsed.to, timezone);
  const available = await inventory(context);
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
        page_size: parseArguments(toolArguments.get_measurements, args).limit,
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

export async function prepareGoalTool(
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
          ...parseArguments(toolArguments.propose_goal, args),
        }
      : await (async () => {
          const input = parseArguments(
            toolArguments.propose_goal_revision,
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
  await profileTimezone(context, request.definition.timezone);
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

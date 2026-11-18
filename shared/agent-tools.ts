import { z } from 'zod';
import {
  AnalysisBatchSchema,
  SeriesAnalysisResultSchema,
  type SeriesAnalysisResult,
} from './analysis.js';
import {
  GoalStateSchema,
  GoalTargetSchema,
  GranularitySchema,
  MeasurementMethodSchema,
  MetricKeySchema,
} from './domain.js';
import { GoalProgressResultSchema } from './goal-progress.js';
import {
  metricContent,
  registryMetricKeys,
  validMetricNumber,
} from './metrics.js';
import {
  CountSchema,
  ISOInstantSchema,
  LocalDateSchema,
  UUIDSchema,
  VersionSchema,
} from './primitives.js';
import {
  MetricDefinitionSchema,
  MetricReferenceResultSchema,
} from './references.js';

// Inputs select owned data. Timezone, canonical units, baseline values, result
// identities and proposal registration identities are supplied by the server.
const series = {
  source_id: UUIDSchema.optional(),
  method: MeasurementMethodSchema.optional(),
  granularity: GranularitySchema.optional(),
};
const dates = {
  from: LocalDateSchema.optional(),
  to: LocalDateSchema.optional(),
};
const metricList = z.array(MetricKeySchema).min(1).max(24);
function completeWindow(
  value: { from?: string | undefined; to?: string | undefined },
  ctx: z.RefinementCtx,
  required = false,
) {
  if (
    (value.from === undefined) !== (value.to === undefined) ||
    (required && value.from === undefined) ||
    (value.from !== undefined &&
      value.to !== undefined &&
      value.from >= value.to)
  )
    ctx.addIssue({
      code: 'custom',
      message: 'Choose an ordered complete local-date interval.',
    });
}
export const AgentAnalysisArgumentsSchema = z
  .strictObject({
    operation: z.enum([
      'latest_event',
      'latest_per_metric',
      'observed_day_mean',
      'rolling_7d',
      'period_comparison',
      'endpoint_difference',
    ]),
    metrics: metricList.optional(),
    ...series,
    ...dates,
    comparison_from: LocalDateSchema.optional(),
    comparison_to: LocalDateSchema.optional(),
    comparison_method: z.enum(['observed_day_mean', 'rolling_7d']).optional(),
    before: ISOInstantSchema.optional(),
    endpoint_ids: z.tuple([UUIDSchema, UUIDSchema]).optional(),
    include_sample_mean: z.boolean().optional(),
  })
  .superRefine((value, ctx) => {
    completeWindow(
      value,
      ctx,
      ['observed_day_mean', 'rolling_7d', 'period_comparison'].includes(
        value.operation,
      ),
    );
    completeWindow(
      { from: value.comparison_from, to: value.comparison_to },
      ctx,
    );
    if (value.operation !== 'latest_event' && !value.metrics)
      ctx.addIssue({
        code: 'custom',
        path: ['metrics'],
        message: 'Select metrics explicitly.',
      });
    if (value.metrics && new Set(value.metrics).size !== value.metrics.length)
      ctx.addIssue({
        code: 'custom',
        path: ['metrics'],
        message: 'Do not repeat metrics.',
      });
    if (
      value.operation === 'latest_event' &&
      (value.metrics || value.method || value.granularity)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'An event selects a source rather than individual series.',
      });
    if (value.operation === 'endpoint_difference') {
      if (
        value.metrics?.length !== 1 ||
        !value.endpoint_ids ||
        value.endpoint_ids[0].toLowerCase() ===
          value.endpoint_ids[1].toLowerCase()
      )
        ctx.addIssue({
          code: 'custom',
          message: 'Choose one metric and two distinct owned endpoints.',
        });
    } else if (value.endpoint_ids)
      ctx.addIssue({
        code: 'custom',
        path: ['endpoint_ids'],
        message: 'Endpoints require endpoint_difference.',
      });
    if (
      value.operation !== 'period_comparison' &&
      (value.comparison_from || value.comparison_to || value.comparison_method)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Comparison fields require period_comparison.',
      });
    if (
      value.before &&
      !['latest_per_metric', 'rolling_7d'].includes(value.operation)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['before'],
        message: 'A cutoff requires latest_per_metric or rolling_7d.',
      });
    if (
      value.include_sample_mean !== undefined &&
      value.operation !== 'observed_day_mean'
    )
      ctx.addIssue({
        code: 'custom',
        path: ['include_sample_mean'],
        message: 'Sample mean requires observed_day_mean.',
      });
  });

const goalMetrics = registryMetricKeys.filter(
  (metric) => metricContent[metric].goalEligible,
) as [
  (typeof registryMetricKeys)[number],
  ...(typeof registryMetricKeys)[number][],
];
const GoalMetricSchema = z.enum(goalMetrics);
export const AgentGoalDefinitionSchema = z
  .strictObject({
    metric: GoalMetricSchema,
    ...series,
    title: z.string().trim().min(1).max(200),
    target: GoalTargetSchema,
    baseline_method: z.enum([
      'latest_value',
      'daily_median_mean_7d',
      'user_reported',
    ]),
    baseline_from: LocalDateSchema.optional(),
    baseline_to: LocalDateSchema.optional(),
    reported_baseline: z.number().finite().optional(),
    target_date: LocalDateSchema.nullable().optional(),
    constraints: z.array(z.string().max(1000)).max(20).optional(),
    strategy: z.string().max(4000).nullable().optional(),
    max_evidence_age_days: z
      .number()
      .int()
      .min(1)
      .max(3660)
      .nullable()
      .optional(),
  })
  .superRefine((value, ctx) => {
    completeWindow(
      { from: value.baseline_from, to: value.baseline_to },
      ctx,
      value.baseline_method !== 'user_reported',
    );
    if (value.baseline_method === 'user_reported') {
      if (
        value.reported_baseline === undefined ||
        !validMetricNumber(value.metric, value.reported_baseline) ||
        value.baseline_from !== undefined ||
        value.baseline_to !== undefined
      )
        ctx.addIssue({
          code: 'custom',
          message:
            'Reported baselines require an explicit valid value and forbid computed intervals.',
        });
    } else if (value.reported_baseline !== undefined)
      ctx.addIssue({
        code: 'custom',
        path: ['reported_baseline'],
        message: 'Computed baselines forbid supplied baseline values.',
      });
    const targets =
      value.target.direction === 'maintain_range'
        ? [value.target.lower, value.target.upper]
        : [value.target.value];
    if (targets.some((target) => !validMetricNumber(value.metric, target)))
      ctx.addIssue({
        code: 'custom',
        path: ['target'],
        message: 'Target does not match metric representation.',
      });
    if (
      value.metric === 'body_fat_percent' &&
      targets.some((target) => target <= 2)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['target'],
        message:
          'Body-fat targets must exceed 2%, including both range bounds.',
      });
  });

// A single optional definition keeps the advertised schema small. Strict
// discriminator invariants below reject mixed create/link/revise argument shapes.
export const AgentGoalMemberSchema = z
  .strictObject({
    kind: z.enum(['create', 'revise', 'existing']),
    goal_id: UUIDSchema.optional(),
    expected_version: VersionSchema.optional(),
    definition: AgentGoalDefinitionSchema.optional(),
    baseline_resolution: z.enum(['retain', 'replace']).optional(),
  })
  .superRefine((value, ctx) => {
    if (
      (value.kind !== 'create') !==
        (value.goal_id !== undefined && value.expected_version !== undefined) ||
      (value.kind === 'create' &&
        (value.goal_id !== undefined || value.expected_version !== undefined))
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Existing/revised goals require their owned ID and expected version; new goals forbid them.',
      });
    if ((value.kind !== 'existing') !== (value.definition !== undefined))
      ctx.addIssue({
        code: 'custom',
        path: ['definition'],
        message:
          'Create/revise requires a complete definition; existing forbids it.',
      });
    if ((value.kind === 'revise') !== (value.baseline_resolution !== undefined))
      ctx.addIssue({
        code: 'custom',
        path: ['baseline_resolution'],
        message:
          'Only revisions require explicit retain/replace baseline resolution.',
      });
  });
export const AgentPrepareGoalsArgumentsSchema = z
  .strictObject({
    members: z.array(AgentGoalMemberSchema).min(1).max(4),
    group: z
      .strictObject({
        name: z.string().trim().min(1).max(200),
        id: UUIDSchema.optional(),
        expected_version: VersionSchema.optional(),
      })
      .optional(),
  })
  .superRefine((value, ctx) => {
    if (
      !value.group &&
      (value.members.length !== 1 || value.members[0]?.kind === 'existing')
    )
      ctx.addIssue({
        code: 'custom',
        message:
          'Single preparation requires exactly one new/revised goal; groups require a name.',
      });
    if (
      value.group &&
      (value.group.id === undefined) !==
        (value.group.expected_version === undefined)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['group'],
        message:
          'Group revisions require both the owned ID and expected version.',
      });
    const ids = value.members.flatMap((member) =>
      member.goal_id ? [member.goal_id.toLowerCase()] : [],
    );
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({
        code: 'custom',
        path: ['members'],
        message: 'Each owned goal may occur once.',
      });
  });

export const agentToolArguments = {
  request_escalation: z.strictObject({
    task: z.enum(['goal_progress_review', 'multi_metric_comparison']),
    rationale: z.string().trim().min(1).max(400),
    evidenceIds: z.array(UUIDSchema).min(1).max(6),
  }),
  list_metrics: z.strictObject({
    cursor: z.string().min(1).max(4096).optional(),
    data_revision: CountSchema.optional(),
  }),
  analyze_measurements: AgentAnalysisArgumentsSchema,
  get_measurements: z
    .strictObject({
      metric: MetricKeySchema,
      ...series,
      from: LocalDateSchema,
      to: LocalDateSchema,
      limit: z.number().int().min(1).max(200).default(200),
      cursor: z.string().min(1).max(4096).optional(),
      data_revision: CountSchema.optional(),
    })
    .superRefine((value, ctx) => completeWindow(value, ctx, true)),
  explain_metrics: z.strictObject({
    metrics: z.array(MetricKeySchema).min(1).max(8),
    ...series,
    include_reference: z.boolean().default(false),
  }),
  list_goals: z.strictObject({
    kind: z.enum(['single', 'group']),
    status: GoalStateSchema.exclude(['draft']).optional(),
    cursor: UUIDSchema.optional(),
    limit: z.number().int().min(1).max(50).default(50),
  }),
  get_goal_progress: z
    .strictObject({
      goal_id: UUIDSchema.optional(),
      group_id: UUIDSchema.optional(),
    })
    .superRefine((value, ctx) => {
      if ((value.goal_id === undefined) === (value.group_id === undefined))
        ctx.addIssue({
          code: 'custom',
          message: 'Select exactly one owned goal_id or group_id.',
        });
    }),
  prepare_goals: AgentPrepareGoalsArgumentsSchema,
};
const descriptions: Record<keyof typeof agentToolArguments, string> = {
  request_escalation:
    'Request optional Flash using current-run evidence; never approves goals.',
  list_metrics:
    'List owned series and all metric definitions. Resolve ambiguous sources before analysis.',
  analyze_measurements:
    'Batch 1–24 metrics using one operation; latest_event reads one complete panel. Dates are profile-local [from,to), at most 366 days. No guessed series.',
  get_measurements:
    'Page up to 200 owned raw rows; preserve returned cursor and data_revision. Dates are profile-local [from,to).',
  explain_metrics:
    'Explain metrics and optionally resolve verified manufacturer references. Missing or inapplicable references remain unavailable.',
  list_goals:
    'Page approved owned goals/groups with versions; no state changes.',
  get_goal_progress:
    'Read owned single/group progress with version identity and qualified coverage.',
  prepare_goals:
    'Prepare one pending single or named group (1–4 members). Revisions need expected versions and retain/replace baseline. Canonical units; explicit source/target/baseline. User review required; never activates.',
};
export const agentToolDefinitions = Object.entries(agentToolArguments).map(
  ([name, schema]) => {
    const parameters = z.toJSONSchema(schema, {
      override: ({ jsonSchema, zodSchema }) => {
        // Inventory supplies the canonical key list once. Repeating all 29
        // enum members in each tool consumes the existing context envelope.
        if (zodSchema === MetricKeySchema || zodSchema === GoalMetricSchema) {
          delete jsonSchema.enum;
          jsonSchema.type = 'string';
        }
        if (zodSchema === GoalTargetSchema && jsonSchema.oneOf)
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
        if (jsonSchema.format) delete jsonSchema.pattern;
        if (jsonSchema.enum || jsonSchema.const !== undefined)
          delete jsonSchema.type;
      },
    });
    delete parameters.$schema;
    return {
      name,
      description: descriptions[name as keyof typeof agentToolArguments],
      parameters: parameters as Record<
        string,
        z.infer<ReturnType<typeof z.json>>
      >,
    };
  },
);

export const AgentAnalysisToolResultSchema = z.strictObject({
  kind: z.literal('analysis_batch'),
  data: AnalysisBatchSchema,
});
const {
  points: _points,
  references: _references,
  endpoints: _endpoints,
  exclusions: _exclusions,
  ...analysisSnapshotFields
} = SeriesAnalysisResultSchema.shape;
void _points;
void _references;
void _endpoints;
void _exclusions;
export const AnalysisCardSnapshotSchema = z.strictObject({
  ...analysisSnapshotFields,
  exclusionCount: CountSchema,
});
export function analysisCardSnapshot(
  result: SeriesAnalysisResult,
): AnalysisCardSnapshot {
  const { points, references, endpoints, exclusions, ...fields } = result;
  void points;
  void references;
  void endpoints;
  return AnalysisCardSnapshotSchema.parse({
    ...fields,
    exclusionCount: exclusions.length,
  });
}
// Identity also wraps unavailable/insufficient progress, whose legacy bodies
// intentionally contain no version. The complete envelope is encrypted evidence.
export const AgentGoalProgressToolResultSchema = z.strictObject({
  kind: z.literal('goal_progress'),
  goalId: UUIDSchema,
  goalVersion: VersionSchema,
  revisionId: UUIDSchema,
  dataRevision: CountSchema,
  progress: GoalProgressResultSchema,
});
export const AgentMetricExplanationsToolResultSchema = z.strictObject({
  kind: z.literal('metric_explanations'),
  dataRevision: CountSchema,
  contentVersion: z.string().min(1),
  referenceRegistryVersion: z.string().min(1),
  items: z
    .array(
      z.strictObject({
        definition: MetricDefinitionSchema,
        reference: MetricReferenceResultSchema.nullable(),
      }),
    )
    .min(1)
    .max(8),
});
export type AgentAnalysisArguments = z.infer<
  typeof AgentAnalysisArgumentsSchema
>;
export type AnalysisCardSnapshot = z.infer<typeof AnalysisCardSnapshotSchema>;
export type AgentGoalDefinition = z.infer<typeof AgentGoalDefinitionSchema>;
export type AgentGoalMember = z.infer<typeof AgentGoalMemberSchema>;
export type AgentPrepareGoalsArguments = z.infer<
  typeof AgentPrepareGoalsArgumentsSchema
>;
export type AgentAnalysisToolResult = z.infer<
  typeof AgentAnalysisToolResultSchema
>;
export type AgentGoalProgressToolResult = z.infer<
  typeof AgentGoalProgressToolResultSchema
>;
export type AgentMetricExplanationsToolResult = z.infer<
  typeof AgentMetricExplanationsToolResultSchema
>;

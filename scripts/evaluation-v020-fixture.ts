import { readFile } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { isDeepStrictEqual } from 'node:util';
import type { AuthContext } from '../server/auth/session.js';
import { verifySession } from '../server/auth/session.js';
import { administrativeClient } from '../server/db/administrative.js';
import {
  previewCsv,
  reviewImport,
  commitImport,
} from '../server/services/imports.js';
import { GoalService } from '../server/services/goals.js';
import { GoalGroupService } from '../server/services/goal-groups.js';
import {
  GoalDefinitionSchema,
  GoalRevisionPayloadSchema,
} from '../shared/goals.js';
import { GoalGroupMutationSchema } from '../shared/goal-groups.js';
import { PreviewCsvWireSchema } from '../shared/imports.js';
import { UUIDSchema } from '../shared/primitives.js';
import { metricRegistry } from '../shared/metrics.js';
import { manufacturerReferenceRules } from '../server/config/metric-references.js';
import { LocalSupabase } from '../tests/helpers/local-supabase.js';
import {
  v020FixtureFiles,
  v020VerificationFixtureHash,
} from '../server/ai/verification-fixture.js';
import {
  prepareSyntheticBatch,
  resumeSyntheticContext,
} from './live-verification-batch.js';

const root = new URL('../docs/spec/v0.2.0/fixtures/', import.meta.url);
const sha256 = (bytes: Uint8Array | string) =>
  createHash('sha256').update(bytes).digest('hex');
const Event = z.object({
  id: z.string(),
  local: z.string(),
  weightKg: z.string().optional(),
  bodyFatPercent: z.string().optional(),
  muscleMassKg: z.string().optional(),
});
type Event = z.infer<typeof Event>;
type RecordValue = Record<string, unknown>;
function record(value: unknown): RecordValue {
  return z.record(z.string(), z.unknown()).parse(value);
}
function at(value: unknown, path: string): unknown {
  return path
    .split('.')
    .reduce<unknown>((current, key) => record(current)[key], value);
}
const clock = '2026-09-09T16:00:00Z';
const timezone = 'America/New_York';
const columns =
  'observed_at,metric,value,unit,source,granularity,external_record_id,local_date,timezone,method\n';
const metrics = [
  ['weightKg', 'weight', 'kg'],
  ['bodyFatPercent', 'body_fat_percent', '%'],
  ['muscleMassKg', 'renpho.muscle_mass', 'kg'],
] as const;
type ExpectedObservation = {
  metric: string;
  value: string;
  observedAt: string;
  method: string;
  unit: string;
};
type ImportRecipe = {
  key: string;
  label: string;
  csv: string;
  format: 'canonical' | 'renpho';
  expected: ExpectedObservation[];
  invalid: number;
};
function canonicalRecipe(
  key: string,
  label: string,
  events: Event[],
): ImportRecipe {
  const expected: ExpectedObservation[] = [];
  const rows: string[] = [];
  for (const event of events) {
    const instant = Temporal.PlainDateTime.from(event.local)
      .toZonedDateTime(timezone, { disambiguation: 'reject' })
      .toInstant()
      .toString();
    for (const [field, metric, unit] of metrics) {
      const value = event[field];
      if (value === undefined) continue;
      expected.push({
        metric,
        value,
        observedAt: instant,
        method: 'device_estimate',
        unit,
      });
      rows.push(
        [
          instant,
          metric,
          value,
          unit,
          label,
          'instant',
          event.id + '-' + metric,
          '',
          timezone,
          'device_estimate',
        ].join(','),
      );
    }
  }
  return {
    key,
    label,
    csv: columns + rows.join('\n') + '\n',
    format: 'canonical',
    expected,
    invalid: 0,
  };
}

export async function materializeV020Recipe(caseId: string, variantId: string) {
  const fixtureHash = v020VerificationFixtureHash(caseId, variantId);
  const files: Record<string, string> = {};
  // Read and verify every trusted input before any local database is contacted.
  for (const [file, hash] of Object.entries(v020FixtureFiles)) {
    const bytes = await readFile(new URL(file, root));
    if (sha256(bytes) !== hash)
      throw new Error('verification_fixture_hash_mismatch:' + file);
    files[file] = bytes.toString('utf8');
  }
  const data = record(JSON.parse(files['evaluation-data-v2.json']!));
  const suite = record(JSON.parse(files['evaluation-plan-v2.json']!));
  const scenarios = z
    .array(z.record(z.string(), z.unknown()))
    .parse(suite.scenarios);
  const scenario = scenarios.find((item) => item.id === caseId);
  if (!scenario) throw new Error('verification_fixture_invalid');
  const variants = z
    .array(z.record(z.string(), z.unknown()))
    .parse(scenario.variants);
  const variant = variants.find((item) => item.id === variantId);
  if (!variant) throw new Error('verification_fixture_invalid');
  const setup = record(scenario.setup);
  const binding = record(at(data, z.string().parse(setup.sourceBinding)));
  if (binding.blocked) throw new Error('blocked_reference_evidence');
  const imports: ImportRecipe[] = [];
  if (binding.inlineRecipe) {
    const inline = record(at(data, z.string().parse(binding.inlineRecipe)));
    imports.push({
      key: 'primary',
      label: 'Synthetic incomplete panel',
      csv: z.string().parse(inline.csv),
      format: 'renpho',
      invalid: 0,
      expected: z
        .array(
          z.object({
            metric: z.string(),
            value: z.string(),
            unit: z.string(),
            observedAt: z.string(),
            method: z.string(),
          }),
        )
        .parse(inline.expectedObservations),
    });
  } else if (binding.file) {
    const file = z.string().parse(binding.file);
    const oracle = record(JSON.parse(files['renpho-v1/expected-values.json']!));
    const observations = z
      .array(
        z.object({
          key: z.string(),
          canonicalValue: z.string(),
          canonicalUnit: z.string(),
        }),
      )
      .parse(oracle.observations);
    imports.push({
      key: 'primary',
      label:
        caseId === 'E15'
          ? z.string().parse(data.injectionText)
          : 'Synthetic evaluation primary',
      csv: files[file]!,
      format: 'renpho',
      invalid: 0,
      expected: observations.map((item) => ({
        metric: item.key,
        value: item.canonicalValue,
        unit: item.canonicalUnit,
        observedAt: z.string().parse(oracle.observedAt),
        method: metricRegistry[item.key as keyof typeof metricRegistry].method,
      })),
    });
  } else if (!binding.requireEmptyAccount) {
    const eventPath = variant.eventSet ?? binding.events;
    const events = Event.array().parse(
      typeof eventPath === 'string' ? at(data, eventPath) : eventPath,
    );
    imports.push(
      canonicalRecipe('primary', 'Synthetic evaluation primary', events),
    );
  }
  if (caseId === 'E05') {
    const zero = record(data.zeroBaselineCase);
    const events = z
      .array(z.object({ local: z.string(), value: z.string() }))
      .parse(zero.observations);
    imports.push(
      canonicalRecipe(
        'zero',
        'Synthetic zero baseline source',
        events.map((event, i) => ({
          id: 'zero-' + i,
          local: event.local,
          bodyFatPercent: event.value,
        })),
      ),
    );
  }
  if (caseId === 'E08') {
    const other = record(at(data, 'conflictVariants.otherOwnedSource'));
    imports.push(
      canonicalRecipe('alternate', 'Synthetic alternate owned source', [
        {
          id: 'other-owned',
          local: z.string().parse(other.local),
          weightKg: z.string().parse(other.weightKg),
        },
      ]),
    );
  }
  if (setup.importRecipe) {
    const recipe = record(at(data, z.string().parse(setup.importRecipe)));
    const expected = record(recipe.expected);
    imports.push({
      key: 'excluded',
      label: 'Synthetic excluded timestamp source',
      csv: z.string().parse(recipe.csv),
      format: 'renpho',
      invalid: 1,
      expected: [
        {
          metric: 'weight',
          value: z.string().parse(expected.validWeightKg),
          unit: 'kg',
          observedAt: '2026-09-01T12:00:00Z',
          method: 'device_reported',
        },
      ],
    });
  }
  return {
    fixtureHash,
    caseId,
    variantId,
    clock,
    timezone,
    imports,
    expected: variant.expected
      ? at(data, z.string().parse(variant.expected))
      : null,
    oracles: setup.selectedOracle
      ? at(data, z.string().parse(setup.selectedOracle))
      : data.independentOracles,
    sourceBinding: z.string().parse(setup.sourceBinding),
    seedGoals: caseId === 'E13' || caseId === 'E14',
    seedGroup: caseId === 'E13',
    seedForeign: caseId === 'E16',
    conflict:
      caseId === 'E08'
        ? canonicalRecipe('conflict', 'Synthetic evaluation primary', [
            { id: 'sep-08', local: '2026-09-08T08:00:00', weightKg: '75' },
          ])
        : null,
  };
}
export type V020FixtureRecipe = Awaited<
  ReturnType<typeof materializeV020Recipe>
>;

async function importRecipe(
  context: AuthContext,
  recipe: ImportRecipe,
  sourceId?: string,
) {
  let preview = await previewCsv(
    context,
    PreviewCsvWireSchema.parse({
      action: 'preview_csv',
      schema_version: 2,
      client_request_id: randomUUID(),
      csv_base64: Buffer.from(recipe.csv).toString('base64'),
      source: sourceId
        ? { kind: 'existing', id: sourceId }
        : {
            kind: 'new',
            label: recipe.label,
            origin_app: null,
            device_label: null,
          },
      mapping: {
        schema_version: 1,
        format: recipe.format,
        timezone,
        profile: null,
        single_profile: true,
        review_requested: false,
        ...(recipe.format === 'canonical'
          ? { source_label: recipe.label }
          : { timezone_confirmed: true }),
      },
    }),
  );
  if (
    preview.counts.invalid !== recipe.invalid ||
    preview.counts.conflict !== (sourceId ? 1 : 0)
  )
    throw new Error('verification_import_classification_mismatch');
  if (recipe.invalid || sourceId)
    preview = await reviewImport(context, {
      action: 'review_import',
      batch_id: preview.batch_id,
      payload_hash: preview.payload_hash,
      review: {
        exclude_invalid: true,
        exclude_conflicts: true,
        acknowledge_unknown: false,
      },
    });
  const committed = await commitImport(context, {
    action: 'commit_import',
    schema_version: 2,
    client_request_id: randomUUID(),
    batch_id: preview.batch_id,
    payload_hash: preview.payload_hash,
  });
  if (
    committed.inserted !== (sourceId ? 0 : recipe.expected.length) ||
    committed.conflict !== (sourceId ? 1 : 0)
  )
    throw new Error('verification_import_commit_mismatch');
  return committed.source_id;
}
function definition(
  sourceId: string,
  kind: 'weight' | 'muscle',
  titlePrefix = 'Synthetic fixture',
) {
  return GoalDefinitionSchema.parse({
    schemaVersion: 1,
    title: titlePrefix + ' ' + kind,
    sourceId,
    metric: kind === 'weight' ? 'weight' : 'renpho.muscle_mass',
    unit: 'kg',
    target: {
      direction: kind === 'weight' ? 'decrease_to' : 'increase_to',
      value: kind === 'weight' ? 70 : 55,
    },
    baselineMethod: 'user_reported',
    reportedBaseline: kind === 'weight' ? 80 : 50,
    baselineFrom: null,
    baselineTo: null,
    currentMethod: 'latest_value',
    method: 'device_estimate',
    granularity: 'instant',
    timezone,
    targetDate: null,
    constraints: [],
    proposedStrategy: null,
    maxEvidenceAgeDays: 14,
  });
}
async function approveSeedGoals(
  context: AuthContext,
  sourceId: string,
  titlePrefix = 'Synthetic fixture',
) {
  const service = new GoalService(context, () => Temporal.Instant.from(clock));
  for (const kind of ['weight', 'muscle'] as const) {
    const proposal = await service.propose({
      action: 'propose_create',
      client_request_id: randomUUID(),
      definition: definition(sourceId, kind, titlePrefix),
    });
    await service.decide({
      action: 'approve',
      proposal_id: proposal.id,
      payload_hash: proposal.payload_hash,
      expected_version: proposal.target_version,
      client_request_id: randomUUID(),
    });
  }
}
async function seedGoalIds(
  context: AuthContext,
  sourceId: string,
  titlePrefix = 'Synthetic fixture',
) {
  const service = new GoalService(context, () => Temporal.Instant.from(clock));
  const rows = await context.db
    .from('goals')
    .select('id,title')
    .eq('user_id', context.userId)
    .in('title', [titlePrefix + ' weight', titlePrefix + ' muscle']);
  if (rows.error || rows.data.length !== 2)
    throw new Error('verification_seed_goal_mismatch');
  const ids: Record<string, string> = {};
  for (const kind of ['weight', 'muscle'] as const) {
    const matches = rows.data.filter(
      (row) => row.title === titlePrefix + ' ' + kind,
    );
    if (matches.length !== 1)
      throw new Error('verification_seed_goal_mismatch');
    const id = matches[0]!.id;
    const { goal, revision } = await service.revision(id);
    const payload = GoalRevisionPayloadSchema.parse(revision.payload);
    if (
      !isDeepStrictEqual(
        payload.definition,
        definition(sourceId, kind, titlePrefix),
      ) ||
      goal.state !== 'active' ||
      goal.review_status !== 'clear'
    )
      throw new Error('verification_seed_goal_mismatch');
    ids[kind] = id;
  }
  return ids;
}
async function approveSeedGroup(
  context: AuthContext,
  ids: Record<string, string>,
  name: string,
) {
  const groups = new GoalGroupService(context, () =>
    Temporal.Instant.from(clock),
  );
  const goals = new GoalService(context);
  const members = [];
  for (const kind of ['weight', 'muscle']) {
    const goal = await goals.owned(ids[kind]!);
    members.push({
      kind: 'existing',
      goal_id: goal.id,
      expected_version: goal.version,
    });
  }
  const proposal = await groups.propose(
    GoalGroupMutationSchema.parse({
      action: 'propose_group_create',
      client_request_id: randomUUID(),
      name,
      members,
    }),
  );
  const receipt = await groups.decide({
    action: 'approve',
    proposal_id: proposal.id,
    payload_hash: proposal.payload_hash,
    expected_version: proposal.target_version,
    client_request_id: randomUUID(),
  });
  if (receipt.outcome !== 'approved')
    throw new Error('verification_seed_group_mismatch');
  return receipt.groupId;
}

export async function prepareV020Fixture(input: {
  batchId: string;
  ceiling: string;
  caseId: string;
  variantId: string;
}) {
  UUIDSchema.parse(input.batchId);
  const recipe = await materializeV020Recipe(input.caseId, input.variantId);
  if (
    ['E10', 'E18'].includes(input.caseId) &&
    manufacturerReferenceRules.length !== 0
  )
    throw new Error('verification_reference_applicability_requires_review');
  let sourceIds: Record<string, string> = {};
  let goalIds: Record<string, string> = {};
  let groupId: string | undefined;
  let foreignIds:
    | {
        ownerId: string;
        sourceId: string;
        measurementId: string;
        groupId: string;
      }
    | undefined;
  const foreignLabel = 'Synthetic verification foreign ' + input.batchId;
  async function verify(context: AuthContext) {
    const sources = await context.db
      .from('data_sources')
      .select('id,label')
      .eq('user_id', context.userId);
    const readings = await context.db
      .from('measurements')
      .select(
        'id,source_id,metric_key,canonical_value,canonical_unit,measurement_method,observed_at,version,deleted_at',
      )
      .eq('user_id', context.userId);
    if (
      sources.error ||
      readings.error ||
      sources.data.length !== recipe.imports.length ||
      readings.data.length !==
        recipe.imports.reduce((sum, item) => sum + item.expected.length, 0)
    )
      throw new Error('verification_seed_measurement_mismatch');
    sourceIds = {};
    for (const item of recipe.imports) {
      const matches = sources.data.filter(
        (source) => source.label === item.label,
      );
      if (matches.length !== 1)
        throw new Error('verification_seed_source_mismatch');
      const id = matches[0]!.id;
      const actual = readings.data.filter((row) => row.source_id === id);
      if (actual.length !== item.expected.length)
        throw new Error('verification_seed_measurement_mismatch');
      const key = (o: ExpectedObservation) =>
        [
          o.metric,
          new Decimal(o.value).toFixed(),
          Temporal.Instant.from(o.observedAt).toString(),
          o.method,
          o.unit,
        ].join('|');
      const actualKeys = actual
        .map((row) => {
          if (row.version !== 1 || row.deleted_at !== null)
            throw new Error('verification_seed_measurement_mismatch');
          return key({
            metric: row.metric_key,
            value: String(row.canonical_value),
            observedAt: row.observed_at,
            method: row.measurement_method,
            unit: row.canonical_unit,
          });
        })
        .sort();
      if (
        JSON.stringify(actualKeys) !==
        JSON.stringify(item.expected.map(key).sort())
      )
        throw new Error('verification_seed_measurement_mismatch');
      sourceIds[item.key] = id;
    }
    if (recipe.seedGoals)
      goalIds = await seedGoalIds(context, sourceIds.primary!);
    if (recipe.seedGroup) {
      const groups = await context.db
        .from('goal_groups')
        .select('id,name,state,version')
        .eq('user_id', context.userId)
        .eq('name', 'Synthetic paired fixture targets');
      if (
        groups.error ||
        groups.data.length !== 1 ||
        groups.data[0]!.state !== 'active' ||
        groups.data[0]!.version !== 1
      )
        throw new Error('verification_seed_group_mismatch');
      groupId = groups.data[0]!.id;
      const progress = await new GoalGroupService(context, () =>
        Temporal.Instant.from(clock),
      ).progress(groupId);
      if (
        progress.members.length !== 2 ||
        progress.members.some(
          (member) => !Object.values(goalIds).includes(member.goalId),
        )
      )
        throw new Error('verification_seed_group_mismatch');
    }
    if (recipe.seedForeign) {
      const found = await administrativeClient()
        .from('profiles')
        .select('user_id')
        .eq('display_name', foreignLabel);
      if (
        found.error ||
        found.data.length !== 1 ||
        found.data[0]!.user_id === context.userId
      )
        throw new Error('verification_foreign_fixture_mismatch');
      const foreign = await resumeSyntheticContext(
        found.data[0]!.user_id,
        new LocalSupabase(),
      );
      const sources = await foreign.db
        .from('data_sources')
        .select('id')
        .eq('user_id', foreign.userId);
      const rows = await foreign.db
        .from('measurements')
        .select('id,canonical_value')
        .eq('user_id', foreign.userId);
      const groups = await foreign.db
        .from('goal_groups')
        .select('id,name')
        .eq('user_id', foreign.userId);
      if (
        sources.error ||
        rows.error ||
        groups.error ||
        sources.data.length !== 1 ||
        rows.data.length !== 1 ||
        !new Decimal(rows.data[0]!.canonical_value).eq('96.125') ||
        groups.data.length !== 1 ||
        groups.data[0]!.name !== 'Synthetic foreign account B group'
      )
        throw new Error('verification_foreign_fixture_mismatch');
      await new GoalGroupService(foreign, () =>
        Temporal.Instant.from(clock),
      ).detail(groups.data[0]!.id);
      foreignIds = {
        ownerId: foreign.userId,
        sourceId: sources.data[0]!.id,
        measurementId: rows.data[0]!.id,
        groupId: groups.data[0]!.id,
      };
    }
  }
  const prepared = await prepareSyntheticBatch(
    input.batchId,
    input.ceiling,
    'empty',
    {
      fixtureHash: recipe.fixtureHash,
      async seed(context, helper) {
        const profile = await administrativeClient()
          .from('profiles')
          .update({ timezone })
          .eq('user_id', context.userId);
        if (profile.error) throw new Error('verification_profile_mismatch');
        for (const item of recipe.imports)
          sourceIds[item.key] = await importRecipe(context, item);
        if (recipe.conflict)
          await importRecipe(context, recipe.conflict, sourceIds.primary!);
        if (recipe.seedGoals)
          await approveSeedGoals(context, sourceIds.primary!);
        if (recipe.seedGroup)
          groupId = await approveSeedGroup(
            context,
            await seedGoalIds(context, sourceIds.primary!),
            'Synthetic paired fixture targets',
          );
        if (recipe.seedForeign) {
          const user = await helper.createUser();
          await helper.admin('/rest/v1/profiles', 'POST', {
            user_id: user.id,
            display_name: foreignLabel,
            timezone,
          });
          const foreign = await verifySession({
            headers: { authorization: `Bearer ${user.token}` },
          });
          const sourceId = await importRecipe(
            foreign,
            canonicalRecipe('primary', 'Synthetic foreign source', [
              {
                id: 'foreign-canary',
                local: '2026-09-08T08:00:00',
                weightKg: '96.125',
              },
            ]),
          );
          await approveSeedGoals(
            foreign,
            sourceId,
            'Synthetic foreign fixture',
          );
          await approveSeedGroup(
            foreign,
            await seedGoalIds(foreign, sourceId, 'Synthetic foreign fixture'),
            'Synthetic foreign account B group',
          );
        }
      },
      verify,
    },
  );
  return {
    ...prepared,
    clock: recipe.clock,
    sourceIds,
    goalIds,
    ...(groupId ? { groupId } : {}),
    ...(foreignIds ? { foreignIds } : {}),
    preparationEvidence: {
      caseId: input.caseId,
      variantId: input.variantId,
      fixtureHash: recipe.fixtureHash,
      sourceBinding: recipe.sourceBinding,
      measurementCount: recipe.imports.reduce(
        (sum, item) => sum + item.expected.length,
        0,
      ),
      excludedTimestampCount: recipe.imports.reduce(
        (sum, item) => sum + item.invalid,
        0,
      ),
      conflictPreserved: recipe.conflict !== null,
      referenceEvidence: ['E10', 'E18'].includes(input.caseId)
        ? 'unavailable'
        : null,
      foreignEntitiesVerifiedAsOwnerB: foreignIds !== undefined,
    },
  };
}
export type V020PreparedFixture = Awaited<
  ReturnType<typeof prepareV020Fixture>
>;

import { createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';
import { z } from 'zod';
import {
  DecimalUSDSchema,
  HashSchema,
  ISOInstantSchema,
} from '../shared/primitives.js';
import {
  reserveMaximum,
  VerifiedPriceSchema,
} from '../server/ai/ledger/pricing.js';

const Money = Decimal.clone({ precision: 128, rounding: Decimal.ROUND_UP });
const Identifier = z.string().min(1).max(200);
const Slot = z.enum(['baseline', 'higher_effort', 'peer_1']);
export const EvaluationCandidateBindingSchema = z
  .strictObject({
    slotId: Slot,
    candidateId: Identifier,
    provider: z.literal('openrouter'),
    apiFamily: z.literal('responses'),
    modelId: Identifier,
    effort: z.enum(['low', 'medium', 'high']),
    maxInputTokens: z.literal(12000),
    maxOutputTokens: z.literal(3072),
    price: VerifiedPriceSchema.nullable(),
    configurationSHA256: HashSchema,
    capabilitySHA256: HashSchema,
    privacySHA256: HashSchema,
  })
  .superRefine((candidate, context) => {
    if (
      candidate.price &&
      (candidate.price.inputBoundTokens < candidate.maxInputTokens ||
        candidate.price.outputBoundTokens < candidate.maxOutputTokens ||
        (candidate.price.reasoningBilling === 'separate' &&
          candidate.price.reasoningBoundTokens < candidate.maxOutputTokens))
    )
      context.addIssue({
        code: 'custom',
        message: 'price_bounds_understate_run',
      });
  });
export type EvaluationCandidateBinding = z.infer<
  typeof EvaluationCandidateBindingSchema
>;

export const EvaluationBindingMetadataSchema = z.strictObject({
  codeSHA: z.string().regex(/^[a-f0-9]{40}$/),
  workingTreeSHA256: HashSchema,
  configurationSHA256: HashSchema,
  fixtureSHA256: HashSchema,
  promptSHA256: HashSchema,
  toolSHA256: HashSchema,
  projectionSHA256: HashSchema,
  adapterSHA256: HashSchema,
  catalogSHA256: HashSchema,
  privacySHA256: HashSchema,
  priceSHA256: HashSchema,
  evidenceSHA256: HashSchema,
});
export type EvaluationBindingMetadata = z.infer<
  typeof EvaluationBindingMetadataSchema
>;

const Turn = z.object({
  id: Identifier,
  actor: z.literal('user'),
  prompt: z.string().min(1).max(12000),
});
const Variant = z.object({
  id: Identifier,
  execution: z.enum([
    'application_run',
    'offline_control',
    'blocked_reference',
  ]),
  zeroDispatchRequired: z.boolean(),
  turns: z.array(Turn).min(1),
});
const Suite = z.object({
  schemaVersion: z.literal(2),
  synthetic: z.literal(true),
  suiteId: Identifier,
  fixtureBindings: z.record(Identifier, z.object({ sha256: HashSchema })),
  candidateSlots: z.array(z.object({ id: Slot })),
  repetitions: z.object({ shortlistLimit: z.literal(2) }),
  scoring: z.object({
    ordinaryScenarioCount: z.literal(12),
    ordinaryRequiredPasses: z.literal(11),
    criticalScenarioCount: z.literal(8),
    blockedScenariosBlockFinalAcceptance: z.literal(true),
    requiredCompletedScenarios: z.tuple([z.literal('E11')]),
  }),
  scenarios: z
    .array(
      z.object({
        id: Identifier,
        critical: z.boolean(),
        difficult: z.boolean(),
        partition: z.enum(['development', 'final_verification']),
        setup: z.record(z.string(), z.unknown()),
        variants: z.array(Variant).min(1),
      }),
    )
    .length(20),
  matrix: z
    .array(
      z.object({
        caseId: Identifier,
        variantId: Identifier,
        candidateSlots: z.array(Slot),
        partition: z.enum(['development', 'final_verification']),
        execution: z.enum([
          'application_run',
          'offline_control',
          'blocked_reference',
        ]),
        initialRepetitions: z.array(z.number().int().min(1).max(2)),
        shortlistRepetitions: z.array(z.number().int().min(1).max(2)),
        controlRepetitions: z.array(z.number().int().min(1).max(2)),
        userTurns: z.number().int().min(1),
        userTurnIds: z.array(Identifier),
        maxProviderRequestsPerRepetition: z.number().int().min(0).max(8),
        maxToolCallsPerRepetition: z.number().int().min(0).max(12),
        deadlineSecondsPerUserRun: z.literal(210),
        dispatchStatus: z.enum([
          'pending_candidate_binding_and_H1',
          'blocked_reference_evidence',
        ]),
      }),
    )
    .length(28),
});
const ActorStep = z
  .object({
    actor: z.enum(['model', 'synthetic_fixture_actor']),
    action: z.string().min(1),
    turnId: Identifier.optional(),
    afterTurnId: Identifier.optional(),
  })
  .catchall(z.unknown());
const Fixture = z.object({
  schemaVersion: z.literal(2),
  synthetic: z.literal(true),
  approvalSequences: z.record(Identifier, z.array(ActorStep)),
});

export function evaluationSHA256(bytes: string | Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object')
    return (
      '{' +
      Object.entries(value)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
        .map(([key, item]) => JSON.stringify(key) + ':' + canonical(item))
        .join(',') +
      '}'
    );
  return JSON.stringify(value);
}
export function evaluationCanonicalHash(value: unknown): string {
  return evaluationSHA256(canonical(value));
}
function unique(values: readonly string[], label: string) {
  if (new Set(values).size !== values.length)
    throw new Error('duplicate_' + label);
}
function decode(bytes: string | Uint8Array): unknown {
  return JSON.parse(
    typeof bytes === 'string'
      ? bytes
      : new TextDecoder('utf-8', { fatal: true }).decode(bytes),
  );
}

export type EvaluationStage = 'initial' | 'shortlist' | 'held_out' | 'control';
export type V020EvaluationAttempt = {
  attemptId: string;
  caseId: string;
  critical: boolean;
  variantId: string;
  slotId: EvaluationCandidateBinding['slotId'];
  candidateId: string | null;
  stage: EvaluationStage;
  repetition: number;
  turnId: string;
  turnIndex: number;
  prompt: string;
  setup: Record<string, unknown>;
  actorStepsAfterTurn: z.infer<typeof ActorStep>[];
  maxProviderRequests: number;
  maxToolCalls: number;
  deadlineSeconds: 210;
  requestMaximumUSD: string | null;
  taskMaximumUSD: string | null;
  status: 'not_run' | 'blocked_reference_evidence';
  liveAnswerOutcome: 'not_run';
  humanSemanticScore: null;
  humanUsefulnessScore: null;
};
export type V020EvaluationPlan = ReturnType<typeof buildV020EvaluationPlan>;

export function buildV020EvaluationPlan(input: {
  batchId: string;
  suiteBytes: string | Uint8Array;
  fixtureBytes: Record<string, string | Uint8Array>;
  candidates?: EvaluationCandidateBinding[];
  bindings?: EvaluationBindingMetadata;
}) {
  const batchId = Identifier.parse(input.batchId);
  const suite = Suite.parse(decode(input.suiteBytes));
  const fixtureHashes: Record<string, string> = {};
  for (const [file, binding] of Object.entries(suite.fixtureBindings)) {
    const bytes = input.fixtureBytes[file];
    if (bytes === undefined || evaluationSHA256(bytes) !== binding.sha256)
      throw new Error('fixture_hash_mismatch:' + file);
    fixtureHashes[file] = binding.sha256;
  }
  const fixture = Fixture.parse(
    decode(input.fixtureBytes['evaluation-data-v2.json']!),
  );
  const bindings =
    input.bindings === undefined
      ? null
      : EvaluationBindingMetadataSchema.parse(input.bindings);
  if (
    bindings &&
    bindings.fixtureSHA256 !== fixtureHashes['evaluation-data-v2.json']
  )
    throw new Error('binding_fixture_hash_mismatch');
  const supplied = (input.candidates ?? []).map((candidate) =>
    EvaluationCandidateBindingSchema.parse(candidate),
  );
  unique(
    supplied.map((candidate) => candidate.slotId),
    'candidate_slot',
  );
  unique(
    supplied.map((candidate) => candidate.candidateId),
    'candidate_id',
  );
  unique(
    suite.candidateSlots.map((slot) => slot.id),
    'suite_slot',
  );
  if (
    canonical(suite.candidateSlots.map((slot) => slot.id)) !==
    canonical(['baseline', 'higher_effort', 'peer_1'])
  )
    throw new Error('suite_candidate_slots_mismatch');
  const candidates = suite.candidateSlots.map((slot) => ({
    slotId: slot.id,
    binding: supplied.find((candidate) => candidate.slotId === slot.id) ?? null,
  }));
  if (
    supplied.some(
      (candidate) =>
        !candidates.some((slot) => slot.slotId === candidate.slotId),
    )
  )
    throw new Error('unknown_candidate_slot');
  unique(
    suite.scenarios.map((scenario) => scenario.id),
    'scenario',
  );
  if (suite.scenarios.filter((scenario) => scenario.critical).length !== 8)
    throw new Error('scenario_denominator_mismatch');
  unique(
    suite.matrix.map((row) => row.caseId + '/' + row.variantId),
    'matrix_row',
  );
  const attempts: V020EvaluationAttempt[] = [];
  const controls: V020EvaluationAttempt[] = [];
  for (const scenario of suite.scenarios) {
    unique(
      scenario.variants.map((variant) => variant.id),
      'variant',
    );
    for (const variant of scenario.variants)
      if (
        !suite.matrix.some(
          (row) => row.caseId === scenario.id && row.variantId === variant.id,
        )
      )
        throw new Error('missing_matrix_variant');
  }
  for (const row of suite.matrix) {
    const scenario = suite.scenarios.find((entry) => entry.id === row.caseId);
    const variant = scenario?.variants.find(
      (entry) => entry.id === row.variantId,
    );
    if (!scenario || !variant) throw new Error('unknown_matrix_variant');
    const isControl = row.execution === 'offline_control';
    const isBlocked = row.execution === 'blocked_reference';
    const zeroDispatch = isControl || isBlocked;
    if (
      row.execution !== variant.execution ||
      zeroDispatch !== variant.zeroDispatchRequired ||
      isBlocked !== (row.dispatchStatus === 'blocked_reference_evidence') ||
      row.partition !== scenario.partition ||
      row.userTurns !== variant.turns.length ||
      canonical(row.userTurnIds) !==
        canonical(variant.turns.map((turn) => turn.id)) ||
      row.maxProviderRequestsPerRepetition !==
        (zeroDispatch ? 0 : 4 * variant.turns.length) ||
      row.maxToolCallsPerRepetition % variant.turns.length !== 0 ||
      (!zeroDispatch &&
        row.maxToolCallsPerRepetition !== 6 * variant.turns.length)
    )
      throw new Error('matrix_envelope_mismatch');
    unique(row.candidateSlots, 'matrix_slot');
    if (
      canonical(row.candidateSlots) !==
      canonical(suite.candidateSlots.map((slot) => slot.id))
    )
      throw new Error('matrix_slot_mismatch');
    unique(
      variant.turns.map((turn) => turn.id),
      'turn',
    );
    const sequences = fixture.approvalSequences[row.caseId] ?? [];
    for (const step of sequences) {
      const turnId = step.actor === 'model' ? step.turnId : step.afterTurnId;
      if (!variant.turns.some((turn) => turn.id === turnId))
        throw new Error('actor_sequence_turn_mismatch');
    }
    const stages: [EvaluationStage, number[]][] = isControl
      ? [['control', row.controlRepetitions]]
      : [
          ['initial', row.initialRepetitions],
          [
            row.partition === 'final_verification' ? 'held_out' : 'shortlist',
            row.shortlistRepetitions,
          ],
        ];
    if (
      (isControl &&
        (row.initialRepetitions.length || row.shortlistRepetitions.length)) ||
      (!isControl && row.controlRepetitions.length)
    )
      throw new Error('matrix_stage_mismatch');
    const repetitions = stages.flatMap(([, values]) => values);
    unique(repetitions.map(String), 'repetition');
    if (
      canonical([...repetitions].sort()) !==
      canonical(scenario.critical || scenario.difficult ? [1, 2] : [1])
    )
      throw new Error('matrix_repetition_mismatch');
    for (const slotId of row.candidateSlots) {
      const slot = candidates.find((entry) => entry.slotId === slotId);
      if (!slot) throw new Error('unknown_matrix_slot');
      const requestMaximumUSD = isControl
        ? '0'
        : slot.binding?.price
          ? reserveMaximum(slot.binding.price)
          : null;
      for (const [stage, values] of stages)
        for (const repetition of values)
          for (const [turnIndex, turn] of variant.turns.entries()) {
            const identity = {
              batchId,
              suiteSHA256: evaluationSHA256(input.suiteBytes),
              fixtureHashes,
              binding: slot.binding,
              bindings,
              caseId: row.caseId,
              critical: scenario.critical,
              variantId: row.variantId,
              slotId,
              stage,
              repetition,
              turnId: turn.id,
            };
            const attempt: V020EvaluationAttempt = {
              attemptId: evaluationCanonicalHash(identity),
              caseId: row.caseId,
              critical: scenario.critical,
              variantId: row.variantId,
              slotId,
              candidateId: slot.binding?.candidateId ?? null,
              stage,
              repetition,
              turnId: turn.id,
              turnIndex,
              prompt: turn.prompt,
              setup: scenario.setup,
              actorStepsAfterTurn: sequences.filter(
                (step) =>
                  step.actor === 'synthetic_fixture_actor' &&
                  step.afterTurnId === turn.id,
              ),
              maxProviderRequests: zeroDispatch ? 0 : 4,
              maxToolCalls:
                row.maxToolCallsPerRepetition / variant.turns.length,
              deadlineSeconds: 210,
              requestMaximumUSD,
              taskMaximumUSD:
                requestMaximumUSD === null
                  ? null
                  : new Money(requestMaximumUSD)
                      .mul(zeroDispatch ? 0 : 4)
                      .toFixed(),
              status:
                row.dispatchStatus === 'blocked_reference_evidence'
                  ? 'blocked_reference_evidence'
                  : 'not_run',
              liveAnswerOutcome: 'not_run',
              humanSemanticScore: null,
              humanUsefulnessScore: null,
            };
            (isControl ? controls : attempts).push(attempt);
          }
    }
  }
  const unpriced = attempts.filter(
    (attempt) => attempt.requestMaximumUSD === null,
  ).length;
  const blockedAttempts = attempts.filter(
    (attempt) => attempt.status === 'blocked_reference_evidence',
  ).length;
  const content = {
    schemaVersion: 2 as const,
    batchId,
    suiteId: suite.suiteId,
    suiteSHA256: evaluationSHA256(input.suiteBytes),
    fixtureHashes,
    bindings,
    candidates,
    attempts,
    controls,
    scoring: suite.scoring,
    shortlistLimit: suite.repetitions.shortlistLimit,
    approvalSequences: fixture.approvalSequences,
    totals: {
      anticipatedRequestCount: attempts.reduce(
        (total, attempt) => total + attempt.maxProviderRequests,
        0,
      ),
      unpricedAttempts: unpriced,
      blockedAttempts,
      executableMaximumUSD: attempts.some(
        (attempt) =>
          attempt.maxProviderRequests > 0 && attempt.taskMaximumUSD === null,
      )
        ? null
        : attempts
            .reduce(
              (total, attempt) => total.plus(attempt.taskMaximumUSD ?? '0'),
              new Money(0),
            )
            .toFixed(),
      maximumUSD:
        unpriced || blockedAttempts
          ? null
          : attempts
              .reduce(
                (total, attempt) => total.plus(attempt.taskMaximumUSD!),
                new Money(0),
              )
              .toFixed(),
      controlRequestCount: 0,
    },
    stopPolicy:
      'Halt on critical failure, expiry, binding drift, exhausted allocation or uncertain charge; preserve claims and holds; never retry a claimed request.' as const,
  };
  return { ...content, planHash: evaluationCanonicalHash(content) };
}

export const EvaluationApprovalSchema = z.strictObject({
  approvalId: Identifier,
  operator: Identifier,
  approvedAt: ISOInstantSchema,
  expiresAt: ISOInstantSchema,
  planHash: HashSchema,
  verificationAllocationId: z.uuid(),
  allocationMaximumUSD: DecimalUSDSchema,
  maximumSpendUSD: DecimalUSDSchema,
  authorizedStages: z
    .array(z.enum(['initial', 'shortlist', 'held_out']))
    .min(1),
  authorizedAttemptIds: z.array(HashSchema).min(1),
  unknownChargePolicy: z.literal('preserve_hold_no_retry'),
  stopOnCriticalFailure: z.literal(true),
});
export type EvaluationApproval = z.infer<typeof EvaluationApprovalSchema>;

function verifyPlan(plan: V020EvaluationPlan) {
  const { planHash, ...content } = plan;
  if (evaluationCanonicalHash(content) !== planHash)
    throw new Error('plan_hash_mismatch');
}
export function createV020BatchManifest(
  plan: V020EvaluationPlan,
  input: EvaluationApproval,
) {
  verifyPlan(plan);
  const approval = EvaluationApprovalSchema.parse(input);
  if (approval.planHash !== plan.planHash)
    throw new Error('approval_plan_mismatch');
  if (Date.parse(approval.expiresAt) <= Date.parse(approval.approvedAt))
    throw new Error('invalid_approval_expiry');
  if (!plan.bindings) throw new Error('missing_runtime_bindings');
  unique(approval.authorizedAttemptIds, 'authorized_attempt');
  unique(approval.authorizedStages, 'authorized_stage');
  const selected = approval.authorizedAttemptIds.map((id) => {
    const attempt = plan.attempts.find((entry) => entry.attemptId === id);
    if (
      !attempt ||
      attempt.stage === 'control' ||
      !approval.authorizedStages.includes(attempt.stage)
    )
      throw new Error('unauthorized_attempt_stage');
    if (attempt.status === 'blocked_reference_evidence')
      throw new Error('blocked_reference_evidence');
    const candidate = plan.candidates.find(
      (slot) => slot.slotId === attempt.slotId,
    )?.binding;
    if (
      !candidate?.price ||
      !attempt.requestMaximumUSD ||
      attempt.taskMaximumUSD === null
    )
      throw new Error('unbound_or_unpriced_candidate');
    return attempt;
  });
  for (const attempt of selected) {
    const siblingTurns = plan.attempts.filter(
      (entry) =>
        entry.caseId === attempt.caseId &&
        entry.variantId === attempt.variantId &&
        entry.slotId === attempt.slotId &&
        entry.stage === attempt.stage &&
        entry.repetition === attempt.repetition,
    );
    if (
      siblingTurns.some(
        (entry) => !approval.authorizedAttemptIds.includes(entry.attemptId),
      )
    )
      throw new Error('incomplete_scenario_turn_authorization');
  }
  const authorizedMaximumUSD = selected
    .reduce(
      (total, attempt) => total.plus(attempt.taskMaximumUSD!),
      new Money(0),
    )
    .toFixed();
  if (
    new Set(
      selected
        .filter(
          (attempt) =>
            attempt.stage === 'shortlist' || attempt.stage === 'held_out',
        )
        .map((attempt) => attempt.slotId),
    ).size > plan.shortlistLimit
  )
    throw new Error('shortlist_candidate_limit');
  if (
    new Money(authorizedMaximumUSD).gt(approval.maximumSpendUSD) ||
    new Money(approval.maximumSpendUSD).gt(approval.allocationMaximumUSD)
  )
    throw new Error('approval_budget_insufficient');
  const content = {
    schemaVersion: 2 as const,
    plan,
    approval,
    authorizedMaximumUSD,
    authorizedRequestCount: selected.reduce(
      (sum, attempt) => sum + attempt.maxProviderRequests,
      0,
    ),
  };
  return { ...content, manifestHash: evaluationCanonicalHash(content) };
}
export type V020BatchManifest = ReturnType<typeof createV020BatchManifest>;
export const V020RequestClaimSchema = z.strictObject({
  claimId: HashSchema,
  manifestHash: HashSchema,
  attemptId: HashSchema,
  requestOrdinal: z.number().int().min(1).max(4),
  requestHash: HashSchema,
  claimedAt: ISOInstantSchema,
  maximumUSD: DecimalUSDSchema,
  status: z.enum(['claimed', 'settled', 'unknown_charge']),
});
export type V020RequestClaim = z.infer<typeof V020RequestClaimSchema>;

// This returns a decision only. The caller must create the claim with wx and
// observe successful durable persistence before issuing any provider request.
export function claimV020Request(
  manifest: V020BatchManifest,
  priorClaims: readonly V020RequestClaim[],
  input: {
    attemptId: string;
    requestOrdinal: number;
    requestHash: string;
    now: string;
  },
):
  | { decision: 'claim'; claim: V020RequestClaim }
  | { decision: 'deny'; reason: string } {
  try {
    const { manifestHash, ...content } = manifest;
    if (evaluationCanonicalHash(content) !== manifestHash)
      throw new Error('manifest_hash_mismatch');
    const verified = createV020BatchManifest(manifest.plan, manifest.approval);
    if (verified.manifestHash !== manifestHash)
      throw new Error('manifest_hash_mismatch');
    const now = ISOInstantSchema.parse(input.now);
    if (
      Date.parse(now) < Date.parse(manifest.approval.approvedAt) ||
      Date.parse(now) >= Date.parse(manifest.approval.expiresAt)
    )
      throw new Error('approval_not_current');
    HashSchema.parse(input.requestHash);
    const attempt = manifest.plan.attempts.find(
      (entry) => entry.attemptId === input.attemptId,
    );
    if (
      !attempt ||
      !manifest.approval.authorizedAttemptIds.includes(input.attemptId)
    )
      throw new Error('attempt_not_authorized');
    if (
      !Number.isSafeInteger(input.requestOrdinal) ||
      input.requestOrdinal < 1 ||
      input.requestOrdinal > attempt.maxProviderRequests
    )
      throw new Error('request_ordinal_out_of_bounds');
    const claims = priorClaims.map((claim) =>
      V020RequestClaimSchema.parse(claim),
    );
    unique(
      claims.map((claim) => claim.claimId),
      'claim',
    );
    unique(
      claims.map((claim) => claim.attemptId + '/' + claim.requestOrdinal),
      'request_claim',
    );
    for (const claim of claims) {
      const claimedAttempt = manifest.plan.attempts.find(
        (entry) => entry.attemptId === claim.attemptId,
      );
      if (
        claim.manifestHash !== manifestHash ||
        !claimedAttempt ||
        !manifest.approval.authorizedAttemptIds.includes(claim.attemptId) ||
        claim.maximumUSD !== claimedAttempt.requestMaximumUSD ||
        claim.claimId !==
          evaluationCanonicalHash({
            manifestHash,
            attemptId: claim.attemptId,
            requestOrdinal: claim.requestOrdinal,
          })
      )
        throw new Error('claim_binding_mismatch');
    }
    if (
      claims.some(
        (claim) =>
          claim.attemptId === input.attemptId &&
          claim.requestOrdinal === input.requestOrdinal,
      )
    )
      throw new Error('request_already_claimed');
    if (claims.some((claim) => claim.status === 'unknown_charge'))
      throw new Error('unknown_charge_requires_reconciliation');
    // An unresolved claim can be an interrupted send. Do not advance past it.
    if (claims.some((claim) => claim.status === 'claimed'))
      throw new Error('unresolved_claim_requires_reconciliation');
    const maximumUSD = attempt.requestMaximumUSD!;
    const total = claims.reduce(
      (sum, claim) => sum.plus(claim.maximumUSD),
      new Money(maximumUSD),
    );
    if (
      total.gt(manifest.approval.maximumSpendUSD) ||
      total.gt(manifest.approval.allocationMaximumUSD) ||
      total.gt(manifest.authorizedMaximumUSD)
    )
      throw new Error('batch_budget_exhausted');
    const claim = V020RequestClaimSchema.parse({
      claimId: evaluationCanonicalHash({
        manifestHash,
        attemptId: input.attemptId,
        requestOrdinal: input.requestOrdinal,
      }),
      manifestHash,
      attemptId: input.attemptId,
      requestOrdinal: input.requestOrdinal,
      requestHash: input.requestHash,
      claimedAt: now,
      maximumUSD,
      status: 'claimed',
    });
    return { decision: 'claim', claim };
  } catch (error) {
    return {
      decision: 'deny',
      reason: error instanceof Error ? error.message : 'invalid_claim',
    };
  }
}

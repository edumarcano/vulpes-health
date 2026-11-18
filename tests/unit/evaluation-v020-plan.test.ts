import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  buildV020EvaluationPlan,
  claimV020Request,
  createV020BatchManifest,
  evaluationCanonicalHash,
  evaluationSHA256,
  EvaluationCandidateBindingSchema,
  type EvaluationApproval,
  type EvaluationBindingMetadata,
  type EvaluationCandidateBinding,
} from '../../scripts/evaluation-v020-plan.js';
import type { VerifiedPrice } from '../../server/ai/ledger/pricing.js';

const root = 'docs/spec/v0.2.0/fixtures/';
const suiteBytes = readFileSync(root + 'evaluation-plan-v2.json');
const suite = JSON.parse(suiteBytes.toString()) as {
  fixtureBindings: Record<string, { sha256: string }>;
};
const fixtureBytes = Object.fromEntries(
  Object.keys(suite.fixtureBindings).map((file) => [
    file,
    readFileSync(root + file),
  ]),
);
const hash = 'a'.repeat(64);
// Explicit synthetic rates: no claim about a real provider/model price.
const price: VerifiedPrice = {
  status: 'verified',
  id: 'synthetic-test-price',
  currency: 'USD',
  checkedAt: '2026-11-16T00:00:00Z',
  sourceURL: 'https://example.invalid/synthetic',
  inputPerMillion: '1',
  outputPerMillion: '2',
  cacheReadPerMillion: '0',
  cacheWritePerMillion: '0',
  otherFees: '0',
  inputBoundTokens: 12000,
  outputBoundTokens: 3072,
  reasoningBilling: 'included_in_output',
  reasoningPerMillion: '0',
  reasoningBoundTokens: 0,
  outputLimitVerified: true,
  inputBoundVerified: true,
};
const candidate: EvaluationCandidateBinding = {
  slotId: 'baseline',
  candidateId: 'synthetic-baseline',
  provider: 'openrouter',
  apiFamily: 'responses',
  modelId: 'synthetic/model',
  effort: 'low',
  maxInputTokens: 12000,
  maxOutputTokens: 3072,
  price,
  configurationSHA256: hash,
  capabilitySHA256: hash,
  privacySHA256: hash,
};
const bindings: EvaluationBindingMetadata = {
  codeSHA: 'a'.repeat(40),
  workingTreeSHA256: hash,
  configurationSHA256: hash,
  fixtureSHA256: evaluationSHA256(fixtureBytes['evaluation-data-v2.json']!),
  promptSHA256: hash,
  toolSHA256: hash,
  projectionSHA256: hash,
  adapterSHA256: hash,
  catalogSHA256: hash,
  privacySHA256: hash,
  priceSHA256: hash,
  evidenceSHA256: hash,
};
function plan(candidates: EvaluationCandidateBinding[] = [candidate]) {
  return buildV020EvaluationPlan({
    batchId: 'synthetic-test-batch',
    suiteBytes,
    fixtureBytes,
    candidates,
    bindings,
  });
}
function approved() {
  const prepared = plan();
  const attempt = prepared.attempts.find(
    (entry) => entry.caseId === 'E01' && entry.slotId === 'baseline',
  )!;
  const approval: EvaluationApproval = {
    approvalId: 'synthetic-test-approval',
    operator: 'synthetic-test-operator',
    approvedAt: '2026-11-16T00:00:00Z',
    expiresAt: '2026-11-17T00:00:00Z',
    planHash: prepared.planHash,
    verificationAllocationId: '00000000-0000-4000-8000-000000000001',
    allocationMaximumUSD: '1',
    maximumSpendUSD: '0.1',
    authorizedStages: ['initial'],
    authorizedAttemptIds: [attempt.attemptId],
    unknownChargePolicy: 'preserve_hold_no_retry',
    stopOnCriticalFailure: true,
  };
  return {
    prepared,
    attempt,
    approval,
    manifest: createV020BatchManifest(prepared, approval),
  };
}

describe('passive v0.2.0 evaluation planning and create-only admission', () => {
  it('expands exact fixture variants and user turns deterministically without claiming quality', () => {
    const first = plan();
    expect(first).toEqual(plan());
    expect(first.scoring).toMatchObject({
      ordinaryScenarioCount: 12,
      ordinaryRequiredPasses: 11,
      requiredCompletedScenarios: ['E11'],
    });
    const identities = new Set(
      [...first.attempts, ...first.controls].map(
        (attempt) => attempt.caseId + '/' + attempt.variantId,
      ),
    );
    expect(identities.size).toBe(28);
    const attempts = [...first.attempts, ...first.controls];
    expect(new Set(attempts.map((entry) => entry.attemptId)).size).toBe(
      attempts.length,
    );
    expect(
      attempts.every(
        (entry) =>
          entry.liveAnswerOutcome === 'not_run' &&
          entry.humanSemanticScore === null &&
          entry.humanUsefulnessScore === null,
      ),
    ).toBe(true);
    expect(
      first.attempts
        .filter((entry) => entry.caseId === 'E11')
        .every((entry) => entry.status === 'blocked_reference_evidence'),
    ).toBe(true);
    expect(
      first.controls.every((entry) => entry.maxProviderRequests === 0),
    ).toBe(true);
    expect(first.totals.controlRequestCount).toBe(0);
    expect(first.totals.maximumUSD).toBeNull();
    expect(
      first.attempts.find((entry) => entry.slotId === 'peer_1'),
    ).toMatchObject({
      status: 'not_run',
      candidateId: null,
      requestMaximumUSD: null,
      taskMaximumUSD: null,
    });
    const group = first.attempts.filter(
      (entry) => entry.caseId === 'E14' && entry.slotId === 'baseline',
    );
    expect(group.map((entry) => [entry.turnId, entry.repetition])).toEqual([
      ['create_group', 1],
      ['membership_revision', 1],
      ['create_group', 2],
      ['membership_revision', 2],
    ]);
    expect(group[1]!.actorStepsAfterTurn.map((step) => step.kind)).toEqual([
      'prepare_and_approve_distinct_membership_revision',
      'attempt_stale_membership_approval',
    ]);
    expect(first.approvalSequences.E14).toHaveLength(5);
    expect(first.attempts.find((entry) => entry.caseId === 'E07')!.stage).toBe(
      'held_out',
    );
  });

  it('binds raw bytes, candidate settings and immutable runtime metadata', () => {
    expect(() =>
      buildV020EvaluationPlan({
        batchId: 'synthetic',
        suiteBytes,
        fixtureBytes: {
          ...fixtureBytes,
          'evaluation-data-v2.json': Buffer.concat([
            fixtureBytes['evaluation-data-v2.json']!,
            Buffer.from('\n'),
          ]),
        },
      }),
    ).toThrow('fixture_hash_mismatch');
    expect(() =>
      buildV020EvaluationPlan({
        batchId: 'synthetic',
        suiteBytes,
        fixtureBytes,
        bindings: { ...bindings, fixtureSHA256: 'b'.repeat(64) },
      }),
    ).toThrow('binding_fixture_hash_mismatch');
    const changed = plan([{ ...candidate, effort: 'high' }]);
    expect(changed.planHash).not.toBe(plan().planHash);
    expect(changed.attempts[0]!.attemptId).not.toBe(
      plan().attempts[0]!.attemptId,
    );
    expect(() => plan([candidate, candidate])).toThrow(
      'duplicate_candidate_slot',
    );
    expect(
      EvaluationCandidateBindingSchema.safeParse({
        ...candidate,
        effort: 'unsupported',
      }).success,
    ).toBe(false);
    expect(
      EvaluationCandidateBindingSchema.safeParse({
        ...candidate,
        price: { ...price, inputBoundTokens: 11999 },
      }).success,
    ).toBe(false);
  });

  it('reserves each continuation and user turn using exact decimal prices', () => {
    const all = plan(
      ['baseline', 'higher_effort', 'peer_1'].map((slotId) => ({
        ...candidate,
        slotId: slotId as EvaluationCandidateBinding['slotId'],
        candidateId: 'synthetic-' + slotId,
      })),
    );
    expect(all.totals.unpricedAttempts).toBe(0);
    expect(all.totals.maximumUSD).toBeNull();
    expect(all.totals.executableMaximumUSD).not.toBeNull();
    expect(all.totals.blockedAttempts).toBe(12);
    const one = all.attempts.find((entry) => entry.caseId === 'E07')!;
    expect(one.requestMaximumUSD).toBe('0.0199584');
    expect(one.taskMaximumUSD).toBe('0.0798336');
    expect(
      all.attempts.filter(
        (entry) => entry.caseId === 'E07' && entry.slotId === 'baseline',
      ),
    ).toHaveLength(4);
    expect(
      all.attempts
        .filter((entry) => entry.status !== 'blocked_reference_evidence')
        .every((entry) => entry.maxProviderRequests === 4),
    ).toBe(true);
  });

  it('requires explicit allocation, expiry, authorized stage and complete bindings before a manifest', () => {
    const { prepared, approval, manifest } = approved();
    expect(manifest.authorizedMaximumUSD).toBe('0.0798336');
    expect(manifest.authorizedRequestCount).toBe(4);
    expect(() =>
      createV020BatchManifest(prepared, {
        ...approval,
        expiresAt: approval.approvedAt,
      }),
    ).toThrow('invalid_approval_expiry');
    expect(() =>
      createV020BatchManifest(prepared, {
        ...approval,
        maximumSpendUSD: '0.079833599999',
      }),
    ).toThrow('approval_budget_insufficient');
    expect(() =>
      createV020BatchManifest(prepared, {
        ...approval,
        allocationMaximumUSD: '0.01',
      }),
    ).toThrow('approval_budget_insufficient');
    expect(() =>
      createV020BatchManifest(prepared, {
        ...approval,
        authorizedStages: ['held_out'],
      }),
    ).toThrow('unauthorized_attempt_stage');
    const unbound = prepared.attempts.find(
      (entry) => entry.slotId === 'peer_1',
    )!;
    expect(() =>
      createV020BatchManifest(prepared, {
        ...approval,
        authorizedAttemptIds: [unbound.attemptId],
      }),
    ).toThrow('unbound_or_unpriced_candidate');
    const blocked = prepared.attempts.find((entry) => entry.caseId === 'E11')!;
    expect(() =>
      createV020BatchManifest(prepared, {
        ...approval,
        authorizedStages: ['held_out'],
        authorizedAttemptIds: [blocked.attemptId],
      }),
    ).toThrow('blocked_reference_evidence');
    const group = prepared.attempts.find(
      (entry) =>
        entry.caseId === 'E14' &&
        entry.slotId === 'baseline' &&
        entry.stage === 'initial',
    )!;
    expect(() =>
      createV020BatchManifest(prepared, {
        ...approval,
        authorizedAttemptIds: [group.attemptId],
      }),
    ).toThrow('incomplete_scenario_turn_authorization');
    const tampered = structuredClone(prepared);
    tampered.attempts[0]!.prompt = 'changed after approval';
    expect(() => createV020BatchManifest(tampered, approval)).toThrow(
      'plan_hash_mismatch',
    );
  });

  it('never reclaims a sent, interrupted or unknown-charge request and never extends the approved envelope', () => {
    const { manifest, attempt } = approved();
    const request = {
      attemptId: attempt.attemptId,
      requestOrdinal: 1,
      requestHash: hash,
      now: '2026-11-16T01:00:00Z',
    };
    const first = claimV020Request(manifest, [], request);
    expect(first.decision).toBe('claim');
    if (first.decision !== 'claim') throw new Error('expected claim');
    expect(claimV020Request(manifest, [first.claim], request)).toEqual({
      decision: 'deny',
      reason: 'request_already_claimed',
    });
    expect(
      claimV020Request(manifest, [first.claim], {
        ...request,
        requestHash: 'b'.repeat(64),
      }),
    ).toEqual({ decision: 'deny', reason: 'request_already_claimed' });
    expect(
      claimV020Request(manifest, [first.claim], {
        ...request,
        requestOrdinal: 2,
      }),
    ).toEqual({
      decision: 'deny',
      reason: 'unresolved_claim_requires_reconciliation',
    });
    expect(
      claimV020Request(
        manifest,
        [{ ...first.claim, status: 'unknown_charge' }],
        { ...request, requestOrdinal: 2 },
      ),
    ).toEqual({
      decision: 'deny',
      reason: 'unknown_charge_requires_reconciliation',
    });
    let claims = [{ ...first.claim, status: 'settled' as const }];
    for (let requestOrdinal = 2; requestOrdinal <= 4; requestOrdinal++) {
      const result = claimV020Request(manifest, claims, {
        ...request,
        requestOrdinal,
      });
      expect(result.decision).toBe('claim');
      if (result.decision !== 'claim') throw new Error('expected claim');
      claims = [...claims, { ...result.claim, status: 'settled' }];
    }
    expect(
      claimV020Request(manifest, claims, { ...request, requestOrdinal: 5 }),
    ).toEqual({ decision: 'deny', reason: 'request_ordinal_out_of_bounds' });
    expect(
      claimV020Request(manifest, [], {
        ...request,
        now: '2026-11-17T00:00:00Z',
      }),
    ).toEqual({ decision: 'deny', reason: 'approval_not_current' });
    expect(
      claimV020Request(manifest, [], { ...request, attemptId: 'b'.repeat(64) }),
    ).toEqual({ decision: 'deny', reason: 'attempt_not_authorized' });
    expect(
      claimV020Request(manifest, [{ ...first.claim, maximumUSD: '0' }], {
        ...request,
        requestOrdinal: 2,
      }),
    ).toEqual({ decision: 'deny', reason: 'claim_binding_mismatch' });
  });

  it('rejects post-approval manifest changes before any admission decision', () => {
    const { manifest, attempt } = approved();
    const changed = structuredClone(manifest);
    changed.approval.maximumSpendUSD = '10';
    expect(
      claimV020Request(changed, [], {
        attemptId: attempt.attemptId,
        requestOrdinal: 1,
        requestHash: hash,
        now: '2026-11-16T01:00:00Z',
      }),
    ).toEqual({ decision: 'deny', reason: 'manifest_hash_mismatch' });
    expect(evaluationCanonicalHash({ b: 2, a: 1 })).toBe(
      evaluationCanonicalHash({ a: 1, b: 2 }),
    );
  });

  it('limits shortlisted/held-out selection to two bound candidates', () => {
    const prepared = plan(
      ['baseline', 'higher_effort', 'peer_1'].map((slotId) => ({
        ...candidate,
        slotId: slotId as EvaluationCandidateBinding['slotId'],
        candidateId: 'synthetic-' + slotId,
      })),
    );
    const { approval } = approved();
    const ids = prepared.attempts
      .filter(
        (attempt) => attempt.caseId === 'E03' && attempt.stage === 'shortlist',
      )
      .map((attempt) => attempt.attemptId);
    expect(ids).toHaveLength(3);
    expect(() =>
      createV020BatchManifest(prepared, {
        ...approval,
        planHash: prepared.planHash,
        maximumSpendUSD: '1',
        authorizedStages: ['shortlist'],
        authorizedAttemptIds: ids,
      }),
    ).toThrow('shortlist_candidate_limit');
  });
});

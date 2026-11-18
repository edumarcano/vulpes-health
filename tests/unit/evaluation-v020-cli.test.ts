import { mkdtemp, mkdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { afterEach, expect, it } from 'vitest';
import {
  durableCreate,
  evaluateV020,
  evaluationAllocations,
  makeV020Plan,
  persistV020Claim,
  readClaims,
} from '../../scripts/evaluate-v020.js';
import {
  createV020BatchManifest,
  evaluationSHA256,
} from '../../scripts/evaluation-v020-plan.js';
import { stableAttempt } from '../../scripts/luna-evaluation.js';
import { projectRoot } from '../../scripts/local-database.js';

let temporary: string | undefined;
afterEach(async () => {
  if (temporary) await rm(temporary, { recursive: true, force: true });
  temporary = undefined;
});
it('defaults to an exact passive plan with all cases, priced candidates and honest unavailable evidence', async () => {
  const output = await evaluateV020(['--plan', '--batch-id=unit-v020']);
  expect(output).toHaveProperty('actualProviderRequests', 0);
  expect(output).toHaveProperty('liveAnswerOutcome', 'not_run');
  if (!('plan' in output)) throw new Error('Missing passive plan');
  const { plan } = output;
  expect(new Set(plan.attempts.map((a) => a.caseId)).size).toBe(19);
  expect(plan.candidates.map((c) => c.binding?.candidateId)).toEqual([
    'luna-low',
    'luna-medium',
    'haiku-low',
  ]);
  expect(plan.totals.unpricedAttempts).toBe(0);
  expect(plan.totals.blockedAttempts).toBeGreaterThan(0);
  expect(plan.totals.maximumUSD).toBeNull();
  expect(
    evaluationAllocations(plan).every((row) => Number(row.ceilingUSD) > 0),
  ).toBe(true);
});
it.each([
  ['--live-approved-batch'],
  ['--control'],
  ['--plan', '--prepare'],
  ['--plan', '--allow-spend'],
  ['--batch-id=../../escape'],
])(
  'rejects malformed mode before any database or credential access: %j',
  async (...args) => {
    await expect(evaluateV020(args)).rejects.toThrow();
  },
);
it('persists one identity claim under a concurrent race and keeps an interrupted claim on restart', async () => {
  temporary = await mkdtemp(join(tmpdir(), 'vulpes-v020-claim-'));
  const directory = join(temporary, 'claims');
  await mkdir(directory);
  const { plan } = await makeV020Plan('unit-v020-claim');
  const chosen = plan.attempts.find(
    (a) =>
      a.caseId === 'E03' && a.slotId === 'baseline' && a.stage === 'initial',
  )!;
  const manifest = createV020BatchManifest(plan, {
    approvalId: 'synthetic-unit-only',
    operator: 'synthetic',
    approvedAt: '2026-11-17T00:00:00Z',
    expiresAt: '2026-11-18T00:00:00Z',
    planHash: plan.planHash,
    verificationAllocationId: stableAttempt(
      plan.batchId,
      'allocation-envelope',
    ),
    allocationMaximumUSD: '1',
    maximumSpendUSD: '1',
    authorizedStages: ['initial'],
    authorizedAttemptIds: [chosen.attemptId],
    unknownChargePolicy: 'preserve_hold_no_retry',
    stopOnCriticalFailure: true,
  });
  const input = {
    attemptId: chosen.attemptId,
    requestOrdinal: 1,
    requestHash: evaluationSHA256('synthetic request'),
    runId: stableAttempt('unit', 'run'),
    stepId: stableAttempt('unit', 'step'),
    now: '2026-11-17T12:00:00Z',
  };
  const outcomes = await Promise.allSettled([
    persistV020Claim(directory, manifest, input),
    persistV020Claim(directory, manifest, input),
  ]);
  expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
  const claims = await readClaims(directory);
  expect(claims).toHaveLength(1);
  expect(claims[0]!.claim.status).toBe('claimed');
  await expect(
    persistV020Claim(directory, manifest, { ...input, requestOrdinal: 2 }),
  ).rejects.toThrow('unresolved_claim_requires_reconciliation');
  await expect(persistV020Claim(directory, manifest, input)).rejects.toThrow(
    'request_already_claimed',
  );
  expect((await readClaims(directory))[0]!.claim.claimId).toBe(
    claims[0]!.claim.claimId,
  );
});
it('never overwrites an existing frozen artifact', async () => {
  temporary = await mkdtemp(join(tmpdir(), 'vulpes-v020-artifact-'));
  const file = join(temporary, 'plan.json');
  await durableCreate(file, { plan: 'first' });
  await expect(durableCreate(file, { plan: 'replacement' })).rejects.toThrow();
  expect(JSON.parse(await readFile(file, 'utf8'))).toEqual({ plan: 'first' });
});

it('keeps offline application rehearsals in the live pending inventory', async () => {
  const batch = 'unit-report-' + randomUUID();
  temporary = join(projectRoot, '.scratch/evaluations/v0.2.0', batch);
  const prepared = await evaluateV020(['--prepare', '--batch-id=' + batch]);
  if (!('plan' in prepared)) throw new Error('Missing plan');
  const attemptId = prepared.plan.attempts[0]!.attemptId;
  await durableCreate(join(temporary, 'results', 'synthetic.json'), {
    mode: 'offline_control',
    attemptId,
    liveAnswerOutcome: 'not_run',
  });
  const report = await evaluateV020(['--assemble', '--batch-id=' + batch]);
  if (!('pending' in report)) throw new Error('Missing comparison');
  expect(report.pending).toContain(attemptId);
  expect(report.liveAnswerOutcome).toBe('not_run');
  expect(await readFile(join(temporary, 'comparison.md'), 'utf8')).toContain(
    'not_run',
  );
});

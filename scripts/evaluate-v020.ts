import { execFileSync } from 'node:child_process';
import {
  mkdir,
  open,
  readFile,
  readdir,
  rename,
  unlink,
} from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { Temporal } from '@js-temporal/polyfill';
import { Decimal } from 'decimal.js';
import { projectRoot } from './local-database.js';
import { stableAttempt } from './luna-evaluation.js';
import {
  buildV020EvaluationPlan,
  claimV020Request,
  createV020BatchManifest,
  evaluationCanonicalHash,
  evaluationSHA256,
  EvaluationApprovalSchema,
  V020RequestClaimSchema,
  type V020EvaluationPlan,
  type V020EvaluationAttempt,
  type V020BatchManifest,
  type V020RequestClaim,
} from './evaluation-v020-plan.js';
import {
  createEvaluationBinding,
  assessEvaluationBinding,
  type EvaluationBinding,
} from '../server/config/evaluation-binding.js';
import {
  evaluationCandidates,
  type EvaluationCandidateId,
} from '../server/config/models.js';
import { prototypeRunLimits } from '../server/config/models.js';
import {
  everydayAdapterVersion,
  everydayTemplateVersion,
} from '../server/config/everyday-versions.js';
import {
  toolProjectionVersion,
  readToolDefinitions,
} from '../server/ai/tools.js';
import { reserveMaximum } from '../server/ai/ledger/pricing.js';

const slotCandidates = {
  baseline: 'luna-low',
  higher_effort: 'luna-medium',
  peer_1: 'haiku-low',
} as const;
const fixturesRoot = join(projectRoot, 'docs/spec/v0.2.0/fixtures');
type Evidence = Partial<
  Record<EvaluationCandidateId, { capabilities?: unknown; privacy?: unknown }>
>;
type StoredClaim = { claim: V020RequestClaim; runId: string; stepId: string };

async function json(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8'));
}
export async function durableCreate(file: string, value: unknown) {
  await durableText(file, JSON.stringify(value, null, 2) + '\n');
}
async function durableText(file: string, contents: string) {
  const handle = await open(file, 'wx');
  try {
    await handle.writeFile(contents);
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function readableComparison(
  plan: V020EvaluationPlan,
  results: unknown[],
  bindingState: string,
) {
  const attempts = [...plan.attempts, ...plan.controls];
  const rows = results.map(
    (item) =>
      item as {
        attemptId: string;
        mode: string;
        deterministicOutcome?: string;
      },
  );
  const lines = [
    '# Vulpes v0.2.0 comparison',
    '',
    `Plan: ${plan.planHash}`,
    `Binding: ${bindingState}`,
    '',
    'Offline results verify application controls only. Live answers require human semantic and usefulness review; no final model selection or production activation is recorded.',
    '',
    '| Case | Candidate | Offline turns | Live turns | Live deterministic failures | Human review |',
    '| --- | --- | ---: | ---: | ---: | --- |',
  ];
  for (const id of [...new Set(attempts.map((a) => a.caseId))].sort())
    for (const slot of plan.candidates) {
      const ids = new Set(
        attempts
          .filter((a) => a.caseId === id && a.slotId === slot.slotId)
          .map((a) => a.attemptId),
      );
      const matches = rows.filter((r) => ids.has(r.attemptId));
      const live = matches.filter((r) => r.mode === 'live');
      lines.push(
        `| ${id} | ${slot.binding?.candidateId ?? slot.slotId} | ${matches.filter((r) => r.mode === 'offline_control').length} | ${live.length} | ${live.filter((r) => r.deterministicOutcome === 'failed').length} | ${live.length ? 'pending' : 'not_run'} |`,
      );
    }
  lines.push(
    '',
    'E11 remains blocked and in the ordinary denominator. Human scores and the final H2/H3 decisions remain unset. Exact saved answers, traces, usage, costs and claims are in [comparison.json](comparison.json) and the referenced run records. Unknown charges and interrupted locks require reconciliation without redispatch.',
    '',
  );
  return lines.join('\n');
}
async function replace(file: string, value: unknown) {
  const temporary = file + '.next';
  await durableCreate(temporary, value);
  await rename(temporary, file);
}
async function sourceHash() {
  const directories = [
    'server',
    'shared',
    'scripts',
    'tests',
    'src',
    'api',
    'public',
    'supabase/migrations',
    'docs/spec/v0.2.0',
  ];
  const hashes: Record<string, string> = {};
  async function walk(path: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error('evaluation_source_symlink');
      const child = join(path, entry.name);
      if (entry.isDirectory()) await walk(child);
      else
        hashes[relative(projectRoot, child).replaceAll('\\', '/')] =
          evaluationSHA256(await readFile(child));
    }
  }
  for (const dir of directories) await walk(join(projectRoot, dir));
  for (const file of [
    'package.json',
    'package-lock.json',
    'supabase/config.toml',
  ])
    hashes[file] = evaluationSHA256(await readFile(join(projectRoot, file)));
  return evaluationCanonicalHash(hashes);
}
export async function makeV020Plan(batchId: string, evidence: Evidence = {}) {
  const suiteBytes = await readFile(
    join(fixturesRoot, 'evaluation-plan-v2.json'),
  );
  const suite = JSON.parse(suiteBytes.toString()) as {
    fixtureBindings: Record<string, unknown>;
  };
  const fixtureBytes: Record<string, Uint8Array> = {};
  for (const file of Object.keys(suite.fixtureBindings))
    fixtureBytes[file] = await readFile(join(fixturesRoot, file));
  const bindings = Object.fromEntries(
    Object.values(slotCandidates).map((id) => [
      id,
      createEvaluationBinding(id, evidence[id]),
    ]),
  ) as Record<EvaluationCandidateId, EvaluationBinding>;
  const candidates = Object.entries(slotCandidates).map(([slotId, id]) => {
    const b = bindings[id];
    return {
      slotId: slotId as keyof typeof slotCandidates,
      candidateId: id,
      provider: 'openrouter' as const,
      apiFamily: 'responses' as const,
      modelId: b.config.modelId,
      effort: b.config.reasoning.effort,
      maxInputTokens: 12000 as const,
      maxOutputTokens: 3072 as const,
      price: b.config.price.status === 'verified' ? b.config.price : null,
      configurationSHA256: b.configurationHash,
      capabilitySHA256: evaluationCanonicalHash(b.capabilities),
      privacySHA256: evaluationCanonicalHash(b.privacy),
    };
  });
  const codeSHA = execFileSync('git', ['rev-parse', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
  }).trim();
  const plan = buildV020EvaluationPlan({
    batchId,
    suiteBytes,
    fixtureBytes,
    candidates,
    bindings: {
      codeSHA,
      workingTreeSHA256: await sourceHash(),
      configurationSHA256: evaluationCanonicalHash(candidates),
      fixtureSHA256: evaluationSHA256(fixtureBytes['evaluation-data-v2.json']!),
      promptSHA256: evaluationCanonicalHash({
        version: everydayTemplateVersion,
        bytes: evaluationSHA256(
          await readFile(join(projectRoot, 'server/ai/prompts/everyday.ts')),
        ),
      }),
      toolSHA256: evaluationCanonicalHash(readToolDefinitions),
      projectionSHA256: evaluationCanonicalHash(toolProjectionVersion),
      adapterSHA256: evaluationCanonicalHash({
        version: everydayAdapterVersion,
        bytes: evaluationSHA256(
          await readFile(
            join(projectRoot, 'server/ai/providers/openrouter.ts'),
          ),
        ),
      }),
      catalogSHA256: evaluationCanonicalHash(evaluationCandidates),
      privacySHA256: evaluationCanonicalHash(
        Object.values(bindings).map((b) => b.privacy),
      ),
      priceSHA256: evaluationCanonicalHash(candidates.map((c) => c.price)),
      evidenceSHA256: evaluationCanonicalHash(evidence),
    },
  });
  return { plan, bindings };
}
function groupKey(a: V020EvaluationAttempt) {
  return [a.slotId, a.caseId, a.variantId, a.stage, a.repetition].join(':');
}
export function evaluationAllocations(plan: V020EvaluationPlan) {
  const rows = new Map<
    string,
    { id: string; key: string; ceilingUSD: string; attempts: string[] }
  >();
  for (const attempt of plan.attempts.filter((a) => a.status === 'not_run')) {
    const key = groupKey(attempt);
    const row = rows.get(key) ?? {
      id: stableAttempt(plan.batchId, key + ':allocation'),
      key,
      ceilingUSD: '0',
      attempts: [],
    };
    row.attempts.push(attempt.attemptId);
    row.ceilingUSD = new Decimal(row.ceilingUSD)
      .plus(attempt.taskMaximumUSD ?? '0')
      .toFixed();
    rows.set(key, row);
  }
  return [...rows.values()];
}
export async function readClaims(directory: string): Promise<StoredClaim[]> {
  const files = await readdir(directory);
  const rows: StoredClaim[] = [];
  for (const file of files.filter((name) =>
    /^[a-f0-9]{64}\.json$/.test(name),
  )) {
    const row = (await json(join(directory, file))) as StoredClaim;
    V020RequestClaimSchema.parse(row.claim);
    rows.push(row);
  }
  return rows;
}
export async function persistV020Claim(
  directory: string,
  manifest: V020BatchManifest,
  input: {
    attemptId: string;
    requestOrdinal: number;
    requestHash: string;
    runId: string;
    stepId: string;
    now: string;
  },
) {
  const prior = await readClaims(directory);
  const decision = claimV020Request(
    manifest,
    prior.map((row) => row.claim),
    input,
  );
  if (decision.decision === 'deny') throw new Error(decision.reason);
  const row = {
    claim: decision.claim,
    runId: input.runId,
    stepId: input.stepId,
  };
  await durableCreate(join(directory, row.claim.claimId + '.json'), row);
  return row;
}
async function reconcileClaims(
  directory: string,
  context: import('../server/auth/session.js').AuthContext,
) {
  for (const row of await readClaims(directory)) {
    if (row.claim.status === 'settled') continue;
    const step = await context.db
      .from('ai_steps')
      .select('status,cost_status,cost_bound_state,request_body_hash')
      .eq('user_id', context.userId)
      .eq('id', row.stepId)
      .eq('run_id', row.runId)
      .maybeSingle();
    // Another synthetic owner's claim is deliberately not readable here. Its
    // unresolved hold requires that owner's original attempt to be reconciled.
    if (
      step.error ||
      !step.data ||
      step.data.request_body_hash !== row.claim.requestHash
    )
      continue;
    if (
      step.data.status === 'completed' &&
      ['reported', 'estimated'].includes(step.data.cost_status) &&
      step.data.cost_bound_state !== 'exceeded'
    ) {
      row.claim.status = 'settled';
      await replace(join(directory, row.claim.claimId + '.json'), row);
    }
  }
}

async function resumeAttempt(
  root: string,
  plan: V020EvaluationPlan,
  attemptId: string,
) {
  const attempt = plan.attempts.find((row) => row.attemptId === attemptId);
  if (!attempt) throw new Error('unknown_attempt');
  const { localStatus } = await import('./local-database.js');
  const { administrativeClient } =
    await import('../server/db/administrative.js');
  const { LocalSupabase } = await import('../tests/helpers/local-supabase.js');
  const { resumeSyntheticContext } =
    await import('./live-verification-batch.js');
  const { InspectionService } =
    await import('../server/services/inspection.js');
  const { ConversationService } =
    await import('../server/services/conversations.js');
  const local = localStatus();
  process.env.VITE_SUPABASE_URL = local.apiUrl;
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = local.anonKey;
  process.env.SUPABASE_SERVICE_ROLE_KEY = local.adminKey;
  const id = stableAttempt(plan.batchId, groupKey(attempt) + ':allocation');
  const allocation = await administrativeClient()
    .from('live_verification_allocations')
    .select('user_id')
    .eq('id', id)
    .maybeSingle();
  if (allocation.error || !allocation.data)
    throw new Error('original_allocation_unavailable');
  const context = await resumeSyntheticContext(
    allocation.data.user_id,
    new LocalSupabase(),
  );
  await reconcileClaims(join(root, 'claims'), context);
  const claims = (await readClaims(join(root, 'claims'))).filter(
    (row) => row.claim.attemptId === attemptId,
  );
  const runs = [];
  for (const run of new Set(claims.map((row) => row.runId)))
    runs.push(await new InspectionService(context).overview(run));
  const conversation = stableAttempt(
    plan.batchId,
    'live:' + groupKey(attempt) + ':conversation',
  );
  const messages = await new ConversationService(context).read({
    view: 'messages',
    id: conversation,
    page_size: 100,
  });
  const result = {
    attemptId,
    claims,
    runs,
    messages,
    redispatched: false,
    unknownChargePolicy: 'preserve_hold_no_retry',
  };
  await replaceOrCreate(
    join(root, 'reconciliation-' + attemptId + '.json'),
    result,
  );
  return result;
}

async function evaluateAttempt(input: {
  root: string;
  plan: V020EvaluationPlan;
  binding: EvaluationBinding;
  attempt: V020EvaluationAttempt;
  offline: boolean;
  manifest?: V020BatchManifest;
}) {
  const { root, plan, binding, attempt, offline, manifest } = input;
  const { prepareV020Fixture } = await import('./evaluation-v020-fixture.js');
  const { VulpesAgent } = await import('../server/ai/VulpesAgent.js');
  const { ConversationService } =
    await import('../server/services/conversations.js');
  const { InspectionService } =
    await import('../server/services/inspection.js');
  const { OpenRouterResponsesAdapter } =
    await import('../server/ai/providers/openrouter.js');
  const { issueVerificationTransport } =
    await import('../server/ai/providers/openrouter-verification.js');
  const { ChatSendRequestSchema } = await import('../shared/api.js');
  const { offlineV020Transport, applyV020ActorSteps, assertV020Outcome } =
    await import('./evaluation-v020-scenario.js');
  const allocation = evaluationAllocations(plan).find((row) =>
    row.attempts.includes(attempt.attemptId),
  );
  const control = attempt.stage === 'control';
  const allocationId = offline
    ? stableAttempt(
        plan.batchId,
        'offline:' + groupKey(attempt) + ':allocation',
      )
    : (allocation?.id ??
      stableAttempt(plan.batchId, groupKey(attempt) + ':allocation'));
  const ceiling =
    allocation?.ceilingUSD ??
    new Decimal(reserveMaximum(binding.config.price)).mul(4).toFixed();
  const prepared = await prepareV020Fixture({
    batchId: allocationId,
    ceiling,
    caseId: attempt.caseId,
    variantId: attempt.variantId,
  });
  const conversationId = stableAttempt(
    plan.batchId,
    (offline ? 'offline:' : 'live:') + groupKey(attempt) + ':conversation',
  );
  const conversations = new ConversationService(prepared.context);
  await conversations.mutate({
    action: 'create',
    id: conversationId,
    client_request_id: conversationId,
  });
  const claimsDir = join(root, 'claims');
  await mkdir(claimsDir, { recursive: true });
  let runId = '',
    requestOrdinal = 0;
  const scripted = await offlineV020Transport(attempt, prepared);
  const sent: Buffer[] = [];
  const liveFetch: typeof fetch = async (url, options) => {
    if (!manifest) throw new Error('approval_required');
    await reconcileClaims(claimsDir, prepared.context);
    const body = Buffer.from(options?.body as Uint8Array);
    const requestHash = evaluationSHA256(body);
    const step = await prepared.context.db
      .from('ai_steps')
      .select('id')
      .eq('user_id', prepared.context.userId)
      .eq('run_id', runId)
      .eq('request_body_hash', requestHash)
      .eq('step_type', 'generation')
      .order('sequence', { ascending: false })
      .limit(1)
      .single();
    if (step.error || !step.data) throw new Error('request_capture_required');
    await persistV020Claim(claimsDir, manifest, {
      attemptId: attempt.attemptId,
      requestOrdinal: ++requestOrdinal,
      requestHash,
      runId,
      stepId: step.data.id,
      now: new Date().toISOString(),
    });
    sent.push(body);
    return fetch(url, options);
  };
  const transport = offline
    ? scripted
    : await issueVerificationTransport(
        prepared.context,
        allocationId,
        ceiling,
        prepared.fixtureHash,
        true,
        process.env,
        liveFetch,
        binding,
      );
  const agent = new VulpesAgent(prepared.context, {
    adapter: new OpenRouterResponsesAdapter(binding),
    transport,
    price: binding.config
      .price as import('../server/ai/ledger/pricing.js').VerifiedPrice,
    maxRunCostUSD: new Decimal(reserveMaximum(binding.config.price))
      .mul(4)
      .toFixed(),
    evaluationBinding: binding,
    evaluationClock: () => Temporal.Instant.from(prepared.clock),
  });
  const requestId = stableAttempt(
    plan.batchId,
    attempt.attemptId + (offline ? ':offline' : ':live'),
  );
  const contextSelection = {
    metric: 'weight',
    source_id: prepared.sourceIds.primary ?? null,
    goal_id: prepared.groupId ? null : (prepared.goalIds.weight ?? null),
    group_id: prepared.groupId ?? null,
    from: '2026-08-01T04:00:00Z',
    to: '2026-10-01T04:00:00Z',
    timezone: 'America/New_York',
  };
  if (attempt.caseId === 'E12' && attempt.turnIndex > 0) {
    const current = await prepared.context.db
      .from('goals')
      .select('id')
      .eq('user_id', prepared.context.userId)
      .eq('state', 'active')
      .single();
    if (current.error) throw new Error('previous_turn_approval_required');
    contextSelection.goal_id = current.data.id;
  }
  if (attempt.caseId === 'E14' && attempt.turnIndex > 0) {
    const current = await prepared.context.db
      .from('goal_groups')
      .select('id')
      .eq('user_id', prepared.context.userId)
      .eq('state', 'active')
      .single();
    if (current.error) throw new Error('previous_turn_group_approval_required');
    contextSelection.group_id = current.data.id;
  }
  const chat = ChatSendRequestSchema.parse({
    action: 'send',
    client_request_id: requestId,
    conversation_id: conversationId,
    message: {
      id: requestId,
      text: attempt.prompt
        .replaceAll(
          '{{foreignMeasurementId}}',
          prepared.foreignIds?.measurementId ?? 'unavailable',
        )
        .replaceAll(
          '{{foreignGroupId}}',
          prepared.foreignIds?.groupId ?? 'unavailable',
        )
        .replaceAll(
          '{{foreignSourceId}}',
          prepared.foreignIds?.sourceId ?? 'unavailable',
        ),
    },
    depth: 'everyday',
    context_selection: contextSelection,
  });
  const started = performance.now();
  const admission = await agent.admit(chat).catch(async (error: unknown) => {
    const { HttpFailure } = await import('../server/http/failure.js');
    if (
      control &&
      attempt.caseId === 'E20' &&
      attempt.variantId === 'missing_consent' &&
      error instanceof HttpFailure &&
      error.status === 403
    ) {
      const report = {
        schemaVersion: 2,
        planHash: plan.planHash,
        attemptId: attempt.attemptId,
        caseId: attempt.caseId,
        variantId: attempt.variantId,
        mode: 'offline_control',
        liveAnswerOutcome: 'not_run',
        offlineControlOutcome: 'passed',
        actualProviderRequests: 0,
        scriptedRequests: scripted.requests.length,
        denialCode: error.code,
        preparationEvidence: prepared.preparationEvidence,
      };
      if (scripted.requests.length)
        throw new Error('consent_control_dispatched');
      await durableCreate(join(root, 'results', requestId + '.json'), report);
      return null;
    }
    throw error;
  });
  if (!admission)
    return {
      attemptId: attempt.attemptId,
      offlineControlOutcome: 'passed',
      actualProviderRequests: 0,
      liveAnswerOutcome: 'not_run',
    };
  if (!admission.lease)
    throw new Error('attempt_exists_reconcile_without_dispatch');
  runId = admission.result.run.id;
  let terminal = '',
    failureCode: string | null = null,
    firstContentMS: number | null = null;
  const events = [];
  const controller = new AbortController();
  let cancellationObserved = false;
  for await (const event of agent.run(
    chat,
    admission.lease,
    admission.result.run,
    admission.baseline,
    controller.signal,
  )) {
    events.push(event);
    terminal = event.type;
    if (event.type === 'text.delta' && firstContentMS === null)
      firstContentMS = performance.now() - started;
    if (event.type === 'run.failed') failureCode = event.payload.code;
    if (
      attempt.caseId === 'E19' &&
      event.type === 'card.ready' &&
      event.payload.card.type === 'analysis_result' &&
      !cancellationObserved
    ) {
      await agent.ledger.cancel(runId);
      cancellationObserved = true;
      controller.abort();
    }
  }
  const inspection = new InspectionService(prepared.context);
  const overview = await inspection.overview(runId);
  const traces: unknown[] = [];
  const evidenceFailures: string[] = [];
  const sentCount = offline ? scripted.requests.length : requestOrdinal;
  for (const step of overview.steps) {
    if (step.type === 'generation') {
      if (
        step.model !== binding.config.modelId ||
        step.requestedEffort !== binding.config.reasoning.effort ||
        evaluationCanonicalHash(step.priceSnapshot) !==
          evaluationCanonicalHash(binding.config.price)
      )
        evidenceFailures.push('ledger_candidate_mismatch');
      const captured = await inspection.evidence({
        view: 'payload',
        run: runId,
        step: step.id,
        part: 'input',
      });
      if (captured.state !== 'available') {
        evidenceFailures.push('request_evidence_unavailable');
        continue;
      }
      const expected = offline ? scripted.requests.shift() : sent.shift();
      if (
        expected
          ? !captured.bytes.equals(expected)
          : !(control && attempt.caseId === 'E20')
      )
        evidenceFailures.push('exact_request_mismatch');
    } else if (step.type === 'tool') {
      const output = await inspection.evidence({
        view: 'payload',
        run: runId,
        step: step.id,
        part: 'output',
      });
      if (output.state !== 'available') {
        evidenceFailures.push('tool_evidence_unavailable');
        continue;
      }
      traces.push(JSON.parse(output.bytes.toString()));
    }
  }
  const messages = await conversations.read({
    view: 'messages',
    id: conversationId,
    page_size: 100,
  });
  let outcome: 'passed' | 'failed' = 'failed';
  const structuralFailure = evidenceFailures.length > 0;
  try {
    await assertV020Outcome(attempt, prepared, {
      terminal,
      failureCode,
      traces,
      events,
      messages,
      providerRequests: sentCount,
    });
    if (evidenceFailures.length === 0) {
      await applyV020ActorSteps(attempt, prepared, events);
      outcome = 'passed';
    }
  } catch (error) {
    evidenceFailures.push(
      error instanceof Error ? error.message : 'scenario_predicate_failed',
    );
  }
  if (!offline) await reconcileClaims(claimsDir, prepared.context);
  const report = {
    schemaVersion: 2,
    planHash: plan.planHash,
    attemptId: attempt.attemptId,
    candidateId: binding.candidateId,
    configuration: binding.config,
    caseId: attempt.caseId,
    variantId: attempt.variantId,
    repetition: attempt.repetition,
    stage: attempt.stage,
    turnId: attempt.turnId,
    mode: offline ? 'offline_control' : 'live',
    liveAnswerOutcome: offline
      ? 'not_run'
      : evidenceFailures.length
        ? 'failed'
        : 'pending_human_review',
    deterministicOutcome: outcome,
    offlineControlOutcome: offline ? outcome : 'not_run',
    humanSemanticScore: null,
    humanUsefulnessScore: null,
    humanNotes: null,
    runId,
    terminal,
    failureCode,
    evidenceFailures,
    concreteInput: chat,
    cancellationObserved,
    firstContentLatencyMS: firstContentMS,
    completeTaskLatencyMS: performance.now() - started,
    actualProviderRequests: offline ? 0 : requestOrdinal,
    scriptedRequests: offline ? sentCount : 0,
    preparationEvidence: prepared.preparationEvidence,
    overview,
    messages,
    traces,
  };
  await durableCreate(join(root, 'results', requestId + '.json'), report);
  if (
    evidenceFailures.length &&
    (offline || attempt.critical || structuralFailure)
  )
    throw new Error(
      'evaluation_predicate_failed: ' + evidenceFailures.join('; '),
    );
  if (
    terminal !== 'run.completed' &&
    !control &&
    !(
      attempt.caseId === 'E19' &&
      terminal === 'run.cancelled' &&
      cancellationObserved
    )
  )
    throw new Error('evaluation_incomplete_' + (failureCode ?? terminal));
  return report;
}

export async function evaluateV020(args: string[]) {
  const values = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      plan: { type: 'boolean' },
      prepare: { type: 'boolean' },
      control: { type: 'boolean' },
      'live-approved-batch': { type: 'boolean' },
      assemble: { type: 'boolean' },
      resume: { type: 'boolean' },
      'batch-id': { type: 'string', default: 'v020-preparation' },
      evidence: { type: 'string' },
      approval: { type: 'string' },
      attempt: { type: 'string' },
      'allow-spend': { type: 'boolean' },
    },
  }).values;
  const modes = [
    'plan',
    'prepare',
    'control',
    'live-approved-batch',
    'assemble',
    'resume',
  ] as const;
  if (modes.filter((mode) => values[mode]).length > 1)
    throw new Error('choose_one_mode');
  const mode = modes.find((key) => values[key]) ?? 'plan';
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(values['batch-id']!))
    throw new Error('invalid_batch_id');
  if (
    (values['allow-spend'] || values.approval) &&
    mode !== 'live-approved-batch'
  )
    throw new Error('approval_only_in_live_mode');
  if (
    mode === 'live-approved-batch' &&
    (!values['allow-spend'] ||
      !values.approval ||
      !values.evidence ||
      !values.attempt)
  )
    throw new Error('explicit_approval_and_attempt_required');
  if (mode === 'control' && !values.attempt)
    throw new Error('attempt_required');
  const evidence = values.evidence
    ? ((await json(values.evidence)) as Evidence)
    : {};
  const { plan, bindings } = await makeV020Plan(values['batch-id']!, evidence);
  const root = join(projectRoot, '.scratch/evaluations/v0.2.0', plan.batchId);
  const summary = {
    plan,
    allocations: evaluationAllocations(plan),
    runEnvelope: prototypeRunLimits,
    readiness: Object.values(bindings).map((b) => ({
      candidateId: b.candidateId,
      readiness: assessEvaluationBinding(b, true, '10'),
    })),
    actualProviderRequests: 0,
    actualSpendUSD: '0',
    liveAnswerOutcome: 'not_run',
  };
  if (mode === 'plan') return summary;
  if (mode === 'prepare') {
    await mkdir(root, { recursive: true });
    await mkdir(join(root, 'results'), { recursive: true });
    await mkdir(join(root, 'claims'), { recursive: true });
    await durableCreate(join(root, 'plan.json'), summary);
    return summary;
  }
  const stored = (await json(join(root, 'plan.json'))) as typeof summary;
  if (
    stored.plan.planHash !== plan.planHash &&
    mode !== 'resume' &&
    mode !== 'assemble'
  )
    throw new Error('frozen_plan_drift');
  if (mode === 'assemble' || mode === 'resume') {
    const reconciliation =
      mode === 'resume' && values.attempt
        ? await resumeAttempt(root, stored.plan, values.attempt)
        : null;
    const results = await Promise.all(
      (await readdir(join(root, 'results')))
        .filter((f) => f.endsWith('.json'))
        .map((f) => json(join(root, 'results', f))),
    );
    const claims = await readClaims(join(root, 'claims'));
    const report = {
      schemaVersion: 2,
      planHash: stored.plan.planHash,
      bindingState:
        stored.plan.planHash === plan.planHash
          ? 'current'
          : 'drifted_no_dispatch',
      mode,
      results,
      claims,
      reconciliation,
      executionLock: await readFile(join(root, 'execution.lock'), 'utf8').then(
        () => 'present_preserve_until_operator_reconciliation',
        (error: NodeJS.ErrnoException) => {
          if (error.code !== 'ENOENT') throw error;
          return 'absent';
        },
      ),
      liveAnswerOutcome: results.some(
        (r) => (r as { mode: string }).mode === 'live',
      )
        ? 'pending_human_review'
        : 'not_run',
      finalSelection: 'pending_owner_H2',
      referenceAcceptance: 'blocked_E11',
      pending: stored.plan.attempts
        .map((a) => a.attemptId)
        .filter(
          (id) =>
            !results.some((r) => {
              const row = r as { attemptId: string; mode: string };
              return row.mode === 'live' && row.attemptId === id;
            }),
        ),
      unknownChargePolicy: 'preserve_hold_no_retry',
    };
    if (mode === 'assemble') {
      await replaceOrCreate(join(root, 'comparison.json'), report);
      const temporary = join(root, 'comparison.md.next');
      await durableText(
        temporary,
        readableComparison(stored.plan, results, report.bindingState),
      );
      await rename(temporary, join(root, 'comparison.md'));
    }
    return report;
  }
  const attempt = [...plan.attempts, ...plan.controls].find(
    (a) => a.attemptId === values.attempt,
  );
  if (!attempt || attempt.status !== 'not_run')
    throw new Error('unknown_or_blocked_attempt');
  const binding = bindings[slotCandidates[attempt.slotId]];
  let manifest: V020BatchManifest | undefined;
  if (mode === 'live-approved-batch') {
    try {
      await readFile(join(root, 'blocked.json'));
      throw new Error('batch_blocked_after_failure');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    manifest = createV020BatchManifest(
      plan,
      EvaluationApprovalSchema.parse(await json(values.approval!)),
    );
    if (
      manifest.approval.verificationAllocationId !==
      stableAttempt(plan.batchId, 'allocation-envelope')
    )
      throw new Error('allocation_envelope_mismatch');
    if (!manifest.approval.authorizedAttemptIds.includes(attempt.attemptId))
      throw new Error('attempt_not_authorized');
    const ready = assessEvaluationBinding(
      binding,
      process.env.VULPES_LIVE_AI_ENABLED === 'true',
      manifest.approval.maximumSpendUSD,
    );
    if (ready.state !== 'ready') throw new Error(ready.reason);
    const now = Date.now();
    if (
      now < Date.parse(manifest.approval.approvedAt) ||
      now >= Date.parse(manifest.approval.expiresAt)
    )
      throw new Error('approval_not_current');
    try {
      await durableCreate(join(root, 'manifest.json'), manifest);
    } catch (error) {
      if (
        (error as NodeJS.ErrnoException).code !== 'EEXIST' ||
        evaluationCanonicalHash(await json(join(root, 'manifest.json'))) !==
          evaluationCanonicalHash(manifest)
      )
        throw error;
    }
  }
  const lock = join(root, 'execution.lock');
  await durableCreate(lock, {
    planHash: plan.planHash,
    attemptId: attempt.attemptId,
  });
  try {
    return await evaluateAttempt({
      root,
      plan,
      binding,
      attempt,
      offline: mode === 'control',
      ...(manifest ? { manifest } : {}),
    });
  } catch (error) {
    if (mode === 'live-approved-batch')
      await replaceOrCreate(join(root, 'blocked.json'), {
        attemptId: attempt.attemptId,
        reason: error instanceof Error ? error.message : 'evaluation_failed',
      });
    throw error;
  } finally {
    await unlink(lock);
  }
}
async function replaceOrCreate(file: string, value: unknown) {
  try {
    await durableCreate(file, value);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    await replace(file, value);
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.log(
      JSON.stringify(await evaluateV020(process.argv.slice(2)), null, 2),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'evaluation_failed');
    process.exitCode = 1;
  }
}

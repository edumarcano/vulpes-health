import { PreviewCsvWireSchema as PreviewCsvSchema } from '../shared/import-v2.js';
import { previewCsv, commitImport } from '../server/services/imports.js';
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { randomUUID, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Decimal } from 'decimal.js';
import { lunaCases, lunaPlan, stableAttempt } from './luna-evaluation.js';
import { LocalSupabase } from '../tests/helpers/local-supabase.js';
import { localStatus, projectRoot } from './local-database.js';
import { prepareSyntheticBatch } from './live-verification-batch.js';
import { issueVerificationTransport } from '../server/ai/providers/openrouter-verification.js';
import { administrativeClient } from '../server/db/administrative.js';
import { readEncryptionKeys } from '../server/security/encryption.js';
import { models } from '../server/config/models.js';
import { everydayCapabilityEvidence } from '../server/config/everyday-verification.js';
import { assessEverydayPreflight } from '../server/ai/live-preflight.js';
import { ConversationService } from '../server/services/conversations.js';
import { InspectionService } from '../server/services/inspection.js';
import { GoalService } from '../server/services/goals.js';
import { VulpesAgent } from '../server/ai/VulpesAgent.js';
import { OpenRouterResponsesAdapter } from '../server/ai/providers/openrouter.js';
import { ChatSendRequestSchema } from '../shared/api.js';
import { ConversationQuerySchema } from '../shared/chat.js';
import { UUIDSchema, DecimalUSDSchema } from '../shared/primitives.js';
import { runLiveEveryday } from './live-everyday.js';
import { claimLunaRequest } from './luna-request-budget.js';
import { toolErrorProbeAdapter } from './luna-tool-error-probe.js';

export async function verifyLuna(
  args: string[],
  network: typeof fetch = fetch,
) {
  const v = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      plan: { type: 'boolean' },
      'technical-only': { type: 'boolean' },
      initialize: { type: 'boolean' },
      case: { type: 'string' },
      'batch-id': { type: 'string' },
      'attempt-id': { type: 'string' },
      'allow-spend': { type: 'boolean' },
      'max-cost-usd': { type: 'string' },
    },
  }).values;
  const plan = lunaPlan(
    v['technical-only'] ? 'technical_only' : 'model_quality',
  );
  if (
    v.plan &&
    Object.keys(v).every((k) => ['plan', 'technical-only'].includes(k))
  )
    return plan;
  if (!v['allow-spend']) throw new Error('live_opt_in_required');
  const batch = UUIDSchema.parse(v['batch-id']);
  const ceiling = DecimalUSDSchema.parse(v['max-cost-usd']);
  if (new Decimal(ceiling).lt(plan.maximumUSD))
    throw new Error('insufficient_suite_ceiling');
  const ready = assessEverydayPreflight({
    enabled: process.env.VULPES_LIVE_AI_ENABLED === 'true',
    mode: 'verification',
    model: plan.model,
    effort: models.everyday.reasoning.effort,
    adapterVersion: plan.adapterVersion,
    templateVersion: plan.templateVersion,
    maxInputTokens: models.everyday.maxInputTokens,
    maxOutputTokens: models.everyday.maxOutputTokens,
    price: models.everyday.price,
    capabilities: everydayCapabilityEvidence,
    smoke: null,
    maxCostUSD: ceiling,
  });
  if (ready.state !== 'ready') throw new Error(ready.reason);
  const local = localStatus();
  process.env.VITE_SUPABASE_URL = local.apiUrl;
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = local.anonKey;
  process.env.SUPABASE_SERVICE_ROLE_KEY = local.adminKey;
  readEncryptionKeys();
  const db = administrativeClient();
  const verificationEnv = new Proxy(process.env, {
    get(target, name) {
      if (name !== 'OPENROUTER_API_KEY') return Reflect.get(target, name);
      const path = join(projectRoot, '.env.luna-verification.local');
      if (!existsSync(path)) return target.OPENROUTER_API_KEY;
      const lines = readFileSync(path, 'utf8')
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith('#'));
      if (
        lines.length !== 1 ||
        !/^OPENROUTER_API_KEY=[A-Za-z0-9_-]+$/.test(lines[0]!)
      )
        throw new Error('private_key_file_invalid');
      return lines[0]!.slice('OPENROUTER_API_KEY='.length);
    },
  });
  const period = new Date().toISOString().slice(0, 7) + '-01';
  const root = join(projectRoot, '.scratch/luna-batches');
  const path = join(root, batch + '.json');
  const planHash = createHash('sha256')
    .update(JSON.stringify(plan))
    .digest('hex');
  if (v.initialize) {
    if (v.case || v['attempt-id']) throw new Error('invalid_initialization');
    const users = await db.auth.admin.listUsers({ page: 1, perPage: 1 });
    const buckets = await db
      .from('usage_buckets')
      .select('id', { count: 'exact', head: true });
    if (
      users.error ||
      users.data.users.length ||
      buckets.error ||
      buckets.count
    )
      throw new Error('initialization_requires_empty_disposable_stack');
    await mkdir(root, { recursive: true });
    await mkdir(join(root, batch + '-requests'));
    const manifest = {
      batch,
      ceiling,
      period,
      planHash,
      attempts: Object.fromEntries(
        [
          ...lunaCases.map((c) => c.id),
          'tool_loop',
          'cancel',
          'disconnect',
        ].map((id) => [id, stableAttempt(batch, id)]),
      ),
    };
    await writeFile(path, JSON.stringify(manifest, null, 2), { flag: 'wx' });
    await new LocalSupabase().admin('/rest/v1/usage_buckets', 'POST', {
      scope: 'app',
      period_start: period,
      allocated_ceiling_usd: ceiling,
    });
    return manifest;
  }
  const manifest = JSON.parse(await readFile(path, 'utf8')) as {
    batch: string;
    ceiling: string;
    period: string;
    planHash: string;
    attempts: Record<string, string>;
  };
  if (existsSync(join(root, batch + '.blocked')))
    throw new Error('suite_blocked_after_failure');
  const id = v.case ?? '';
  const attempt = UUIDSchema.parse(v['attempt-id']);
  if (
    manifest.batch !== batch ||
    manifest.ceiling !== ceiling ||
    manifest.period !== period ||
    manifest.planHash !== planHash ||
    manifest.attempts[id] !== attempt ||
    attempt !== stableAttempt(batch, id)
  )
    throw new Error('immutable_suite_mismatch');
  const app = await db
    .from('usage_buckets')
    .select('allocated_ceiling_usd')
    .eq('scope', 'app')
    .eq('period_start', period)
    .single();
  if (app.error || !new Decimal(app.data.allocated_ceiling_usd).eq(ceiling))
    throw new Error('suite_budget_mismatch');
  const allocation = stableAttempt(batch, id + ':allocation');
  const boundedNetwork: typeof fetch = async (input, init) => {
    await claimLunaRequest(join(root, batch + '-requests'), id, plan.requests);
    return network(input, init);
  };
  process.env.VULPES_SMOKE_BATCH_ID = allocation;
  let report: unknown;
  if (['tool_loop', 'cancel', 'disconnect'].includes(id))
    report = await runLiveEveryday(
      ceiling,
      true,
      verificationEnv,
      boundedNetwork,
      id as 'tool_loop' | 'cancel' | 'disconnect',
      attempt,
      undefined,
      plan.assessment,
    );
  else {
    const scenario = plan.cases.find((c) => c.id === id);
    if (!scenario) throw new Error('unknown_case');
    const { context, fixtureHash } = await prepareSyntheticBatch(
      allocation,
      ceiling,
      scenario.fixture,
    );
    if (scenario.timezone) {
      await new LocalSupabase().admin(
        `/rest/v1/profiles?user_id=eq.${context.userId}`,
        'PATCH',
        { timezone: scenario.timezone },
      );
    }
    if (id === 'E10') {
      await new LocalSupabase().admin(
        `/rest/v1/profiles?user_id=eq.${context.userId}`,
        'PATCH',
        { monthly_preference_usd: '0' },
      );
    }
    const sent: Buffer[] = [];
    const transport = await issueVerificationTransport(
      context,
      allocation,
      ceiling,
      fixtureHash,
      true,
      verificationEnv,
      async (input, init) => {
        if (sent.length >= scenario.requests)
          throw new Error('scenario_request_limit');
        await claimLunaRequest(
          join(root, batch + '-requests'),
          id,
          plan.requests,
        );
        sent.push(Buffer.from(init?.body as Uint8Array));
        return network(input, init);
      },
    );
    const conversations = new ConversationService(context);
    await conversations.mutate({
      action: 'create',
      id: attempt,
      client_request_id: attempt,
    });
    const agent = new VulpesAgent(context, {
      adapter:
        id === 'V03'
          ? await toolErrorProbeAdapter(context)
          : new OpenRouterResponsesAdapter(),
      transport,
      price: models.everyday.price,
      maxRunCostUSD: new Decimal(plan.requestMaximumUSD).mul(4).toFixed(),
    });
    const runs: string[] = [];
    const answers: string[] = [];
    async function run(text: string, requestId: string) {
      const input = ChatSendRequestSchema.parse({
        action: 'send',
        client_request_id: requestId,
        conversation_id: attempt,
        message: { id: requestId, text },
        depth: 'auto',
      });
      const admission = await agent.admit(input);
      if (!admission.lease)
        throw new Error('attempt_already_exists_no_dispatch');
      runs.push(admission.result.run.id);
      let terminal = '',
        failureCode = '';
      for await (const event of agent.run(
        input,
        admission.lease,
        admission.result.run,
        admission.baseline,
        new AbortController().signal,
      )) {
        terminal = event.type;
        if (event.type === 'run.failed') failureCode = event.payload.code;
      }
      if (id === 'E10') {
        if (
          sent.length ||
          terminal !== 'run.failed' ||
          failureCode !== 'budget_exhausted'
        )
          throw new Error('budget_control_failed');
        return;
      }
      if (terminal !== 'run.completed')
        throw new Error('evaluation_run_incomplete');
      const saved = await conversations.read(
        ConversationQuerySchema.parse({ view: 'messages', id: attempt }),
      );
      if (!('run' in saved) || saved.run?.id !== admission.result.run.id)
        throw new Error('reload_mismatch');
      answers.push(
        ...saved.items
          .filter(
            (m) =>
              m.role === 'assistant' && m.runId === admission.result.run.id,
          )
          .map((m) =>
            m.parts
              .filter((p) => p.type === 'text')
              .map((p) => p.text)
              .join(' '),
          ),
      );
    }
    let structural: 'passed' | 'failed' = 'failed';
    let failure: string | null = null;
    try {
      await run(scenario.prompt, attempt);
      if (id === 'E05') {
        const goals = new GoalService(context);
        const proposals = await context.db
          .from('action_proposals')
          .select('id,payload_hash,target_version,state')
          .eq('user_id', context.userId)
          .eq('state', 'pending');
        const active = await context.db
          .from('goals')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', context.userId)
          .eq('state', 'active');
        if (
          proposals.error ||
          proposals.data.length !== 1 ||
          active.error ||
          active.count
        )
          throw new Error('pending_proposal_required');
        const p = proposals.data[0]!;
        await goals.decide({
          action: 'approve',
          proposal_id: p.id,
          payload_hash: p.payload_hash,
          expected_version: p.target_version,
          client_request_id: stableAttempt(attempt, 'approval'),
        });
        const owned = await context.db
          .from('goals')
          .select('id')
          .eq('user_id', context.userId)
          .single();
        if (
          owned.error ||
          (await goals.progress(owned.data.id)).kind !== 'progress'
        )
          throw new Error('goal_progress_unavailable');
        await run(
          'What about progress toward the goal I just approved? Use my approved goal and its deterministic progress.',
          stableAttempt(attempt, 'followup'),
        );
        const source = await context.db
          .from('data_sources')
          .select('id')
          .eq('user_id', context.userId)
          .single();
        if (source.error) throw new Error('source_unavailable');
        const preview = await previewCsv(
          context,
          PreviewCsvSchema.parse({
            action: 'preview_csv',
            schema_version: 2,
            client_request_id: stableAttempt(attempt, 'preview'),
            csv_base64: Buffer.from(
              'observed_at,metric,value,unit,source,granularity,external_record_id,local_date,timezone,method\n2026-09-16T08:00:00Z,weight,68.0,kg,Synthetic Scale A,instant,synthetic-followup-weight,,UTC,device_reported\n',
            ).toString('base64'),
            source: { kind: 'existing', id: source.data.id },
            mapping: {
              schema_version: 1,
              format: 'canonical',
              timezone: 'UTC',
              profile: null,
              single_profile: true,
              review_requested: false,
              source_label: 'Synthetic Scale A',
            },
          }),
        );
        await commitImport(context, {
          action: 'commit_import',
          schema_version: 2,
          client_request_id: stableAttempt(attempt, 'commit'),
          batch_id: preview.batch_id,
          payload_hash: preview.payload_hash,
        });
        const progress = await goals.progress(owned.data.id);
        if (progress.kind !== 'progress' || progress.current !== '68')
          throw new Error('reimport_progress_mismatch');
      }
      const inspector = new InspectionService(context);
      let index = 0;
      const privateTools: Array<{ input: string; output: string }> = [];
      for (const runId of runs) {
        for (const step of (await inspector.overview(runId)).steps.filter(
          (s) => s.type === 'tool',
        )) {
          const input = await inspector.evidence({
            view: 'payload',
            run: runId,
            step: step.id,
            part: 'input',
          });
          const output = await inspector.evidence({
            view: 'payload',
            run: runId,
            step: step.id,
            part: 'output',
          });
          if (input.state !== 'available' || output.state !== 'available')
            throw new Error('tool_evidence_unavailable');
          privateTools.push({
            input: input.bytes.toString('utf8'),
            output: output.bytes.toString('utf8'),
          });
        }
      }
      await writeFile(
        join(root, `${batch}-${id}.review.private.json`),
        JSON.stringify({ answers, tools: privateTools }, null, 2),
        { flag: 'wx', mode: 0o600 },
      );
      if (
        id === 'V03' &&
        !sent.some((body) =>
          JSON.parse(body.toString()).input.some(
            (turn: { type?: string; output?: string }) =>
              turn.type === 'function_call_output' &&
              turn.output &&
              JSON.parse(turn.output).result?.kind === 'tool_error',
          ),
        )
      )
        throw new Error('typed_error_not_exercised');
      for (const runId of runs)
        for (const step of (await inspector.overview(runId)).steps.filter(
          (s) => s.type === 'generation',
        )) {
          const input = await inspector.evidence({
            view: 'payload',
            run: runId,
            step: step.id,
            part: 'input',
          });
          if (
            input.state !== 'available' ||
            !input.bytes.equals(sent[index++]!)
          )
            throw new Error('exact_capture_mismatch');
        }
      if (index !== sent.length || sent.length > scenario.requests)
        throw new Error('request_count_mismatch');
      structural = 'passed';
    } catch (error) {
      const safe = [
        'evaluation_run_incomplete',
        'reload_mismatch',
        'pending_proposal_required',
        'exact_capture_mismatch',
        'request_count_mismatch',
        'budget_control_failed',
        'attempt_already_exists_no_dispatch',
        'typed_error_not_exercised',
        'tool_evidence_unavailable',
      ];
      failure =
        error instanceof Error && safe.includes(error.message)
          ? error.message
          : 'evaluation_failed';
    }
    const summaries = await Promise.all(
      runs.map((runId) => agent.ledger.summary(runId)),
    );
    report = {
      case: id,
      serverDate: new Date().toISOString(),
      timezone: scenario.timezone ?? 'UTC',
      structural,
      failure,
      runIds: runs,
      actualProviderRequests: sent.length,
      answersSHA256: answers.map((a) =>
        createHash('sha256').update(a).digest('hex'),
      ),
      modelAssessment:
        id === 'E10'
          ? 'not_applicable'
          : plan.assessment === 'technical_only'
            ? 'deferred_by_owner'
            : 'pending_review',
      review: scenario.review,
      accounting: summaries.map((r) => ({
        costUSD: r.costUSD,
        costStatus: r.costStatus,
        reservationUSD: r.reservationUSD,
      })),
      planHash,
      fixtureHash,
    };
  }
  const balance = await db
    .from('usage_buckets')
    .select('spent:spent_usd::text,reserved:reserved_usd::text')
    .eq('scope', 'app')
    .eq('period_start', period)
    .single();
  if (
    balance.error ||
    new Decimal(balance.data.spent).plus(balance.data.reserved).gt(ceiling)
  )
    throw new Error('suite_accounting_unavailable_or_exceeded');
  report = {
    ...(report as object),
    suite: {
      batch,
      ceiling,
      period,
      planHash,
      spentUSD: balance.data.spent,
      reservedUSD: balance.data.reserved,
    },
  };
  if (
    report &&
    typeof report === 'object' &&
    (('structural' in report && report.structural === 'failed') ||
      ('result' in report && report.result === 'failed'))
  )
    await writeFile(
      join(root, batch + '.blocked'),
      'Failed case; explicit review and fresh authorization required.\n',
      { flag: 'wx' },
    );
  const output = join(root, `${batch}-${id}-${randomUUID()}.json`);
  await writeFile(output, JSON.stringify(report, null, 2), { flag: 'wx' });
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  verifyLuna(process.argv.slice(2))
    .then((report) => {
      console.info(JSON.stringify(report, null, 2));
      if (
        report &&
        typeof report === 'object' &&
        (('structural' in report && report.structural === 'failed') ||
          ('result' in report && report.result === 'failed'))
      )
        process.exitCode = 1;
    })
    .catch(() => {
      console.error(
        'Luna verification refused or failed. No automatic retry; inspect private records and held accounting before continuing.',
      );
      process.exitCode = 1;
    });

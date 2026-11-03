import {
  VertexGenerationAdapter,
  vertexEndpoint,
  vertexAdapterVersion,
} from '../server/ai/providers/vertex.js';
import { issueVertexVerificationTransport } from '../server/ai/providers/vertex-verification.js';
import { vertexEvidence } from '../server/ai/vertex-readiness.js';
import { randomUUID } from 'node:crypto';
import { Decimal } from 'decimal.js';
import { UUIDSchema } from '../shared/primitives.js';
import { ChatSendRequestSchema } from '../shared/api.js';
import { ConversationQuerySchema } from '../shared/chat.js';
import { DataSummarySchema } from '../shared/data.js';
import { models } from '../server/config/models.js';
import { VerifiedPriceSchema } from '../server/ai/ledger/pricing.js';
import { VulpesAgent } from '../server/ai/VulpesAgent.js';
import { OpenRouterResponsesAdapter } from '../server/ai/providers/openrouter.js';
import { issueVerificationTransport } from '../server/ai/providers/openrouter-verification.js';
import { InspectionService } from '../server/services/inspection.js';
import { ConversationService } from '../server/services/conversations.js';
import { prepareSyntheticBatch } from './live-verification-batch.js';
import {
  everydayAdapterVersion,
  everydayTemplateVersion,
} from '../server/config/everyday-versions.js';
import { priceFingerprint } from '../server/ai/live-preflight.js';
import { administrativeClient } from '../server/db/administrative.js';
import { setTimeout as delay } from 'node:timers/promises';
const Money = Decimal.clone({ precision: 128, rounding: Decimal.ROUND_UP });

export function matchesSyntheticAnswer(text: string): boolean {
  const answer = text.replaceAll('\u2212', '-');
  return (
    /\b69(?:\.0+)?(?![\d.])/.test(answer) &&
    /(?:-0\.7(?:0+)?\b|(?:decreas|declin|down|drop|lost|lower)[\s\S]{0,40}0\.7(?:0+)?\b|0\.7(?:0+)?\b[\s\S]{0,40}(?:decreas|declin|down|drop|lower))/i.test(
      answer,
    )
  );
}

export interface LiveSmokeReport {
  mode: 'live';
  scenario: 'tool_loop' | 'cancel' | 'disconnect';
  result: 'passed' | 'failed';
  batchId: string;
  attemptId: string;
  runId: string | null;
  actualProviderRequests: number;
  interruption: {
    state: 'not_requested' | 'unavailable' | 'observed';
    capturedBeforeTerminal: boolean;
  };
  failureCode: string | null;
  costUSD: string | null;
  costStatus: string;
  reservationUSD: string | null;
  traceState: string;
  exactRequestsVerified: boolean;
  ownedToolEvidenceVerified: boolean;
  reloadVerified: boolean;
  maxCostUSD: string;
  fixtureHash: string;
  batchSpentUSD: string | null;
  batchReservedUSD: string | null;
  checkedAt: string;
  requested: {
    provider: 'openrouter' | 'vertex_ai';
    model: string;
    effort: string;
    adapterVersion: string;
    templateVersion: string;
    priceId: string;
    priceHash: string;
  };
  effective: { model: string | null; effort: string | null };
  limitations: string;
}
// This function is reachable from the CLI only after opt-in and static
// capability/price/privacy preflight. It runs one attempt, never a retry.
export async function runLiveEveryday(
  ceiling: string,
  allowSpend: boolean,
  env: NodeJS.ProcessEnv = process.env,
  network: typeof fetch = fetch,
  scenario: 'tool_loop' | 'cancel' | 'disconnect' = 'tool_loop',
  attemptId: string = randomUUID(),
  vertexRole?: 'intermediate' | 'advanced',
): Promise<LiveSmokeReport> {
  if (!allowSpend) throw new Error('live_opt_in_required');
  const parsedBatch = UUIDSchema.safeParse(env.VULPES_SMOKE_BATCH_ID);
  if (!parsedBatch.success) throw new Error('invalid_verification_batch');
  const batchId = parsedBatch.data;
  UUIDSchema.parse(attemptId);
  const config = models[vertexRole ?? 'everyday'];
  const price = VerifiedPriceSchema.parse(config.price);
  const requested = {
    provider: config.provider,
    model: config.modelId,
    effort: vertexRole
      ? models[vertexRole].thinking.level
      : models.everyday.reasoning.effort,
    adapterVersion: vertexRole ? vertexAdapterVersion : everydayAdapterVersion,
    templateVersion: everydayTemplateVersion,
    priceId: price.id,
    priceHash: priceFingerprint(price),
  };
  const { context, fixtureHash } = await prepareSyntheticBatch(
    batchId,
    ceiling,
  );
  const controller = new AbortController();
  let runId: string | null = null;
  const interruption: LiveSmokeReport['interruption'] = {
    state: scenario === 'tool_loop' ? 'not_requested' : 'unavailable',
    capturedBeforeTerminal: false,
  };
  const sent: Buffer[] = [];
  const tracked: typeof fetch = async (input, init) => {
    sent.push(Buffer.from(init?.body as Uint8Array));
    const upstream = new AbortController();
    const response = await network(input, {
      ...init,
      signal: AbortSignal.any([
        upstream.signal,
        ...(init?.signal ? [init.signal] : []),
      ]),
    });
    if (scenario === 'tool_loop' || !response.ok || !response.body)
      return response;
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    let nonterminal = false;
    let terminal = false;
    return new Response(
      new ReadableStream<Uint8Array>(
        {
          async pull(stream) {
            if (nonterminal && !terminal) {
              // Wait for the dispatcher's durable checkpoint, never a timing guess
              // based on the first high-level agent event (which can be terminal).
              const inspector = new InspectionService(context);
              let captured = false;
              for (let tries = 0; tries < 200 && !captured; tries++) {
                if (!runId)
                  throw new Error('verification_interruption_unavailable');
                const step = (await inspector.steps(runId)).find(
                  (s) =>
                    s.step_type === 'generation' &&
                    s.status === 'started' &&
                    s.output_payload_id,
                );
                if (step) {
                  const prefix = await inspector.evidence({
                    view: 'payload',
                    run: runId,
                    step: step.id,
                    part: 'output',
                  });
                  captured =
                    prefix.state === 'available' && prefix.bytes.length > 0;
                }
                if (!captured) await delay(10);
              }
              if (!captured || !runId)
                throw new Error('verification_interruption_unavailable');
              interruption.state = 'observed';
              interruption.capturedBeforeTerminal = true;
              if (scenario === 'cancel') {
                await agent.ledger.cancelWithReceipt(runId, randomUUID());
                controller.abort();
              }
              upstream.abort();
              await reader.cancel().catch(() => undefined);
              stream.error(new Error('verification_controlled_interruption'));
              return;
            }
            const next = await reader.read();
            if (next.done) {
              if (interruption.state !== 'observed')
                throw new Error('verification_interruption_unavailable');
              stream.close();
              return;
            }
            buffered += decoder.decode(next.value, { stream: true });
            if (buffered.length > 4 * 1024 * 1024)
              throw new Error('verification_stream_limit');
            const frames = buffered.replaceAll('\r\n', '\n').split('\n\n');
            buffered = frames.pop()!;
            for (const frame of frames)
              for (const line of frame
                .split('\n')
                .filter((line) => line.startsWith('data:'))) {
                try {
                  const event = JSON.parse(line.slice(5)) as { type?: string };
                  if (vertexRole) {
                    const raw = JSON.parse(line.slice(5));
                    if (
                      raw.candidates?.some(
                        (c: { finishReason?: string }) => c.finishReason,
                      )
                    )
                      terminal = true;
                    else if (
                      raw.candidates?.some(
                        (c: { content?: { parts?: unknown[] } }) =>
                          c.content?.parts?.length,
                      )
                    )
                      nonterminal = true;
                  }
                  if (
                    [
                      'response.completed',
                      'response.incomplete',
                      'response.failed',
                      'error',
                    ].includes(event.type ?? '')
                  )
                    terminal = true;
                  else if (event.type?.startsWith('response.'))
                    nonterminal = true;
                } catch {
                  /* Malformed events remain the adapter's responsibility. */
                }
              }
            stream.enqueue(next.value);
          },
          async cancel() {
            upstream.abort();
            await reader.cancel().catch(() => undefined);
          },
        },
        { highWaterMark: 0 },
      ),
      { status: response.status, headers: response.headers },
    );
  };
  if (vertexRole) {
    const evidence = vertexEvidence[vertexRole];
    if (!evidence) throw new Error('capability_privacy_unverified');
    const profile = await administrativeClient()
      .from('profiles')
      .select('consent_versions')
      .eq('user_id', context.userId)
      .single();
    if (profile.error) throw new Error('verification_account_unavailable');
    const consent = profile.data.consent_versions;
    await administrativeClient()
      .from('profiles')
      .update({
        consent_versions: {
          ...(consent && typeof consent === 'object' && !Array.isArray(consent)
            ? consent
            : {}),
          vertex_ai: {
            accepted_version: evidence.policyVersion,
            accepted_at: new Date().toISOString(),
          },
        },
      })
      .eq('user_id', context.userId);
  }
  const transport = vertexRole
    ? await issueVertexVerificationTransport(
        vertexRole,
        context,
        batchId,
        ceiling,
        fixtureHash,
        allowSpend,
        env,
        tracked,
      )
    : await issueVerificationTransport(
        context,
        batchId,
        ceiling,
        fixtureHash,
        allowSpend,
        env,
        tracked,
      );
  const conversations = new ConversationService(context);
  const conversation = attemptId;
  await conversations.mutate({
    action: 'create',
    id: conversation,
    client_request_id: attemptId,
  });
  const input = ChatSendRequestSchema.parse({
    action: 'send',
    client_request_id: attemptId,
    conversation_id: conversation,
    message: {
      id: attemptId,
      text: 'Using the imported synthetic scale records, calculate the seven-day weight mean and change for 2026-09-01 through 2026-09-14 UTC. Use the available read tool and explain its coverage.',
    },
    depth: vertexRole ? 'auto' : 'everyday',
  });
  const agent = new VulpesAgent(context, {
    adapter: vertexRole
      ? new VertexGenerationAdapter(
          vertexRole,
          vertexEndpoint(
            env.GOOGLE_CLOUD_PROJECT!,
            env.GOOGLE_CLOUD_LOCATION!,
            vertexRole,
          ),
        )
      : new OpenRouterResponsesAdapter(),
    transport,
    price,
    maxRunCostUSD: ceiling,
    ...(vertexRole ? { verificationRole: vertexRole } : {}),
  });
  let outcome: 'passed' | 'failed' = 'failed';
  let exact = false;
  let tools = false;
  let reload = false;
  let failureCode: string | null = null;
  let costUSD: string | null = null;
  let costStatus = 'unavailable';
  let reservationUSD: string | null = null;
  let traceState = 'unavailable';
  let effective: LiveSmokeReport['effective'] = { model: null, effort: null };
  async function report(limitations: string): Promise<LiveSmokeReport> {
    let batchSpentUSD: string | null = null;
    let batchReservedUSD: string | null = null;
    try {
      const db = administrativeClient();
      const allocation = await db
        .from('live_verification_allocations')
        .select('account_bucket_id')
        .eq('id', batchId)
        .eq('user_id', context.userId)
        .single();
      if (!allocation.error) {
        const bucket = await db
          .from('usage_buckets')
          .select('spent_text:spent_usd::text,reserved_text:reserved_usd::text')
          .eq('id', allocation.data.account_bucket_id)
          .single();
        if (!bucket.error) {
          batchSpentUSD = bucket.data.spent_text;
          batchReservedUSD = bucket.data.reserved_text;
        }
      }
    } catch {
      /* Unreadable accounting stays unknown. */
    }
    try {
      if (batchSpentUSD === null || batchReservedUSD === null) {
        outcome = 'failed';
        failureCode = 'verification_accounting_unavailable';
      } else if (
        new Money(batchSpentUSD).plus(batchReservedUSD).greaterThan(ceiling)
      ) {
        outcome = 'failed';
        failureCode = 'verification_allocation_exceeded';
      }
    } catch {
      batchSpentUSD = null;
      batchReservedUSD = null;
      outcome = 'failed';
      failureCode = 'verification_accounting_unavailable';
    }
    return {
      mode: 'live',
      scenario,
      result: outcome,
      failureCode,
      batchId,
      attemptId,
      interruption,
      runId,
      actualProviderRequests: sent.length,
      costUSD,
      costStatus,
      reservationUSD,
      traceState,
      checkedAt: new Date().toISOString(),
      requested,
      effective,
      exactRequestsVerified: exact,
      ownedToolEvidenceVerified: tools,
      reloadVerified: reload,
      maxCostUSD: ceiling,
      fixtureHash,
      batchSpentUSD,
      batchReservedUSD,
      limitations,
    };
  }
  try {
    const admission = await agent.admit(input);
    if (!admission.lease) throw new Error('verification_not_admitted');
    runId = admission.result.run.id;
    let terminal = '';
    for await (const event of agent.run(
      input,
      admission.lease,
      admission.result.run,
      admission.baseline,
      controller.signal,
    )) {
      terminal = event.type;
      if (event.type === 'run.failed')
        failureCode = [
          'budget_exhausted',
          'budget_unconfigured',
          'cost_bound_exceeded',
          'run_call_limit',
          'execution_interrupted',
          'trace_incomplete',
          'context_too_large',
        ].includes(event.payload.code)
          ? event.payload.code
          : 'execution_interrupted';
    }
    const inspector = new InspectionService(context);
    const overview = await inspector.overview(runId);
    costUSD = overview.run.costUSD;
    costStatus = overview.run.costStatus;
    reservationUSD = overview.run.reservationUSD;
    traceState = overview.run.traceState;
    const generation = overview.steps.filter(
      (step) => step.type === 'generation',
    );
    const toolSteps = overview.steps.filter((step) => step.type === 'tool');
    const lastGeneration = generation.at(-1);
    effective = {
      model: lastGeneration?.effectiveModel ?? null,
      effort: lastGeneration?.effectiveEffort ?? null,
    };
    if (generation.length !== sent.length || !generation.length)
      throw new Error('verification_request_count_mismatch');
    for (let index = 0; index < generation.length; index++) {
      const evidence = await inspector.evidence({
        view: 'payload',
        run: runId,
        step: generation[index]!.id,
        part: 'input',
      });
      if (
        evidence.state !== 'available' ||
        !evidence.bytes.equals(sent[index]!)
      )
        throw new Error('verification_request_mismatch');
    }
    exact = true;
    if (scenario !== 'tool_loop') {
      if (interruption.state !== 'observed') {
        failureCode = 'verification_interruption_unavailable';
        throw new Error(failureCode);
      }
      const expected = scenario === 'cancel' ? 'cancelled' : 'failed';
      if (
        terminal !== `run.${expected}` ||
        overview.run.state !== expected ||
        sent.length !== 1 ||
        costStatus !== 'pending' ||
        !new Money(reservationUSD!).greaterThan(0)
      )
        throw new Error('verification_cancel_failed');
      outcome = 'passed';
      failureCode = null;
      return report(
        'The controlled stream interruption passed; provider-side termination and final charges remain unknown. This scenario does not establish a completed tool loop.',
      );
    }
    if (
      terminal !== 'run.completed' ||
      overview.run.state !== 'completed' ||
      overview.run.traceState !== 'available' ||
      generation.length < 2 ||
      !toolSteps.some((step) => step.toolName === 'summarize_metric')
    )
      throw new Error('verification_tool_loop_incomplete');
    for (const step of toolSteps) {
      const evidence = await inspector.evidence({
        view: 'payload',
        run: runId,
        step: step.id,
        part: 'output',
      });
      if (evidence.state !== 'available')
        throw new Error('verification_tool_evidence_unavailable');
      if (step.toolName === 'summarize_metric') {
        const payload = JSON.parse(evidence.bytes.toString('utf8')) as {
          result?: { data?: unknown };
        };
        const summary = DataSummarySchema.parse(payload.result?.data);
        if (
          summary.analysis.coverageStatus !== 'sufficient' ||
          summary.analysis.value !== 69 ||
          summary.analysis.absoluteChange !== -0.7
        )
          throw new Error('verification_calculation_mismatch');
      }
    }
    tools = true;
    const saved = await conversations.read(
      ConversationQuerySchema.parse({ view: 'messages', id: conversation }),
    );
    if (
      !('items' in saved) ||
      saved.items.length < 2 ||
      !('run' in saved) ||
      saved.run?.id !== runId ||
      saved.run.state !== 'completed'
    )
      throw new Error('verification_reload_failed');
    reload = true;
    const answer = saved.items
      .filter((item) => 'role' in item && item.role === 'assistant')
      .flatMap((item) => ('parts' in item ? item.parts : []))
      .filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join(' ');
    if (!matchesSyntheticAnswer(answer))
      throw new Error('verification_answer_inconsistent');
    if (costUSD === null || costStatus === 'pending' || reservationUSD !== '0')
      throw new Error('verification_usage_pending');
    outcome = 'passed';
  } catch (error) {
    const safe = [
      'verification_not_admitted',
      'verification_request_count_mismatch',
      'verification_cancel_failed',
      'verification_interruption_unavailable',
      'verification_tool_loop_incomplete',
      'verification_request_mismatch',
      'verification_tool_evidence_unavailable',
      'verification_calculation_mismatch',
      'verification_reload_failed',
      'verification_answer_inconsistent',
      'verification_usage_pending',
    ];
    if (!failureCode)
      failureCode =
        error instanceof Error && safe.includes(error.message)
          ? error.message
          : 'verification_failed';
    if (runId)
      try {
        const current = await agent.ledger.summary(runId);
        costUSD = current.costUSD;
        costStatus = current.costStatus;
        reservationUSD = current.reservationUSD;
        traceState = current.traceState;
      } catch {
        /* Accounting remains unknown; never report a zero cost. */
      }
  }
  return report(
    'Value-presence checks do not establish semantic correctness or safety. A single synthetic attempt does not establish M3 acceptance or live cancellation and failure behavior.',
  );
}

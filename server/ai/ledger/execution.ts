import { createHash, randomUUID } from 'node:crypto';
import { Decimal } from 'decimal.js';
import { z } from 'zod';
import {
  AdmissionResultSchema,
  RunSummarySchema,
  type AdmissionResult,
  type TerminalRunState,
} from '../../../shared/executions.js';
import {
  AnalysisDepthSchema,
  HashSchema,
  UUIDSchema,
} from '../../../shared/primitives.js';
import type { AuthContext } from '../../auth/session.js';
import { administrativeClient } from '../../db/administrative.js';
import type { Database, Json } from '../../db/database.types.js';
import { HttpFailure } from '../../http/failure.js';
import { readPayload, payloadExpiry } from '../../security/private-payloads.js';
import {
  encryptBytes,
  MAX_PAYLOAD_BYTES,
  readEncryptionKeys,
  type PayloadPurpose,
} from '../../security/encryption.js';
import {
  normalizeUsage,
  GenerationCompletionSchema,
  type GenerationCompletion,
  type NormalizedUsage,
} from '../contracts.js';
import { executionPolicy } from './policy.js';
import {
  GoalProposalToolResultSchema,
  GoalProposalReferenceSchema,
} from '../../../shared/goals.js';
import { ChatPartSchema } from '../../../shared/chat.js';
import {
  priceUsage,
  reserveMaximum,
  VerifiedPriceSchema,
  type VerifiedPrice,
} from './pricing.js';
import { isVertexEndpoint } from '../../config/vertex-endpoint.js';

export interface RunLease {
  readonly runId: string;
  readonly executor: string;
  readonly fence: number;
  readonly deadlineAt: string;
}
type Admission =
  | { result: Extract<AdmissionResult, { kind: 'admitted' }>; lease: RunLease }
  | { result: Exclude<AdmissionResult, { kind: 'admitted' }>; lease: null };
export const AdmissionInputSchema = z
  .strictObject({
    conversationId: UUIDSchema,
    clientRequestId: UUIDSchema,
    requestHash: HashSchema,
    depth: AnalysisDepthSchema,
    route: z.strictObject({
      role: z.enum(['everyday', 'intermediate', 'advanced']),
      provider: z.enum(['openrouter', 'vertex_ai']),
      model: z.string().min(1).max(200),
      effort: z.string().max(100).nullable(),
    }),
    consentVersion: z.string().min(1).max(100),
    baseline: z.literal('safety-v1').optional(),
  })
  .refine(
    (value) =>
      value.baseline === 'safety-v1' ||
      value.depth === 'auto' ||
      value.depth === value.route.role,
    'The requested depth must match the selected role.',
  );
export interface StepInput {
  type: 'generation' | 'decision' | 'tool';
  body: Uint8Array;
  context?: unknown;
  provider?: 'openrouter' | 'vertex_ai';
  model?: string;
  toolName?: string;
  price?: VerifiedPrice;
  adapterVersion: string;
  requestedEffort?: string;
  effectiveEffort?: string;
  metadata: {
    endpoint: string;
    headers: Record<string, string>;
    redactedHeaders: string[];
  };
}
export interface PreparedStep {
  readonly id: string;
  readonly lease: RunLease;
  readonly body: Buffer;
  readonly bodyHash: string;
  readonly price: VerifiedPrice | null;
  readonly type: StepInput['type'];
  readonly payloadExpiresAt: string;
}
type Functions = Database['public']['Functions'];

export function requestHash(value: unknown): string {
  function canonical(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === 'object')
      return Object.fromEntries(
        Object.entries(input)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([key, item]) => [key, canonical(item)]),
      );
    return input;
  }
  return createHash('sha256')
    .update(JSON.stringify(canonical(value)))
    .digest('hex');
}

export class ExecutionService {
  private readonly db = administrativeClient();
  constructor(
    private readonly context: AuthContext,
    private readonly policy: { maxRunCostUSD: string } = executionPolicy,
    private readonly signal?: AbortSignal,
  ) {}
  async vertexConsentVersion(runId?: string): Promise<string> {
    if (runId) {
      const result = await this.db
        .from('ai_runs')
        .select('consent_versions')
        .eq('user_id', this.context.userId)
        .eq('id', runId)
        .single();
      const consent = z
        .object({
          vertex_ai: z.object({ accepted_version: z.string().min(1) }),
        })
        .safeParse(result.data?.consent_versions);
      if (result.error || !consent.success)
        throw new HttpFailure(
          403,
          'run_policy_denied',
          'The approved Google policy could not be verified.',
        );
      return consent.data.vertex_ai.accepted_version;
    }
    const result = await this.db
      .from('vertex_policy_approval')
      .select('policy_version')
      .eq('id', true)
      .single();
    if (result.error || !result.data)
      throw new HttpFailure(
        503,
        'inference_unavailable',
        'The approved Google policy is unavailable.',
      );
    return result.data.policy_version;
  }
  private async rpc<K extends keyof Functions>(
    name: K,
    args: Functions[K]['Args'],
  ) {
    this.signal?.throwIfAborted();
    const query = this.db.rpc(name, args);
    const { data, error } = await (this.signal
      ? query.abortSignal(this.signal)
      : query);
    this.signal?.throwIfAborted();
    if (error) {
      const codes: Record<string, number> = {
        run_not_found: 404,
        account_unavailable: 403,
        run_policy_denied: 403,
        executor_denied: 403,
        idempotency_conflict: 409,
        run_not_writable: 409,
        step_in_progress: 409,
        settlement_conflict: 409,
        budget_exhausted: 429,
        run_rate_limited: 429,
        run_call_limit: 429,
        budget_unconfigured: 503,
        cost_bound_exceeded: 503,
        goal_conflict: 409,
        goal_not_found: 404,
        invalid_goal: 400,
      };
      throw new HttpFailure(
        codes[error.message] ?? 503,
        Object.hasOwn(codes, error.message)
          ? error.message
          : 'execution_unavailable',
        'The execution could not proceed. Refresh its status before trying again.',
      );
    }
    return data;
  }
  async reconcile() {
    return this.rpc('reconcile_runs_v1', {
      p_owner: this.context.userId,
      p_batch_size: 100,
    });
  }
  async replayChat(
    input: {
      conversationId: string;
      clientRequestId: string;
      requestHash: string;
    },
    message: { id: string; text: string },
  ) {
    const result = await this.rpc('replay_chat_v1', {
      p_owner: this.context.userId,
      p_request: input,
      p_message: message,
    });
    if (result === null) return null;
    const replay = AdmissionResultSchema.parse(result);
    if (replay.kind !== 'existing' && replay.kind !== 'retained')
      throw new HttpFailure(
        503,
        'execution_unavailable',
        'The saved request could not be read.',
      );
    return replay;
  }
  async admit(
    input: z.infer<typeof AdmissionInputSchema>,
    message?: { id: string; text: string },
  ): Promise<Admission> {
    const request = AdmissionInputSchema.parse(input);
    await this.reconcile();
    const executor = randomUUID();
    const args = {
      p_owner: this.context.userId,
      p_request: { ...request, maxCostUSD: this.policy.maxRunCostUSD },
      p_executor: executor,
    };
    const result = AdmissionResultSchema.parse(
      message
        ? await this.rpc('admit_chat_v1', { ...args, p_message: message })
        : await this.rpc('admit_run_v1', args),
    );
    if (result.kind === 'admitted')
      return {
        result,
        lease: {
          runId: result.run.id,
          executor,
          fence: 1,
          deadlineAt: result.run.deadlineAt,
        },
      };
    return { result, lease: null };
  }
  async summary(runId: string) {
    UUIDSchema.parse(runId);
    await this.reconcile();
    const value = await this.rpc('run_summary_v1', {
      p_owner: this.context.userId,
      p_run: runId,
    });
    if (value === null)
      throw new HttpFailure(
        404,
        'run_not_found',
        'The execution was not found.',
      );
    return RunSummarySchema.parse(value);
  }
  private envelope(
    purpose: PayloadPurpose,
    bytes: Uint8Array,
    expiresAt: string,
  ) {
    return encryptBytes(
      {
        id: randomUUID(),
        user_id: this.context.userId,
        purpose,
        expires_at: expiresAt,
      },
      bytes,
      readEncryptionKeys(),
    );
  }
  async prepare(lease: RunLease, input: StepInput): Promise<PreparedStep> {
    if (input.body.byteLength > 2 * 1024 * 1024)
      throw new HttpFailure(
        413,
        'request_too_large',
        'The provider request is too large.',
      );
    const metadata = z
      .strictObject({
        endpoint: z.string().max(512),
        headers: z.record(z.string(), z.string().max(200)),
        redactedHeaders: z.array(z.string().max(100)).max(20),
      })
      .parse(input.metadata);
    if (
      Object.keys(metadata.headers).some(
        (key) => !['accept', 'content-type'].includes(key.toLowerCase()),
      )
    )
      throw new Error('unsafe_request_header');
    if (
      ![
        'https://openrouter.ai/api/v1/responses',
        'tool:read',
        'tool:proposal',
      ].includes(metadata.endpoint) &&
      !isVertexEndpoint(metadata.endpoint)
    )
      throw new Error('unapproved_endpoint');
    const body = Buffer.from(input.body);
    const id = randomUUID();
    const price =
      input.type === 'tool' ? null : VerifiedPriceSchema.parse(input.price);
    if (price && body.byteLength > price.inputBoundTokens)
      throw new HttpFailure(
        413,
        'input_bound_exceeded',
        'The request exceeds its verified input bound.',
      );
    const step = {
      id,
      type: input.type,
      provider: input.provider ?? null,
      model: input.model ?? null,
      toolName: input.toolName ?? null,
      adapterVersion: input.adapterVersion,
      requestedEffort: input.requestedEffort ?? null,
      effectiveEffort: input.effectiveEffort ?? null,
      price,
      reservationUSD: price ? reserveMaximum(price) : '0',
      metadata,
    };
    const purpose = input.type === 'tool' ? 'tool_input' : 'ai_request';
    // All run purposes share the database's seven-day limit. Fix it at prepare
    // time so later checkpoints cannot extend this step's retention window.
    const payloadExpiresAt = await payloadExpiry(purpose);
    const envelope = this.envelope(purpose, body, payloadExpiresAt);
    const context =
      input.context === undefined
        ? undefined
        : this.envelope(
            'provider_state',
            Buffer.from(JSON.stringify(input.context)),
            payloadExpiresAt,
          );
    await this.rpc('prepare_step_v1', {
      p_owner: this.context.userId,
      p_run: lease.runId,
      p_executor: lease.executor,
      p_fence: lease.fence,
      p_step: step,
      p_input: envelope,
      ...(context ? { p_context: context } : {}),
    });
    return Object.freeze({
      id,
      lease,
      body,
      bodyHash: envelope.content_hash,
      price,
      type: input.type,
      payloadExpiresAt,
    });
  }
  async authorize(step: PreparedStep): Promise<void> {
    if (createHash('sha256').update(step.body).digest('hex') !== step.bodyHash)
      throw new HttpFailure(
        409,
        'trace_mismatch',
        'The request no longer matches its captured evidence.',
      );
    const stored = await this.db
      .from('ai_steps')
      .select('input_payload_id,request_body_hash')
      .eq('user_id', this.context.userId)
      .eq('run_id', step.lease.runId)
      .eq('id', step.id)
      .maybeSingle();
    if (
      stored.error ||
      !stored.data?.input_payload_id ||
      stored.data.request_body_hash !== step.bodyHash
    )
      throw new HttpFailure(
        503,
        'trace_unavailable',
        'The captured request is unavailable.',
      );
    const payload = await readPayload(
      this.context,
      stored.data.input_payload_id,
      'ai_request',
    );
    if (payload.state !== 'available' || !payload.bytes.equals(step.body))
      throw new HttpFailure(
        503,
        'trace_unavailable',
        'The captured request cannot be verified.',
      );
    const fresh = await this.rpc('authorize_send_v1', {
      p_owner: this.context.userId,
      p_run: step.lease.runId,
      p_executor: step.lease.executor,
      p_fence: step.lease.fence,
      p_step: step.id,
      p_body_hash: step.bodyHash,
    });
    if (fresh !== true)
      throw new HttpFailure(
        409,
        'dispatch_already_authorized',
        'This request cannot be sent again. Read the execution status.',
      );
  }
  async heartbeat(lease: RunLease) {
    return RunSummarySchema.parse(
      await this.rpc('heartbeat_run_v1', {
        p_owner: this.context.userId,
        p_run: lease.runId,
        p_executor: lease.executor,
        p_fence: lease.fence,
      }),
    );
  }
  async handoff(lease: RunLease, stepId: string, reason: string) {
    return RunSummarySchema.parse(
      await this.rpc('handoff_flash_v1', {
        p_owner: this.context.userId,
        p_run: lease.runId,
        p_executor: lease.executor,
        p_fence: lease.fence,
        p_step: stepId,
        p_reason: reason,
      }),
    );
  }
  async canHandoffToFlash(
    lease: RunLease,
    price: VerifiedPrice,
    consentVersion: string,
  ): Promise<boolean> {
    const Money = Decimal.clone({ precision: 128 });
    const amount = new Money(reserveMaximum(price));
    const run = await this.summary(lease.runId);
    const [buckets, profile, stored, approval] = await Promise.all([
      this.db
        .from('usage_buckets')
        .select(
          'scope,ceiling:allocated_ceiling_usd::text,reserved:reserved_usd::text,spent:spent_usd::text,lower:lower_preference_usd::text',
        )
        .eq('period_start', run.accountingPeriod)
        .or(`scope.eq.app,user_id.eq.${this.context.userId}`),
      this.context.db
        .from('profiles')
        .select('preference:monthly_preference_usd::text,consent_versions')
        .eq('user_id', this.context.userId)
        .single(),
      this.db
        .from('ai_runs')
        .select('consent_versions')
        .eq('user_id', this.context.userId)
        .eq('id', lease.runId)
        .single(),
      this.db
        .from('vertex_policy_approval')
        .select('policy_version')
        .eq('id', true)
        .maybeSingle(),
    ]);
    if (
      buckets.error ||
      profile.error ||
      stored.error ||
      approval.error ||
      approval.data?.policy_version !== consentVersion ||
      buckets.data.length !== 2 ||
      Date.now() >= Date.parse(run.deadlineAt)
    )
      return false;
    const consent = z
      .object({
        vertex_ai: z.object({
          accepted_version: z.literal(consentVersion),
          accepted_at: z.string(),
        }),
      })
      .safeParse(profile.data.consent_versions);
    const frozen = z
      .object({ vertex_ai: z.json() })
      .safeParse(stored.data.consent_versions);
    if (
      !consent.success ||
      !frozen.success ||
      requestHash(consent.data.vertex_ai) !== requestHash(frozen.data.vertex_ai)
    )
      return false;
    if (
      new Money(run.knownCostUSD)
        .plus(run.reservationUSD)
        .plus(amount)
        .gt(this.policy.maxRunCostUSD)
    )
      return false;
    return buckets.data.every((bucket) => {
      const ceiling =
        bucket.scope === 'account'
          ? Money.min(
              bucket.ceiling,
              bucket.lower ?? bucket.ceiling,
              profile.data.preference ?? bucket.ceiling,
            )
          : new Money(bucket.ceiling);
      return new Money(bucket.spent)
        .plus(bucket.reserved)
        .plus(amount)
        .lte(ceiling);
    });
  }
  async checkpoint(
    step: PreparedStep,
    bytes: Uint8Array,
    message?: { id: string; parts: Json[] },
  ) {
    if (bytes.byteLength > MAX_PAYLOAD_BYTES)
      throw new HttpFailure(
        413,
        'response_too_large',
        'The provider response exceeded its trace limit.',
      );
    const output = this.envelope(
      step.type === 'tool' ? 'tool_output' : 'ai_response',
      bytes,
      step.payloadExpiresAt,
    );
    return this.rpc('checkpoint_step_v1', {
      p_owner: this.context.userId,
      p_run: step.lease.runId,
      p_executor: step.lease.executor,
      p_fence: step.lease.fence,
      p_step: step.id,
      p_output: output,
      ...(message ? { p_message: message } : {}),
    });
  }
  async checkpointGoal(step: PreparedStep, output: unknown, trace: unknown) {
    const result = GoalProposalToolResultSchema.parse(output);
    const bytes = Buffer.from(JSON.stringify(trace));
    if (bytes.length > MAX_PAYLOAD_BYTES)
      throw new HttpFailure(
        413,
        'response_too_large',
        'The tool evidence exceeded its trace limit.',
      );
    return z
      .strictObject({
        reference: GoalProposalReferenceSchema,
        parts: z.array(ChatPartSchema),
      })
      .parse(
        await this.rpc('checkpoint_goal_proposal_v1', {
          p_owner: this.context.userId,
          p_run: step.lease.runId,
          p_executor: step.lease.executor,
          p_fence: step.lease.fence,
          p_step: step.id,
          p_request: result.request,
          p_payload: result.payload,
          p_output: this.envelope('tool_output', bytes, step.payloadExpiresAt),
        }),
      );
  }
  async settle(
    step: PreparedStep,
    usage: NormalizedUsage | null,
    status: 'completed' | 'failed' | 'cancelled' | 'interrupted',
    expectedVersion = 0,
    notSent = false,
    completion?: GenerationCompletion,
  ) {
    const checked = usage ? normalizeUsage(usage) : null;
    let traceIncomplete = false;
    let usageEvidence: Record<string, Json> = {};
    if (checked && !notSent && step.type !== 'tool') {
      const { rawUsage: _raw, reportedCostUSD: _cost, ...safeUsage } = checked;
      void _raw;
      void _cost;
      try {
        const payload = this.envelope(
          'provider_state',
          Buffer.from(JSON.stringify(checked)),
          step.payloadExpiresAt,
        );
        usageEvidence = {
          usagePayload: payload,
          usageHash: payload.content_hash,
          usage: safeUsage,
          executor: step.lease.executor,
          fence: step.lease.fence,
        };
      } catch {
        traceIncomplete = true;
      }
    }
    const charge =
      notSent || step.type === 'tool'
        ? { source: 'not_sent', costUSD: '0' }
        : checked && step.price
          ? priceUsage(step.price, checked)
          : { source: 'pending', costUSD: null };
    const result = RunSummarySchema.parse(
      await this.rpc('settle_step_v1', {
        p_owner: this.context.userId,
        p_run: step.lease.runId,
        p_step: step.id,
        p_evidence: {
          expectedVersion,
          ...charge,
          ...usageEvidence,
          ...(completion
            ? {
                completion: GenerationCompletionSchema.parse(completion),
                executor: step.lease.executor,
                fence: step.lease.fence,
              }
            : {}),
          ...(traceIncomplete ? { traceIncomplete: true } : {}),
        },
        p_status: status,
      }),
    );
    if (
      result.traceState === 'incomplete' &&
      ['admitted', 'running'].includes(result.state)
    ) {
      await this.finish(step.lease, 'failed');
      throw new HttpFailure(
        503,
        'trace_incomplete',
        'Usage was accounted for, but execution evidence could not be saved.',
      );
    }
    return result;
  }
  async cancel(runId: string) {
    return RunSummarySchema.parse(
      await this.rpc('cancel_run_v1', {
        p_owner: this.context.userId,
        p_run: UUIDSchema.parse(runId),
      }),
    );
  }
  async cancelWithReceipt(runId: string, requestId: string) {
    return RunSummarySchema.parse(
      await this.rpc('cancel_chat_v1', {
        p_owner: this.context.userId,
        p_run: UUIDSchema.parse(runId),
        p_request: UUIDSchema.parse(requestId),
      }),
    );
  }
  async saveState(step: PreparedStep, state: unknown) {
    return this.rpc('save_chat_state_v1', {
      p_owner: this.context.userId,
      p_run: step.lease.runId,
      p_executor: step.lease.executor,
      p_fence: step.lease.fence,
      p_step: step.id,
      p_state: this.envelope(
        'provider_state',
        Buffer.from(JSON.stringify(state)),
        step.payloadExpiresAt,
      ),
    });
  }
  async checkpointMessage(lease: RunLease, parts: Json[]) {
    return this.rpc('checkpoint_message_v1', {
      p_owner: this.context.userId,
      p_run: lease.runId,
      p_executor: lease.executor,
      p_fence: lease.fence,
      p_parts: parts,
    });
  }
  async usageTotals(runId: string) {
    const { data, error } = await this.context.db
      .from('ai_steps')
      .select(
        'step_type,input_tokens,output_tokens,reasoning_tokens,cache_read_tokens,cache_write_tokens',
      )
      .eq('user_id', this.context.userId)
      .eq('run_id', UUIDSchema.parse(runId))
      .neq('step_type', 'tool');
    const sum = (
      column:
        | 'input_tokens'
        | 'output_tokens'
        | 'reasoning_tokens'
        | 'cache_read_tokens'
        | 'cache_write_tokens',
    ) => {
      if (error || !data?.length || data.some((step) => step[column] === null))
        return null;
      const total = data.reduce((value, step) => value + step[column]!, 0);
      return Number.isSafeInteger(total) ? total : null;
    };
    return {
      inputTokens: sum('input_tokens'),
      outputTokens: sum('output_tokens'),
      reasoningTokens: sum('reasoning_tokens'),
      cacheReadTokens: sum('cache_read_tokens'),
      cacheWriteTokens: sum('cache_write_tokens'),
    };
  }
  async baseline(lease: RunLease, text: string) {
    return RunSummarySchema.parse(
      await this.rpc('baseline_chat_v1', {
        p_owner: this.context.userId,
        p_run: lease.runId,
        p_executor: lease.executor,
        p_fence: lease.fence,
        p_text: text,
      }),
    );
  }
  async finish(lease: RunLease, status: TerminalRunState) {
    return RunSummarySchema.parse(
      await this.rpc('finish_run_v1', {
        p_owner: this.context.userId,
        p_run: lease.runId,
        p_executor: lease.executor,
        p_status: status,
      }),
    );
  }
}

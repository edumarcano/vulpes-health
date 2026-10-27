import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { AdmissionResultSchema, RunSummarySchema, type AdmissionResult, type TerminalRunState } from '../../../shared/executions.js';
import { AnalysisDepthSchema, HashSchema, UUIDSchema } from '../../../shared/primitives.js';
import type { AuthContext } from '../../auth/session.js';
import { administrativeClient } from '../../db/administrative.js';
import type { Database, Json } from '../../db/database.types.js';
import { HttpFailure } from '../../http/failure.js';
import { readPayload } from '../../security/private-payloads.js';
import { encryptBytes, MAX_PAYLOAD_BYTES, readEncryptionKeys, type PayloadPurpose } from '../../security/encryption.js';
import { normalizeUsage, GenerationCompletionSchema, type GenerationCompletion, type NormalizedUsage } from '../contracts.js';
import { executionPolicy } from './policy.js';
import { priceUsage, reserveMaximum, VerifiedPriceSchema, type VerifiedPrice } from './pricing.js';

export interface RunLease { readonly runId: string; readonly executor: string; readonly fence: number; readonly deadlineAt: string }
type Admission={result:Extract<AdmissionResult,{kind:'admitted'}>;lease:RunLease} | {result:Exclude<AdmissionResult,{kind:'admitted'}>;lease:null};
export const AdmissionInputSchema = z.strictObject({
  conversationId: UUIDSchema, clientRequestId: UUIDSchema, requestHash: HashSchema, depth: AnalysisDepthSchema,
  route: z.strictObject({ role: z.enum(['everyday','intermediate','advanced']), provider: z.enum(['openrouter','vertex_ai']), model: z.string().min(1).max(200), effort: z.string().max(100).nullable() }),
  consentVersion: z.string().min(1).max(100),
  baseline: z.literal('safety-v1').optional(),
}).refine(value=>value.baseline==='safety-v1' || value.depth==='auto' || value.depth===value.route.role,'The requested depth must match the selected role.');
export interface StepInput {
  type: 'generation' | 'decision' | 'tool'; body: Uint8Array; context?: unknown;
  provider?: 'openrouter' | 'vertex_ai'; model?: string; toolName?: string; price?: VerifiedPrice;
  adapterVersion: string; requestedEffort?: string; effectiveEffort?: string;
  metadata: { endpoint: string; headers: Record<string,string>; redactedHeaders: string[] };
}
export interface PreparedStep { readonly id: string; readonly lease: RunLease; readonly body: Buffer; readonly bodyHash:string; readonly price: VerifiedPrice | null; readonly type: StepInput['type'] }
type Functions = Database['public']['Functions'];

export function requestHash(value: unknown): string {
  function canonical(input: unknown): unknown {
    if (Array.isArray(input)) return input.map(canonical);
    if (input && typeof input === 'object') return Object.fromEntries(Object.entries(input).sort(([a],[b]) => a<b ? -1 : a>b ? 1 : 0).map(([key,item]) => [key,canonical(item)]));
    return input;
  }
  return createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
}

export class ExecutionService {
  private readonly db = administrativeClient();
  constructor(private readonly context: AuthContext, private readonly policy: { maxRunCostUSD: string } = executionPolicy) {}
  private async rpc<K extends keyof Functions>(name: K, args: Functions[K]['Args']) {
    const { data, error } = await this.db.rpc(name, args);
    if (error) {
      const codes: Record<string,number> = { run_not_found:404, account_unavailable:403, run_policy_denied:403, executor_denied:403,
        idempotency_conflict:409, run_not_writable:409, step_in_progress:409, settlement_conflict:409,
        budget_exhausted:429, run_rate_limited:429, run_call_limit:429, budget_unconfigured:503, cost_bound_exceeded:503 };
      throw new HttpFailure(codes[error.message] ?? 503, Object.hasOwn(codes,error.message) ? error.message : 'execution_unavailable', 'The execution could not proceed. Refresh its status before trying again.');
    }
    return data;
  }
  async reconcile() {
    return this.rpc('reconcile_runs_v1',{ p_owner:this.context.userId,p_batch_size:100 });
  }
  async replayChat(input:{conversationId:string;clientRequestId:string;requestHash:string},message:{id:string;text:string}) {
    const result=await this.rpc('replay_chat_v1',{p_owner:this.context.userId,p_request:input,p_message:message});
    if(result===null)return null;
    const replay=AdmissionResultSchema.parse(result);
    if(replay.kind!=='existing' && replay.kind!=='retained')throw new HttpFailure(503,'execution_unavailable','The saved request could not be read.');
    return replay;
  }
  async admit(input: z.infer<typeof AdmissionInputSchema>, message?: {id:string;text:string}):Promise<Admission> {
    const request = AdmissionInputSchema.parse(input);
    await this.reconcile();
    const executor = randomUUID();
    const args={ p_owner:this.context.userId,p_request:{ ...request,maxCostUSD:this.policy.maxRunCostUSD },p_executor:executor };
    const result = AdmissionResultSchema.parse(message ? await this.rpc('admit_chat_v1',{...args,p_message:message}) : await this.rpc('admit_run_v1',args));
    if(result.kind==='admitted')return {result,lease:{runId:result.run.id,executor,fence:1,deadlineAt:result.run.deadlineAt}};
    return {result,lease:null};
  }
  async summary(runId: string) {
    UUIDSchema.parse(runId);await this.reconcile();
    const value = await this.rpc('run_summary_v1',{ p_owner:this.context.userId,p_run:runId });
    if (value === null) throw new HttpFailure(404,'run_not_found','The execution was not found.');
    return RunSummarySchema.parse(value);
  }
  private envelope(purpose: PayloadPurpose, bytes: Uint8Array) {
    return encryptBytes({ id:randomUUID(),user_id:this.context.userId,purpose,expires_at:new Date(Date.now()+7*24*3600_000).toISOString() },bytes,readEncryptionKeys());
  }
  async prepare(lease: RunLease, input: StepInput): Promise<PreparedStep> {
    if (input.body.byteLength>2*1024*1024) throw new HttpFailure(413,'request_too_large','The provider request is too large.');
    const metadata = z.strictObject({ endpoint:z.string().max(200),headers:z.record(z.string(),z.string().max(200)),redactedHeaders:z.array(z.string().max(100)).max(20) }).parse(input.metadata);
    if (Object.keys(metadata.headers).some((key) => !['accept','content-type'].includes(key.toLowerCase()))) throw new Error('unsafe_request_header');
    if (!['https://openrouter.ai/api/v1/responses','https://aiplatform.googleapis.com','tool:read'].includes(metadata.endpoint)) throw new Error('unapproved_endpoint');
    const body = Buffer.from(input.body);const id = randomUUID();
    const price = input.type === 'tool' ? null : VerifiedPriceSchema.parse(input.price);
    if(price && body.byteLength>price.inputBoundTokens)throw new HttpFailure(413,'input_bound_exceeded','The request exceeds its verified input bound.');
    const step = { id,type:input.type,provider:input.provider ?? null,model:input.model ?? null,toolName:input.toolName ?? null,
      adapterVersion:input.adapterVersion,requestedEffort:input.requestedEffort ?? null,effectiveEffort:input.effectiveEffort ?? null,
      price,reservationUSD:price ? reserveMaximum(price) : '0',metadata };
    const envelope = this.envelope(input.type === 'tool' ? 'tool_input' : 'ai_request',body);
    const context = input.context === undefined ? undefined : this.envelope('provider_state',Buffer.from(JSON.stringify(input.context)));
    await this.rpc('prepare_step_v1',{ p_owner:this.context.userId,p_run:lease.runId,p_executor:lease.executor,p_fence:lease.fence,
      p_step:step,p_input:envelope,...(context ? {p_context:context} : {}) });
    return Object.freeze({ id,lease,body,bodyHash:envelope.content_hash,price,type:input.type });
  }
  async authorize(step: PreparedStep): Promise<void> {
    if(createHash('sha256').update(step.body).digest('hex')!==step.bodyHash)throw new HttpFailure(409,'trace_mismatch','The request no longer matches its captured evidence.');
    const stored=await this.db.from('ai_steps').select('input_payload_id,request_body_hash').eq('user_id',this.context.userId).eq('run_id',step.lease.runId).eq('id',step.id).maybeSingle();
    if(stored.error || !stored.data?.input_payload_id || stored.data.request_body_hash!==step.bodyHash)throw new HttpFailure(503,'trace_unavailable','The captured request is unavailable.');
    const payload=await readPayload(this.context,stored.data.input_payload_id,'ai_request');
    if(payload.state!=='available' || !payload.bytes.equals(step.body))throw new HttpFailure(503,'trace_unavailable','The captured request cannot be verified.');
    const fresh = await this.rpc('authorize_send_v1',{ p_owner:this.context.userId,p_run:step.lease.runId,p_executor:step.lease.executor,p_fence:step.lease.fence,p_step:step.id,p_body_hash:step.bodyHash });
    if (fresh !== true) throw new HttpFailure(409,'dispatch_already_authorized','This request cannot be sent again. Read the execution status.');
  }
  async heartbeat(lease: RunLease) {
    return RunSummarySchema.parse(await this.rpc('heartbeat_run_v1',{ p_owner:this.context.userId,p_run:lease.runId,p_executor:lease.executor,p_fence:lease.fence }));
  }
  async checkpoint(step: PreparedStep, bytes: Uint8Array, message?: {id:string;parts:Json[]}) {
    if (bytes.byteLength>MAX_PAYLOAD_BYTES) throw new HttpFailure(413,'response_too_large','The provider response exceeded its trace limit.');
    const output = this.envelope(step.type === 'tool' ? 'tool_output' : 'ai_response',bytes);
    return this.rpc('checkpoint_step_v1',{ p_owner:this.context.userId,p_run:step.lease.runId,p_executor:step.lease.executor,p_fence:step.lease.fence,
      p_step:step.id,p_output:output,...(message ? {p_message:message} : {}) });
  }
  async settle(step: PreparedStep, usage: NormalizedUsage | null, status: 'completed'|'failed'|'cancelled'|'interrupted', expectedVersion=0, notSent=false, completion?:GenerationCompletion) {
    const checked=usage ? normalizeUsage(usage) : null;
    let traceIncomplete=false;let usageEvidence:Record<string,Json>={};
    if(checked && !notSent && step.type!=='tool') {
      const {rawUsage:_raw,reportedCostUSD:_cost,...safeUsage}=checked;void _raw;void _cost;
      try {
        const payload=this.envelope('provider_state',Buffer.from(JSON.stringify(checked)));
        usageEvidence={usagePayload:payload,usageHash:payload.content_hash,usage:safeUsage,executor:step.lease.executor,fence:step.lease.fence};
      } catch {traceIncomplete=true;}
    }
    const charge = notSent || step.type === 'tool' ? {source:'not_sent',costUSD:'0'} : checked && step.price ? priceUsage(step.price,checked) : {source:'pending',costUSD:null};
    const result=RunSummarySchema.parse(await this.rpc('settle_step_v1',{ p_owner:this.context.userId,p_run:step.lease.runId,p_step:step.id,
      p_evidence:{ expectedVersion,...charge,...usageEvidence,...(completion ? {completion:GenerationCompletionSchema.parse(completion),executor:step.lease.executor,fence:step.lease.fence} : {}),...(traceIncomplete ? {traceIncomplete:true}: {}) },p_status:status }));
    if(result.traceState==='incomplete' && ['admitted','running'].includes(result.state)){await this.finish(step.lease,'failed');throw new HttpFailure(503,'trace_incomplete','Usage was accounted for, but execution evidence could not be saved.');}
    return result;
  }
  async cancel(runId: string) {
    return RunSummarySchema.parse(await this.rpc('cancel_run_v1',{ p_owner:this.context.userId,p_run:UUIDSchema.parse(runId) }));
  }
  async cancelWithReceipt(runId:string,requestId:string) {
    return RunSummarySchema.parse(await this.rpc('cancel_chat_v1',{p_owner:this.context.userId,p_run:UUIDSchema.parse(runId),p_request:UUIDSchema.parse(requestId)}));
  }
  async saveState(step:PreparedStep,state:unknown) {
    return this.rpc('save_chat_state_v1',{p_owner:this.context.userId,p_run:step.lease.runId,p_executor:step.lease.executor,p_fence:step.lease.fence,p_step:step.id,p_state:this.envelope('provider_state',Buffer.from(JSON.stringify(state)))});
  }
  async checkpointMessage(lease:RunLease,parts:Json[]) {
    return this.rpc('checkpoint_message_v1',{p_owner:this.context.userId,p_run:lease.runId,p_executor:lease.executor,p_fence:lease.fence,p_parts:parts});
  }
  async usageTotals(runId:string) {
    const {data,error}=await this.context.db.from('ai_steps').select('step_type,input_tokens,output_tokens,reasoning_tokens,cache_read_tokens,cache_write_tokens').eq('user_id',this.context.userId).eq('run_id',UUIDSchema.parse(runId)).neq('step_type','tool');
    const sum=(column:'input_tokens'|'output_tokens'|'reasoning_tokens'|'cache_read_tokens'|'cache_write_tokens')=>{
      if(error||!data?.length||data.some(step=>step[column]===null))return null;
      const total=data.reduce((value,step)=>value+step[column]!,0);return Number.isSafeInteger(total)?total:null;
    };
    return {inputTokens:sum('input_tokens'),outputTokens:sum('output_tokens'),reasoningTokens:sum('reasoning_tokens'),cacheReadTokens:sum('cache_read_tokens'),cacheWriteTokens:sum('cache_write_tokens')};
  }
  async baseline(lease:RunLease,text:string) {
    return RunSummarySchema.parse(await this.rpc('baseline_chat_v1',{p_owner:this.context.userId,p_run:lease.runId,p_executor:lease.executor,p_fence:lease.fence,p_text:text}));
  }
  async finish(lease: RunLease, status: TerminalRunState) {
    return RunSummarySchema.parse(await this.rpc('finish_run_v1',{ p_owner:this.context.userId,p_run:lease.runId,p_executor:lease.executor,p_status:status }));
  }
}

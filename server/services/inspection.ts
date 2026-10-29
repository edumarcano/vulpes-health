import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { AuthContext } from '../auth/session.js';
import { administrativeClient } from '../db/administrative.js';
import { HttpFailure } from '../http/failure.js';
import { ExecutionService, requestHash } from '../ai/ledger/execution.js';
import { decryptBytes, readEncryptionKeys, type PayloadPurpose } from '../security/encryption.js';
import type { InspectionQuery } from '../../shared/inspection.js';
import { EvidenceSchema } from '../../shared/chat.js';
import { ContextManifestSchema } from '../../shared/domain.js';
import { DataSummarySchema } from '../../shared/data.js';
import { ToolCallSchema } from '../ai/contracts.js';
import { providerToolResult, toolArguments } from '../ai/tools.js';
import { isVertexEndpoint } from '../config/vertex-endpoint.js';

type Step = Awaited<ReturnType<InspectionService['steps']>>[number];
type Part = 'input' | 'output' | 'context' | 'usage';
type Evidence = { state: 'available'; bytes: Buffer; expiresAt: string; completeness?:'complete'|'partial' } |
  { state: 'expired' | 'removed' | 'incomplete' | 'corrupt' | 'unavailable' };
const RequestMetadata = z.strictObject({
  endpoint:z.string().refine(value=>['https://openrouter.ai/api/v1/responses','https://aiplatform.googleapis.com','tool:read','tool:proposal'].includes(value)||isVertexEndpoint(value)),
  headers:z.record(z.string(),z.string().max(200)),redactedHeaders:z.array(z.string().max(100)).max(20),
}).refine(value=>Object.entries(value.headers).every(([key,header])=>key.toLowerCase()==='accept' ? header==='text/event-stream' : key.toLowerCase()==='content-type' && header==='application/json') && value.redactedHeaders.every(name=>['authorization','x-api-key'].includes(name.toLowerCase())));

export class InspectionService {
  constructor(private readonly context: AuthContext) {}

  async steps(run: string) {
    const { data, error } = await this.context.db.from('ai_steps').select('*,cost_text:cost_usd::text')
      .eq('user_id', this.context.userId).eq('run_id', run).order('sequence');
    if (error) throw new HttpFailure(503, 'execution_unavailable', 'Execution steps could not be loaded.');
    return data;
  }

  async overview(runId: string) {
    const run = await new ExecutionService(this.context).summary(runId);
    const steps = await this.steps(runId);
    const [profile,storedRun]=await Promise.all([
      this.context.db.from('profiles').select('data_revision').eq('user_id',this.context.userId).single(),
      this.context.db.from('ai_runs').select('data_revision,route_history').eq('user_id',this.context.userId).eq('id',runId).single(),
    ]);
    if (profile.error || storedRun.error) throw new HttpFailure(503,'execution_unavailable','Execution revision could not be checked.');
    const evidenceRevision=run.traceState==='removed' ? 'removed' : profile.data.data_revision===storedRun.data.data_revision ? 'current' : 'stale';
    return { run, evidenceRevision, routeHistory:storedRun.data.route_history, steps: steps.map(step => ({
      id: step.id, sequence: step.sequence, type: step.step_type, status: step.status,
      provider: step.provider, model: step.model_id, effectiveModel:step.effective_model_id, adapterVersion: step.adapter_version,
      requestedEffort: step.requested_effort, effectiveEffort: step.effective_effort,
      toolName: step.tool_name, startedAt: step.started_at, finishedAt: step.finished_at,
      dispatchState: step.dispatch_state, requestBodyHash: step.request_body_hash,
      requestMetadata: RequestMetadata.safeParse(step.request_metadata).success ? RequestMetadata.parse(step.request_metadata) : null, providerRequestId: step.provider_request_id,
      finishReason: step.finish_reason, priceSnapshot: step.price_snapshot,
      costUSD: step.cost_text, costStatus: step.cost_status,
      costBoundState: step.cost_bound_state, usage: { inputTokens: step.input_tokens,
        outputTokens: step.output_tokens, reasoningTokens: step.reasoning_tokens,
        cacheReadTokens: step.cache_read_tokens, cacheWriteTokens: step.cache_write_tokens },
    })) };
  }

  private binding(step: Step, part: Part): { id: string | null; purpose: PayloadPurpose } {
    if (part === 'input') return { id: step.input_payload_id, purpose: step.step_type === 'tool' ? 'tool_input' : 'ai_request' };
    if (part === 'output') return { id: step.output_payload_id, purpose: step.step_type === 'tool' ? 'tool_output' : 'ai_response' };
    return { id: part === 'context' ? step.context_payload_id : step.usage_payload_id, purpose: 'provider_state' };
  }

  async evidence(query: Extract<InspectionQuery, { view: 'payload' | 'export' }>): Promise<Evidence> {
    const summary = await new ExecutionService(this.context).summary(query.run);
    const step = (await this.steps(query.run)).find(item => item.id === query.step);
    if (!step) throw new HttpFailure(404, 'step_not_found', 'The execution step was not found.');
    if (summary.traceState === 'removed') return { state: 'removed' };
    const binding = this.binding(step, query.part);
    if (!binding.id) return { state: summary.traceState === 'incomplete' ? 'incomplete' : query.part === 'input' && summary.traceState === 'expired' ? 'expired' : 'unavailable' };
    const { data, error } = await administrativeClient().from('private_payloads').select('*')
      .eq('user_id', this.context.userId).eq('id', binding.id).eq('purpose', binding.purpose).maybeSingle();
    if (error) return { state: 'unavailable' };
    if (!data) return { state: summary.traceState === 'incomplete' ? 'incomplete' : 'unavailable' };
    if (Date.parse(data.expires_at) <= Date.now()) return { state: 'expired' };
    let keys;
    try { keys = readEncryptionKeys(); } catch { return { state: 'unavailable' }; }
    if (!keys.keys.has(data.key_id)) return { state: 'unavailable' };
    let bytes: Buffer;
    try { bytes = decryptBytes(data, keys); } catch { return { state: 'corrupt' }; }
    if (query.part === 'input' && step.request_body_hash !== createHash('sha256').update(bytes).digest('hex')) return { state: 'corrupt' };
    let completeness:'complete'|'partial'|undefined;
    if (query.part === 'context' || step.step_type === 'tool' && (query.part === 'input' || query.part === 'output')) {
      try {
        const parsed: unknown = JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));
        if (query.part === 'context') completeness=ContextManifestSchema.parse(parsed).captureVersion===2?'complete':'partial';
        else if (query.part === 'input') {
          const call=ToolCallSchema.parse(parsed);
          if (call.name!==step.tool_name || !Object.hasOwn(toolArguments,call.name)) throw new Error('invalid_tool');
          toolArguments[call.name as keyof typeof toolArguments].parse(call.arguments);
        } else {
          const result=z.strictObject({projectionVersion:z.union([z.literal(1),z.literal(2),z.literal(3)]).optional(),evidence:EvidenceSchema,result:z.json(),providerResult:z.json()}).parse(parsed);
          if (result.evidence.ownerId!==this.context.userId || result.evidence.runId!==query.run || result.evidence.stepId!==step.id) throw new Error('invalid_evidence');
          const output=z.object({kind:z.enum(['goal_proposal','metrics','goals','measurements','summary','no_data','clarification_required','unavailable','insufficient_data','progress','routing'])}).passthrough().parse(result.result);
          const kinds:Record<string,string[]>={request_escalation:['routing'],list_metrics:['metrics'],list_goals:['goals'],get_measurements:['measurements','no_data','clarification_required'],summarize_metric:['summary','no_data','clarification_required'],get_goal_progress:['unavailable','insufficient_data','progress'],propose_goal:['goal_proposal'],propose_goal_revision:['goal_proposal']};
          if (!step.tool_name || !kinds[step.tool_name]?.includes(output.kind)) throw new Error('invalid_tool_result');
          if (output.kind==='summary' && DataSummarySchema.parse(output.data).dataRevision!==result.evidence.dataRevision) throw new Error('invalid_revision');
          if (requestHash(providerToolResult(result.result,result.projectionVersion??1))!==requestHash(result.providerResult)) throw new Error('invalid_projection');
        }
      } catch { return { state:'corrupt' }; }
    }
    // Recheck the owned binding after decryption: deletion or checkpoint replacement must not expose stale content.
    const latest = (await this.steps(query.run)).find(item => item.id === query.step);
    const current = await new ExecutionService(this.context).summary(query.run);
    if (current.traceState === 'removed') return { state: 'removed' };
    if (!latest || this.binding(latest, query.part).id !== binding.id) return { state: 'unavailable' };
    if (Date.parse(data.expires_at) <= Date.now()) return { state: 'expired' };
    return { state: 'available', bytes, expiresAt: data.expires_at, ...(completeness ? {completeness} : {}) };
  }
}

import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { ChatSendRequest } from '../../shared/api.js';
import { ChatPartSchema,type ChatPart } from '../../shared/chat.js';
import type { StreamEvent } from '../../shared/stream.js';
import type { RunSummary } from '../../shared/executions.js';
import type { AuthContext } from '../auth/session.js';
import { models } from '../config/models.js';
import { ConversationService } from '../services/conversations.js';
import { HttpFailure } from '../http/failure.js';
import { ExecutionService,requestHash,type PreparedStep,type RunLease } from './ledger/execution.js';
import { createDispatcher,type RequestTransport } from './ledger/dispatcher.js';
import type { VerifiedPrice } from './ledger/pricing.js';
import { GenerationEventSchema,GenerationRequestSchema,type GenerationAdapter,type GenerationRequest,type NormalizedUsage,type GenerationEvent } from './contracts.js';
import { baselineSafety,rejectCredentials } from './prompts/everyday.js';
import { buildContext } from './context.js';
import { blocksOf,continuationFor } from './continuation.js';
import { executeReadTool,readToolDefinitions,providerToolResult } from './tools.js';
import { DataSummarySchema } from '../../shared/data.js';

export interface AgentDependencies {adapter:GenerationAdapter;transport:RequestTransport;price:VerifiedPrice;maxRunCostUSD:string}
type EventInput=StreamEvent extends infer E ? E extends StreamEvent ? Omit<E,'v'|'seq'|'run_id'> : never : never;
export class VulpesAgent {
  readonly ledger:ExecutionService;
  constructor(private readonly context:AuthContext,private readonly dependencies:AgentDependencies|null=null) {
    this.ledger=new ExecutionService(context,{maxRunCostUSD:dependencies?.maxRunCostUSD ?? '0'});
  }
  async admit(input:ChatSendRequest) {
    if(rejectCredentials(input.message.text))throw new HttpFailure(400,'sensitive_input','Remove credentials or secrets before sending this message.');
    await new ConversationService(this.context).owned(input.conversation_id);
    const selected=input.context_selection;
    for(const [table,id] of [['data_sources',selected?.source_id],['goals',selected?.goal_id]] as const) {
      if(!id)continue;
      const result=await this.context.db.from(table).select('id').eq('user_id',this.context.userId).eq('id',id).maybeSingle();
      if(result.error)throw new HttpFailure(503,'context_unavailable','The selection could not be checked.');
      if(!result.data)throw new HttpFailure(404,'not_found','The selected context was not found.');
    }
    const baseline=baselineSafety(input.message.text);const hash=requestHash(input);
    await this.ledger.reconcile();
    const prior=await this.ledger.replayChat({conversationId:input.conversation_id,clientRequestId:input.client_request_id,requestHash:hash},input.message);
    if(prior)return {result:prior,lease:null,baseline};
    if(!baseline && (input.depth==='intermediate'||input.depth==='advanced'))throw new HttpFailure(503,'depth_unavailable','This analysis depth is unavailable. Select Auto or Everyday explicitly to try another depth.');
    if(!baseline && !this.dependencies)throw new HttpFailure(503,'inference_unavailable','Ask Vulpes inference is unavailable until provider verification and activation gates pass.');
    const admission=await this.ledger.admit({conversationId:input.conversation_id,clientRequestId:input.client_request_id,requestHash:hash,depth:input.depth,
      route:{role:'everyday',provider:'openrouter',model:models.everyday.modelId,effort:models.everyday.reasoning.effort},consentVersion:'openrouter_zdr_v1',...(baseline ? {baseline:'safety-v1' as const} : {})},input.message);
    return {...admission,baseline};
  }
  async *run(input:ChatSendRequest,lease:RunLease,initial:RunSummary,baseline:string|null,signal:AbortSignal):AsyncIterable<StreamEvent> {
    let seq=0;const event=(value:EventInput)=>({...value,v:1 as const,seq:++seq,run_id:lease.runId}) as StreamEvent;
    let active:PreparedStep|null=null;let parts:ChatPart[]=[];let last:RunSummary=initial;
    const messageId=initial.assistantMessageId!;
    try {
      yield event({type:'run.started',payload:{assistant_message_id:messageId}});
      if(baseline) {
        last=await this.ledger.baseline(lease,baseline);
        yield event({type:'text.delta',payload:{message_id:messageId,text:baseline}});
      } else {
        const dependencies=this.dependencies;if(!dependencies)throw new Error('inference_unavailable');
        const context=await buildContext(this.context,input,lease.runId,readToolDefinitions,Math.min(models.everyday.maxInputTokens,dependencies.price.inputBoundTokens)-1000);
        let request=context.request;
        let groupStart=request.turns.length-1;
        let toolCount=0;const calls=new Set<string>();
        const dispatcher=createDispatcher(this.ledger,dependencies.transport,'failed');
        yield event({type:'route.selected',payload:{role:'everyday',provider:'openrouter',model:models.everyday.modelId,effort:models.everyday.reasoning.effort,reason:'Everyday selected for this bounded read-only conversation.'}});
        for(let modelCall=0;modelCall<4;modelCall++) {
          signal.throwIfAborted();await this.ledger.heartbeat(lease);
          while(Buffer.byteLength(JSON.stringify(request))>Math.min(models.everyday.maxInputTokens,dependencies.price.inputBoundTokens)-1000 && context.selected.length) {
            const excluded=context.selected.shift()!;const count=excluded.turns.length;
            request={...request,turns:[request.turns[0]!,...request.turns.slice(1+count)],continuation:continuationFor(blocksOf(request.continuation).filter(block=>block.at>=1+count).map(block=>({...block,at:block.at-count})))};
            groupStart-=count;context.manifest.included=context.manifest.included.filter(item=>item.reference.id!==excluded.id);context.manifest.excluded.push({referenceId:excluded.id,reason:'context_limit_after_tool'});
          }
          if(Buffer.byteLength(JSON.stringify(request))>Math.min(models.everyday.maxInputTokens,dependencies.price.inputBoundTokens)-1000)throw new HttpFailure(413,'context_too_large','The complete tool result cannot fit within this request. Ask for a narrower selection.');
          GenerationRequestSchema.parse(request);
          let text='';let usage:NormalizedUsage|null=null;let completion:Extract<GenerationEvent,{type:'completed'}>|null=null;const toolCalls:Extract<GenerationEvent,{type:'tool.call'}>['call'][]=[];
          let announced=false;
          const dispatch=dispatcher.bind(lease,{provider:'openrouter',model:models.everyday.modelId,price:dependencies.price,context:context.manifest},step=>{active=step;});
          for await(const raw of dependencies.adapter.generate(request,{signal,dispatch})) {
            const next=GenerationEventSchema.parse(raw);
            const prepared=active as PreparedStep|null;
            if(prepared&&!announced){announced=true;yield event({type:'step.started',payload:{step_id:prepared.id,step_type:'generation',label:'Generating a response'}});}
            if(completion)throw new Error('event_after_completion');
            if(next.type==='text.delta') {
              if(!active)throw new Error('adapter_bypassed_dispatcher');
              if(Buffer.byteLength(text+next.text)>65536)throw new Error('output_limit');
              text+=next.text;
              const prefix=parts.filter(p=>p.type!=='text');
              const oldText=parts.filter(p=>p.type==='text').map(p=>p.text).join('');
              if(Buffer.byteLength(oldText+next.text)>65536)throw new Error('output_limit');
              parts=[...prefix,{type:'text',text:oldText+next.text}];
              await this.ledger.checkpointMessage(lease,parts);
              yield event({type:'text.delta',payload:{message_id:messageId,text:next.text}});
            } else if(next.type==='tool.call') {
              if(calls.has(next.call.callId)||toolCalls.some(call=>call.callId===next.call.callId))throw new Error('repeated_tool_call');
              toolCalls.push(next.call);
            } else if(next.type==='usage') {if(usage)throw new Error('duplicate_usage');usage=next.usage;}
            else completion=next;
          }
          if(!active || !completion)throw new Error('provider_stream_truncated');
          // Settlement does not imply success or release unknown spend.
          await this.ledger.settle(active,usage,completion.finishReason==='length' ? 'failed' : 'completed',0,false,{finishReason:completion.finishReason,providerRequestId:null,effectiveModel:null,effectiveEffort:null,...completion.metadata});
          if(text)request.turns.push({type:'message',role:'assistant',text});
          for(const call of toolCalls)request.turns.push({type:'tool_call',...call});
          request={...request,continuation:completion.continuation};
          if(completion.finishReason==='length')throw new Error('output_truncated');
          if(completion.finishReason==='tool_calls' && !toolCalls.length || completion.finishReason!=='tool_calls' && toolCalls.length)throw new Error('invalid_finish_state');
          if(!toolCalls.length) {
            if(!text)throw new Error('empty_response');
            const history:GenerationRequest={turns:request.turns.slice(groupStart),tools:[],continuation:continuationFor(blocksOf(request.continuation).filter(b=>b.at>=groupStart).map(b=>({...b,at:b.at-groupStart})))};
            await this.ledger.saveState(active,history);active=null;
            last=await this.ledger.finish(lease,'completed');break;
          }
          const generationStep=active;active=null;
          if(modelCall===3 || toolCount+toolCalls.length>6)throw new HttpFailure(429,'run_call_limit','This conversation reached its bounded request or tool limit.');
          for(const call of toolCalls) {
            signal.throwIfAborted();calls.add(call.callId);toolCount++;
            const toolStep=await this.ledger.prepare(lease,{type:'tool',body:Buffer.from(JSON.stringify(call)),toolName:call.name,adapterVersion:'vulpes-read-tools-v1',metadata:{endpoint:'tool:read',headers:{},redactedHeaders:[]}});active=toolStep;
            yield event({type:'step.started',payload:{step_id:toolStep.id,step_type:'tool',label:'Reading your data'}});
            const output=await executeReadTool(this.context,call.name,call.arguments);
            const evidence={version:1 as const,ownerId:this.context.userId,runId:lease.runId,stepId:toolStep.id,resultId:randomUUID(),dataRevision:context.dataRevision};
            const result={evidence,result:JSON.parse(JSON.stringify(providerToolResult(output))) as z.infer<ReturnType<typeof z.json>>};
            await this.ledger.checkpoint(toolStep,Buffer.from(JSON.stringify({evidence,result:output,providerResult:result.result})));
            await this.ledger.settle(toolStep,null,'completed');
            const summary=z.object({kind:z.literal('summary'),data:DataSummarySchema}).safeParse(output);
            if(summary.success) {
              if(summary.data.data.dataRevision!==context.dataRevision)throw new Error('data_changed');
              parts.push(ChatPartSchema.parse({type:'metric_summary',evidence,result:summary.data.data}));
              await this.ledger.checkpointMessage(lease,parts);
              yield event({type:'card.ready',payload:{message_id:messageId,card:{type:'metric_trend',result:summary.data.data.analysis}}});
            }
            yield event({type:'tool.result',payload:{step_id:toolStep.id,tool_name:call.name,result_reference:`analysis:${toolStep.id}`,summary:summary.success ? 'Deterministic summary saved with source and coverage.' : 'Read-only result saved.'}});
            context.manifest.included.push({reference:{id:evidence.resultId,kind:'tool_result',label:`Result of ${call.name}`},contentHash:requestHash(result),tokenEstimate:Buffer.byteLength(JSON.stringify(result))});
            request.turns.push({type:'tool_result',callId:call.callId,name:call.name,result:JSON.parse(JSON.stringify(result)) as z.infer<ReturnType<typeof z.json>>});active=null;
          }
          // A complete group is persisted only at final completion; intermediate
          // provider state stays encrypted on the step for exact continuation.
          await this.ledger.saveState(generationStep,request);
        }
      }
      if(last.state==='completed') {
        yield event({type:'run.usage',payload:{...await this.ledger.usageTotals(lease.runId),costUSD:last.costUSD,costStatus:last.costStatus,reservationUSD:last.reservationUSD,priceSnapshotId:null,knownCostUSD:last.knownCostUSD}});
        yield event({type:'run.completed',payload:{message_id:messageId}});
      } else throw new Error('run_not_completed');
    } catch(error) {
      if(active)await this.ledger.settle(active,null,signal.aborted?'cancelled':'failed').catch(()=>undefined);
      last=await this.ledger.finish(lease,signal.aborted?'cancelled':'failed').catch(()=>last);
      if(last.state==='cancellation_requested')last=await this.ledger.summary(lease.runId).catch(()=>last);
      yield last.state==='cancelled' ? event({type:'run.cancelled',payload:{partial_output:last.partialOutput,cost_status:last.costStatus}})
        : event({type:'run.failed',payload:{code:error instanceof HttpFailure ? error.code : 'execution_interrupted',message:'The response stopped. The saved prefix may be incomplete. Read its status before explicitly sending another request.',partial_output:last.partialOutput,retryable:false}});
    }
  }
}

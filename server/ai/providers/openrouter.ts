import { z } from 'zod';
import { Decimal } from 'decimal.js';
import { models } from '../../config/models.js';
import { everydayAdapterVersion } from '../../config/everyday-versions.js';
import { normalizeUsage,requireGenerationCapabilities,GenerationCompletionSchema,type GenerationAdapter,type GenerationEvent,type GenerationRequest,ToolCallSchema } from '../contracts.js';
import { blocksOf,continuationFor } from '../continuation.js';
import type { PaidRequestDispatcher } from '../ledger/dispatcher.js';

const completedSchema=z.object({type:z.enum(['response.completed','response.incomplete']),response:z.object({id:GenerationCompletionSchema.shape.providerRequestId.optional(),model:GenerationCompletionSchema.shape.effectiveModel.optional(),reasoning:z.object({effort:GenerationCompletionSchema.shape.effectiveEffort.optional()}).nullish(),status:z.enum(['completed','incomplete']),output:z.array(z.json()),usage:z.record(z.string(),z.json()).nullish(),incomplete_details:z.object({reason:z.string()}).nullish()})});
function mappedTurns(request:GenerationRequest):unknown[] {
  const blocks=blocksOf(request.continuation);let end=0;
  for(const b of blocks){if(b.at<end || b.at+b.count>request.turns.length)throw new Error('invalid_continuation');end=b.at+b.count;}
  const input:unknown[]=[];
  for(let index=0;index<request.turns.length;index++) {
    const block=blocks.find(b=>b.at===index);
    if(block){input.push(...block.items);index+=block.count-1;continue;}
    const turn=request.turns[index]!;
    input.push(turn.type==='message' ? {role:turn.role,content:turn.text} : turn.type==='tool_call' ? {type:'function_call',call_id:turn.callId,name:turn.name,arguments:JSON.stringify(turn.arguments)} : {type:'function_call_output',call_id:turn.callId,output:JSON.stringify(turn.result)});
  }
  return input;
}
export function serializeEveryday(input:GenerationRequest):Uint8Array {
  const request=requireGenerationCapabilities({family:'openrouter_responses',capabilities:{streaming:true,tools:true}},input);
  return Buffer.from(JSON.stringify({model:models.everyday.modelId,input:mappedTurns(request),tools:request.tools.map(tool=>({type:'function',...tool,strict:false})),
    stream:true,store:false,reasoning:models.everyday.reasoning,max_output_tokens:models.everyday.maxOutputTokens,provider:{zdr:true},plugins:[],parallel_tool_calls:false}));
}
function providerUsage(raw:Record<string,z.infer<ReturnType<typeof z.json>>>) {
  const count=z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable();
  const inputTokens=count.parse(raw.input_tokens ?? null);const outputTokens=count.parse(raw.output_tokens ?? null);
  const details=z.record(z.string(),z.json()).nullish().parse(raw.output_tokens_details);
  const inputDetails=z.record(z.string(),z.json()).nullish().parse(raw.input_tokens_details);
  const reasoning=count.parse(details?.reasoning_tokens ?? null);const cached=count.parse(inputDetails?.cached_tokens ?? null);
  const written=count.parse(inputDetails?.cache_write_tokens ?? null);
  const cost=raw.cost===undefined || raw.cost===null ? null : new Decimal(z.union([z.string(),z.number().finite().nonnegative()]).parse(raw.cost)).toFixed();
  if(reasoning!==null && outputTokens!==null && reasoning>outputTokens || cached!==null && inputTokens!==null && cached>inputTokens)throw new Error('invalid_usage_subset');
  return normalizeUsage({inputTokens,outputTokens,reasoningTokens:reasoning,cacheReadTokens:cached,cacheWriteTokens:written,
    reasoningIsOutputSubset:reasoning===null ? null : true,cacheReadIsInputSubset:cached===null ? null : true,reportedCostUSD:cost,rawUsage:raw});
}

/** No fetch, SDK, credentials, retries, or live transport lives in the adapter. */
export class OpenRouterResponsesAdapter implements GenerationAdapter {
  readonly family='openrouter_responses';readonly capabilities={streaming:true,tools:true};
  async *generate(request:GenerationRequest,options:{signal:AbortSignal;dispatch:PaidRequestDispatcher}):AsyncIterable<GenerationEvent> {
    const body=serializeEveryday(request);
    const decoder=new TextDecoder('utf-8',{fatal:true});let buffer='';let text='';let terminal=false;let frameBytes=0;
    const argumentsById=new Map<string,string>();
    const parse=(frame:string):GenerationEvent[]=>{
      const data=frame.split('\n').filter(line=>line.startsWith('data:')).map(line=>line.slice(5).trimStart()).join('\n');
      if(!data || data==='[DONE]')return [];
      if(terminal)throw new Error('provider_event_after_terminal');
      const event=z.object({type:z.string()}).passthrough().parse(JSON.parse(data));
      if(event.type==='response.output_text.delta') {
        const delta=z.string().parse(event.delta);text+=delta;
        if(Buffer.byteLength(text)>65536)throw new Error('output_limit');
        return [{type:'text.delta',text:delta}];
      }
      if(event.type==='response.function_call_arguments.delta') {
        const id=z.string().min(1).parse(event.item_id);const delta=z.string().parse(event.delta);
        argumentsById.set(id,(argumentsById.get(id) ?? '')+delta);return [];
      }
      if(event.type==='response.failed' || event.type==='error')throw new Error('provider_failed');
      if(event.type!=='response.completed' && event.type!=='response.incomplete')return [];
      const done=completedSchema.parse(event);const out:GenerationEvent[]=[];const seen=new Set<string>();let finalText='';let blocked=false;
      if(done.response.status!==(done.type==='response.completed'?'completed':'incomplete'))throw new Error('invalid_finish_state');
      const calls=[];
      for(const item of done.response.output) {
        const base=z.object({type:z.string()}).passthrough().parse(item);
        if(base.type==='function_call') {
          const call=z.object({id:z.string().min(1),call_id:z.string().min(1),name:z.string().min(1),arguments:z.string()}).parse(base);
          if(seen.has(call.call_id)||argumentsById.has(call.id)&&argumentsById.get(call.id)!==call.arguments)throw new Error('invalid_tool_call');
          seen.add(call.call_id);calls.push(ToolCallSchema.parse({callId:call.call_id,name:call.name,arguments:JSON.parse(call.arguments)}));
          argumentsById.delete(call.id);
        } else if(base.type==='message') {
          const message=z.object({role:z.literal('assistant'),content:z.array(z.discriminatedUnion('type',[
            z.object({type:z.literal('output_text'),text:z.string()}),z.object({type:z.literal('refusal'),refusal:z.string()}),
          ]))}).parse(base);
          for(const part of message.content){finalText+=part.type==='output_text'?part.text:part.refusal;if(part.type==='refusal')blocked=true;}
        } else if(base.type!=='reasoning')throw new Error('unsupported_provider_output');
      }
      if(argumentsById.size || text && text!==finalText || !finalText && !calls.length && !blocked)throw new Error('incomplete_provider_output');
      if(!text && finalText)out.push({type:'text.delta',text:finalText});
      for(const call of calls)out.push({type:'tool.call',call});
      if(done.response.usage)out.push({type:'usage',usage:providerUsage(done.response.usage)});
      const count=(finalText ? 1 : 0)+calls.length;
      const continuation=continuationFor([...blocksOf(request.continuation),...(count ? [{at:request.turns.length,count,items:done.response.output}] : [])]);
      terminal=true;out.push({type:'completed',finishReason:blocked ? 'blocked' : done.type==='response.incomplete' ? 'length' : calls.length ? 'tool_calls' : 'stop',continuation,
        metadata:{providerRequestId:done.response.id??null,effectiveModel:done.response.model??null,effectiveEffort:done.response.reasoning?.effort??null}});return out;
    };
    for await(const chunk of options.dispatch.send({body,metadata:{endpoint:'https://openrouter.ai/api/v1/responses',headers:{'Content-Type':'application/json','Accept':'text/event-stream'},redactedHeaders:['authorization']},adapterVersion:everydayAdapterVersion,requestedEffort:models.everyday.reasoning.effort},options.signal)) {
      options.signal.throwIfAborted();frameBytes+=chunk.byteLength;
      if(frameBytes>4*1024*1024)throw new Error('provider_stream_limit');
      buffer=(buffer+decoder.decode(chunk,{stream:true})).replace(/\r\n/g,'\n');
      let boundary:number;
      while((boundary=buffer.indexOf('\n\n'))!==-1){const frame=buffer.slice(0,boundary);buffer=buffer.slice(boundary+2);for(const event of parse(frame))yield event;}
    }
    buffer+=decoder.decode();
    if(buffer.trim() || !terminal)throw new Error('provider_stream_truncated');
  }
}

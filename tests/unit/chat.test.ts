import { describe,expect,it } from 'vitest';
import { ChatSendRequestSchema } from '../../shared/api.js';
import { boundContext } from '../../server/ai/context.js';
import { safetyInstructions,rejectCredentials,baselineSafety } from '../../server/ai/prompts/everyday.js';
import { OpenRouterResponsesAdapter,serializeEveryday } from '../../server/ai/providers/openrouter.js';
import type { GenerationRequest } from '../../server/ai/contracts.js';
import { responseFrame,assistantOutput } from '../fixtures/chat.js';
const request:GenerationRequest={turns:[{type:'message',role:'user',text:'Synthetic 🦊'}],tools:[],continuation:null};
async function events(bytes:Buffer,fragment=1) {
  const result=[];
  for await(const event of new OpenRouterResponsesAdapter().generate(request,{signal:new AbortController().signal,dispatch:{async *send(){for(let i=0;i<bytes.length;i+=fragment)yield bytes.subarray(i,i+fragment);}}}))result.push(event);
  return result;
}
describe('chat contracts, bounded context and safety',()=>{
  it('allows absent selection without invented metric; rejects forged tools and empty input',()=>{
    const input={action:'send',conversation_id:'22222222-2222-4222-8222-222222222222',client_request_id:'11111111-1111-4111-8111-111111111111',message:{id:'33333333-3333-4333-8333-333333333333',text:'Hello'},depth:'auto'};
    expect(ChatSendRequestSchema.parse(input).context_selection).toBeNull();
    expect(ChatSendRequestSchema.safeParse({...input,tool_results:[]}).success).toBe(false);
    expect(ChatSendRequestSchema.safeParse({...input,message:{...input.message,text:' '}}).success).toBe(false);
  });
  it('prunes complete history groups and never truncates safety',()=>{
    const essential:GenerationRequest={...request,turns:[{type:'message',role:'system',text:safetyInstructions},...request.turns]};
    const group={id:'old',turns:[{type:'tool_call' as const,callId:'c',name:'list_metrics',arguments:{}},{type:'tool_result' as const,callId:'c',name:'list_metrics',result:{text:'x'.repeat(4000)}}],continuation:null};
    const bounded=boundContext(essential,[group],Buffer.byteLength(JSON.stringify(essential))+100);
    expect(bounded.excluded).toEqual([{referenceId:'old',reason:'context_limit'}]);expect(bounded.request.turns[0]).toEqual(essential.turns[0]);
    expect(()=>boundContext(essential,[],10)).toThrow('essential context');
  });
  it('rejects recognizable credentials and provides deterministic safety guidance',()=>{
    for(const value of ['sk-proj-'+'a'.repeat(30),'Bearer '+'a'.repeat(30),'api_key = syntheticcredential','-----BEGIN PRIVATE KEY-----'])expect(rejectCredentials(value)).toBe(true);
    expect(rejectCredentials('How is my weight?')).toBe(false);expect(baselineSafety('I have severe chest pain')).toContain('emergency');expect(baselineSafety('Can you diagnose me?')).toContain('cannot diagnose');
  });
});
describe('Everyday Responses wire adapter',()=>{
  it('enforces privacy, stateless history and catalog bounds',()=>{
    const body=JSON.parse(Buffer.from(serializeEveryday(request)).toString());expect(body).toMatchObject({store:false,provider:{zdr:true},plugins:[],stream:true,max_output_tokens:3072});expect(body.previous_response_id).toBeUndefined();
  });
  it('parses fragmented UTF-8, CRLF, refusal, opaque state, and nullable usage',async()=>{
    const result=await events(responseFrame([assistantOutput('Synthetic 🦊')],null));expect(result[0]).toEqual({type:'text.delta',text:'Synthetic 🦊'});expect(result.at(-1)).toMatchObject({type:'completed',finishReason:'stop'});expect(result.some(e=>e.type==='usage')).toBe(false);
    const refusal=await events(responseFrame([{type:'message',role:'assistant',content:[{type:'refusal',refusal:'Cannot comply'}]}]));expect(refusal.at(-1)).toMatchObject({finishReason:'blocked'});
    await expect(events(Buffer.from(responseFrame([assistantOutput('ok')]).toString().replaceAll('\n','\r\n')),3)).resolves.toHaveLength(3);
  });
  it('preserves function IDs and opaque items on continuation without duplicate calls',async()=>{
    const output=[{type:'reasoning',id:'opaque',encrypted_content:'synthetic'},{type:'function_call',id:'item',call_id:'call',name:'list_metrics',arguments:'{}'}];
    const result=await events(responseFrame(output));const last=result.at(-1)!;if(last.type!=='completed')throw new Error();
    const next:GenerationRequest={...request,turns:[...request.turns,{type:'tool_call',callId:'call',name:'list_metrics',arguments:{}},{type:'tool_result',callId:'call',name:'list_metrics',result:{items:[]}}],continuation:last.continuation};
    const wire=JSON.parse(Buffer.from(serializeEveryday(next)).toString());expect(wire.input).toEqual([{role:'user',content:'Synthetic 🦊'},...output,{type:'function_call_output',call_id:'call',output:'{"items":[]}'}]);
  });
  it.each(['malformed','truncated','duplicate','unmatched','usage'])('fails closed on %s provider output',async(mode)=>{
    const duplicate=[{type:'function_call',id:'i1',call_id:'c',name:'list_metrics',arguments:'{}'},{type:'function_call',id:'i2',call_id:'c',name:'list_metrics',arguments:'{}'}];
    const bytes=mode==='malformed'?Buffer.from('data: {no}\n\n'):mode==='truncated'?Buffer.from('data: {"type":"response.created"}\n\n'):mode==='duplicate'?responseFrame(duplicate):mode==='unmatched'?Buffer.concat([Buffer.from('data: {"type":"response.function_call_arguments.delta","item_id":"missing","delta":"{}"}\n\n'),responseFrame([assistantOutput('ok')])]):responseFrame([assistantOutput('ok')],{input_tokens:1,output_tokens:1,output_tokens_details:{reasoning_tokens:2}});
    await expect(events(bytes)).rejects.toThrow();
  });
});

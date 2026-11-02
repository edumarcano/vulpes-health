import { randomBytes,randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { beforeEach,afterEach,it,expect,vi } from 'vitest';
import { LocalSupabase } from '../helpers/local-supabase.js';
import { localStatus } from '../../scripts/local-database.js';
import { verifySession,type AuthContext } from '../../server/auth/session.js';
import { ConversationService } from '../../server/services/conversations.js';
import { GoalService } from '../../server/services/goals.js';
import { ExecutionService,requestHash,type PreparedStep } from '../../server/ai/ledger/execution.js';
import { VulpesAgent } from '../../server/ai/VulpesAgent.js';
import { createChatHandler } from '../../server/http/chat.js';
import { localRouter } from '../../server/http/router.js';
import { SyntheticGoalTransport } from '../fixtures/chat-goals.js';
import { syntheticChatDependencies } from '../fixtures/chat.js';
import { ChatSendRequestSchema,ApprovalRequestSchema } from '../../shared/api.js';
import { GoalDefinitionSchema } from '../../shared/goals.js';
import { StreamDecoder } from '../../shared/stream.js';
import { prepareGoalTool,providerToolResult } from '../../server/ai/tools.js';
import { readPayload } from '../../server/security/private-payloads.js';
import { InspectionService } from '../../server/services/inspection.js';
import { addMeasurement } from '../../server/services/measurements.js';
import { safetyInstructions } from '../../server/ai/prompts/everyday.js';

let db:LocalSupabase;let a:AuthContext;let b:AuthContext;let token:string;let app:string;let source:string;
async function rows(table:string,filter=`user_id=eq.${a.userId}`){return await(await db.admin(`/rest/v1/${table}?${filter}`,'GET')).json() as Record<string,unknown>[];}
async function conversation(context=a){const id=randomUUID();await new ConversationService(context).mutate({action:'create',id,client_request_id:randomUUID()});return id;}
const send=(id:string,text='Propose a weight goal for review.')=>ChatSendRequestSchema.parse({action:'send',conversation_id:id,client_request_id:randomUUID(),message:{id:randomUUID(),text},depth:'auto'});
const definition=()=>({schemaVersion:1,title:'Synthetic chat goal',metric:'weight',unit:'kg',sourceId:source,method:'device_reported',granularity:'instant',target:{direction:'decrease_to',value:68},baselineMethod:'daily_median_mean_7d',currentMethod:'daily_median_mean_7d',baselineFrom:'2026-09-01T00:00:00Z',baselineTo:'2026-09-08T00:00:00Z',reportedBaseline:null,timezone:'UTC',targetDate:null,constraints:[],proposedStrategy:null});
const approval=(p:Record<string,unknown>,action:'approve'|'reject'='approve')=>ApprovalRequestSchema.parse({action,proposal_id:p.id,payload_hash:p.payload_hash,expected_version:p.target_version,client_request_id:randomUUID()});
beforeEach(async()=>{
 const c=localStatus();for(const [key,value] of Object.entries({VITE_SUPABASE_URL:c.apiUrl,VITE_SUPABASE_PUBLISHABLE_KEY:c.anonKey,SUPABASE_SERVICE_ROLE_KEY:c.adminKey,VULPES_TRACE_ENCRYPTION_KEY_ID:'synthetic-chat-goals',VULPES_TRACE_ENCRYPTION_KEY_B64:randomBytes(32).toString('base64'),VULPES_LIVE_AI_ENABLED:'false'}))vi.stubEnv(key,value);
 db=new LocalSupabase();app=randomUUID();const period=new Date().toISOString().slice(0,7)+'-01';await db.admin('/rest/v1/usage_buckets','POST',{id:app,scope:'app',period_start:period,allocated_ceiling_usd:'10'});
 const contexts=[];for(let i=0;i<2;i++){const u=await db.createUser();if(i===0)token=u.token;await db.admin('/rest/v1/profiles','POST',{user_id:u.id,consent_versions:{openrouter:{accepted_version:'openrouter_zdr_v2',accepted_at:new Date().toISOString()}}});await db.admin('/rest/v1/usage_buckets','POST',{user_id:u.id,scope:'account',period_start:period,allocated_ceiling_usd:'1'});contexts.push(await verifySession({headers:{authorization:`Bearer ${u.token}`}}));}[a,b]=contexts as [AuthContext,AuthContext];
 source=randomUUID();await db.admin('/rest/v1/data_sources','POST',{id:source,user_id:a.userId,kind:'manual',label:'Synthetic M4 source',source_namespace:randomUUID()});
});
afterEach(async()=>{try{await db.cleanup();await db.admin(`/rest/v1/usage_buckets?id=eq.${app}`,'DELETE');}finally{vi.restoreAllMocks();vi.unstubAllEnvs();}});
async function withApi(transport:SyntheticGoalTransport,work:(api:(route:string,body?:unknown)=>Promise<Response>)=>Promise<void>){
 const chat=createChatHandler(()=>syntheticChatDependencies(transport));const server=createServer((req,res)=>{void(new URL(req.url!,'http://local').pathname==='/api/chat'?chat(req,res):localRouter(req,res));});server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error();
 try{await work((route,body)=>fetch(`http://127.0.0.1:${address.port}${route}`,{headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{method:'POST',body:JSON.stringify(body)}:{})}));}finally{server.closeAllConnections();await new Promise<void>(r=>server.close(()=>r()));}
}
async function stream(response:Response){expect(response.status).toBe(200);const decoder=new StreamDecoder();const events=[];for await(const bytes of response.body!)events.push(...decoder.push(bytes));decoder.finish();return events;}
async function tool(){
 const id=await conversation();const ledger=new ExecutionService(a,{maxRunCostUSD:'0.25'});const input=send(id);
 const admission=await ledger.admit({conversationId:id,clientRequestId:input.client_request_id,requestHash:requestHash(input),depth:'auto',route:{role:'everyday',provider:'openrouter',model:'openai/gpt-6-luna',effort:'low'},consentVersion:'openrouter_zdr_v2'},input.message);
 if(!admission.lease)throw new Error();const step=await ledger.prepare(admission.lease,{type:'tool',body:Buffer.from(JSON.stringify({callId:'proposal',name:'propose_goal',arguments:{definition:definition()}})),toolName:'propose_goal',adapterVersion:'vulpes-tools-v2',metadata:{endpoint:'tool:read',headers:{},redactedHeaders:[]}});
 const output=await prepareGoalTool(a,'propose_goal',{definition:definition()},step.id);
 const evidence={version:1,ownerId:a.userId,runId:step.lease.runId,stepId:step.id,resultId:randomUUID(),dataRevision:output.payload.reviewedDataRevision};
 return {id,ledger,step,output,trace:{projectionVersion:3,evidence,result:output,providerResult:providerToolResult(output)}};
}
it('completes import → Ask → inspect → propose → approve → additional import → progress → reload',async()=>{
 const transport=new SyntheticGoalTransport();await withApi(transport,async api=>{
  const preview=await api('/api/data',{action:'preview_csv',client_request_id:randomUUID(),csv:readFileSync('docs/spec/v0.1.0/fixtures/measurements-synthetic.csv','utf8'),source:{kind:'new',label:'Synthetic M4 import',origin_app:null,device_label:null},mapping:{schema_version:1,format:'canonical',timezone:'UTC',profile:null,single_profile:true,review_requested:false,source_label:'Synthetic Scale A'}});expect(preview.status).toBe(200);const batch=(await preview.json()).data;expect((await api('/api/data',{action:'commit_import',batch_id:batch.batch_id,payload_hash:batch.payload_hash,client_request_id:randomUUID()})).status).toBe(200);
  const id=await conversation();const input=send(id,`Propose a weight goal using source:${batch.source_id}`);const events=await stream(await api('/api/chat',input));expect(events.at(-1)?.type,JSON.stringify(events.at(-1))).toBe('run.completed');expect(transport.requests).toHaveLength(3);expect(transport.requests.every(x=>x.length<=12000)).toBe(true);
  expect(await rows('goals')).toHaveLength(0);const p=(await rows('action_proposals'))[0]!;expect(p.state).toBe('pending');expect(p.canonical_payload).toMatchObject({baseline:{value:'69.7'}});expect(events.some(e=>e.type==='card.ready'&&e.payload.card.type==='goal_proposal')).toBe(true);
  const step=(await rows('ai_steps',`id=eq.${p.source_step_id}`))[0]!;const inspected=await new InspectionService(a).evidence({view:'payload',run:String(p.source_run_id),step:String(step.id),part:'output'});expect(inspected.state).toBe('available');const bytes=await readPayload(a,String(step.output_payload_id),'tool_output');expect(bytes.state).toBe('available');if(bytes.state==='available')expect(JSON.parse(bytes.bytes.toString())).toMatchObject({projectionVersion:3,providerResult:{requiresUserConfirmation:true}});
  const pair=await new ConversationService(a).read({view:'messages',id,page_size:100});expect('items' in pair&&pair.items.at(-1)).toMatchObject({parts:[{type:'goal_proposal',reference:{proposalId:p.id}},{type:'text'}]});
  expect((await api('/api/chat',input)).headers.get('content-type')).toContain('application/json');expect(transport.requests).toHaveLength(3);
  expect((await api('/api/approvals',{...approval(p),payload_hash:'f'.repeat(64)})).status).toBe(409);const decision=await api('/api/approvals',approval(p));expect(decision.status).toBe(200);const goal=(await decision.json()).data.goalId;expect(transport.requests).toHaveLength(3);
  const today=new Date().toISOString().slice(0,10);const csv='observed_at,metric,value,unit,source,granularity,external_record_id,local_date,timezone,method\n'+[2,1,0].map((offset,index)=>`${new Date(Date.parse(today)-offset*86400000).toISOString().slice(0,10)}T08:00:00Z,weight,${['68.9','68.8','68.7'][index]},kg,Synthetic Scale A,instant,synthetic-m4-${index},,UTC,device_reported`).join('\n')+'\n';
  const second=await api('/api/data',{action:'preview_csv',client_request_id:randomUUID(),csv,source:{kind:'existing',id:batch.source_id},mapping:{schema_version:1,format:'canonical',timezone:'UTC',profile:null,single_profile:true,review_requested:false,source_label:'Synthetic Scale A'}});expect(second.status).toBe(200);const next=(await second.json()).data;expect((await api('/api/data',{action:'commit_import',batch_id:next.batch_id,payload_hash:next.payload_hash,client_request_id:randomUUID()})).status).toBe(200);
  const detail=await api('/api/goals?view=detail&id='+goal);expect(detail.status).toBe(200);const data=(await detail.json()).data;expect(data.revision.payload.baseline.value).toBe('69.7');expect(data.progress).toMatchObject({kind:'progress',current:'68.8'});expect(transport.requests).toHaveLength(3);expect((await new GoalService(a).owned(goal)).state).toBe('active');
 });
});
it.each([1,20])('bounds context for a final goal answer with %i constraint entries',async count=>{
 await addMeasurement(a,{action:'add_measurement',client_request_id:randomUUID(),source:{kind:'existing',id:source},observation:{metric:'weight',value:'69',unit:'kg',observed_at:new Date(Date.now()-3600000).toISOString(),timezone:'UTC',local_date:null,granularity:'instant',method:'device_reported',quality_flags:[]}});
 const service=new GoalService(a);const proposal=await service.propose({action:'propose_create',client_request_id:randomUUID(),definition:GoalDefinitionSchema.parse({...definition(),baselineMethod:'user_reported',reportedBaseline:70,currentMethod:'latest_value',constraints:Array.from({length:count},()=> 'Synthetic constraint. '.repeat(28))})});
 await service.decide(approval(proposal));const id=await conversation();const transport=new SyntheticGoalTransport('goal_progress');
 const agent=new VulpesAgent(a,syntheticChatDependencies(transport));const input=send(id,'Show the approved goal progress.');const admitted=await agent.admit(input);if(!admitted.lease)throw new Error('Missing synthetic lease.');
 const events=[];for await(const event of agent.run(input,admitted.lease,admitted.result.run,admitted.baseline,new AbortController().signal))events.push(event);
 expect(transport.requests.every(bytes=>bytes.length<=12000)).toBe(true);
 const inspector=new InspectionService(a);const overview=await inspector.overview(admitted.result.run.id);
 for(const [index,step] of overview.steps.filter(s=>s.type==='generation').entries()){
  const exact=await inspector.evidence({view:'payload',run:admitted.result.run.id,step:step.id,part:'input'});expect(exact.state).toBe('available');if(exact.state==='available')expect(exact.bytes.equals(transport.requests[index]!)).toBe(true);
 }
 if(count===20){expect(events.at(-1)).toMatchObject({type:'run.failed',payload:{code:'context_too_large',retryable:false}});expect(transport.requests).toHaveLength(1);return;}
 expect(events.at(-1)?.type).toBe('run.completed');expect(transport.requests).toHaveLength(3);
 const final=JSON.parse(transport.requests[2]!.toString());expect(final.tools).toEqual([]);expect(final.input[0].content).toBe(safetyInstructions);
 const progress=final.input.filter((item:{type:string})=>item.type==='function_call_output').map((item:{output:string})=>JSON.parse(item.output).result).find((result:{kind:string})=>result.kind==='progress');expect(progress).toMatchObject({baseline:'70',current:'69'});
 const context=await inspector.evidence({view:'payload',run:admitted.result.run.id,step:overview.steps.filter(s=>s.type==='generation')[2]!.id,part:'context'});expect(context.state).toBe('available');if(context.state==='available')expect(JSON.parse(context.bytes.toString()).excluded).toContainEqual({referenceId:'tools:domain',reason:'context_limit_handoff_or_final_answer'});
});
it('replays a concurrent checkpoint once and survives trace expiry without reconstructing evidence',async()=>{
 const t=await tool();const saved=await Promise.all([t.ledger.checkpointGoal(t.step,t.output,t.trace),t.ledger.checkpointGoal(t.step,t.output,t.trace)]);expect(saved[0]!.reference).toEqual(saved[1]!.reference);expect(await rows('action_proposals')).toHaveLength(1);expect(await rows('goals')).toHaveLength(0);
 await db.admin(`/rest/v1/private_payloads?user_id=eq.${a.userId}`,'PATCH',{created_at:new Date(Date.now()-2000).toISOString(),expires_at:new Date(Date.now()-1000).toISOString()});
 const read=await new ConversationService(a).read({view:'messages',id:t.id,page_size:100});expect(read.items.at(-1)).toMatchObject({parts:[{type:'goal_proposal',reference:saved[0]!.reference}]});
 const changed={...t.output,request:{...t.output.request,definition:{...t.output.payload.definition,title:'Changed replay'}}};await expect(t.ledger.checkpointGoal(t.step,changed,t.trace)).rejects.toMatchObject({status:409});expect(await rows('action_proposals')).toHaveLength(1);
});
it('rejects foreign parents, injected authority, and fabricated message references',async()=>{
 await expect(prepareGoalTool(b,'propose_goal',{definition:definition()},randomUUID())).rejects.toMatchObject({status:404});await expect(prepareGoalTool(a,'propose_goal',{definition:definition(),state:'active'},randomUUID())).rejects.toThrow();
 const t=await tool();const saved=await t.ledger.checkpointGoal(t.step,t.output,t.trace);const foreign=await conversation(b);const foreignMessage=randomUUID();
 await db.admin('/rest/v1/messages','POST',{id:foreignMessage,user_id:b.userId,conversation_id:foreign,role:'assistant',content_parts:[],status:'completed'});
 expect((await db.request(`/rest/v1/action_proposals?id=eq.${saved.reference.proposalId}`,'admin',{method:'PATCH',body:JSON.stringify({source_message_id:foreignMessage})})).ok).toBe(false);
 const another=await conversation();const direct=await new GoalService(a).propose({action:'propose_create',client_request_id:randomUUID(),definition:t.output.payload.definition});
 const message=(await rows('messages',`conversation_id=eq.${t.id}&role=eq.assistant`))[0]!;await db.admin(`/rest/v1/messages?id=eq.${message.id}`,'PATCH',{content_parts:[{type:'goal_proposal',reference:{...saved.reference,proposalId:direct.id,payloadHash:direct.payload_hash}}]});
 expect((await new ConversationService(a).read({view:'messages',id:t.id,page_size:100})).items.at(-1)).toMatchObject({parts:[{type:'text',text:'The saved goal proposal is unavailable.'}]});expect(await rows('messages',`conversation_id=eq.${another}`)).toHaveLength(0);
 const denied=await db.request('/rest/v1/rpc/checkpoint_goal_proposal_v1',token,{method:'POST',body:JSON.stringify({p_owner:a.userId,p_run:t.step.lease.runId,p_executor:t.step.lease.executor,p_fence:1,p_step:t.step.id,p_request:t.output.request,p_payload:t.output.payload,p_output:{}})});expect(denied.ok).toBe(false);
});
it.each(['cancel','delete','data','fence'] as const)('prevents proposal writes after %s invalidates execution',async mode=>{
 const t=await tool();let step:PreparedStep=t.step;
 if(mode==='cancel')await t.ledger.cancel(t.step.lease.runId);
 if(mode==='delete')await new ConversationService(a).mutate({action:'delete',id:t.id,confirm:true,client_request_id:randomUUID()});
 if(mode==='data')await db.admin(`/rest/v1/profiles?user_id=eq.${a.userId}`,'PATCH',{data_revision:1});
 if(mode==='fence')step={...t.step,lease:{...t.step.lease,fence:2}};
 await expect(t.ledger.checkpointGoal(step,t.output,t.trace)).rejects.toThrow();expect(await rows('action_proposals')).toHaveLength(0);expect(await rows('goals')).toHaveLength(0);expect(await rows('audit_events',`user_id=eq.${a.userId}&event_type=eq.goal_propose_v1`)).toHaveLength(0);
});
it('rolls back registration when encrypted evidence storage fails',async()=>{
 const t=await tool();const response=await db.request('/rest/v1/rpc/checkpoint_goal_proposal_v1','admin',{method:'POST',body:JSON.stringify({p_owner:a.userId,p_run:t.step.lease.runId,p_executor:t.step.lease.executor,p_fence:1,p_step:t.step.id,p_request:t.output.request,p_payload:t.output.payload,p_output:{}})});expect(response.ok).toBe(false);
 expect(await rows('action_proposals')).toHaveLength(0);expect(await rows('audit_events',`user_id=eq.${a.userId}&event_type=eq.goal_propose_v1`)).toHaveLength(0);expect((await rows('ai_steps'))[0]!.output_payload_id).toBeNull();expect((await rows('messages',`conversation_id=eq.${t.id}&role=eq.assistant`))[0]!.content_parts).toEqual([]);
 expect((await t.ledger.checkpointGoal(t.step,t.output,t.trace)).reference.proposalId).toBeTruthy();
});
it('serializes approve/reject races and enforces the shared treatment policy',async()=>{
 const t=await tool();const saved=await t.ledger.checkpointGoal(t.step,t.output,t.trace);const service=new GoalService(a);const p=await service.proposal(saved.reference.proposalId);
 const outcomes=await Promise.allSettled([service.decide(approval(p)),service.decide(approval(p,'reject'))]);expect(outcomes.filter(x=>x.status==='fulfilled')).toHaveLength(1);expect(outcomes.filter(x=>x.status==='rejected')).toHaveLength(1);
 const closed=await service.proposal(p.id);expect(['approved','rejected']).toContain(closed.state);expect(await rows('goal_revisions')).toHaveLength(closed.state==='approved'?1:0);
 await expect(prepareGoalTool(a,'propose_goal',{definition:{...definition(),proposedStrategy:'Stop medication'}},randomUUID())).rejects.toMatchObject({status:403});expect(await rows('action_proposals')).toHaveLength(1);
});
it('invalidates deleted-conversation drafts while preserving already approved goals',async()=>{
 const t=await tool();const saved=await t.ledger.checkpointGoal(t.step,t.output,t.trace);const pending=await new GoalService(a).proposal(saved.reference.proposalId);await new GoalService(a).decide(approval(pending));
 const other=await new GoalService(a).propose({action:'propose_create',client_request_id:randomUUID(),definition:t.output.payload.definition});
 await db.admin(`/rest/v1/action_proposals?id=eq.${other.id}`,'PATCH',{source_message_id:(await rows('messages',`conversation_id=eq.${t.id}&role=eq.assistant`))[0]!.id,source_run_id:t.step.lease.runId});
 await new ConversationService(a).mutate({action:'delete',id:t.id,confirm:true,client_request_id:randomUUID()});expect(await rows('goals')).toHaveLength(1);expect((await new GoalService(a).proposal(other.id))).toMatchObject({state:'conflicted',canonical_payload:null});expect(await rows('private_payloads')).toHaveLength(0);
});
it('requires explicit approval of chat revisions and never treats conversational yes as approval',async()=>{
 await addMeasurement(a,{action:'add_measurement',client_request_id:randomUUID(),source:{kind:'existing',id:source},observation:{metric:'weight',value:'69',unit:'kg',observed_at:new Date(Date.now()-3600000).toISOString(),timezone:'UTC',local_date:null,granularity:'instant',method:'device_reported',quality_flags:[]}});
 const service=new GoalService(a);const p=await service.propose({action:'propose_create',client_request_id:randomUUID(),definition:GoalDefinitionSchema.parse({...definition(),baselineMethod:'user_reported',reportedBaseline:70,currentMethod:'latest_value'})});
 const created=await service.decide(approval(p)) as {goalId:string};const id=await conversation();
 const revise=new SyntheticGoalTransport('goal_revise');let proposal:Record<string,unknown>;
 await withApi(revise,async api=>{const events=await stream(await api('/api/chat',send(id,'Propose revising the target to 67 kg.')));expect(events.at(-1)?.type,JSON.stringify(events.at(-1))).toBe('run.completed');proposal=(await rows('action_proposals',`user_id=eq.${a.userId}&state=eq.pending`))[0]!;expect(proposal).toMatchObject({kind:'goal.revise',target_version:1});expect((await service.owned(created.goalId)).target_value).toBe(68);});
 const step=(await rows('ai_steps',`id=eq.${proposal!.source_step_id}`))[0]!;const captured=await readPayload(a,String(step.input_payload_id),'tool_input');expect(captured.state).toBe('available');if(captured.state==='available')expect(JSON.parse(captured.bytes.toString()).arguments.rationale).toBe('Review the requested target adjustment.');
 const yes=new SyntheticGoalTransport('goal_yes');await withApi(yes,async api=>{const events=await stream(await api('/api/chat',send(id,'yes, approve it')));expect(events.at(-1)?.type).toBe('run.completed');expect(events.filter(e=>e.type==='text.delta').map(e=>e.payload.text).join('')).toContain('explicitly approve');});
 expect(await rows('goal_revisions')).toHaveLength(1);expect((await service.proposal(String(proposal!.id))).state).toBe('pending');
 const decision=approval(proposal!);const results=await Promise.all([service.decide(decision),service.decide(decision)]);expect(results[0]).toEqual(results[1]);expect((await service.owned(created.goalId))).toMatchObject({target_value:67,version:2});expect(await rows('goal_revisions')).toHaveLength(2);
 const counts=[revise.requests.length,yes.requests.length];await service.proposal(String(proposal!.id));expect([revise.requests.length,yes.requests.length]).toEqual(counts);
 const progress=new SyntheticGoalTransport('goal_progress');await withApi(progress,async api=>{const events=await stream(await api('/api/chat',send(id,'Show goal progress.')));expect(events.at(-1)?.type,JSON.stringify(events.at(-1))).toBe('run.completed');expect(events.some(e=>e.type==='card.ready'&&e.payload.card.type==='goal_progress')).toBe(true);});
 const before=await new ConversationService(a).read({view:'messages',id,page_size:100});expect(before.items.flatMap(m=>'parts' in m?m.parts:[]).filter(p=>p.type==='goal_progress')).toHaveLength(1);
 const current=await service.revision(created.goalId);const revised=await service.propose({action:'propose_revision',client_request_id:randomUUID(),goal_id:created.goalId,expected_version:current.goal.version,definition:{...GoalDefinitionSchema.parse((current.revision.payload as {definition:unknown}).definition),target:{direction:'decrease_to',value:66}},baseline_resolution:'retain'});await service.decide(approval(revised));
 const history=await new ConversationService(a).read({view:'messages',id,page_size:100});expect(history.items.flatMap(m=>'parts' in m?m.parts:[]).filter(p=>p.type==='goal_progress')).toHaveLength(0);
});
it.each(['reject','expire','stale'] as const)('reloads authoritative %s status and cannot activate a closed chat proposal',async mode=>{
 const t=await tool();const saved=await t.ledger.checkpointGoal(t.step,t.output,t.trace);const service=new GoalService(a);const p=await service.proposal(saved.reference.proposalId);
 if(mode==='reject')await service.decide(approval(p,'reject'));
 if(mode==='expire')await db.admin(`/rest/v1/action_proposals?id=eq.${p.id}`,'PATCH',{created_at:new Date(Date.now()-172800000).toISOString(),expires_at:new Date(Date.now()-86400000).toISOString()});
 if(mode==='stale')await db.admin(`/rest/v1/profiles?user_id=eq.${a.userId}`,'PATCH',{data_revision:1});
 const beforeExpiryCleanup=await new ConversationService(a).read({view:'messages',id:t.id,page_size:100});expect(beforeExpiryCleanup.items.at(-1)).toMatchObject({parts:[{type:'goal_proposal',reference:saved.reference}]});
 const current=await service.proposal(p.id);expect(current).toMatchObject({state:mode==='reject'?'rejected':mode==='expire'?'expired':'conflicted',canonical_payload:null});await expect(service.decide(approval(p))).rejects.toMatchObject({status:409});expect(await rows('goals')).toHaveLength(0);
 const read=await new ConversationService(a).read({view:'messages',id:t.id,page_size:100});expect(read.items.at(-1)).toMatchObject({parts:[{type:'goal_proposal',reference:saved.reference}]});
});
it('retains a complete pending proposal if execution stops between commit and card emission',async()=>{
 const owner=await conversation();const input=send(owner);const agent=new VulpesAgent(a,syntheticChatDependencies(new SyntheticGoalTransport()));
 // Give the synthetic model an observed series without altering the baseline policy.
 await addMeasurement(a,{action:'add_measurement',client_request_id:randomUUID(),source:{kind:'existing',id:source},observation:{metric:'weight',value:'70',unit:'kg',observed_at:'2026-09-01T08:00:00Z',timezone:'UTC',local_date:null,granularity:'instant',method:'device_reported',quality_flags:[]}});
 const commit=agent.ledger.checkpointGoal.bind(agent.ledger);vi.spyOn(agent.ledger,'checkpointGoal').mockImplementation(async(...args)=>{await commit(...args);throw new Error('synthetic disconnect after commit');});
 const admitted=await agent.admit(input);if(!admitted.lease)throw new Error();const events=[];for await(const e of agent.run(input,admitted.lease,admitted.result.run,admitted.baseline,new AbortController().signal))events.push(e);
 expect(events.at(-1)?.type).toBe('run.failed');expect(events.some(e=>e.type==='card.ready')).toBe(false);expect(await rows('action_proposals')).toHaveLength(1);expect(await rows('goals')).toHaveLength(0);const last=(await new ConversationService(a).read({view:'messages',id:owner,page_size:100})).items.at(-1);expect(last&&'parts' in last?last.parts[0]?.type:null).toBe('goal_proposal');
});

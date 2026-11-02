import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {spawnSync} from 'node:child_process';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {LocalSupabase} from '../helpers/local-supabase.js';
import {localStatus} from '../../scripts/local-database.js';
import {verifySession,type AuthContext} from '../../server/auth/session.js';
import {ExecutionService,requestHash,type PreparedStep,type RunLease,type StepInput} from '../../server/ai/ledger/execution.js';
import {createDispatcher,type RequestTransport} from '../../server/ai/ledger/dispatcher.js';
import {normalizeUsage} from '../../server/ai/contracts.js';
import {readPayload} from '../../server/security/private-payloads.js';
import {syntheticPrice} from '../fixtures/executions.js';
import * as encryption from '../../server/security/encryption.js';
import {addMeasurement,mutateMeasurement} from '../../server/services/measurements.js';
import {getSettings,updateSettings} from '../../server/services/settings.js';

let db:LocalSupabase;let app:string;let a:AuthContext;let b:AuthContext;
let conversationA:string;let conversationB:string;let tokenA:string;
const period=()=>new Date().toISOString().slice(0,7)+'-01';
const input=(conversationId:string)=>({conversationId,clientRequestId:randomUUID(),requestHash:requestHash({text:'Synthetic only'}),depth:'everyday' as const,
  route:{role:'everyday' as const,provider:'openrouter' as const,model:'openai/gpt-6-luna',effort:'low'},consentVersion:'openrouter_zdr_v2'});
const service=(context=a)=>new ExecutionService(context,{maxRunCostUSD:'0.25'});
const stepInput=(body=Buffer.from('{"synthetic":"🦊\\n"}')):StepInput=>({type:'generation',body,provider:'openrouter',model:'openai/gpt-6-luna',price:syntheticPrice,
  adapterVersion:'synthetic-v1',requestedEffort:'low',metadata:{endpoint:'https://openrouter.ai/api/v1/responses',headers:{'Content-Type':'application/json'},redactedHeaders:['authorization']},
  context:{templateVersion:'synthetic-v1',included:[],excluded:[],retrieval:{ragUsed:false,webUsed:false}}});
async function rows(table:string,filter:string){return await (await db.admin(`/rest/v1/${table}?${filter}`,'GET')).json() as Record<string,unknown>[];}
function clearSyntheticRoute(model:'synthetic-route-bound'|'synthetic-overcharge-active'|'synthetic-route-race') {
  const sql=`do $$ begin if to_regclass('public.ai_route_cost_blocks') is not null then delete from public.ai_route_cost_blocks where provider='openrouter' and model_id='${model}'; end if; end $$`;
  expect(spawnSync('docker',['exec','supabase_db_vulpes-health-pr03-test','psql','-U','postgres','-d','postgres','-c',sql],{encoding:'utf8'}).status).toBe(0);
}
async function admit(ledger=service(),conversation=conversationA):Promise<RunLease>{const admission=await ledger.admit(input(conversation));expect(admission.result.kind).toBe('admitted');if(!admission.lease)throw new Error();return admission.lease;}
async function account(){return (await rows('usage_buckets',`user_id=eq.${a.userId}`))[0]!;}
beforeEach(async()=>{
  const status=localStatus();vi.stubEnv('VITE_SUPABASE_URL',status.apiUrl);vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY',status.anonKey);vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY',status.adminKey);
  vi.stubEnv('VULPES_TRACE_ENCRYPTION_KEY_ID','synthetic-execution-v1');vi.stubEnv('VULPES_TRACE_ENCRYPTION_KEY_B64',randomBytes(32).toString('base64'));
  db=new LocalSupabase();app=randomUUID();
  await db.admin('/rest/v1/usage_buckets','POST',{id:app,scope:'app',period_start:period(),allocated_ceiling_usd:'1'});
  const contexts:AuthContext[]=[];const conversations:string[]=[];
  for(let n=0;n<2;n++){
    const user=await db.createUser();if(n===0)tokenA=user.token;
    await db.admin('/rest/v1/profiles','POST',{user_id:user.id,consent_versions:{openrouter:{accepted_version:'openrouter_zdr_v2',accepted_at:new Date().toISOString()}}});
    const id=randomUUID();await db.admin('/rest/v1/conversations','POST',{id,user_id:user.id,title:'Synthetic execution'});conversations.push(id);
    await db.admin('/rest/v1/usage_buckets','POST',{user_id:user.id,scope:'account',period_start:period(),allocated_ceiling_usd:'1'});
    contexts.push(await verifySession({headers:{authorization:`Bearer ${user.token}`}}));
  }
  [a,b]=contexts as [AuthContext,AuthContext];[conversationA,conversationB]=conversations as [string,string];
});
afterEach(async()=>{try{if(db){await db.cleanup();await db.admin(`/rest/v1/usage_buckets?id=eq.${app}`,'DELETE');}}finally{vi.unstubAllEnvs();vi.restoreAllMocks();}});

describe('persistent run and accounting transactions',()=>{
  it('serializes duplicate admissions and rejects changed input; a second request gets the active run',async()=>{
    const ledger=service();const request=input(conversationA);
    const admissions=await Promise.all([ledger.admit(request),ledger.admit(request)]);
    expect(admissions.map(x=>x.result.kind).sort()).toEqual(['admitted','existing']);
    expect(admissions.filter(x=>x.lease)).toHaveLength(1);
    if(admissions[0]!.result.kind==='retained')throw new Error('Expected a retained run, not an expired receipt.');
    await expect(ledger.admit({...request,requestHash:requestHash('changed')})).rejects.toMatchObject({status:409});
    expect((await ledger.admit(input(conversationA))).result).toMatchObject({kind:'busy',run:{id:admissions[0]!.result.run.id}});
    expect(await rows('ai_runs',`user_id=eq.${a.userId}`)).toHaveLength(1);
  });
  it('reserves account and app together under simultaneous budget-boundary requests',async()=>{
    await db.admin(`/rest/v1/usage_buckets?id=eq.${app}`,'PATCH',{allocated_ceiling_usd:'0.03'});
    const la=service();const lb=service(b);const [ra,rb]=await Promise.all([admit(la),admit(lb,conversationB)]);
    const outcomes=await Promise.allSettled([la.prepare(ra,stepInput()),lb.prepare(rb,stepInput())]);
    expect(outcomes.filter(x=>x.status==='fulfilled')).toHaveLength(1);
    expect(outcomes.filter(x=>x.status==='rejected')).toHaveLength(1);
    expect((await rows('usage_buckets',`id=eq.${app}`))[0]).toMatchObject({reserved_usd:0.022,spent_usd:0});
    expect(await rows('usage_reservations','select=id')).toHaveLength(1);
    expect(await rows('private_payloads','select=id')).toHaveLength(2);
  });
  it('sends exactly captured bytes once to a loopback receiver, persists response prefixes, and settles once',async()=>{
    const ledger=service();const lease=await admit(ledger);const bytes=Buffer.from('{ "synthetic": "🦊", "spacing":  2 }\n');
    const step=await ledger.prepare(lease,stepInput(bytes));bytes.fill(0);
    let received=Buffer.alloc(0);let calls=0;
    const server=createServer(async(req,res)=>{calls++;const chunks=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));received=Buffer.concat(chunks);res.write('Synthetic ');res.end('response 🦊');});
    server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error();
    const transport:RequestTransport={mode:'mock',async *send(body,signal){const response=await fetch(`http://127.0.0.1:${address.port}`,{method:'POST',body:Buffer.from(body),signal,redirect:'error'});for await(const chunk of response.body!)yield chunk;}};
    const dispatcher=createDispatcher(ledger,transport);
    try{
      const chunks=[];for await(const chunk of dispatcher.send(step,new AbortController().signal))chunks.push(chunk);
      expect(Buffer.concat(chunks).toString()).toBe('Synthetic response 🦊');expect(calls).toBe(1);
      const stored=(await rows('ai_steps',`id=eq.${step.id}`))[0]!;
      const request=await readPayload(a,String(stored.input_payload_id),'ai_request');expect(request.state).toBe('available');if(request.state==='available')expect(request.bytes).toEqual(received);
      const response=await readPayload(a,String(stored.output_payload_id),'ai_response');expect(response.state).toBe('available');if(response.state==='available')expect(response.bytes.toString()).toBe('Synthetic response 🦊');
      expect((await readPayload(b,String(stored.input_payload_id),'ai_request')).state).toBe('not_found');
      const usage=normalizeUsage({reportedCostUSD:'0.003',rawUsage:{synthetic:true}});
      await ledger.settle(step,usage,'completed');await ledger.settle(step,usage,'completed');
      expect(await ledger.finish(lease,'completed')).toMatchObject({state:'completed',costUSD:'0.003',reservationUSD:'0'});
      expect(await account()).toMatchObject({spent_usd:0.003,reserved_usd:0});
      await expect(async()=>{for await(const chunk of dispatcher.send(step,new AbortController().signal))void chunk;}).rejects.toThrow();expect(calls).toBe(1);
    }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
  });
  it('rolls back a failed trace preparation and never invokes transport',async()=>{
    const ledger=service();const lease=await admit(ledger);const send=vi.fn(async function*(){yield Buffer.from('must not run');});
    const attempt=async()=>{const step=await ledger.prepare(lease,stepInput());for await(const chunk of createDispatcher(ledger,{mode:'mock',send}).send(step,new AbortController().signal))void chunk;};
    const old=process.env.VULPES_TRACE_ENCRYPTION_KEY_B64!;vi.stubEnv('VULPES_TRACE_ENCRYPTION_KEY_B64','invalid');
    await expect(attempt()).rejects.toThrow();vi.stubEnv('VULPES_TRACE_ENCRYPTION_KEY_B64',old);
    expect(send).not.toHaveBeenCalled();expect(await account()).toMatchObject({reserved_usd:0,spent_usd:0});expect(await rows('ai_steps',`run_id=eq.${lease.runId}`)).toEqual([]);
    // Failure inside PostgreSQL after envelope creation must also roll back both buckets.
    const encrypt=encryption.encryptBytes;vi.spyOn(encryption,'encryptBytes').mockImplementationOnce((...args)=>({...encrypt(...args),key_id:''}));
    await expect(attempt()).rejects.toThrow();expect(send).not.toHaveBeenCalled();expect(await account()).toMatchObject({reserved_usd:0});
    expect(await rows('private_payloads',`user_id=eq.${a.userId}`)).toEqual([]);
  });
  it('retains cancelled unknown cost, settles after 24 hours, and applies authoritative correction as a delta',async()=>{
    const ledger=service();const lease=await admit(ledger);const step=await ledger.prepare(lease,stepInput());await ledger.authorize(step);
    await ledger.cancel(lease.runId);await expect(ledger.authorize(step)).rejects.toThrow();
    await ledger.settle(step,null,'cancelled');expect(await ledger.finish(lease,'completed')).toMatchObject({state:'cancelled',costUSD:null,reservationUSD:'0.022'});
    await ledger.reconcile();expect(await account()).toMatchObject({reserved_usd:0.022,spent_usd:0});
    await db.admin(`/rest/v1/usage_reservations?step_id=eq.${step.id}`,'PATCH',{uncertain_since:new Date(Date.now()-25*3600_000).toISOString()});
    expect(await ledger.summary(lease.runId)).toMatchObject({costUSD:'0.022',costStatus:'conservative',reservationUSD:'0'});
    await ledger.settle(step,normalizeUsage({reportedCostUSD:'0.004',rawUsage:null}),'cancelled',2);
    await ledger.settle(step,normalizeUsage({reportedCostUSD:'0.004',rawUsage:null}),'cancelled',2);
    expect(await account()).toMatchObject({spent_usd:0.004,reserved_usd:0});
  });
  it.each(['prepared','authorized'] as const)('crash reconciliation fences %s steps without replaying inference',async(phase)=>{
    const ledger=service();const lease=await admit(ledger);const step=await ledger.prepare(lease,stepInput());if(phase==='authorized')await ledger.authorize(step);
    await db.admin(`/rest/v1/ai_runs?id=eq.${lease.runId}`,'PATCH',{lease_expires_at:new Date(Date.now()-1000).toISOString()});
    const summary=await ledger.summary(lease.runId);expect(summary.state).toBe('interrupted');expect(summary.reservationUSD).toBe(phase==='authorized'?'0.022':'0');
    await expect(ledger.heartbeat(lease)).rejects.toThrow();await expect(ledger.checkpoint(step,Buffer.from('late'))).rejects.toThrow();
    expect((await ledger.finish(lease,'completed')).state).toBe('interrupted');
  });
  it('uses the original accounting month for continuations and settlement after rollover',async()=>{
    const ledger=service();const lease=await admit(ledger);const previous=new Date();previous.setUTCDate(1);previous.setUTCMonth(previous.getUTCMonth()-1);const oldPeriod=previous.toISOString().slice(0,10);
    const oldApp=randomUUID();await db.admin('/rest/v1/usage_buckets','POST',{id:oldApp,scope:'app',period_start:oldPeriod,allocated_ceiling_usd:'1'});
    await db.admin('/rest/v1/usage_buckets','POST',{user_id:a.userId,scope:'account',period_start:oldPeriod,allocated_ceiling_usd:'1'});
    try{
      await db.admin(`/rest/v1/ai_runs?id=eq.${lease.runId}`,'PATCH',{accounting_period:oldPeriod,admitted_at:previous.toISOString()});
      const step=await ledger.prepare(lease,stepInput());await ledger.authorize(step);await ledger.settle(step,normalizeUsage({reportedCostUSD:'0.003',rawUsage:null}),'completed');
      const next=await ledger.prepare(lease,stepInput());await ledger.authorize(next);await ledger.settle(next,normalizeUsage({reportedCostUSD:'0.002',rawUsage:null}),'completed');
      expect((await rows('usage_buckets',`id=eq.${oldApp}`))[0]).toMatchObject({spent_usd:0.005,reserved_usd:0});
      expect((await rows('usage_buckets',`user_id=eq.${a.userId}&period_start=eq.${period()}`))[0]).toMatchObject({spent_usd:0,reserved_usd:0});
      expect(await rows('usage_reservations',`run_id=eq.${lease.runId}&period_start=eq.${oldPeriod}`)).toHaveLength(2);
    }finally{await db.admin(`/rest/v1/usage_reservations?run_id=eq.${lease.runId}`,'DELETE');await db.admin(`/rest/v1/usage_buckets?id=eq.${oldApp}`,'DELETE');}
  });
  it('denies foreign runs, client RPC access, missing consent, and revoked consent before dispatch',async()=>{
    const ledger=service();const lease=await admit(ledger);const step=await ledger.prepare(lease,stepInput());
    await expect(service(b).summary(lease.runId)).rejects.toMatchObject({status:404});await expect(service(b).cancel(lease.runId)).rejects.toMatchObject({status:404});
    for(const token of ['anon',tokenA]){
      const response=await db.request('/rest/v1/rpc/authorize_send_v1',token,{method:'POST',body:JSON.stringify({p_owner:a.userId,p_run:lease.runId,p_executor:lease.executor,p_fence:1,p_step:step.id,p_body_hash:step.bodyHash})});expect([401,403]).toContain(response.status);
    }
    await db.admin(`/rest/v1/profiles?user_id=eq.${a.userId}`,'PATCH',{consent_versions:{}});
    await expect(ledger.authorize(step)).rejects.toMatchObject({status:403});await ledger.settle(step,null,'failed',0,true);
    expect(await account()).toMatchObject({reserved_usd:0,spent_usd:0});
    await ledger.finish(lease,'failed');await expect(admit(ledger)).rejects.toMatchObject({status:403});
  });
  it('rejects a mutated prepared body before invoking transport',async()=>{
    const ledger=service();const lease=await admit(ledger);const step=await ledger.prepare(lease,stepInput());step.body.fill(0);
    const send=vi.fn(async function*(){yield Buffer.from('must not run');});
    await expect(async()=>{for await(const chunk of createDispatcher(ledger,{mode:'mock',send}).send(step,new AbortController().signal))void chunk;}).rejects.toMatchObject({code:'trace_mismatch'});
    expect(send).not.toHaveBeenCalled();expect((await rows('ai_steps',`id=eq.${step.id}`))[0]!.dispatch_state).toBe('prepared');
    await ledger.settle(step,null,'failed',0,true);expect(await account()).toMatchObject({reserved_usd:0});
  });
  it('enforces account, per-run and unknown-price gates independently of app admission',async()=>{
    const ledger=new ExecutionService(a,{maxRunCostUSD:'0.01'});const lease=await admit(ledger);
    await expect(ledger.prepare(lease,stepInput())).rejects.toMatchObject({code:'budget_exhausted'});
    await expect(service().prepare(lease,{...stepInput(),price:{...syntheticPrice,status:'unverified'} as never})).rejects.toThrow();
    await ledger.finish(lease,'failed');
    const next=await admit();await db.admin(`/rest/v1/usage_buckets?user_id=eq.${a.userId}`,'PATCH',{allocated_ceiling_usd:'0.01'});
    await expect(service().prepare(next,stepInput())).rejects.toMatchObject({code:'budget_exhausted'});
    await db.admin(`/rest/v1/usage_buckets?user_id=eq.${a.userId}`,'DELETE');
    await expect(service().prepare(next,stepInput())).rejects.toMatchObject({code:'budget_unconfigured'});
    expect((await rows('usage_buckets',`id=eq.${app}`))[0]).toMatchObject({reserved_usd:0});
  });
  it('enforces the persistent rate limit across fresh service instances',async()=>{
    for(let n=0;n<10;n++){const ledger=service();const lease=await admit(ledger);await ledger.finish(lease,'completed');}
    await expect(service().admit(input(conversationA))).rejects.toMatchObject({code:'run_rate_limited'});
    expect(await rows('ai_runs',`user_id=eq.${a.userId}`)).toHaveLength(10);
  });
  it('enforces model and tool ceilings and persists encrypted read-tool evidence without cost',async()=>{
    const ledger=service();const lease=await admit(ledger);
    for(let n=0;n<4;n++){const step=await ledger.prepare(lease,stepInput());await ledger.authorize(step);await ledger.settle(step,normalizeUsage({reportedCostUSD:'0.001',rawUsage:{synthetic:true}}),'completed');}
    await expect(ledger.prepare(lease,stepInput())).rejects.toMatchObject({code:'run_call_limit'});
    let finalId='';
    for(let n=0;n<6;n++){
      const step=await ledger.prepare(lease,{type:'tool',body:Buffer.from('{"metric":"weight"}'),toolName:'summarize_metric',adapterVersion:'synthetic-tool-v1',metadata:{endpoint:'tool:read',headers:{},redactedHeaders:[]}});
      await ledger.checkpoint(step,Buffer.from('{"value":69.7,"synthetic":true}'));await ledger.settle(step,null,'completed');finalId=step.id;
    }
    await expect(ledger.prepare(lease,{type:'tool',body:Buffer.from('{}'),toolName:'list_metrics',adapterVersion:'v1',metadata:{endpoint:'tool:read',headers:{},redactedHeaders:[]}})).rejects.toMatchObject({code:'run_call_limit'});
    const tool=(await rows('ai_steps',`id=eq.${finalId}`))[0]!;expect(tool).toMatchObject({step_type:'tool',cost_usd:0});
    const saved=await readPayload(a,String(tool.output_payload_id),'tool_output');expect(saved.state).toBe('available');if(saved.state==='available')expect(JSON.parse(saved.bytes.toString()).value).toBe(69.7);
    expect((await ledger.finish(lease,'completed')).costUSD).toBe('0.004');
  });
  it('rechecks a lowered personal spending limit before dispatch and denies raising the account allocation',async()=>{
    const ledger=service();const lease=await admit(ledger);const step=await ledger.prepare(lease,stepInput());const before=await getSettings(a);
    const lowered=await updateSettings(a,{client_request_id:randomUUID(),expected_updated_at:before.profile.updatedAt,changes:{monthly_spending_preference_usd:'0.01'}});
    expect(lowered.budget).toMatchObject({allocationUSD:'1',preferenceUSD:'0.01',reservedUSD:'0.022',availableUSD:'0'});
    await expect(ledger.authorize(step)).rejects.toMatchObject({code:'budget_exhausted'});
    await expect(updateSettings(a,{client_request_id:randomUUID(),expected_updated_at:lowered.profile.updatedAt,changes:{monthly_spending_preference_usd:'2'}})).rejects.toMatchObject({status:400});
    expect((await getSettings(b)).budget).toMatchObject({preferenceUSD:null,reservedUSD:'0'});
    await ledger.settle(step,null,'cancelled',0,true);expect(await account()).toMatchObject({reserved_usd:0,spent_usd:0});
  });
  it('preserves only the durable prefix when trace persistence fails midstream',async()=>{
    const ledger=service();const lease=await admit(ledger);const step=await ledger.prepare(lease,stepInput());const encrypt=encryption.encryptBytes;
    const transport:RequestTransport={mode:'mock',async *send(){yield Buffer.from('saved prefix');vi.spyOn(encryption,'encryptBytes').mockImplementationOnce((...args)=>({...encrypt(...args),key_id:''}));yield Buffer.from(' never emitted');}};
    const chunks:Uint8Array[]=[];await expect(async()=>{for await(const chunk of createDispatcher(ledger,transport).send(step,new AbortController().signal))chunks.push(chunk);}).rejects.toMatchObject({code:'execution_interrupted'});
    expect(Buffer.concat(chunks).toString()).toBe('saved prefix');expect(await ledger.summary(lease.runId)).toMatchObject({state:'failed',traceState:'incomplete',costUSD:null,reservationUSD:'0.022'});
    const stored=(await rows('ai_steps',`id=eq.${step.id}`))[0]!;const saved=await readPayload(a,String(stored.output_payload_id),'ai_response');expect(saved.state).toBe('available');if(saved.state==='available')expect(saved.bytes.toString()).toBe('saved prefix');
  });
  it('deletion removes retained evidence, excludes history, and fences late response writes while permitting billing',async()=>{
    const reading=await addMeasurement(a,{action:'add_measurement',client_request_id:randomUUID(),source:{kind:'new',label:'Synthetic fencing source',origin_app:null,device_label:null},
      observation:{metric:'weight',value:'70',unit:'kg',observed_at:'2026-09-08T08:00:00Z',timezone:'UTC',local_date:null,granularity:'instant',method:'user_reported',quality_flags:[]}});
    const ledger=service();const lease=await admit(ledger);const step=await ledger.prepare(lease,stepInput());await ledger.authorize(step);
    const message=randomUUID();await db.admin('/rest/v1/messages','POST',{id:message,user_id:a.userId,conversation_id:conversationA,run_id:lease.runId,role:'assistant',content_parts:[{type:'text',text:'Synthetic historical answer'}],status:'streaming'});
    await mutateMeasurement(a,{action:'delete_measurement',measurement_id:reading.id,expected_version:reading.version,client_request_id:randomUUID()});
    expect(await rows('private_payloads',`user_id=eq.${a.userId}`)).toEqual([]);expect((await rows('messages',`id=eq.${message}`))[0]!.context_state).toBe('source_removed');
    await expect(ledger.checkpoint(step,Buffer.from('late private content'))).rejects.toMatchObject({code:'run_not_writable'});
    await ledger.settle(step,normalizeUsage({reportedCostUSD:'0.003',rawUsage:{synthetic:true}}),'cancelled');
    expect(await ledger.finish(lease,'completed')).toMatchObject({state:'cancelled',traceState:'removed',costUSD:'0.003'});
    expect(await rows('private_payloads',`user_id=eq.${a.userId}`)).toEqual([]);
  });
  it('account deletion blocks admission and late content without losing known billing',async()=>{
    const ledger=service();const lease=await admit(ledger);const step=await ledger.prepare(lease,stepInput());await ledger.authorize(step);
    await db.admin(`/rest/v1/profiles?user_id=eq.${a.userId}`,'PATCH',{account_state:'deleting'});
    await expect(ledger.checkpoint(step,Buffer.from('late'))).rejects.toThrow();await expect(ledger.admit(input(conversationA))).rejects.toMatchObject({code:'account_unavailable'});
    await ledger.settle(step,normalizeUsage({reportedCostUSD:'0.004',rawUsage:null}),'cancelled');
    expect(await ledger.finish(lease,'completed')).toMatchObject({state:'cancelled',costUSD:'0.004'});
  });
  it('allows exactly one immutable terminal outcome when completion and cancellation race',async()=>{
    const ledger=service();const lease=await admit(ledger);
    await Promise.all([ledger.cancel(lease.runId),ledger.finish(lease,'completed')]);
    const state=(await ledger.summary(lease.runId)).state;expect(['completed','cancelled']).toContain(state);
    expect((await ledger.finish(lease,'failed')).state).toBe(state);expect((await ledger.cancel(lease.runId)).state).toBe(state);
  });
  it('retains core messages and replay receipts when execution metadata expires',async()=>{
    const ledger=service();const lease=await admit(ledger);await ledger.finish(lease,'completed');const message=randomUUID();const key=randomUUID();
    await db.admin('/rest/v1/messages','POST',{id:message,user_id:a.userId,conversation_id:conversationA,run_id:lease.runId,role:'user',content_parts:[{type:'text',text:'Synthetic retained history'}],status:'completed',client_request_id:key,request_hash:requestHash('synthetic')});
    await db.admin(`/rest/v1/ai_runs?id=eq.${lease.runId}`,'PATCH',{expires_at:new Date(Date.now()-1000).toISOString()});await ledger.reconcile();
    expect(await rows('ai_runs',`id=eq.${lease.runId}`)).toEqual([]);expect((await rows('messages',`id=eq.${message}`))[0]).toMatchObject({run_id:null,client_request_id:key});
    expect(await rows('conversations',`id=eq.${conversationA}`)).toHaveLength(1);await expect(ledger.summary(lease.runId)).rejects.toMatchObject({status:404});
  });
  it('commits completion metadata once with settlement and keeps late cancelled metadata fenced',async()=>{
    const ledger=service();const lease=await admit(ledger);const step=await ledger.prepare(lease,stepInput());
    await ledger.authorize(step);await ledger.checkpoint(step,Buffer.from('Synthetic observable response'));
    const usage=normalizeUsage({reportedCostUSD:'0.001',rawUsage:{synthetic:true}});
    const completion={finishReason:'stop' as const,providerRequestId:'synthetic-response',effectiveModel:'synthetic/model',effectiveEffort:null};
    await ledger.settle(step,usage,'completed',0,false,completion);await ledger.settle(step,usage,'completed',0,false,completion);
    await expect(ledger.settle(step,usage,'completed',0,false,{...completion,providerRequestId:'changed'})).rejects.toMatchObject({status:409});
    expect((await rows('ai_steps',`id=eq.${step.id}`))[0]).toMatchObject({finish_reason:'stop',provider_request_id:'synthetic-response',effective_model_id:'synthetic/model',effective_effort:null});
    await ledger.finish(lease,'completed');
    const next=await admit(ledger);const late=await ledger.prepare(next,stepInput());await ledger.authorize(late);await ledger.checkpoint(late,Buffer.from('Synthetic late response'));
    await ledger.cancel(next.runId);await ledger.settle(late,usage,'completed',0,false,completion);
    expect((await rows('ai_steps',`id=eq.${late.id}`))[0]).toMatchObject({finish_reason:null,provider_request_id:null,effective_model_id:null});
    const denied=await db.request('/rest/v1/rpc/record_step_completion_v1',tokenA,{method:'POST',body:JSON.stringify({p_owner:a.userId,p_run:next.runId,p_executor:next.executor,p_fence:next.fence,p_step:late.id,p_completion:completion})});
    expect([401,403,404]).toContain(denied.status);
  });
  it('fails closed on rejected completion evidence without releasing unknown spend',async()=>{
    const ledger=service();const lease=await admit(ledger);const step=await ledger.prepare(lease,stepInput());
    await ledger.authorize(step);await ledger.checkpoint(step,Buffer.from('Synthetic response with unknown usage'));
    const stale={...step,lease:{...lease,fence:lease.fence+1}};
    await expect(ledger.settle(stale,null,'completed',0,false,{finishReason:'stop',providerRequestId:'synthetic-response',effectiveModel:null,effectiveEffort:null})).rejects.toMatchObject({code:'trace_incomplete'});
    const run=await ledger.summary(lease.runId);expect(run).toMatchObject({state:'failed',traceState:'incomplete',costStatus:'pending',costUSD:null});
    expect(Number(run.reservationUSD)).toBeGreaterThan(0);expect((await account()).spent_usd).toBe(0);
    expect((await rows('ai_steps',`id=eq.${step.id}`))[0]).toMatchObject({finish_reason:null,provider_request_id:null});
  });
  it('binds one serialized provider invocation to the run without exposing ledger authority to the adapter',async()=>{
    const ledger=service();const lease=await admit(ledger);const captured:PreparedStep[]=[];let calls=0;
    const dispatcher=createDispatcher(ledger,{mode:'mock',async *send(){calls++;yield Buffer.from('synthetic');}});
    const bound=dispatcher.bind(lease,{provider:'openrouter',model:'openai/gpt-6-luna',price:syntheticPrice},step=>captured.push(step));
    const descriptor=stepInput();for await(const chunk of bound.send(descriptor,new AbortController().signal))expect(chunk.length).toBeGreaterThan(0);
    expect(captured).toHaveLength(1);await ledger.settle(captured[0]!,normalizeUsage({reportedCostUSD:'0.001',rawUsage:null}),'completed');
    await expect(async()=>{for await(const chunk of bound.send(descriptor,new AbortController().signal))void chunk;}).rejects.toMatchObject({code:'dispatch_already_used'});
    expect(calls).toBe(1);await ledger.finish(lease,'completed');
  });
  it('rejects unreadable persisted request evidence before transport and retains a releasable unsent reservation',async()=>{
    const ledger=service();const lease=await admit(ledger);const step=await ledger.prepare(lease,stepInput());
    const row=(await rows('ai_steps',`id=eq.${step.id}`))[0]!;await db.admin(`/rest/v1/private_payloads?id=eq.${row.input_payload_id}`,'PATCH',{encrypted_bytes:'\\x'+'00'.repeat(32)});
    const send=vi.fn(async function*(){yield Buffer.from('never');});
    await expect(async()=>{for await(const chunk of createDispatcher(ledger,{mode:'mock',send}).send(step,new AbortController().signal))void chunk;}).rejects.toMatchObject({code:'trace_unavailable'});
    expect(send).not.toHaveBeenCalled();await ledger.settle(step,null,'failed',0,true);expect(await account()).toMatchObject({spent_usd:0,reserved_usd:0});
  });
  it('records a provider overcharge fully and blocks further use of the violated route bound',async()=>{
    const ledger=service();const model='synthetic-overcharge-active';const request=input(conversationA);
    try {
      const admission=await ledger.admit({...request,route:{...request.route,model}});const lease=admission.lease!;const descriptor={...stepInput(),model};
      const step=await ledger.prepare(lease,descriptor);await ledger.authorize(step);
      await ledger.settle(step,normalizeUsage({reportedCostUSD:'0.03',rawUsage:null}),'completed');expect(await account()).toMatchObject({spent_usd:0.03,reserved_usd:0});
      expect((await rows('ai_steps',`id=eq.${step.id}`))[0]!.cost_bound_state).toBe('exceeded');
      await expect(ledger.prepare(lease,descriptor)).rejects.toMatchObject({code:'cost_bound_exceeded'});await ledger.finish(lease,'completed');
    } finally {clearSyntheticRoute(model);}
  });
  it('retains a violated route block after execution metadata expires',async()=>{
    const model='synthetic-route-bound';const ledger=service();const request=input(conversationA);
    try {
      const admission=await ledger.admit({...request,route:{...request.route,model}});expect(admission.lease).not.toBeNull();const lease=admission.lease!;
      const descriptor={...stepInput(),model};const step=await ledger.prepare(lease,descriptor);await ledger.authorize(step);
      await ledger.settle(step,normalizeUsage({reportedCostUSD:'0.03',rawUsage:null}),'completed');await ledger.finish(lease,'completed');
      await db.admin(`/rest/v1/ai_runs?id=eq.${lease.runId}`,'PATCH',{expires_at:new Date(Date.now()-1000).toISOString()});await ledger.reconcile();
      expect(await rows('ai_steps',`run_id=eq.${lease.runId}`)).toEqual([]);
      const next=await ledger.admit({...input(conversationA),route:{...request.route,model}});expect(next.lease).not.toBeNull();
      await expect(ledger.prepare(next.lease!,descriptor)).rejects.toMatchObject({code:'cost_bound_exceeded'});
    } finally {
      // Test-only cleanup for this fixed synthetic route; never clears real routes.
      clearSyntheticRoute(model);
    }
  });
  it('rejects dispatch of an already prepared request once another account violates the route bound',async()=>{
    const model='synthetic-route-race';const first=service();const second=service(b);const ra=input(conversationA);const rb=input(conversationB);
    try {
      const aRun=await first.admit({...ra,route:{...ra.route,model}});const bRun=await second.admit({...rb,route:{...rb.route,model}});
      const descriptor={...stepInput(),model};const aStep=await first.prepare(aRun.lease!,descriptor);const bStep=await second.prepare(bRun.lease!,descriptor);
      await second.authorize(bStep);await second.settle(bStep,normalizeUsage({reportedCostUSD:'0.03',rawUsage:null}),'completed');await second.finish(bRun.lease!,'completed');
      await expect(first.authorize(aStep)).rejects.toMatchObject({code:'cost_bound_exceeded'});
      await first.settle(aStep,null,'failed',0,true);await first.finish(aRun.lease!,'failed');
    } finally {clearSyntheticRoute(model);}
  });
  it('closes an abandoned consumer with a durable cancelled run and uncertain-cost hold',async()=>{
    const ledger=service();const lease=await admit(ledger);const step=await ledger.prepare(lease,stepInput());const signals:AbortSignal[]=[];
    const dispatcher=createDispatcher(ledger,{mode:'mock',async *send(_body,signal){signals.push(signal);yield Buffer.from('first prefix');yield Buffer.from('not consumed');}});
    for await(const chunk of dispatcher.send(step,new AbortController().signal)){expect(chunk.length).toBeGreaterThan(0);break;}
    expect(signals[0]?.aborted).toBe(true);expect(await ledger.summary(lease.runId)).toMatchObject({state:'cancelled',costUSD:null,reservationUSD:'0.022'});
  });
  it('marks run token totals unknown while a newly reserved continuation has no usage',async()=>{
    const ledger=service();const lease=await admit(ledger);const first=await ledger.prepare(lease,stepInput());await ledger.authorize(first);
    const usage=normalizeUsage({inputTokens:20,outputTokens:10,reasoningTokens:4,reasoningIsOutputSubset:true,cacheReadTokens:5,cacheReadIsInputSubset:true,cacheWriteTokens:0,rawUsage:{synthetic:true}});
    await ledger.settle(first,usage,'completed');expect((await rows('ai_runs',`id=eq.${lease.runId}`))[0]).toMatchObject({input_tokens:20,output_tokens:10});
    const next=await ledger.prepare(lease,stepInput());expect((await rows('ai_runs',`id=eq.${lease.runId}`))[0]).toMatchObject({input_tokens:null,output_tokens:null});
    await ledger.settle(next,null,'cancelled',0,true);await ledger.finish(lease,'cancelled');
  });
  it('shows an existing bucket preference when the standing profile preference is unset',async()=>{
    await db.admin(`/rest/v1/usage_buckets?user_id=eq.${a.userId}`,'PATCH',{lower_preference_usd:'0.01'});
    expect((await getSettings(a)).budget).toMatchObject({preferenceUSD:'0.01',availableUSD:'0.01',allocationUSD:'1'});
  });
});

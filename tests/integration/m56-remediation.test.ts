import {randomBytes,randomUUID} from 'node:crypto';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {spawnSync} from 'node:child_process';
import {beforeEach,afterEach,it,expect,vi} from 'vitest';
import {LocalSupabase} from '../helpers/local-supabase.js';
import {localStatus,projectId} from '../../scripts/local-database.js';
import {verifySession,type AuthContext} from '../../server/auth/session.js';
import {VulpesAgent} from '../../server/ai/VulpesAgent.js';
import {VertexGenerationAdapter,vertexEndpoint} from '../../server/ai/providers/vertex.js';
import {ConversationService} from '../../server/services/conversations.js';
import {ExecutionService,requestHash} from '../../server/ai/ledger/execution.js';
import {createDispatcher} from '../../server/ai/ledger/dispatcher.js';
import {syntheticPrice} from '../fixtures/executions.js';
import {localRouter} from '../../server/http/router.js';
import {writePayload,readPayload} from '../../server/security/private-payloads.js';
import {issueVertexVerificationTransport} from '../../server/ai/providers/vertex-verification.js';
import * as vertexReadiness from '../../server/ai/vertex-readiness.js';
import * as vertexAuth from '../../server/ai/providers/vertex-auth.js';
import {verificationFixtureHash} from '../../server/ai/verification-fixture.js';

let db:LocalSupabase,context:AuthContext,token:string,app:string;
let verificationBatch:string|undefined;
const policy='synthetic-google-review-v1';
beforeEach(async()=>{
 verificationBatch=undefined;
 const s=localStatus();vi.stubEnv('VITE_SUPABASE_URL',s.apiUrl);vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY',s.anonKey);vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY',s.adminKey);
 vi.stubEnv('VULPES_TRACE_ENCRYPTION_KEY_ID','synthetic-review');vi.stubEnv('VULPES_TRACE_ENCRYPTION_KEY_B64',randomBytes(32).toString('base64'));
 db=new LocalSupabase();const u=await db.createUser();token=u.token;app=randomUUID();const now=new Date().toISOString();const period=now.slice(0,7)+'-01';
 await db.admin('/rest/v1/profiles','POST',{user_id:u.id,consent_versions:{openrouter:{accepted_version:'openrouter_zdr_v1',accepted_at:now},vertex_ai:{accepted_version:policy,accepted_at:now}}});
 await db.admin('/rest/v1/usage_buckets','POST',{id:app,scope:'app',period_start:period,allocated_ceiling_usd:'10'});
 await db.admin('/rest/v1/usage_buckets','POST',{user_id:u.id,scope:'account',period_start:period,allocated_ceiling_usd:'1'});
 await db.admin('/rest/v1/vertex_policy_approval','POST',{id:true,policy_version:policy,project:'synthetic-project',location:'us',privacy_fingerprint:'a'.repeat(64),notice:'Synthetic review only'});
 context=await verifySession({headers:{authorization:`Bearer ${token}`}});
});

it('stores exact ledger and staging payloads under one second of application clock lead',async()=>{
 const ledger=new ExecutionService(context,{maxRunCostUSD:'0.25'});
 const admitted=await ledger.admit({conversationId:await conversation(),clientRequestId:randomUUID(),requestHash:requestHash('synthetic clock skew'),depth:'auto',route:{role:'everyday',provider:'openrouter',model:'openai/gpt-6-luna',effort:'low'},consentVersion:'openrouter_zdr_v1'});
 if(!admitted.lease)throw new Error('missing lease');
 const nativeNow=Date.now.bind(Date),nativeFetch=globalThis.fetch;const errors:string[]=[];
 vi.spyOn(Date,'now').mockImplementation(()=>nativeNow()+1000);
 vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{const r=await nativeFetch(input,init);if(!r.ok&&String(input).includes('/rpc/')){const value=await r.clone().json();errors.push(value.message);}return r;});
 try{
  const bytes=Buffer.from('{"synthetic":"clock"}');
  const prepared=await ledger.prepare(admitted.lease,{type:'generation',provider:'openrouter',model:'openai/gpt-6-luna',body:bytes,adapterVersion:'synthetic-clock',price:syntheticPrice,metadata:{endpoint:'https://openrouter.ai/api/v1/responses',headers:{},redactedHeaders:[]}});
  expect(prepared.body.equals(bytes)).toBe(true);
  const staged=await writePayload(context,'import_staging',bytes);
  const stored=await readPayload(context,staged.id,'import_staging');
  expect(stored.state).toBe('available');if(stored.state==='available')expect(stored.bytes.equals(bytes)).toBe(true);
  expect(errors).toEqual([]);
 }finally{vi.restoreAllMocks();}
});
afterEach(async()=>{try{if(verificationBatch)expect(spawnSync('docker',['exec',`supabase_db_${projectId}`,'psql','-U','postgres','-d','postgres','-c',`delete from public.live_verification_allocations where id='${verificationBatch}'::uuid`],{encoding:'utf8'}).status).toBe(0);await db.cleanup();await db.admin(`/rest/v1/usage_buckets?id=eq.${app}`,'DELETE');await db.admin('/rest/v1/vertex_policy_approval?id=eq.true','DELETE');}finally{vi.restoreAllMocks();vi.unstubAllEnvs();}});
async function conversation(){const id=randomUUID();await new ConversationService(context).mutate({action:'create',id,client_request_id:randomUUID()});return id;}

it('rechecks the issued transport policy after asynchronous credential acquisition',async()=>{
 await db.admin(`/rest/v1/profiles?user_id=eq.${context.userId}`,'PATCH',{display_name:'Synthetic verification'});
 const buckets=await(await db.admin(`/rest/v1/usage_buckets?user_id=eq.${context.userId}&scope=eq.account`,'GET')).json();
 const batch=randomUUID();verificationBatch=batch;await db.admin('/rest/v1/live_verification_allocations','POST',{id:batch,user_id:context.userId,account_bucket_id:buckets[0].id,period_start:new Date().toISOString().slice(0,7)+'-01',ceiling_usd:'1',data_revision:0,fixture_hash:verificationFixtureHash});
 vi.spyOn(vertexReadiness,'assessVertex').mockReturnValue({state:'ready',price:syntheticPrice,evidence:{model:'gemini-3.8-flash',effort:'MEDIUM',project:'synthetic-project',location:'us',policyVersion:policy,privacyFingerprint:'a'.repeat(64),adapterVersion:'synthetic',templateVersion:'synthetic',priceHash:'b'.repeat(64),checkedAt:new Date().toISOString(),streaming:true,tools:true,inputBoundTokens:24000,outputBoundTokens:8192}});
 const credential=vi.fn(async()=>{await db.admin('/rest/v1/vertex_policy_approval?id=eq.true','PATCH',{location:'eu'});return 'synthetic-token';});
 vi.spyOn(vertexAuth,'vertexAuthentication').mockReturnValue(credential);
 const send=vi.fn<typeof fetch>();
 const transport=await issueVertexVerificationTransport('intermediate',context,batch,'1',verificationFixtureHash,true,{VULPES_LIVE_AI_ENABLED:'true',VITE_SUPABASE_URL:process.env.VITE_SUPABASE_URL,GOOGLE_CLOUD_PROJECT:'synthetic-project',GOOGLE_CLOUD_LOCATION:'us'},send);
 await expect(async()=>{for await(const bytes of transport.send(Buffer.from('{"synthetic":true}'),new AbortController().signal))void bytes;}).rejects.toThrow('vertex_policy_unavailable');
 expect(credential).toHaveBeenCalledOnce();expect(send).not.toHaveBeenCalled();
});

it.each(['intermediate','advanced'] as const)('admits the %s backend verification role with its actual accepted Google policy',async role=>{
 let sends=0;const agent=new VulpesAgent(context,{verificationRole:role,adapter:new VertexGenerationAdapter(role,vertexEndpoint('synthetic-project','us',role)),transport:{mode:'mock',async *send(){sends++;yield Buffer.from('synthetic');}},price:syntheticPrice,maxRunCostUSD:'0.25'});
 let outcome:unknown;try{const admitted=await agent.admit({action:'send',conversation_id:await conversation(),client_request_id:randomUUID(),message:{id:randomUUID(),text:'Summarize the synthetic measurements.'},depth:'auto',context_selection:null});outcome=admitted.result.kind;}catch(error){outcome={code:(error as {code?:string}).code};}
 expect(sends).toBe(0);expect(outcome).toBe('admitted');
});

it.each([{project:'different-synthetic-project'},{location:'eu'},{privacy_fingerprint:'b'.repeat(64)},{notice:'Changed synthetic privacy notice'}])('denies dispatch after the approved Vertex binding changes: %j',async change=>{
 const ledger=new ExecutionService(context,{maxRunCostUSD:'0.25'});
 const admitted=await ledger.admit({conversationId:await conversation(),clientRequestId:randomUUID(),requestHash:requestHash('synthetic policy drift'),depth:'auto',route:{role:'intermediate',provider:'vertex_ai',model:'gemini-3.8-flash',effort:'MEDIUM'},consentVersion:policy});
 if(!admitted.lease)throw new Error('missing lease');
 const prepared=await ledger.prepare(admitted.lease,{type:'generation',provider:'vertex_ai',model:'gemini-3.8-flash',body:Buffer.from('{"synthetic":"private"}'),adapterVersion:'vertex-generate-content-v1',price:syntheticPrice,metadata:{endpoint:vertexEndpoint('synthetic-project','us','intermediate'),headers:{'Content-Type':'application/json'},redactedHeaders:['authorization']}});
 await db.admin('/rest/v1/vertex_policy_approval?id=eq.true','PATCH',change);
 let sends=0;let denied=false;
 try{for await(const bytes of createDispatcher(ledger,{mode:'mock',async *send(){sends++;yield Buffer.from('synthetic response');}}).send(prepared,new AbortController().signal))void bytes;}catch{denied=true;}
 expect({denied,sends}).toEqual({denied:true,sends:0});
});

it('does not export an expired pending proposal body before physical retention cleanup',async()=>{
 const server=createServer(localRouter);server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error('missing address');
 try{
  const source=randomUUID();await db.admin('/rest/v1/data_sources','POST',{id:source,user_id:context.userId,kind:'manual',label:'Synthetic review source',source_namespace:randomUUID()});
  const proposed=await fetch(`http://127.0.0.1:${address.port}/api/goals`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({action:'propose_create',client_request_id:randomUUID(),definition:{schemaVersion:1,title:'Synthetic expired draft',metric:'weight',unit:'kg',sourceId:source,target:{direction:'decrease_to',value:68},baselineMethod:'user_reported',reportedBaseline:70,baselineFrom:'2026-10-01T00:00:00Z',baselineTo:'2026-10-08T00:00:00Z',currentMethod:'latest_value',method:'device_reported',granularity:'instant',timezone:'UTC',targetDate:null,constraints:['expired-draft-marker'],proposedStrategy:null}})});
  expect(proposed.status).toBe(200);const proposal=(await proposed.json()).data.id;
  await db.admin(`/rest/v1/action_proposals?id=eq.${proposal}`,'PATCH',{created_at:new Date(Date.now()-2*86400_000).toISOString(),expires_at:new Date(Date.now()-86400_000).toISOString()});
  const direct=await db.request(`/rest/v1/action_proposals?id=eq.${proposal}`,token);
  expect(direct.status).toBe(200);expect(await direct.json()).toEqual([]);
  const response=await fetch(`http://127.0.0.1:${address.port}/api/account`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify({action:'export',trace_parts:[],sensitive_content_acknowledged:false})});
  expect(response.status).toBe(200);const result=await response.json();const row=result.sections.action_proposals.find((p:{id:string})=>p.id===proposal);
  expect({state:row?.state,body:row?.canonical_payload}).toEqual({state:'expired',body:null});
 }finally{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));}
});

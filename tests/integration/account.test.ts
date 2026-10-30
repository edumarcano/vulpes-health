import {createServer} from 'node:http';
import {once} from 'node:events';
import {spawnSync} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {afterAll,beforeAll,expect,it,vi} from 'vitest';
import {LocalSupabase} from '../helpers/local-supabase.js';
import {localStatus} from '../../scripts/local-database.js';
import {localRouter} from '../../server/http/router.js';
import {verifyIdentity,verifySession} from '../../server/auth/session.js';
import {exportAccount} from '../../server/services/account-export.js';
import {AccountStatusSchema} from '../../shared/account.js';
import {ExecutionService,requestHash,type RunLease} from '../../server/ai/ledger/execution.js';
import {syntheticPrice} from '../fixtures/executions.js';
import {normalizeUsage} from '../../server/ai/contracts.js';
import {writePayload} from '../../server/security/private-payloads.js';
import {createDispatcher} from '../../server/ai/ledger/dispatcher.js';
import {z} from 'zod';

const server=createServer(localRouter);let origin:string;let db:LocalSupabase;
type User=Awaited<ReturnType<LocalSupabase['createUser']>>;
let a:User,b:User;
async function request(user:User|null,body?:unknown){return fetch(origin+'/api/account',{method:body?'POST':'GET',headers:{...(user?{Authorization:`Bearer ${user.token}`} : {}),'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});}
async function status(user:User){const response=await request(user);expect(response.status).toBe(200);return AccountStatusSchema.parse((await response.json()).data);}
async function rows(table:string,user:string){return await(await db.admin(`/rest/v1/${table}?user_id=eq.${user}`,'GET')).json() as Record<string,unknown>[];}
async function provision(){const user=await db.createUser();await db.admin('/rest/v1/profiles','POST',{user_id:user.id,display_name:'Synthetic lifecycle',consent_versions:{openrouter:{accepted_version:'openrouter_zdr_v1',accepted_at:new Date().toISOString()}}});return user;}
beforeAll(async()=>{
 const config=localStatus();vi.stubEnv('VITE_SUPABASE_URL',config.apiUrl);vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY',config.anonKey);vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY',config.adminKey);
 vi.stubEnv('VULPES_TRACE_ENCRYPTION_KEY_ID','synthetic-account');vi.stubEnv('VULPES_TRACE_ENCRYPTION_KEY_B64',randomBytes(32).toString('base64'));
 db=new LocalSupabase();a=await db.createUser();b=await db.createUser();await db.seed(a.id);await db.seed(b.id);
 server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address||typeof address==='string')throw new Error();origin=`http://127.0.0.1:${address.port}`;
});
afterAll(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));try{await db.cleanup();}finally{vi.unstubAllEnvs();vi.restoreAllMocks();}});

it('requires verified identity, strict scoped requests and fresh password authentication',async()=>{
 expect((await request(null)).status).toBe(401);expect((await request({...a,token:'forged'})).status).toBe(401);
 const rewritten=await fetch(origin+'/api/settings?__vulpes_account=1',{headers:{Authorization:`Bearer ${a.token}`}});expect(rewritten.status).toBe(200);expect((await rewritten.json()).data).toEqual({state:'active'});
 expect((await fetch(origin+`/api/account?user_id=${b.id}`,{headers:{Authorization:`Bearer ${a.token}`}})).status).toBe(400);
 for(const body of [{action:'export',trace_parts:[],sensitive_content_acknowledged:false,user_id:b.id},{action:'export',trace_parts:['input'],sensitive_content_acknowledged:false},{action:'delete',confirmation:true},{action:'continue_delete',user_id:b.id}])expect((await request(a,body)).status).toBe(400);
 const identity=await verifyIdentity({headers:{authorization:`Bearer ${a.token}`}});expect(identity.passwordAt).not.toBeNull();
 const now=Date.now;vi.spyOn(Date,'now').mockReturnValue(now()+301_000);
 try{expect((await request(a,{action:'delete',confirmation:'DELETE MY VULPES ACCOUNT'})).status).toBe(403);}finally{vi.restoreAllMocks();}
 expect(await status(a)).toEqual({state:'active'});
 for(const rpc of ['begin_account_deletion_v1','continue_account_deletion_v1','account_status_v1','account_export_manifest_v1']){
  const response=await db.request('/rest/v1/rpc/'+rpc,a.token,{method:'POST',body:JSON.stringify({p_owner:b.id})});expect(response.ok).toBe(false);
 }
});

it('a real Auth token refresh preserves aged password authentication and cannot authorize deletion',async()=>{
 const signed=await db.request('/auth/v1/token?grant_type=password','anon',{method:'POST',body:JSON.stringify({email:a.email,password:a.password})});expect(signed.ok).toBe(true);
 const session=await signed.json();const claims=JSON.parse(Buffer.from(session.access_token.split('.')[1],'base64url').toString());const sessionId=z.uuid().parse(claims.session_id);
 // Simulate six minutes of password-authentication age in this disposable Auth store.
 const aged=spawnSync('docker',['exec','supabase_db_vulpes-health-pr03-test','psql','-U','supabase_admin','-d','postgres','-v','ON_ERROR_STOP=1','-c',`update auth.mfa_amr_claims set created_at=clock_timestamp()-interval '6 minutes',updated_at=clock_timestamp()-interval '6 minutes' where session_id='${sessionId}'`],{encoding:'utf8'});expect(aged.status).toBe(0);
 const refreshed=await db.request('/auth/v1/token?grant_type=refresh_token','anon',{method:'POST',body:JSON.stringify({refresh_token:session.refresh_token})});expect(refreshed.ok).toBe(true);const next=await refreshed.json();
 const identity=await verifyIdentity({headers:{authorization:`Bearer ${next.access_token}`}});expect(identity.passwordAt).not.toBeNull();expect(Date.now()-Date.parse(identity.passwordAt!)).toBeGreaterThan(300_000);
 expect((await request({...a,token:next.access_token},{action:'delete',confirmation:'DELETE MY VULPES ACCOUNT'})).status).toBe(403);expect(await status(a)).toEqual({state:'active'});
});

it('rolls back an injected database purge failure and resumes the committed deletion fence',async()=>{
 const user=await db.createUser();const graph=await db.seed(user.id);expect((await request(user,{action:'delete',confirmation:'DELETE MY VULPES ACCOUNT'})).status).toBe(200);
 const owner=z.uuid().parse(user.id);
 const sql=(statement:string)=>spawnSync('docker',['exec','supabase_db_vulpes-health-pr03-test','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-c',statement],{encoding:'utf8'}).status;
 expect(sql(`begin;create function public.pr16_synthetic_purge_fault() returns trigger language plpgsql as $$ begin if old.user_id='${owner}'::uuid then raise exception 'synthetic_purge_fault'; end if;return old;end;$$;create trigger pr16_synthetic_purge_fault before delete on public.private_payloads for each row execute function public.pr16_synthetic_purge_fault();commit;`)).toBe(0);
 try{
  expect((await request(user,{action:'continue_delete'})).status).toBe(503);expect(await status(user)).toMatchObject({phase:'fenced'});expect((await rows('private_payloads',user.id)).map(row=>row.id)).toContain(graph.ids.private_payloads);
 }finally{expect(sql('drop trigger if exists pr16_synthetic_purge_fault on public.private_payloads;drop function if exists public.pr16_synthetic_purge_fault();')).toBe(0);}
 expect((await request(user,{action:'continue_delete'})).status).toBe(200);expect(await rows('private_payloads',user.id)).toEqual([]);
});

it('exports more than the API row limit with exact decimals, complete inventory and content integrity',async()=>{
 const source=(await rows('data_sources',a.id))[0]!;
 const data=Array.from({length:1005},(_,i)=>({id:randomUUID(),user_id:a.id,source_id:source.id,metric_key:'weight',canonical_value:'70.12345678901234567890123456789',canonical_unit:'kg',original_value:'70.12345678901234567890123456789',original_unit:'kg',observed_at:new Date(Date.UTC(2026,0,1,0,i)).toISOString(),granularity:'instant',fingerprint:createHash('sha256').update('account-'+i).digest('hex')}));
 for(let i=0;i<data.length;i+=100)await db.admin('/rest/v1/measurements','POST',data.slice(i,i+100));
 const context=await verifySession({headers:{authorization:`Bearer ${a.token}`}});const stagedBytes=Buffer.from('{"schema_version":1,"synthetic_uncommitted":true}');const staged=await writePayload(context,'import_staging',stagedBytes);
 const response=await request(a,{action:'export',trace_parts:[],sensitive_content_acknowledged:false});expect(response.status).toBe(200);expect(response.headers.get('cache-control')).toBe('no-store');expect(response.headers.get('content-disposition')).toContain('vulpes-account-v1.json');
 const document=await response.json();expect(document.ownerId).toBe(a.id);expect(document.sections.measurements).toHaveLength(1006);expect(document.inventory.measurements.count).toBe(1006);
 expect(document.sections.account_identity).toMatchObject([{id:a.id,email:a.email}]);
 expect(document.sections.measurements.filter((row:Record<string,unknown>)=>row.canonical_value==='70.12345678901234567890123456789')).toHaveLength(1005);
 expect(Object.keys(document.sections)).toHaveLength(18);
 expect(document.sections.staging.find((row:{id:string})=>row.id===staged.id)).toMatchObject({state:'available',encoding:'base64',bytes:stagedBytes.toString('base64')});
 for(const [name,value] of Object.entries(document.sections)){
  const records=value as unknown[];expect(document.integrity[name]).toEqual({count:records.length,sha256:createHash('sha256').update(records.map(row=>JSON.stringify(row)+'\n').join('')).digest('hex')});
 }
 const text=JSON.stringify(document);expect(text).not.toContain(b.id);expect(text).not.toContain('executor_hash');expect(text).not.toContain('continuation_payload_id');expect(text).not.toContain('_settings_last_write');expect(text).not.toContain('encrypted_password');expect(text).not.toContain('refresh_token');expect(text).not.toContain(a.token);expect(text).not.toContain(a.password);
},60_000);

it('detects concurrent settings mutation before sending the encrypted artifact and cleans it on abort',async()=>{
 const context=await verifySession({headers:{authorization:`Bearer ${b.token}`}});
 const exported=await exportAccount(context,{action:'export',trace_parts:[],sensitive_content_acknowledged:false},new AbortController().signal);
 try{
  await db.admin(`/rest/v1/profiles?user_id=eq.${b.id}`,'PATCH',{display_name:'Changed during capture'});
  await expect(exported.validate()).rejects.toMatchObject({status:409});
 }finally{await exported.cleanup();}
 const abort=new AbortController();abort.abort();await expect(exportAccount(context,{action:'export',trace_parts:[],sensitive_content_acknowledged:false},abort.signal)).rejects.toThrow();
 const realFetch=globalThis.fetch;let mutated=false;const transport=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
  const response=await realFetch(input,init);
  if(!mutated && String(input).includes('/rpc/read_account_export_v1')){mutated=true;await db.admin(`/rest/v1/profiles?user_id=eq.${b.id}`,'PATCH',{display_name:'Changed during HTTP export'});}
  return response;
 });
 try{const response=await request(b,{action:'export',trace_parts:[],sensitive_content_acknowledged:false});expect(response.status).toBe(409);expect(response.headers.get('content-disposition')).toBeNull();expect((await response.json()).error).toBeDefined();}finally{transport.mockRestore();}
});

it('propagates export cancellation to an in-flight inspector database read',async()=>{
 const context=await verifySession({headers:{authorization:`Bearer ${b.token}`}});const controller=new AbortController();const nativeFetch=globalThis.fetch;
 let release!:()=>void;let reached!:()=>void;let readSignal:AbortSignal|undefined;const gate=new Promise<void>(resolve=>{release=resolve;});const started=new Promise<void>(resolve=>{reached=resolve;});let captured=false;
 const transport=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
  if(!captured && new URL(String(input)).pathname==='/rest/v1/ai_steps'){
   captured=true;readSignal=init?.signal??undefined;reached();
   await Promise.race([gate,new Promise<void>((_,reject)=>{readSignal?.addEventListener('abort',()=>reject(readSignal!.reason),{once:true});})]);
  }
  return nativeFetch(input,init);
 });
 const pending=exportAccount(context,{action:'export',trace_parts:['input'],sensitive_content_acknowledged:true},controller.signal);const rejected=expect(pending).rejects.toThrow();
 try{await started;controller.abort();expect(readSignal?.aborted).toBe(true);}
 finally{release();await rejected;transport.mockRestore();}
});

it('resumes bounded private purges across repeated/concurrent requests and survives Auth failure after profile removal',async()=>{
 const beforeForeign=await rows('measurements',b.id);
 const confirmation={action:'delete',confirmation:'DELETE MY VULPES ACCOUNT'};
 const initial=await Promise.all([request(a,confirmation),request(a,confirmation)]);expect(initial.map(r=>r.status)).toEqual([200,200]);
 expect(await status(a)).toMatchObject({state:'deleting',phase:'fenced'});
 expect((await fetch(origin+'/api/settings',{headers:{Authorization:`Bearer ${a.token}`}})).status).toBe(403);
 expect(await(await db.request(`/rest/v1/measurements?user_id=eq.${a.id}`,a.token)).json()).toEqual([]);
 expect((await request(a,{action:'export',trace_parts:[],sensitive_content_acknowledged:false})).status).toBe(403);
 const concurrent=await Promise.all(Array.from({length:4},()=>request(a,{action:'continue_delete'})));
 expect(concurrent.map(response=>response.status)).toEqual([200,200,200,200]);
 const checkpoints=await Promise.all(concurrent.map(response=>response.json()));expect(new Set(checkpoints.map(value=>value.data.receiptId)).size).toBe(1);
 expect(await rows('measurements',b.id)).toEqual(beforeForeign);
 const realFetch=globalThis.fetch;const blocked=vi.spyOn(globalThis,'fetch').mockImplementation((input,init)=>{
  const url=String(input);return url.includes(`/auth/v1/admin/users/${a.id}`)?Promise.resolve(new Response(JSON.stringify({code:'unexpected_failure',msg:'Synthetic Auth outage'}),{status:503,headers:{'Content-Type':'application/json'}})):realFetch(input,init);
 });
 const phases=new Set<string>();
 try{
  for(let i=0;i<100;i++){
   const response=await request(a,{action:'continue_delete'});expect(response.status).toBe(200);const current=AccountStatusSchema.parse((await response.json()).data);if(current.state!=='deleting')throw new Error();phases.add(current.phase);
   // A fresh GET, without a process-local job, recovers the committed checkpoint.
   expect((await status(a)).state).toBe('deleting');
   if(current.phase==='auth_removal_pending'){expect(current.outcome).toBe('auth_unavailable');break;}
  }
  expect([...phases]).toEqual(expect.arrayContaining(['fenced','private_content_purged','awaiting_settlement','app_data_purged','auth_removal_pending']));
  expect(await rows('profiles',a.id)).toEqual([]);expect(await rows('private_payloads',a.id)).toEqual([]);expect(await rows('measurements',a.id)).toEqual([]);expect(await rows('messages',a.id)).toEqual([]);
 }finally{blocked.mockRestore();}
 const response=await request(a,{action:'continue_delete'});expect(response.status).toBe(200);expect((await response.json()).data).toMatchObject({phase:'completed',outcome:'completed'});
 expect((await request(a)).status).toBe(401);expect(await rows('measurements',b.id)).toEqual(beforeForeign);
 const receipts=await rows('account_deletion_receipts',a.id);expect(receipts).toHaveLength(1);expect(Object.keys(receipts[0]!).sort()).toEqual(['completed_at','id','outcome','phase','requested_at','updated_at','user_id']);
},90_000);

it.each(['reported','conservative'] as const)('fences delayed content/tools/admission with %s settlement in the original month',async(settlement)=>{
 const user=await provision();const context=await verifySession({headers:{authorization:`Bearer ${user.token}`}});const app=randomUUID();const conversation=randomUUID();const period='2026-09-01';
 await db.admin('/rest/v1/usage_buckets','POST',{id:app,scope:'app',period_start:period,allocated_ceiling_usd:'1'});await db.admin('/rest/v1/usage_buckets','POST',{user_id:user.id,scope:'account',period_start:period,allocated_ceiling_usd:'1'});
 await db.admin('/rest/v1/conversations','POST',{id:conversation,user_id:user.id,title:'Synthetic delayed completion'});
 const ledger=new ExecutionService(context,{maxRunCostUSD:'0.25'});const input={conversationId:conversation,clientRequestId:randomUUID(),requestHash:requestHash('Synthetic delayed response'),depth:'everyday' as const,route:{role:'everyday' as const,provider:'openrouter' as const,model:'openai/gpt-6-luna',effort:'low'},consentVersion:'openrouter_zdr_v1'};
 const admitted=await ledger.admit(input);const lease=admitted.lease as RunLease;
 await db.admin(`/rest/v1/ai_runs?id=eq.${lease.runId}`,'PATCH',{accounting_period:period});
 const prepared=await ledger.prepare(lease,{type:'generation',body:Buffer.from('{"synthetic":"delayed"}'),provider:'openrouter',model:'openai/gpt-6-luna',price:syntheticPrice,adapterVersion:'synthetic-v1',metadata:{endpoint:'https://openrouter.ai/api/v1/responses',headers:{'Content-Type':'application/json'},redactedHeaders:['authorization']}});
 let release!:()=>void;let sent!:()=>void;const pending=new Promise<void>(resolve=>{release=resolve;});const authorized=new Promise<void>(resolve=>{sent=resolve;});let yielded=0;
 const dispatcher=createDispatcher(ledger,{mode:'mock',async *send(){sent();await pending;yield Buffer.from('Late synthetic private provider output');}});
 const stream=(async()=>{for await(const chunk of dispatcher.send(prepared,new AbortController().signal)){yielded+=chunk.length;}})();
 await authorized;
 try{
  const exported=await request(user,{action:'export',trace_parts:['input'],sensitive_content_acknowledged:true});expect(exported.status).toBe(200);const document=await exported.json();expect(document.sections.ai_steps.find((step:{id:string})=>step.id===prepared.id).traces.input.bytes).toBe(Buffer.from('{"synthetic":"delayed"}').toString('base64'));
  expect((await request(user,{action:'delete',confirmation:'DELETE MY VULPES ACCOUNT'})).status).toBe(200);
  release();await expect(stream).rejects.toMatchObject({code:'execution_interrupted'});expect(yielded).toBe(0);
  await expect(ledger.checkpoint(prepared,Buffer.from('late private output'))).rejects.toThrow();await expect(ledger.saveState(prepared,{private:'late'})).rejects.toThrow();await expect(ledger.admit({...input,clientRequestId:randomUUID()})).rejects.toThrow();await expect(ledger.authorize(prepared)).rejects.toThrow();
  for(let i=0;i<30;i++){await request(user,{action:'continue_delete'});const current=await status(user);if(current.state==='deleting'&&current.outcome==='waiting_for_accounting')break;}
  expect(await status(user)).toMatchObject({phase:'awaiting_settlement',outcome:'waiting_for_accounting'});expect(await rows('private_payloads',user.id)).toEqual([]);expect(await rows('messages',user.id)).toEqual([]);
  const reserved=await rows('usage_reservations',user.id);expect(reserved[0]).toMatchObject({status:'pending',period_start:period});
  // A delayed usage report changes charges only; its trace envelope cannot survive the fence.
  if(settlement==='reported')await ledger.settle(prepared,normalizeUsage({reportedCostUSD:'0.004',rawUsage:{synthetic:true}}),'interrupted',1);
  else{
   const held=await(await db.admin(`/rest/v1/usage_buckets?id=eq.${app}`,'GET')).json();expect(held[0]).toMatchObject({spent_usd:0,reserved_usd:0.022});
   await db.admin(`/rest/v1/usage_reservations?step_id=eq.${prepared.id}`,'PATCH',{uncertain_since:new Date(Date.now()-25*3600_000).toISOString()});
   expect((await request(user,{action:'continue_delete'})).status).toBe(200);
  }
  const ready=await(await db.admin('/rest/v1/rpc/pending_account_deletions_v1','POST',{p_batch_size:100})).json();expect(ready).toContain(user.id);
  expect(await rows('private_payloads',user.id)).toEqual([]);
  for(let i=0;i<30;i++){const response=await request(user,{action:'continue_delete'});expect(response.status).toBe(200);if((await response.json()).data.phase==='completed')break;}
  const balance=await(await db.admin(`/rest/v1/usage_buckets?id=eq.${app}`,'GET')).json();expect(balance[0]).toMatchObject({spent_usd:settlement==='reported'?0.004:0.022,reserved_usd:0});
  await expect(ledger.checkpoint(prepared,Buffer.from('even later'))).rejects.toThrow();expect(await rows('private_payloads',user.id)).toEqual([]);
 }finally{release();await stream.catch(()=>undefined);await db.admin(`/rest/v1/usage_reservations?user_id=eq.${user.id}`,'DELETE');await db.admin(`/rest/v1/usage_buckets?id=eq.${app}`,'DELETE');}
},60_000);

it('rejects a pre-admitted cancellation receipt after the deletion fence',async()=>{
 const user=await db.createUser();const graph=await db.seed(user.id);const context=await verifySession({headers:{authorization:`Bearer ${user.token}`}});const ledger=new ExecutionService(context);
 expect((await request(user,{action:'delete',confirmation:'DELETE MY VULPES ACCOUNT'})).status).toBe(200);
 await expect(ledger.cancelWithReceipt(graph.ids.ai_runs,randomUUID())).rejects.toThrow();
 const receipts=await rows('audit_events',user.id);expect(receipts.filter(row=>row.event_type==='chat_cancel_v1')).toHaveLength(0);
});

it('keeps deletion fenced across attempted profile reactivation',async()=>{
 const user=await db.createUser();await db.seed(user.id);expect((await request(user,{action:'delete',confirmation:'DELETE MY VULPES ACCOUNT'})).status).toBe(200);
 const revived=await db.request(`/rest/v1/profiles?user_id=eq.${user.id}`,'admin',{method:'PATCH',body:JSON.stringify({account_state:'active'})});expect(revived.ok).toBe(false);
 expect(await status(user)).toMatchObject({state:'deleting',phase:'fenced'});expect((await request(user,{action:'export',trace_parts:[],sensitive_content_acknowledged:false})).status).toBe(403);
});

it('removes an owned verification allocation after settlement without replenishing shared balances',async()=>{
 const user=await provision();const period=new Date().toISOString().slice(0,7)+'-01';const bucket=randomUUID();
 await db.admin(`/rest/v1/profiles?user_id=eq.${user.id}`,'PATCH',{display_name:'Synthetic verification'});
 await db.admin('/rest/v1/usage_buckets','POST',{id:bucket,user_id:user.id,scope:'account',period_start:period,allocated_ceiling_usd:'0.01'});
 await db.admin('/rest/v1/live_verification_allocations','POST',{id:randomUUID(),user_id:user.id,account_bucket_id:bucket,period_start:period,ceiling_usd:'0.01',data_revision:0,fixture_hash:'a'.repeat(64)});
 const before=await(await db.admin('/rest/v1/usage_buckets?scope=eq.app&order=id','GET')).json();
 expect((await request(user,{action:'delete',confirmation:'DELETE MY VULPES ACCOUNT'})).status).toBe(200);
 let completed=false;for(let n=0;n<30;n++){const response=await request(user,{action:'continue_delete'});expect(response.status).toBe(200);if((await response.json()).data.phase==='completed'){completed=true;break;}}
 expect(completed).toBe(true);expect(await rows('live_verification_allocations',user.id)).toEqual([]);expect(await rows('usage_buckets',user.id)).toEqual([]);expect(await(await db.admin('/rest/v1/usage_buckets?scope=eq.app&order=id','GET')).json()).toEqual(before);
});

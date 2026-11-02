import {randomBytes,randomUUID} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {beforeAll,afterAll,expect,it,vi} from 'vitest';
import {LocalSupabase} from '../helpers/local-supabase.js';
import {localStatus,projectId,localEnvironment} from '../../scripts/local-database.js';
import {administrativeClient} from '../../server/db/administrative.js';
import {maintainAccounts} from '../../server/services/maintenance.js';
import {encryptBytes,readEncryptionKeys} from '../../server/security/encryption.js';
import {readPayload} from '../../server/security/private-payloads.js';
import {verifyIdentity} from '../../server/auth/session.js';
import {beginDeletion} from '../../server/services/account.js';
import {verifySession} from '../../server/auth/session.js';
import {ExecutionService,requestHash} from '../../server/ai/ledger/execution.js';
import {syntheticPrice} from '../fixtures/executions.js';
import {hostedMaintenanceCommand} from '../../scripts/hosted-maintenance.js';
import {targetHash} from '../../scripts/hosting.js';
import {recoveryTargetHash,OwnerRecoveryTargetSchema} from '../../scripts/recovery-target.js';
import {mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

let db:LocalSupabase;let a:Awaited<ReturnType<LocalSupabase['createUser']>>,b:typeof a;
const expiredOwner=randomUUID(),recentOwner=randomUUID(),otherExpiredOwner=randomUUID();
function sql(statement:string){const result=spawnSync('docker',['exec','-i','supabase_db_'+projectId,'psql','-X','-qAt','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:statement,encoding:'utf8',env:localEnvironment()});expect(result.status).toBe(0);}
const rows=async(table:string,owner:string)=>(await(await db.admin('/rest/v1/'+table+'?user_id=eq.'+owner+'&order=id','GET')).json()) as Record<string,unknown>[];
beforeAll(async()=>{
 const c=localStatus();vi.stubEnv('VITE_SUPABASE_URL',c.apiUrl);vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY',c.anonKey);vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY',c.adminKey);vi.stubEnv('VULPES_TRACE_ENCRYPTION_KEY_ID','synthetic-maintenance');vi.stubEnv('VULPES_TRACE_ENCRYPTION_KEY_B64',randomBytes(32).toString('base64'));
 db=new LocalSupabase();a=await db.createUser();b=await db.createUser();for(const user of [a,b])await db.admin('/rest/v1/profiles','POST',{user_id:user.id});
 for(const user of [a,b]){
  const payloads=Array.from({length:5},()=>({...encryptBytes({id:randomUUID(),user_id:user.id,purpose:'ai_request',expires_at:new Date(Date.now()-60_000).toISOString()},Buffer.from('Synthetic maintenance expiry'),readEncryptionKeys()),created_at:new Date(Date.now()-120_000).toISOString()}));await db.admin('/rest/v1/private_payloads','POST',payloads);
  await db.admin('/rest/v1/action_proposals','POST',Array.from({length:5},()=>({user_id:user.id,kind:'goal.create',canonical_payload:{schemaVersion:1},payload_hash:'a'.repeat(64),summary:'Synthetic expired proposal',created_at:new Date(Date.now()-172800_000).toISOString(),expires_at:new Date(Date.now()-86400_000).toISOString()})));
 }
 sql(`insert into public.account_deletion_receipts(user_id,phase,requested_at,updated_at,completed_at,outcome) values
 ('${expiredOwner}','completed',now()-interval '33 days',now()-interval '32 days',now()-interval '32 days','completed'),
 ('${otherExpiredOwner}','completed',now()-interval '33 days',now()-interval '32 days',now()-interval '32 days','completed'),
 ('${recentOwner}','completed',now()-interval '2 days',now()-interval '1 day',now()-interval '1 day','completed');`);
});
afterAll(async()=>{try{if(db)await db.cleanup();sql(`delete from public.account_deletion_receipts where user_id in('${expiredOwner}','${otherExpiredOwner}','${recentOwner}');`);}finally{vi.unstubAllEnvs();}});
it('permits service-only inspection, requires a non-null owner and validates batch bounds',async()=>{
 for(const token of ['anon',a.token]){const response=await db.request('/rest/v1/rpc/maintain_account_v1',token,{method:'POST',body:JSON.stringify({p_owner:a.id})});expect([401,403]).toContain(response.status);}
 for(const bad of [{p_owner:null},{p_owner:a.id,p_batch_size:101},{p_owner:a.id,p_execute:null}]){const response=await db.request('/rest/v1/rpc/maintain_account_v1','admin',{method:'POST',body:JSON.stringify(bad)});expect(response.ok).toBe(false);}
});
it('inspects without writes, expires read-time content, and drains only owned bounded backlogs',async()=>{
 const admin=administrativeClient(),before=await rows('private_payloads',a.id),foreign={payloads:await rows('private_payloads',b.id),proposals:await rows('action_proposals',b.id)};
 expect(await readPayload({userId:a.id,db:admin},String(before[0]!.id),'ai_request')).toEqual({state:'expired'});
 const inspected=await maintainAccounts(admin,{owners:[a.id],execute:false,limits:{}});expect(inspected).toMatchObject({passes:0,unfinished:true,changes:{payloadsRemoved:0,proposalsExpired:0}});expect(await rows('private_payloads',a.id)).toEqual(before);
 const first=await maintainAccounts(admin,{owners:[a.id],execute:true,limits:{batchSize:2,maxPasses:1}});expect(first).toMatchObject({passes:1,unfinished:true,changes:{payloadsRemoved:2,proposalsExpired:2}});
 const remaining=await maintainAccounts(admin,{owners:[a.id],execute:true,limits:{batchSize:2}});expect(remaining.unfinished).toBe(false);expect(await rows('private_payloads',a.id)).toEqual([]);expect((await rows('action_proposals',a.id)).every(p=>p.state==='expired'&&p.canonical_payload===null)).toBe(true);
 expect(await rows('private_payloads',b.id)).toEqual(foreign.payloads);expect(await rows('action_proposals',b.id)).toEqual(foreign.proposals);
});
it('prunes only the approved completed receipt older than 31 days and retains recent/foreign records',async()=>{
 const report=await maintainAccounts(administrativeClient(),{owners:[expiredOwner,recentOwner],execute:true,limits:{}});expect(report.changes.receiptsRemoved).toBe(1);expect(await rows('account_deletion_receipts',expiredOwner)).toEqual([]);expect(await rows('account_deletion_receipts',recentOwner)).toHaveLength(1);expect(await rows('account_deletion_receipts',otherExpiredOwner)).toHaveLength(1);
});
it('resumes an existing deletion without browser credentials and independently confirms Auth removal',async()=>{
 const user=await db.createUser();await db.admin('/rest/v1/profiles','POST',{user_id:user.id});
 const identity=await verifyIdentity({headers:{authorization:'Bearer '+user.token}});await beginDeletion(identity);
 const report=await maintainAccounts(administrativeClient(),{owners:[user.id],execute:true,limits:{}});expect(report).toMatchObject({unfinished:false,authRemovalsConfirmed:1});expect(report.deletionSteps).toBeLessThanOrEqual(20);
 const absent=await administrativeClient().auth.admin.getUserById(user.id);expect(absent.error?.code).toBe('user_not_found');expect((await rows('account_deletion_receipts',user.id))[0]).toMatchObject({phase:'completed',outcome:'completed'});
});
it('reconciles a stale authorized run without dispatch and preserves uncertainty until the original 24-hour boundary',async()=>{
 const user=await db.createUser(),app=randomUUID(),conversation=randomUUID(),period=new Date().toISOString().slice(0,7)+'-01';
 await db.admin('/rest/v1/profiles','POST',{user_id:user.id,consent_versions:{openrouter:{accepted_version:'openrouter_zdr_v2',accepted_at:new Date().toISOString()}}});
 await db.admin('/rest/v1/usage_buckets','POST',{id:app,scope:'app',period_start:period,allocated_ceiling_usd:'1'});
 await db.admin('/rest/v1/usage_buckets','POST',{user_id:user.id,scope:'account',period_start:period,allocated_ceiling_usd:'1'});
 await db.admin('/rest/v1/conversations','POST',{id:conversation,user_id:user.id,title:'Synthetic maintenance run'});
 try{
  const context=await verifySession({headers:{authorization:'Bearer '+user.token}}),ledger=new ExecutionService(context,{maxRunCostUSD:'0.25'});
  const admitted=await ledger.admit({conversationId:conversation,clientRequestId:randomUUID(),requestHash:requestHash('Synthetic maintenance only'),depth:'everyday',route:{role:'everyday',provider:'openrouter',model:'openai/gpt-6-luna',effort:'low'},consentVersion:'openrouter_zdr_v2'});
  if(!admitted.lease)throw new Error('Missing synthetic lease');
  const step=await ledger.prepare(admitted.lease,{type:'generation',body:Buffer.from('Synthetic maintenance request'),provider:'openrouter',model:'openai/gpt-6-luna',price:syntheticPrice,adapterVersion:'synthetic-maintenance',metadata:{endpoint:'https://openrouter.ai/api/v1/responses',headers:{},redactedHeaders:[]}});await ledger.authorize(step);
  await db.admin('/rest/v1/ai_runs?id=eq.'+admitted.lease.runId,'PATCH',{lease_expires_at:new Date(Date.now()-1000).toISOString()});
  const first=await maintainAccounts(administrativeClient(),{owners:[user.id],execute:true,limits:{}});expect(first.changes).toMatchObject({interrupted:1,conservative:0});expect(first.reports[0]!.status).toMatchObject({pendingHolds:1});expect(first.reports[0]!.status.retryAfter).not.toBeNull();
  expect((await rows('usage_buckets',user.id))[0]).toMatchObject({reserved_usd:0.022,spent_usd:0,allocated_ceiling_usd:1});
  await db.admin('/rest/v1/usage_reservations?step_id=eq.'+step.id,'PATCH',{uncertain_since:new Date(Date.now()-25*3600_000).toISOString()});
  const later=await maintainAccounts(administrativeClient(),{owners:[user.id],execute:true,limits:{}});expect(later.changes.conservative).toBe(1);expect(later.reports[0]!.status.pendingHolds).toBe(0);expect((await rows('usage_buckets',user.id))[0]).toMatchObject({reserved_usd:0,spent_usd:0.022,allocated_ceiling_usd:1});
 }finally{await db.admin('/rest/v1/usage_reservations?user_id=eq.'+user.id,'DELETE');await db.admin('/rest/v1/usage_buckets?id=eq.'+app,'DELETE');}
});
it('exercises the hosted command against local Auth/RPC over its injected transport without ambient credentials',async()=>{
 const c=localStatus(),owner=await db.createUser();await db.admin('/rest/v1/profiles','POST',{user_id:owner.id});
 const email=await administrativeClient().auth.admin.updateUserById(owner.id,{email:'maintenance-'+randomUUID()+'@example.invalid',email_confirm:true});expect(email.error).toBeNull();
 const target={version:1,purpose:'synthetic-only',supabaseProjectRef:'abcdefghijklmnopqrst',recoveryProjectRef:null,databaseRegion:'us-east-1',vercelProjectId:'prj_SyntheticOnly',appOrigin:'https://vulpes-synthetic.vercel.app'} as const;
 const directory=await mkdtemp(join(tmpdir(),'vulpes-maintenance-proof-')),path=join(directory,'manifest.json');
 try{
  await writeFile(path,JSON.stringify({target,targetSHA256:targetHash(target)}),{flag:'wx'});
  const report=await hostedMaintenanceCommand(['--manifest='+path,'--inspect','--allow-hosted'],async()=>({publishableKey:c.anonKey,adminKey:c.adminKey,authorization:{purpose:'synthetic-maintenance',mode:'inspect',targetSHA256:targetHash(target),owners:[owner.id],expiresAt:new Date(Date.now()+3600_000).toISOString(),approved:true},limits:{}}),(url,init)=>{const parsed=new URL(String(url));return fetch(c.apiUrl+parsed.pathname+parsed.search,init);});
  expect(report).toMatchObject({mode:'inspect',owners:1,passes:0,unfinished:false,requests:2});
 }finally{await unlink(path);await rmdir(directory);}
});
it('finishes an authorized deletion when Auth is already absent but its completion receipt is still pending',async()=>{
 const c=localStatus(),owner=await db.createUser(),admin=administrativeClient();await db.admin('/rest/v1/profiles','POST',{user_id:owner.id});
 const identity=await verifyIdentity({headers:{authorization:'Bearer '+owner.token}});await beginDeletion(identity);
 for(let n=0;n<20;n++){const progress=await admin.rpc('continue_account_deletion_v1',{p_owner:owner.id,p_batch_size:100});expect(progress.error).toBeNull();if(progress.data&&typeof progress.data==='object'&&!Array.isArray(progress.data)&&progress.data.phase==='auth_removal_pending')break;}
 const removed=await admin.auth.admin.deleteUser(owner.id);expect(removed.error).toBeNull();expect((await rows('account_deletion_receipts',owner.id))[0]).toMatchObject({phase:'auth_removal_pending'});
 const target={version:1,purpose:'synthetic-only',supabaseProjectRef:'abcdefghijklmnopqrst',recoveryProjectRef:null,databaseRegion:'us-east-1',vercelProjectId:'prj_SyntheticOnly',appOrigin:'https://vulpes-synthetic.vercel.app'} as const;
 const directory=await mkdtemp(join(tmpdir(),'vulpes-maintenance-retry-')),path=join(directory,'manifest.json');
 try{
  await writeFile(path,JSON.stringify({target,targetSHA256:targetHash(target)}),{flag:'wx'});
  const report=await hostedMaintenanceCommand(['--manifest='+path,'--execute','--allow-hosted'],async()=>({publishableKey:c.anonKey,adminKey:c.adminKey,authorization:{purpose:'synthetic-maintenance',mode:'execute',targetSHA256:targetHash(target),owners:[owner.id],expiresAt:new Date(Date.now()+3600_000).toISOString(),approved:true},limits:{}}),(url,init)=>{const parsed=new URL(String(url));return fetch(c.apiUrl+parsed.pathname+parsed.search,init);});
  expect(report).toMatchObject({mode:'execute',unfinished:false,authRemovalsConfirmed:1});expect((await rows('account_deletion_receipts',owner.id))[0]).toMatchObject({phase:'completed',outcome:'completed'});
 }finally{await unlink(path);await rmdir(directory);}
});

it('inspects and executes bounded maintenance for the explicitly named marked owner without changing a peer',async()=>{
 const c=localStatus(),owner=await db.createUser();await db.admin('/rest/v1/profiles','POST',{user_id:owner.id});
 expect((await administrativeClient().auth.admin.updateUserById(owner.id,{app_metadata:{vulpes_data_scope:'owner-pilot'}})).error).toBeNull();
 const foreign=await rows('private_payloads',b.id);
 await db.admin('/rest/v1/private_payloads','POST',Array.from({length:2},()=>({...encryptBytes({id:randomUUID(),user_id:owner.id,purpose:'ai_request',expires_at:new Date(Date.now()-60000).toISOString()},Buffer.from('Synthetic owner-mode expiry'),readEncryptionKeys()),created_at:new Date(Date.now()-120000).toISOString()})));
 const target=OwnerRecoveryTargetSchema.parse({version:1,purpose:'owner-pilot',ownerUserId:owner.id,syntheticPeerUserIds:[],supabaseProjectRef:'abcdefghijklmnopqrst',recoveryProjectRef:null,databaseRegion:'us-east-1',vercelProjectId:'prj_SyntheticOnly',appOrigin:'https://vulpes-synthetic.vercel.app'});
 const root=await mkdtemp(join(tmpdir(),'vulpes-owner-maintenance-')),path=join(root,'manifest.json');
 const send:typeof fetch=(url,init)=>{const parsed=new URL(String(url));return fetch(c.apiUrl+parsed.pathname+parsed.search,init);};
 try{
  await writeFile(path,JSON.stringify({target,targetSHA256:recoveryTargetHash(target)}),{flag:'wx'});
  const run=(mode:'inspect'|'execute')=>hostedMaintenanceCommand(['--owner-pilot','--allow-hosted','--'+mode,'--manifest='+path],async()=>({publishableKey:c.anonKey,adminKey:c.adminKey,authorization:{purpose:'owner-pilot-maintenance',mode,targetSHA256:recoveryTargetHash(target),owners:[owner.id],expiresAt:new Date(Date.now()+3600000).toISOString(),approved:true},limits:{batchSize:1,maxPasses:1}}),send);
  expect(await run('inspect')).toMatchObject({mode:'inspect',owners:1,passes:0,changes:{payloadsRemoved:0},unfinished:true});expect(await rows('private_payloads',owner.id)).toHaveLength(2);
  expect(await run('execute')).toMatchObject({mode:'execute',owners:1,passes:1,changes:{payloadsRemoved:1},unfinished:true});expect(await rows('private_payloads',owner.id)).toHaveLength(1);expect(await rows('private_payloads',b.id)).toEqual(foreign);
 }finally{await unlink(path);await rmdir(root);}
});

import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,renameSync} from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {assertLocalStack,localEnvironment,localStatus,projectRoot,runSupabase} from './local-database.js';
import {LocalSupabase} from '../tests/helpers/local-supabase.js';
import {databaseTables} from '../tests/fixtures/database-graph.js';

// Explicitly destructive only to an empty, guarded disposable stack. All moved
// files remain inside this workspace and are restored in finally; no deletion.
assert.deepEqual(process.argv.slice(2),['--allow-disposable-reset'],'Pass --allow-disposable-reset for the local upgrade proof.');
assertLocalStack();localStatus();
const db=new LocalSupabase();
const names=['20261026000100_run_ledger.sql','20261026000200_run_reconciliation.sql','20261026000300_budget_settings.sql','20261026000400_budget_read.sql','20261026000500_usage_evidence.sql','20261026000600_budget_scope_names.sql','20261026000700_conversations.sql','20261026000800_metric_inventory.sql','20261026000900_chat_checkpoints.sql','20261026001000_chat_cancel_receipts.sql','20261026001100_live_verification_allocation.sql','20261026001200_durable_route_cost_blocks.sql','20261027000100_completion_metadata.sql','20261027000200_retained_chat_replay.sql'];
const parked=path.resolve(projectRoot,'supabase/.temp/pr08-upgrade-migrations');
const files=names.map(name=>{
  const source=path.resolve(projectRoot,'supabase/migrations',name);const destination=path.resolve(parked,name);
  for(const target of [source,destination]){const relative=path.relative(projectRoot,target);assert(!relative.startsWith('..') && !path.isAbsolute(relative));}
  return {source,destination,hash:createHash('sha256').update(readFileSync(source)).digest('hex')};
});
let report:Record<string,unknown>|null=null;
let phase='empty-stack check';
let ownsSyntheticRoute=false;
async function waitForLocalApi(){
  const deadline=Date.now()+45_000;
  while(Date.now()<deadline){
    try{
      const health=await db.request('/auth/v1/health',null);
      const rest=await db.request('/rest/v1/profiles?select=user_id&limit=1','admin');
      if(health.ok && rest.ok)return;
    }catch{/* Local container restart can briefly reset existing connections. */}
    await delay(500);
  }
  throw new Error('Local API readiness timed out.');
}
async function snapshot(owner:string){
  const result:Record<string,Record<string,unknown>[]>={};
  for(const table of databaseTables)result[table]=await(await db.admin(`/rest/v1/${table}?user_id=eq.${owner}&order=${table==='profiles'?'user_id':'id'}`,'GET')).json();
  return result;
}
function restore(){for(const file of files){if(existsSync(file.destination)){assert(!existsSync(file.source),'Both source and parked migration exist; preserve both for inspection.');renameSync(file.destination,file.source);}assert.equal(createHash('sha256').update(readFileSync(file.source)).digest('hex'),file.hash,'Migration content changed during upgrade proof.');}}
try{
  const users=await(await db.request('/auth/v1/admin/users','admin')).json() as {users:unknown[]};assert.equal(users.users.length,0,'Refusing to reset a nonempty local stack.');
  for(const table of databaseTables)assert.equal((await(await db.admin(`/rest/v1/${table}?select=${table==='profiles'?'user_id':'id'}&limit=1`,'GET')).json() as unknown[]).length,0,'Refusing to reset existing operator/test records.');
  for(const table of ['live_verification_allocations','ai_route_cost_blocks'])assert.equal((await(await db.admin(`/rest/v1/${table}?select=*&limit=1`,'GET')).json() as unknown[]).length,0,'Refusing to reset retained verification or route-block records.');
  ownsSyntheticRoute=true;
  mkdirSync(parked,{recursive:true});
  phase='park new migrations';
  for(const file of files){assert(!existsSync(file.destination));renameSync(file.source,file.destination);}
  phase='reset base schema';runSupabase(['db','reset','--local','--no-seed','--yes'],true);
  phase='wait for restarted local APIs';await waitForLocalApi();
  phase='create first base user';const a=await db.createUser();phase='create second base user';const b=await db.createUser();
  phase='seed first base graph';const ga=await db.seed(a.id,'legacy');phase='seed second base graph';const gb=await db.seed(b.id,'legacy');
  phase='snapshot base rows';const beforeA=await snapshot(a.id);const beforeB=await snapshot(b.id);
  const householdBefore=await(await db.admin('/rest/v1/usage_buckets?scope=eq.household','GET')).json();
  phase='restore accounting migrations';
  for(const file of files.slice(0,5))renameSync(file.destination,file.source);
  phase='apply original PR08 migrations';runSupabase(['migration','up','--local'],true);await waitForLocalApi();
  for(const [owner,before] of [[a.id,beforeA],[b.id,beforeB]] as const){
    const after=await snapshot(owner);
    for(const table of databaseTables){phase='compare '+table;const original=before[table]!;const keys=Object.keys(original[0]!);
      assert.deepEqual(after[table]!.map(row=>Object.fromEntries(keys.map(key=>[key,row[key]]))),original,'Upgrade changed an existing synthetic row.');}
  }
  phase='compare household';assert.deepEqual(await(await db.admin('/rest/v1/usage_buckets?scope=eq.household','GET')).json(),householdBefore);
  // Exercise the naming migration independently with reserved, uncertain and
  // already-settled reservations, not only freshly empty accounting tables.
  phase='seed legacy reservation states';
  const extraStep=randomUUID();
  await db.admin(`/rest/v1/ai_steps?id=eq.${ga.ids.ai_steps}`,'PATCH',{dispatch_state:'send_authorized'});
  await db.admin(`/rest/v1/usage_reservations?user_id=eq.${a.id}`,'PATCH',{status:'pending',uncertain_since:new Date().toISOString()});
  await db.admin(`/rest/v1/ai_steps?id=eq.${gb.ids.ai_steps}`,'PATCH',{dispatch_state:'finished',status:'completed',finished_at:new Date().toISOString(),cost_usd:'0.04'});
  await db.admin(`/rest/v1/usage_reservations?user_id=eq.${b.id}`,'PATCH',{status:'settled',known_cost_usd:'0.04',unknown_cost:false,settled_at:new Date().toISOString()});
  await db.admin('/rest/v1/ai_steps','POST',{id:extraStep,user_id:a.id,run_id:ga.ids.ai_runs,sequence:2,step_type:'generation',status:'started'});
  await db.admin('/rest/v1/usage_reservations','POST',{user_id:a.id,run_id:ga.ids.ai_runs,step_id:extraStep,period_start:'2026-10-01',user_bucket_id:ga.ids.usage_buckets,household_bucket_id:householdBefore[0].id,amount_usd:'0.05'});
  await db.admin(`/rest/v1/usage_buckets?id=eq.${ga.ids.usage_buckets}`,'PATCH',{reserved_usd:'0.15'});
  await db.admin(`/rest/v1/usage_buckets?id=eq.${gb.ids.usage_buckets}`,'PATCH',{reserved_usd:'0',spent_usd:'0.04'});
  await db.admin(`/rest/v1/usage_buckets?id=eq.${householdBefore[0].id}`,'PATCH',{reserved_usd:'0.15',spent_usd:'0.04'});
  const legacyA=await snapshot(a.id);const legacyB=await snapshot(b.id);
  const sharedBefore=await(await db.admin('/rest/v1/usage_buckets?scope=eq.household','GET')).json();
  phase='apply terminology migration';renameSync(files[5]!.destination,files[5]!.source);runSupabase(['migration','up','--local'],true);await waitForLocalApi();
  function renamed(row:Record<string,unknown>){
    return Object.fromEntries(Object.entries(row).map(([key,value])=>[
      ({user_bucket_id:'account_bucket_id',household_bucket_id:'app_bucket_id',household_scope:'app_scope'} as Record<string,string>)[key] ?? key,
      key==='scope' ? value==='user' ? 'account' : value==='household' ? 'app' : value : key==='household_scope' ? 'app' : value,
    ]));
  }
  for(const [owner,before] of [[a.id,legacyA],[b.id,legacyB]] as const){
    const after=await snapshot(owner);
    for(const table of databaseTables){phase='compare renamed '+table;assert.deepEqual(after[table],before[table]!.map(renamed),'Terminology migration changed accounting or private data.');}
  }
  assert.deepEqual(await(await db.admin('/rest/v1/usage_buckets?scope=eq.app','GET')).json(),sharedBefore.map(renamed));
  phase='settle migrated reservations';
  async function settle(owner:string,run:string,step:string,source:string,costUSD:string|null){
    return db.admin('/rest/v1/rpc/settle_step_v1','POST',{p_owner:owner,p_run:run,p_step:step,p_evidence:{source,costUSD,expectedVersion:0},p_status:'completed'});
  }
  await settle(a.id,ga.ids.ai_runs,ga.ids.ai_steps,'reported','0.03');
  await settle(a.id,ga.ids.ai_runs,ga.ids.ai_steps,'reported','0.03'); // Identical receipt cannot charge twice.
  await settle(a.id,ga.ids.ai_runs,extraStep,'not_sent',null);
  await settle(b.id,gb.ids.ai_runs,gb.ids.ai_steps,'reported','0.02');
  const balances=await(await db.admin('/rest/v1/usage_buckets?order=scope,user_id','GET')).json() as Record<string,unknown>[];
  assert.equal(balances.length,3);
  for(const bucket of balances){assert.equal(Number(bucket.reserved_usd),0);assert.equal(Number(bucket.spent_usd),bucket.scope==='app' ? 0.05 : bucket.user_id===a.id ? 0.03 : 0.02);}
  phase='verify isolation';
  const foreign=await db.request(`/rest/v1/measurements?id=eq.${gb.ids.measurements}&select=id`,a.token);assert(foreign.ok);assert.deepEqual(await foreign.json(),[]);
  const own=await db.request(`/rest/v1/measurements?id=eq.${ga.ids.measurements}&select=id`,a.token);assert(own.ok);assert.equal((await own.json() as unknown[]).length,1);
  phase='snapshot populated PR08';const pr08A=await snapshot(a.id);const pr08B=await snapshot(b.id);
  const bucketsBeforeChat=await(await db.admin('/rest/v1/usage_buckets?order=id','GET')).json();
  phase='apply PR09';for(const file of files.slice(6,10))renameSync(file.destination,file.source);runSupabase(['migration','up','--local'],true);await waitForLocalApi();
  assert.deepEqual(await snapshot(a.id),pr08A);assert.deepEqual(await snapshot(b.id),pr08B);
  assert.deepEqual(await(await db.admin('/rest/v1/usage_buckets?order=id','GET')).json(),bucketsBeforeChat);
  phase='seed existing violated route';await db.admin(`/rest/v1/ai_steps?id=eq.${ga.ids.ai_steps}`,'PATCH',{provider:'openrouter',model_id:'synthetic-upgrade-bound',cost_bound_state:'exceeded'});
  phase='apply PR10';const pr09A=await snapshot(a.id);const pr09B=await snapshot(b.id);
  for(const file of files.slice(10,12))renameSync(file.destination,file.source);runSupabase(['migration','up','--local'],true);await waitForLocalApi();
  assert.deepEqual(await snapshot(a.id),pr09A);assert.deepEqual(await snapshot(b.id),pr09B);
  assert.deepEqual(await(await db.admin('/rest/v1/usage_buckets?order=id','GET')).json(),bucketsBeforeChat);
  const routeBlocks=await(await db.admin('/rest/v1/ai_route_cost_blocks?provider=eq.openrouter&model_id=eq.synthetic-upgrade-bound','GET')).json();assert.equal(routeBlocks.length,1);
  phase='snapshot populated M3';const m3A=await snapshot(a.id);const m3B=await snapshot(b.id);
  phase='apply M3 review remediation';for(const file of files.slice(12))renameSync(file.destination,file.source);runSupabase(['migration','up','--local'],true);await waitForLocalApi();
  for(const [owner,before] of [[a.id,m3A],[b.id,m3B]] as const){
    const after=await snapshot(owner);
    for(const table of databaseTables){const original=before[table]!;const keys=Object.keys(original[0]!);
      assert.deepEqual(after[table]!.map(row=>Object.fromEntries(keys.map(key=>[key,row[key]]))),original,'Review remediation changed existing M3 data.');}
    assert(after.ai_steps!.every(step=>step.effective_model_id===null),'Legacy metadata must remain unknown.');
  }
  assert.deepEqual(await(await db.admin('/rest/v1/usage_buckets?order=id','GET')).json(),bucketsBeforeChat);
  phase='exercise new atomic message transaction';
  await db.admin(`/rest/v1/ai_runs?id=eq.${ga.ids.ai_runs}`,'PATCH',{status:'completed',finished_at:new Date().toISOString()});
  const conversation=randomUUID();const executor=randomUUID();const requestId=randomUUID();const messageId=randomUUID();
  await db.admin('/rest/v1/rpc/mutate_conversation_v1','POST',{p_owner:a.id,p_request:{action:'create',id:conversation,client_request_id:randomUUID()}});
  const chatInput={p_owner:a.id,p_executor:executor,p_request:{conversationId:conversation,clientRequestId:requestId,requestHash:'b'.repeat(64),depth:'auto',route:{role:'everyday',provider:'openrouter',model:'openai/gpt-6-luna',effort:'low'},consentVersion:'openrouter_zdr_v2',baseline:'safety-v1',maxCostUSD:'0'},p_message:{id:messageId,text:'Synthetic baseline safety question'}};
  const admitted=await(await db.admin('/rest/v1/rpc/admit_chat_v1','POST',chatInput)).json();assert.equal(admitted.kind,'admitted');
  assert.equal((await(await db.admin('/rest/v1/rpc/admit_chat_v1','POST',chatInput)).json()).kind,'existing');
  const completed=await(await db.admin('/rest/v1/rpc/baseline_chat_v1','POST',{p_owner:a.id,p_run:admitted.run.id,p_executor:executor,p_fence:1,p_text:'Synthetic deterministic safety guidance.'})).json();assert.equal(completed.state,'completed');assert.equal(completed.costUSD,'0');
  assert.equal((await(await db.admin(`/rest/v1/messages?conversation_id=eq.${conversation}`,'GET')).json()).length,2);
  const denied=await db.request('/rest/v1/rpc/admit_chat_v1',a.token,{method:'POST',body:JSON.stringify(chatInput)});assert([401,403,404].includes(denied.status));
  phase='seed bounded maintenance cases';
  await db.admin(`/rest/v1/private_payloads?id=eq.${ga.ids.private_payloads}`,'PATCH',{created_at:new Date(Date.now()-120000).toISOString(),expires_at:new Date(Date.now()-60000).toISOString()});
  const pendingStep=randomUUID();await db.admin('/rest/v1/ai_steps','POST',{id:pendingStep,user_id:b.id,run_id:gb.ids.ai_runs,sequence:2,step_type:'generation',status:'started',dispatch_state:'send_authorized'});
  await db.admin('/rest/v1/usage_reservations','POST',{user_id:b.id,run_id:gb.ids.ai_runs,step_id:pendingStep,period_start:'2026-10-01',account_bucket_id:gb.ids.usage_buckets,app_bucket_id:householdBefore[0].id,amount_usd:'0.01',status:'pending',uncertain_since:new Date(Date.now()-25*3600000).toISOString()});
  await db.admin(`/rest/v1/usage_buckets?id=eq.${gb.ids.usage_buckets}`,'PATCH',{reserved_usd:'0.01'});await db.admin(`/rest/v1/usage_buckets?id=eq.${householdBefore[0].id}`,'PATCH',{reserved_usd:'0.01'});
  await db.admin(`/rest/v1/ai_runs?id=eq.${gb.ids.ai_runs}`,'PATCH',{lease_expires_at:new Date(Date.now()-1000).toISOString()});
  phase='run actual maintenance command';
  const maintenance=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/cleanup.ts'],{cwd:projectRoot,env:localEnvironment(),encoding:'utf8',timeout:60000});
  assert.equal(maintenance.status,0);const cleaned=JSON.parse(maintenance.stdout.trim());assert(cleaned.removed>=1);assert.equal(cleaned.interrupted,1);assert.equal(cleaned.conservative,1);
  const pending=await(await db.admin(`/rest/v1/usage_reservations?step_id=eq.${pendingStep}`,'GET')).json();assert.equal(pending[0].status,'settled');assert.equal(Number(pending[0].known_cost_usd),0.01);
  report={scope:'local_synthetic_forward_upgrade',base:'fe6675b',migrationsApplied:names.length,owners:2,tablesPreserved:databaseTables.length,originalRowsUnchanged:true,renamedStatesPreserved:['reserved','pending','settled'],postMigrationSettlementAndReplay:true,crossUserDenied:true,populatedPR08ToPR09Unchanged:true,populatedPR09ToPR10Unchanged:true,populatedM3RemediationUnchanged:true,legacyCompletionMetadataUnknown:true,backfilledRouteBlock:true,atomicChatReplay:true,maintenance:{removed:cleaned.removed,interrupted:cleaned.interrupted,conservative:cleaned.conservative}};
}catch(error){const safe=error instanceof Error && error.message.startsWith('Synthetic ') ? ' '+error.message : '';console.error('Forward-upgrade proof failed at '+phase+'.'+safe+' Inspect the guarded synthetic stack and restored migration files.');process.exitCode=1;}
finally{restore();runSupabase(['migration','up','--local'],true);await db.cleanup();
  if(ownsSyntheticRoute){const cleaned=spawnSync('docker',['exec','supabase_db_vulpes-health-pr03-test','psql','-U','postgres','-d','postgres','-c',"delete from public.ai_route_cost_blocks where provider='openrouter' and model_id='synthetic-upgrade-bound'"],{cwd:projectRoot,env:localEnvironment(),encoding:'utf8',timeout:15000});
    assert.equal(cleaned.status,0,'Synthetic route-block cleanup failed.');}}
if(report)console.info(JSON.stringify(report,null,2));

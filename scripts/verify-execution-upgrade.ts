import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,renameSync} from 'node:fs';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {assertLocalStack,localStatus,projectRoot,runSupabase} from './local-database.js';
import {LocalSupabase} from '../tests/helpers/local-supabase.js';
import {databaseTables} from '../tests/fixtures/database-graph.js';

// Explicitly destructive only to an empty, guarded disposable stack. All moved
// files remain inside this workspace and are restored in finally; no deletion.
assert.deepEqual(process.argv.slice(2),['--allow-disposable-reset'],'Pass --allow-disposable-reset for the local upgrade proof.');
assertLocalStack();localStatus();
const db=new LocalSupabase();
const names=['20261026000100_run_ledger.sql','20261026000200_run_reconciliation.sql','20261026000300_budget_settings.sql','20261026000400_budget_read.sql','20261026000500_usage_evidence.sql','20261026000600_budget_scope_names.sql'];
const parked=path.resolve(projectRoot,'supabase/.temp/pr08-upgrade-migrations');
const files=names.map(name=>{
  const source=path.resolve(projectRoot,'supabase/migrations',name);const destination=path.resolve(parked,name);
  for(const target of [source,destination]){const relative=path.relative(projectRoot,target);assert(!relative.startsWith('..') && !path.isAbsolute(relative));}
  return {source,destination,hash:createHash('sha256').update(readFileSync(source)).digest('hex')};
});
let report:Record<string,unknown>|null=null;
let phase='empty-stack check';
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
  for(const file of files.slice(0,-1))renameSync(file.destination,file.source);
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
  phase='apply terminology migration';restore();runSupabase(['migration','up','--local'],true);await waitForLocalApi();
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
  report={scope:'local_synthetic_forward_upgrade',base:'fe6675b',migrationsApplied:names.length,owners:2,tablesPreserved:databaseTables.length,originalRowsUnchanged:true,renamedStatesPreserved:['reserved','pending','settled'],postMigrationSettlementAndReplay:true,crossUserDenied:true};
}catch(error){const safe=error instanceof Error && error.message.startsWith('Synthetic ') ? ' '+error.message : '';console.error('Forward-upgrade proof failed at '+phase+'.'+safe+' Inspect the guarded synthetic stack and restored migration files.');process.exitCode=1;}
finally{restore();runSupabase(['migration','up','--local'],true);await db.cleanup();}
if(report)console.info(JSON.stringify(report,null,2));

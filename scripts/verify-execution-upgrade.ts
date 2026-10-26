import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
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
const names=['20261026000100_run_ledger.sql','20261026000200_run_reconciliation.sql','20261026000300_budget_settings.sql','20261026000400_budget_read.sql','20261026000500_usage_evidence.sql'];
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
  phase='seed first base graph';const ga=await db.seed(a.id);phase='seed second base graph';const gb=await db.seed(b.id);
  phase='snapshot base rows';const beforeA=await snapshot(a.id);const beforeB=await snapshot(b.id);
  const householdBefore=await(await db.admin('/rest/v1/usage_buckets?scope=eq.household','GET')).json();
  phase='restore migrations';restore();phase='apply forward migrations';runSupabase(['migration','up','--local'],true);await waitForLocalApi();
  for(const [owner,before] of [[a.id,beforeA],[b.id,beforeB]] as const){
    const after=await snapshot(owner);
    for(const table of databaseTables){phase='compare '+table;const original=before[table]!;const keys=Object.keys(original[0]!);
      assert.deepEqual(after[table]!.map(row=>Object.fromEntries(keys.map(key=>[key,row[key]]))),original,'Upgrade changed an existing synthetic row.');}
  }
  phase='compare household';assert.deepEqual(await(await db.admin('/rest/v1/usage_buckets?scope=eq.household','GET')).json(),householdBefore);
  phase='verify isolation';
  const foreign=await db.request(`/rest/v1/measurements?id=eq.${gb.ids.measurements}&select=id`,a.token);assert(foreign.ok);assert.deepEqual(await foreign.json(),[]);
  const own=await db.request(`/rest/v1/measurements?id=eq.${ga.ids.measurements}&select=id`,a.token);assert(own.ok);assert.equal((await own.json() as unknown[]).length,1);
  report={scope:'local_synthetic_forward_upgrade',base:'fe6675b',migrationsApplied:names.length,owners:2,tablesPreserved:databaseTables.length,originalRowsUnchanged:true,crossUserDenied:true};
}catch(error){const safe=error instanceof Error && error.message.startsWith('Synthetic ') ? ' '+error.message : '';console.error('Forward-upgrade proof failed at '+phase+'.'+safe+' Inspect the guarded synthetic stack and restored migration files.');process.exitCode=1;}
finally{restore();runSupabase(['migration','up','--local'],true);await db.cleanup();}
if(report)console.info(JSON.stringify(report,null,2));

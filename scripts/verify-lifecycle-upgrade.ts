import assert from 'node:assert/strict';
import {readFileSync,renameSync,mkdtempSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
import {LocalSupabase} from '../tests/helpers/local-supabase.js';
import {localStatus,projectRoot,runSupabase} from './local-database.js';
import {databaseTables} from '../tests/fixtures/database-graph.js';
import {setTimeout as delay} from 'node:timers/promises';
import {spawnSync} from 'node:child_process';
import {localEnvironment} from './local-database.js';

assert.deepEqual(process.argv.slice(2),['--allow-disposable-reset'],'Explicit disposable-reset opt-in required.');localStatus();
const db=new LocalSupabase();const users=await(await db.admin('/auth/v1/admin/users?page=1&per_page=1','GET')).json() as {users:unknown[]};assert.equal(users.users.length,0,'Refusing a populated database.');
for(const table of [...databaseTables,'live_verification_allocations','account_deletion_receipts','ai_route_cost_blocks','vertex_policy_approval'])assert.equal((await(await db.admin(`/rest/v1/${table}?limit=1`,'GET')).json() as unknown[]).length,0,'Refusing retained product, verification, accounting or operator records.');
const names=['20261030000100_account_lifecycle.sql','20261030000200_account_export.sql','20261030000300_account_retention.sql','20261030000400_session_recovery.sql'];
mkdirSync(join(projectRoot,'test-results'),{recursive:true});const parked=mkdtempSync(join(projectRoot,'test-results/lifecycle-upgrade-'));const moved:string[]=[];const originals=new Map(names.map(name=>[name,readFileSync(join(projectRoot,'supabase/migrations',name))]));
let populated:LocalSupabase|undefined;let phase='base schema';let passed=false;
try{
 for(const name of names){renameSync(join(projectRoot,'supabase/migrations',name),join(parked,name));moved.push(name);}
 phase='reset base schema';runSupabase(['db','reset','--local','--no-seed','--yes'],true);
 populated=new LocalSupabase();phase='local API readiness after reset';
 const deadline=Date.now()+45_000;let ready=false;
 while(Date.now()<deadline){try{const auth=await populated.request('/auth/v1/health',null);const rest=await populated.request('/rest/v1/profiles?select=user_id&limit=1','admin');if(auth.ok&&rest.ok){ready=true;break;}}catch{/* Reset restarts local API containers. */}await delay(500);}
 assert(ready,'Local API readiness timed out.');
 phase='first Auth identity';const a=await populated.createUser();phase='second Auth identity';const b=await populated.createUser();phase='first product graph';await populated.seed(a.id);phase='second product graph';await populated.seed(b.id);
 async function snapshot(){const result:Record<string,unknown>={};for(const table of databaseTables)result[table]=await(await populated!.admin(`/rest/v1/${table}?order=${table==='profiles'?'user_id':'id'}`,'GET')).json();return result;}
 phase='snapshot before upgrade';const before=await snapshot();phase='forward migrations';
 for(const name of moved)renameSync(join(parked,name),join(projectRoot,'supabase/migrations',name));moved.length=0;runSupabase(['migration','up','--local'],true);
 assert.deepEqual(await snapshot(),before,'Lifecycle upgrade changed retained product, encrypted payload or budget rows.');
 phase='owned session and deletion fencing';const own=await populated.request(`/rest/v1/measurements?user_id=eq.${a.id}`,a.token);assert(own.ok);assert.equal((await own.json() as unknown[]).length,1);
 await populated.admin('/rest/v1/rpc/begin_account_deletion_v1','POST',{p_owner:a.id,p_password_at:new Date().toISOString()});
 assert.deepEqual(await(await populated.request('/rest/v1/measurements',a.token)).json(),[]);
 const denied=await populated.request('/rest/v1/rpc/update_settings_v1',a.token,{method:'POST',body:JSON.stringify({p_request:{client_request_id:crypto.randomUUID(),expected_updated_at:new Date().toISOString(),changes:{display_name:'Must not return'}}})});assert(!denied.ok);
 assert.equal((await(await populated.request('/rest/v1/measurements',b.token)).json() as unknown[]).length,1);
 phase='actual maintenance resumption';
 const maintenance=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/cleanup.ts'],{cwd:projectRoot,env:localEnvironment(),encoding:'utf8',timeout:60_000});assert.equal(maintenance.status,0,'Actual maintenance command failed.');
 const cleaned=JSON.parse(maintenance.stdout.trim()) as {deletionsResumed:number;pendingDeletions:number;unfinished:boolean};assert(cleaned.deletionsResumed>0,'Maintenance did not resume the fenced account.');assert.equal(cleaned.pendingDeletions,0);assert.equal(cleaned.unfinished,false);
 assert.deepEqual(await(await populated.admin(`/rest/v1/profiles?user_id=eq.${a.id}`,'GET')).json(),[]);assert.equal((await populated.request(`/auth/v1/admin/users/${a.id}`,'admin')).status,404);assert.equal((await(await populated.request('/rest/v1/measurements',b.token)).json() as unknown[]).length,1);
 console.info(JSON.stringify({scope:'local_synthetic_upgrade_maintenance',...cleaned}));
 passed=true;
}catch(error){const reason=error instanceof Error?error.message.split('\n')[0]:'unavailable';console.error(`Lifecycle forward-upgrade proof failed at ${phase}: ${reason}. Migration files are restored in finally.`);process.exitCode=1;}
finally{
 for(const name of moved)renameSync(join(parked,name),join(projectRoot,'supabase/migrations',name));for(const name of names)assert(readFileSync(join(projectRoot,'supabase/migrations',name)).equals(originals.get(name)!));
 runSupabase(['migration','up','--local'],true);if(populated)await populated.cleanup();
}
if(passed)console.info('PASS: populated two-owner forward upgrade preserved all product rows, ciphertext and paired accounting; deleting-owner denial and active-owner isolation verified.');

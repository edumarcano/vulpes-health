import assert from 'node:assert/strict';
import { readFileSync,renameSync,mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { LocalSupabase } from '../tests/helpers/local-supabase.js';
import { databaseTables } from '../tests/fixtures/database-graph.js';
import { localStatus,projectId,projectRoot,runSupabase,localEnvironment } from './local-database.js';
assert.deepEqual(process.argv.slice(2),['--allow-disposable-reset'],'Explicit disposable-reset opt-in required.');
localStatus();const db=new LocalSupabase();
const users=await(await db.admin('/auth/v1/admin/users?page=1&per_page=1','GET')).json() as {users:unknown[]};
assert.equal(users.users.length,0,'Refusing a populated database, including retained verification accounts.');
const names=['20261028000100_goal_approvals.sql','20261028000200_goal_draft_invalidation.sql'];
const parked=mkdtempSync(join(projectRoot,'test-results/goal-upgrade-'));const moved:string[]=[];
try{
 for(const name of names){renameSync(join(projectRoot,'supabase/migrations',name),join(parked,name));moved.push(name);}
 runSupabase(['db','reset','--local','--no-seed','--yes'],true);
 const user=await db.createUser();await db.seed(user.id);
 const snapshot=async()=>Object.fromEntries(await Promise.all(databaseTables.map(async table=>[table,await(await db.admin(`/rest/v1/${table}?user_id=eq.${user.id}&order=${table==='profiles'?'user_id':'id'}`,'GET')).json()])));
 const before=await snapshot();
 for(const name of names){const result=spawnSync('docker',['exec','-i',`supabase_db_${projectId}`,'psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{env:localEnvironment(),input:readFileSync(join(parked,name)),encoding:'utf8',timeout:30000});assert.equal(result.status,0,'Forward migration failed.');}
 const refreshed=spawnSync('docker',['exec',`supabase_db_${projectId}`,'psql','-U','postgres','-d','postgres','-c',"notify pgrst, 'reload schema'"],{env:localEnvironment(),encoding:'utf8'});
 assert.equal(refreshed.status,0,'Schema refresh failed.');
 const after=await snapshot();for(const row of after.action_proposals as Record<string,unknown>[])delete row.result;
 assert.deepEqual(after,before,'Forward migration changed pre-existing owned rows.');
 console.info('PASS: populated pre-M4 forward upgrade preserved all owned table snapshots.');
}finally{
 for(const name of moved)renameSync(join(parked,name),join(projectRoot,'supabase/migrations',name));
 await db.cleanup();
}

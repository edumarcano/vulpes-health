import {randomBytes,randomUUID} from 'node:crypto';
import {writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {mkdirSync,writeFileSync} from 'node:fs';
import {expect,it} from 'vitest';
import {withRecoverySource} from '../helpers/recovery-source.js';
import {captureDatabase} from '../../scripts/recovery-database.js';
import {databaseRecoveryCommand,databaseRecoveryBinding} from '../../scripts/hosted-database-recovery.js';
import {captureRecoveryJournal,recoveryPathHash,recoveryJournalQuery,verifyRecoveryJournal} from '../../scripts/recovery-journal.js';
import {targetHash} from '../../scripts/hosting.js';
import {recoveryAccountingExpression} from '../../scripts/recovery-accounting.js';

it('replays completed and unfinished post-backup deletions, revokes sessions and rechecks the source while access stays fenced',async()=>{
 await withRecoverySource(async f=>{
  for(const u of f.users)f.sql(`insert into auth.sessions(id,user_id) values('${u.session}','${u.id}');insert into auth.refresh_tokens(token,user_id,session_id) values('synthetic-${randomUUID()}','${u.id}','${u.session}');`);
  f.sql("insert into public.usage_buckets(scope,period_start,allocated_ceiling_usd,spent_usd) values('app',date_trunc('month',clock_timestamp())::date,1,0.01234567890123456789);");
  const original=f.sql("select allocated_ceiling_usd::text||','||spent_usd::text from public.usage_buckets where user_id is null;"),captured=await captureDatabase(f.target,f.source,f.keys);
  const a=f.users[0]!,b=f.users[1]!;
  f.sql(`select public.begin_account_deletion_v1('${a.id}',clock_timestamp());`);
  let done=false;for(let n=0;n<100;n++){const status=JSON.parse(f.sql(`select public.continue_account_deletion_v1('${a.id}',100);`)) as {phase:string};if(status.phase==='auth_removal_pending'){f.sql(`delete from auth.refresh_tokens where user_id='${a.id}';delete from auth.sessions where user_id='${a.id}';delete from auth.users where id='${a.id}';select public.finish_account_deletion_v1('${a.id}',true);`);done=true;break;}}expect(done).toBe(true);
  f.sql(`select public.begin_account_deletion_v1('${b.id}',clock_timestamp());`);
  const key={keyId:'synthetic-journal',journalKeyB64:randomBytes(32).toString('base64')},initial=join(f.root,'initial.enc'),latest=join(f.root,'current.enc'),archive=join(f.root,'database.vpb'),manifest=join(f.root,'manifest.json');
  const credentials=(path:string)=>({...key,accessToken:'sbp_synthetic',authorization:{purpose:'synthetic-recovery-journal-capture',targetSHA256:targetHash(f.target),outputPathSHA256:recoveryPathHash(path),expiresAt:new Date(Date.now()+3600000).toISOString(),approved:true,independentJournalCustody:true,separateKeyCustody:true}});
  let reads=0;const network:typeof fetch=async(url,init)=>{reads++;expect(String(url)).toBe('https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/database/query');expect(JSON.parse(String(init?.body))).toEqual({query:recoveryJournalQuery,read_only:true});return new Response('['+f.sql('begin read only;select row_to_json(s) from ('+recoveryJournalQuery.replace(/;\s*$/,'')+') s;rollback;')+']',{headers:{'Content-Type':'application/json'}});};
  const journal=await captureRecoveryJournal(f.target,initial,credentials(initial),network);await writeFile(initial,journal.archive,{flag:'wx'});await writeFile(archive,captured.archive,{flag:'wx'});await writeFile(manifest,JSON.stringify({target:f.target,targetSHA256:targetHash(f.target)}),{flag:'wx'});
  const httpProof={authImage:f.run(['inspect','--format','{{.Image}}','supabase_auth_vulpes-health-pr03-test']).toString().trim(),restImage:f.run(['inspect','--format','{{.Image}}','supabase_rest_vulpes-health-pr03-test']).toString().trim(),users:f.users.map(u=>({id:u.id,email:u.id+'@example.invalid',password:'synthetic-only-password'}))};
  const input={httpProof,backupKeyB64:f.keys.backup.toString('base64'),keyId:f.keys.keyId,traces:{activeId:f.keys.traces.activeId,keys:Object.fromEntries([...f.keys.traces.keys].map(([id,v])=>[id,v.toString('base64')]))},journal:credentials(latest),authorization:{purpose:'synthetic-fenced-database-recovery',targetSHA256:targetHash(f.target),bindingSHA256:databaseRecoveryBinding(captured.archive,f.image,journal.archive,latest,httpProof),expiresAt:new Date(Date.now()+3600000).toISOString(),approved:true}};
  let name:string|undefined;
  try{
   const report=await databaseRecoveryCommand(['--recover','--verify-http','--allow-fenced-restore','--allow-hosted-journal-read','--manifest='+manifest,'--archive='+archive,'--journal='+initial,'--journal-latest='+latest,'--image='+f.image],async()=>input,network,bytes=>{mkdirSync('.scratch/recovery-database-proof',{recursive:true});writeFileSync('.scratch/recovery-database-proof/http-'+randomUUID()+'.private.log',bytes);});
   name=(report as {destination:string}).destination;
   expect(report).toMatchObject({scope:'fenced_synthetic_database_recovery',authHttpVerified:true,apiHttpVerified:true,httpChecks:24,httpRetainedUsers:2,httpDeletedUsers:2,currentAccountingMatched:true,deletionsReplayed:2,sessionsRemoved:2,refreshTokensRemoved:2,sessionsRemaining:0,refreshTokensRemaining:0,oldSessionsTested:4,oldSessionsDenied:true,profilesTested:2,twoOwnerRlsVerified:true,currentJournalRechecked:true,unaffectedRowsPreserved:true,sharedChargesPreserved:true,restoreAccessAuthorized:false});
   mkdirSync('.scratch/recovery-database-proof',{recursive:true});writeFileSync('.scratch/recovery-database-proof/pass-'+randomUUID()+'.json',JSON.stringify(report));
   expect(reads).toBe(2);expect(f.run(['inspect','--format','{{.State.Running}}',name]).toString().trim()).toBe('false');
   expect(f.sql("select allocated_ceiling_usd::text||','||spent_usd::text from public.usage_buckets where user_id is null;")).toBe(original);
   const independentlyStored=verifyRecoveryJournal(await readFile(latest),f.target,{...key,backupCreatedAt:new Date(Date.now()-120000).toISOString()});expect(independentlyStored.journal.rows).toHaveLength(2);expect(independentlyStored.journal.rows.some(r=>r.phase==='fenced')).toBe(true);
   expect(JSON.stringify(report)).not.toContain(a.id);expect(JSON.stringify(report)).not.toContain(key.journalKeyB64);
  }finally{if(name){expect(name).toMatch(/^vulpes-recovery-[a-f0-9]{32}$/);f.run(['rm','-v',name]);}}
 },4);
},180000);

// Execute the production SQL: mocked hash differences cannot detect XML mapping bugs.
it('fingerprints actual shared spending, reservations and route blocks and rejects incomplete inventory',async()=>{
 await withRecoverySource(async f=>{
  f.sql("insert into public.usage_buckets(scope,period_start,allocated_ceiling_usd) values('app',date_trunc('month',clock_timestamp())::date,1);");
  const fingerprint=(change='')=>f.sql('begin;'+change+'select '+recoveryAccountingExpression+';rollback;');
  const baseline=fingerprint();expect(baseline).toMatch(/^[a-f0-9]{64}$/);
  for(const change of [
   "update public.usage_buckets set spent_usd=0.01 where user_id is null;",
   "update public.usage_buckets set reserved_usd=0.02 where user_id is null;",
   "insert into public.ai_route_cost_blocks(provider,model_id) values('openrouter','synthetic-recovery-drift');",
  ])expect(fingerprint(change)).not.toBe(baseline);
  expect(fingerprint()).toBe(baseline);
  expect(fingerprint('alter table public.vertex_policy_approval rename to synthetic_missing_policy;')).toBe('');
 });
},60000);

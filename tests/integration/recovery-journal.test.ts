import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {expect,it} from 'vitest';
import {assertLocalStack,projectId,projectRoot,localEnvironment} from '../../scripts/local-database.js';
import {captureRecoveryJournal,verifyRecoveryJournal,recoveryPathHash,recoveryJournalQuery} from '../../scripts/recovery-journal.js';
import {targetHash} from '../../scripts/hosting.js';

it('captures real PostgreSQL journal rows and validates the encrypted file through the actual offline CLI',async()=>{
 assertLocalStack();
 const database='vulpes_journal_'+randomUUID().replaceAll('-',''),container='supabase_db_'+projectId;
 const command=(db:string,query:string)=>{const r=spawnSync('docker',['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'],{cwd:projectRoot,env:localEnvironment(),input:query,encoding:'utf8',timeout:15000,maxBuffer:6*1024*1024});if(r.status!==0)throw Error('Isolated journal SQL fixture failed; private diagnostics omitted.');return r.stdout.trim();};
 const root=await mkdtemp(join(tmpdir(),'vulpes-journal-interface-'));
 command('postgres',`create database ${database};`);
 try{
  // A separate database preserves retained product data. Auth/Storage fixtures
  // contain only the columns the read-only guard queries; journal DDL is exact.
  const ddl=readFileSync(join(projectRoot,'supabase/migrations/20261030000100_account_lifecycle.sql'),'utf8').match(/create table public\.account_deletion_receipts \([\s\S]+?\n\);/)?.[0];expect(ddl).toBeTruthy();
  const deleted=randomUUID(),unfinished=randomUUID();
  command(database,`create schema auth; create table auth.users(id uuid primary key,email text);create schema storage;create table storage.objects(id uuid primary key);${ddl}
   insert into auth.users values('${unfinished}','synthetic-journal@example.invalid');
   insert into public.account_deletion_receipts(user_id,phase,outcome,completed_at) values('${deleted}','completed','completed',clock_timestamp()),('${unfinished}','auth_removal_pending','auth_unavailable',null);`);
  const before=command(database,'select jsonb_agg(to_jsonb(d) order by user_id) from public.account_deletion_receipts d;');
  const target={version:1,purpose:'synthetic-only',supabaseProjectRef:'abcdefghijklmnopqrst',recoveryProjectRef:null,databaseRegion:'us-east-1',vercelProjectId:'prj_SyntheticRecovery',appOrigin:'https://vulpes-synthetic.vercel.app'} as const;
  const output=join(root,'current.enc'),manifest=join(root,'manifest.json'),keys={keyId:'synthetic-only',journalKeyB64:randomBytes(32).toString('base64')},backupCreatedAt=new Date(Date.now()-60000).toISOString();
  let calls=0;
  const result=await captureRecoveryJournal(target,output,{...keys,accessToken:'sbp_synthetic_only',authorization:{purpose:'synthetic-recovery-journal-capture',targetSHA256:targetHash(target),outputPathSHA256:recoveryPathHash(output),expiresAt:new Date(Date.now()+3600000).toISOString(),approved:true,independentJournalCustody:true,separateKeyCustody:true}},async(url,init)=>{
   calls++;expect(String(url)).toBe('https://api.supabase.com/v1/projects/abcdefghijklmnopqrst/database/query');expect(JSON.parse(String(init?.body))).toEqual({query:recoveryJournalQuery,read_only:true});
   const json=command(database,'begin read only;select row_to_json(s) from ('+recoveryJournalQuery.replace(/;\s*$/,'')+') s;rollback;');
   return new Response('['+json+']',{headers:{'Content-Type':'application/json'}});
  });
  expect(calls).toBe(1);expect(result.report).toMatchObject({receipts:2,unfinishedRequests:1,sourceWrites:0,restoreAccessAuthorized:false});
  expect(verifyRecoveryJournal(result.archive,target,{...keys,backupCreatedAt}).journal.rows.map(r=>r.user_id).sort()).toEqual([deleted,unfinished].sort());
  expect(command(database,'select jsonb_agg(to_jsonb(d) order by user_id) from public.account_deletion_receipts d;')).toBe(before);
  await writeFile(output,result.archive,{flag:'wx'});await writeFile(manifest,JSON.stringify({target,targetSHA256:targetHash(target)}),{flag:'wx'});
  const cli=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/recovery-journal.ts','--verify','--manifest='+manifest,'--archive='+output],{cwd:projectRoot,env:localEnvironment(),input:JSON.stringify({...keys,backupCreatedAt}),encoding:'utf8',timeout:15000});
  expect(cli.status).toBe(0);expect(JSON.parse(cli.stdout)).toMatchObject({mode:'verify',receipts:2,unfinishedRequests:1,networkRequests:0,restoreAccessAuthorized:false});expect(cli.stdout+cli.stderr).not.toContain(deleted);expect(cli.stdout+cli.stderr).not.toContain(keys.journalKeyB64);
 }finally{command('postgres',`drop database ${database};`);await rm(root,{recursive:true,force:true});}
},30000);

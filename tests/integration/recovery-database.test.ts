import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {expect,it} from 'vitest';
import {isDeepStrictEqual} from 'node:util';
import {assertLocalStack,localEnvironment,projectId,projectRoot} from '../../scripts/local-database.js';
import {encryptBytes} from '../../server/security/encryption.js';
import {captureDatabase,restoreDatabase} from '../../scripts/recovery-database.js';
import {localRecoverySource,fencedRecoveryDestination} from '../../scripts/recovery-postgres.js';
import {databaseRestoreBinding} from '../../scripts/hosted-database-recovery.js';
import {targetHash} from '../../scripts/hosting.js';

it('encrypts a real complete database archive and restores it only into an isolated stopped container through the CLI',async()=>{
 assertLocalStack();const container='supabase_db_'+projectId,database='vulpes_capture_'+randomUUID().replaceAll('-','');
 function run(args:string[],input?:Buffer){const r=spawnSync('docker',args,{cwd:projectRoot,env:localEnvironment(),input,encoding:undefined,timeout:30000,maxBuffer:64*1024*1024});if(r.status!==0){mkdirSync(join(projectRoot,'.scratch/recovery-database-proof'),{recursive:true});writeFileSync(join(projectRoot,'.scratch/recovery-database-proof','fixture-'+randomUUID()+'.private.log'),r.stderr??String(r.error));throw Error('Synthetic recovery fixture failed; raw diagnostics omitted.');}return Buffer.from(r.stdout);}
 const sql=(db:string,statement:string)=>run(['exec','-i',container,'psql','-X','-qAt','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1'],Buffer.from(statement)).toString('utf8').trim();
 const image=run(['inspect','--format','{{.Image}}',container]).toString().trim(),root=await mkdtemp(join(tmpdir(),'vulpes-database-interface-'));
 let destination:ReturnType<typeof fencedRecoveryDestination>|undefined,cliDestination:string|undefined;
 sql('postgres',`create database ${database};`);
 try{
  sql(database,'create schema extensions;create schema vault;create extension pgcrypto with schema extensions;create extension "uuid-ossp" with schema extensions;create extension pg_stat_statements with schema extensions;create extension supabase_vault with schema vault;');
  const schema=run(['exec',container,'pg_dump','-U','postgres','-d','postgres','--format=custom','--schema-only','--schema=public','--schema=auth','--schema=supabase_migrations']);
  sql(database,'drop schema public cascade;');run(['exec','-i',container,'pg_restore','-U','supabase_admin','-d',database,'--exit-on-error','--single-transaction'],schema);schema.fill(0);
  sql(database,'create schema storage; create table storage.objects(id uuid primary key);');
  const traces={activeId:'synthetic-current',keys:new Map([['synthetic-current',randomBytes(32)],['synthetic-previous',randomBytes(32)]])},keys={backup:randomBytes(32),keyId:'synthetic-backup',traces};
  for(const keyId of traces.keys.keys()){
   const owner=randomUUID(),envelope=encryptBytes({id:randomUUID(),user_id:owner,purpose:'ai_request',expires_at:new Date(Date.now()+3600000).toISOString()},Buffer.from('Synthetic restored trace '+keyId),{...traces,activeId:keyId});
   sql(database,`insert into auth.users(id,email,encrypted_password) values('${owner}','${owner}@example.invalid',extensions.crypt('synthetic-only-password',extensions.gen_salt('bf')));insert into public.profiles(user_id,display_name) values('${owner}','Synthetic capture');insert into public.conversations(user_id,title) values('${owner}','Synthetic recovery conversation');insert into public.private_payloads select * from jsonb_populate_record(null::public.private_payloads,'${JSON.stringify({...envelope,created_at:new Date().toISOString()})}'::jsonb);`);
  }
  const target={version:1,purpose:'synthetic-only',supabaseProjectRef:'abcdefghijklmnopqrst',recoveryProjectRef:null,databaseRegion:'us-east-1',vercelProjectId:'prj_SyntheticRecovery',appOrigin:'https://vulpes-synthetic.vercel.app'} as const;
  const source=localRecoverySource(database),before=await source.snapshot(),captured=await captureDatabase(target,source,keys);expect(await source.snapshot()).toEqual(before);expect(captured.report.traceKeyVersions).toBe(2);
  destination=fencedRecoveryDestination(image,()=>{},stderr=>{mkdirSync(join(projectRoot,'.scratch/recovery-database-proof'),{recursive:true});writeFileSync(join(projectRoot,'.scratch/recovery-database-proof','restore-'+randomUUID()+'.private.log'),stderr);});
  const normalize=destination.normalize,comparisons:Awaited<ReturnType<typeof normalize>>[]=[];
  destination.normalize=async value=>{const result=await normalize(value);comparisons.push(result);if(comparisons.length===2&&!isDeepStrictEqual(comparisons[0],comparisons[1])){mkdirSync(join(projectRoot,'.scratch/recovery-database-proof'),{recursive:true});writeFileSync(join(projectRoot,'.scratch/recovery-database-proof','comparison-'+randomUUID()+'.private.json'),JSON.stringify(comparisons));console.info(JSON.stringify({differentSections:Object.keys(result).filter(k=>!isDeepStrictEqual(comparisons[0]![k as keyof typeof result],result[k as keyof typeof result])),catalogDifferences:Object.keys(result.catalog).filter(k=>!isDeepStrictEqual(comparisons[0]!.catalog[k],result.catalog[k]))}));}return result;};
  const restored=await restoreDatabase(target,captured.archive,keys,destination);expect(restored).toMatchObject({catalogAndRowsMatched:true,traceKeyVersions:2,network:'none',publishedPorts:0,restoreAccessAuthorized:false});
  expect(run(['inspect','--format','{{.State.Running}}',destination.name]).toString().trim()).toBe('false');await destination.assertFenced();
  const archive=join(root,'database.vpb'),manifest=join(root,'manifest.json');await writeFile(archive,captured.archive,{flag:'wx'});await writeFile(manifest,JSON.stringify({target,targetSHA256:targetHash(target)}),{flag:'wx'});
  const input={backupKeyB64:keys.backup.toString('base64'),keyId:keys.keyId,traces:{activeId:traces.activeId,keys:Object.fromEntries([...traces.keys].map(([id,key])=>[id,key.toString('base64')]))},authorization:{purpose:'synthetic-fenced-database-restore',targetSHA256:targetHash(target),bindingSHA256:databaseRestoreBinding(captured.archive,image),expiresAt:new Date(Date.now()+3600000).toISOString(),approved:true}};
  const cli=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/hosted-database-recovery.ts','--restore','--allow-fenced-restore','--manifest='+manifest,'--archive='+archive,'--image='+image],{cwd:projectRoot,env:localEnvironment(),input:JSON.stringify(input),encoding:'utf8',timeout:60000});
  expect(cli.status).toBe(0);const report=JSON.parse(cli.stdout);cliDestination=report.destination;expect(report).toMatchObject({catalogAndRowsMatched:true,restoreAccessAuthorized:false,network:'none'});expect(cli.stdout+cli.stderr).not.toContain(input.backupKeyB64);expect(run(['inspect','--format','{{.State.Running}}',cliDestination!]).toString().trim()).toBe('false');
 }finally{
  for(const name of [destination?.name,cliDestination])if(name){expect(name).toMatch(/^vulpes-recovery-[a-f0-9]{32}$/);run(['rm','-v',name]);}
  sql('postgres',`drop database ${database};`);await rm(root,{recursive:true,force:true});
 }
},90000);

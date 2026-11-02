import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {expect,it} from 'vitest';
import {isDeepStrictEqual} from 'node:util';
import {localEnvironment,projectRoot} from '../../scripts/local-database.js';
import {captureDatabase,restoreDatabase} from '../../scripts/recovery-database.js';
import {fencedRecoveryDestination} from '../../scripts/recovery-postgres.js';
import {databaseRestoreBinding} from '../../scripts/hosted-database-recovery.js';
import {targetHash} from '../../scripts/hosting.js';
import {withRecoverySource} from '../helpers/recovery-source.js';

it('encrypts a real complete database archive and restores it only into an isolated stopped container through the CLI',async()=>{
 await withRecoverySource(async ({root,image,keys,target,run,source})=>{
 let destination:ReturnType<typeof fencedRecoveryDestination>|undefined,cliDestination:string|undefined;
 try{
  const before=await source.snapshot(),captured=await captureDatabase(target,source,keys);expect(await source.snapshot()).toEqual(before);expect(captured.report.traceKeyVersions).toBe(2);
  destination=fencedRecoveryDestination(image,()=>{},stderr=>{mkdirSync(join(projectRoot,'.scratch/recovery-database-proof'),{recursive:true});writeFileSync(join(projectRoot,'.scratch/recovery-database-proof','restore-'+randomUUID()+'.private.log'),stderr);});
  const normalize=destination.normalize,comparisons:Awaited<ReturnType<typeof normalize>>[]=[];
  destination.normalize=async value=>{const result=await normalize(value);comparisons.push(result);if(comparisons.length===2&&!isDeepStrictEqual(comparisons[0],comparisons[1])){mkdirSync(join(projectRoot,'.scratch/recovery-database-proof'),{recursive:true});writeFileSync(join(projectRoot,'.scratch/recovery-database-proof','comparison-'+randomUUID()+'.private.json'),JSON.stringify(comparisons));console.info(JSON.stringify({differentSections:Object.keys(result).filter(k=>!isDeepStrictEqual(comparisons[0]![k as keyof typeof result],result[k as keyof typeof result])),catalogDifferences:Object.keys(result.catalog).filter(k=>!isDeepStrictEqual(comparisons[0]!.catalog[k],result.catalog[k]))}));}return result;};
  const restored=await restoreDatabase(target,captured.archive,keys,destination);expect(restored).toMatchObject({catalogAndRowsMatched:true,traceKeyVersions:2,network:'none',publishedPorts:0,restoreAccessAuthorized:false});
  expect(run(['inspect','--format','{{.State.Running}}',destination.name]).toString().trim()).toBe('false');await destination.assertFenced();
  const archive=join(root,'database.vpb'),manifest=join(root,'manifest.json');await writeFile(archive,captured.archive,{flag:'wx'});await writeFile(manifest,JSON.stringify({target,targetSHA256:targetHash(target)}),{flag:'wx'});
  const input={backupKeyB64:keys.backup.toString('base64'),keyId:keys.keyId,traces:{activeId:keys.traces.activeId,keys:Object.fromEntries([...keys.traces.keys].map(([id,key])=>[id,key.toString('base64')]))},authorization:{purpose:'synthetic-fenced-database-restore',targetSHA256:targetHash(target),bindingSHA256:databaseRestoreBinding(captured.archive,image),expiresAt:new Date(Date.now()+3600000).toISOString(),approved:true}};
  const cli=spawnSync(process.execPath,['node_modules/tsx/dist/cli.mjs','scripts/hosted-database-recovery.ts','--restore','--allow-fenced-restore','--manifest='+manifest,'--archive='+archive,'--image='+image],{cwd:projectRoot,env:localEnvironment(),input:JSON.stringify(input),encoding:'utf8',timeout:60000});
  expect(cli.status).toBe(0);const report=JSON.parse(cli.stdout);cliDestination=report.destination;expect(report).toMatchObject({catalogAndRowsMatched:true,restoreAccessAuthorized:false,network:'none'});expect(cli.stdout+cli.stderr).not.toContain(input.backupKeyB64);expect(run(['inspect','--format','{{.State.Running}}',cliDestination!]).toString().trim()).toBe('false');
 }finally{
  for(const name of [destination?.name,cliDestination])if(name){expect(name).toMatch(/^vulpes-recovery-[a-f0-9]{32}$/);run(['rm','-v',name]);}
 }
 });
},90000);

import {parseArgs} from 'node:util';
import {pathToFileURL,fileURLToPath} from 'node:url';
import {readFile,mkdir,writeFile,readdir,copyFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {HostingTargetSchema,hostingPlan,renderHostingConfig,targetHash} from './hosting.js';

const root=fileURLToPath(new URL('../',import.meta.url));
export async function prepareHosting(args:string[]){
  const v=parseArgs({args,strict:true,allowPositionals:false,options:{plan:{type:'boolean'},target:{type:'string'}}}).values;
  if(v.plan&&Object.keys(v).length===1)return hostingPlan;
  if(v.plan||!v.target)throw new Error('Use --plan or --target=<public target JSON>.');
  const target=HostingTargetSchema.parse(JSON.parse(await readFile(resolve(v.target),'utf8')));
  const config=renderHostingConfig(JSON.parse(await readFile(join(root,'vercel.json'),'utf8')),target);
  const hash=targetHash(target),directory=join(root,'.scratch/hosting',hash.slice(0,16));
  await mkdir(join(root,'.scratch/hosting'),{recursive:true});await mkdir(directory);
  const migrations=join(directory,'supabase/migrations');await mkdir(migrations,{recursive:true});
  const manifest=[];
  for(const name of (await readdir(join(root,'supabase/migrations'))).filter(n=>/^\d{14}_[a-z0-9_]+\.sql$/.test(n)).sort()){
    const source=join(root,'supabase/migrations',name),bytes=await readFile(source);
    manifest.push({file:name,sha256:createHash('sha256').update(bytes).digest('hex')});await copyFile(source,join(migrations,name));
  }
  if(!manifest.length)throw new Error('No reviewed migrations found.');
  const recoveryVerification=target.recoveryProjectRef===null?'deferred_no_destination':'not_run';
  await writeFile(join(directory,'supabase/config.toml'),'project_id = "vulpes-hosting-preparation"\n',{flag:'wx'});
  await writeFile(join(directory,'vercel.json'),JSON.stringify(config,null,2)+'\n',{flag:'wx'});
  await writeFile(join(directory,'manifest.json'),JSON.stringify({target,targetSHA256:hash,configSHA256:createHash('sha256').update(JSON.stringify(config)).digest('hex'),migrationDirectory:'supabase/migrations',
    migrationFiles:manifest,approval:'not_granted_by_preparation',hostedVerification:'not_run',recoveryVerification,realDataAuthorized:false,liveInference:false},null,2)+'\n',{flag:'wx'});
  return {prepared:true,targetSHA256:hash,directory:directory.slice(root.length).replaceAll('\\','/'),migrations:manifest.length,recoveryVerification,networkRequests:0,deploys:false};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)prepareHosting(process.argv.slice(2)).then(value=>console.info(JSON.stringify(value,null,2))).catch(()=>{console.error('Hosting preparation refused or failed. Existing output is never overwritten; inspect the public target and source configuration.');process.exitCode=1;});

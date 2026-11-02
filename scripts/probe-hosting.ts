import {parseArgs} from 'node:util';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {z} from 'zod';
import {HostingTargetSchema,targetHash,supabaseOrigin,type HostingTarget} from './hosting.js';
import {securityHeadersForSupabase} from '../server/http/security.js';

const routes=[
  {path:'/ask',status:200,kind:'html'},{path:'/goals',status:200,kind:'html'},
  {path:'/data',status:200,kind:'html'},{path:'/settings',status:200,kind:'html'},
  {path:'/api/status',status:200,kind:'status'},{path:'/api/does-not-exist',status:404,kind:'error'},
  ...['settings','data','goals','approvals','conversations','executions','chat','account'].map(name=>({path:'/api/'+name,status:401,kind:'error'})),
] as const;
async function readPublicJson(response:Response){
  const reader=response.body?.getReader();if(!reader)throw new Error('missing_response');
  const chunks:Uint8Array[]=[];let length=0;
  try{
    while(true){const next=await reader.read();if(next.done)break;length+=next.value.length;if(length>4096)throw new Error('response_limit');chunks.push(next.value);}
    return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
  }finally{await reader.cancel().catch(()=>undefined);reader.releaseLock();}
}
export async function probeHosting(target:HostingTarget,allowHosted:boolean,network:typeof fetch=fetch){
  if(!allowHosted)throw new Error('hosted_read_approval_required');
  const t=HostingTargetSchema.parse(target),headers=securityHeadersForSupabase(supabaseOrigin(t));
  const checks=[];
  for(const route of routes){
    try{
      const response=await network(t.appOrigin+route.path,{method:'GET',redirect:'error',credentials:'omit',cache:'no-store',signal:AbortSignal.timeout(10_000)});
      const contentType=response.headers.get('content-type')??'';
      let passed=response.status===route.status;
      for(const [key,value] of Object.entries(headers))if(key!=='Content-Security-Policy'||route.kind==='html')passed=passed&&response.headers.get(key)===value;
      if(route.kind==='html')passed=passed&&contentType.startsWith('text/html');
      else passed=passed&&contentType.startsWith('application/json')&&response.headers.get('cache-control')==='no-store';
      if(passed&&route.kind==='status'){
        passed=z.strictObject({data:z.strictObject({status:z.literal('ok')}),request_id:z.uuid()}).safeParse(await readPublicJson(response)).success;
      }
      if(passed&&route.kind==='error'){
        passed=z.strictObject({error:z.strictObject({code:z.string(),message:z.string(),retryable:z.boolean()}),request_id:z.uuid()}).safeParse(await readPublicJson(response)).success;
      }
      await response.body?.cancel().catch(()=>undefined);
      checks.push({path:route.path,status:passed?'passed':'failed'});
      if(!passed)break;
    }catch{checks.push({path:route.path,status:'failed'});break;}
  }
  return {scope:'unauthenticated-routing-and-headers',targetSHA256:targetHash(t),status:checks.length===routes.length&&checks.every(c=>c.status==='passed')?'passed':'failed',checks,
    authenticatedIsolation:'not_run',providerActivation:'not_checked',recovery:'not_run',candidateBinding:'verify deployment ID/commit separately',requests:checks.length};
}
export async function probeHostingCommand(args:string[],network:typeof fetch=fetch){
  const v=parseArgs({args,strict:true,allowPositionals:false,options:{plan:{type:'boolean'},manifest:{type:'string'},'allow-hosted':{type:'boolean'}}}).values;
  if(v.plan&&Object.keys(v).length===1)return {scope:'unauthenticated-routing-and-headers',requests:0,maximumRequests:routes.length,requiresApproval:true,authenticatedIsolation:'not_run',recovery:'not_run'};
  if(!v['allow-hosted'])throw new Error('hosted_read_approval_required');
  if(v.plan||!v.manifest)throw new Error('manifest_required');
  const manifest=z.object({target:HostingTargetSchema,targetSHA256:z.string()}).parse(JSON.parse(await readFile(resolve(v.manifest),'utf8')));
  if(manifest.targetSHA256!==targetHash(manifest.target))throw new Error('target_binding_mismatch');
  return probeHosting(manifest.target,true,network);
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href)probeHostingCommand(process.argv.slice(2)).then(report=>{console.info(JSON.stringify(report,null,2));if('status' in report&&report.status==='failed')process.exitCode=1;}).catch(()=>{console.error('Hosted probe refused or failed. Confirm explicit read approval, target manifest and deployment protection; no credentials or response bodies are logged.');process.exitCode=1;});

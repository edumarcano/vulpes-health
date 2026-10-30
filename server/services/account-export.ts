import { createHash,createCipheriv,createDecipheriv,randomBytes } from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {z} from 'zod';
import type {AccountRequest} from '../../shared/account.js';
import type {AuthContext} from '../auth/session.js';
import {administrativeClient} from '../db/administrative.js';
import {HttpFailure} from '../http/failure.js';
import {readPayload} from '../security/private-payloads.js';
import {InspectionService} from './inspection.js';

const ManifestSchema=z.strictObject({dataRevision:z.string(),sections:z.record(z.string(),z.strictObject({count:z.number().int().nonnegative(),fingerprint:z.string().regex(/^[a-f0-9]{64}$/)}))});
const PageSchema=z.strictObject({rows:z.array(z.record(z.string(),z.unknown())).max(200)});
export async function exportAccount(context:AuthContext,request:Extract<AccountRequest,{action:'export'}>,signal:AbortSignal) {
 const admin=administrativeClient();const startedAt=new Date().toISOString();
 async function manifest(){signal.throwIfAborted();const result=await admin.rpc('account_export_manifest_v1',{p_owner:context.userId}).abortSignal(signal);if(result.error)throw new HttpFailure(result.error.code==='PT409'?409:503,'export_unavailable','The account export could not be verified.');return ManifestSchema.parse(result.data);}
 const before=await manifest();const inspector=new InspectionService(context,signal);const expiries:number[]=[];
 const integrity:Record<string,{count:number;sha256:string}>={};
 async function* records(){
  yield JSON.stringify({schemaVersion:1,ownerId:context.userId,captureStartedAt:startedAt,dataRevision:before.dataRevision,traceParts:request.trace_parts}).slice(0,-1)+',"sections":{';
  let firstSection=true;
  for(const section of Object.keys(before.sections)){
   signal.throwIfAborted();yield (firstSection?'':',')+JSON.stringify(section)+':[';firstSection=false;
   const hash=createHash('sha256');let count=0;let after:string|undefined;
   do{
    const result=await admin.rpc('read_account_export_v1',{p_owner:context.userId,p_section:section,...(after?{p_after:after}:{})}).abortSignal(signal);
    if(result.error)throw new HttpFailure(result.error.code==='PT409'?409:503,'export_unavailable','The account export could not be read.');
    const page=PageSchema.parse(result.data);
    for(const row of page.rows){
     signal.throwIfAborted();let output:unknown=row;
     if(section==='staging' && row.state==='available'){
      const payload=await readPayload(context,z.uuid().parse(row.id),'import_staging',signal);
      if(payload.state==='available'){output={...row,encoding:'base64',bytes:payload.bytes.toString('base64')};payload.bytes.fill(0);expiries.push(Date.parse(z.string().parse(row.expires_at)));}
      else output={...row,state:payload.state};
     }
     if(section==='ai_steps' && request.trace_parts.length){
      const parts:Record<string,unknown>={};
      for(const part of request.trace_parts){
       signal.throwIfAborted();const evidence=await inspector.evidence({view:'export',run:z.uuid().parse(row.run_id),step:z.uuid().parse(row.id),part});
       if(evidence.state==='available'){
        parts[part]={state:'available',encoding:'base64',bytes:evidence.bytes.toString('base64'),expiresAt:evidence.expiresAt,...(evidence.completeness?{completeness:evidence.completeness}:{})};expiries.push(Date.parse(evidence.expiresAt));evidence.bytes.fill(0);
       }else parts[part]={state:evidence.state};
      }
      output={...row,traces:parts};
     }
     const text=JSON.stringify(output);hash.update(text+'\n');yield (count?',':'')+text;count++;
    }
    after=page.rows.length===200?z.string().parse(page.rows.at(-1)!.id):undefined;
   }while(after);
   if(count!==before.sections[section]!.count)throw new HttpFailure(409,'data_changed','Your account changed during export. Retry the export.');
   integrity[section]={count,sha256:hash.digest('hex')};yield ']';
  }
  const final=await manifest();
  if(JSON.stringify(final)!==JSON.stringify(before) || expiries.some(expiry=>expiry<=Date.now()))throw new HttpFailure(409,'data_changed','Your account changed or selected content expired during export. Retry the export.');
  yield '},"captureCompletedAt":'+JSON.stringify(new Date().toISOString())+',"inventory":'+JSON.stringify(before.sections)+',"integrity":'+JSON.stringify(integrity)+',"limitations":["Capture interval verified by section fingerprints; not a transactional backup.","Credentials, executor authority, opaque continuation state and shared operator configuration are excluded."]}';
 }
 const directory=await mkdtemp(join(tmpdir(),'vulpes-account-export-'));const file=join(directory,'data.enc');const key=randomBytes(32),nonce=randomBytes(12);const aad=Buffer.from(JSON.stringify([1,context.userId]));
 async function cleanup(){key.fill(0);await unlink(file).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;});await rmdir(directory);}
 try{
  const cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(aad);
  await pipeline(Readable.from(records()),cipher,createWriteStream(file,{flags:'wx',mode:0o600}),{signal});
  const tag=cipher.getAuthTag();
  return {cleanup,async validate(){const current=await manifest();if(JSON.stringify(current)!==JSON.stringify(before) || expiries.some(expiry=>expiry<=Date.now()))throw new HttpFailure(409,'data_changed','Your account changed during export. Retry the export.');},open(){const decipher=createDecipheriv('aes-256-gcm',key,nonce);decipher.setAAD(aad);decipher.setAuthTag(tag);return {ciphertext:createReadStream(file),decipher};}};
 }catch(error){await cleanup();throw error;}
}

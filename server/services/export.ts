import { z } from 'zod';
import {createCipheriv,createDecipheriv,randomBytes} from 'node:crypto';
import {createReadStream,createWriteStream} from 'node:fs';
import {mkdtemp,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Readable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import type { DataQuery } from '../../shared/data.js';
import type { AuthContext } from '../auth/session.js';
import { selectionWindows } from '../analytics/summary.js';
import { HttpFailure } from '../http/failure.js';

// Text fields get formula protection; trusted decimal strings never do.
export function csvText(value:string):string {
  const safe=/^[\s\p{Cc}\p{Cf}]*[=+\-@]/u.test(value) || /^[\t\r\n]/.test(value) ? "'"+value : value;
  return '"'+safe.replaceAll('"','""')+'"';
}
export function csvDecimal(value:string):string {
  if(!/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))throw new Error('Invalid stored decimal.');
  return '"'+value+'"';
}
const rowSchema=z.object({id:z.string().uuid(),canonical_value:z.string(),canonical_unit:z.string(),original_value:z.string(),original_unit:z.string(),observed_at:z.string(),
  metric_key:z.string(),source_id:z.string().uuid(),external_record_id:z.string().nullable(),local_date:z.string().nullable(),timezone:z.string().nullable(),
  granularity:z.string(),measurement_method:z.string(),quality_flags:z.array(z.string()),version:z.number().int(),original_offset_minutes:z.number().nullable(),
  import_batch_id:z.string().uuid().nullable(),fingerprint:z.string(),provenance:z.record(z.string(),z.unknown()),start_at:z.string().nullable(),end_at:z.string().nullable(),
  source:z.object({label:z.string(),kind:z.string(),namespace:z.string(),origin_app:z.string().nullable(),device_label:z.string().nullable()})});
const pageSchema=z.object({revision:z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),rows:z.array(rowSchema).max(200)});
const columns=['observed_at','metric','value','unit','source','granularity','external_record_id','local_date','timezone','method','quality_flags','schema_version','measurement_id','version','data_revision','original_value','original_unit','original_offset_minutes','source_id','source_kind','source_namespace','origin_app','device_label','import_batch_id','fingerprint','provenance','start_at','end_at'];
export async function exportMeasurements(context:AuthContext,query:Extract<DataQuery,{view:'export'}>,signal:AbortSignal=new AbortController().signal) {
  try{selectionWindows(query);}catch{throw new HttpFailure(400,'invalid_interval','Select 1–366 complete local calendar days with an explicit timezone.');}
  const source=await context.db.from('data_sources').select('id').eq('user_id',context.userId).eq('id',query.source_id).abortSignal(signal).maybeSingle();
  if(source.error)throw new HttpFailure(503,'data_unavailable','The export could not be loaded.');
  if(!source.data)throw new HttpFailure(404,'not_found','The selected source was not found.');
  let after:string|undefined;let revision=query.data_revision;
  async function* records(){
    yield columns.map(csvText).join(',')+'\r\n';
    do {
      signal.throwIfAborted();
      const {data,error}=await context.db.rpc('read_export_v1',{p_query:{...query,...(after ? {after_id:after} : {})}}).abortSignal(signal);
      if(error || data===null)throw new HttpFailure(503,'data_unavailable','The export could not be loaded.');
      const page=pageSchema.parse(data);
      if(revision!==undefined && revision!==page.revision)throw new HttpFailure(409,'data_changed','Your data changed during export. Refresh and export again.');
      revision=page.revision;
      for(const r of page.rows) {
        yield [csvText(r.observed_at),csvText(r.metric_key),csvDecimal(r.canonical_value),csvText(r.canonical_unit),csvText(r.source.label),csvText(r.granularity),
          csvText(r.external_record_id??''),csvText(r.local_date??''),csvText(r.timezone??''),csvText(r.measurement_method),csvText(r.quality_flags.join(';')),
          '1',csvText(r.id),String(r.version),String(revision),csvDecimal(r.original_value),csvText(r.original_unit),r.original_offset_minutes===null ? '' : String(r.original_offset_minutes),
          csvText(r.source_id),csvText(r.source.kind),csvText(r.source.namespace),csvText(r.source.origin_app??''),csvText(r.source.device_label??''),csvText(r.import_batch_id??''),csvText(r.fingerprint),csvText(JSON.stringify(r.provenance)),csvText(r.start_at??''),csvText(r.end_at??'')].join(',')+'\r\n';
      }
      after=page.rows.length===200 ? page.rows.at(-1)!.id : undefined;
    }while(after);
    const end=await context.db.rpc('read_data_v1',{p_query:{view:'sources',limit:1}}).abortSignal(signal);
    if(end.error || end.data===null)throw new HttpFailure(503,'data_unavailable','The export could not be verified.');
    if(z.object({revision:z.number()}).parse(end.data).revision!==revision)throw new HttpFailure(409,'data_changed','Your data changed during export. Refresh and export again.');
  }
  // No plaintext export is persisted. The random key lives only for this request;
  // a process crash leaves unreadable ciphertext, never a recoverable CSV.
  const directory=await mkdtemp(join(tmpdir(),'vulpes-export-'));
  const file=join(directory,'data.enc');const key=randomBytes(32),nonce=randomBytes(12);const aad=Buffer.from(JSON.stringify([1,context.userId]));
  async function cleanup(){key.fill(0);await unlink(file).catch((e:NodeJS.ErrnoException)=>{if(e.code!=='ENOENT')throw e;});await rmdir(directory);}
  try{
    const cipher=createCipheriv('aes-256-gcm',key,nonce);cipher.setAAD(aad);
    await pipeline(Readable.from(records()),cipher,createWriteStream(file,{flags:'wx',mode:0o600}),{signal});
    const tag=cipher.getAuthTag();
    return {revision:revision!,cleanup,open(){const decipher=createDecipheriv('aes-256-gcm',key,nonce);decipher.setAAD(aad);decipher.setAuthTag(tag);return {ciphertext:createReadStream(file),decipher};}};
  }catch(error){await cleanup();throw error;}
}

import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash,randomBytes,randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll,beforeAll,describe,expect,it,vi } from 'vitest';
import { LocalSupabase } from '../helpers/local-supabase.js';
import { localStatus } from '../../scripts/local-database.js';
import { localRouter } from '../../server/http/router.js';
import { ImportPreviewSchema,ImportResultSchema,type PreviewCsv,type ImportPreview } from '../../shared/imports.js';
import { successEnvelopeSchema } from '../../shared/api.js';
import { readPayload,writePayload } from '../../server/security/private-payloads.js';
import { verifySession } from '../../server/auth/session.js';
const csv=readFileSync('docs/spec/v0.1.0/fixtures/measurements-synthetic.csv','utf8');
const base:PreviewCsv={action:'preview_csv',client_request_id:randomUUID(),csv,source:{kind:'new',label:'Synthetic CSV scale',origin_app:'Synthetic import',device_label:null},mapping:{schema_version:1,format:'canonical',timezone:'UTC',profile:null,single_profile:true,review_requested:false,source_label:'Synthetic Scale A'}};
let db:LocalSupabase;let a:{id:string;token:string};let b:{id:string;token:string};let origin:string;
const server=createServer(localRouter);
async function post(body:unknown,token:string|null=a.token) {return fetch(origin+'/api/data',{method:'POST',headers:{'Content-Type':'application/json',...(token ? {Authorization:`Bearer ${token}`} : {})},body:JSON.stringify(body)});}
async function preview(body:PreviewCsv={...base,client_request_id:randomUUID()}) {const r=await post(body);expect(r.status).toBe(200);return successEnvelopeSchema(ImportPreviewSchema).parse(await r.json()).data;}
function commitBody(p:ImportPreview) {return {action:'commit_import',batch_id:p.batch_id,payload_hash:p.payload_hash,client_request_id:randomUUID()};}
async function commit(p:ImportPreview) {const r=await post(commitBody(p));expect(r.status).toBe(200);return successEnvelopeSchema(ImportResultSchema).parse(await r.json()).data;}
async function readings(source:string) {return await(await db.admin(`/rest/v1/measurements?source_id=eq.${source}&select=id,import_batch_id,canonical_value,original_value,provenance`,'GET')).json() as Array<Record<string,unknown>>;}
beforeAll(async()=>{const c=localStatus();vi.stubEnv('VITE_SUPABASE_URL',c.apiUrl);vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY',c.anonKey);vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY',c.adminKey);vi.stubEnv('VULPES_TRACE_ENCRYPTION_KEY_ID','synthetic-import');vi.stubEnv('VULPES_TRACE_ENCRYPTION_KEY_B64',randomBytes(32).toString('base64'));vi.stubEnv('VULPES_LIVE_AI_ENABLED','false');
  db=new LocalSupabase();a=await db.createUser();b=await db.createUser();for(const u of [a,b])await db.admin('/rest/v1/profiles','POST',{user_id:u.id,display_name:'Synthetic CSV tester'});
  server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address || typeof address==='string')throw new Error();origin=`http://127.0.0.1:${address.port}`;
});
afterAll(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));try{if(db)await db.cleanup();}finally{vi.unstubAllEnvs();}});
describe('real encrypted CSV HTTP transactions',()=>{
  it('excludes second-60 rows from preview and commit while retaining valid boundary readings',async()=>{
    const p=await preview({...base,client_request_id:randomUUID(),csv:'observed_at,metric,value,unit,source,granularity,timezone,method\n2026-09-01T23:59:60Z,weight,70,kg,Synthetic Scale A,instant,UTC,device_reported\n2026-09-01T23:59:59.123456Z,weight,69,kg,Synthetic Scale A,instant,UTC,device_reported'});
    expect(p.counts).toMatchObject({new:1,invalid:1});expect(p.errors[0]).toMatchObject({row:2,column:'value'});
    expect(p.preview).toHaveLength(1);expect(p.preview[0]!.observed_at).toBe('2026-09-01T23:59:59.123456Z');
    expect((await commit(p)).inserted).toBe(1);
    const stored=await db.request(`/rest/v1/measurements?source_id=eq.${p.source_id}&select=observed_at`,a.token);
    expect(await stored.json()).toEqual([{observed_at:'2026-09-01T23:59:59.123456+00:00'}]);
  });
  it('previews 28 observations without measurement writes, commits once, erases staging, and returns historical reimport',async()=>{
    const request={...base,client_request_id:randomUUID()};const p=await preview(request);expect(p.counts).toMatchObject({observations:28,new:28,duplicate:0,conflict:0,invalid:0});expect(await readings(p.source_id)).toHaveLength(0);
    const raw=await(await db.admin(`/rest/v1/private_payloads?user_id=eq.${a.id}`,'GET')).json() as Array<{id:string;encrypted_bytes:string;content_hash:string}>;expect(raw).toHaveLength(1);expect(raw[0]!.content_hash).toBe(p.payload_hash);expect(raw[0]!.encrypted_bytes).not.toContain('observed_at');
    expect(await preview(request)).toEqual(p);
    const result=await commit(p);expect(result).toMatchObject({inserted:28,duplicate:0,dataRevision:p.dataRevision+1});expect(await readings(p.source_id)).toHaveLength(28);
    expect(await(await db.admin(`/rest/v1/private_payloads?id=eq.${raw[0]!.id}`,'GET')).json()).toEqual([]);
    expect(await commit(p)).toEqual(result);
    const history=await preview({...base,client_request_id:randomUUID(),source:{kind:'existing',id:p.source_id}});expect(history.historical_result).toEqual(result);
    expect(await readings(p.source_id)).toHaveLength(28);
    const summary=await fetch(origin+'/api/data?'+new URLSearchParams({view:'summary',source_id:p.source_id,metric:'weight',from:'2026-09-01T00:00:00Z',to:'2026-09-15T00:00:00Z',timezone:'UTC',method:'device_reported',granularity:'instant'}),{headers:{Authorization:`Bearer ${a.token}`}});
    expect(summary.status).toBe(200);const artifact=await summary.json() as {data:{analysis:{value:number;previousValue:number;absoluteChange:number}}};expect(artifact.data.analysis).toMatchObject({value:69,previousValue:69.7,absoluteChange:-0.7});
    console.info(JSON.stringify({artifact:'csv_http',synthetic:true,previewNew:p.counts.new,inserted:result.inserted,...artifact.data.analysis}));
  });
  it('imports five wide observations with exact lb conversion and blank exclusion',async()=>{
    const p=await preview({...base,client_request_id:randomUUID(),csv:readFileSync('docs/spec/v0.1.0/fixtures/wide-synthetic.csv','utf8'),mapping:{schema_version:1,format:'wide',timezone:'UTC',profile:null,single_profile:true,review_requested:false,timestamp_column:'Recorded At',local_date_column:null,external_id_column:null,granularity:'instant',metrics:[{column:'Mass (lb)',metric:'weight',unit:'lb',method:'device_reported'},{column:'Fat (%)',metric:'body_fat_percent',unit:'%',method:'device_estimate'}]}});
    expect(p.counts).toMatchObject({new:5,blank:1});expect(p.ignored_columns).toEqual(['Notes']);expect(p.preview[0]!.value).toBe('68.0388555');expect((await commit(p)).inserted).toBe(5);
    const row=(await readings(p.source_id)).find(r=>r.original_value==='150.0');expect(row?.canonical_value).toBe(68.0388555);
  });
  it('classifies altered external identities and within-file collisions without silently overwriting',async()=>{
    const p=await preview();await commit(p);const conflict=await preview({...base,client_request_id:randomUUID(),source:{kind:'existing',id:p.source_id},csv:csv.replace('70.0','71.0')});
    expect(conflict.counts).toMatchObject({new:0,duplicate:27,conflict:1});const result=await commit(conflict);expect(result).toMatchObject({inserted:0,conflict:1,dataRevision:p.dataRevision+1});expect(await readings(p.source_id)).toHaveLength(28);
    const lines=csv.trim().split(/\r?\n/);const internal=await preview({...base,client_request_id:randomUUID(),csv:[lines[0],lines[1],lines[1]!.replace('70.0','71.0'),lines[2]].join('\n')});expect(internal.counts).toMatchObject({new:1,conflict:2});expect((await commit(internal)).inserted).toBe(1);
  });
  it('rejects foreign, anonymous, changed hash, forged bytes and ciphertext before any measurement write',async()=>{
    const p=await preview();expect((await post(commitBody(p),b.token)).status).toBe(404);expect((await post(commitBody(p),null)).status).toBe(401);
    expect((await post({...commitBody(await preview()),payload_hash:'0'.repeat(64)})).status).toBe(409);
    const forged=await db.request('/rest/v1/rpc/commit_import_v1',a.token,{method:'POST',body:JSON.stringify({p_request:commitBody(p),p_bytes:'{}'})});expect(forged.status).toBe(409);
    const batch=await(await db.admin(`/rest/v1/import_batches?id=eq.${p.batch_id}`,'GET')).json() as Array<{staging_payload_id:string}>;
    await db.admin(`/rest/v1/private_payloads?id=eq.${batch[0]!.staging_payload_id}`,'PATCH',{encrypted_bytes:`\\x${'00'.repeat(32)}`});
    expect((await post(commitBody(p))).status).toBe(409);expect(await readings(p.source_id)).toEqual([]);
    for(const token of [a.token,b.token,'anon'])expect([401,403]).toContain((await db.request('/rest/v1/private_payloads?select=*',token)).status);
    expect([401,403]).toContain((await db.request('/rest/v1/rpc/classify_import_v1',a.token,{method:'POST',body:JSON.stringify({p_owner:a.id,p_source:p.source_id,p_rows:[]})})).status);
    expect([401,403]).toContain((await db.request('/rest/v1/import_batches',a.token,{method:'POST',body:'{}'})).status);
  });
  it('rejects expired and stale previews while preserving owned rows and revision',async()=>{
    const p=await preview();await db.admin(`/rest/v1/import_batches?id=eq.${p.batch_id}`,'PATCH',{created_at:new Date(Date.now()-120000).toISOString(),expires_at:new Date(Date.now()-60000).toISOString()});expect((await post(commitBody(p))).status).toBe(409);expect(await readings(p.source_id)).toEqual([]);
    const stale=await preview();const mutation=await post({action:'add_measurement',client_request_id:randomUUID(),source:{kind:'existing',id:stale.source_id},observation:{metric:'weight',value:'80',unit:'kg',observed_at:'2026-09-20T08:00:00Z',timezone:'UTC',local_date:null,granularity:'instant',method:'device_reported',quality_flags:[]}});expect(mutation.status).toBe(200);
    expect((await post(commitBody(stale))).status).toBe(409);expect(await readings(stale.source_id)).toHaveLength(1);
  });
  it('binds the preview to source metadata and records expired or failed terminal state',async()=>{
    const p=await preview();await db.admin(`/rest/v1/data_sources?id=eq.${p.source_id}`,'PATCH',{source_namespace:randomUUID()});expect((await post(commitBody(p))).status).toBe(409);
    expect(await readings(p.source_id)).toEqual([]);expect(await(await db.admin(`/rest/v1/import_batches?id=eq.${p.batch_id}&select=status,staging_payload_id`,'GET')).json()).toEqual([{status:'failed',staging_payload_id:null}]);
    const expired=await preview();await db.admin(`/rest/v1/import_batches?id=eq.${expired.batch_id}`,'PATCH',{created_at:new Date(Date.now()-120000).toISOString(),expires_at:new Date(Date.now()-60000).toISOString()});expect((await post(commitBody(expired))).status).toBe(409);
    expect(await(await db.admin(`/rest/v1/import_batches?id=eq.${expired.batch_id}&select=status,staging_payload_id`,'GET')).json()).toEqual([{status:'expired',staging_payload_id:null}]);
  });
  it('serializes concurrent commit requests and binds direct registration to exact owned staging',async()=>{
    const p=await preview();const body=commitBody(p);const responses=await Promise.all([post(body),post(body)]);expect(responses.map(r=>r.status)).toEqual([200,200]);expect(await responses[0]!.json()).toMatchObject(await responses[1]!.json().then((r:{data:unknown})=>({data:r.data})));
    expect(await readings(p.source_id)).toHaveLength(28);
    const pending=await preview();const batch=await(await db.admin(`/rest/v1/import_batches?id=eq.${pending.batch_id}`,'GET')).json() as Array<{staging_payload_id:string}>;const id=batch[0]!.staging_payload_id;
    const context=await verifySession({headers:{authorization:`Bearer ${a.token}`}});const payload=await readPayload(context,id,'import_staging');expect(payload.state).toBe('available');
    const repeated=await db.request('/rest/v1/rpc/register_import_v1',a.token,{method:'POST',body:JSON.stringify({p_payload_id:id,p_bytes:payload.state==='available' ? payload.bytes.toString() : ''})});expect(repeated.status).toBe(200);
    expect((await readPayload(context,id,'import_staging')).state).toBe('available');
    const changed=await db.request('/rest/v1/rpc/register_import_v1',a.token,{method:'POST',body:JSON.stringify({p_payload_id:id,p_bytes:'{}'})});expect(changed.status).toBe(409);
    const foreign=await db.request('/rest/v1/rpc/register_import_v1',b.token,{method:'POST',body:JSON.stringify({p_payload_id:id,p_bytes:payload.state==='available' ? payload.bytes.toString() : ''})});expect(foreign.status).toBe(404);
    expect(await readings(pending.source_id)).toHaveLength(0);
  });
  it('handles the 5,000-observation boundary without truncation',async()=>{
    const lines=csv.trim().split(/\r?\n/);const large=[lines[0],...Array.from({length:5000},()=>lines[1])].join('\n');
    const p=await preview({...base,client_request_id:randomUUID(),csv:large});expect(p.counts).toMatchObject({observations:5000,new:1,duplicate:4999,invalid:0});
    expect((await commit(p)).inserted).toBe(1);expect(await readings(p.source_id)).toHaveLength(1);
  },60000);
  it('commits 5,000 distinct readings transactionally under the normal database timeout',async()=>{
    const lines=csv.trim().split(/\r?\n/);const large=[lines[0],...Array.from({length:5000},(_,i)=>`${new Date(Date.UTC(2026,8,1,8,0,i)).toISOString()},weight,70.0,kg,Synthetic Scale A,instant,bulk-${i},,UTC,device_reported`)].join('\n');
    const p=await preview({...base,client_request_id:randomUUID(),csv:large});expect(p.counts).toMatchObject({observations:5000,new:5000,duplicate:0});expect((await commit(p)).inserted).toBe(5000);
    const count=await db.request(`/rest/v1/measurements?source_id=eq.${p.source_id}&select=id`,'admin',{headers:{Prefer:'count=exact',Range:'0-0'}});expect(count.headers.get('content-range')).toBe('0-0/5000');
  },60000);
  it('rejects oversized normalized staging before storing any envelope and cleans failed registration',async()=>{
    const names=Array.from({length:8},(_,i)=>`Column${i}`.padEnd(200,'x'));const text=[['Time',...names].join(','),...Array.from({length:625},()=>['2026-09-01T08:00:00Z',...names.map(()=>'70')].join(','))].join('\n');
    const before=await(await db.admin(`/rest/v1/private_payloads?user_id=eq.${a.id}&select=id&order=id`,'GET')).json();
    const r=await post({...base,client_request_id:randomUUID(),csv:text,mapping:{schema_version:1,format:'wide',timezone:'UTC',profile:null,single_profile:true,review_requested:false,timestamp_column:'Time',local_date_column:null,external_id_column:null,granularity:'instant',metrics:names.map(column=>({column,metric:'weight',unit:'kg',method:'device_reported'}))}});expect(r.status).toBe(413);expect(await r.json()).toMatchObject({error:{code:'staging_too_large'}});
    expect(await(await db.admin(`/rest/v1/private_payloads?user_id=eq.${a.id}&select=id&order=id`,'GET')).json()).toEqual(before);
    const request={...base,client_request_id:randomUUID()};await preview(request);const registered=await(await db.admin(`/rest/v1/private_payloads?user_id=eq.${a.id}&select=id&order=id`,'GET')).json();
    expect((await post({...request,csv:csv.replace('70.0','71.0')})).status).toBe(409);
    expect(await(await db.admin(`/rest/v1/private_payloads?user_id=eq.${a.id}&select=id&order=id`,'GET')).json()).toEqual(registered);
  });
  it('historical reimport never restores a subsequently removed reading',async()=>{
    const p=await preview();const result=await commit(p);const rows=await readings(p.source_id);await db.admin(`/rest/v1/measurements?id=eq.${rows[0]!.id}`,'DELETE');await db.admin(`/rest/v1/profiles?user_id=eq.${a.id}`,'PATCH',{data_revision:result.dataRevision+1});
    const replay=await preview({...base,client_request_id:randomUUID(),source:{kind:'existing',id:p.source_id}});expect(replay.historical_result).toEqual(result);expect(await commit(replay)).toEqual(result);expect(await readings(p.source_id)).toHaveLength(27);
  });
  it('rolls back every insert and the revision when a later staged row violates a database constraint',async()=>{
    const p=await preview();const context=await verifySession({headers:{authorization:`Bearer ${a.token}`}});
    const batch=await(await db.admin(`/rest/v1/import_batches?id=eq.${p.batch_id}&select=staging_payload_id`,'GET')).json() as Array<{staging_payload_id:string}>;
    const staged=await readPayload(context,batch[0]!.staging_payload_id,'import_staging');expect(staged.state).toBe('available');if(staged.state!=='available')throw new Error();
    // Trusted synthetic setup supplies an invalid second row to exercise the SQL
    // rollback boundary; ordinary clients cannot write encrypted envelopes.
    const bundle=JSON.parse(staged.bytes.toString()) as {client_request_id:string;observations:Array<{canonical_value:string;original_value:string}>};bundle.client_request_id=randomUUID();bundle.observations[1]!.canonical_value='-1';bundle.observations[1]!.original_value='-1';
    const bytes=Buffer.from(JSON.stringify(bundle));const payload=await writePayload(context,'import_staging',bytes);
    const registration=await db.request('/rest/v1/rpc/register_import_v1',a.token,{method:'POST',body:JSON.stringify({p_payload_id:payload.id,p_bytes:bytes.toString()})});expect(registration.status).toBe(200);const registered=await registration.json() as {id:string;source_id:string};
    const malformed={action:'commit_import',client_request_id:randomUUID(),batch_id:registered.id,payload_hash:createHash('sha256').update(bytes).digest('hex')};expect((await post(malformed)).status).toBe(409);
    const response=await db.request('/rest/v1/rpc/commit_import_v1',a.token,{method:'POST',body:JSON.stringify({p_request:malformed,p_bytes:bytes.toString()})});expect(response.status).toBe(400);expect(await readings(registered.source_id)).toEqual([]);
    const profile=await(await db.admin(`/rest/v1/profiles?user_id=eq.${a.id}&select=data_revision`,'GET')).json();expect(profile).toEqual([{data_revision:p.dataRevision}]);
  });
  it('retains bounded source warnings through staging, commit and owned measurement reads',async()=>{
    const lines=csv.trim().split(/\r?\n/);const flagged=lines[0]+',quality_flags\n'+lines[1]+',source_warning;device_estimate_uncertain';
    const p=await preview({...base,client_request_id:randomUUID(),csv:flagged,mapping:{...base.mapping,review_requested:true}});expect(p.counts).toMatchObject({new:1,invalid:0});await commit(p);
    const r=await db.request(`/rest/v1/measurements?source_id=eq.${p.source_id}&select=quality_flags`,a.token);expect(await r.json()).toEqual([{quality_flags:['source_warning','device_estimate_uncertain','review_requested']}]);
  });
});

import {createServer} from 'node:http';
import {once} from 'node:events';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {readdir,readFile,access} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Writable} from 'node:stream';
import {pipeline} from 'node:stream/promises';
import {parse} from 'csv-parse/sync';
import {afterAll,beforeAll,describe,expect,it,vi} from 'vitest';
import {LocalSupabase} from '../helpers/local-supabase.js';
import {localStatus} from '../../scripts/local-database.js';
import {localRouter} from '../../server/http/router.js';
import {verifySession} from '../../server/auth/session.js';
import {cleanupExpiredData,readPayload,writePayload} from '../../server/security/private-payloads.js';
import {encryptBytes,readEncryptionKeys} from '../../server/security/encryption.js';
import {exportMeasurements} from '../../server/services/export.js';
import type {AddMeasurement,MeasurementMutation} from '../../shared/data.js';
import type {ImportPreview,PreviewCsv} from '../../shared/imports.js';
let db:LocalSupabase;let a:{id:string;token:string};let b:{id:string;token:string};let origin:string;
const server=createServer(localRouter);
const csv=readFileSync('docs/spec/v0.1.0/fixtures/measurements-synthetic.csv','utf8');
const base:AddMeasurement={action:'add_measurement',client_request_id:randomUUID(),source:{kind:'new',label:'Synthetic lifecycle',origin_app:null,device_label:null},observation:{metric:'weight',value:'70',unit:'kg',observed_at:'2026-09-08T08:00:00Z',timezone:'UTC',local_date:null,granularity:'instant',method:'device_reported',quality_flags:[]}};
const previewBase:PreviewCsv={action:'preview_csv',client_request_id:randomUUID(),csv,source:base.source,mapping:{schema_version:1,format:'canonical',source_label:'Synthetic Scale A',timezone:'UTC',profile:null,single_profile:true,review_requested:false}};
async function http(body:unknown,token:string|null=a.token){return fetch(origin+'/api/data',{method:'POST',headers:{'Content-Type':'application/json',...(token ? {Authorization:`Bearer ${token}`} : {})},body:JSON.stringify(body)});}
async function success<T>(response:Response):Promise<T>{expect(response.status).toBe(200);return (await response.json() as {data:T}).data;}
type Ack={id:string;sourceId:string;version:number;dataRevision:number;baselinesMarked:number;previewsInvalidated:number;tracePayloadsRemoved:number;outcome:string};
async function add(patch:Partial<AddMeasurement>={},token=a.token){return success<Ack>(await http({...base,client_request_id:randomUUID(),...patch},token));}
async function preview(patch:Partial<PreviewCsv>={}){return success<ImportPreview>(await http({...previewBase,client_request_id:randomUUID(),...patch}));}
const commitBody=(p:ImportPreview)=>({action:'commit_import',batch_id:p.batch_id,payload_hash:p.payload_hash,client_request_id:randomUUID()});
const correction=(r:{id:string;version:number},value='69'):MeasurementMutation=>({action:'correct_measurement',measurement_id:r.id,expected_version:r.version,client_request_id:randomUUID(),changes:{value,unit:'kg',observed_at:base.observation.observed_at,timezone:'UTC',local_date:null}});
const deletion=(r:{id:string;version:number}):MeasurementMutation=>({action:'delete_measurement',measurement_id:r.id,expected_version:r.version,client_request_id:randomUUID()});
const query=(source:string,view='summary',extra:Record<string,string>={})=>'/api/data?'+new URLSearchParams({view,source_id:source,metric:'weight',from:'2026-09-01T00:00:00Z',to:'2026-09-15T00:00:00Z',timezone:'UTC',method:'device_reported',granularity:'instant',...extra});
const get=(path:string,token:string|null=a.token)=>fetch(origin+path,{headers:token ? {Authorization:`Bearer ${token}`} : {}});
async function rows(table:string,filter:string){return await(await db.admin(`/rest/v1/${table}?${filter}`,'GET')).json() as Array<Record<string,unknown>>;}
async function revision(){return (await rows('profiles',`user_id=eq.${a.id}&select=data_revision`))[0]!.data_revision as number;}
beforeAll(async()=>{
  const c=localStatus();vi.stubEnv('VITE_SUPABASE_URL',c.apiUrl);vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY',c.anonKey);vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY',c.adminKey);vi.stubEnv('VULPES_TRACE_ENCRYPTION_KEY_ID','synthetic-lifecycle');vi.stubEnv('VULPES_TRACE_ENCRYPTION_KEY_B64',randomBytes(32).toString('base64'));vi.stubEnv('VULPES_LIVE_AI_ENABLED','false');
  db=new LocalSupabase();a=await db.createUser();b=await db.createUser();for(const u of [a,b])await db.admin('/rest/v1/profiles','POST',{user_id:u.id,display_name:'Synthetic lifecycle tester'});
  server.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();if(!address || typeof address==='string')throw new Error();origin=`http://127.0.0.1:${address.port}`;
});
afterAll(async()=>{server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));try{if(db)await db.cleanup();}finally{vi.unstubAllEnvs();}});
describe('real M2 correction/deletion/export transactions',()=>{
  it('demonstrates import → exact analysis → correction → deletion → surviving export → historical replay',async()=>{
    const p=await preview();const committed=await success<{inserted:number;dataRevision:number}>(await http(commitBody(p)));expect(committed.inserted).toBe(28);
    const before=await success<{analysis:{value:number;previousValue:number;absoluteChange:number}}>(await get(query(p.source_id)));expect(before.analysis).toMatchObject({value:69,previousValue:69.7,absoluteChange:-0.7});
    const imported=(await rows('measurements',`source_id=eq.${p.source_id}&metric_key=eq.weight&order=observed_at`))[7]!;
    const request=correction({id:imported.id as string,version:1},'76.3');const corrected=await success<Ack>(await http(request));expect(corrected).toMatchObject({version:2,dataRevision:committed.dataRevision+1,outcome:'corrected'});
    const current=(await rows('measurements',`id=eq.${imported.id}`))[0]!;
    for(const field of ['id','source_id','import_batch_id','metric_key','external_record_id','granularity','measurement_method'])expect(current[field]).toEqual(imported[field]);
    expect(current.provenance).toEqual({...imported.provenance as object,user_corrected:true});expect(current.quality_flags).toEqual(['user_corrected']);
    const after=await success<{analysis:{value:number}}>(await get(query(p.source_id)));expect(after.analysis.value).toBeCloseTo(70,9);
    const pending=await preview({source:{kind:'existing',id:p.source_id},csv:csv.replace('70.0','71.0')});
    const deleted=await success<Ack>(await http(deletion({id:imported.id as string,version:2})));expect(deleted).toMatchObject({outcome:'deleted',dataRevision:corrected.dataRevision+1,previewsInvalidated:1});
    expect(await rows('measurements',`id=eq.${imported.id}`)).toEqual([]);
    expect((await http(commitBody(pending))).status).toBe(409);expect(await rows('private_payloads',`user_id=eq.${a.id}&purpose=eq.import_staging`)).toEqual([]);
    expect(await success<Ack>(await http(request))).toEqual(corrected);expect(await revision()).toBe(deleted.dataRevision);
    const final=await success<{analysis:{value:number}}>(await get(query(p.source_id)));expect(final.analysis.value).toBeCloseTo(68.95,9);
    const exported=await get(query(p.source_id,'export'));expect(exported.headers.get('cache-control')).toBe('no-store');expect(exported.headers.get('content-type')).toContain('text/csv');expect(exported.headers.get('content-disposition')).toContain('attachment');
    const records=parse(await exported.text(),{columns:true}) as Array<Record<string,string>>;expect(records).toHaveLength(13);expect(records.every(r=>r.schema_version==='1' && r.source_id===p.source_id && r.measurement_id!==imported.id)).toBe(true);
    const historical=await preview({source:{kind:'existing',id:p.source_id}});expect(historical.historical_result).toMatchObject({inserted:28,dataRevision:committed.dataRevision});
    expect((await rows('measurements',`source_id=eq.${p.source_id}`))).toHaveLength(27);expect(await revision()).toBe(deleted.dataRevision);
    console.info(JSON.stringify({artifact:'m2_lifecycle_http',synthetic:true,imported:28,before:before.analysis,correctedMean:after.analysis.value,deletedMean:final.analysis.value,survivingWeightExport:records.length,historicalReplayRestored:0}));
    const lines=csv.trim().split(/\r?\n/);const fresh=await preview({source:{kind:'existing',id:p.source_id},csv:[lines[0],lines[15]].join('\n')});expect(fresh.counts.new).toBe(1);expect((await success<{inserted:number}>(await http(commitBody(fresh)))).inserted).toBe(1);expect(await rows('measurements',`source_id=eq.${p.source_id}`)).toHaveLength(28);
  });
  it('serializes competing corrections, rejects stale deletion, and replays one receipt without advancing revision',async()=>{
    const r=await add();const first=correction(r,'68');const second=correction(r,'67');
    const responses=await Promise.all([http(first),http(second)]);expect(responses.map(r=>r.status).sort()).toEqual([200,409]);
    const winner=responses[0]!.ok ? first : second;const ack=await success<Ack>(responses.find(r=>r.ok)!);expect(ack.dataRevision).toBe(r.dataRevision+1);
    expect((await http(deletion(r))).status).toBe(409);expect(await success<Ack>(await http(winner))).toEqual(ack);
    expect((await http({...winner,changes:{...winner.action==='correct_measurement' ? winner.changes : {},value:'66'}})).status).toBe(409);
    const persisted=(await rows('measurements',`id=eq.${r.id}`))[0]!;expect(persisted.version).toBe(2);expect(await revision()).toBe(ack.dataRevision);
    const dr=deletion({id:r.id,version:2});const deletes=await Promise.all([http(dr),http(dr)]);expect(deletes.map(r=>r.status)).toEqual([200,200]);const d1=await success<Ack>(deletes[0]!);expect(await success<Ack>(deletes[1]!)).toEqual(d1);expect(await revision()).toBe(ack.dataRevision+1);
  });
  it('rejects conflicts and invalid direct RPC changes atomically, preserving identity and prior readings',async()=>{
    const r=await add();await add({source:{kind:'existing',id:r.sourceId},observation:{...base.observation,observed_at:'2026-09-09T08:00:00Z'}});
    const request=correction(r);if(request.action!=='correct_measurement')throw new Error();const rev=await revision();
    expect((await http({...request,changes:{...request.changes,observed_at:'2026-09-09T08:00:00Z'}})).status).toBe(409);
    for(const changes of [{...request.changes,value:'-1'},{...request.changes,value:69},{...request.changes,unit:'bpm'},{...request.changes,timezone:'bad'},{...request.changes,observed_at:'2026-11-01T01:30:00',timezone:'America/New_York'},{...request.changes,metric:'height'},{...request.changes,local_date:'2026-02-31'}]){
      const response=await db.request('/rest/v1/rpc/mutate_measurement_v1',a.token,{method:'POST',body:JSON.stringify({p_request:{...request,client_request_id:randomUUID(),changes}})});expect(response.ok).toBe(false);
    }
    expect((await rows('measurements',`id=eq.${r.id}`))[0]).toMatchObject({version:1,canonical_value:70});expect(await revision()).toBe(rev);
  });
  it('serializes competing correction and deletion and marks matching baselines on correction',async()=>{
    const r=await add();const frozen={schema_version:1,value:'70'};const goal=randomUUID();
    await db.admin('/rest/v1/goals','POST',{id:goal,user_id:a.id,title:'Synthetic frozen baseline',metric_key:'weight',canonical_unit:'kg',direction:'decrease_to',target_value:65,source_id:r.sourceId,baseline_snapshot:frozen});
    const before=(await rows('goals',`id=eq.${goal}`))[0]!;const corrected=await success<Ack>(await http(correction(r)));expect(corrected.baselinesMarked).toBe(1);
    const after=(await rows('goals',`id=eq.${goal}`))[0]!;expect(after).toEqual({...before,review_status:'needs_review',version:2,updated_at:after.updated_at});
    const competing=await add();const results=await Promise.all([http(correction(competing)),http(deletion(competing))]);expect(results.filter(r=>r.status===200)).toHaveLength(1);expect(results.filter(r=>[404,409].includes(r.status))).toHaveLength(1);expect(await revision()).toBe(competing.dataRevision+1);
    const persisted=await rows('measurements',`id=eq.${competing.id}`);if(results[0]!.ok)expect(persisted[0]).toMatchObject({version:2,canonical_value:69});else expect(persisted).toEqual([]);
  });
  it('changes value/unit and offset/time/date using exact arithmetic and daily-date rules',async()=>{
    const r=await add();const request=correction(r,'150');if(request.action!=='correct_measurement')throw new Error();
    await success(await http({...request,changes:{...request.changes,unit:'lb',observed_at:'2026-09-09T08:00:00',timezone:'America/New_York'}}));
    expect((await rows('measurements',`id=eq.${r.id}`))[0]).toMatchObject({canonical_value:68.0388555,original_value:'150',original_unit:'lb',original_offset_minutes:-240,observed_at:'2026-09-09T12:00:00+00:00',timezone:'America/New_York'});
    const daily=await add({observation:{...base.observation,metric:'steps_daily',unit:'count',value:'100',granularity:'daily_total',local_date:'2026-09-08'}});const edit=correction(daily,'101');if(edit.action!=='correct_measurement')throw new Error();
    expect((await http({...edit,changes:{...edit.changes,unit:'count',local_date:'2026-09-09'}})).status).toBe(400);
    expect((await http({...edit,changes:{...edit.changes,unit:'count',local_date:'2026-09-09',observed_at:'2026-09-09T08:00:00Z'}})).status).toBe(200);
  });
  it('marks frozen baselines and purges owned exact traces while keeping goals, revisions, accounting and foreign payloads',async()=>{
    const u=await db.createUser();const foreign=await db.createUser();const g=await db.seed(u.id);const other=await db.seed(foreign.id);
    const frozen={schema_version:1,value:'70',measurementIds:[g.ids.measurements],from:'2026-09-01T00:00:00Z',to:'2026-10-08T00:00:00Z'};
    await db.admin(`/rest/v1/goals?id=eq.${g.ids.goals}`,'PATCH',{state:'active',baseline_snapshot:frozen});
    const before=(await rows('goals',`id=eq.${g.ids.goals}`))[0]!;const approved=await rows('goal_revisions',`goal_id=eq.${g.ids.goals}`);
    const context=await verifySession({headers:{authorization:`Bearer ${u.token}`}});
    for(const purpose of ['ai_request','ai_response','tool_input','tool_output','provider_state'] as const)await writePayload(context,purpose,Buffer.from('Synthetic exact trace'));
    const result=await success<Ack>(await http(deletion({id:g.ids.measurements,version:1}),u.token));expect(result.baselinesMarked).toBe(1);expect(result.tracePayloadsRemoved).toBe(6);
    const goal=(await rows('goals',`id=eq.${g.ids.goals}`))[0]!;expect(goal).toEqual({...before,review_status:'needs_review',version:2,updated_at:goal.updated_at});
    expect(await rows('goal_revisions',`goal_id=eq.${g.ids.goals}`)).toEqual(approved);expect(await rows('private_payloads',`user_id=eq.${u.id}`)).toEqual([]);
    expect((await rows('ai_steps',`user_id=eq.${u.id}`))[0]).toMatchObject({input_payload_id:null,output_payload_id:null});expect((await rows('ai_runs',`user_id=eq.${u.id}`))[0]!.trace_content_removed_at).not.toBeNull();
    expect(await rows('usage_reservations',`user_id=eq.${u.id}`)).toHaveLength(1);expect(await rows('private_payloads',`user_id=eq.${foreign.id}`)).toHaveLength(1);expect((await rows('goals',`id=eq.${other.ids.goals}`))[0]!.review_status).toBe('clear');
    const next=await add({source:{kind:'existing',id:g.ids.data_sources}},u.token);await success(await http(correction(next),u.token));expect((await rows('goals',`id=eq.${g.ids.goals}`))[0]!.version).toBe(2);
    const receipts=await rows('audit_events',`user_id=eq.${u.id}&event_type=eq.data_mutation_v1`);expect(JSON.stringify(receipts)).not.toContain('Synthetic exact trace');expect(JSON.stringify(receipts)).not.toContain('canonical_value');
  });
  it('races a pending import commit with correction or deletion without restoring a deleted record',async()=>{
    for(const operation of ['correct','delete']){
      const r=await add();const p=await preview({source:{kind:'existing',id:r.sourceId},csv:csv.split(/\r?\n/).slice(0,2).join('\n')});
      const [imported,mutated]=await Promise.all([http(commitBody(p)),http(operation==='correct' ? correction(r) : deletion(r))]);expect(mutated.status).toBe(200);expect([200,409]).toContain(imported.status);
      const current=await rows('measurements',`id=eq.${r.id}`);expect(current).toHaveLength(operation==='delete' ? 0 : 1);expect(await revision()).toBe(r.dataRevision+1+(imported.ok ? 1 : 0));
      expect(await rows('private_payloads',`user_id=eq.${a.id}&purpose=eq.import_staging`)).toEqual([]);
    }
  });
  it('protects CSV text, preserves exact negative numbers and source/provenance identifiers',async()=>{
    const r=await add({source:{kind:'new',label:'=1+1,"synthetic"\nnext',origin_app:'\t@SUM(1)',device_label:' -device'},observation:{...base.observation,metric:'renpho.visceral_fat_index',unit:'index',value:'-1.250000000000000001',quality_flags:['review_requested']}});
    const response=await get(query(r.sourceId,'export',{metric:'renpho.visceral_fat_index'}));expect(response.status).toBe(200);
    const exported=parse(await response.text(),{columns:true}) as Array<Record<string,string>>;expect(exported).toHaveLength(1);
    expect(exported[0]).toMatchObject({value:'-1.250000000000000001',original_value:'-1.250000000000000001',source:'\'=1+1,"synthetic"\nnext',origin_app:"'@SUM(1)",device_label:"'-device",measurement_id:r.id,source_id:r.sourceId,schema_version:'1'});
    expect(JSON.parse(exported[0]!.provenance!)).toMatchObject({adapter:'manual'});
  });
  it('exports revision-bound pages and rejects a mutation between pages instead of returning partial CSV',async()=>{
    const lines=csv.trim().split(/\r?\n/);const p=await preview({csv:[lines[0],...Array.from({length:205},(_,i)=>`2026-09-08T${String(Math.floor(i/60)).padStart(2,'0')}:${String(i%60).padStart(2,'0')}:00Z,weight,70,kg,Synthetic Scale A,instant,page-${i},,UTC,device_reported`)].join('\n')});await success(await http(commitBody(p)));
    const full=await get(query(p.source_id,'export'));expect(full.status).toBe(200);expect(parse(await full.text(),{columns:true})).toHaveLength(205);
    const original=globalThis.fetch;let changed=false;const spy=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{
      const response=await original(input,init);if(!changed && String(input).endsWith('/rpc/read_export_v1')){changed=true;await add();}return response;
    });
    try{const response=await get(query(p.source_id,'export'));expect(response.status).toBe(409);expect(response.headers.get('content-type')).toContain('application/json');expect(await response.text()).not.toContain('measurement_id');}finally{spy.mockRestore();}
    expect(changed).toBe(true);
  });
  it('denies foreign IDs, anonymous/forged sessions, ownership injection and direct table writes',async()=>{
    const foreign=await add({},b.token);const rev=await revision();
    for(const body of [correction(foreign),deletion(foreign)])expect((await http(body)).status).toBe(404);
    expect((await get(query(foreign.sourceId,'export'))).status).toBe(404);
    for(const token of [null,'forged']){expect((await http(deletion(foreign),token)).status).toBe(401);expect((await get(query(foreign.sourceId,'export'),token)).status).toBe(401);}
    expect((await http({...deletion(foreign),user_id:b.id})).status).toBe(400);
    expect((await db.request('/rest/v1/measurements?id=eq.'+foreign.id,a.token,{method:'PATCH',body:'{"version":3}'})).status).toBe(403);
    for(const rpc of ['mutate_measurement_v1','read_export_v1','cleanup_data_v1'])expect([401,403]).toContain((await db.request('/rest/v1/rpc/'+rpc,'anon',{method:'POST',body:JSON.stringify(rpc==='mutate_measurement_v1' ? {p_request:deletion(foreign)} : rpc==='read_export_v1' ? {p_query:{}} : {})})).status);
    expect(await revision()).toBe(rev);expect((await rows('measurements',`id=eq.${foreign.id}`))[0]!.version).toBe(1);
  });
  it('uses only encrypted temporary export bytes and removes the artifact on completion and abort',async()=>{
    const r=await add({source:{kind:'new',label:'Synthetic private export canary',origin_app:null,device_label:null}});
    const context=await verifySession({headers:{authorization:`Bearer ${a.token}`}});const query={view:'export' as const,source_id:r.sourceId,metric:'weight' as const,from:'2026-09-01T00:00:00Z',to:'2026-09-15T00:00:00Z',timezone:'UTC',method:'device_reported' as const,granularity:'instant' as const};
    const before=new Set(await readdir(tmpdir()));const result=await exportMeasurements(context,query);
    const created=(await readdir(tmpdir())).filter(name=>name.startsWith('vulpes-export-') && !before.has(name));expect(created).toHaveLength(1);
    const directory=join(tmpdir(),created[0]!);const bytes=await readFile(join(directory,'data.enc'));expect(bytes.includes(Buffer.from('Synthetic private export canary'))).toBe(false);expect(bytes.includes(Buffer.from('observed_at'))).toBe(false);
    const chunks:Buffer[]=[];try{const streams=result.open();await pipeline(streams.ciphertext,streams.decipher,new Writable({write(chunk:Buffer,_encoding,callback){chunks.push(chunk);callback();}}));expect(Buffer.concat(chunks).toString()).toContain('Synthetic private export canary');}finally{await result.cleanup();}
    await expect(access(directory)).rejects.toMatchObject({code:'ENOENT'});
    const controller=new AbortController();const original=globalThis.fetch;let aborted=false;const spy=vi.spyOn(globalThis,'fetch').mockImplementation(async(input,init)=>{const response=await original(input,init);if(!aborted && String(input).endsWith('/rpc/read_export_v1')){aborted=true;controller.abort();}return response;});
    try{await expect(exportMeasurements(context,query,controller.signal)).rejects.toBeDefined();}finally{spy.mockRestore();}
    expect(aborted).toBe(true);expect((await readdir(tmpdir())).filter(name=>name.startsWith('vulpes-export-') && !before.has(name))).toEqual([]);
  });
  it('cleans expired previews after inactivity through bounded owner work and the guarded maintenance command',async()=>{
    const p=await preview();const foreign=await writePayload(await verifySession({headers:{authorization:`Bearer ${b.token}`}}),'import_staging',Buffer.from('Synthetic foreign staging'));
    await db.admin(`/rest/v1/import_batches?id=eq.${p.batch_id}`,'PATCH',{created_at:new Date(Date.now()-120000).toISOString(),expires_at:new Date(Date.now()-60000).toISOString()});
    const npm=process.env.npm_execpath;if(!npm)throw new Error();const cli=spawnSync(process.execPath,[npm,'run','maintenance:cleanup'],{encoding:'utf8',timeout:20000});expect(cli.status).toBe(0);expect(cli.stdout).toContain('"expired":1');
    expect((await rows('import_batches',`id=eq.${p.batch_id}`))[0]).toMatchObject({status:'expired',staging_payload_id:null});expect((await http(commitBody(p))).status).toBe(409);
    const now=Date.now();const expiredAt=new Date(now-60000).toISOString();const envelopes=Array.from({length:101},()=>({...encryptBytes({id:randomUUID(),user_id:a.id,purpose:'import_staging',expires_at:expiredAt},Buffer.from('Synthetic expired staging'),readEncryptionKeys()),created_at:new Date(now-120000).toISOString()}));await db.admin('/rest/v1/private_payloads','POST',envelopes);
    expect(await cleanupExpiredData(a.id)).toEqual({payloadsRemoved:100,batchesExpired:0,workCount:100});expect(await cleanupExpiredData(a.id)).toEqual({payloadsRemoved:1,batchesExpired:0,workCount:1});
    expect((await readPayload(await verifySession({headers:{authorization:`Bearer ${b.token}`}}),foreign.id,'import_staging')).state).toBe('available');
    const invalid=await db.request('/rest/v1/rpc/cleanup_data_v1','admin',{method:'POST',body:'{"p_batch_size":101}'});expect(invalid.ok).toBe(false);
  });
});

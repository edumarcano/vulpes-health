import { randomBytes,randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { localStatus } from '../../scripts/local-database.js';
import { prepareSyntheticBatch } from '../../scripts/live-verification-batch.js';
import { LocalSupabase } from '../helpers/local-supabase.js';
import { cleanupTables } from '../fixtures/database-graph.js';
import { syntheticPrice } from '../fixtures/executions.js';
import { priceFingerprint } from '../../server/ai/live-preflight.js';
import { everydayAdapterVersion,everydayTemplateVersion } from '../../server/config/everyday-versions.js';

let db:LocalSupabase;let app:string;let batch:string;let batches:string[];
beforeEach(async()=>{
  const local=localStatus();vi.stubEnv('VITE_SUPABASE_URL',local.apiUrl);vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY',local.anonKey);vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY',local.adminKey);
  vi.stubEnv('VULPES_TRACE_ENCRYPTION_KEY_ID','synthetic-batch');vi.stubEnv('VULPES_TRACE_ENCRYPTION_KEY_B64',randomBytes(32).toString('base64'));
  db=new LocalSupabase();app=randomUUID();batch=randomUUID();batches=[batch];
  await db.admin('/rest/v1/usage_buckets','POST',{id:app,scope:'app',period_start:new Date().toISOString().slice(0,7)+'-01',allocated_ceiling_usd:'1'});
});
afterEach(async()=>{
  try {
    for(const id of batches) {
    const records=await (await db.admin(`/rest/v1/live_verification_allocations?id=eq.${id}`,'GET')).json() as Array<{user_id:string}>;
    if(records[0]) {
      // Test-only superuser cleanup of the exact freshly generated allocation.
      // Production service credentials cannot delete this immutable record.
      const sql=`delete from public.live_verification_allocations where id='${id}'::uuid`;
      const removed=spawnSync('docker',['exec','supabase_db_vulpes-health-pr03-test','psql','-U','postgres','-d','postgres','-c',sql],{encoding:'utf8'});
      expect(removed.status).toBe(0);
      const user=records[0].user_id;
      for(const table of cleanupTables)await db.admin(`/rest/v1/${table}?user_id=eq.${user}`,'DELETE');
      await db.admin(`/auth/v1/admin/users/${user}`,'DELETE');
    }
    }
    await db.admin(`/rest/v1/usage_buckets?id=eq.${app}`,'DELETE');
  } finally {vi.unstubAllGlobals();vi.doUnmock('../../server/config/models.js');vi.doUnmock('../../server/config/everyday-verification.js');vi.resetModules();vi.unstubAllEnvs();}
});

it('runs the same guarded dispatcher with a synthetic provider, then retains the shared ceiling',async()=>{
  const price={...syntheticPrice,inputPerMillion:'0.1',outputPerMillion:'0.1',cacheReadPerMillion:'0.1',inputBoundTokens:12000,outputBoundTokens:3072};
  const config={modelId:'synthetic-model',reasoning:{effort:'low'},maxInputTokens:12000,maxOutputTokens:3072,price};
  const evidence={version:1,provider:'openrouter',model:config.modelId,effort:'low',adapterVersion:everydayAdapterVersion,templateVersion:everydayTemplateVersion,priceId:price.id,priceHash:priceFingerprint(price),inputBoundTokens:12000,outputBoundTokens:3072,streaming:true,tools:true,zdr:true,checkedAt:price.checkedAt,sourceURL:'https://example.test/capabilities'};
  vi.doMock('../../server/config/models.js',()=>({models:{everyday:config}}));
  vi.doMock('../../server/config/everyday-verification.js',()=>({everydayCapabilityEvidence:evidence}));
  vi.stubEnv('VULPES_LIVE_AI_ENABLED','true');vi.stubEnv('VULPES_SMOKE_BATCH_ID',batch);vi.stubEnv('OPENROUTER_API_KEY','synthetic-not-a-real-key');
  const {SyntheticChatTransport,responseFrame,assistantOutput}=await import('../fixtures/chat.js');
  let transport=new SyntheticChatTransport();
  const network=vi.fn(async(_url:string|URL|Request,init?:RequestInit)=>{
    const iterator=transport.send(new Uint8Array(init!.body as Uint8Array),init!.signal as AbortSignal);
    const stream=new ReadableStream<Uint8Array>({async pull(controller){const next=await iterator.next();if(next.done)controller.close();else controller.enqueue(next.value);},async cancel(){await iterator.return?.();}});
    return new Response(stream,{status:200,headers:{'Content-Type':'text/event-stream'}});
  }) as unknown as typeof fetch;
  const {runLiveEveryday}=await import('../../scripts/live-everyday.js');
  const localFetch=globalThis.fetch;
  vi.stubGlobal('fetch',async(input:string|URL|Request,init?:RequestInit)=>{
    const url=input instanceof Request?input.url:String(input);
    if(url==='https://openrouter.ai/api/v1/responses')return network(input,init);
    if(!url.startsWith('http://127.0.0.1:54321/'))throw new Error('unexpected_network');
    return localFetch(input,init);
  });
  const {runSmoke}=await import('../../scripts/provider-smoke.js');
  const first=(await runSmoke(['--mode=live','--role=everyday','--allow-spend','--max-cost-usd=0.004'],process.env)).report;
  if(first.mode!=='live')throw new Error('Expected synthetic transport live-path report.');
  expect(first).toMatchObject({result:'passed',actualProviderRequests:3,costUSD:'0.003',costStatus:'reported',reservationUSD:'0',maxCostUSD:'0.004',batchSpentUSD:'0.003',exactRequestsVerified:true,ownedToolEvidenceVerified:true,reloadVerified:true});expect(Number(first.batchReservedUSD)).toBe(0);
  transport=new SyntheticChatTransport();const second=await runLiveEveryday('0.004',true,process.env,network);
  expect(second).toMatchObject({result:'failed',failureCode:'budget_exhausted',actualProviderRequests:0});
  expect(vi.mocked(network)).toHaveBeenCalledTimes(3);
  const uncertainBatch=randomUUID();batches.push(uncertainBatch);vi.stubEnv('VULPES_SMOKE_BATCH_ID',uncertainBatch);
  const disconnected=vi.fn(async()=>{throw new Error('synthetic_disconnect');}) as unknown as typeof fetch;
  const failed=await runLiveEveryday('0.0017',true,process.env,disconnected);
  expect(failed).toMatchObject({result:'failed',failureCode:'execution_interrupted',actualProviderRequests:1,costUSD:null,costStatus:'pending'});
  expect(Number(failed.reservationUSD)).toBeGreaterThan(0);expect(Number(failed.batchReservedUSD)).toBeGreaterThan(0);
  const refused=await runLiveEveryday('0.0017',true,process.env,disconnected);
  expect(refused).toMatchObject({result:'failed',failureCode:'budget_exhausted',actualProviderRequests:0});expect(vi.mocked(disconnected)).toHaveBeenCalledTimes(1);
  const cancelBatch=randomUUID();batches.push(cancelBatch);vi.stubEnv('VULPES_SMOKE_BATCH_ID',cancelBatch);transport=new SyntheticChatTransport('slow');
  const cancelled=await runLiveEveryday('0.01',true,process.env,network,'cancel');
  expect(cancelled).toMatchObject({scenario:'cancel',result:'passed',actualProviderRequests:1,costUSD:null,costStatus:'pending',exactRequestsVerified:true});
  expect(Number(cancelled.reservationUSD)).toBeGreaterThan(0);
  const wrongBatch=randomUUID();batches.push(wrongBatch);vi.stubEnv('VULPES_SMOKE_BATCH_ID',wrongBatch);transport=new SyntheticChatTransport();let calls=0;
  const wrongAnswer=vi.fn(async(_url:string|URL|Request,init?:RequestInit)=>{
    calls++;
    if(calls===3)return new Response(Uint8Array.from(responseFrame([assistantOutput('The synthetic mean is 69.7 kg and increased 0.7 kg.')])),{status:200,headers:{'Content-Type':'text/event-stream'}});
    return network(_url,init);
  }) as unknown as typeof fetch;
  const incorrect=await runLiveEveryday('0.01',true,process.env,wrongAnswer);
  expect(incorrect).toMatchObject({result:'failed',failureCode:'verification_answer_inconsistent',actualProviderRequests:3,costUSD:'0.003'});
});

it('creates one synthetic fixture allocation, reuses it, and refuses changed ceilings or data',async()=>{
  const first=await prepareSyntheticBatch(batch,'0.1');
  const second=await prepareSyntheticBatch(batch,'0.1');
  expect(second.context.userId).toBe(first.context.userId);expect(second.fixtureHash).toBe(first.fixtureHash);
  await expect(prepareSyntheticBatch(batch,'0.2')).rejects.toThrow('verification_allocation_mismatch');
  await db.admin(`/rest/v1/profiles?user_id=eq.${first.context.userId}`,'PATCH',{data_revision:999});
  await expect(prepareSyntheticBatch(batch,'0.1')).rejects.toThrow('verification_fixture_invalid');
});

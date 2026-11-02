import { afterEach,describe,expect,it,vi } from 'vitest';
import { priceFingerprint } from '../../server/ai/live-preflight.js';
import { everydayAdapterVersion,everydayTemplateVersion } from '../../server/config/everyday-versions.js';
import { providerPolicies } from '../../server/security/consent.js';
import { openRouterPolicyHash } from '../../server/config/everyday-production.js';
import { randomBytes } from 'node:crypto';
import { createDispatcher,type RequestTransport } from '../../server/ai/ledger/dispatcher.js';
import type { ExecutionService,PreparedStep } from '../../server/ai/ledger/execution.js';
import { composeEverydayProduction } from '../../server/ai/providers/openrouter-production.js';
import { getRoleAvailability,models } from '../../server/config/models.js';

afterEach(()=>{vi.doUnmock('../../server/config/models.js');vi.doUnmock('../../server/config/everyday-production.js');vi.doUnmock('../../server/config/everyday-verification.js');vi.resetModules();vi.unstubAllEnvs();});
describe('production Luna wiring',()=>{
  it('keeps ordinary composition denied with the live switch true and no approved evidence',()=>{
    vi.stubEnv('VULPES_LIVE_AI_ENABLED','true');
    expect(getRoleAvailability('everyday',true).state).toBe('unavailable');
    expect(composeEverydayProduction()).toBeNull();
  });
  it('requires approved current policy and smoke bindings before reporting available',async()=>{
    const price=models.everyday.price;
    const smoke={version:1,provider:'openrouter',model:models.everyday.modelId,effort:'low',adapterVersion:everydayAdapterVersion,templateVersion:everydayTemplateVersion,
      priceId:price.id,priceHash:priceFingerprint(price),runId:'11111111-1111-4111-8111-111111111111',checkedAt:'2026-10-31T12:00:00Z',result:'passed',policyVersion:providerPolicies.openrouter.version,policyHash:openRouterPolicyHash(),safetyEvaluationId:'22222222-2222-4222-8222-222222222222',ownerApprovedAt:'2026-10-31T13:00:00Z'};
    const capability={version:1,provider:'openrouter',model:smoke.model,effort:'low',adapterVersion:everydayAdapterVersion,templateVersion:everydayTemplateVersion,
      priceId:price.id,priceHash:smoke.priceHash,inputBoundTokens:12000,outputBoundTokens:3072,streaming:true,tools:true,zdr:true,checkedAt:'2026-10-31T11:00:00Z',sourceURL:'https://example.test/synthetic'};
    // Retain the actual schema; only operator records are synthetic.
    vi.doMock('../../server/config/everyday-production.js',async(importOriginal)=>({...await importOriginal<object>(),everydayProductionEvidence:smoke,everydayMaxRunCostUSD:'0.25'}));
    vi.doMock('../../server/config/everyday-verification.js',()=>({everydayCapabilityEvidence:capability}));
    const catalog=await import('../../server/config/models.js');
    expect(catalog.getRoleAvailability('everyday',true)).toEqual({state:'available',reason:'verified'});
    smoke.policyHash='0'.repeat(64);expect(catalog.getRoleAvailability('everyday',true)).toEqual({state:'unavailable',reason:'production_policy_mismatch'});
  });
  it('rejects fabricated production transports before authorization',async()=>{
    const authorize=vi.fn();const send=vi.fn();
    const dispatcher=createDispatcher({authorize} as unknown as ExecutionService,{mode:'production',send} as RequestTransport);
    await expect(async()=>{for await(const chunk of dispatcher.send({} as PreparedStep,new AbortController().signal))void chunk;}).rejects.toThrow('live_transport_unavailable');
    expect(authorize).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
  });
  it('sends exact bytes to the fixed endpoint and rechecks the switch without retry',async()=>{
    vi.doMock('../../server/config/models.js',()=>({getRoleAvailability:(_role:string,enabled:boolean)=>({state:enabled?'available':'unavailable'}),models:{}}));
    const {issueProductionTransport}=await import('../../server/ai/providers/openrouter-production.js');
    vi.stubEnv('VULPES_LIVE_AI_ENABLED','true');vi.stubEnv('OPENROUTER_API_KEY','synthetic-key');
    vi.stubEnv('VULPES_TRACE_ENCRYPTION_KEY_ID','synthetic');vi.stubEnv('VULPES_TRACE_ENCRYPTION_KEY_B64',randomBytes(32).toString('base64'));
    const send=vi.fn(async()=>new Response('data: synthetic\n\n',{headers:{'Content-Type':'text/event-stream'}}));
    const transport=issueProductionTransport(send);const bytes=Buffer.from('{ "synthetic": "🦊" }\n');
    for await(const chunk of transport.send(bytes,new AbortController().signal))expect(chunk.byteLength).toBeGreaterThan(0);
    const [url,options]=send.mock.calls[0] as unknown as [string,RequestInit];
    expect(url).toBe('https://openrouter.ai/api/v1/responses');expect(options.redirect).toBe('error');expect(Buffer.from(options.body as Uint8Array)).toEqual(bytes);
    vi.stubEnv('VULPES_LIVE_AI_ENABLED','false');
    await expect(async()=>{for await(const chunk of transport.send(bytes,new AbortController().signal))void chunk;}).rejects.toThrow('live_transport_unavailable');
    expect(send).toHaveBeenCalledOnce();
  });
});

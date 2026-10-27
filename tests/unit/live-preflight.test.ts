import { describe,expect,it } from 'vitest';
import { assessEverydayPreflight,priceFingerprint } from '../../server/ai/live-preflight.js';
import { syntheticPrice } from '../fixtures/executions.js';
import { everydayAdapterVersion,everydayTemplateVersion } from '../../server/config/everyday-versions.js';

const capability={version:1,provider:'openrouter',model:'synthetic-model',effort:'low',adapterVersion:everydayAdapterVersion,templateVersion:everydayTemplateVersion,priceId:syntheticPrice.id,priceHash:priceFingerprint(syntheticPrice),inputBoundTokens:100,outputBoundTokens:100,streaming:true,tools:true,zdr:true,checkedAt:'2026-10-26T00:00:00Z',sourceURL:'https://example.test/capabilities'};
const smoke={version:1,provider:'openrouter',model:'synthetic-model',effort:'low',adapterVersion:everydayAdapterVersion,templateVersion:everydayTemplateVersion,priceId:syntheticPrice.id,priceHash:priceFingerprint(syntheticPrice),runId:'11111111-1111-4111-8111-111111111111',checkedAt:'2026-10-26T00:00:00Z',result:'passed'};
const input={enabled:true,mode:'verification' as const,model:'synthetic-model',effort:'low',adapterVersion:everydayAdapterVersion,templateVersion:everydayTemplateVersion,maxInputTokens:100,maxOutputTokens:100,price:syntheticPrice,capabilities:capability,smoke:null,maxCostUSD:'0.1'};
describe('Everyday live preflight',()=>{
  it('permits verification to bypass only a prior smoke',()=>{
    expect(assessEverydayPreflight(input)).toEqual({state:'ready'});
    expect(assessEverydayPreflight({...input,mode:'production'})).toEqual({state:'unavailable',reason:'live_smoke_unverified'});
    expect(assessEverydayPreflight({...input,mode:'production',smoke})).toEqual({state:'ready'});
  });
  it('fails closed on switch, price, bounds, capability, privacy and mismatched evidence',()=>{
    expect(assessEverydayPreflight({...input,enabled:false})).toMatchObject({reason:'live_ai_disabled'});
    expect(assessEverydayPreflight({...input,price:{status:'unverified'}})).toMatchObject({reason:'price_unverified'});
    expect(assessEverydayPreflight({...input,maxOutputTokens:101})).toMatchObject({reason:'price_bounds_mismatch'});
    expect(assessEverydayPreflight({...input,capabilities:{...capability,zdr:false}})).toMatchObject({reason:'capability_privacy_unverified'});
    expect(assessEverydayPreflight({...input,capabilities:{...capability,model:'other'}})).toMatchObject({reason:'capability_evidence_mismatch'});
    expect(assessEverydayPreflight({...input,price:{...syntheticPrice,inputPerMillion:'101'}})).toMatchObject({reason:'capability_evidence_mismatch'});
    expect(assessEverydayPreflight({...input,adapterVersion:'changed'})).toMatchObject({reason:'capability_evidence_mismatch'});
    expect(assessEverydayPreflight({...input,maxCostUSD:'0.001'})).toMatchObject({reason:'insufficient_spend_ceiling'});
    expect(assessEverydayPreflight({...input,mode:'production',smoke:{...smoke,priceId:'old'}})).toMatchObject({reason:'live_smoke_mismatch'});
  });
});

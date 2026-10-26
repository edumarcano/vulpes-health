import { describe,expect,it } from 'vitest';
import {createHash} from 'node:crypto';
import { normalizeUsage } from '../../server/ai/contracts.js';
import { priceUsage,reserveMaximum,VerifiedPriceSchema } from '../../server/ai/ledger/pricing.js';
import { requestHash } from '../../server/ai/ledger/execution.js';
import { syntheticPrice } from '../fixtures/executions.js';

describe('conservative exact accounting',()=>{
  it('reserves uncached input and output plus a decimal safety margin',()=>{
    expect(reserveMaximum(syntheticPrice)).toBe('0.022');
    expect(reserveMaximum({...syntheticPrice,inputPerMillion:'0.000000001',outputPerMillion:'0',cacheReadPerMillion:'0',inputBoundTokens:1})).toBe('0.000000000001');
  });
  it('blocks unknown rates, unknown bounds, and non-USD prices',()=>{
    for(const patch of [{status:'unverified'},{inputPerMillion:null},{outputLimitVerified:false},{inputBoundVerified:false},{currency:'EUR'}])
      expect(()=>reserveMaximum({...syntheticPrice,...patch})).toThrow();
  });
  it('does not add reasoning or cache subsets twice',()=>{
    const usage=normalizeUsage({inputTokens:20,outputTokens:10,reasoningTokens:4,reasoningIsOutputSubset:true,cacheReadTokens:5,cacheReadIsInputSubset:true,cacheWriteTokens:0,rawUsage:{synthetic:true}});
    expect(priceUsage(syntheticPrice,usage)).toEqual({source:'estimated',costUSD:'0.003'});
    expect(priceUsage({...syntheticPrice,cacheReadPerMillion:'50'},usage).costUSD).toBe('0.00275');
    expect(priceUsage({...syntheticPrice,reasoningBilling:'separate',reasoningPerMillion:'200'},usage).costUSD).toBe('0.0034');
    expect(priceUsage(syntheticPrice,{...usage,reasoningIsOutputSubset:false}).costUSD).toBe('0.0034');
  });
  it('preserves missing billing categories as pending and uses a reported total once',()=>{
    expect(priceUsage(syntheticPrice,normalizeUsage({rawUsage:null}))).toEqual({source:'pending',costUSD:null});
    expect(priceUsage(syntheticPrice,normalizeUsage({reportedCostUSD:'0.009',rawUsage:null}))).toEqual({source:'reported',costUSD:'0.009'});
  });
  it('rejects impossible subsets and hashes equivalent object keys identically',()=>{
    expect(()=>priceUsage(syntheticPrice,normalizeUsage({inputTokens:1,outputTokens:2,reasoningTokens:0,reasoningIsOutputSubset:true,cacheReadTokens:2,cacheReadIsInputSubset:true,cacheWriteTokens:0,rawUsage:null}))).toThrow('invalid_usage_subset');
    expect(requestHash({b:2,a:{y:1,x:0}})).toBe(requestHash({a:{x:0,y:1},b:2}));
    expect(VerifiedPriceSchema.safeParse({...syntheticPrice,outputPerMillion:0.1}).success).toBe(false);
  });
  it('uses locale-independent key ordering for idempotency hashes',()=>{
    expect(requestHash({'ä':1,z:2})).toBe(createHash('sha256').update('{"z":2,"ä":1}').digest('hex'));
  });
});

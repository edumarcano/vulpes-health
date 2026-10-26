import type { VerifiedPrice } from '../../server/ai/ledger/pricing.js';
export const syntheticPrice:VerifiedPrice={
  status:'verified',id:'synthetic-price-v1',currency:'USD',checkedAt:'2026-10-26T00:00:00Z',sourceURL:'https://pricing.example.test/synthetic',
  inputPerMillion:'100',outputPerMillion:'100',cacheReadPerMillion:'100',cacheWritePerMillion:'0',otherFees:'0',
  inputBoundTokens:100,outputBoundTokens:100,reasoningBilling:'included_in_output',reasoningPerMillion:'0',reasoningBoundTokens:0,
  outputLimitVerified:true,inputBoundVerified:true,
};

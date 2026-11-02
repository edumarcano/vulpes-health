import { Decimal } from 'decimal.js';
import { z } from 'zod';
import {
  CountSchema,
  DecimalUSDSchema,
  ISOInstantSchema,
} from '../../../shared/primitives.js';
import type { NormalizedUsage } from '../contracts.js';

// 80 rate characters + 16 token-count digits + rounding guard digits.
const Money = Decimal.clone({ precision: 128, rounding: Decimal.ROUND_UP });
const RateSchema = DecimalUSDSchema.max(80);
export const VerifiedPriceSchema = z.strictObject({
  status: z.literal('verified'),
  id: z.string().min(1).max(200),
  currency: z.literal('USD'),
  checkedAt: ISOInstantSchema,
  sourceURL: z.url(),
  inputPerMillion: RateSchema,
  outputPerMillion: RateSchema,
  cacheReadPerMillion: RateSchema,
  cacheWritePerMillion: RateSchema,
  otherFees: RateSchema,
  inputBoundTokens: CountSchema,
  outputBoundTokens: CountSchema,
  reasoningBilling: z.enum(['included_in_output', 'separate']),
  reasoningPerMillion: RateSchema,
  reasoningBoundTokens: CountSchema,
  outputLimitVerified: z.literal(true),
  inputBoundVerified: z.literal(true),
});
export type VerifiedPrice = z.infer<typeof VerifiedPriceSchema>;
export function reserveMaximum(input: unknown): string {
  const price = VerifiedPriceSchema.parse(input);
  // Cache prices can exceed ordinary input prices; use the largest rate and
  // reserve cache writes separately so overlapping billing cannot under-reserve.
  const inputRate = Money.max(price.inputPerMillion, price.cacheReadPerMillion);
  const amount = inputRate
    .mul(price.inputBoundTokens)
    .plus(new Money(price.cacheWritePerMillion).mul(price.inputBoundTokens))
    .plus(new Money(price.outputPerMillion).mul(price.outputBoundTokens))
    .plus(
      price.reasoningBilling === 'separate'
        ? new Money(price.reasoningPerMillion).mul(price.reasoningBoundTokens)
        : 0,
    )
    .div(1_000_000)
    .plus(price.otherFees)
    .mul('1.10');
  return amount.toDecimalPlaces(12, Decimal.ROUND_UP).toFixed();
}
export function priceUsage(
  price: VerifiedPrice,
  usage: NormalizedUsage,
): { source: 'reported' | 'estimated' | 'pending'; costUSD: string | null } {
  if (usage.reportedCostUSD !== null)
    return { source: 'reported', costUSD: usage.reportedCostUSD };
  if (
    usage.inputTokens === null ||
    usage.outputTokens === null ||
    usage.cacheReadTokens === null ||
    usage.cacheWriteTokens === null ||
    usage.cacheReadIsInputSubset === null ||
    (usage.cacheWriteTokens > 0 && usage.cacheWriteIsInputSubset === null) ||
    usage.reasoningIsOutputSubset === null ||
    usage.reasoningTokens === null
  )
    return { source: 'pending', costUSD: null };
  if (usage.cacheReadIsInputSubset && usage.cacheReadTokens > usage.inputTokens)
    throw new Error('invalid_usage_subset');
  if (
    usage.reasoningIsOutputSubset &&
    usage.reasoningTokens > usage.outputTokens
  )
    throw new Error('invalid_usage_subset');
  const uncached =
    usage.inputTokens -
    (usage.cacheReadIsInputSubset ? usage.cacheReadTokens : 0) -
    (usage.cacheWriteIsInputSubset ? usage.cacheWriteTokens : 0);
  if (uncached < 0) throw new Error('invalid_usage_subset');
  const regularOutput =
    usage.outputTokens -
    (price.reasoningBilling === 'separate' && usage.reasoningIsOutputSubset
      ? usage.reasoningTokens
      : 0);
  const billableOutput =
    regularOutput +
    (price.reasoningBilling === 'included_in_output' &&
    !usage.reasoningIsOutputSubset
      ? usage.reasoningTokens
      : 0);
  const amount = new Money(price.inputPerMillion)
    .mul(uncached)
    .plus(new Money(price.cacheReadPerMillion).mul(usage.cacheReadTokens))
    .plus(new Money(price.cacheWritePerMillion).mul(usage.cacheWriteTokens))
    .plus(new Money(price.outputPerMillion).mul(billableOutput))
    .plus(
      price.reasoningBilling === 'separate'
        ? new Money(price.reasoningPerMillion).mul(usage.reasoningTokens)
        : 0,
    )
    .div(1_000_000)
    .plus(price.otherFees);
  return {
    source: 'estimated',
    costUSD: amount.toDecimalPlaces(12, Decimal.ROUND_UP).toFixed(),
  };
}

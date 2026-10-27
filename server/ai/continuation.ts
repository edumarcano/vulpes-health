import { z } from 'zod';
import type { GenerationRequest } from './contracts.js';

export const BlocksSchema=z.array(z.strictObject({at:z.number().int().nonnegative(),count:z.number().int().positive(),items:z.array(z.json()).min(1)}));
export function blocksOf(continuation:GenerationRequest['continuation']) {
  if(!continuation)return [];
  return z.strictObject({blocks:BlocksSchema}).parse(continuation.data).blocks;
}
export function continuationFor(blocks:z.infer<typeof BlocksSchema>):GenerationRequest['continuation'] {
  return blocks.length ? {family:'openrouter_responses',data:{blocks}} : null;
}

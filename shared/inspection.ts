import { z } from 'zod';
import { UUIDSchema } from './primitives.js';
import { RunSummarySchema } from './executions.js';

export const InspectionQuerySchema = z.discriminatedUnion('view', [
  z.strictObject({ view: z.literal('overview'), run: UUIDSchema }),
  z.strictObject({
    view: z.enum(['payload', 'export']),
    run: UUIDSchema,
    step: UUIDSchema,
    part: z.enum(['input', 'output', 'context', 'usage']),
  }),
]);
export type InspectionQuery = z.infer<typeof InspectionQuerySchema>;

const nullableText = z.string().nullable();
const count = z.number().int().nonnegative().nullable();
export const InspectionOverviewSchema = z.strictObject({
  run: RunSummarySchema,
  evidenceRevision: z.enum(['current', 'stale', 'removed']),
  routeHistory: z
    .array(
      z.strictObject({
        sourceStepId: UUIDSchema,
        from: z.json(),
        to: z.json(),
        reason: z.enum(['goal_progress_review', 'multi_metric_comparison']),
        at: z.string(),
      }),
    )
    .max(1)
    .default([]),
  steps: z.array(
    z.strictObject({
      id: UUIDSchema,
      sequence: z.number().int().positive(),
      type: z.enum(['generation', 'decision', 'tool']),
      status: z.enum([
        'started',
        'completed',
        'failed',
        'cancelled',
        'interrupted',
      ]),
      provider: nullableText,
      model: nullableText,
      effectiveModel: nullableText,
      adapterVersion: nullableText,
      requestedEffort: nullableText,
      effectiveEffort: nullableText,
      toolName: nullableText,
      startedAt: z.string(),
      finishedAt: nullableText,
      dispatchState: z.string(),
      requestBodyHash: nullableText,
      requestMetadata: z.unknown(),
      providerRequestId: nullableText,
      finishReason: nullableText,
      priceSnapshot: z.unknown(),
      costUSD: nullableText,
      costStatus: z.string(),
      costBoundState: z.string(),
      usage: z.strictObject({
        inputTokens: count,
        outputTokens: count,
        reasoningTokens: count,
        cacheReadTokens: count,
        cacheWriteTokens: count,
      }),
    }),
  ),
});
export const InspectionPayloadSchema = z.discriminatedUnion('state', [
  z.strictObject({
    state: z.literal('available'),
    base64: z.string(),
    expiresAt: z.string(),
    completeness: z.enum(['complete', 'partial']).optional(),
  }),
  z.strictObject({
    state: z.enum([
      'expired',
      'removed',
      'incomplete',
      'corrupt',
      'unavailable',
    ]),
  }),
]);

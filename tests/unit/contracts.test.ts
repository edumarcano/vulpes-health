import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  ActionProposalSchema, AnalysisResultSchema, ContextManifestSchema, GoalDraftSchema,
  MeasurementDTOSchema, ProposalMetadataSchema, UsageSummarySchema, VulpesCardSchema,
} from '../../shared/domain.js';
import {
  apiOperations, ApprovalRequestSchema, ChatSendRequestSchema, ErrorEnvelopeSchema,
  ImportCommitRequestSchema, LivenessResponseSchema, validateOperation,
} from '../../shared/api.js';
import {
  DecimalUSDSchema, HashSchema, IanaTimezoneSchema, ISOInstantSchema, LocalDateSchema, OpaqueCursorSchema, PageSizeSchema, UUIDSchema,
} from '../../shared/primitives.js';
import { analysis, approval, chatSend, goalDraft, hash, id, importCommit, manifest, measurement, proposal, usage } from '../fixtures/contracts.js';

describe('contract primitives', () => {
  it('disables evaluation probes for the production browser CSP', () => {
    expect(z.config().jitless).toBe(true);
  });
  it.each([
    [UUIDSchema, id, 'not-a-uuid'], [ISOInstantSchema, '2026-09-01T08:00:00+02:00', '2026-09-01T08:00:00'],
    [ISOInstantSchema, '2024-02-29T00:00:00Z', '2026-02-30T00:00:00Z'],
    [LocalDateSchema, '2024-02-29', '2026-02-29'], [IanaTimezoneSchema, 'America/New_York', '+02:00'],
    [IanaTimezoneSchema, 'UTC', 'Not/A_Zone'], [DecimalUSDSchema, '0.000042', 0.1],
    [DecimalUSDSchema, '0', '-0.01'], [DecimalUSDSchema, '12.10', '1e3'],
    [HashSchema, hash, 'SHA256'], [PageSizeSchema, 200, 201], [PageSizeSchema, 1, 0],
    [OpaqueCursorSchema, 'opaque-not-authorized-by-this-schema', ''],
  ] as Array<[z.ZodType, unknown, unknown]>)('accepts a valid representation and rejects its counterexample (%#)', (schema, valid, invalid) => {
    expect(schema.safeParse(valid).success).toBe(true);
    expect(schema.safeParse(invalid).success).toBe(false);
  });
});

describe('domain contracts', () => {
  it.each([
    [MeasurementDTOSchema, measurement], [AnalysisResultSchema, analysis], [GoalDraftSchema, goalDraft],
    [ActionProposalSchema, proposal], [UsageSummarySchema, usage], [ContextManifestSchema, manifest],
  ] as Array<[z.ZodType, object]>)('round-trips the complete reference shape (%#)', (schema, value) => {
    expect(schema.parse(value)).toEqual(value);
    expect(schema.safeParse({ ...value, user_id: id }).success).toBe(false);
  });

  it.each([
    { value: NaN }, { value: Infinity }, { value: 0 }, { value: -1 }, { value: '69.7' }, { unit: 'lb' },
    { observedAt: 'yesterday' }, { version: 0 }, { metric: 'unapproved_index' }, { originalValue: '' },
    { granularity: 'daily_total' }, { metric: 'body_fat_percent', unit: '%', value: 101 },
    { metric: 'body_fat_percent', unit: '%', value: -1 },
    { metric: 'steps_daily', unit: 'count', value: 1.5, granularity: 'daily_total', localDate: '2026-09-01' },
    { metric: 'sleep_duration', unit: 'min', value: 400 },
  ])('rejects invalid measurement representations %j', (patch) => {
    expect(MeasurementDTOSchema.safeParse({ ...measurement, ...patch }).success).toBe(false);
  });
  it('accepts representable unusual values without inventing clinical ranges', () => {
    expect(MeasurementDTOSchema.parse({ ...measurement, value: 600 }).value).toBe(600);
    expect(MeasurementDTOSchema.parse({ ...measurement, metric: 'body_fat_percent', unit: '%', value: 0 }).value).toBe(0);
    expect(MeasurementDTOSchema.parse({ ...measurement, metric: 'steps_daily', unit: 'count', value: 0, granularity: 'daily_total', localDate: '2026-09-01' }).value).toBe(0);
  });
  it('preserves insufficient data and zero distinctly', () => {
    expect(AnalysisResultSchema.parse({ ...analysis, value: 0 }).value).toBe(0);
    expect(AnalysisResultSchema.parse({ ...analysis, coverageStatus: 'insufficient_data', value: null }).value).toBeNull();
    expect(AnalysisResultSchema.safeParse({ ...analysis, coverageStatus: 'insufficient_data' }).success).toBe(false);
    expect(AnalysisResultSchema.safeParse({ ...analysis, from: analysis.to }).success).toBe(false);
    expect(AnalysisResultSchema.safeParse({ ...analysis, points: [{ localDate: '2026-09-01', value: Infinity }] }).success).toBe(false);
  });
  it('validates directional/range goals and complete proposals', () => {
    expect(GoalDraftSchema.parse({ ...goalDraft, target: { direction: 'maintain_range', lower: 68, upper: 70 } }).target.direction).toBe('maintain_range');
    expect(GoalDraftSchema.safeParse({ ...goalDraft, target: { direction: 'maintain_range', lower: 70, upper: 68 } }).success).toBe(false);
    expect(GoalDraftSchema.safeParse({ ...goalDraft, baselineTo: goalDraft.baselineFrom }).success).toBe(false);
    expect(ActionProposalSchema.safeParse({ ...proposal, payload: { schema_version: 1 } }).success).toBe(false);
    for (const kind of ['goal.revise', 'goal.state']) {
      const metadata = { ...proposal };
      Reflect.deleteProperty(metadata, 'payload');
      expect(ProposalMetadataSchema.safeParse({ ...metadata, kind }).success).toBe(true);
      expect(ActionProposalSchema.safeParse({ ...proposal, kind }).success).toBe(false);
      expect(VulpesCardSchema.safeParse({ type: 'goal_proposal', proposal: { ...proposal, kind } }).success).toBe(false);
    }
  });
  it.each([
    [MeasurementDTOSchema, { ...measurement, originalValue: ' ' }],
    [GoalDraftSchema, { ...goalDraft, target: { direction: 'decrease_to', value: -1 } }],
    [GoalDraftSchema, { ...goalDraft, metric: 'body_fat_percent', unit: '%', target: { direction: 'maintain_range', lower: 20, upper: 101 } }],
    [GoalDraftSchema, { ...goalDraft, reportedBaseline: -1 }],
  ] as Array<[z.ZodType, unknown]>)('rejects blank originals and impossible numeric goal representations (%#)', (schema, input) => {
    expect(schema.safeParse(input).success).toBe(false);
  });
  it('validates every predefined card and refuses executable or invented props', () => {
    for (const card of [
      { type: 'metric_trend', result: analysis }, { type: 'goal_progress', goalId: id, revision: 1, result: analysis },
      { type: 'goal_proposal', proposal }, { type: 'data_quality', message: 'Synthetic gap', references: [] },
    ]) expect(VulpesCardSchema.parse(card)).toEqual(card);
    expect(VulpesCardSchema.safeParse({ type: 'html', html: '<script />' }).success).toBe(false);
    expect(VulpesCardSchema.safeParse({ type: 'data_quality', message: 'test', references: [], html: '<script />' }).success).toBe(false);
  });
  it('preserves nullable usage and decimal money, with no unverified free charge', () => {
    expect(UsageSummarySchema.parse(usage).costUSD).toBeNull();
    expect(UsageSummarySchema.safeParse({ ...usage, costUSD: 0.1 }).success).toBe(false);
    expect(UsageSummarySchema.safeParse({ ...usage, inputTokens: -1 }).success).toBe(false);
    expect(ContextManifestSchema.safeParse({ ...manifest, retrieval: { ragUsed: false, webUsed: true } }).success).toBe(false);
  });
});

describe('API contracts', () => {
  it('validates minimal liveness and safe envelopes without config disclosure', () => {
    expect(LivenessResponseSchema.parse({ data: { status: 'ok' }, request_id: id })).toEqual({ data: { status: 'ok' }, request_id: id });
    expect(LivenessResponseSchema.safeParse({ data: { status: 'ok', models: [] }, request_id: id }).success).toBe(false);
    expect(ErrorEnvelopeSchema.parse({ error: { code: 'not_found', message: 'Not found.', retryable: false }, request_id: id }).error.code).toBe('not_found');
    expect(ErrorEnvelopeSchema.safeParse({ error: { code: 'bad', message: 'Bad', retryable: false, stack: 'private' }, request_id: id }).success).toBe(false);
  });
  it('validates complete documented wire inputs without silently recasing', () => {
    expect(ChatSendRequestSchema.parse(chatSend)).toEqual(chatSend);
    expect(ApprovalRequestSchema.parse(approval)).toEqual(approval);
    expect(ImportCommitRequestSchema.parse(importCommit)).toEqual(importCommit);
    expect(ChatSendRequestSchema.safeParse({ ...chatSend, clientRequestId: id }).success).toBe(false);
    expect(ApprovalRequestSchema.safeParse({ ...approval, payload: goalDraft }).success).toBe(false);
    expect(ImportCommitRequestSchema.safeParse({ ...importCommit, mapping: {} }).success).toBe(false);
  });
  it.each(['user_id', 'model', 'provider_url', 'budget', 'system', 'tool_results'])('rejects injected %s', (field) => {
    expect(ChatSendRequestSchema.safeParse({ ...chatSend, [field]: 'injected' }).success).toBe(false);
  });
  it('rejects nested injection, unavailable depth identifiers, and invalid intervals', () => {
    expect(ChatSendRequestSchema.safeParse({ ...chatSend, message: { ...chatSend.message, role: 'system' } }).success).toBe(false);
    expect(ChatSendRequestSchema.safeParse({ ...chatSend, depth: 'decision' }).success).toBe(false);
    expect(ChatSendRequestSchema.safeParse({ ...chatSend, message: { ...chatSend.message, text: ' ' } }).success).toBe(false);
    expect(ChatSendRequestSchema.safeParse({ ...chatSend, context_selection: { ...chatSend.context_selection, from: analysis.to } }).success).toBe(false);
  });
  it('inventories nine endpoints and never accepts unspecified payloads', () => {
    expect(Object.keys(apiOperations)).toHaveLength(9);
    for (const [route, operations] of Object.entries(apiOperations)) {
      for (const operation of operations) {
        if (!('schema' in operation)) {
          expect(validateOperation(route, operation.method, operation.selector, { arbitrary: true })).toEqual({ kind: 'not_implemented', owningPR: operation.owningPR });
        }
      }
    }
    expect(validateOperation('/api/chat', 'POST', 'action=send', chatSend)).toEqual({ kind: 'validated', value: chatSend });
    expect(validateOperation('/api/chat', 'POST', 'action=send', {})).toEqual({ kind: 'invalid' });
    expect(validateOperation('/api/approvals', 'POST', 'action=reject', approval)).toEqual({ kind: 'invalid' });
    expect(validateOperation('/api/research', 'POST', 'default', {})).toEqual({ kind: 'invalid' });
    expect(validateOperation('__proto__', 'GET', 'default', {})).toEqual({ kind: 'invalid' });
    expect(validateOperation('/api/status', 'POST', 'default', {})).toEqual({ kind: 'invalid' });
  });
});

import { describe, it, expect } from 'vitest';
import {
  RecordSchema,
  currentOutcome,
  outputSummary,
  safeProof,
} from '../../scripts/release-evidence.js';
describe('release evidence integrity', () => {
  const digest = 'a'.repeat(64);
  const current = { sourceDigest: digest, workspaceDigest: digest };
  const row = RecordSchema.parse({
    check: 'unit',
    sourceRevision: 'b'.repeat(40),
    ...current,
    startedAt: '2026-10-30T00:00:00Z',
    endedAt: '2026-10-30T00:01:00Z',
    exitCode: 0,
    status: 'passed',
    outputSHA256: digest,
    outputBytes: 12,
    summary: ['Tests 4 passed (4)'],
  });
  it('does not infer success from missing, stale or different-environment records', () => {
    expect(currentOutcome([], 'unit', current)).toBe('not_run');
    expect(
      currentOutcome([row], 'unit', {
        ...current,
        sourceDigest: 'c'.repeat(64),
      }),
    ).toBe('not_run');
    expect(
      currentOutcome([row], 'unit', {
        ...current,
        workspaceDigest: 'c'.repeat(64),
      }),
    ).toBe('not_run');
  });
  it('keeps a later failure authoritative rather than selecting a green attempt', () => {
    const failed = {
      ...row,
      endedAt: '2026-10-30T00:02:00Z',
      exitCode: 1,
      status: 'failed' as const,
    };
    expect(currentOutcome([row, failed], 'unit', current)).toBe('failed');
    expect(() => RecordSchema.parse({ ...failed, status: 'passed' })).toThrow();
  });
  it('only publishes bounded numeric command output and omits secrets/content', () => {
    expect(
      outputSummary(
        'Authorization: Bearer secret\nprivate synthetic prompt\nTests 4 passed (4)\nTest Files 1 passed (1)\nTests 4 passed (4) token=secret\n',
      ),
    ).toEqual(['Tests 4 passed (4)', 'Test Files 1 passed (1)']);
    expect(outputSummary('Tests 4 passed private content (4)')).toEqual([]);
    expect(() =>
      RecordSchema.parse({
        ...row,
        summary: ['Tests 4 passed private content (4)'],
      }),
    ).toThrow();
    expect(
      safeProof(
        '{"capturedBytesEqual":true,"actualProviderRequests":0,"password":"private"}',
      ),
    ).toEqual({ capturedBytesEqual: true, actualProviderRequests: 0 });
    expect(safeProof('{"actualSpendUSD":"private"}')).toEqual({});
  });
});

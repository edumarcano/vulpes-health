import { describe, expect, it } from 'vitest';
import { summarizeModelUsage } from '../../src/features/executions/summary';

describe('execution summaries', () => {
  it('keeps entirely unknown model usage unknown and ignores local tool steps', () => {
    expect(
      summarizeModelUsage([
        {
          type: 'generation',
          usage: {
            inputTokens: null,
            outputTokens: null,
            reasoningTokens: null,
          },
        },
        {
          type: 'tool',
          usage: {
            inputTokens: null,
            outputTokens: null,
            reasoningTokens: null,
          },
        },
      ]),
    ).toEqual({
      total: 'unknown',
      input: 'unknown',
      output: 'unknown',
      reasoning: 'unknown',
    });
  });

  it('sums fully reported model usage and excludes local tool usage', () => {
    expect(
      summarizeModelUsage([
        {
          type: 'generation',
          usage: { inputTokens: 12, outputTokens: 5, reasoningTokens: 3 },
        },
        {
          type: 'decision',
          usage: { inputTokens: 4, outputTokens: 2, reasoningTokens: 1 },
        },
        {
          type: 'tool',
          usage: { inputTokens: 100, outputTokens: 100, reasoningTokens: 100 },
        },
      ]),
    ).toEqual({ total: '23', input: '16', output: '7', reasoning: '4' });
  });

  it('reports partial known totals without treating missing model usage as zero', () => {
    expect(
      summarizeModelUsage([
        {
          type: 'generation',
          usage: { inputTokens: 12, outputTokens: null, reasoningTokens: 3 },
        },
        {
          type: 'decision',
          usage: { inputTokens: 4, outputTokens: 2, reasoningTokens: null },
        },
        {
          type: 'tool',
          usage: { inputTokens: 100, outputTokens: 100, reasoningTokens: 100 },
        },
      ]),
    ).toEqual({
      total: 'at least 18',
      input: '16',
      output: 'at least 2',
      reasoning: 'at least 3',
    });
  });
});

type UsageStep = {
  type: 'generation' | 'decision' | 'tool';
  usage: {
    inputTokens: number | null;
    outputTokens: number | null;
    reasoningTokens: number | null;
  };
};

type UsageSummary = {
  total: string;
  input: string;
  output: string;
  reasoning: string;
};

export function summarizeModelUsage(steps: UsageStep[]): UsageSummary {
  const modelSteps = steps.filter((step) => step.type !== 'tool');
  const summarize = (key: keyof UsageStep['usage']) => {
    const values = modelSteps.map((step) => step.usage[key]);
    const known = values.reduce<number>(
      (total, value) => total + (value ?? 0),
      0,
    );
    const unknown = values.some((value) => value === null);
    if (!values.length || (unknown && known === 0)) return 'unknown';
    return unknown ? `at least ${known}` : String(known);
  };
  const input = summarize('inputTokens');
  const output = summarize('outputTokens');
  const reasoning = summarize('reasoningTokens');
  const totalKnown = modelSteps.reduce(
    (total, step) =>
      total + (step.usage.inputTokens ?? 0) + (step.usage.outputTokens ?? 0),
    0,
  );
  const totalUnknown = modelSteps.some(
    (step) =>
      step.usage.inputTokens === null || step.usage.outputTokens === null,
  );
  const total =
    !modelSteps.length || (totalUnknown && totalKnown === 0)
      ? 'unknown'
      : totalUnknown
        ? `at least ${totalKnown}`
        : String(totalKnown);
  return { total, input, output, reasoning };
}

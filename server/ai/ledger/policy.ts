// Positive production limits require explicit operator configuration. Synthetic
// tests inject their own policy; no environment flag activates inference here.
export const executionPolicy = {
  maxRunCostUSD: '0',
  startsPerMinute: 10,
  modelRequests: 4,
  toolCalls: 6,
  deadlineSeconds: 210,
  heartbeatSeconds: 5,
  leaseSeconds: 30,
  providerTimeoutSeconds: 60,
} as const;

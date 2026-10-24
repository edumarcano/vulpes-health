export interface ServerEnvironment {
  liveAiRequested: boolean;
  inference: { state: 'unavailable'; reason: 'not_implemented' };
}

export function readServerEnvironment(env: NodeJS.ProcessEnv): ServerEnvironment {
  const enabled = env.VULPES_LIVE_AI_ENABLED;
  if (enabled !== undefined && enabled !== 'true' && enabled !== 'false') {
    throw new Error('VULPES_LIVE_AI_ENABLED must be true or false.');
  }
  return {
    liveAiRequested: enabled === 'true',
    inference: { state: 'unavailable', reason: 'not_implemented' },
  };
}

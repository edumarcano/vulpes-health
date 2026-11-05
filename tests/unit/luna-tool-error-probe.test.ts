import { expect, it } from 'vitest';
import type { AuthContext } from '../../server/auth/session.js';
import { toolErrorProbeAdapter } from '../../scripts/luna-tool-error-probe.js';
import { responseFrame, assistantOutput } from '../fixtures/chat.js';

it('serializes real validation feedback in a declared synthetic protocol fixture without changing provider policy', async () => {
  const adapter = await toolErrorProbeAdapter({} as AuthContext);
  let body: Record<string, unknown> | undefined;
  const request = {
    turns: [
      {
        type: 'message' as const,
        role: 'user' as const,
        text: 'Synthetic protocol check',
      },
    ],
    tools: [],
    continuation: null,
  };
  const options = {
    signal: new AbortController().signal,
    dispatch: {
      async *send(input: { body: Uint8Array }) {
        body = JSON.parse(Buffer.from(input.body).toString());
        yield responseFrame([assistantOutput('Synthetic acknowledgment')]);
      },
    },
  };
  for await (const event of adapter.generate(request, options)) void event;
  expect(body).toMatchObject({
    store: false,
    provider: { zdr: true },
    plugins: [],
    tools: [],
  });
  const wire = body!.input as Array<{
    type: string;
    arguments?: string;
    output?: string;
  }>;
  expect(
    JSON.parse(wire.find((t) => t.type === 'function_call')!.arguments!),
  ).toEqual({ compatibility_probe: true });
  expect(
    JSON.parse(wire.find((t) => t.type === 'function_call_output')!.output!),
  ).toMatchObject({
    result: {
      kind: 'tool_error',
      code: 'invalid_arguments',
      recoverable: true,
    },
  });
  expect(() => adapter.generate(request, options)).toThrow(
    'protocol_probe_single_request_only',
  );
});

import { createHash } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AuthContext } from '../../server/auth/session.js';
import type { RunSummary } from '../../shared/executions.js';
import type { ChatSendRequest } from '../../shared/api.js';
import {
  decryptBytes,
  type Envelope,
  readEncryptionKeys,
} from '../../server/security/encryption.js';
import { OpenRouterResponsesAdapter } from '../../server/ai/providers/openrouter.js';
import { VulpesAgent } from '../../server/ai/VulpesAgent.js';
import {
  ExecutionService,
  type PreparedStep,
  type RunLease,
} from '../../server/ai/ledger/execution.js';
import {
  createDispatcher,
  type RequestTransport,
} from '../../server/ai/ledger/dispatcher.js';
import { readPayload } from '../../server/security/private-payloads.js';
import { syntheticPrice } from '../fixtures/executions.js';

const store = vi.hoisted(() => ({
  calls: [] as { name: string; args: Record<string, unknown> }[],
  payloads: new Map<string, unknown>(),
  input: null as null | { input_payload_id: string; request_body_hash: string },
  response: null as unknown,
  runState: 'running',
  parts: [] as { type: string; text?: string }[],
  fail: '',
  cleanup: 'ok' as 'ok' | 'fail' | 'hang',
}));
vi.mock('../../server/db/administrative.js', () => ({
  administrativeClient: () => ({
    rpc: async (name: string, args: Record<string, unknown>) => {
      store.calls.push({ name, args });
      if (name === 'cleanup_data_v1' && store.cleanup === 'hang')
        return new Promise(() => {});
      if (
        name === store.fail ||
        (name === 'cleanup_data_v1' && store.cleanup === 'fail')
      )
        return { data: null, error: { message: 'synthetic_failure' } };
      let data: unknown =
        name === 'cleanup_data_v1'
          ? { payloadsRemoved: 0, batchesExpired: 0, workCount: 0 }
          : null;
      if (name === 'private_payload_expiry_v1')
        data = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      if (name === 'prepare_step_v1') {
        const envelope = args.p_input as Envelope;
        store.payloads.set(envelope.id, envelope);
        store.input = {
          input_payload_id: envelope.id,
          request_body_hash: envelope.content_hash,
        };
      }
      if (name === 'authorize_send_v1') data = true;
      if (name === 'checkpoint_step_v1') store.response = args.p_output;
      if (name === 'checkpoint_message_v1' && store.runState !== 'running')
        return { data: null, error: { message: 'run_not_writable' } };
      if (name === 'checkpoint_message_v1')
        store.parts = structuredClone(args.p_parts) as typeof store.parts;
      if (name === 'finish_run_v1') store.runState = String(args.p_status);
      if (
        ['heartbeat_run_v1', 'settle_step_v1', 'finish_run_v1'].includes(name)
      )
        data = {
          ...summary,
          ...(name === 'finish_run_v1' ? { state: args.p_status } : {}),
        };
      return { data, error: null };
    },
    from: (name: string) => {
      store.calls.push({ name: `select:${name}`, args: {} });
      let id = '';
      const query = {
        select: () => query,
        eq: (key: string, value: string) => {
          if (key === 'id') id = value;
          return query;
        },
        maybeSingle: async () => ({
          data:
            name === 'private_payloads' ? store.payloads.get(id) : store.input,
          error: null,
        }),
      };
      return query;
    },
  }),
}));
vi.mock('../../server/ai/context.js', () => ({
  buildContext: async () => ({
    request: {
      turns: [
        { type: 'message', role: 'user', text: 'Synthetic streaming test' },
      ],
      tools: [],
      continuation: null,
    },
    manifest: { included: [], excluded: [] },
    selected: [],
    dataRevision: 1,
  }),
}));
const owner = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const messageId = '33333333-3333-4333-8333-333333333333';
const context = { userId: owner } as AuthContext;
const lease: RunLease = {
  runId,
  executor: owner,
  fence: 1,
  deadlineAt: '2099-01-01T00:00:00Z',
};
const summary: RunSummary = {
  id: runId,
  conversationId: owner,
  assistantMessageId: messageId,
  state: 'running',
  requestedDepth: 'auto',
  route: null,
  admittedAt: '2026-11-04T00:00:00Z',
  deadlineAt: lease.deadlineAt,
  finishedAt: null,
  accountingPeriod: '2026-11-01',
  traceState: 'available',
  partialOutput: true,
  costUSD: null,
  knownCostUSD: '0',
  reservationUSD: '0.1',
  costStatus: 'pending',
};
const input = {
  message: { id: owner, text: 'Synthetic streaming test' },
  depth: 'auto',
} as ChatSendRequest;
const frame = (value: unknown) =>
  Buffer.from(`data: ${JSON.stringify(value)}\n\n`);
const deltas = Array.from({ length: 1000 }, (_, i) =>
  createHash('sha256').update(`synthetic-${i}`).digest('hex').slice(0, 32),
);
const frames = [
  ...deltas.map((delta) =>
    frame({ type: 'response.output_text.delta', delta }),
  ),
  frame({
    type: 'response.completed',
    response: {
      status: 'completed',
      output: [
        {
          type: 'message',
          role: 'assistant',
          content: [{ type: 'output_text', text: deltas.join('') }],
        },
      ],
    },
  }),
];
const price = {
  ...syntheticPrice,
  inputBoundTokens: 12000,
  outputBoundTokens: 3072,
};
beforeEach(() => {
  store.calls = [];
  store.payloads.clear();
  store.input = null;
  store.response = null;
  store.parts = [];
  store.fail = '';
  store.runState = 'running';
  store.cleanup = 'ok';
  vi.stubEnv('VULPES_TRACE_ENCRYPTION_KEY_ID', 'synthetic');
  vi.stubEnv(
    'VULPES_TRACE_ENCRYPTION_KEY_B64',
    Buffer.alloc(32, 7).toString('base64'),
  );
  vi.stubEnv('VULPES_TRACE_PREVIOUS_KEYS_JSON', '{}');
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function transport(chunks: Buffer[] = frames): RequestTransport {
  return {
    mode: 'mock',
    async *send() {
      for (const chunk of chunks) yield chunk;
    },
  };
}
async function prepare() {
  const ledger = new ExecutionService(context);
  const step = await ledger.prepare(lease, {
    type: 'generation',
    body: Buffer.from('{}'),
    price,
    adapterVersion: 'synthetic',
    metadata: {
      endpoint: 'https://openrouter.ai/api/v1/responses',
      headers: {},
      redactedHeaders: [],
    },
  });
  return { ledger, step };
}
function trace() {
  return decryptBytes(store.response, readEncryptionKeys());
}

function iteratorFor(
  ledger: ExecutionService,
  step: PreparedStep,
  value: RequestTransport,
  signal = new AbortController().signal,
) {
  const stream = createDispatcher(ledger, value).send(step, signal);
  return stream[Symbol.asyncIterator]();
}

it('measures 1000 real adapter deltas through agent, ledger and encryption with committed prefixes', async () => {
  const agent = new VulpesAgent(context, {
    adapter: new OpenRouterResponsesAdapter(),
    transport: transport(),
    price,
    maxRunCostUSD: '1',
  });
  // Only the final display aggregate query is outside this synthetic transport experiment.
  vi.spyOn(agent.ledger, 'usageTotals').mockResolvedValue({
    inputTokens: null,
    outputTokens: null,
    reasoningTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
  });
  let emitted = '';
  const types: string[] = [];
  for await (const event of agent.run(
    input,
    lease,
    summary,
    null,
    new AbortController().signal,
  )) {
    types.push(event.type);
    if (event.type === 'text.delta') {
      emitted += event.payload.text;
      expect(
        store.parts
          .filter((p) => p.type === 'text')
          .map((p) => p.text)
          .join(''),
      ).toBe(emitted);
      const savedText = trace()
        .toString()
        .split('\n\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line.slice(6)) as { delta?: string })
        .map((frame) => frame.delta ?? '')
        .join('');
      expect(savedText.startsWith(emitted)).toBe(true);
    }
  }
  expect(types.at(-1)).toBe('run.completed');
  expect(emitted).toBe(deltas.join(''));
  expect(trace()).toEqual(Buffer.concat(frames));
  const counts = Object.fromEntries(
    [...new Set(store.calls.map((c) => c.name))].map((name) => [
      name,
      store.calls.filter((c) => c.name === name).length,
    ]),
  );
  const uploadedBytes = store.calls
    .filter((c) => !c.name.startsWith('select:'))
    .reduce((sum, c) => sum + Buffer.byteLength(JSON.stringify(c.args)), 0);
  console.info(
    JSON.stringify({
      experiment: 'synthetic-1000-deltas',
      roundTrips: store.calls.length,
      uploadedBytes,
      counts,
      exactTraceBytes: trace().length,
      emittedTextBytes: Buffer.byteLength(emitted),
    }),
  );
  expect(store.calls.length).toBeLessThan(300);
  expect(uploadedBytes).toBeLessThan(3_655_541);
});

it('reads valid evidence even when cleanup is unavailable', async () => {
  store.cleanup = 'fail';
  const { step } = await prepare();
  const payload = await readPayload(
    context,
    store.input!.input_payload_id,
    'ai_request',
  );
  expect(payload).toEqual({ state: 'available', bytes: step.body });
  expect(store.calls.some((c) => c.name === 'cleanup_data_v1')).toBe(false);
});

function settlements() {
  return store.calls
    .filter((c) => c.name === 'settle_step_v1')
    .map((c) => c.args);
}
function expectPending(status: string) {
  expect(settlements()).not.toHaveLength(0);
  for (const args of settlements()) {
    expect(args.p_status).toBe(status);
    expect(args.p_evidence).toMatchObject({ source: 'pending', costUSD: null });
  }
}
function stalledTransport(first = Buffer.from('partial 🦊')) {
  const closed = vi.fn();
  let signal: AbortSignal;
  const value: RequestTransport = {
    mode: 'mock',
    async *send(_body, received) {
      signal = received;
      try {
        yield first;
        await new Promise<never>((_, reject) => {
          received.throwIfAborted();
          received.addEventListener('abort', () => reject(received.reason), {
            once: true,
          });
        });
      } finally {
        closed();
      }
    },
  };
  return { value, closed, aborted: () => signal.aborted };
}

it('commits a short final batch including split UTF-8 and an empty response', async () => {
  const { ledger, step } = await prepare();
  const bytes = Buffer.from('synthetic 🦊\r\n');
  let emitted = Buffer.alloc(0);
  for await (const chunk of createDispatcher(
    ledger,
    transport([bytes.subarray(0, 12), bytes.subarray(12)]),
  ).send(step, new AbortController().signal)) {
    emitted = Buffer.concat([emitted, chunk]);
    expect(trace().subarray(0, emitted.length)).toEqual(emitted);
  }
  expect(emitted).toEqual(bytes);
  expect(
    store.calls.filter((c) => c.name === 'checkpoint_step_v1'),
  ).toHaveLength(1);
  for await (const chunk of createDispatcher(ledger, transport([])).send(
    step,
    new AbortController().signal,
  ))
    void chunk;
  expect(trace()).toEqual(Buffer.alloc(0));
});

it('flushes at 250ms without another chunk and aborts a stalled read without trailing bytes', async () => {
  vi.useFakeTimers();
  const { ledger, step } = await prepare();
  const stalled = stalledTransport();
  const controller = new AbortController();
  const iterator = iteratorFor(ledger, step, stalled.value, controller.signal);
  const first = iterator.next();
  await vi.advanceTimersByTimeAsync(249);
  expect(store.response).toBeNull();
  await vi.advanceTimersByTimeAsync(1);
  expect(await first).toMatchObject({
    done: false,
    value: Buffer.from('partial 🦊'),
  });
  expect(trace()).toEqual(Buffer.from('partial 🦊'));
  const next = iterator.next();
  const rejected = expect(next).rejects.toMatchObject({
    code: 'execution_interrupted',
  });
  await vi.advanceTimersByTimeAsync(1);
  controller.abort();
  await rejected;
  expect(await iterator.next()).toMatchObject({ done: true });
  expect(stalled.closed).toHaveBeenCalledOnce();
  expectPending('cancelled');
  expect(vi.getTimerCount()).toBe(0);
});

it('returns an iterator while its timed batch has a pending provider read', async () => {
  vi.useFakeTimers();
  const { ledger, step } = await prepare();
  const stalled = stalledTransport();
  const iterator = iteratorFor(ledger, step, stalled.value);
  const first = iterator.next();
  await vi.advanceTimersByTimeAsync(250);
  expect((await first).done).toBe(false);
  expect(await iterator.return!()).toMatchObject({ done: true });
  expect(await iterator.next()).toMatchObject({ done: true });
  expect(stalled.aborted()).toBe(true);
  expect(stalled.closed).toHaveBeenCalledOnce();
  expectPending('cancelled');
  expect(vi.getTimerCount()).toBe(0);
});

it('saves received partial bytes on transport failure without emitting the failed batch', async () => {
  const { ledger, step } = await prepare();
  const value: RequestTransport = {
    mode: 'mock',
    async *send() {
      yield Buffer.from('partial');
      throw new Error('synthetic_disconnect');
    },
  };
  const iterator = iteratorFor(ledger, step, value);
  await expect(iterator.next()).rejects.toMatchObject({
    code: 'execution_interrupted',
  });
  expect(trace()).toEqual(Buffer.from('partial'));
  expectPending('failed');
  expect(
    store.calls.filter((c) => c.name === 'authorize_send_v1'),
  ).toHaveLength(1);
});

it('does not expose a batch after a checkpoint fails or aborts during commit', async () => {
  const { ledger, step } = await prepare();
  store.fail = 'checkpoint_step_v1';
  const iterator = iteratorFor(
    ledger,
    step,
    transport([Buffer.alloc(8192, 3)]),
  );
  await expect(iterator.next()).rejects.toMatchObject({
    code: 'execution_interrupted',
  });
  expect(store.response).toBeNull();
  expectPending('failed');
  expect(
    store.calls.filter((c) => c.name === 'checkpoint_step_v1'),
  ).toHaveLength(1);
  store.fail = '';
  store.calls = [];
  const controller = new AbortController();
  const checkpoint = ledger.checkpoint.bind(ledger);
  vi.spyOn(ledger, 'checkpoint').mockImplementation(async (...args) => {
    const result = await checkpoint(...args);
    controller.abort();
    return result;
  });
  const cancelled = iteratorFor(
    ledger,
    step,
    transport([Buffer.from('committed but not emitted')]),
    controller.signal,
  );
  await expect(cancelled.next()).rejects.toMatchObject({
    code: 'execution_interrupted',
  });
  expect(trace().toString()).toBe('committed but not emitted');
  expectPending('cancelled');
});

it('does not publish uncommitted text when the message checkpoint fails', async () => {
  store.fail = 'checkpoint_message_v1';
  const agent = new VulpesAgent(context, {
    adapter: new OpenRouterResponsesAdapter(),
    transport: transport(),
    price,
    maxRunCostUSD: '1',
  });
  const emitted = [];
  for await (const event of agent.run(
    input,
    lease,
    summary,
    null,
    new AbortController().signal,
  ))
    emitted.push(event);
  expect(emitted.at(-1)?.type).toBe('run.failed');
  expect(emitted.some((e) => e.type === 'text.delta')).toBe(false);
  expectPending('failed');
});

it('keeps parser failure classified as failure and unknown usage pending', async () => {
  const agent = new VulpesAgent(context, {
    adapter: new OpenRouterResponsesAdapter(),
    transport: transport([Buffer.from('data: {bad json}\n\n')]),
    price,
    maxRunCostUSD: '1',
  });
  const emitted = [];
  for await (const event of agent.run(
    input,
    lease,
    summary,
    null,
    new AbortController().signal,
  ))
    emitted.push(event);
  expect(emitted.at(-1)?.type).toBe('run.failed');
  expect(emitted.some((e) => e.type === 'text.delta')).toBe(false);
  expectPending('failed');
});

it('does not call or wait for hung cleanup during authorization', async () => {
  store.cleanup = 'hang';
  const { ledger, step } = await prepare();
  await ledger.authorize(step);
  expect(store.calls.some((c) => c.name === 'cleanup_data_v1')).toBe(false);
  expect(store.calls.some((c) => c.name === 'authorize_send_v1')).toBe(true);
});

it('retains expiry and decryption failures and never extends the step expiry', async () => {
  const { ledger, step } = await prepare();
  await ledger.checkpoint(step, Buffer.from('first'));
  const first = store.response as Envelope;
  await ledger.checkpoint(step, Buffer.from('second'));
  await ledger.saveState(step, { synthetic: true });
  expect(
    store.calls.filter((c) => c.name === 'private_payload_expiry_v1'),
  ).toHaveLength(1);
  expect((store.response as Envelope).expires_at).toBe(first.expires_at);
  const inputId = store.input!.input_payload_id;
  const original = store.payloads.get(inputId) as Envelope;
  store.payloads.set(inputId, {
    ...original,
    expires_at: '2020-01-01T00:00:00Z',
  });
  expect(await readPayload(context, inputId, 'ai_request')).toEqual({
    state: 'expired',
  });
  store.payloads.set(inputId, { ...original, encrypted_bytes: '\\x1234' });
  expect(await readPayload(context, inputId, 'ai_request')).toEqual({
    state: 'unavailable',
  });
});

it('saves an unflushed partial trace on cancellation without emitting it', async () => {
  vi.useFakeTimers();
  const { ledger, step } = await prepare();
  const stalled = stalledTransport();
  const controller = new AbortController();
  const iterator = iteratorFor(ledger, step, stalled.value, controller.signal);
  const next = iterator.next();
  const rejected = expect(next).rejects.toMatchObject({
    code: 'execution_interrupted',
  });
  await vi.advanceTimersByTimeAsync(100);
  controller.abort();
  await rejected;
  expect(trace()).toEqual(Buffer.from('partial 🦊'));
  expectPending('cancelled');
  expect(vi.getTimerCount()).toBe(0);
});

it('keeps the first message batch durable when the second batch fails', async () => {
  const agent = new VulpesAgent(context, {
    adapter: new OpenRouterResponsesAdapter(),
    transport: transport(),
    price,
    maxRunCostUSD: '1',
  });
  const original = agent.ledger.checkpointMessage.bind(agent.ledger);
  let checkpoints = 0;
  vi.spyOn(agent.ledger, 'checkpointMessage').mockImplementation(
    async (...args) => {
      if (++checkpoints === 2)
        throw new Error('synthetic_second_batch_failure');
      return original(...args);
    },
  );
  let emitted = '';
  let last = '';
  for await (const event of agent.run(
    input,
    lease,
    summary,
    null,
    new AbortController().signal,
  )) {
    last = event.type;
    if (event.type === 'text.delta') emitted += event.payload.text;
  }
  expect(last).toBe('run.failed');
  expect(emitted).toBe(deltas.slice(0, 256).join(''));
  expect(store.parts).toEqual([{ type: 'text', text: emitted }]);
  expectPending('failed');
});

it('stops agent text after owner cancellation and keeps uncertain usage pending', async () => {
  const text = 'x'.repeat(8192);
  const stalled = stalledTransport(
    frame({ type: 'response.output_text.delta', delta: text }),
  );
  const controller = new AbortController();
  const agent = new VulpesAgent(context, {
    adapter: new OpenRouterResponsesAdapter(),
    transport: stalled.value,
    price,
    maxRunCostUSD: '1',
  });
  const types: string[] = [];
  for await (const event of agent.run(
    input,
    lease,
    summary,
    null,
    controller.signal,
  )) {
    types.push(event.type);
    if (event.type === 'text.delta') controller.abort();
  }
  expect(types.filter((type) => type === 'text.delta')).toHaveLength(1);
  expect(types.at(-1)).toBe('run.cancelled');
  expect(store.parts).toEqual([{ type: 'text', text }]);
  expect(stalled.closed).toHaveBeenCalledOnce();
  expectPending('cancelled');
});

it('disposes an agent iterator without trailing emissions or a released usage hold', async () => {
  const stalled = stalledTransport(
    frame({ type: 'response.output_text.delta', delta: 'x'.repeat(8192) }),
  );
  const agent = new VulpesAgent(context, {
    adapter: new OpenRouterResponsesAdapter(),
    transport: stalled.value,
    price,
    maxRunCostUSD: '1',
  });
  const stream = agent.run(
    input,
    lease,
    summary,
    null,
    new AbortController().signal,
  );
  const iterator = stream[Symbol.asyncIterator]();
  let next = await iterator.next();
  while (!next.done && next.value.type !== 'text.delta')
    next = await iterator.next();
  expect(next.value?.type).toBe('text.delta');
  expect(await iterator.return!()).toMatchObject({ done: true });
  expect(await iterator.next()).toMatchObject({ done: true });
  expect(stalled.closed).toHaveBeenCalledOnce();
  // Preserve the agent's existing failed-consumer policy; direct dispatcher
  // abandonment is cancelled. Neither path treats unknown spend as not-sent.
  expectPending('failed');
});

it.each(['truncated', 'malformed'])(
  'commits parsed text before a later %s provider failure',
  async (failure) => {
    const text = 'Durable synthetic prefix 🦊';
    const chunks = [frame({ type: 'response.output_text.delta', delta: text })];
    if (failure === 'malformed')
      chunks.push(Buffer.from('data: invalid-json\n\n'));
    const agent = new VulpesAgent(context, {
      adapter: new OpenRouterResponsesAdapter(),
      transport: transport(chunks),
      price,
      maxRunCostUSD: '1',
    });
    const events = [];
    for await (const event of agent.run(
      input,
      lease,
      summary,
      null,
      new AbortController().signal,
    ))
      events.push(event);
    expect(events.at(-1)?.type).toBe('run.failed');
    expect(store.parts).toEqual([{ type: 'text', text }]);
    expect(
      events
        .filter((e) => e.type === 'text.delta')
        .map((e) => e.payload.text)
        .join(''),
    ).toBe(text);
    expectPending('failed');
  },
);

it('retains authoritative usage and the fixed expiry through successful settlement', async () => {
  const text = 'Synthetic final answer';
  const chunks = [
    frame({
      type: 'response.completed',
      response: {
        status: 'completed',
        output: [
          {
            type: 'message',
            role: 'assistant',
            content: [{ type: 'output_text', text }],
          },
        ],
        usage: { input_tokens: 20, output_tokens: 10, cost: '0.001' },
      },
    }),
  ];
  const agent = new VulpesAgent(context, {
    adapter: new OpenRouterResponsesAdapter(),
    transport: transport(chunks),
    price,
    maxRunCostUSD: '1',
  });
  vi.spyOn(agent.ledger, 'usageTotals').mockResolvedValue({
    inputTokens: 20,
    outputTokens: 10,
    reasoningTokens: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
  });
  const types: string[] = [];
  for await (const event of agent.run(
    input,
    lease,
    summary,
    null,
    new AbortController().signal,
  ))
    types.push(event.type);
  expect(types.at(-1)).toBe('run.completed');
  expect(settlements()).toHaveLength(1);
  expect(settlements()[0]).toMatchObject({
    p_status: 'completed',
    p_evidence: { source: 'reported', costUSD: '0.001' },
  });
  const evidence = settlements()[0]!.p_evidence as { usagePayload: Envelope };
  expect(
    JSON.parse(
      decryptBytes(evidence.usagePayload, readEncryptionKeys()).toString(),
    ),
  ).toMatchObject({ reportedCostUSD: '0.001', inputTokens: 20 });
  expect(evidence.usagePayload.expires_at).toBe(
    (store.response as Envelope).expires_at,
  );
  expect(
    store.calls.filter((c) => c.name === 'private_payload_expiry_v1'),
  ).toHaveLength(1);
});

it('saves a lookahead chunk received during a timed checkpoint when the consumer returns', async () => {
  vi.useFakeTimers();
  const { ledger, step } = await prepare();
  let releaseRead!: () => void;
  let releaseCommit!: () => void;
  const read = new Promise<void>((resolve) => {
    releaseRead = resolve;
  });
  const commit = new Promise<void>((resolve) => {
    releaseCommit = resolve;
  });
  const value: RequestTransport = {
    mode: 'mock',
    async *send() {
      yield Buffer.from('prefix');
      await read;
      yield Buffer.from(' lookahead');
    },
  };
  const original = ledger.checkpoint.bind(ledger);
  vi.spyOn(ledger, 'checkpoint').mockImplementationOnce(async (...args) => {
    const result = await original(...args);
    await commit;
    return result;
  });
  const iterator = iteratorFor(ledger, step, value);
  const first = iterator.next();
  await vi.advanceTimersByTimeAsync(250);
  releaseRead();
  await vi.advanceTimersByTimeAsync(1);
  releaseCommit();
  expect(await first).toMatchObject({
    value: Buffer.from('prefix'),
    done: false,
  });
  expect(trace().toString()).toBe('prefix');
  expect(await iterator.return!()).toMatchObject({ done: true });
  expect(trace().toString()).toBe('prefix lookahead');
  expectPending('cancelled');
  expect(vi.getTimerCount()).toBe(0);
});

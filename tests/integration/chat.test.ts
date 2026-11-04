import * as catalog from '../../server/config/models.js';
import { composeEverydayProduction } from '../../server/ai/providers/openrouter-production.js';
vi.mock(
  '../../server/config/everyday-production.js',
  async (importOriginal) => ({
    ...(await importOriginal<object>()),
    everydayMaxRunCostUSD: '0.25',
  }),
);
import {
  VertexGenerationAdapter,
  vertexEndpoint,
} from '../../server/ai/providers/vertex.js';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalSupabase } from '../helpers/local-supabase.js';
import { localStatus } from '../../scripts/local-database.js';
import { verifySession, type AuthContext } from '../../server/auth/session.js';
import { ConversationService } from '../../server/services/conversations.js';
import {
  ExecutionService,
  requestHash,
} from '../../server/ai/ledger/execution.js';
import { ConversationQuerySchema } from '../../shared/chat.js';
import { ChatSendRequestSchema } from '../../shared/api.js';
import { createChatHandler } from '../../server/http/chat.js';
import { createConversationsHandler } from '../../server/http/conversations.js';
import { localRouter } from '../../server/http/router.js';
import { StreamDecoder, type StreamEvent } from '../../shared/stream.js';
import {
  SyntheticChatTransport,
  syntheticChatDependencies,
  responseFrame,
  assistantOutput,
} from '../fixtures/chat.js';
import { readPayload } from '../../server/security/private-payloads.js';
import {
  encryptBytes,
  readEncryptionKeys,
} from '../../server/security/encryption.js';
import { executeReadTool, providerToolResult } from '../../server/ai/tools.js';
import { InspectionService } from '../../server/services/inspection.js';
import {
  VulpesAgent,
  type AgentDependencies,
} from '../../server/ai/VulpesAgent.js';
import type { RequestTransport } from '../../server/ai/ledger/dispatcher.js';
import {
  normalizeUsage,
  type GenerationAdapter,
} from '../../server/ai/contracts.js';
import { addMeasurement } from '../../server/services/measurements.js';
import { goalDraft } from '../fixtures/contracts.js';

let db: LocalSupabase;
let a: AuthContext;
let b: AuthContext;
let app: string;
let tokenA: string;
let tokenB: string;
const service = () => new ConversationService(a);
async function conversation() {
  const id = randomUUID();
  await service().mutate({
    action: 'create',
    id,
    client_request_id: randomUUID(),
  });
  return id;
}
const admission = (id: string) => ({
  conversationId: id,
  clientRequestId: randomUUID(),
  requestHash: requestHash({ text: 'Synthetic question' }),
  depth: 'auto' as const,
  route: {
    role: 'everyday' as const,
    provider: 'openrouter' as const,
    model: 'openai/gpt-6-luna',
    effort: 'low',
  },
  consentVersion: 'openrouter_zdr_v2',
});
async function rows(table: string, filter: string) {
  return (await (
    await db.admin(`/rest/v1/${table}?${filter}`, 'GET')
  ).json()) as Record<string, unknown>[];
}
beforeEach(async () => {
  const status = localStatus();
  vi.stubEnv('VITE_SUPABASE_URL', status.apiUrl);
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', status.anonKey);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', status.adminKey);
  vi.stubEnv('VULPES_TRACE_ENCRYPTION_KEY_ID', 'synthetic-chat');
  vi.stubEnv(
    'VULPES_TRACE_ENCRYPTION_KEY_B64',
    randomBytes(32).toString('base64'),
  );
  db = new LocalSupabase();
  app = randomUUID();
  const period = new Date().toISOString().slice(0, 7) + '-01';
  await db.admin('/rest/v1/usage_buckets', 'POST', {
    id: app,
    scope: 'app',
    period_start: period,
    allocated_ceiling_usd: '10',
  });
  const contexts = [];
  for (let i = 0; i < 2; i++) {
    const user = await db.createUser();
    if (i === 0) tokenA = user.token;
    else tokenB = user.token;
    await db.admin('/rest/v1/profiles', 'POST', {
      user_id: user.id,
      consent_versions: {
        openrouter: {
          accepted_version: 'openrouter_zdr_v2',
          accepted_at: new Date().toISOString(),
        },
      },
    });
    await db.admin('/rest/v1/usage_buckets', 'POST', {
      user_id: user.id,
      scope: 'account',
      period_start: period,
      allocated_ceiling_usd: '1',
    });
    contexts.push(
      await verifySession({
        headers: { authorization: `Bearer ${user.token}` },
      }),
    );
  }
  [a, b] = contexts as [AuthContext, AuthContext];
});

async function withApi(
  dependencies: AgentDependencies | null | 'production',
  work: (
    api: (
      path: string,
      body?: unknown,
      token?: string | null,
    ) => Promise<Response>,
  ) => Promise<void>,
) {
  const compose =
    dependencies === 'production'
      ? composeEverydayProduction
      : () => dependencies;
  const chat = createChatHandler(compose);
  const conversations = createConversationsHandler(compose);
  const server = createServer((req, res) => {
    const path = new URL(req.url!, 'http://localhost').pathname;
    void (path === '/api/chat'
      ? chat(req, res)
      : path === '/api/conversations'
        ? conversations(req, res)
        : localRouter(req, res));
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error();
  try {
    await work((path, body, token = tokenA) =>
      fetch(`http://127.0.0.1:${address.port}${path}`, {
        ...(body === undefined
          ? {}
          : { method: 'POST', body: JSON.stringify(body) }),
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      }),
    );
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
async function stream(response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toContain('text/event-stream');
  const decoder = new StreamDecoder();
  const output: StreamEvent[] = [];
  for await (const chunk of response.body!) output.push(...decoder.push(chunk));
  decoder.finish();
  return output;
}
const send = (id: string, text = 'How has my imported weight changed?') => ({
  action: 'send',
  conversation_id: id,
  client_request_id: randomUUID(),
  message: { id: randomUUID(), text },
  depth: 'auto',
});
it.each([
  ['list_metrics', { extra: 'synthetic' }, 'invalid_arguments'],
  [
    'summarize_metric',
    { metric: 'weight', from: '2026-11-04', to: '2026-10-28', timezone: 'UTC' },
    'invalid_interval',
  ],
] as const)(
  'inspects and exports rejected tool evidence for %s',
  async (name, args, code) => {
    let requests = 0;
    const transport: RequestTransport = {
      mode: 'mock',
      async *send() {
        yield responseFrame(
          ++requests === 1
            ? [
                {
                  type: 'function_call',
                  id: 'rejected',
                  call_id: 'call-rejected',
                  name,
                  arguments: JSON.stringify(args),
                },
              ]
            : [
                assistantOutput(
                  'The synthetic tool arguments need correction.',
                ),
              ],
        );
      },
    };
    await withApi(syntheticChatDependencies(transport), async (api) => {
      const events = await stream(
        await api('/api/chat', send(await conversation())),
      );
      expect(events.at(-1)?.type).toBe('run.completed');
      const run = events[0]!.run_id;
      const tool = (
        await rows('ai_steps', `run_id=eq.${run}&step_type=eq.tool`)
      )[0]!;
      const inspector = new InspectionService(a);
      for (const part of ['input', 'output'] as const) {
        const raw = await readPayload(
          a,
          String(tool[`${part}_payload_id`]),
          part === 'input' ? 'tool_input' : 'tool_output',
        );
        expect(raw.state).toBe('available');
        if (raw.state !== 'available')
          throw new Error('missing synthetic evidence');
        const query = {
          view: 'payload' as const,
          run,
          step: String(tool.id),
          part,
        };
        expect((await inspector.evidence(query)).state).toBe('available');
        const payload = await api(
          `/api/executions?${new URLSearchParams(query)}`,
        );
        expect((await payload.json()).data.base64).toBe(
          raw.bytes.toString('base64'),
        );
        const exported = await api(
          `/api/executions?${new URLSearchParams({ ...query, view: 'export' })}`,
        );
        expect(exported.headers.get('content-type')).toBe(
          'application/octet-stream',
        );
        expect(Buffer.from(await exported.arrayBuffer())).toEqual(raw.bytes);
        expect(
          (
            await api(
              `/api/executions?${new URLSearchParams(query)}`,
              undefined,
              tokenB,
            )
          ).status,
        ).toBe(404);
        expect(
          (
            await api(
              `/api/executions?${new URLSearchParams(query)}`,
              undefined,
              null,
            )
          ).status,
        ).toBe(401);
        const parsed = JSON.parse(raw.bytes.toString());
        if (part === 'output')
          expect(parsed.result).toMatchObject({
            kind: 'tool_error',
            code,
            recoverable: true,
          });
        else expect(parsed.arguments).toEqual(args);
      }
      const outputId = String(tool.output_payload_id);
      const envelope = (
        await rows('private_payloads', `id=eq.${outputId}`)
      )[0]!;
      const raw = await readPayload(a, outputId, 'tool_output');
      if (raw.state !== 'available') throw new Error('missing output');
      const original = JSON.parse(raw.bytes.toString());
      const query = {
        view: 'payload' as const,
        run,
        step: String(tool.id),
        part: 'output' as const,
      };
      const replace = async (
        id: string,
        purpose: 'tool_input' | 'tool_output',
        value: unknown,
      ) => {
        await db.admin(
          `/rest/v1/private_payloads?id=eq.${id}`,
          'PATCH',
          encryptBytes(
            {
              id,
              user_id: a.userId,
              purpose,
              expires_at: String(envelope.expires_at),
            },
            Buffer.from(JSON.stringify(value)),
            readEncryptionKeys(),
          ),
        );
      };
      for (const bad of [
        { ...original, result: { ...original.result, recoverable: false } },
        { ...original, result: { ...original.result, code: 'invented' } },
        { ...original, evidence: { ...original.evidence, ownerId: b.userId } },
        {
          ...original,
          providerResult: { ...original.providerResult, hint: 'different' },
        },
      ]) {
        await replace(outputId, 'tool_output', bad);
        expect((await inspector.evidence(query)).state).toBe('corrupt');
      }
      await db.admin(
        `/rest/v1/private_payloads?id=eq.${outputId}`,
        'PATCH',
        envelope,
      );
      await replace(String(tool.input_payload_id), 'tool_input', {
        callId: 'altered',
        name,
        arguments: args,
      });
      expect(
        (await inspector.evidence({ ...query, part: 'input' })).state,
      ).toBe('corrupt');
      await db.admin(`/rest/v1/private_payloads?id=eq.${outputId}`, 'PATCH', {
        created_at: new Date(Date.now() - 2000).toISOString(),
        expires_at: new Date(Date.now() - 1000).toISOString(),
      });
      expect((await inspector.evidence(query)).state).toBe('expired');
    });
  },
);
it('executes the production composition through HTTP, ledger, exact capture and reload with a synthetic provider', async () => {
  const readiness = vi
    .spyOn(catalog, 'getRoleAvailability')
    .mockReturnValue({ state: 'available', reason: 'verified' });
  vi.stubEnv('VULPES_LIVE_AI_ENABLED', 'true');
  vi.stubEnv('OPENROUTER_API_KEY', 'synthetic-key');
  const originalFetch = globalThis.fetch;
  const transport = new SyntheticChatTransport();
  vi.stubGlobal(
    'fetch',
    async (input: RequestInfo | URL, options?: RequestInit) => {
      if (String(input) !== 'https://openrouter.ai/api/v1/responses')
        return originalFetch(input, options);
      expect(options?.redirect).toBe('error');
      return new Response(
        new ReadableStream({
          async start(controller) {
            try {
              for await (const chunk of transport.send(
                Buffer.from(options!.body as Uint8Array),
                options!.signal!,
              ))
                controller.enqueue(chunk);
              controller.close();
            } catch (error) {
              controller.error(error);
            }
          },
        }),
        { headers: { 'Content-Type': 'text/event-stream' } },
      );
    },
  );
  try {
    await withApi('production', async (api) => {
      const id = await conversation();
      const input = send(id, 'How has my weight changed?');
      const events = await stream(await api('/api/chat', input));
      expect(events.at(-1)?.type).toBe('run.completed');
      const count = transport.requests.length;
      expect(count).toBeGreaterThan(0);
      const inspector = new InspectionService(a);
      const overview = await inspector.overview(events[0]!.run_id);
      const generations = overview.steps.filter(
        (step) => step.type === 'generation',
      );
      expect(generations).toHaveLength(count);
      for (let i = 0; i < count; i++) {
        const payload = await inspector.evidence({
          view: 'payload',
          run: events[0]!.run_id,
          step: generations[i]!.id,
          part: 'input',
        });
        expect(payload.state).toBe('available');
        if (payload.state === 'available')
          expect(payload.bytes.equals(transport.requests[i]!)).toBe(true);
      }
      expect(
        (await api('/api/chat', input)).headers.get('content-type'),
      ).toContain('application/json');
      expect(
        (await api('/api/conversations?view=messages&id=' + id)).status,
      ).toBe(200);
      expect(transport.requests).toHaveLength(count);
    });
  } finally {
    readiness.mockRestore();
    vi.unstubAllGlobals();
  }
});

it('provisions budgets idempotently without resetting balances or granting client access', async () => {
  await db.admin(`/rest/v1/usage_buckets?id=eq.${app}`, 'PATCH', {
    spent_usd: '0.2',
    reserved_usd: '0.1',
  });
  const before = await rows('usage_buckets', `id=eq.${app}`);
  const request = {
    p_owner: a.userId,
    p_app_ceiling: '10',
    p_account_ceiling: '1',
  };
  for (let i = 0; i < 2; i++)
    await db.admin('/rest/v1/rpc/provision_pilot_budget_v1', 'POST', request);
  expect(await rows('usage_buckets', `id=eq.${app}`)).toEqual(before);
  await db.admin(`/rest/v1/usage_buckets?user_id=eq.${b.userId}`, 'DELETE');
  await db.admin('/rest/v1/rpc/provision_pilot_budget_v1', 'POST', {
    ...request,
    p_owner: b.userId,
  });
  expect(
    (await rows('usage_buckets', `user_id=eq.${b.userId}`))[0]!
      .allocated_ceiling_usd,
  ).toBe(1);
  expect(
    (
      await db.request('/rest/v1/rpc/provision_pilot_budget_v1', tokenA, {
        method: 'POST',
        body: JSON.stringify(request),
      })
    ).status,
  ).toBe(403);
  const changed = await db.request(
    '/rest/v1/rpc/provision_pilot_budget_v1',
    'admin',
    {
      method: 'POST',
      body: JSON.stringify({ ...request, p_app_ceiling: '11' }),
    },
  );
  expect(changed.ok).toBe(false);
  expect(await rows('usage_buckets', `id=eq.${app}`)).toEqual(before);
});

describe('synthetic HTTP → PostgreSQL → tool → continuation → SSE', () => {
  it('refuses an unapproved or foreign handoff without changing the run route', async () => {
    const ledger = new ExecutionService(a, { maxRunCostUSD: '0.25' });
    const admitted = await ledger.admit(admission(await conversation()));
    if (!admitted.lease) throw new Error('Expected lease');
    await expect(
      ledger.handoff(admitted.lease, randomUUID(), 'multi_metric_comparison'),
    ).rejects.toMatchObject({ status: 403 });
    const run = await ledger.summary(admitted.lease.runId);
    expect(run.route?.role).toBe('everyday');
    const stored = await rows(
      'ai_runs',
      `id=eq.${run.id}&select=route_history`,
    );
    expect(stored[0]!.route_history).toEqual([]);
    await expect(
      new ExecutionService(b).handoff(
        admitted.lease,
        randomUUID(),
        'multi_metric_comparison',
      ),
    ).rejects.toMatchObject({ status: 404 });
  });

  it('hands off once from Luna to Flash with owned summaries and exact persisted Vertex input', async () => {
    const acceptedAt = new Date().toISOString();
    await db.admin('/rest/v1/vertex_policy_approval', 'POST', {
      id: true,
      policy_version: 'synthetic-google-v1',
      project: 'synthetic-project',
      location: 'us',
      notice: 'Synthetic verification only',
      privacy_fingerprint: 'a'.repeat(64),
    });
    try {
      await db.admin(`/rest/v1/profiles?user_id=eq.${a.userId}`, 'PATCH', {
        consent_versions: {
          openrouter: {
            accepted_version: 'openrouter_zdr_v2',
            accepted_at: acceptedAt,
          },
          vertex_ai: {
            accepted_version: 'synthetic-google-v1',
            accepted_at: acceptedAt,
          },
        },
      });
      const captured: Buffer[] = [];
      const primary: RequestTransport = {
        mode: 'mock',
        async *send(body) {
          const request = JSON.parse(Buffer.from(body).toString());
          const results = request.input
            .filter((x: { type: string }) => x.type === 'function_call_output')
            .map((x: { output: string }) => JSON.parse(x.output));
          const summaries = results.filter(
            (x: { result: { kind: string } }) => x.result.kind === 'summary',
          );
          const metrics = results.find(
            (x: { result: { kind: string } }) => x.result.kind === 'metrics',
          );
          const call = (name: string, args: unknown, n: string) => ({
            type: 'function_call',
            id: n,
            call_id: n,
            name,
            arguments: JSON.stringify(args),
          });
          if (summaries.length === 2)
            yield responseFrame([
              call(
                'request_escalation',
                {
                  task: 'multi_metric_comparison',
                  rationale: 'Compare two calculated series',
                  evidenceIds: summaries.map(
                    (x: { evidence: { resultId: string } }) =>
                      x.evidence.resultId,
                  ),
                },
                'handoff',
              ),
            ]);
          else if (metrics)
            yield responseFrame(
              ['weight', 'body_fat_percent'].map((metric) => {
                const item = metrics.result.items.find(
                  (x: { metric: string }) => x.metric === metric,
                );
                return call(
                  'summarize_metric',
                  {
                    metric,
                    source_id: item.source_id,
                    method: item.method,
                    granularity: item.granularity,
                    from: '2026-09-01T00:00:00Z',
                    to: '2026-09-15T00:00:00Z',
                    timezone: 'UTC',
                  },
                  metric,
                );
              }),
            );
          else yield responseFrame([call('list_metrics', {}, 'inventory')]);
        },
      };
      const flash: RequestTransport = {
        mode: 'mock',
        async *send(body) {
          captured.push(Buffer.from(body));
          yield Buffer.from(
            'data: ' +
              JSON.stringify({
                candidates: [
                  {
                    content: {
                      role: 'model',
                      parts: [
                        {
                          text: 'Calculated comparison of the synthetic series.',
                        },
                      ],
                    },
                    finishReason: 'STOP',
                  },
                ],
                usageMetadata: {
                  promptTokenCount: 100,
                  candidatesTokenCount: 10,
                  thoughtsTokenCount: 5,
                  cachedContentTokenCount: 0,
                },
              }) +
              '\n\n',
          );
        },
      };
      const dependencies = syntheticChatDependencies(primary);
      dependencies.flash = {
        adapter: new VertexGenerationAdapter(
          'intermediate',
          vertexEndpoint('synthetic-project', 'us', 'intermediate'),
        ),
        transport: flash,
        price: {
          ...dependencies.price,
          inputBoundTokens: 24000,
          outputBoundTokens: 8192,
        },
        consentVersion: 'synthetic-google-v1',
      };
      await withApi(dependencies, async (api) => {
        const preview = await api('/api/data', {
          action: 'preview_csv',
          client_request_id: randomUUID(),
          csv: readFileSync(
            'docs/spec/v0.1.0/fixtures/measurements-synthetic.csv',
            'utf8',
          ),
          source: {
            kind: 'new',
            label: 'Synthetic routing',
            origin_app: null,
            device_label: null,
          },
          mapping: {
            schema_version: 1,
            format: 'canonical',
            timezone: 'UTC',
            profile: null,
            single_profile: true,
            review_requested: false,
            source_label: 'Synthetic Scale A',
          },
        });
        expect(preview.status).toBe(200);
        const p = (await preview.json()).data;
        expect(
          (
            await api('/api/data', {
              action: 'commit_import',
              batch_id: p.batch_id,
              payload_hash: p.payload_hash,
              client_request_id: randomUUID(),
            })
          ).status,
        ).toBe(200);
        const events = await stream(
          await api(
            '/api/chat',
            send(await conversation(), 'Compare the two synthetic series.'),
          ),
        );
        expect(events.at(-1)?.type, JSON.stringify(events.at(-1))).toBe(
          'run.completed',
        );
        expect(captured).toHaveLength(1);
        expect(
          events
            .filter((e) => e.type === 'route.selected')
            .map((e) => e.payload.role),
        ).toEqual(['everyday', 'intermediate']);
        const inspector = new InspectionService(a);
        const overview = await inspector.overview(events[0]!.run_id);
        expect(overview.routeHistory).toHaveLength(1);
        const vertex = overview.steps.find(
          (step) => step.provider === 'vertex_ai',
        )!;
        const payload = await inspector.evidence({
          view: 'payload',
          run: events[0]!.run_id,
          step: vertex.id,
          part: 'input',
        });
        expect(payload.state).toBe('available');
        if (payload.state === 'available')
          expect(payload.bytes.equals(captured[0]!)).toBe(true);
      });
    } finally {
      await db.admin('/rest/v1/vertex_policy_approval?id=eq.true', 'DELETE');
    }
  });

  it('fits the live-observed fourteen-measurement path through a deterministic summary and answer', async () => {
    const transport = new SyntheticChatTransport('measurements');
    await withApi(syntheticChatDependencies(transport), async (api) => {
      const preview = await api('/api/data', {
        action: 'preview_csv',
        client_request_id: randomUUID(),
        csv: readFileSync(
          'docs/spec/v0.1.0/fixtures/measurements-synthetic.csv',
          'utf8',
        ),
        source: {
          kind: 'new',
          label: 'Synthetic verification import',
          origin_app: null,
          device_label: null,
        },
        mapping: {
          schema_version: 1,
          format: 'canonical',
          timezone: 'UTC',
          profile: null,
          single_profile: true,
          review_requested: false,
          source_label: 'Synthetic Scale A',
        },
      });
      expect(preview.status).toBe(200);
      const p = (await preview.json()).data;
      expect(
        (
          await api('/api/data', {
            action: 'commit_import',
            batch_id: p.batch_id,
            payload_hash: p.payload_hash,
            client_request_id: randomUUID(),
          })
        ).status,
      ).toBe(200);
      const events = await stream(
        await api(
          '/api/chat',
          send(
            await conversation(),
            'Using the imported synthetic scale records, calculate the seven-day weight mean and change for 2026-09-01 through 2026-09-14 UTC. Use the available read tool and explain its coverage.',
          ),
        ),
      );
      const saved = [];
      for (const step of await rows(
        'ai_steps',
        `run_id=eq.${events[0]!.run_id}&order=sequence`,
      ))
        if (step.continuation_payload_id) {
          const payload = await readPayload(
            a,
            String(step.continuation_payload_id),
            'provider_state',
          );
          if (payload.state === 'available') {
            const r = JSON.parse(payload.bytes.toString());
            saved.push({
              bytes: payload.bytes.length,
              turns: r.turns.map((t: { type: string; name?: string }) => ({
                type: t.type,
                name: t.name,
                bytes: Buffer.byteLength(JSON.stringify(t)),
              })),
            });
          }
        }
      expect(
        events.at(-1)?.type,
        JSON.stringify({ last: events.at(-1), saved }),
      ).toBe('run.completed');
      expect(transport.requests).toHaveLength(4);
      expect(transport.requests.every((bytes) => bytes.length <= 12000)).toBe(
        true,
      );
      expect(
        events
          .filter((e) => e.type === 'tool.result')
          .map((e) => e.payload.tool_name),
      ).toEqual(['list_metrics', 'get_measurements', 'summarize_metric']);
      expect(
        events
          .filter((e) => e.type === 'text.delta')
          .map((e) => e.payload.text)
          .join(''),
      ).toContain('69 kg; change -0.7 kg');
      const run = events[0]!.run_id;
      const inspector = new InspectionService(a);
      const measurement = (
        await rows('ai_steps', `run_id=eq.${run}&tool_name=eq.get_measurements`)
      )[0]!;
      const output = await readPayload(
        a,
        String(measurement.output_payload_id),
        'tool_output',
      );
      expect(output.state).toBe('available');
      if (output.state !== 'available') throw new Error();
      const stored = JSON.parse(output.bytes.toString());
      expect(stored.projectionVersion).toBe(3);
      expect(stored.result.items).toHaveLength(14);
      const query = {
        view: 'payload' as const,
        run,
        step: String(measurement.id),
        part: 'output' as const,
      };
      expect((await inspector.evidence(query)).state).toBe('available');
      const expiresAt = String(
        (
          await rows(
            'private_payloads',
            `id=eq.${measurement.output_payload_id}`,
          )
        )[0]!.expires_at,
      );
      const replace = async (value: unknown) => {
        const envelope = encryptBytes(
          {
            id: String(measurement.output_payload_id),
            user_id: a.userId,
            purpose: 'tool_output',
            expires_at: expiresAt,
          },
          Buffer.from(JSON.stringify(value)),
          readEncryptionKeys(),
        );
        await db.admin(
          `/rest/v1/private_payloads?id=eq.${envelope.id}`,
          'PATCH',
          envelope,
        );
      };
      const legacy = {
        evidence: stored.evidence,
        result: stored.result,
        providerResult: providerToolResult(stored.result, 1),
      };
      await replace(legacy);
      expect((await inspector.evidence(query)).state).toBe('available');
      await replace({ ...stored, projectionVersion: 2 });
      expect((await inspector.evidence(query)).state).toBe('available');
      await replace({
        ...stored,
        providerResult: { ...stored.providerResult, rows: [] },
      });
      expect((await inspector.evidence(query)).state).toBe('corrupt');
      await replace({ ...stored, projectionVersion: 99 });
      expect((await inspector.evidence(query)).state).toBe('corrupt');
    });
  });
  it('replays retained message receipts after run expiry even when inference is unavailable', async () => {
    let calls = 0;
    const transport: RequestTransport = {
      mode: 'mock',
      async *send() {
        calls++;
        yield responseFrame([assistantOutput('Saved synthetic answer')]);
      },
    };
    const id = await conversation();
    const input = send(id);
    let run = '';
    await withApi(syntheticChatDependencies(transport), async (api) => {
      const events = await stream(await api('/api/chat', input));
      expect(events.at(-1)?.type).toBe('run.completed');
      run = events[0]!.run_id;
    });
    await db.admin(`/rest/v1/ai_runs?id=eq.${run}`, 'PATCH', {
      expires_at: new Date(Date.now() - 1000).toISOString(),
    });
    await new ExecutionService(a).reconcile();
    expect(await rows('ai_runs', `id=eq.${run}`)).toHaveLength(0);
    const expected = {
      kind: 'retained',
      conversationId: id,
      message: { id: input.message.id, status: 'completed' },
    };
    const ledger = new ExecutionService(a, { maxRunCostUSD: '0.25' });
    const atomic = await ledger.admit(
      {
        ...admission(id),
        clientRequestId: input.client_request_id,
        requestHash: requestHash(ChatSendRequestSchema.parse(input)),
      },
      input.message,
    );
    expect(atomic.result).toEqual(expected);
    expect(atomic.lease).toBeNull();
    const denied = await db.request('/rest/v1/rpc/replay_chat_v1', tokenA, {
      method: 'POST',
      body: JSON.stringify({
        p_owner: a.userId,
        p_request: {
          conversationId: id,
          clientRequestId: input.client_request_id,
          requestHash: requestHash(ChatSendRequestSchema.parse(input)),
        },
        p_message: input.message,
      }),
    });
    expect([401, 403, 404]).toContain(denied.status);
    await withApi(null, async (api) => {
      const replays = await Promise.all([
        api('/api/chat', input),
        api('/api/chat', input),
      ]);
      for (const replay of replays) {
        expect(replay.status).toBe(200);
        expect((await replay.json()).data).toEqual(expected);
      }
      for (const changed of [
        { ...input, message: { ...input.message, text: 'Changed text' } },
        { ...input, message: { ...input.message, id: randomUUID() } },
        { ...input, client_request_id: randomUUID() },
        { ...input, conversation_id: await conversation() },
      ])
        expect((await api('/api/chat', changed)).status).toBe(409);
      expect((await api('/api/chat', input, tokenB)).status).toBe(404);
      await service().mutate({
        action: 'archive',
        id,
        client_request_id: randomUUID(),
      });
      expect((await (await api('/api/chat', input)).json()).data).toEqual(
        expected,
      );
      const saved = (
        await (await api(`/api/conversations?view=messages&id=${id}`)).json()
      ).data;
      expect(saved.run).toBeNull();
      expect(saved.items).toHaveLength(2);
      expect(saved.items[1].parts).toEqual([
        { type: 'text', text: 'Saved synthetic answer' },
      ]);
      await service().mutate({
        action: 'delete',
        id,
        confirm: true,
        client_request_id: randomUUID(),
      });
      expect((await api('/api/chat', input)).status).toBe(404);
    });
    expect(calls).toBe(1);
    expect(await rows('ai_runs', `user_id=eq.${a.userId}`)).toHaveLength(0);
  });
  it('retains observed completion metadata in the owned inspector after private response expiry', async () => {
    const transport: RequestTransport = {
      mode: 'mock',
      async *send() {
        yield Buffer.from(
          'data: ' +
            JSON.stringify({
              type: 'response.completed',
              response: {
                id: 'resp-synthetic-metadata',
                model: 'synthetic/effective-model',
                reasoning: { effort: 'medium' },
                status: 'completed',
                output: [assistantOutput('Synthetic metadata answer')],
                usage: { input_tokens: 50, output_tokens: 20, cost: '0.001' },
              },
            }) +
            '\n\n',
        );
      },
    };
    await withApi(syntheticChatDependencies(transport), async (api) => {
      const id = await conversation();
      const events = await stream(await api('/api/chat', send(id)));
      expect(events.at(-1)?.type).toBe('run.completed');
      const run = events[0]!.run_id;
      const overview = async () =>
        (await (await api(`/api/executions?run=${run}`)).json()).data;
      const expected = {
        providerRequestId: 'resp-synthetic-metadata',
        finishReason: 'stop',
        model: 'openai/gpt-6-luna',
        effectiveModel: 'synthetic/effective-model',
        requestedEffort: 'low',
        effectiveEffort: 'medium',
      };
      const before = await overview();
      expect(before.steps[0]).toMatchObject(expected);
      expect(
        (await api(`/api/executions?run=${run}`, undefined, tokenB)).status,
      ).toBe(404);
      await db.admin(
        `/rest/v1/private_payloads?user_id=eq.${a.userId}`,
        'PATCH',
        {
          created_at: new Date(Date.now() - 2000).toISOString(),
          expires_at: new Date(Date.now() - 1000).toISOString(),
        },
      );
      const payload = (
        await (
          await api(
            `/api/executions?view=payload&run=${run}&step=${before.steps[0].id}&part=output`,
          )
        ).json()
      ).data;
      expect(payload.state).toBe('expired');
      expect((await overview()).steps[0]).toMatchObject(expected);
    });
  });
  it('answers imported data, preserves exact multi-step evidence, replays once and reloads without inference', async () => {
    const transport = new SyntheticChatTransport();
    await withApi(syntheticChatDependencies(transport), async (api) => {
      const preview = await api('/api/data', {
        action: 'preview_csv',
        client_request_id: randomUUID(),
        csv: readFileSync(
          'docs/spec/v0.1.0/fixtures/measurements-synthetic.csv',
          'utf8',
        ),
        source: {
          kind: 'new',
          label: 'Synthetic Ask import',
          origin_app: null,
          device_label: null,
        },
        mapping: {
          schema_version: 1,
          format: 'canonical',
          timezone: 'UTC',
          profile: null,
          single_profile: true,
          review_requested: false,
          source_label: 'Synthetic Scale A',
        },
      });
      expect(preview.status).toBe(200);
      const p = (await preview.json()).data;
      expect(
        (
          await api('/api/data', {
            action: 'commit_import',
            batch_id: p.batch_id,
            payload_hash: p.payload_hash,
            client_request_id: randomUUID(),
          })
        ).status,
      ).toBe(200);
      const id = await conversation();
      const input = {
        ...send(id),
        context_selection: {
          metric: 'weight',
          source_id: p.source_id,
          goal_id: null,
          from: '2026-09-01T00:00:00Z',
          to: '2026-09-15T00:00:00Z',
          timezone: 'UTC',
        },
      };
      const events = await stream(await api('/api/chat', input));
      expect(
        events.at(-1)?.type,
        JSON.stringify({
          events: events.map((e) => ({
            type: e.type,
            ...(e.type === 'run.failed' ? { code: e.payload.code } : {}),
          })),
          sizes: transport.requests.map((r) => r.length),
          steps: (await rows('ai_steps', `user_id=eq.${a.userId}`)).map(
            (s) => ({ type: s.step_type, status: s.status, tool: s.tool_name }),
          ),
        }),
      ).toBe('run.completed');
      expect(events.filter((e) => e.type === 'tool.result')).toHaveLength(2);
      expect(events.filter((e) => e.type === 'card.ready')).toHaveLength(1);
      expect(
        events
          .filter((e) => e.type === 'text.delta')
          .map((e) => e.payload.text)
          .join(''),
      ).toContain('69 kg; change -0.7 kg');
      expect(events.find((e) => e.type === 'run.usage')?.payload).toMatchObject(
        {
          inputTokens: 150,
          outputTokens: 60,
          reasoningTokens: null,
          costUSD: '0.003',
        },
      );
      expect(events.map((e) => e.seq)).toEqual(events.map((_, i) => i + 1));
      expect(transport.requests).toHaveLength(3);
      const runId = events[0]!.run_id;
      const steps = await rows('ai_steps', `run_id=eq.${runId}&order=sequence`);
      expect(steps).toHaveLength(5);
      const paid = steps.filter((s) => s.step_type === 'generation');
      const toolRows = steps.filter((s) => s.step_type === 'tool');
      const manifests = [];
      for (const generation of paid) {
        const payload = await readPayload(
          a,
          String(generation.context_payload_id),
          'provider_state',
        );
        expect(payload.state).toBe('available');
        if (payload.state !== 'available') throw new Error();
        manifests.push(JSON.parse(payload.bytes.toString()));
      }
      expect(manifests.every((manifest) => manifest.captureVersion === 2)).toBe(
        true,
      );
      expect(
        manifests[0].included.some(
          (item: { reference: { kind: string } }) =>
            item.reference.kind === 'instruction',
        ),
      ).toBe(true);
      expect(
        manifests[0].included.some(
          (item: { reference: { kind: string } }) =>
            item.reference.kind === 'context_selection',
        ),
      ).toBe(true);
      for (let i = 0; i < toolRows.length; i++) {
        const payload = await readPayload(
          a,
          String(toolRows[i]!.output_payload_id),
          'tool_output',
        );
        expect(payload.state).toBe('available');
        if (payload.state !== 'available') throw new Error();
        const evidence = JSON.parse(payload.bytes.toString()).evidence;
        expect(
          manifests[i + 1].included.some(
            (item: { reference: { id: string; kind: string } }) =>
              item.reference.id === evidence.resultId &&
              item.reference.kind === 'tool_result',
          ),
        ).toBe(true);
      }
      for (let i = 0; i < paid.length; i++) {
        const payload = await readPayload(
          a,
          String(paid[i]!.input_payload_id),
          'ai_request',
        );
        expect(payload.state).toBe('available');
        if (payload.state === 'available')
          expect(payload.bytes).toEqual(transport.requests[i]);
      }
      const overview = await api(`/api/executions?run=${runId}`);
      expect(overview.status).toBe(200);
      const inspected = (await overview.json()).data;
      expect(
        inspected.steps.map((step: { type: string }) => step.type),
      ).toEqual(steps.map((step) => step.step_type));
      expect(inspected.steps[0].costUSD).toBe('0.001');
      expect(inspected.evidenceRevision).toBe('current');
      expect(
        inspected.steps
          .filter((step: { type: string }) => step.type === 'generation')
          .map((step: { finishReason: string }) => step.finishReason),
      ).toEqual(['tool_calls', 'tool_calls', 'stop']);
      await db.admin(`/rest/v1/ai_steps?id=eq.${paid[0]!.id}`, 'PATCH', {
        cost_usd: '0.1234567890123456789',
      });
      expect(
        (await (await api(`/api/executions?run=${runId}`)).json()).data.steps[0]
          .costUSD,
      ).toBe('0.1234567890123456789');
      await db.admin(`/rest/v1/ai_steps?id=eq.${paid[0]!.id}`, 'PATCH', {
        cost_usd: '0.001',
      });
      await db.admin(`/rest/v1/ai_steps?id=eq.${paid[0]!.id}`, 'PATCH', {
        request_metadata: {
          endpoint: 'https://openrouter.ai/api/v1/responses',
          headers: { Authorization: 'synthetic-secret-canary' },
          redactedHeaders: [],
        },
      });
      const unsafeMetadata = await (
        await api(`/api/executions?run=${runId}`)
      ).text();
      expect(unsafeMetadata).not.toContain('synthetic-secret-canary');
      expect(
        JSON.parse(unsafeMetadata).data.steps[0].requestMetadata,
      ).toBeNull();
      await db.admin(`/rest/v1/ai_steps?id=eq.${paid[0]!.id}`, 'PATCH', {
        request_metadata: paid[0]!.request_metadata,
      });
      for (let i = 0; i < paid.length; i++) {
        const url = `/api/executions?view=export&run=${runId}&step=${paid[i]!.id}&part=input`;
        const response = await api(url);
        expect(response.status).toBe(200);
        expect(Buffer.from(await response.arrayBuffer())).toEqual(
          transport.requests[i],
        );
        expect((await api(url, undefined, tokenB)).status).toBe(404);
      }
      expect(
        (
          await api(
            `/api/executions?view=payload&run=${runId}&step=${randomUUID()}&part=input`,
          )
        ).status,
      ).toBe(404);
      expect(
        (
          await api(
            `/api/executions?view=payload&run=${runId}&step=${paid[0]!.id}&part=continuation`,
          )
        ).status,
      ).toBe(400);
      const tool = steps.find((step) => step.step_type === 'tool')!;
      const inspectedTool = (
        await (
          await api(
            `/api/executions?view=payload&run=${runId}&step=${tool.id}&part=output`,
          )
        ).json()
      ).data;
      const storedTool = await readPayload(
        a,
        String(tool.output_payload_id),
        'tool_output',
      );
      expect(inspectedTool.state).toBe('available');
      expect(storedTool.state).toBe('available');
      if (storedTool.state === 'available')
        expect(Buffer.from(inspectedTool.base64, 'base64')).toEqual(
          storedTool.bytes,
        );
      expect(
        JSON.parse(Buffer.from(inspectedTool.base64, 'base64').toString()),
      ).toHaveProperty('result');
      expect(transport.requests[2]!.toString()).toContain(
        'synthetic-opaque-continuation',
      );
      const contextRow = (
        await rows('private_payloads', `id=eq.${paid[0]!.context_payload_id}`)
      )[0]!;
      const legacy = { ...manifests[0] };
      delete legacy.captureVersion;
      const contextMetadata = {
        id: String(paid[0]!.context_payload_id),
        user_id: a.userId,
        purpose: 'provider_state' as const,
        expires_at: String(contextRow.expires_at),
      };
      await db.admin(
        `/rest/v1/private_payloads?id=eq.${contextMetadata.id}`,
        'PATCH',
        encryptBytes(
          contextMetadata,
          Buffer.from(JSON.stringify(legacy)),
          readEncryptionKeys(),
        ),
      );
      expect(
        (
          await (
            await api(
              `/api/executions?view=payload&run=${runId}&step=${paid[0]!.id}&part=context`,
            )
          ).json()
        ).data.completeness,
      ).toBe('partial');
      await db.admin(
        `/rest/v1/private_payloads?id=eq.${contextMetadata.id}`,
        'PATCH',
        encryptBytes(
          contextMetadata,
          Buffer.from(JSON.stringify(manifests[0])),
          readEncryptionKeys(),
        ),
      );
      const replay = await api('/api/chat', input);
      expect(replay.headers.get('content-type')).toContain('application/json');
      expect((await replay.json()).data).toMatchObject({
        kind: 'existing',
        run: { id: runId, state: 'completed', costUSD: '0.003' },
      });
      expect(
        (
          await api('/api/chat', {
            ...input,
            message: { ...input.message, text: 'Changed' },
          })
        ).status,
      ).toBe(409);
      const saved = (
        await (await api(`/api/conversations?view=messages&id=${id}`)).json()
      ).data;
      expect(saved.items).toHaveLength(2);
      expect(
        saved.items[1].parts.find(
          (part: { type: string }) => part.type === 'metric_summary',
        ).result.analysis,
      ).toMatchObject({ value: 69, previousValue: 69.7, absoluteChange: -0.7 });
      await api(`/api/conversations?view=messages&id=${id}`);
      expect(transport.requests).toHaveLength(3);
      expect(
        (
          await api(
            `/api/conversations?view=messages&id=${id}`,
            undefined,
            tokenB,
          )
        ).status,
      ).toBe(404);
      const followup = await stream(
        await api('/api/chat', send(id, 'What metric were we discussing?')),
      );
      expect(followup.at(-1)?.type).toBe('run.completed');
      expect(transport.requests[3]!.toString()).toContain(
        'How has my imported weight changed?',
      );
      expect(transport.requests[3]!.toString()).toContain(
        'synthetic-opaque-continuation',
      );
      const message = (
        await rows('messages', `run_id=eq.${runId}&role=eq.assistant`)
      )[0]!;
      const forged = JSON.parse(JSON.stringify(message.content_parts));
      for (const part of forged)
        if (part.type === 'metric_summary') part.evidence.stepId = randomUUID();
      await db.admin(`/rest/v1/messages?id=eq.${message.id}`, 'PATCH', {
        content_parts: forged,
      });
      const unresolved = (
        await (await api(`/api/conversations?view=messages&id=${id}`)).json()
      ).data;
      expect(
        unresolved.items
          .flatMap((m: { parts: unknown[] }) => m.parts)
          .some((part: { type: string }) => part.type === 'metric_summary'),
      ).toBe(false);
      await addMeasurement(a, {
        action: 'add_measurement',
        client_request_id: randomUUID(),
        source: { kind: 'existing', id: p.source_id },
        observation: {
          metric: 'weight',
          value: '68',
          unit: 'kg',
          observed_at: '2026-09-16T08:00:00Z',
          timezone: 'UTC',
          local_date: null,
          granularity: 'instant',
          method: 'user_reported',
          quality_flags: [],
        },
      });
      expect(
        (await (await api(`/api/executions?run=${runId}`)).json()).data
          .evidenceRevision,
      ).toBe('stale');
      await db.admin(
        `/rest/v1/private_payloads?id=eq.${paid[0]!.context_payload_id}`,
        'PATCH',
        {
          created_at: new Date(Date.now() - 3000).toISOString(),
          expires_at: new Date(Date.now() - 1000).toISOString(),
        },
      );
      expect(
        (
          await (
            await api(
              `/api/executions?view=payload&run=${runId}&step=${paid[0]!.id}&part=context`,
            )
          ).json()
        ).data.state,
      ).toBe('expired');
      await db.admin(
        `/rest/v1/private_payloads?id=eq.${paid[0]!.input_payload_id}`,
        'PATCH',
        { nonce: '\\x000000000000000000000000' },
      );
      expect(
        (
          await (
            await api(
              `/api/executions?view=payload&run=${runId}&step=${paid[0]!.id}&part=input`,
            )
          ).json()
        ).data.state,
      ).toBe('corrupt');
      const storedRow = (
        await rows('private_payloads', `id=eq.${tool.output_payload_id}`)
      )[0]!;
      const forgedTool = encryptBytes(
        {
          id: String(tool.output_payload_id),
          user_id: a.userId,
          purpose: 'tool_output',
          expires_at: String(storedRow.expires_at),
        },
        Buffer.from(
          JSON.stringify({
            evidence: {
              version: 1,
              ownerId: b.userId,
              runId,
              stepId: tool.id,
              resultId: randomUUID(),
              dataRevision: 0,
            },
            result: {},
            providerResult: {},
          }),
        ),
        readEncryptionKeys(),
      );
      await db.admin(
        `/rest/v1/private_payloads?id=eq.${tool.output_payload_id}`,
        'PATCH',
        forgedTool,
      );
      expect(
        (
          await (
            await api(
              `/api/executions?view=payload&run=${runId}&step=${tool.id}&part=output`,
            )
          ).json()
        ).data.state,
      ).toBe('corrupt');
      const deletion = {
        action: 'delete',
        id,
        confirm: true,
        client_request_id: randomUUID(),
      };
      expect((await api('/api/conversations', deletion)).status).toBe(200);
      expect(
        await rows('private_payloads', `user_id=eq.${a.userId}`),
      ).toHaveLength(0);
      expect(await rows('messages', `user_id=eq.${a.userId}`)).toHaveLength(0);
      expect(await new ExecutionService(a).summary(runId)).toMatchObject({
        conversationId: null,
        traceState: 'removed',
        costUSD: '0.003',
      });
      expect(
        (
          await (
            await api(
              `/api/executions?view=payload&run=${runId}&step=${paid[0]!.id}&part=input`,
            )
          ).json()
        ).data.state,
      ).toBe('removed');
    });
  });
  it('serializes simultaneous identical HTTP sends and never dispatches for a busy request', async () => {
    let reached!: () => void;
    const started = new Promise<void>((r) => {
      reached = r;
    });
    let release!: () => void;
    const wait = new Promise<void>((r) => {
      release = r;
    });
    const transport = new SyntheticChatTransport('complete', {
      started: reached,
      wait,
    });
    await withApi(syntheticChatDependencies(transport), async (api) => {
      const id = await conversation();
      const input = send(id);
      const first = await api('/api/chat', input);
      await started;
      try {
        expect((await (await api('/api/chat', input)).json()).data.kind).toBe(
          'existing',
        );
        expect(
          (await (await api('/api/chat', send(id))).json()).data.kind,
        ).toBe('busy');
        expect(transport.requests).toHaveLength(1);
      } finally {
        release();
      }
      expect((await stream(first)).at(-1)?.type).toBe('run.completed');
      expect(await rows('messages', `conversation_id=eq.${id}`)).toHaveLength(
        2,
      );
    });
  });
  it.each([
    'truncated',
    'missing_usage',
    'malformed',
    'repeated_call',
  ] as const)(
    'retains honest %s results and unknown cost without replay',
    async (scenario) => {
      const transport = new SyntheticChatTransport(scenario);
      await withApi(syntheticChatDependencies(transport), async (api) => {
        const id = await conversation();
        const events = await stream(await api('/api/chat', send(id)));
        expect(events.at(-1)?.type).toBe(
          scenario === 'missing_usage' ? 'run.completed' : 'run.failed',
        );
        const saved = (
          await (await api(`/api/conversations?view=messages&id=${id}`)).json()
        ).data;
        if (scenario !== 'repeated_call') {
          expect(saved.run.costStatus).toBe('pending');
          expect(Number(saved.run.reservationUSD)).toBeGreaterThan(0);
        }
        if (scenario === 'missing_usage')
          expect(
            (await rows('ai_steps', `run_id=eq.${saved.run.id}`))[0],
          ).toMatchObject({
            finish_reason: 'stop',
            provider_request_id: null,
            effective_model_id: null,
            effective_effort: null,
          });
        if (scenario === 'truncated') {
          expect(saved.items[1].parts).toEqual([
            { type: 'text', text: 'Durable synthetic prefix 🦊' },
          ]);
          expect(saved.items[1].status).toBe('failed');
        }
        const count = transport.requests.length;
        await api(`/api/conversations?view=messages&id=${id}`);
        expect(transport.requests).toHaveLength(count);
      });
    },
  );
  it('honors cancellation from another handler before output and retains a possible charge', async () => {
    let reached!: () => void;
    const started = new Promise<void>((r) => {
      reached = r;
    });
    let release!: () => void;
    const wait = new Promise<void>((r) => {
      release = r;
    });
    const transport = new SyntheticChatTransport('complete', {
      started: reached,
      wait,
    });
    await withApi(syntheticChatDependencies(transport), async (api) => {
      const id = await conversation();
      const response = await api('/api/chat', send(id));
      await started;
      const run = (await rows('ai_runs', `conversation_id=eq.${id}`))[0]!;
      expect(
        (
          await api(
            '/api/chat',
            {
              action: 'cancel',
              run_id: run.id,
              client_request_id: randomUUID(),
            },
            tokenB,
          )
        ).status,
      ).toBe(404);
      const cancellation = {
        action: 'cancel',
        run_id: run.id,
        client_request_id: randomUUID(),
      };
      expect((await api('/api/chat', cancellation)).status).toBe(200);
      expect((await api('/api/chat', cancellation)).status).toBe(200);
      release();
      const events = await stream(response);
      expect(events.at(-1)?.type).toBe('run.cancelled');
      expect(
        await new ExecutionService(a).summary(String(run.id)),
      ).toMatchObject({ state: 'cancelled', costStatus: 'pending' });
      expect(transport.requests).toHaveLength(1);
    });
  });
  it('revoked consent before continuation blocks a second dispatch', async () => {
    const base = new SyntheticChatTransport();
    const transport: RequestTransport = {
      mode: 'mock',
      async *send(body, signal) {
        yield* base.send(body, signal);
        await db.admin(`/rest/v1/profiles?user_id=eq.${a.userId}`, 'PATCH', {
          consent_versions: {},
        });
      },
    };
    await withApi(syntheticChatDependencies(transport), async (api) => {
      const id = await conversation();
      const events = await stream(await api('/api/chat', send(id)));
      expect(events.at(-1)?.type).toBe('run.failed');
      expect(base.requests).toHaveLength(1);
    });
  });
  it('requires auth, rejects credentials/forged tools/foreign context, and keeps production unavailable', async () => {
    await withApi(null, async (api) => {
      const id = await conversation();
      expect((await api('/api/chat', send(id), null)).status).toBe(401);
      expect((await api('/api/chat', send(id))).status).toBe(503);
      expect(
        (await api('/api/chat', send(id, 'api_key=syntheticcredential123')))
          .status,
      ).toBe(400);
      expect(
        (await api('/api/chat', { ...send(id), tool_results: [] })).status,
      ).toBe(400);
      expect((await api('/api/chat', send(id), tokenB)).status).toBe(404);
      expect(await rows('messages', `conversation_id=eq.${id}`)).toHaveLength(
        0,
      );
      const events = await stream(
        await api('/api/chat', {
          ...send(id, 'Can you diagnose my symptoms?'),
          depth: 'advanced',
        }),
      );
      expect(events.at(-1)?.type).toBe('run.completed');
      expect(
        events
          .filter((e) => e.type === 'text.delta')
          .map((e) => e.payload.text)
          .join(''),
      ).toContain('cannot diagnose');
      expect(await rows('ai_steps', `user_id=eq.${a.userId}`)).toHaveLength(0);
      expect(
        await new ExecutionService(a).summary(events[0]!.run_id),
      ).toMatchObject({ requestedDepth: 'advanced', costUSD: '0' });
    });
  });
  it('read tools reject unknown names/arguments/foreign IDs and keep empty goals/data honest', async () => {
    expect(await executeReadTool(a, 'list_goals', {})).toMatchObject({
      items: [],
    });
    expect(await executeReadTool(a, 'list_metrics', {})).toMatchObject({
      items: [],
    });
    await expect(
      executeReadTool(a, 'delete_measurements', {}),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      executeReadTool(a, 'list_metrics', { user_id: b.userId }),
    ).rejects.toThrow();
    await expect(
      executeReadTool(a, 'get_goal_progress', { goal_id: randomUUID() }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      executeReadTool(a, 'get_measurements', {
        metric: 'weight',
        source_id: randomUUID(),
        from: '2026-09-01T00:00:00Z',
        to: '2026-09-15T00:00:00Z',
        timezone: 'UTC',
        limit: 201,
      }),
    ).rejects.toThrow();
  });
  it('interrupted process is reconciled on reload without taking execution ownership', async () => {
    const id = await conversation();
    const agent = new VulpesAgent(a, syntheticChatDependencies());
    const admitted = await agent.admit(ChatSendRequestSchema.parse(send(id)));
    expect(admitted.lease).toBeTruthy();
    if (!admitted.lease) throw new Error('Expected execution authority.');
    await db.admin(
      `/rest/v1/ai_runs?id=eq.${admitted.result.run.id}`,
      'PATCH',
      { lease_expires_at: new Date(Date.now() - 1000).toISOString() },
    );
    const saved = await service().read(
      ConversationQuerySchema.parse({ view: 'messages', id }),
    );
    expect('run' in saved && saved.run).toMatchObject({ state: 'interrupted' });
    expect(
      await rows('ai_steps', `run_id=eq.${admitted.result.run.id}`),
    ).toHaveLength(0);
  });
  it('a failed second message checkpoint preserves only the first durable prefix', async () => {
    const durablePrefix = 'Durable prefix'.padEnd(8192, '.');
    const original = ExecutionService.prototype.checkpointMessage;
    let writes = 0;
    vi.spyOn(
      ExecutionService.prototype,
      'checkpointMessage',
    ).mockImplementation(async function (this: ExecutionService, lease, parts) {
      writes++;
      if (writes === 2) throw new Error('Synthetic storage failure');
      return original.call(this, lease, parts);
    });
    const transport: RequestTransport = {
      mode: 'mock',
      async *send() {
        yield Buffer.from(
          `data: ${JSON.stringify({ type: 'response.output_text.delta', delta: durablePrefix })}\n\n`,
        );
        yield Buffer.from(
          'data: {"type":"response.output_text.delta","delta":" unsaved suffix"}\n\n',
        );
        yield responseFrame([
          assistantOutput(`${durablePrefix} unsaved suffix`),
        ]);
      },
    };
    await withApi(syntheticChatDependencies(transport), async (api) => {
      const id = await conversation();
      const events = await stream(await api('/api/chat', send(id)));
      expect(events.at(-1)?.type).toBe('run.failed');
      expect(
        events
          .filter((e) => e.type === 'text.delta')
          .map((e) => e.payload.text)
          .join(''),
      ).toBe(durablePrefix);
      const saved = (
        await (await api(`/api/conversations?view=messages&id=${id}`)).json()
      ).data;
      expect(saved.items[1].parts).toEqual([
        { type: 'text', text: durablePrefix },
      ]);
      expect(saved.run).toMatchObject({
        traceState: 'incomplete',
        costStatus: 'pending',
      });
      const inspected = (
        await (await api(`/api/executions?run=${saved.run.id}`)).json()
      ).data;
      expect(inspected.run).toMatchObject({
        state: 'failed',
        traceState: 'incomplete',
        costStatus: 'pending',
      });
      expect(inspected.steps[0].status).not.toBe('completed');
    });
  });
  it.each([1, 3])(
    'enforces request and tool ceilings with %i tool calls per response',
    async (count) => {
      let requests = 0;
      const transport: RequestTransport = {
        mode: 'mock',
        async *send() {
          requests++;
          yield responseFrame(
            Array.from({ length: count }, (_, i) => ({
              type: 'function_call',
              id: `item-${requests}-${i}`,
              call_id: `call-${requests}-${i}`,
              name: 'list_metrics',
              arguments: '{}',
            })),
          );
        },
      };
      await withApi(syntheticChatDependencies(transport), async (api) => {
        const id = await conversation();
        const events = await stream(await api('/api/chat', send(id)));
        expect(events.at(-1)?.type).toBe('run.failed');
        expect(requests).toBe(count === 1 ? 4 : 3);
        expect(
          (await rows('ai_steps', `user_id=eq.${a.userId}`)).filter(
            (step) => step.step_type === 'tool',
          ),
        ).toHaveLength(count === 1 ? 3 : 6);
      });
    },
  );
  it('replaces the compatible generation adapter through the same dispatcher without domain changes', async () => {
    const transport: RequestTransport = {
      mode: 'mock',
      async *send() {
        yield Buffer.from('synthetic-replacement');
      },
    };
    const adapter: GenerationAdapter = {
      family: 'openrouter_responses',
      capabilities: { streaming: true, tools: true },
      async *generate(_request, { signal, dispatch }) {
        for await (const chunk of dispatch.send(
          {
            body: Buffer.from('{"replacement":true}'),
            metadata: {
              endpoint: 'https://openrouter.ai/api/v1/responses',
              headers: {},
              redactedHeaders: [],
            },
            adapterVersion: 'synthetic-replacement',
          },
          signal,
        ))
          void chunk;
        yield { type: 'text.delta', text: 'Compatible synthetic adapter' };
        yield {
          type: 'usage',
          usage: normalizeUsage({
            reportedCostUSD: '0.001',
            rawUsage: { synthetic: true },
          }),
        };
        yield { type: 'completed', finishReason: 'stop', continuation: null };
      },
    };
    await withApi(
      { ...syntheticChatDependencies(transport), adapter },
      async (api) => {
        const events = await stream(
          await api('/api/chat', send(await conversation())),
        );
        expect(events.at(-1)?.type).toBe('run.completed');
      },
    );
  });
  it('qualifies ambiguous sources and approved goal progress without treating drafts or snapshots as authority', async () => {
    const today = new Date().toISOString().slice(0, 10);
    let source = '';
    for (let n = 0; n < 14; n++) {
      const instant = new Date(`${today}T12:00:00Z`);
      instant.setUTCDate(instant.getUTCDate() - n);
      const result = await addMeasurement(a, {
        action: 'add_measurement',
        client_request_id: randomUUID(),
        source: source
          ? { kind: 'existing', id: source }
          : {
              kind: 'new',
              label: 'Synthetic approved series',
              origin_app: null,
              device_label: null,
            },
        observation: {
          metric: 'weight',
          value: '69',
          unit: 'kg',
          observed_at: instant.toISOString(),
          timezone: 'UTC',
          local_date: null,
          granularity: 'instant',
          method: 'user_reported',
          quality_flags: [],
        },
      });
      source = result.sourceId;
    }
    const selection = {
      metric: 'weight',
      source_id: source,
      from:
        new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10) +
        'T00:00:00Z',
      to:
        new Date(Date.now() + 86400000).toISOString().slice(0, 10) +
        'T00:00:00Z',
      timezone: 'UTC',
      method: 'user_reported',
      granularity: 'instant',
    };
    const measured = (await executeReadTool(a, 'get_measurements', {
      ...selection,
      limit: 2,
    })) as { items: unknown[]; nextCursor: string | null };
    expect(measured.items).toHaveLength(2);
    expect(measured.nextCursor).toBeTruthy();
    await addMeasurement(a, {
      action: 'add_measurement',
      client_request_id: randomUUID(),
      source: {
        kind: 'new',
        label: 'Synthetic other series',
        origin_app: null,
        device_label: null,
      },
      observation: {
        metric: 'weight',
        value: '80',
        unit: 'kg',
        observed_at: new Date().toISOString(),
        timezone: 'UTC',
        local_date: null,
        granularity: 'instant',
        method: 'user_reported',
        quality_flags: [],
      },
    });
    expect(
      await executeReadTool(a, 'summarize_metric', {
        ...selection,
        source_id: null,
      }),
    ).toMatchObject({ kind: 'clarification_required' });
    const id = randomUUID();
    const proposal = randomUUID();
    const revision = randomUUID();
    const payload = { ...goalDraft, sourceId: source };
    await db.admin('/rest/v1/goals', 'POST', {
      id,
      user_id: a.userId,
      title: 'Synthetic approved goal',
      metric_key: 'weight',
      canonical_unit: 'kg',
      direction: 'decrease_to',
      target_value: 68,
      source_id: source,
    });
    expect(await executeReadTool(a, 'list_goals', {})).toMatchObject({
      items: [],
    });
    await db.admin('/rest/v1/action_proposals', 'POST', {
      id: proposal,
      user_id: a.userId,
      kind: 'goal.create',
      canonical_payload: payload,
      payload_hash: 'a'.repeat(64),
      state: 'approved',
      summary: 'Synthetic approval',
      expires_at: new Date(Date.now() + 3600000).toISOString(),
    });
    await db.admin('/rest/v1/goal_revisions', 'POST', {
      id: revision,
      user_id: a.userId,
      goal_id: id,
      revision_number: 1,
      approved_proposal_id: proposal,
      payload,
    });
    await db.admin(`/rest/v1/goals?id=eq.${id}`, 'PATCH', {
      state: 'active',
      current_revision_id: revision,
    });
    expect(
      await executeReadTool(a, 'get_goal_progress', { goal_id: id }),
    ).toEqual({ kind: 'unavailable', reason: 'unsupported_baseline' });
    await db.admin(`/rest/v1/goals?id=eq.${id}`, 'PATCH', {
      baseline_snapshot: {
        schemaVersion: 1,
        selection,
        value: '70',
        dataRevision: 14,
        algorithmVersion: 'daily_median_mean_7d_v1',
      },
    });
    expect(
      await executeReadTool(a, 'get_goal_progress', { goal_id: id }),
    ).toMatchObject({
      kind: 'progress',
      current: '69',
      result: { kind: 'directional', rawPercent: 100, displayPercent: 100 },
    });
    await db.admin(`/rest/v1/goals?id=eq.${id}`, 'PATCH', {
      review_status: 'needs_review',
    });
    expect(
      await executeReadTool(a, 'get_goal_progress', { goal_id: id }),
    ).toEqual({ kind: 'unavailable', reason: 'needs_review' });
    await expect(
      executeReadTool(b, 'get_goal_progress', { goal_id: id }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
afterEach(async () => {
  try {
    if (db) {
      await db.cleanup();
      await db.admin(`/rest/v1/usage_buckets?id=eq.${app}`, 'DELETE');
    }
  } finally {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  }
});

describe('owned conversations and atomic admission', () => {
  it('keeps the first accepted title even when it equals the default title', async () => {
    const id = await conversation();
    const ledger = new ExecutionService(a, { maxRunCostUSD: '0.25' });
    const first = await ledger.admit(admission(id), {
      id: randomUUID(),
      text: 'New conversation',
    });
    if (!first.lease) throw new Error();
    await ledger.baseline(first.lease, 'Synthetic baseline.');
    const second = await ledger.admit(admission(id), {
      id: randomUUID(),
      text: 'Later question',
    });
    expect((await service().owned(id)).title).toBe('New conversation');
    if (!second.lease) throw new Error();
    await ledger.baseline(second.lease, 'Synthetic baseline.');
    const whitespace = await conversation();
    await ledger.admit(admission(whitespace), {
      id: randomUUID(),
      text: '\t Synthetic \n question \t',
    });
    expect((await service().owned(whitespace)).title).toBe(
      'Synthetic question',
    );
  });
  it('creates, lists, archives, and deletes idempotently with owner-bound cursors', async () => {
    const id = randomUUID();
    const create = {
      action: 'create' as const,
      id,
      client_request_id: randomUUID(),
    };
    expect(await service().mutate(create)).toEqual(
      await service().mutate(create),
    );
    await conversation();
    const page = await service().read(
      ConversationQuerySchema.parse({ view: 'list', page_size: 1 }),
    );
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeTruthy();
    const next = await service().read(
      ConversationQuerySchema.parse({
        view: 'list',
        page_size: 1,
        cursor: page.nextCursor,
      }),
    );
    expect(next.items[0]?.id).not.toBe(page.items[0]?.id);
    await expect(
      new ConversationService(b).read(
        ConversationQuerySchema.parse({
          view: 'list',
          cursor: page.nextCursor,
        }),
      ),
    ).rejects.toMatchObject({ status: 400 });
    await expect(new ConversationService(b).owned(id)).rejects.toMatchObject({
      status: 404,
    });
    const archive = {
      action: 'archive' as const,
      id,
      client_request_id: randomUUID(),
    };
    await service().mutate(archive);
    await service().mutate(archive);
    expect((await service().owned(id)).archived).toBe(true);
    const deletion = {
      action: 'delete' as const,
      id,
      confirm: true as const,
      client_request_id: randomUUID(),
    };
    expect(await service().mutate(deletion)).toEqual(
      await service().mutate(deletion),
    );
    await expect(service().owned(id)).rejects.toMatchObject({ status: 404 });
    await expect(
      service().mutate({ ...create, id: randomUUID() }),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('inserts one authoritative message pair in the winning admission transaction', async () => {
    const id = await conversation();
    const ledger = new ExecutionService(a, { maxRunCostUSD: '0.25' });
    const input = admission(id);
    const message = { id: randomUUID(), text: '  Synthetic   question  ' };
    const result = await Promise.all([
      ledger.admit(input, message),
      ledger.admit(input, message),
    ]);
    expect(result.map((r) => r.result.kind).sort()).toEqual([
      'admitted',
      'existing',
    ]);
    if (result[0]!.result.kind === 'retained')
      throw new Error('Expected a retained run, not an expired receipt.');
    expect(await rows('messages', `conversation_id=eq.${id}`)).toHaveLength(2);
    expect((await service().owned(id)).title).toBe('Synthetic question');
    await expect(
      ledger.admit({ ...input, clientRequestId: randomUUID() }, message),
    ).rejects.toMatchObject({ status: 409 });
    const busy = await ledger.admit(admission(id), {
      id: randomUUID(),
      text: 'Other',
    });
    expect(busy.result.kind).toBe('busy');
    expect(await rows('messages', `conversation_id=eq.${id}`)).toHaveLength(2);
    const deletion = {
      action: 'delete' as const,
      id,
      confirm: true as const,
      client_request_id: randomUUID(),
    };
    await service().mutate(deletion);
    expect(await rows('messages', `conversation_id=eq.${id}`)).toHaveLength(0);
    expect(await ledger.summary(result[0]!.result.run.id)).toMatchObject({
      conversationId: null,
      state: 'cancellation_requested',
      traceState: 'removed',
    });
  });
});

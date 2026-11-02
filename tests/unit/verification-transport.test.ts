import { afterEach, describe, expect, it, vi } from 'vitest';
import { priceFingerprint } from '../../server/ai/live-preflight.js';
import { syntheticPrice } from '../fixtures/executions.js';
import type { AuthContext } from '../../server/auth/session.js';
import {
  createDispatcher,
  type RequestTransport,
} from '../../server/ai/ledger/dispatcher.js';
import type {
  ExecutionService,
  PreparedStep,
} from '../../server/ai/ledger/execution.js';
import { verificationFixtureHash } from '../../server/ai/verification-fixture.js';
import {
  everydayAdapterVersion,
  everydayTemplateVersion,
} from '../../server/config/everyday-versions.js';

const owner = '11111111-1111-4111-8111-111111111111';
const batch = '22222222-2222-4222-8222-222222222222';
const bucket = '33333333-3333-4333-8333-333333333333';
const fixture = verificationFixtureHash;
const month = new Date().toISOString().slice(0, 7) + '-01';
const price = {
  ...syntheticPrice,
  inputBoundTokens: 100,
  outputBoundTokens: 100,
};
const evidence = {
  version: 1,
  provider: 'openrouter',
  model: 'synthetic-model',
  effort: 'low',
  adapterVersion: everydayAdapterVersion,
  templateVersion: everydayTemplateVersion,
  priceId: price.id,
  priceHash: priceFingerprint(price),
  inputBoundTokens: 100,
  outputBoundTokens: 100,
  streaming: true,
  tools: true,
  zdr: true,
  checkedAt: price.checkedAt,
  sourceURL: 'https://example.test/capabilities',
};
afterEach(() => {
  vi.doUnmock('../../server/config/models.js');
  vi.doUnmock('../../server/config/everyday-verification.js');
  vi.doUnmock('../../server/db/administrative.js');
  vi.unstubAllEnvs();
  vi.resetModules();
});
describe('verification transport', () => {
  it('rejects a fabricated verification transport before authorization or sending', async () => {
    const authorize = vi.fn();
    const send = vi.fn(async function* () {
      yield Buffer.from('must not send');
    });
    const dispatcher = createDispatcher(
      { authorize } as unknown as ExecutionService,
      { mode: 'verification', send } satisfies RequestTransport,
    );
    await expect(async () => {
      for await (const chunk of dispatcher.send(
        {} as PreparedStep,
        new AbortController().signal,
      ))
        void chunk;
    }).rejects.toThrow('live_transport_unavailable');
    expect(authorize).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });
  it('uses the fixed endpoint and exact bytes only after local allocation and preflight', async () => {
    const allocation = {
      id: batch,
      user_id: owner,
      account_bucket_id: bucket,
      period_start: month,
      ceiling_text: '0.1',
      data_revision: 1,
      fixture_hash: fixture,
    };
    const profile = {
      account_state: 'active',
      display_name: 'Synthetic verification',
      data_revision: 1,
      consent_versions: {
        openrouter: {
          accepted_version: 'openrouter_zdr_v2',
          accepted_at: '2026-10-26T00:00:00Z',
        },
      },
    };
    const account = {
      id: bucket,
      user_id: owner,
      scope: 'account',
      period_start: month,
    };
    const chain = (data: unknown) => {
      const value = {
        select: () => value,
        eq: () => value,
        single: async () => ({ data, error: null }),
        maybeSingle: async () => ({ data, error: null }),
      };
      return value;
    };
    vi.doMock('../../server/config/models.js', () => ({
      models: {
        everyday: {
          modelId: 'synthetic-model',
          reasoning: { effort: 'low' },
          maxInputTokens: 100,
          maxOutputTokens: 100,
          price,
        },
      },
    }));
    vi.doMock('../../server/config/everyday-verification.js', () => ({
      everydayCapabilityEvidence: evidence,
    }));
    vi.doMock('../../server/db/administrative.js', () => ({
      administrativeClient: () => ({
        from: (name: string) =>
          chain(
            name === 'live_verification_allocations' ? allocation : account,
          ),
        auth: {
          admin: {
            getUserById: async () => ({
              data: { user: { email: `pr03-${owner}@example.test` } },
              error: null,
            }),
          },
        },
      }),
    }));
    const { issueVerificationTransport, isVerificationTransport } =
      await import('../../server/ai/providers/openrouter-verification.js');
    const context = {
      userId: owner,
      db: { from: () => chain(profile) },
    } as unknown as AuthContext;
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:54321');
    const bytes = Buffer.from('{ "synthetic": "🦊" }\n');
    const send = vi.fn(
      async () =>
        new Response('synthetic response', {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream' },
        }),
    );
    const env = {
      VULPES_LIVE_AI_ENABLED: 'true',
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      OPENROUTER_API_KEY: 'synthetic-key',
    };
    await expect(
      issueVerificationTransport(
        context,
        batch,
        '0.1',
        fixture,
        false,
        env,
        send,
      ),
    ).rejects.toThrow('live_opt_in_required');
    const transport = await issueVerificationTransport(
      context,
      batch,
      '0.1',
      fixture,
      true,
      env,
      send,
    );
    expect(isVerificationTransport(transport)).toBe(true);
    expect(isVerificationTransport({ mode: 'verification' })).toBe(false);
    const chunks = [];
    for await (const chunk of transport.send(
      bytes,
      new AbortController().signal,
    ))
      chunks.push(chunk);
    expect(
      Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString(),
    ).toBe('synthetic response');
    expect(send).toHaveBeenCalledOnce();
    const [url, options] = send.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://openrouter.ai/api/v1/responses');
    expect(options.redirect).toBe('error');
    expect(Buffer.from(options.body as Uint8Array)).toEqual(bytes);
    await expect(
      issueVerificationTransport(
        context,
        batch,
        '0.2',
        fixture,
        true,
        env,
        send,
      ),
    ).rejects.toThrow('verification_allocation_mismatch');
    await expect(
      issueVerificationTransport(
        context,
        batch,
        '0.1',
        'b'.repeat(64),
        true,
        env,
        send,
      ),
    ).rejects.toThrow('verification_allocation_mismatch');
    await expect(
      issueVerificationTransport(
        context,
        batch,
        '0.1',
        fixture,
        true,
        { ...env, VITE_SUPABASE_URL: 'https://example.test' },
        send,
      ),
    ).rejects.toThrow('verification_requires_local_database');
    vi.stubEnv('VITE_SUPABASE_URL', 'https://example.test');
    await expect(
      issueVerificationTransport(
        context,
        batch,
        '0.1',
        fixture,
        true,
        env,
        send,
      ),
    ).rejects.toThrow('verification_requires_local_database');
  });
});

import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { localStatus } from './local-database.js';
import { LocalSupabase } from '../tests/helpers/local-supabase.js';
import { syntheticPrice } from '../tests/fixtures/executions.js';
import { verifySession } from '../server/auth/session.js';
import {
  ExecutionService,
  requestHash,
} from '../server/ai/ledger/execution.js';
import { createDispatcher } from '../server/ai/ledger/dispatcher.js';
import { normalizeUsage } from '../server/ai/contracts.js';

const db = new LocalSupabase();
const app = randomUUID();
let appCreated = false;
const server = createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(Buffer.from(chunk));
  received = Buffer.concat(chunks);
  calls++;
  res.end('Synthetic proof response');
});
let received = Buffer.alloc(0);
let calls = 0;
try {
  assert.equal(
    process.argv.length,
    2,
    'This proof accepts no live mode or connection overrides.',
  );
  const status = localStatus();
  Object.assign(process.env, {
    VITE_SUPABASE_URL: status.apiUrl,
    VITE_SUPABASE_PUBLISHABLE_KEY: status.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: status.adminKey,
    VULPES_TRACE_ENCRYPTION_KEY_ID: 'synthetic-proof',
    VULPES_TRACE_ENCRYPTION_KEY_B64: randomBytes(32).toString('base64'),
    VULPES_LIVE_AI_ENABLED: 'false',
  });
  const period = new Date().toISOString().slice(0, 7) + '-01';
  await db.admin('/rest/v1/usage_buckets', 'POST', {
    id: app,
    scope: 'app',
    period_start: period,
    allocated_ceiling_usd: '0.03',
  });
  appCreated = true;
  const actors = [];
  for (let n = 0; n < 2; n++) {
    const user = await db.createUser();
    const conversation = randomUUID();
    await db.admin('/rest/v1/profiles', 'POST', {
      user_id: user.id,
      consent_versions: {
        openrouter: {
          accepted_version: 'openrouter_zdr_v2',
          accepted_at: new Date().toISOString(),
        },
      },
    });
    await db.admin('/rest/v1/conversations', 'POST', {
      user_id: user.id,
      id: conversation,
      title: 'Synthetic execution proof',
    });
    await db.admin('/rest/v1/usage_buckets', 'POST', {
      user_id: user.id,
      scope: 'account',
      period_start: period,
      allocated_ceiling_usd: '1',
    });
    const context = await verifySession({
      headers: { authorization: `Bearer ${user.token}` },
    });
    const ledger = new ExecutionService(context, { maxRunCostUSD: '0.25' });
    const request = {
      conversationId: conversation,
      clientRequestId: randomUUID(),
      requestHash: requestHash({ synthetic: true }),
      depth: 'everyday' as const,
      route: {
        role: 'everyday' as const,
        provider: 'openrouter' as const,
        model: 'openai/gpt-6-luna',
        effort: 'low',
      },
      consentVersion: 'openrouter_zdr_v2',
    };
    const admitted = await ledger.admit(request);
    assert(admitted.lease);
    assert.equal((await ledger.admit(request)).result.kind, 'existing');
    actors.push({ context, ledger, lease: admitted.lease });
  }
  const body = Buffer.from('{"synthetic":"proof 🦊"}\n');
  const prepared = await Promise.allSettled(
    actors.map((actor) =>
      actor.ledger.prepare(actor.lease, {
        type: 'generation',
        body,
        provider: 'openrouter',
        model: 'openai/gpt-6-luna',
        price: syntheticPrice,
        adapterVersion: 'synthetic-proof-v1',
        metadata: {
          endpoint: 'https://openrouter.ai/api/v1/responses',
          headers: { 'content-type': 'application/json' },
          redactedHeaders: ['authorization'],
        },
      }),
    ),
  );
  assert.equal(
    prepared.filter((result) => result.status === 'fulfilled').length,
    1,
  );
  assert.equal(
    prepared.filter((result) => result.status === 'rejected').length,
    1,
  );
  const index = prepared.findIndex((result) => result.status === 'fulfilled');
  const result = prepared[index]!;
  assert(result.status === 'fulfilled');
  const step = result.value;
  const actor = actors[index]!;
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert(address && typeof address !== 'string');
  const dispatcher = createDispatcher(actor.ledger, {
    mode: 'mock',
    async *send(bytes, signal) {
      const response = await fetch(`http://127.0.0.1:${address.port}`, {
        method: 'POST',
        body: Buffer.from(bytes),
        signal,
        redirect: 'error',
      });
      for await (const chunk of response.body!) yield chunk;
    },
  });
  for await (const chunk of dispatcher.send(step, new AbortController().signal))
    assert(chunk.length > 0);
  assert(received.equals(body));
  assert.equal(calls, 1);
  await actor.ledger.cancel(actor.lease.runId);
  const held = await actor.ledger.settle(step, null, 'cancelled');
  await actor.ledger.finish(actor.lease, 'cancelled');
  assert.equal(held.reservationUSD, '0.022');
  await db.admin(`/rest/v1/usage_reservations?step_id=eq.${step.id}`, 'PATCH', {
    uncertain_since: new Date(Date.now() - 25 * 3600_000).toISOString(),
  });
  const conservative = await actor.ledger.summary(actor.lease.runId);
  assert.equal(conservative.costUSD, '0.022');
  const corrected = await actor.ledger.settle(
    step,
    normalizeUsage({ reportedCostUSD: '0.004', rawUsage: { synthetic: true } }),
    'cancelled',
    2,
  );
  assert.equal(corrected.costUSD, '0.004');
  console.info(
    JSON.stringify(
      {
        scope: 'local_synthetic',
        admitted: 2,
        idempotentReplay: 'existing',
        prepared: 1,
        budgetDenied: 1,
        transportRequests: calls,
        capturedBytesEqual: true,
        bodyBytes: body.length,
        heldUSD: held.reservationUSD,
        conservativeUSD: conservative.costUSD,
        correctedUSD: corrected.costUSD,
        terminalState: corrected.state,
        actualProviderRequests: 0,
        actualSpendUSD: '0',
      },
      null,
      2,
    ),
  );
} catch {
  console.error(
    'Execution proof failed. Inspect the guarded local synthetic test stack.',
  );
  process.exitCode = 1;
} finally {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await db.cleanup();
  if (appCreated)
    await db.admin(`/rest/v1/usage_buckets?id=eq.${app}`, 'DELETE');
}

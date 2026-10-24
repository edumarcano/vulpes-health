import { createServer } from 'node:http';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import status from '../../api/status.js';
import { ErrorEnvelopeSchema, LivenessResponseSchema } from '../../shared/api.js';
import { readServerEnvironment } from '../../server/config/environment.js';
import { securityHeaders } from '../../server/http/security.js';

describe('fail-closed configuration', () => {
  it.each([undefined, 'false', 'true'])('never enables inference for %s', (value) => {
    const environment = value === undefined ? {} : { VULPES_LIVE_AI_ENABLED: value };
    expect(readServerEnvironment(environment)).toEqual({
      liveAiRequested: value === 'true', inference: { state: 'unavailable', reason: 'not_implemented' },
    });
  });
  it.each(['', 'TRUE', '1', 'false '])('rejects malformed switch %j without echoing it', (value) => {
    expect(() => readServerEnvironment({ VULPES_LIVE_AI_ENABLED: value })).toThrow('must be true or false');
  });
});

describe('real Node HTTP entry point', () => {
  const server = createServer(status);
  let origin: string;
  beforeAll(async () => {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing test listener');
    origin = `http://127.0.0.1:${address.port}`;
  });
  afterAll(async () => { server.closeAllConnections(); await new Promise<void>((resolve) => server.close(() => resolve())); });

  it('returns only liveness even with a bearer token and live flag requested', async () => {
    vi.stubEnv('VULPES_LIVE_AI_ENABLED', 'true');
    try {
      const response = await fetch(`${origin}/api/status`, { headers: { Authorization: 'Bearer synthetic-token' } });
      expect(response.status).toBe(200);
      expect(response.headers.get('cache-control')).toBe('no-store');
      expect(response.headers.get('content-type')).toContain('application/json');
      expect(LivenessResponseSchema.parse(await response.json())).toEqual({ data: { status: 'ok' }, request_id: expect.any(String) });
    } finally { vi.unstubAllEnvs(); }
  });

  it.each(['/api', '/api/unknown', '/api/chat', '/api/status?__vulpes_unmatched=1'])('keeps absent %s JSON', async (route) => {
    for (const method of ['GET', 'POST']) {
      const response = await fetch(origin + route, { method });
      expect(response.status).toBe(404);
      expect(ErrorEnvelopeSchema.parse(await response.json())).toMatchObject({ error: { code: 'not_found', retryable: false } });
    }
  });

  it('rejects unsupported status methods', async () => {
    const response = await fetch(`${origin}/api/status`, { method: 'POST' });
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe('GET');
    expect(await response.json()).toMatchObject({ error: { code: 'method_not_allowed' } });
  });

  it('contains unexpected errors without disclosing configuration', async () => {
    vi.stubEnv('VULPES_LIVE_AI_ENABLED', 'synthetic-private-value');
    try {
      const response = await fetch(`${origin}/api/status`);
      expect(response.status).toBe(500);
      const body = await response.text();
      expect(JSON.parse(body)).toMatchObject({ error: { code: 'internal_error', retryable: false } });
      expect(body).not.toContain('synthetic-private-value');
      expect(body).not.toContain('VULPES');
    } finally { vi.unstubAllEnvs(); }
  });
});

it('keeps hosting security headers aligned with the tested preview', () => {
  const config = JSON.parse(readFileSync('vercel.json', 'utf8')) as {
    headers: Array<{ source: string; headers: Array<{ key: string; value: string }> }>;
  };
  const headers = config.headers.find((entry) => entry.source === '/:path*')?.headers ?? [];
  expect(Object.fromEntries(headers.map(({ key, value }) => [key, value]))).toEqual(securityHeaders);
});

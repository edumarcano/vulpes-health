import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { expect, it } from 'vitest';
import { localRouter } from '../../server/http/router.js';
import {
  renderHostingConfig,
  type HostingTarget,
} from '../../scripts/hosting.js';
import { probeHosting } from '../../scripts/probe-hosting.js';

it('checks generated routing/headers against real unauthenticated HTTP handlers without hosted services', async () => {
  const target: HostingTarget = {
    version: 1,
    purpose: 'synthetic-only',
    supabaseProjectRef: 'abcdefghijklmnopqrst',
    recoveryProjectRef: 'tsrqponmlkjihgfedcba',
    databaseRegion: 'us-east-1',
    vercelProjectId: 'prj_SyntheticOnly',
    appOrigin: 'https://vulpes-synthetic.vercel.app',
  };
  const config = renderHostingConfig(
    JSON.parse(readFileSync('vercel.json', 'utf8')),
    target,
  );
  let requests = 0,
    credentialsReceived = false;
  const server = createServer((request, response) => {
    requests++;
    credentialsReceived ||= Boolean(
      request.headers.authorization || request.headers.cookie,
    );
    for (const header of config.headers.find((h) => h.source === '/:path*')!
      .headers)
      response.setHeader(header.key, header.value);
    const path = new URL(request.url!, 'http://localhost').pathname;
    if (path.startsWith('/api/')) {
      const rewrite = config.rewrites.find((entry) => entry.source === path);
      request.url = rewrite?.destination ?? '/api/status?__vulpes_unmatched=1';
      localRouter(request, response);
    } else {
      response.setHeader('Content-Type', 'text/html');
      response.end('<!doctype html>');
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing local listener.');
    const network: typeof fetch = (input, init) =>
      fetch(
        'http://127.0.0.1:' + address.port + new URL(String(input)).pathname,
        init,
      );
    const report = await probeHosting(target, true, network);
    expect(report).toMatchObject({
      status: 'passed',
      requests: 14,
      authenticatedIsolation: 'not_run',
      recovery: 'not_run',
    });
    expect(requests).toBe(14);
    expect(credentialsReceived).toBe(false);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

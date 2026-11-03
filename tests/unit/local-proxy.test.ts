import { once } from 'node:events';
import { createServer as createHttpServer } from 'node:http';
import { createServer } from 'vite';
import { expect, it } from 'vitest';
import { apiProxy, localLogger } from '../../scripts/local-proxy.js';

it('returns a safe JSON error when the real Vite proxy cannot connect', async () => {
  const unavailable = createHttpServer();
  unavailable.listen(0, '127.0.0.1');
  await once(unavailable, 'listening');
  const address = unavailable.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing test listener');
  await new Promise<void>((resolve) => unavailable.close(() => resolve()));
  const vite = await createServer({
    configFile: false,
    customLogger: localLogger,
    server: {
      host: '127.0.0.1',
      port: 0,
      hmr: false,
      proxy: {
        '/api': { ...apiProxy, target: `http://127.0.0.1:${address.port}` },
      },
    },
  });
  try {
    await vite.listen();
    const listening = vite.httpServer?.address();
    if (!listening || typeof listening === 'string')
      throw new Error('Missing Vite listener');
    const response = await fetch(
      `http://127.0.0.1:${listening.port}/api/status`,
    );
    expect(response.status).toBe(503);
    expect(response.headers.get('content-type')).toContain('application/json');
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({
      error: { code: 'api_unavailable', retryable: false },
    });
  } finally {
    await vite.close();
  }
});

import { createServer } from 'node:http';
import { once } from 'node:events';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { localRouter } from '../../server/http/router';
const server = createServer(localRouter);
let origin: string;
beforeAll(async () => {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Missing loopback address');
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.close();
  await once(server, 'close');
});
it('uncontrolled share POST receives no-store fallback without echoing private body or requiring auth', async () => {
  const response = await fetch(origin + '/api/share-target', {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=synthetic' },
    body: 'synthetic-private-body-canary',
  });
  expect(response.status).toBe(503);
  expect(response.headers.get('Cache-Control')).toBe('no-store');
  const body = await response.text();
  expect(body).toContain('No file was imported');
  expect(body).not.toContain('synthetic-private-body-canary');
  expect((await fetch(origin + '/api/share-target')).status).toBe(405);
});

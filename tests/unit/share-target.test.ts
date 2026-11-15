import { expect, it, vi } from 'vitest';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { shareTargetFallback } from '../../server/http/share-target';
import { receiveShareRequest } from '../../src/pwa/receive-share';
import { SHARE_ENVELOPE_LIMIT } from '../../shared/import-handoff';

it('fallback rejects without reading or echoing the incoming body', () => {
  const read = vi.fn(() => {
    throw new Error('Body was read');
  });
  const request = {
    method: 'POST',
    [Symbol.asyncIterator]: read,
    on: read,
  } as unknown as IncomingMessage;
  const response = { setHeader: vi.fn(), end: vi.fn(), statusCode: 0 };
  shareTargetFallback(request, response as unknown as ServerResponse);
  expect(response.statusCode).toBe(503);
  expect(read).not.toHaveBeenCalled();
  expect(response.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
  expect(response.end.mock.calls[0]?.[0]).toContain('No file was imported');
});
it('bounds actual multipart bytes even without a declared length', async () => {
  const request = new Request('http://localhost/api/share-target', {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/form-data; boundary=synthetic' },
    body: new Uint8Array(SHARE_ENVELOPE_LIMIT + 1),
  });
  expect((await receiveShareRequest(request)).status).toBe(413);
});

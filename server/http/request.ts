import type { IncomingMessage } from 'node:http';
import { API_JSON_LIMIT_BYTES } from '../../shared/api.js';
import { HttpFailure } from './failure.js';

export function checkOrigin(request: IncomingMessage): void {
  const origin = request.headers.origin;
  if (origin && origin !== (process.env.VULPES_APP_ORIGIN ?? 'http://127.0.0.1:5173')) throw new HttpFailure(403, 'origin_denied', 'This origin is not permitted.');
}
export async function readJson(request: IncomingMessage): Promise<unknown> {
  if (request.headers['content-type']?.split(';')[0]?.trim().toLowerCase() !== 'application/json') throw new HttpFailure(400, 'invalid_input', 'Send a JSON request.');
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk as string);
    length += bytes.length;
    if (length > API_JSON_LIMIT_BYTES) throw new HttpFailure(413, 'request_too_large', 'The request is too large.');
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new HttpFailure(400, 'invalid_input', 'Send valid JSON.'); }
}

import type { IncomingMessage, ServerResponse } from 'node:http';
import { handleSettings } from '../server/http/settings.js';
import { handleAccount } from '../server/http/account.js';
export default function settings(
  request: IncomingMessage,
  response: ServerResponse,
) {
  const url = new URL(request.url ?? '/', 'http://localhost');
  return url.pathname === '/api/account' ||
    url.searchParams.get('__vulpes_account') === '1'
    ? handleAccount(request, response)
    : handleSettings(request, response);
}

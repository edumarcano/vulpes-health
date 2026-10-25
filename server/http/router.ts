import type { IncomingMessage, ServerResponse } from 'node:http';
import status from '../../api/status.js';
import settings from '../../api/settings.js';
import data from '../../api/data.js';
import { sendError } from './responses.js';

export function localRouter(request: IncomingMessage, response: ServerResponse): void {
  try {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    void (path === '/api/data' ? data(request, response) : path === '/api/settings' ? settings(request, response) : status(request, response));
  } catch { sendError(response,400,'invalid_input','The request target is invalid.'); }
}

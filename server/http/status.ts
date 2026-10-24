import type { IncomingMessage, ServerResponse } from 'node:http';
import { readServerEnvironment } from '../config/environment.js';
import { sendError, sendJson } from './responses.js';

export function handleStatus(request: IncomingMessage, response: ServerResponse): void {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname !== '/api/status' || url.searchParams.has('__vulpes_unmatched')) {
      sendError(response, 404, 'not_found', 'API route not found.');
      return;
    }
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      sendError(response, 405, 'method_not_allowed', 'Use GET for this endpoint.');
      return;
    }
    readServerEnvironment(process.env);
    sendJson(response, 200, { data: { status: 'ok' } });
  } catch {
    sendError(response, 500, 'internal_error', 'The request could not be completed.');
  }
}

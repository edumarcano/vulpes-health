import type { IncomingMessage, ServerResponse } from 'node:http';
import { readServerEnvironment } from '../config/environment.js';
import { sendError, sendJson } from './responses.js';
import { verifySession } from '../auth/session.js';
import { respondFailure } from './failure.js';

export async function handleStatus(request: IncomingMessage, response: ServerResponse): Promise<void> {
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
    if (request.headers.authorization !== undefined) {
      await verifySession(request);
      sendJson(response, 200, { data: { status: 'ok', features: { settings: true, healthWorkflows: true, inference: false }, roles: { everyday: 'unavailable', intermediate: 'unavailable', advanced: 'unavailable', decision: 'disabled' } } });
      return;
    }
    sendJson(response, 200, { data: { status: 'ok' } });
  } catch (error) { respondFailure(response, error); }
}

import { getRoleAvailability } from '../config/models.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { readServerEnvironment } from '../config/environment.js';
import { sendError, sendJson } from './responses.js';
import { verifySession } from '../auth/session.js';
import { respondFailure } from './failure.js';

export async function handleStatus(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (
      url.pathname !== '/api/status' ||
      url.searchParams.has('__vulpes_unmatched')
    ) {
      sendError(response, 404, 'not_found', 'API route not found.');
      return;
    }
    if (request.method !== 'GET') {
      response.setHeader('Allow', 'GET');
      sendError(
        response,
        405,
        'method_not_allowed',
        'Use GET for this endpoint.',
      );
      return;
    }
    const environment = readServerEnvironment(process.env);
    if (request.headers.authorization !== undefined) {
      await verifySession(request);
      const everyday = getRoleAvailability(
        'everyday',
        environment.liveAiRequested,
      );
      sendJson(response, 200, {
        data: {
          status: 'ok',
          features: {
            settings: true,
            healthWorkflows: true,
            inference: everyday.state === 'available',
          },
          roles: {
            everyday: everyday.state,
            intermediate: 'unavailable',
            advanced: 'unavailable',
            decision: 'disabled',
          },
          roleDetails: Object.fromEntries(
            (['everyday', 'intermediate', 'advanced', 'decision'] as const).map(
              (role) => [
                role,
                getRoleAvailability(role, environment.liveAiRequested),
              ],
            ),
          ),
        },
      });
      return;
    }
    sendJson(response, 200, { data: { status: 'ok' } });
  } catch (error) {
    respondFailure(response, error);
  }
}

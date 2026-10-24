import type { IncomingMessage, ServerResponse } from 'node:http';
import { SettingsPatchSchema } from '../../shared/auth.js';
import { verifySession } from '../auth/session.js';
import { getSettings, updateSettings } from '../services/settings.js';
import { HttpFailure, respondFailure } from './failure.js';
import { checkOrigin, readJson } from './request.js';
import { sendError, sendJson } from './responses.js';

export async function handleSettings(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    checkOrigin(request);
    const context = await verifySession(request);
    if (request.method === 'GET') { sendJson(response, 200, { data: await getSettings(context) }); return; }
    if (request.method === 'PATCH') {
      const parsed = SettingsPatchSchema.safeParse(await readJson(request));
      if (!parsed.success) throw new HttpFailure(400, 'invalid_input', 'Choose valid settings.');
      sendJson(response, 200, { data: await updateSettings(context, parsed.data) }); return;
    }
    response.setHeader('Allow', 'GET, PATCH');
    sendError(response, 405, 'method_not_allowed', 'Use GET or PATCH for this endpoint.');
  } catch (error) { respondFailure(response, error); }
}

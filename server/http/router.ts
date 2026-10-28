import goals from '../../api/goals.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import status from '../../api/status.js';
import settings from '../../api/settings.js';
import data from '../../api/data.js';
import chat from '../../api/chat.js';
import conversations from '../../api/conversations.js';
import executions from '../../api/executions.js';
import { sendError } from './responses.js';

export function localRouter(request: IncomingMessage, response: ServerResponse): void {
  try {
    const path = new URL(request.url ?? '/', 'http://localhost').pathname;
    void (path === '/api/goals' || path === '/api/approvals' ? goals(request,response) : path === '/api/chat' ? chat(request,response) : path === '/api/conversations' ? conversations(request,response) : path === '/api/executions' ? executions(request,response) : path === '/api/data' ? data(request, response) : path === '/api/settings' ? settings(request, response) : status(request, response));
  } catch { sendError(response,400,'invalid_input','The request target is invalid.'); }
}

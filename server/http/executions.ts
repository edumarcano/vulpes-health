import type { IncomingMessage, ServerResponse } from 'node:http';
import { InspectionQuerySchema } from '../../shared/inspection.js';
import { verifySession } from '../auth/session.js';
import { InspectionService } from '../services/inspection.js';
import { checkOrigin } from './request.js';
import { HttpFailure, respondFailure } from './failure.js';
import { sendError, sendJson } from './responses.js';

export async function handleExecutions(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    checkOrigin(request);
    const context = await verifySession(request);
    if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); sendError(response, 405, 'method_not_allowed', 'Use GET for this endpoint.'); return; }
    const params = new URL(request.url ?? '/', 'http://localhost').searchParams;
    if ([...params.keys()].some(key => params.getAll(key).length !== 1)) throw new HttpFailure(400, 'invalid_input', 'Use one value per filter.');
    const query = InspectionQuerySchema.safeParse({ view: 'overview', ...Object.fromEntries(params) });
    if (!query.success) throw new HttpFailure(400, 'invalid_input', 'Choose a valid execution and evidence type.');
    const service = new InspectionService(context);
    if (query.data.view === 'overview') { sendJson(response, 200, { data: await service.overview(query.data.run) }); return; }
    const evidence = await service.evidence(query.data);
    if (evidence.state !== 'available') { sendJson(response, 200, { data: evidence }); return; }
    if (query.data.view === 'payload') {
      sendJson(response, 200, { data: { state: 'available', base64: evidence.bytes.toString('base64'), expiresAt: evidence.expiresAt, ...(evidence.completeness ? {completeness:evidence.completeness} : {}) } }); return;
    }
    response.statusCode = 200;
    response.setHeader('Content-Type', 'application/octet-stream');
    response.setHeader('Content-Disposition', `attachment; filename="vulpes-${query.data.part}-${query.data.step}.bin"`);
    response.setHeader('Cache-Control', 'no-store');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    if(evidence.completeness)response.setHeader('X-Vulpes-Evidence-Completeness',evidence.completeness);
    response.end(evidence.bytes);
  } catch (error) { respondFailure(response, error); }
}

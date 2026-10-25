import type { IncomingMessage, ServerResponse } from 'node:http';
import { AddMeasurementSchema, DataQuerySchema } from '../../shared/data.js';
import { verifySession } from '../auth/session.js';
import { addMeasurement, readData } from '../services/measurements.js';
import { HttpFailure, respondFailure } from './failure.js';
import { checkOrigin, readJson } from './request.js';
import { sendError, sendJson } from './responses.js';

export async function handleData(request: IncomingMessage, response: ServerResponse): Promise<void> {
  try {
    checkOrigin(request); const context = await verifySession(request);
    if (request.method === 'GET') {
      const params = new URL(request.url ?? '/', 'http://localhost').searchParams;
      if ([...params.keys()].some((key) => params.getAll(key).length !== 1)) throw new HttpFailure(400,'invalid_input','Use one value per filter.');
      const input: Record<string,unknown> = Object.fromEntries(params);
      for (const key of ['page_size','data_revision']) if (key in input) input[key] = /^\d+$/.test(String(input[key])) ? Number(input[key]) : NaN;
      const query = DataQuerySchema.safeParse(input);
      if (!query.success) throw new HttpFailure(400,'invalid_input','Choose valid data filters.');
      sendJson(response,200,{ data:await readData(context,query.data) }); return;
    }
    if (request.method === 'POST') {
      const input = await readJson(request);
      if (input && typeof input === 'object' && 'action' in input && ['preview_csv','commit_import','correct_measurement','delete_measurement'].includes(String(input.action))) throw new HttpFailure(501,'not_implemented','This operation is not available yet.');
      const parsed = AddMeasurementSchema.safeParse(input);
      if (!parsed.success) throw new HttpFailure(400,'invalid_input','Choose valid measurement fields.');
      sendJson(response,200,{ data:await addMeasurement(context,parsed.data) }); return;
    }
    response.setHeader('Allow','GET, POST'); sendError(response,405,'method_not_allowed','Use GET or POST for this endpoint.');
  } catch (error) { respondFailure(response,error); }
}

import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import {
  AddMeasurementSchema,
  DataQuerySchema,
  MeasurementMutationSchema,
} from '../../shared/data.js';
import { ImportCommitRequestSchema } from '../../shared/api.js';
import { PreviewCsvSchema } from '../../shared/imports.js';
import { commitImport, previewCsv } from '../services/imports.js';
import { verifySession } from '../auth/session.js';
import {
  addMeasurement,
  readData,
  mutateMeasurement,
} from '../services/measurements.js';
import { exportMeasurements } from '../services/export.js';
import { cleanupExpiredData } from '../security/private-payloads.js';
import { HttpFailure, respondFailure } from './failure.js';
import { checkOrigin, readJson } from './request.js';
import { sendError, sendJson } from './responses.js';

export async function handleData(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    checkOrigin(request);
    const context = await verifySession(request);
    // Expiry is independently enforced on every read/commit. Cleanup availability
    // must not make an otherwise valid Data request depend on the service key.
    await cleanupExpiredData(context.userId).catch(() => undefined);
    if (request.method === 'GET') {
      const params = new URL(request.url ?? '/', 'http://localhost')
        .searchParams;
      if ([...params.keys()].some((key) => params.getAll(key).length !== 1))
        throw new HttpFailure(
          400,
          'invalid_input',
          'Use one value per filter.',
        );
      const input: Record<string, unknown> = Object.fromEntries(params);
      for (const key of ['page_size', 'data_revision'])
        if (key in input)
          input[key] = /^\d+$/.test(String(input[key]))
            ? Number(input[key])
            : NaN;
      const query = DataQuerySchema.safeParse(input);
      if (!query.success)
        throw new HttpFailure(
          400,
          'invalid_input',
          'Choose valid data filters.',
        );
      if (query.data.view === 'export') {
        const controller = new AbortController();
        const abort = () => {
          if (!response.writableFinished) controller.abort();
        };
        response.once('close', abort);
        try {
          const result = await exportMeasurements(
            context,
            query.data,
            controller.signal,
          );
          try {
            controller.signal.throwIfAborted();
            response.statusCode = 200;
            response.setHeader('Content-Type', 'text/csv; charset=utf-8');
            response.setHeader('Cache-Control', 'no-store');
            response.setHeader('X-Content-Type-Options', 'nosniff');
            response.setHeader(
              'Content-Disposition',
              'attachment; filename="vulpes-measurements-v1.csv"',
            );
            response.setHeader('X-Data-Revision', String(result.revision));
            const stream = result.open();
            await pipeline(stream.ciphertext, stream.decipher, response, {
              signal: controller.signal,
            });
          } finally {
            await result.cleanup();
          }
        } finally {
          response.off('close', abort);
        }
        return;
      }
      sendJson(response, 200, { data: await readData(context, query.data) });
      return;
    }
    if (request.method === 'POST') {
      const input = await readJson(request);
      if (input && typeof input === 'object' && 'action' in input) {
        if (
          input.action === 'preview_csv' ||
          input.action === 'commit_import'
        ) {
          const parsed = (
            input.action === 'preview_csv'
              ? PreviewCsvSchema
              : ImportCommitRequestSchema
          ).safeParse(input);
          if (!parsed.success)
            throw new HttpFailure(
              400,
              'invalid_input',
              'Check the import fields and mapping.',
            );
          sendJson(response, 200, {
            data:
              parsed.data.action === 'preview_csv'
                ? await previewCsv(context, parsed.data)
                : await commitImport(context, parsed.data),
          });
          return;
        }
        if (
          ['correct_measurement', 'delete_measurement'].includes(
            String(input.action),
          )
        ) {
          const parsed = MeasurementMutationSchema.safeParse(input);
          if (!parsed.success)
            throw new HttpFailure(
              400,
              'invalid_input',
              'Check the reading, expected version and correction fields.',
            );
          sendJson(response, 200, {
            data: await mutateMeasurement(context, parsed.data),
          });
          return;
        }
      }
      const parsed = AddMeasurementSchema.safeParse(input);
      if (!parsed.success)
        throw new HttpFailure(
          400,
          'invalid_input',
          'Choose valid measurement fields.',
        );
      sendJson(response, 200, {
        data: await addMeasurement(context, parsed.data),
      });
      return;
    }
    response.setHeader('Allow', 'GET, POST');
    sendError(
      response,
      405,
      'method_not_allowed',
      'Use GET or POST for this endpoint.',
    );
  } catch (error) {
    if (response.headersSent || response.destroyed) response.destroy();
    else respondFailure(response, error);
  }
}

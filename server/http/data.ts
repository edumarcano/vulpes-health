import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import {
  AddMeasurementSchema,
  DataQuerySchema,
  MeasurementMutationSchema,
} from '../../shared/data.js';
import { ImportCommitRequestSchema } from '../../shared/api.js';
import {
  DATA_CONTRACT_VERSION,
  PreviewCsvWireSchema,
  ReviewImportSchema,
  DiscardImportSchema,
  ImportReadSchema,
} from '../../shared/imports.js';
import {
  EventReadSchema,
  EventMutationSchema,
  SourceDefaultsMutationSchema,
} from '../../shared/events.js';
import { z } from 'zod';
import {
  AnalysisReadRequestSchema,
  InventoryQuerySchema,
} from '../../shared/analysis.js';
import { readAnalysis, readMetricInventory } from '../services/analysis.js';
import { ReferenceQuerySchema } from '../../shared/references.js';
import { readMetricReference } from '../services/references.js';
import {
  readEvents,
  mutateEvent,
  updateSourceDefaults,
} from '../services/events.js';
import {
  commitImport,
  previewCsv,
  reviewImport,
  discardImport,
  readImport,
} from '../services/imports.js';
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
    let postInput: unknown;
    if (request.method === 'POST') {
      postInput = await readJson(request);
      if (
        postInput &&
        typeof postInput === 'object' &&
        'action' in postInput &&
        (postInput.action === 'analyze' ||
          postInput.action === 'resolve_analysis')
      ) {
        const parsed = AnalysisReadRequestSchema.safeParse(postInput);
        if (!parsed.success)
          throw new HttpFailure(
            400,
            'invalid_input',
            'Choose valid analysis operations and selections.',
          );
        sendJson(response, 200, {
          data: await readAnalysis(context, parsed.data),
        });
        return;
      }
      if (request.headers['x-vulpes-data-contract'] !== DATA_CONTRACT_VERSION)
        throw new HttpFailure(
          409,
          'client_upgrade_required',
          'Reload Vulpes before changing data or imports.',
        );
      await cleanupExpiredData(context.userId).catch(() => undefined);
    }
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
      for (const key of ['page_size', 'data_revision', 'offset', 'limit'])
        if (key in input)
          input[key] = /^\d+$/.test(String(input[key]))
            ? Number(input[key])
            : NaN;
      if (input.view === 'reference') {
        const parsed = ReferenceQuerySchema.safeParse(input);
        if (!parsed.success)
          throw new HttpFailure(
            400,
            'invalid_input',
            'Choose valid reference filters.',
          );
        sendJson(response, 200, {
          data: await readMetricReference(context, parsed.data),
        });
        return;
      }
      if (input.view === 'inventory') {
        const parsed = InventoryQuerySchema.safeParse(input);
        if (!parsed.success)
          throw new HttpFailure(
            400,
            'invalid_input',
            'Choose valid inventory filters.',
          );
        sendJson(response, 200, {
          data: await readMetricInventory(context, parsed.data),
        });
        return;
      }
      if (input.view === 'import_status' || input.view === 'import_items') {
        const parsed = ImportReadSchema.safeParse(input);
        if (!parsed.success)
          throw new HttpFailure(
            400,
            'invalid_input',
            'Choose valid import status/detail filters.',
          );
        sendJson(response, 200, {
          data: await readImport(context, parsed.data),
        });
        return;
      }
      if (input.view === 'event' || input.view === 'events') {
        const parsed = EventReadSchema.safeParse(input);
        if (!parsed.success)
          throw new HttpFailure(
            400,
            'invalid_input',
            'Choose valid weigh-in filters.',
          );
        sendJson(response, 200, {
          data: await readEvents(context, parsed.data),
        });
        return;
      }
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
              'attachment; filename="vulpes-measurements-v2.csv"',
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
      const input = postInput;
      const parsed = z
        .union([
          PreviewCsvWireSchema,
          ImportCommitRequestSchema,
          ReviewImportSchema,
          DiscardImportSchema,
          MeasurementMutationSchema,
          AddMeasurementSchema,
          EventMutationSchema,
          SourceDefaultsMutationSchema,
        ])
        .safeParse(input);
      if (!parsed.success)
        throw new HttpFailure(
          400,
          'invalid_input',
          'Check the data action, fields and contract version.',
        );
      const action = parsed.data;
      let result: unknown;
      switch (action.action) {
        case 'preview_csv':
          result = await previewCsv(context, action);
          break;
        case 'review_import':
          result = await reviewImport(context, action);
          break;
        case 'commit_import':
          result = await commitImport(context, action);
          break;
        case 'discard_import':
          result = await discardImport(context, action.batch_id);
          break;
        case 'add_measurement':
          result = await addMeasurement(context, action);
          break;
        case 'correct_measurement':
        case 'delete_measurement':
          result = await mutateMeasurement(context, action);
          break;
        case 'delete_event':
        case 'correct_event_time':
        case 'update_event_annotations':
          result = await mutateEvent(context, action);
          break;
        case 'update_source_defaults':
          result = await updateSourceDefaults(context, action);
          break;
      }
      sendJson(response, 200, { data: result });
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

import type { IncomingMessage, ServerResponse } from 'node:http';
import { pipeline } from 'node:stream/promises';
import { AccountRequestSchema } from '../../shared/account.js';
import { verifyIdentity, verifySession } from '../auth/session.js';
import {
  accountStatus,
  beginDeletion,
  continueDeletion,
} from '../services/account.js';
import { exportAccount } from '../services/account-export.js';
import { checkOrigin, readJson } from './request.js';
import { HttpFailure, respondFailure } from './failure.js';
import { sendError, sendJson } from './responses.js';

export async function handleAccount(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    checkOrigin(request);
    const params = new URL(request.url ?? '/', 'http://localhost').searchParams;
    if (
      [...params.keys()].some((key) => key !== '__vulpes_account') ||
      params.getAll('__vulpes_account').length > 1
    )
      throw new HttpFailure(
        400,
        'invalid_input',
        'Account actions do not accept query filters or owner identifiers.',
      );
    if (request.method === 'GET') {
      const context = await verifyIdentity(request);
      sendJson(response, 200, { data: await accountStatus(context) });
      return;
    }
    if (request.method !== 'POST') {
      response.setHeader('Allow', 'GET, POST');
      sendError(response, 405, 'method_not_allowed', 'Use GET or POST.');
      return;
    }
    const parsed = AccountRequestSchema.safeParse(await readJson(request));
    if (!parsed.success)
      throw new HttpFailure(
        400,
        'invalid_input',
        'Choose a valid account action and confirm sensitive operations.',
      );
    if (parsed.data.action === 'delete') {
      const identity = await verifyIdentity(request);
      sendJson(response, 200, { data: await beginDeletion(identity) });
      return;
    }
    if (parsed.data.action === 'continue_delete') {
      const identity = await verifyIdentity(request);
      sendJson(response, 200, { data: await continueDeletion(identity) });
      return;
    }
    const controller = new AbortController();
    const abort = () => {
      if (!response.writableFinished) controller.abort();
    };
    response.once('close', abort);
    if (request.aborted || response.destroyed) controller.abort();
    try {
      const context = await verifySession(request, controller.signal);
      const result = await exportAccount(
        context,
        parsed.data,
        controller.signal,
      );
      try {
        await result.validate();
        controller.signal.throwIfAborted();
        response.statusCode = 200;
        response.setHeader('Content-Type', 'application/json; charset=utf-8');
        response.setHeader('Cache-Control', 'no-store');
        response.setHeader('X-Content-Type-Options', 'nosniff');
        response.setHeader(
          'Content-Disposition',
          'attachment; filename="vulpes-account-v1.json"',
        );
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
  } catch (error) {
    if (response.headersSent || response.destroyed) response.destroy();
    else respondFailure(response, error);
  }
}

import type { ServerResponse } from 'node:http';
import { sendError } from './responses.js';

export class HttpFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}
export function respondFailure(response: ServerResponse, error: unknown): void {
  if (error instanceof HttpFailure)
    sendError(response, error.status, error.code, error.message);
  else
    sendError(
      response,
      500,
      'internal_error',
      'The request could not be completed.',
    );
}

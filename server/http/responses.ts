import { randomUUID } from 'node:crypto';
import type { ServerResponse } from 'node:http';

export function sendJson(response: ServerResponse, status: number, payload: object): void {
  response.statusCode = status;
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.end(JSON.stringify({ ...payload, request_id: randomUUID() }));
}

export function sendError(response: ServerResponse, status: number, code: string, message: string): void {
  sendJson(response, status, { error: { code, message, retryable: false } });
}

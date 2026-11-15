import type { IncomingMessage, ServerResponse } from 'node:http';
import { securityHeaders } from './security.js';

export function shareTargetFallback(
  request: IncomingMessage,
  response: ServerResponse,
): void {
  response.statusCode = request.method === 'POST' ? 503 : 405;
  for (const [name, value] of Object.entries(securityHeaders))
    response.setHeader(name, value);
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Content-Type', 'text/html; charset=utf-8');
  response.setHeader('Allow', 'POST');
  response.end(
    '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Share unavailable · Vulpes</title><h1>Share unavailable</h1><p>No file was imported. Reopen Vulpes online and allow its update to finish, or choose your CSV in Data.</p><a href="/data/import">Choose a CSV</a></html>',
  );
}

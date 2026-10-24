import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import status from '../api/status.js';
import { readServerEnvironment } from '../server/config/environment.js';

if (existsSync('.env.local')) process.loadEnvFile('.env.local');

try {
  readServerEnvironment(process.env);
  const server = createServer(status);
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  server.on('error', () => {
    console.error('Local API failed to listen on 127.0.0.1:3001.');
    process.exitCode = 1;
  });
  server.listen(3001, '127.0.0.1', () => console.info('Local API: http://127.0.0.1:3001'));
  const shutdown = () => {
    server.closeAllConnections();
    server.close();
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
} catch {
  console.error('Local API configuration is invalid. Check VULPES_LIVE_AI_ENABLED.');
  process.exitCode = 1;
}

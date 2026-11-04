// Test composition is a separate executable; production entry points never
// import this module or enable synthetic inference through an environment flag.
import { createServer } from 'node:http';
import { localRouter } from '../server/http/router.js';
import { createChatHandler } from '../server/http/chat.js';
import { createConversationsHandler } from '../server/http/conversations.js';
import {
  SyntheticChatTransport,
  syntheticChatDependencies,
} from '../tests/fixtures/chat.js';
import { SyntheticGoalTransport } from '../tests/fixtures/chat-goals.js';
import { z } from 'zod';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { securityHeaders } from '../server/http/security.js';
import { publicAuthConfig } from '../shared/auth.js';

const id = process.env.VULPES_TEST_CHAT_OWNER;
const goalOwner = process.env.VULPES_TEST_GOAL_OWNER;
const journeyOwner = process.env.VULPES_TEST_JOURNEY_OWNER;
if (
  !id ||
  process.env.VULPES_LIVE_AI_ENABLED !== 'false' ||
  process.env.VITE_SUPABASE_URL !== 'http://127.0.0.1:54321'
)
  throw new Error('Use the guarded local browser runner.');
const clockLead = process.env.VULPES_TEST_API_CLOCK_LEAD ?? '0';
if (!['0', '1000'].includes(clockLead))
  throw new Error('Unsupported synthetic API clock lead.');
if (clockLead === '1000') {
  const now = Date.now.bind(Date);
  Date.now = () => now() + 1000;
}
const built = process.argv[2] === '--serve-built';
if (process.argv.length !== (built ? 3 : 2))
  throw new Error('Unsupported local test composition.');
const dist = path.resolve('dist');
async function staticFile(
  url: string,
  response: import('node:http').ServerResponse,
) {
  const auth = publicAuthConfig(
    process.env.VITE_SUPABASE_URL,
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  );
  for (const [name, value] of Object.entries(securityHeaders))
    response.setHeader(
      name,
      name === 'Content-Security-Policy' && auth
        ? value.replace("connect-src 'self'", `connect-src 'self' ${auth.url}`)
        : value,
    );
  response.setHeader('Cache-Control', 'no-store');
  try {
    const pathname = decodeURIComponent(
      new URL(url, 'http://localhost').pathname,
    );
    const relative = path.extname(pathname) ? pathname.slice(1) : 'index.html';
    const file = path.resolve(dist, relative);
    if (!file.startsWith(dist + path.sep)) throw new Error();
    const types: Record<string, string> = {
      '.html': 'text/html; charset=utf-8',
      '.js': 'text/javascript; charset=utf-8',
      '.css': 'text/css; charset=utf-8',
      '.png': 'image/png',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.json': 'application/json',
      '.webmanifest': 'application/manifest+json',
    };
    const type = types[path.extname(file)];
    if (!type) throw new Error();
    const bytes = await readFile(file);
    response.setHeader('Content-Type', type);
    response.end(bytes);
  } catch {
    response.statusCode = 404;
    response.end('Not found.');
  }
}
const allowed = (userId: string) =>
  userId === id || userId === goalOwner || userId === journeyOwner;
const conversations = createConversationsHandler((context) =>
  allowed(context.userId) ? syntheticChatDependencies() : null,
);
const server = createServer((req, res) => {
  const path = new URL(req.url!, 'http://localhost').pathname;
  if (built && !path.startsWith('/api')) {
    void staticFile(req.url!, res);
    return;
  }
  const scenario = z
    .enum([
      'complete',
      'truncated',
      'missing_usage',
      'malformed',
      'unsafe_text',
      'markdown',
      'slow',
      'goal_create',
      'goal_revise',
      'goal_progress',
      'goal_yes',
    ])
    .catch('complete')
    .parse(req.headers['x-vulpes-test-scenario']);
  const goal = z
    .enum(['goal_create', 'goal_revise', 'goal_progress', 'goal_yes'])
    .safeParse(scenario);
  const chat = createChatHandler((context) =>
    allowed(context.userId)
      ? syntheticChatDependencies(
          goal.success
            ? new SyntheticGoalTransport(goal.data)
            : new SyntheticChatTransport(
                scenario as
                  | 'complete'
                  | 'truncated'
                  | 'missing_usage'
                  | 'malformed'
                  | 'unsafe_text'
                  | 'markdown'
                  | 'slow',
              ),
        )
      : null,
  );
  void (path === '/api/chat'
    ? chat(req, res)
    : path === '/api/conversations'
      ? conversations(req, res)
      : localRouter(req, res));
});
server.listen(built ? 4173 : 3001, '127.0.0.1', () =>
  console.info(
    'Synthetic test API and optional built assets ready on loopback.',
  ),
);
const stop = () => {
  server.closeAllConnections();
  server.close();
};
process.once('SIGINT', stop);
process.once('SIGTERM', stop);

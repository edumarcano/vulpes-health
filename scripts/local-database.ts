import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const projectId = 'vulpes-health-pr03-test';
export const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const require = createRequire(import.meta.url);

export function assertProject(config: string): void {
  function setting(section: string, key: string): string | undefined {
    const block = section
      ? config.split(`[${section}]`)[1]?.split(/\n\s*\[/)[0]
      : config.split(/\n\s*\[/)[0];
    const matches = [
      ...(block ?? '').matchAll(
        new RegExp(`^${key}\\s*=\\s*([^#\\r\\n]+)`, 'gm'),
      ),
    ];
    assert(
      matches.length === 1,
      `Missing or ambiguous local configuration: ${section}.${key}`,
    );
    return matches[0]?.[1]?.trim();
  }
  assert.equal(
    setting('', 'project_id'),
    `"${projectId}"`,
    'Refusing a different database project.',
  );
  assert.equal(setting('api', 'port'), '54321');
  assert.equal(setting('db', 'port'), '54322');
  assert.equal(setting('auth', 'enable_signup'), 'false');
  assert.equal(setting('auth', 'enable_anonymous_sign_ins'), 'false');
  assert.equal(
    setting('auth.email', 'enable_signup'),
    'true',
    'Password sign-in must remain enabled; global signup stays disabled.',
  );
}

export function isLocalDockerHost(host: string): boolean {
  return (
    /^unix:\/\/\/[\w/.-]+$/.test(host) ||
    /^npipe:\/{2,4}\.\/pipe\/[\w.-]+$/.test(host)
  );
}

export function localEnvironment(
  source: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
  const allowed =
    /^(?:path|pathext|systemroot|windir|comspec|userprofile|home|appdata|localappdata|temp|tmp|lang|lc_all|docker_host|docker_context|docker_config)$/i;
  const env = Object.fromEntries(
    Object.entries(source).filter(([key]) => allowed.test(key)),
  );
  const host = Object.entries(env).find(
    ([key]) => key.toUpperCase() === 'DOCKER_HOST',
  )?.[1];
  if (host)
    assert(isLocalDockerHost(host), 'Remote Docker hosts are forbidden.');
  return { ...env, DO_NOT_TRACK: '1' };
}

export function assertLocalStack(): void {
  assertProject(
    readFileSync(path.join(projectRoot, 'supabase/config.toml'), 'utf8'),
  );
  assert(
    !existsSync(path.join(projectRoot, 'supabase/.temp/project-ref')),
    'Linked projects are forbidden in this harness.',
  );
  const context = spawnSync(
    'docker',
    ['context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'],
    {
      cwd: projectRoot,
      env: localEnvironment(),
      encoding: 'utf8',
      timeout: 15_000,
    },
  );
  assert(
    !context.error && context.status === 0,
    'A working local Docker runtime is required; no hosted fallback.',
  );
  const host: unknown = JSON.parse(context.stdout.trim());
  assert(
    typeof host === 'string' && isLocalDockerHost(host),
    'Refusing a remote Docker context.',
  );
}

export function runSupabase(args: string[], capture = false): string {
  assertLocalStack();
  const result = spawnSync(
    process.execPath,
    [
      require.resolve('supabase/dist/supabase.js'),
      ...args,
      '--workdir',
      projectRoot,
    ],
    {
      cwd: projectRoot,
      env: localEnvironment(),
      encoding: 'utf8',
      stdio: capture ? 'pipe' : 'inherit',
      maxBuffer: 16 * 1024 * 1024,
    },
  );
  // Captured commands include local administrative keys. Never print their output on failure.
  assert(
    !result.error && result.status === 0,
    `Local Supabase ${args[0]} failed; inspect the local stack without publishing credentials.`,
  );
  return result.stdout ?? '';
}

export function parseLocalStatus(text: string): {
  apiUrl: string;
  anonKey: string;
  adminKey: string;
} {
  const status: Record<string, unknown> = JSON.parse(text);
  assert.equal(
    status.API_URL,
    'http://127.0.0.1:54321',
    'Refusing an unexpected API endpoint.',
  );
  const db = new URL(String(status.DB_URL));
  assert.equal(db.hostname, '127.0.0.1');
  assert.equal(db.port, '54322');
  assert.equal(db.pathname, '/postgres');
  assert(
    typeof status.ANON_KEY === 'string' && status.ANON_KEY.length > 0,
    'Local anonymous key is missing.',
  );
  assert(
    typeof status.SERVICE_ROLE_KEY === 'string' &&
      status.SERVICE_ROLE_KEY.length > 0,
    'Local admin key is missing.',
  );
  return {
    apiUrl: status.API_URL,
    anonKey: status.ANON_KEY,
    adminKey: status.SERVICE_ROLE_KEY,
  };
}

export function localStatus() {
  return parseLocalStatus(runSupabase(['status', '-o', 'json'], true));
}

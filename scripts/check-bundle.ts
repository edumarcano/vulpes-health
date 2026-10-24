import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

const canaries = {
  OPENROUTER_API_KEY: 'synthetic-provider-secret-canary-01',
  SUPABASE_SERVICE_ROLE_KEY: 'synthetic-admin-secret-canary-01',
  VULPES_TRACE_ENCRYPTION_KEY_B64: 'synthetic-encryption-secret-canary-01',
  GOOGLE_APPLICATION_CREDENTIALS: 'synthetic-private-credential-path-canary-01',
};
const npm = process.env.npm_execpath;
assert(npm, 'Run this check with npm run test:bundle.');
const build = spawnSync(process.execPath, [npm, 'run', 'build'], {
  env: { ...process.env, ...canaries, VULPES_LIVE_AI_ENABLED: 'true' },
  stdio: 'inherit',
});
assert.equal(build.status, 0, 'Canary build failed.');
const files = await readdir('dist', { recursive: true, withFileTypes: true });
let checked = 0;
for (const file of files) {
  if (!file.isFile()) continue;
  const name = path.join(file.parentPath, file.name);
  assert(!name.endsWith('.map'), 'Public source maps must be disabled.');
  const body = await readFile(name, 'utf8');
  for (const canary of Object.values(canaries)) assert(!body.includes(canary), `Secret canary leaked into ${name}`);
  assert(!/(?:source-extractions|proofs|\.build|server\/config)/.test(name), `Unexpected public artifact: ${name}`);
  checked += 1;
}
console.info(`PASS: inspected ${checked} public files; no secret canaries, source maps, or private server output.`);

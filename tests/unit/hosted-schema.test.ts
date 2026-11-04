import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { hostedBuild } from '../../scripts/build-hosted.js';
import { deploymentChecks } from '../../scripts/deployment-integrity.js';

const sha = 'a'.repeat(40);
vi.mock('node:child_process', () => ({ spawnSync: vi.fn() }));
const versions = readdirSync('supabase/migrations').map(
  (f) => f.split('_')[0]!,
);
const env = {
  VERCEL: '1',
  VERCEL_ENV: 'production',
  VERCEL_PROJECT_ID: 'prj_Synthetic',
  VERCEL_GIT_COMMIT_REF: 'main',
  VERCEL_GIT_COMMIT_SHA: sha,
  VULPES_GITHUB_READ_TOKEN: 'synthetic-only',
  VULPES_LIVE_AI_ENABLED: 'false',
  VITE_SUPABASE_URL: 'https://abcdefghijklmnopqrst.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_synthetic',
  VULPES_APP_ORIGIN: 'https://vulpes-synthetic.vercel.app',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_synthetic',
  VULPES_TRACE_ENCRYPTION_KEY_ID: 'synthetic',
  VULPES_TRACE_ENCRYPTION_KEY_B64: Buffer.alloc(32, 1).toString('base64'),
  npm_execpath: 'synthetic-npm.js',
};
const args = [
  '--project-ref=abcdefghijklmnopqrst',
  '--project-id=prj_Synthetic',
  '--app-origin=https://vulpes-synthetic.vercel.app',
];
function setup(applied: unknown, schemaStatus = 200) {
  vi.mocked(spawnSync).mockImplementation((command) => ({
    status: 0,
    stdout: command === 'git' ? sha : '',
    stderr: '',
    pid: 1,
    output: [],
    signal: null,
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      const schema = url.endsWith('/rest/v1/rpc/schema_version_v1');
      const body = schema
        ? applied
        : url.endsWith('git/ref/heads/main')
          ? { object: { sha } }
          : url.includes('/attempts/1/jobs')
            ? {
                total_count: 3,
                jobs: deploymentChecks.map((name) => ({
                  name,
                  head_sha: sha,
                  status: 'completed',
                  conclusion: 'success',
                })),
              }
            : {
                workflow_runs: [
                  {
                    id: 1,
                    run_attempt: 1,
                    head_sha: sha,
                    head_branch: 'main',
                    event: 'push',
                    path: '.github/workflows/ci.yml',
                    status: 'completed',
                    conclusion: 'success',
                  },
                ],
              };
      return new Response(JSON.stringify(body), {
        status: schema ? schemaStatus : 200,
      });
    }),
  );
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});
describe('hosted schema compatibility before build', () => {
  it('refuses a lagging schema before invoking the application build', async () => {
    setup({ versions: versions.slice(0, -1) });
    await expect(hostedBuild(args, env)).rejects.toThrow(
      'hosted_schema_incompatible',
    );
    expect(vi.mocked(spawnSync).mock.calls.map((c) => c[0])).toEqual(['git']);
  });
  it('accepts a complete migration set and then builds', async () => {
    setup({ versions });
    await expect(hostedBuild(args, env)).resolves.toMatchObject({
      buildRan: true,
    });
    expect(spawnSync).toHaveBeenCalledTimes(2);
  });
  it('rejects an older hole even when the latest migration is present', async () => {
    setup({ versions: versions.slice(1) });
    await expect(hostedBuild(args, env)).rejects.toThrow(
      'hosted_schema_incompatible',
    );
  });
  it.each([{ versions: ['invalid'] }, {}, null])(
    'refuses malformed schema evidence %j',
    async (body) => {
      setup(body);
      await expect(hostedBuild(args, env)).rejects.toThrow();
    },
  );
  it('refuses a missing RPC or unavailable database', async () => {
    setup({}, 404);
    await expect(hostedBuild(args, env)).rejects.toThrow(
      'hosted_schema_unavailable',
    );
  });
});

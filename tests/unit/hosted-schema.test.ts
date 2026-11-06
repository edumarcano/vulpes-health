import { afterEach, describe, expect, it, vi } from 'vitest';
import { readdirSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { hostedBuild } from '../../scripts/build-hosted.js';

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
  vi.mocked(spawnSync).mockImplementation(() => ({
    status: 0,
    stdout: '',
    stderr: '',
    pid: 1,
    output: [],
    signal: null,
  }));
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      expect(url).toBe(
        `${env.VITE_SUPABASE_URL}/rest/v1/rpc/schema_version_v1`,
      );
      return new Response(JSON.stringify(applied), { status: schemaStatus });
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
    expect(vi.mocked(spawnSync).mock.calls.map((c) => c[0])).toEqual([]);
  });
  it('accepts a complete migration set and then builds', async () => {
    setup({ versions });
    await expect(hostedBuild(args, env)).resolves.toMatchObject({
      buildRan: true,
    });
    expect(spawnSync).toHaveBeenCalledTimes(1);
  });
  it.each([
    { VERCEL_GIT_COMMIT_SHA: '' },
    { VERCEL_GIT_COMMIT_SHA: 'invalid' },
    { VERCEL_GIT_COMMIT_REF: 'feature/test' },
  ])(
    'refuses absent or invalid source identity before database access %j',
    async (patch) => {
      setup({ versions });
      await expect(hostedBuild(args, { ...env, ...patch })).rejects.toThrow();
      expect(fetch).not.toHaveBeenCalled();
      expect(spawnSync).not.toHaveBeenCalled();
    },
  );
  it('reports application failure after successful schema verification', async () => {
    setup({ versions });
    vi.mocked(spawnSync).mockReturnValueOnce({
      status: 1,
      stdout: '',
      stderr: '',
      pid: 1,
      output: [],
      signal: null,
    });
    await expect(hostedBuild(args, env)).rejects.toThrow('hosted_build_failed');
  });
  it('rejects an older hole even when the latest migration is present', async () => {
    setup({ versions: versions.slice(1) });
    await expect(hostedBuild(args, env)).rejects.toThrow(
      'hosted_schema_incompatible',
    );
  });
  it('allows extra forward versions for additive deployment compatibility', async () => {
    setup({ versions: [...versions, '20990101000100'] });
    await expect(hostedBuild(args, env)).resolves.toMatchObject({
      buildRan: true,
    });
  });
  it('refuses duplicated migration evidence', async () => {
    setup({ versions: [...versions, versions[0]] });
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

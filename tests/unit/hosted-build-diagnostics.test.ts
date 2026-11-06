import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';
import { hostedBuildDiagnostic } from '../../scripts/build-hosted.js';

it('reports a safe configuration diagnostic through the actual CLI', () => {
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      'scripts/build-hosted.ts',
      '--project-ref=abcdefghijklmnopqrst',
      '--project-id=prj_Synthetic',
      '--app-origin=https://vulpes-synthetic.vercel.app',
    ],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        VERCEL: '1',
        VERCEL_ENV: 'preview',
        SUPABASE_SERVICE_ROLE_KEY: 'private-diagnostic-canary',
      },
    },
  );
  expect(result.error).toBeUndefined();
  expect(result.status).toBe(1);
  expect(result.stdout + result.stderr).toContain('hosted_project_mismatch');
  expect(result.stdout + result.stderr).not.toContain(
    'private-diagnostic-canary',
  );
});

it('redacts arbitrary error, validation, network and response contents', () => {
  for (const error of [
    new Error('private-prompt-canary'),
    new TypeError('https://private-token.example'),
    { message: 'private-key-canary' },
    'private-string-canary',
  ]) {
    expect(hostedBuildDiagnostic(error, 'schema')).toEqual({
      event: 'hosted_build_failed',
      stage: 'schema',
      code: 'hosted_build_unexpected',
    });
  }
  expect(
    hostedBuildDiagnostic(new Error('hosted_schema_incompatible'), 'schema'),
  ).toEqual({
    event: 'hosted_build_failed',
    stage: 'schema',
    code: 'hosted_schema_incompatible',
  });
});

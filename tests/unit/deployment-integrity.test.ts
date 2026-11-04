import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  deploymentChecks,
  verifyProductionCommit,
} from '../../scripts/deployment-integrity.js';

const sha = 'a'.repeat(40);
const env = {
  VERCEL_GIT_COMMIT_SHA: sha,
  VERCEL_GIT_COMMIT_REF: 'main',
  VULPES_GITHUB_READ_TOKEN: 'synthetic-read-only',
};
const run = {
  id: 123,
  run_attempt: 2,
  head_sha: sha,
  head_branch: 'main',
  event: 'push',
  path: '.github/workflows/ci.yml',
  status: 'completed',
  conclusion: 'success',
};
const jobs = deploymentChecks.map((name) => ({
  name,
  head_sha: sha,
  status: 'completed',
  conclusion: 'success',
}));
function api(
  patch: {
    run?: object;
    jobs?: object[];
    sha?: string;
    finalSha?: string;
    status?: number;
  } = {},
) {
  let refs = 0;
  return (async (input: string | URL | Request, init?: RequestInit) => {
    expect(init?.redirect).toBe('error');
    const url = String(input);
    expect(
      url.startsWith('https://api.github.com/repos/edumarcano/vulpes-health/'),
    ).toBe(true);
    const body = url.endsWith('git/ref/heads/main')
      ? {
          object: {
            sha: refs++ === 0 ? (patch.sha ?? sha) : (patch.finalSha ?? sha),
          },
        }
      : url.includes('/attempts/2/jobs')
        ? { total_count: (patch.jobs ?? jobs).length, jobs: patch.jobs ?? jobs }
        : { workflow_runs: [{ ...run, ...patch.run }] };
    return new Response(JSON.stringify(body), { status: patch.status ?? 200 });
  }) as typeof fetch;
}

describe('production deployment boundary', () => {
  it('keeps Git auto-deploy disabled so a push cannot race main CI', () => {
    const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
    expect(config.git.deploymentEnabled).toBe(false);
  });
  it('isolates every main push CI run from replacement by another commit', () => {
    const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(workflow).toContain(
      'github.event.pull_request.number || github.sha',
    );
  });
  it('accepts only all three successful jobs on the exact main push and latest run attempt', async () => {
    await expect(verifyProductionCommit(env, api())).resolves.toEqual({
      commit: sha,
      ciRun: 123,
      ciAttempt: 2,
    });
  });
  it.each([
    { run: { status: 'in_progress', conclusion: null } },
    { run: { conclusion: 'failure' } },
    { run: { conclusion: 'cancelled' } },
    { run: { event: 'pull_request' } },
    { run: { head_sha: 'b'.repeat(40) } },
    { run: { path: '.github/workflows/untrusted.yml' } },
    { jobs: jobs.slice(1) },
    {
      jobs: jobs.map((j, i) => (i === 0 ? { ...j, conclusion: 'skipped' } : j)),
    },
    { jobs: jobs.map((j) => ({ ...j, head_sha: 'b'.repeat(40) })) },
    { sha: 'b'.repeat(40) },
    { finalSha: 'b'.repeat(40) },
    { status: 403 },
  ])('refuses unverified deployment %j', async (patch) => {
    await expect(verifyProductionCommit(env, api(patch))).rejects.toThrow();
  });
  it('refuses absent credentials or commit identity before network access', async () => {
    const offline = (async () => {
      throw new Error('unexpected_network');
    }) as typeof fetch;
    for (const patch of [
      { VULPES_GITHUB_READ_TOKEN: '' },
      { VERCEL_GIT_COMMIT_SHA: '' },
      { VERCEL_GIT_COMMIT_REF: 'feature/x' },
    ]) {
      await expect(
        verifyProductionCommit({ ...env, ...patch }, offline),
      ).rejects.not.toThrow('unexpected_network');
    }
  });
});

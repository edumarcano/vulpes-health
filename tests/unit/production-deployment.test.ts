import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deployProduction } from '../../scripts/deploy-production.js';
import { deploymentChecks } from '../../scripts/deployment-integrity.js';

const sha = 'a'.repeat(40);
const projectId = 'prj_k4kQU4k9DVnjskslngj7QbYA7zvW';
const run = {
  id: 123,
  run_attempt: 1,
  head_sha: sha,
  head_branch: 'main',
  event: 'push',
  path: '.github/workflows/ci.yml',
  status: 'completed',
  conclusion: 'success',
  head_repository: { full_name: 'edumarcano/vulpes-health' },
};
const event = { repository: run.head_repository, workflow_run: run };
const env = {
  VERCEL_TOKEN: 'synthetic-vercel',
  VERCEL_TEAM_ID: 'team_synthetic',
  VULPES_GITHUB_READ_TOKEN: 'synthetic-github',
};
function fixture(
  options: {
    state?: string;
    superseded?: boolean;
    supersededAtPromotion?: boolean;
    ci?: string;
    wrongSource?: boolean;
    attempt?: number;
    denied?: boolean;
  } = {},
) {
  const mutations: { url: string; body: Record<string, unknown> }[] = [];
  let staged = false;
  let ready = false;
  const request = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    expect(init?.redirect).toBe('error');
    if (url.startsWith('https://api.vercel.com/')) {
      if (init?.method === 'POST') {
        mutations.push({ url, body: JSON.parse(String(init.body)) });
        staged = true;
        return Response.json(
          { id: 'dpl_synthetic' },
          { status: options.denied ? 403 : 200 },
        );
      }
      ready = true;
      return Response.json({
        id: 'dpl_synthetic',
        projectId,
        target: 'production',
        readyState: options.state ?? 'READY',
        meta: {
          githubCommitSha: options.wrongSource ? 'b'.repeat(40) : sha,
          githubCommitRef: 'main',
        },
      });
    }
    if (url.endsWith('git/ref/heads/main'))
      return Response.json({
        object: {
          sha:
            (staged && options.superseded) ||
            (ready && options.supersededAtPromotion)
              ? 'b'.repeat(40)
              : sha,
        },
      });
    if (url.includes('/jobs?'))
      return Response.json({
        total_count: 3,
        jobs: deploymentChecks.map((name) => ({
          name,
          head_sha: sha,
          status: 'completed',
          conclusion: 'success',
        })),
      });
    return Response.json({
      workflow_runs: [
        {
          ...run,
          conclusion: options.ci ?? 'success',
          run_attempt: options.attempt ?? 1,
        },
      ],
    });
  }) as typeof fetch;
  return { request, mutations };
}
describe('automatic production release', () => {
  it('stages an immutable Git SHA without assigning domains, then promotes the verified artifact', async () => {
    const f = fixture();
    await expect(
      deployProduction(event, env, f.request),
    ).resolves.toMatchObject({
      commit: sha,
      deployment: 'dpl_synthetic',
      promotion: 'requested',
    });
    expect(f.mutations).toHaveLength(2);
    expect(f.mutations[0]!.body).toEqual({
      name: 'vulpes-health',
      project: projectId,
      target: 'production',
      gitSource: { type: 'github', repoId: 1425927980, ref: 'main', sha },
      autoAssignCustomDomains: false,
    });
    expect(f.mutations[1]!.url).toContain(`/promote/dpl_synthetic?`);
  });
  it.each(['failure', 'cancelled', null])(
    'rejects unsuccessful trigger %s before any request',
    async (conclusion) => {
      const f = fixture();
      await expect(
        deployProduction(
          { ...event, workflow_run: { ...run, conclusion } },
          env,
          f.request,
        ),
      ).rejects.toThrow();
      expect(f.mutations).toHaveLength(0);
    },
  );
  it.each([{ ci: 'failure' }, { ci: 'cancelled' }, { attempt: 2 }])(
    'rejects replaced or failed CI evidence %j',
    async (options) => {
      const f = fixture(options);
      await expect(deployProduction(event, env, f.request)).rejects.toThrow();
      expect(f.mutations).toHaveLength(0);
    },
  );
  it.each([
    { superseded: true },
    { supersededAtPromotion: true },
    { state: 'ERROR' },
    { state: 'CANCELED' },
    { wrongSource: true },
    { denied: true },
  ])('never promotes rejected staging %j', async (options) => {
    const f = fixture(options);
    await expect(deployProduction(event, env, f.request)).rejects.toThrow();
    expect(f.mutations).toHaveLength(1);
  });
  it('times out without promotion and propagates runner cancellation during polling', async () => {
    const f = fixture({ state: 'BUILDING' });
    await expect(
      deployProduction(event, env, f.request, async () => {}),
    ).rejects.toThrow('deployment_build_timeout');
    expect(f.mutations).toHaveLength(1);
    const cancelled = fixture({ state: 'BUILDING' });
    await expect(
      deployProduction(event, env, cancelled.request, async () => {
        throw new Error('aborted');
      }),
    ).rejects.toThrow('aborted');
    expect(cancelled.mutations).toHaveLength(1);
  });
  it('only triggers from completed CI with an explicit activation switch and serializes promotions', () => {
    const workflow = readFileSync('.github/workflows/production.yml', 'utf8');
    expect(workflow).toContain('workflow_run:');
    expect(workflow).toContain("vars.VULPES_AUTODEPLOY_ENABLED == 'true'");
    expect(workflow).toContain('cancel-in-progress: false');
    expect(workflow).toContain(
      'ref: ${{ github.event.workflow_run.head_sha }}',
    );
    expect(workflow).not.toContain('workflow_dispatch:');
  });
});

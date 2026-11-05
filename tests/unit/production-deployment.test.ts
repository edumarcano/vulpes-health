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
    promotionStates?: string[];
    previousIntent?: boolean;
    partial?: boolean;
    promotionSuperseded?: boolean;
    ambiguousPost?: boolean;
    staleJob?: boolean;
    supersededAfterPost?: boolean;
    journalDenied?: boolean;
  } = {},
) {
  const mutations: { url: string; body: Record<string, unknown> }[] = [];
  let staged = false;
  let ready = false;
  let promoting = options.previousIntent ?? false;
  let promotionReads = 0;
  let requestVersion = options.previousIntent ? 1 : 0;
  const statuses: string[] = [];
  const request = (async (
    input: string | URL | Request,
    init?: RequestInit,
  ) => {
    const url = String(input);
    expect(init?.redirect).toBe('error');
    if (
      url.includes('/deployments') &&
      url.startsWith('https://api.github.com/')
    ) {
      if (url.includes('/statuses')) {
        if (init?.method === 'POST') {
          statuses.push(JSON.parse(String(init.body)).state);
          return Response.json({ id: 1 });
        }
        return Response.json([{ state: 'in_progress' }]);
      }
      if (init?.method === 'POST')
        return Response.json(
          { id: 456 },
          { status: options.journalDenied ? 403 : 200 },
        );
      return Response.json(
        options.previousIntent
          ? [
              {
                id: 456,
                payload: {
                  version: 1,
                  deploymentId: 'dpl_synthetic',
                  after: 0,
                },
              },
            ]
          : [],
      );
    }
    if (url.startsWith('https://api.vercel.com/')) {
      if (init?.method === 'POST') {
        mutations.push({ url, body: JSON.parse(String(init.body)) });
        staged = true;
        if (url.includes('/promote/')) {
          expect(statuses.at(-1)).toBe('in_progress');
          promoting = true;
          requestVersion++;
          if (options.ambiguousPost)
            throw new Error('ambiguous_network_failure');
          return new Response(null, { status: 202 });
        }
        return Response.json(
          { id: 'dpl_synthetic' },
          { status: options.denied ? 403 : 200 },
        );
      }
      if (url.includes(`/v9/projects/${projectId}/promote/aliases`))
        return Response.json({
          aliases: [
            {
              status: options.partial ? 'failed' : 'completed',
              alias: {
                alias: 'vulpes-health.vercel.app',
                deploymentId: 'dpl_synthetic',
              },
            },
          ],
          pagination: { next: null },
        });
      if (url.includes(`/v9/projects/${projectId}?`)) {
        const states = options.promotionStates ?? ['succeeded'];
        const jobStatus = states[Math.min(promotionReads++, states.length - 1)];
        return Response.json({
          id: projectId,
          targets: { production: { id: 'dpl_synthetic' } },
          lastAliasRequest: promoting
            ? {
                jobStatus,
                type: 'promote',
                toDeploymentId: options.promotionSuperseded
                  ? 'dpl_other'
                  : 'dpl_synthetic',
                requestedAt: options.staleJob ? 0 : requestVersion,
              }
            : null,
        });
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
            (ready && options.supersededAtPromotion) ||
            (promoting && options.supersededAfterPost)
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
  return { request, mutations, statuses, promotionReads: () => promotionReads };
}
describe('automatic production release', () => {
  it('stages an immutable Git SHA without assigning domains, then promotes the verified artifact', async () => {
    const f = fixture();
    await expect(
      deployProduction(event, env, f.request),
    ).resolves.toMatchObject({
      commit: sha,
      deployment: 'dpl_synthetic',
      promotion: 'succeeded',
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
  it('waits through queued and pending promotion until terminal success', async () => {
    const f = fixture({
      promotionStates: ['pending', 'in-progress', 'succeeded'],
    });
    await expect(
      deployProduction(event, env, f.request, async () => {}),
    ).resolves.toMatchObject({ promotion: 'succeeded' });
    expect(f.statuses).toEqual(['in_progress', 'success']);
    expect(f.promotionReads()).toBeGreaterThanOrEqual(3);
  });
  it.each([
    { promotionStates: ['failed'] },
    { promotionStates: ['pending'] },
    { partial: true },
    { promotionSuperseded: true },
    { ambiguousPost: true },
    { staleJob: true },
  ])(
    'retains an unresolved intent when promotion cannot be verified %j',
    async (options) => {
      const f = fixture(options);
      await expect(
        deployProduction(event, env, f.request, async () => {}),
      ).rejects.toThrow();
      expect(f.statuses).toEqual(['in_progress']);
    },
  );
  it('refuses another staging request while a previous workflow promotion remains unresolved', async () => {
    const f = fixture({ previousIntent: true, promotionStates: ['pending'] });
    await expect(
      deployProduction(event, env, f.request, async () => {}),
    ).rejects.toThrow();
    expect(f.mutations).toEqual([]);
  });
  it('finishes tracking an accepted promotion before reporting a newer main head', async () => {
    const f = fixture({ supersededAfterPost: true });
    await expect(
      deployProduction(event, env, f.request, async () => {}),
    ).rejects.toThrow('deployment_commit_not_main');
    expect(f.statuses).toEqual(['in_progress', 'success']);
  });
  it('does not submit a promotion without a durable intent', async () => {
    const f = fixture({ journalDenied: true });
    await expect(deployProduction(event, env, f.request)).rejects.toThrow(
      'promotion_journal_unavailable',
    );
    expect(f.mutations).toHaveLength(1);
  });
  it('reconciles a previous completed promotion before beginning a new deployment', async () => {
    const f = fixture({ previousIntent: true });
    await expect(
      deployProduction(event, env, f.request, async () => {}),
    ).resolves.toMatchObject({ promotion: 'succeeded' });
    expect(f.statuses).toEqual(['success', 'in_progress', 'success']);
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

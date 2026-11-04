import { z } from 'zod';

const repository = 'edumarcano/vulpes-health';
export const deploymentChecks = [
  'Fast checks',
  'Backend integration checks',
  'Browser integration checks',
] as const;
const SHA = z.string().regex(/^[a-f0-9]{40}$/);
const Run = z.object({
  id: z.number().int().positive(),
  run_attempt: z.number().int().positive(),
  head_sha: SHA,
  head_branch: z.string(),
  event: z.string(),
  path: z.string(),
  status: z.string(),
  conclusion: z.string().nullable(),
});

// A PR success is not proof of the merged main commit. This gate deliberately
// refuses pending CI rather than letting deployment run ahead of verification.
export async function verifyProductionCommit(
  env: NodeJS.ProcessEnv,
  request: typeof fetch = fetch,
) {
  const sha = SHA.parse(env.VERCEL_GIT_COMMIT_SHA);
  if (env.VERCEL_GIT_COMMIT_REF !== 'main')
    throw new Error('production_branch_required');
  const token = env.VULPES_GITHUB_READ_TOKEN;
  if (!token) throw new Error('deployment_verification_credential_missing');
  async function get(endpoint: string): Promise<unknown> {
    const response = await request(
      `https://api.github.com/repos/${repository}/${endpoint}`,
      {
        headers: {
          Accept: 'application/vnd.github+json',
          Authorization: `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28',
        },
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) throw new Error('deployment_verification_unavailable');
    return response.json();
  }
  const branch = z
    .object({ object: z.object({ sha: SHA }) })
    .parse(await get('git/ref/heads/main'));
  if (branch.object.sha !== sha) throw new Error('deployment_commit_not_main');
  const runs = z
    .object({ workflow_runs: z.array(Run) })
    .parse(
      await get(
        `actions/workflows/ci.yml/runs?event=push&head_sha=${sha}&per_page=100`,
      ),
    );
  // GitHub orders runs newest first. Do not fall back to an older successful run
  // when the current run or its latest attempt failed or is still pending.
  const run = runs.workflow_runs.find(
    (r) =>
      r.head_sha === sha &&
      r.head_branch === 'main' &&
      r.event === 'push' &&
      r.path === '.github/workflows/ci.yml',
  );
  if (!run || run.status !== 'completed' || run.conclusion !== 'success')
    throw new Error('deployment_ci_not_verified');
  const jobs = z
    .object({
      total_count: z.number().int().nonnegative(),
      jobs: z.array(
        z.object({
          name: z.string(),
          head_sha: SHA,
          status: z.string(),
          conclusion: z.string().nullable(),
        }),
      ),
    })
    .parse(
      await get(
        `actions/runs/${run.id}/attempts/${run.run_attempt}/jobs?per_page=100`,
      ),
    );
  if (
    jobs.total_count !== jobs.jobs.length ||
    deploymentChecks.some(
      (name) =>
        !jobs.jobs.some(
          (j) =>
            j.name === name &&
            j.head_sha === sha &&
            j.status === 'completed' &&
            j.conclusion === 'success',
        ),
    )
  )
    throw new Error('deployment_checks_not_verified');
  // Catch a newer merge while querying CI. The next approved deployment should
  // use the newly verified head rather than silently roll production backwards.
  const current = z
    .object({ object: z.object({ sha: SHA }) })
    .parse(await get('git/ref/heads/main'));
  if (current.object.sha !== sha) throw new Error('deployment_commit_not_main');
  return { commit: sha, ciRun: run.id, ciAttempt: run.run_attempt };
}

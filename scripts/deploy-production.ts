import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { setTimeout } from 'node:timers/promises';
import { z } from 'zod';
import { verifyProductionCommit } from './deployment-integrity.js';

const project = 'prj_k4kQU4k9DVnjskslngj7QbYA7zvW';
const repoId = 1425927980;
const Event = z.object({
  repository: z.object({ full_name: z.literal('edumarcano/vulpes-health') }),
  workflow_run: z.object({
    id: z.number().int().positive(),
    run_attempt: z.number().int().positive(),
    head_sha: z.string().regex(/^[a-f0-9]{40}$/),
    head_branch: z.literal('main'),
    event: z.literal('push'),
    path: z.literal('.github/workflows/ci.yml'),
    status: z.literal('completed'),
    conclusion: z.literal('success'),
    head_repository: z.object({
      full_name: z.literal('edumarcano/vulpes-health'),
    }),
  }),
});
const Deployment = z.object({
  id: z.string().regex(/^dpl_[a-zA-Z0-9]+$/),
  projectId: z.literal(project),
  target: z.literal('production'),
  readyState: z.enum([
    'QUEUED',
    'INITIALIZING',
    'BUILDING',
    'READY',
    'ERROR',
    'CANCELED',
  ]),
  meta: z.object({
    githubCommitSha: z.string(),
    githubCommitRef: z.literal('main'),
  }),
});

export async function deployProduction(
  event: unknown,
  env: NodeJS.ProcessEnv,
  request: typeof fetch = fetch,
  pause: () => Promise<unknown> = () => setTimeout(5_000),
) {
  const run = Event.parse(event).workflow_run;
  const token = env.VERCEL_TOKEN;
  const team = z
    .string()
    .regex(/^team_[a-zA-Z0-9]+$/)
    .parse(env.VERCEL_TEAM_ID);
  if (!token) throw new Error('deployment_credential_missing');
  const gateEnv = {
    ...env,
    VERCEL_GIT_COMMIT_SHA: run.head_sha,
    VERCEL_GIT_COMMIT_REF: 'main',
  };
  async function verify() {
    const proof = await verifyProductionCommit(gateEnv, request);
    if (proof.ciRun !== run.id || proof.ciAttempt !== run.run_attempt)
      throw new Error('deployment_ci_attempt_replaced');
    return proof;
  }
  async function vercel(path: string, body?: unknown) {
    const response = await request(
      `https://api.vercel.com/${path}?teamId=${team}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.timeout(30_000),
      },
    );
    if (!response.ok) throw new Error('deployment_api_failed');
    // Promotion can return an empty accepted response. Never log response bodies.
    return response.status === 204
      ? null
      : response.text().then((s) => (s ? (JSON.parse(s) as unknown) : null));
  }
  await verify();
  const created = z.object({ id: Deployment.shape.id }).parse(
    await vercel('v13/deployments', {
      name: 'vulpes-health',
      project,
      target: 'production',
      gitSource: { type: 'github', repoId, ref: 'main', sha: run.head_sha },
      autoAssignCustomDomains: false,
    }),
  );
  for (let poll = 0; poll < 120; poll++) {
    await verify();
    const deployed = Deployment.parse(
      await vercel(`v13/deployments/${created.id}`),
    );
    if (
      deployed.id !== created.id ||
      deployed.meta.githubCommitSha !== run.head_sha
    )
      throw new Error('deployment_source_mismatch');
    if (deployed.readyState === 'ERROR' || deployed.readyState === 'CANCELED')
      throw new Error('deployment_build_failed');
    if (deployed.readyState === 'READY') {
      const proof = await verify();
      await vercel(`v10/projects/${project}/promote/${created.id}`, {});
      return { ...proof, deployment: created.id, promotion: 'requested' };
    }
    await pause();
  }
  throw new Error('deployment_build_timeout');
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    if (process.env.GITHUB_EVENT_NAME !== 'workflow_run')
      throw new Error('deployment_event_required');
    const event: unknown = JSON.parse(
      readFileSync(process.env.GITHUB_EVENT_PATH!, 'utf8'),
    );
    console.info(JSON.stringify(await deployProduction(event, process.env)));
  } catch {
    console.error(
      'Production deployment refused or failed; inspect CI and deployment state.',
    );
    process.exitCode = 1;
  }
}

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
  if (!token || !env.VULPES_GITHUB_READ_TOKEN)
    throw new Error('deployment_credential_missing');
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
      `https://api.vercel.com/${path}${path.includes('?') ? '&' : '?'}teamId=${team}`,
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
  async function github(path: string, body?: unknown) {
    const response = await request(
      `https://api.github.com/repos/edumarcano/vulpes-health/${path}`,
      {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          Authorization: `Bearer ${env.VULPES_GITHUB_READ_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) throw new Error('promotion_journal_unavailable');
    return response.json() as Promise<unknown>;
  }
  const Intent = z.object({
    id: z.number().int().positive(),
    payload: z.object({
      version: z.literal(1),
      deploymentId: Deployment.shape.id,
      after: z.number().nonnegative(),
    }),
  });
  const Project = z.object({
    id: z.literal(project),
    rollingRelease: z.unknown().nullish(),
    targets: z.object({ production: z.object({ id: Deployment.shape.id }) }),
    lastAliasRequest: z
      .object({
        jobStatus: z.string(),
        type: z.string(),
        toDeploymentId: Deployment.shape.id,
        requestedAt: z.number().nonnegative(),
      })
      .nullish(),
  });
  async function projectState() {
    const state = Project.parse(await vercel(`v9/projects/${project}`));
    if (state.rollingRelease)
      throw new Error('promotion_rolling_release_unsupported');
    return state;
  }
  async function complete(intent: z.infer<typeof Intent>) {
    for (let poll = 0; poll < 60; poll++) {
      const state = await projectState();
      const job = state.lastAliasRequest;
      // An accepted POST can precede visibility of its alias job. Never mistake
      // an older success for this intent, even when it targets the same artifact.
      if (job && job.requestedAt > intent.payload.after) {
        if (
          job.type !== 'promote' ||
          job.toDeploymentId !== intent.payload.deploymentId
        )
          throw new Error('promotion_superseded');
        if (job.jobStatus === 'succeeded') {
          const aliases = z
            .object({
              aliases: z
                .array(
                  z.object({
                    status: z.literal('completed'),
                    alias: z.object({
                      alias: z.string(),
                      deploymentId: Deployment.shape.id,
                    }),
                  }),
                )
                .min(1),
              pagination: z.object({ next: z.number().nullish() }),
            })
            .parse(
              await vercel(`v9/projects/${project}/promote/aliases?limit=100`),
            );
          if (
            state.targets.production.id !== intent.payload.deploymentId ||
            aliases.pagination.next != null ||
            !aliases.aliases.some(
              (a) => a.alias.alias === 'vulpes-health.vercel.app',
            ) ||
            aliases.aliases.some(
              (a) => a.alias.deploymentId !== intent.payload.deploymentId,
            )
          )
            throw new Error('promotion_aliases_unverified');
          await github(`deployments/${intent.id}/statuses`, {
            state: 'success',
            auto_inactive: false,
          });
          return;
        }
        if (!['queued', 'pending', 'in-progress'].includes(job.jobStatus))
          throw new Error('promotion_failed');
      }
      await pause();
    }
    throw new Error('promotion_unresolved');
  }
  // A durable intent is written BEFORE the external mutation. Process death,
  // ambiguous responses and timeouts cannot silently release the cross-run fence.
  const previous = z
    .array(Intent)
    .max(1)
    .parse(
      await github(
        'deployments?environment=production&task=vulpes-promote&per_page=1',
      ),
    )[0];
  if (previous) {
    const status = z
      .array(z.object({ state: z.string(), description: z.string().nullish() }))
      .parse(await github(`deployments/${previous.id}/statuses?per_page=1`))[0];
    const manuallyResolved =
      status?.state === 'inactive' &&
      status.description ===
        'Owner verified no pending promotion and consistent production aliases.';
    if (status?.state !== 'success' && !manuallyResolved)
      await complete(previous);
  }
  const initial = await projectState();
  if (
    initial.lastAliasRequest &&
    initial.lastAliasRequest.jobStatus !== 'succeeded'
  )
    throw new Error('promotion_unresolved');
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
      const before = await projectState();
      if (
        before.lastAliasRequest &&
        before.lastAliasRequest.jobStatus !== 'succeeded'
      )
        throw new Error('promotion_unresolved');
      const payload = {
        version: 1,
        deploymentId: created.id,
        after: before.lastAliasRequest?.requestedAt ?? 0,
      };
      const intent = Intent.parse({
        ...z.object({ id: Intent.shape.id }).parse(
          await github('deployments', {
            ref: run.head_sha,
            task: 'vulpes-promote',
            environment: 'production',
            production_environment: true,
            auto_merge: false,
            required_contexts: [],
            payload,
          }),
        ),
        payload,
      });
      await github(`deployments/${intent.id}/statuses`, {
        state: 'in_progress',
        auto_inactive: false,
      });
      await verify();
      await vercel(`v10/projects/${project}/promote/${created.id}`, {});
      await complete(intent);
      await verify();
      return {
        ...proof,
        deployment: created.id,
        promotion: 'succeeded',
        promotionRecord: intent.id,
      };
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

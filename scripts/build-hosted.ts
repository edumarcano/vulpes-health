import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { verifyProductionCommit } from './deployment-integrity.js';
import {
  BuildTargetSchema,
  HostedInferenceModeSchema,
  checkHostedEnvironment,
} from './hosting.js';

export function hostedBuild(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
) {
  const v = parseArgs({
    args,
    strict: true,
    allowPositionals: false,
    options: {
      'project-ref': { type: 'string' },
      'project-id': { type: 'string' },
      'app-origin': { type: 'string' },
      'check-only': { type: 'boolean' },
      mode: { type: 'string' },
    },
  }).values;
  const target = BuildTargetSchema.parse({
    projectRef: v['project-ref'],
    projectId: v['project-id'],
    appOrigin: v['app-origin'],
  });
  if (env.VERCEL_GIT_PROVIDER && env.VERCEL_GIT_COMMIT_REF !== 'main')
    throw new Error('production_branch_required');
  const buildEnv = { ...env };
  // Vite does not use Vercel's automatically public repository/deployment metadata.
  for (const name of Object.keys(buildEnv))
    if (name.startsWith('VITE_VERCEL_')) delete buildEnv[name];
  const checked = checkHostedEnvironment(
    target,
    buildEnv,
    HostedInferenceModeSchema.parse(v.mode ?? 'disabled'),
  );
  if (v['check-only']) return { ...checked, buildRan: false };
  return verifiedBuild(checked, buildEnv);
}
async function verifiedBuild(
  checked: ReturnType<typeof checkHostedEnvironment>,
  env: NodeJS.ProcessEnv,
) {
  const source = spawnSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (source.status !== 0 || source.stdout.trim() !== env.VERCEL_GIT_COMMIT_SHA)
    throw new Error('deployment_source_mismatch');
  const verification = await verifyProductionCommit(env);
  const npm = env.npm_execpath;
  if (!npm) throw new Error('Run with npm run build:hosted.');
  const result = spawnSync(process.execPath, [npm, 'run', 'build'], {
    env,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0)
    throw new Error('hosted_build_failed');
  return { ...checked, ...verification, buildRan: true };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.info(JSON.stringify(await hostedBuild(process.argv.slice(2))));
  } catch {
    console.error(
      'Hosted build refused or failed. Check target identity, approved inference mode and server-only configuration.',
    );
    process.exitCode = 1;
  }
}

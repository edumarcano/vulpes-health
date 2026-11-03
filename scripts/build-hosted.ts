import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
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
  const npm = env.npm_execpath;
  if (!npm) throw new Error('Run with npm run build:hosted.');
  const result = spawnSync(process.execPath, [npm, 'run', 'build'], {
    env: buildEnv,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0)
    throw new Error('hosted_build_failed');
  return { ...checked, buildRan: true };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    console.info(JSON.stringify(hostedBuild(process.argv.slice(2))));
  } catch {
    console.error(
      'Synthetic hosted build refused or failed. Check target identity, approved inference mode and server-only configuration.',
    );
    process.exitCode = 1;
  }
}

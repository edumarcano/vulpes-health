import { parseArgs } from 'node:util';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { verifyHostedSchema } from './schema-compatibility.js';
import {
  BuildTargetSchema,
  HostedInferenceModeSchema,
  checkHostedEnvironment,
} from './hosting.js';

export type HostedBuildStage =
  'configuration' | 'source' | 'schema' | 'application';

// Only reviewed literal codes may reach build logs. Never print arbitrary messages,
// Zod issues, response bodies, environment values or stacks.
const diagnosticCodes = new Set([
  'production_branch_required',
  'deployment_source_missing',
  'hosted_project_mismatch',
  'inference_must_remain_disabled',
  'provider_configuration_forbidden',
  'owner_pilot_inference_unverified',
  'owner_pilot_credential_missing',
  'unexpected_public_configuration',
  'hosted_origin_mismatch',
  'public_authentication_missing',
  'invalid_public_authentication',
  'administrative_key_missing',
  'administrative_key_invalid',
  'trace_keys_invalid',
  'repository_migrations_invalid',
  'hosted_schema_unavailable',
  'hosted_schema_incompatible',
  'hosted_schema_evidence_invalid',
  'hosted_npm_context_missing',
  'hosted_build_failed',
]);
export function hostedBuildDiagnostic(error: unknown, stage: HostedBuildStage) {
  const code =
    error instanceof Error && diagnosticCodes.has(error.message)
      ? error.message
      : 'hosted_build_unexpected';
  return { event: 'hosted_build_failed', stage, code };
}

export function hostedBuild(
  args: string[],
  env: NodeJS.ProcessEnv = process.env,
  onStage: (stage: HostedBuildStage) => void = () => {},
) {
  onStage('configuration');
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
  return verifiedBuild(checked, buildEnv, onStage);
}
async function verifiedBuild(
  checked: ReturnType<typeof checkHostedEnvironment>,
  env: NodeJS.ProcessEnv,
  onStage: (stage: HostedBuildStage) => void,
) {
  onStage('source');
  if (env.VERCEL_GIT_COMMIT_REF !== 'main')
    throw new Error('production_branch_required');
  const commit = env.VERCEL_GIT_COMMIT_SHA;
  if (!commit || !/^[a-f0-9]{40}$/.test(commit))
    throw new Error('deployment_source_missing');
  // Vercel owns Git checkout and CI-gated promotion. No GitHub token or local
  // .git directory is needed in its build environment.
  onStage('schema');
  const schema = await verifyHostedSchema(env);
  const npm = env.npm_execpath;
  if (!npm) throw new Error('hosted_npm_context_missing');
  onStage('application');
  const result = spawnSync(process.execPath, [npm, 'run', 'build'], {
    env,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0)
    throw new Error('hosted_build_failed');
  return { ...checked, commit, ...schema, buildRan: true };
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  let stage: HostedBuildStage = 'configuration';
  try {
    console.info(
      JSON.stringify(
        await hostedBuild(process.argv.slice(2), process.env, (next) => {
          stage = next;
          console.info(JSON.stringify({ event: 'hosted_build_check', stage }));
        }),
      ),
    );
  } catch (error) {
    console.error(JSON.stringify(hostedBuildDiagnostic(error, stage)));
    process.exitCode = 1;
  }
}

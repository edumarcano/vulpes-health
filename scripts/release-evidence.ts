import { createHash } from 'node:crypto';
import { spawnSync, spawn } from 'node:child_process';
import {
  readFileSync,
  writeFileSync,
  mkdirSync,
  readdirSync,
  existsSync,
  copyFileSync,
  symlinkSync,
  lstatSync,
  readlinkSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { z } from 'zod';
import { models, getRoleAvailability } from '../server/config/models.js';
import {
  everydayAdapterVersion,
  everydayTemplateVersion,
} from '../server/config/everyday-versions.js';
import { vertexAdapterVersion } from '../server/ai/providers/vertex.js';
import { localEnvironment } from './local-database.js';
import { ANALYSIS_VERSION } from '../shared/analysis.js';
import {
  METRIC_CONTENT_VERSION,
  METRIC_REGISTRY_VERSION,
  RENPHO_ADAPTER_VERSION,
} from '../shared/metrics.js';
import { REFERENCE_RESOLVER_VERSION } from '../shared/references.js';
import { REFERENCE_REGISTRY_VERSION } from '../server/config/metric-references.js';

const root = fileURLToPath(new URL('../', import.meta.url));
let work = path.join(root, '.scratch/pr17-verification');
let records = path.join(root, '.scratch/release-records');
let destination = path.join(root, '.scratch/release-evidence');
let screenshotSource = path.join(root, 'docs/evidence/release');
const legacyChecks = {
  lint: ['run', 'lint'],
  typecheck: ['run', 'typecheck'],
  unit: ['test', '--', '--maxWorkers=2'],
  build: ['run', 'build'],
  bundle: ['run', 'test:bundle'],
  spec: ['run', 'test:spec'],
  start: ['run', 'db:start'],
  reset: ['run', 'db:reset:test'],
  upgrade: ['run', 'test:lifecycle-upgrade', '--', '--allow-disposable-reset'],
  dbLint: ['run', 'db:lint'],
  dbTests: ['run', 'test:db'],
  dbTypes: ['run', 'db:types:check'],
  integration: ['run', 'test:integration'],
  integrationThreads: ['run', 'test:integration', '--', '--pool=threads'],
  cleanup: ['run', 'maintenance:cleanup'],
  restore: ['run', 'backup:verify'],
  executions: ['run', 'test:executions'],
  evaluations: ['run', 'test:evaluations'],
  providers: ['run', 'test:providers'],
  browser: ['run', 'test:e2e'],
  development: ['run', 'test:dev'],
  pwa: ['run', 'test:pwa'],
  stop: ['run', 'db:stop'],
} as const;
export const checks = {
  ...legacyChecks,
  format: ['run', 'format:check'],
  importUpgrade: [
    'run',
    'test:import-upgrade',
    '--',
    '--allow-disposable-reset',
  ],
} as const;
const Check = z.enum(
  Object.keys(checks) as [keyof typeof checks, ...(keyof typeof checks)[]],
);
const Hash = z.string().regex(/^[a-f0-9]{64}$/);
const Candidate = z.string().regex(/^[a-z0-9][a-z0-9-]{0,39}$/);
type ReleaseOptions = {
  version: '0.1.0' | '0.2.0';
  candidate: string | null;
  mode: 'plan' | 'prepare' | 'sync' | 'check' | 'assemble';
  check?: keyof typeof checks;
  systemChrome?: true;
};
let active: ReleaseOptions = {
  version: '0.1.0',
  candidate: null,
  mode: 'assemble',
};
export function releasePaths(
  version: ReleaseOptions['version'],
  candidate: string | null,
) {
  if (version === '0.1.0')
    return {
      work: '.scratch/pr17-verification',
      records: '.scratch/release-records',
      destination: '.scratch/release-evidence',
      screenshotSource: 'docs/evidence/release',
    };
  const name = Candidate.parse(candidate);
  const base = `.scratch/releases/v0.2.0/${name}`;
  return {
    work: `${base}/workspace`,
    records: `${base}/records`,
    destination: `${base}/evidence`,
    screenshotSource: `${base}/screenshots`,
  };
}
function selectedChecks(version = active.version) {
  if (version === '0.1.0') return legacyChecks;
  const { reset: _reset, upgrade: _upgrade, ...safe } = checks;
  void _reset;
  void _upgrade;
  return safe;
}
export function parseReleaseArguments(args: string[]): ReleaseOptions {
  let version: ReleaseOptions['version'] = '0.1.0',
    candidate: string | null = null;
  let mode: ReleaseOptions['mode'] | undefined,
    check: keyof typeof checks | undefined;
  let systemChrome = false;
  const seen = new Set<string>();
  for (const arg of args) {
    const key = arg.split('=')[0]!;
    if (seen.has(key)) throw new Error('Duplicate release option.');
    seen.add(key);
    if (arg.startsWith('--version='))
      version = z.enum(['0.1.0', '0.2.0']).parse(arg.slice(10));
    else if (arg.startsWith('--candidate='))
      candidate = Candidate.parse(arg.slice(12));
    else if (arg === '--system-chrome') systemChrome = true;
    else {
      if (mode) throw new Error('Choose one release evidence mode.');
      if (arg.startsWith('--check=')) {
        mode = 'check';
        check = Check.parse(arg.slice(8));
      } else if (['--plan', '--prepare', '--sync', '--assemble'].includes(arg))
        mode = arg.slice(2) as ReleaseOptions['mode'];
      else throw new Error('Unknown release evidence option.');
    }
  }
  if ((version === '0.2.0') !== (candidate !== null))
    throw new Error(
      'v0.2.0 requires a candidate namespace; legacy commands forbid it.',
    );
  if (check && !Object.hasOwn(selectedChecks(version), check))
    throw new Error(
      'This check is unavailable for the selected release. Use the isolated import/group migration rehearsal.',
    );
  const selectedMode = mode ?? (version === '0.2.0' ? 'plan' : 'assemble');
  if (
    systemChrome &&
    (version !== '0.2.0' ||
      !['plan', 'check', 'assemble'].includes(selectedMode) ||
      (check !== undefined &&
        !['browser', 'development', 'pwa'].includes(check)))
  )
    throw new Error(
      'System Chrome is limited to versioned browser planning, checks and assembly.',
    );
  return {
    version,
    candidate,
    mode: selectedMode,
    ...(check ? { check } : {}),
    ...(systemChrome ? { systemChrome: true as const } : {}),
  };
}
export function releaseCheckInvocation(
  check: keyof typeof checks,
  systemChrome = false,
) {
  const browser = ['browser', 'development', 'pwa'].includes(check);
  return {
    command: [
      ...checks[check],
      ...(systemChrome && check !== 'pwa' && browser
        ? ['--', '--system-chrome']
        : []),
    ],
    ...(browser
      ? {
          browserChannel: systemChrome
            ? ('chrome' as const)
            : ('chromium' as const),
        }
      : {}),
    ...(systemChrome && check === 'pwa'
      ? { environment: { VULPES_TEST_BROWSER_CHANNEL: 'chrome' as const } }
      : {}),
  };
}
function plannedChecks() {
  return Object.fromEntries(
    Object.keys(selectedChecks()).map((name) => {
      const check = Check.parse(name);
      return [name, releaseCheckInvocation(check, active.systemChrome).command];
    }),
  );
}
const proofKeys = [
  'actualProviderRequests',
  'providerRequests',
  'actualSpendUSD',
  'inferenceSpendUSD',
  'admitted',
  'prepared',
  'budgetDenied',
  'transportRequests',
  'capturedBytesEqual',
  'bodyBytes',
  'heldUSD',
  'conservativeUSD',
  'correctedUSD',
  'encryptedArchive',
  'maximumBackupDays',
  'schemaFunctionsGrantsRlsOwners',
  'rowAndStorageInventory',
  'currentAndRetainedKeys',
  'missingKeyAndTamperDenied',
  'postBackupDeletionApplied',
  'currentIndependentJournalRequired',
  'restoredSessionsRevoked',
  'authPasswordRecovery',
  'twoOwnerIsolation',
  'operatorAssistedRecovery',
  'removed',
  'expired',
  'batches',
  'goalWork',
  'runWork',
  'interrupted',
  'conservative',
  'runsRemoved',
  'receiptsRemoved',
  'deletionsResumed',
  'pendingDeletions',
  'unfinished',
  'exportArtifactsRemoved',
  'expiredBackupsRemoved',
  'batchLimit',
  'maxBatches',
  'maxDeletionSteps',
] as const;
const ProofSchema = z.partialRecord(
  z.enum(proofKeys),
  z.union([
    z.boolean(),
    z.number().finite(),
    z
      .string()
      .regex(/^\d+(?:\.\d+)?$/)
      .max(40),
  ]),
);
export const RecordSchema = z
  .strictObject({
    check: Check,
    releaseVersion: z.literal('0.2.0').optional(),
    candidate: Candidate.optional(),
    bindingSHA256: Hash.optional(),
    command: z.array(z.string()).min(2).max(8).optional(),
    browserChannel: z.enum(['chromium', 'chrome']).optional(),
    sourceRevision: z.string().regex(/^[a-f0-9]{40}$/),
    sourceDigest: Hash,
    workspaceDigest: Hash,
    startedAt: z.iso.datetime(),
    endedAt: z.iso.datetime(),
    exitCode: z.number().int().nullable(),
    status: z.enum(['passed', 'failed']),
    outputSHA256: Hash,
    outputBytes: z.number().int().nonnegative(),
    summary: z.array(z.string().max(160)).max(20),
    proof: ProofSchema.optional(),
  })
  .superRefine((r, c) => {
    if (r.command || r.browserChannel) {
      const invocation = releaseCheckInvocation(
        r.check,
        r.browserChannel === 'chrome',
      );
      if (
        JSON.stringify(r.command) !== JSON.stringify(invocation.command) ||
        r.browserChannel !== invocation.browserChannel
      )
        c.addIssue({
          code: 'custom',
          message: 'Command and browser channel must match the named check.',
        });
    }
    if (
      r.releaseVersion === '0.2.0'
        ? !r.candidate || !r.bindingSHA256
        : r.candidate !== undefined || r.bindingSHA256 !== undefined
    )
      c.addIssue({
        code: 'custom',
        message: 'Versioned records require a complete candidate binding.',
      });
    if ((r.exitCode === 0) !== (r.status === 'passed'))
      c.addIssue({
        code: 'custom',
        message: 'Exit status disagrees with outcome.',
      });
    if (r.summary.some((s) => !outputSummary(s).includes(s)))
      c.addIssue({ code: 'custom', message: 'Unsafe summary.' });
  });
export function sha(bytes: Buffer | string) {
  return createHash('sha256').update(bytes).digest('hex');
}
// Deliberately publish only numeric runner summaries. Never echo arbitrary test/service output.
export function outputSummary(output: string) {
  const clean = output.replace(
    new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g'),
    '',
  );
  const rows = clean
    .split(/\r?\n/)
    .map((line) => line.trim())
    .flatMap((line) => {
      if (
        /^(?:Test Files|Tests)\s+\d+ (?:passed|failed|skipped)(?: \|\s*\d+ (?:passed|failed|skipped))* \(\d+\)$/.test(
          line,
        ) ||
        /^\d+ (?:passed|failed|skipped)(?: \([\d.ms ]+\))?$/.test(line) ||
        /^All \d+ checks passed\.$/.test(line)
      )
        return [line];
      const db = line.match(/^Files=(\d+), Tests=(\d+)(?:,|$)/);
      if (db) return [`Files=${db[1]}, Tests=${db[2]}`];
      const spec = line.match(
        /^(?:PASS: )?(\d+) specification and fixture checks passed$/,
      );
      return spec ? [`${spec[1]} specification and fixture checks passed`] : [];
    });
  return [...new Set(rows)].slice(-20);
}
export function safeProof(output: string) {
  try {
    const start = output.indexOf('{'),
      end = output.lastIndexOf('}');
    if (start < 0) return {};
    const value = JSON.parse(output.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
    return ProofSchema.parse(
      Object.fromEntries(
        proofKeys.filter((k) => k in value).map((k) => [k, value[k]]),
      ),
    );
  } catch {
    return {};
  }
}
function git(args: string[]) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  if (r.status !== 0) throw new Error('Git identity unavailable.');
  return r.stdout.trim();
}
function files(dir: string, base = dir): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isSymbolicLink()) throw new Error('Source symlinks are unsupported.');
    return e.isDirectory()
      ? files(p, base)
      : [path.relative(base, p).replaceAll('\\', '/')];
  });
}
function executableFiles(base = root) {
  return [
    ...[
      'src',
      'server',
      'shared',
      'api',
      'scripts',
      'tests',
      'supabase/migrations',
      'supabase/tests',
      'public',
    ].flatMap((p) => files(path.join(base, p)).map((f) => `${p}/${f}`)),
    ...[
      'package.json',
      'package-lock.json',
      'vite.config.ts',
      'playwright.config.ts',
      'vitest.config.ts',
      'vitest.integration.config.ts',
      'vercel.json',
      'index.html',
      'eslint.config.js',
      '.prettierignore',
      'supabase/config.toml',
      '.env.example',
      '.github/workflows/ci.yml',
    ],
    ...readdirSync(base).filter((f) => /^tsconfig.*\.json$/.test(f)),
    ...files(path.join(base, 'docs/spec/v0.1.0')).map(
      (f) => `docs/spec/v0.1.0/${f}`,
    ),
    ...(active.version === '0.2.0'
      ? [
          ...files(path.join(base, 'docs/spec/v0.2.0')).map(
            (f) => `docs/spec/v0.2.0/${f}`,
          ),
          'docs/evidence/v0.2.0/acceptance-map.json',
          ...files(path.join(base, 'docs/operations')).map(
            (f) => `docs/operations/${f}`,
          ),
          'README.md',
          'AGENTS.md',
          'CHANGELOG.md',
          'docs/V0.2.0_RELEASE_PLAN.md',
          'docs/DECISIONS_IMPLEMENTATION.md',
        ]
      : []),
  ].sort();
}
function digest(base: string, list: string[]) {
  return sha(
    list
      .map((f) => `${f}\0${sha(readFileSync(path.join(base, f)))}\n`)
      .join(''),
  );
}
const legacyReplacements = [
  ['vulpes-health-pr03-test', 'vulpes-health-pr17-test'],
  ['54321', '27421'],
  ['54322', '27422'],
  ['54320', '27420'],
  ['5173', '25173'],
] as const;
function substitutions(): readonly (readonly [string, string])[] {
  if (active.version === '0.1.0') return legacyReplacements;
  return [
    ['54321', '28621'],
    ['54322', '28622'],
    ['54320', '28620'],
    ['5173', '26173'],
    ['4173', '24173'],
    ['4175', '24175'],
    ['3001', '23001'],
    ['vulpes-health-pr03-test', `vulpes-health-v020-${active.candidate}-test`],
    ['vulpes-health-pr17-test', `vulpes-health-v020-${active.candidate}-test`],
  ];
}
const WorkspaceMarker = z.strictObject({
  schemaVersion: z.literal(1),
  releaseVersion: z.literal('0.2.0'),
  candidate: Candidate,
  syntheticOnly: z.literal(true),
  projectId: z.string(),
  ports: z.strictObject({
    api: z.literal(28621),
    database: z.literal(28622),
    shadow: z.literal(28620),
  }),
  sourceDigest: Hash,
});
export function assertVersionedWorkspace(input: {
  workspace: string;
  sourceRoot: string;
  candidate: string;
  config: string;
  marker: unknown;
  linkedProject: boolean;
  sourceDigest: string;
  environmentFiles?: readonly string[];
}) {
  const expected = path.resolve(
    input.sourceRoot,
    releasePaths('0.2.0', input.candidate).work,
  );
  const marker = WorkspaceMarker.parse(input.marker);
  const projectId = `vulpes-health-v020-${input.candidate}-test`;
  const section = (name: string) =>
    input.config.split(`[${name}]`)[1]?.split(/\n\s*\[/)[0] ?? '';
  if (
    path.resolve(input.workspace) !== expected ||
    marker.candidate !== input.candidate ||
    marker.projectId !== projectId ||
    marker.sourceDigest !== input.sourceDigest ||
    input.linkedProject ||
    input.environmentFiles?.some(
      (file) => file !== '.env.example' && /^\.env(?:\.|$)/i.test(file),
    ) ||
    !new RegExp(`^project_id\\s*=\\s*"${projectId}"\\s*$`, 'm').test(
      input.config,
    ) ||
    !/^port\s*=\s*28621\s*$/m.test(section('api')) ||
    !/^port\s*=\s*28622\s*$/m.test(section('db')) ||
    !/^shadow_port\s*=\s*28620\s*$/m.test(section('db')) ||
    /^(?:port|shadow_port)\s*=\s*(?:5432[012]|2842[012])\s*$/m.test(
      input.config,
    )
  )
    throw new Error(
      'Refusing an unexpected or stale synthetic candidate workspace.',
    );
}
function assertWorkspacePath() {
  if (active.version !== '0.2.0') return;
  const relative = path.relative(root, work);
  let current = root;
  for (const segment of relative.split(path.sep)) {
    current = path.join(current, segment);
    if (existsSync(current) && lstatSync(current).isSymbolicLink())
      throw new Error('Candidate workspace ancestors must not be links.');
  }
}
function prepare(refresh = false) {
  assertWorkspacePath();
  const dependencies = path.join(work, 'node_modules');
  if (
    active.version === '0.2.0' &&
    existsSync(dependencies) &&
    (!lstatSync(dependencies).isSymbolicLink() ||
      path.resolve(work, readlinkSync(dependencies)) !==
        path.join(root, 'node_modules'))
  )
    throw new Error(
      'Candidate dependencies must link to the installed project dependencies. Inspect the existing path before preparing.',
    );
  if (refresh && active.version === '0.2.0') {
    const marker = WorkspaceMarker.parse(
      JSON.parse(
        readFileSync(path.join(work, '.release-workspace.json'), 'utf8'),
      ),
    );
    assertVersionedWorkspace({
      workspace: work,
      sourceRoot: root,
      candidate: active.candidate!,
      config: readFileSync(path.join(work, 'supabase/config.toml'), 'utf8'),
      marker,
      linkedProject: existsSync(path.join(work, 'supabase/.temp/project-ref')),
      sourceDigest: marker.sourceDigest,
      environmentFiles: readdirSync(work),
    });
  }
  if (existsSync(work) && !refresh)
    throw new Error(
      'Disposable workspace already exists; inspect it and use --sync to copy a changed candidate without resetting data.',
    );
  if (
    active.version === '0.1.0' &&
    refresh &&
    !readFileSync(path.join(work, 'supabase/config.toml'), 'utf8').includes(
      'vulpes-health-pr17-test',
    )
  )
    throw new Error('Unexpected workspace.');
  mkdirSync(work, { recursive: true });
  const list = git([
    'ls-files',
    '--cached',
    '--others',
    '--exclude-standard',
    '-z',
  ])
    .split('\0')
    .filter(Boolean);
  for (const f of list) {
    if (
      f.startsWith('.git/') ||
      (f !== '.env.example' && /(^|\/)\.env(?:\.|$)/.test(f)) ||
      f.startsWith('supabase/.temp/')
    )
      continue;
    const from = path.join(root, f);
    if (!existsSync(from)) continue;
    if (lstatSync(from).isSymbolicLink())
      throw new Error('Unexpected source link.');
    const to = path.join(work, f);
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(from, to);
    if (/\.(ts|tsx|json|toml|md)$/.test(f)) {
      let text = readFileSync(to, 'utf8');
      for (const [a, b] of substitutions()) text = text.replaceAll(a, b);
      writeFileSync(to, text);
    }
  }
  if (active.version === '0.2.0') {
    writeFileSync(
      path.join(work, '.release-workspace.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          releaseVersion: active.version,
          candidate: active.candidate,
          syntheticOnly: true,
          projectId: `vulpes-health-v020-${active.candidate}-test`,
          ports: { api: 28621, database: 28622, shadow: 28620 },
          sourceDigest: digest(root, executableFiles()),
        },
        null,
        2,
      ) + '\n',
    );
    assertCopy();
  }
  if (!existsSync(dependencies))
    symlinkSync(
      path.join(root, 'node_modules'),
      dependencies,
      process.platform === 'win32' ? 'junction' : 'dir',
    );
  console.info(
    'Prepared isolated synthetic workspace; retained M3 database and allocations unchanged.',
  );
}
function identity() {
  const list = executableFiles();
  return {
    sourceRevision: git(['rev-parse', 'HEAD']),
    sourceDigest: digest(root, list),
    workspaceDigest: digest(work, list),
  };
}
function candidateBinding(current: ReturnType<typeof identity>) {
  return {
    releaseVersion: active.version,
    candidate: active.candidate,
    sourceRevision: current.sourceRevision,
    sourceDigest: current.sourceDigest,
    acceptanceMapSHA256: sha(
      readFileSync(path.join(root, 'docs/evidence/v0.2.0/acceptance-map.json')),
    ),
    versions: {
      template: everydayTemplateVersion,
      everydayAdapter: everydayAdapterVersion,
      vertexAdapter: vertexAdapterVersion,
      analysis: ANALYSIS_VERSION,
      metricRegistry: METRIC_REGISTRY_VERSION,
      metricContent: METRIC_CONTENT_VERSION,
      importAdapter: RENPHO_ADAPTER_VERSION,
      referenceResolver: REFERENCE_RESOLVER_VERSION,
      referenceRegistry: REFERENCE_REGISTRY_VERSION,
    },
    files: Object.fromEntries(
      [
        'server/config/models.ts',
        'server/config/metric-references.ts',
        'server/ai/prompts/everyday.ts',
        'shared/agent-tools.ts',
        'server/ai/tools.ts',
        'package.json',
        'package-lock.json',
      ].map((file) => [file, sha(readFileSync(path.join(root, file)))]),
    ),
    modelChoice: 'pending',
    inferenceApproval: 'pending',
  };
}
function versionedIdentity(current: ReturnType<typeof identity>) {
  return active.version === '0.2.0'
    ? {
        releaseVersion: '0.2.0' as const,
        candidate: active.candidate!,
        bindingSHA256: sha(JSON.stringify(candidateBinding(current))),
      }
    : {};
}
function assertCopy() {
  assertWorkspacePath();
  const config = readFileSync(path.join(work, 'supabase/config.toml'), 'utf8');
  if (active.version === '0.2.0') {
    assertVersionedWorkspace({
      workspace: work,
      sourceRoot: root,
      candidate: active.candidate!,
      config,
      marker: JSON.parse(
        readFileSync(path.join(work, '.release-workspace.json'), 'utf8'),
      ),
      linkedProject: existsSync(path.join(work, 'supabase/.temp/project-ref')),
      sourceDigest: digest(root, executableFiles()),
      environmentFiles: readdirSync(work),
    });
    if (
      JSON.stringify(executableFiles(work)) !==
      JSON.stringify(executableFiles())
    )
      throw new Error(
        'Candidate executable file inventory differs; inspect stale or missing files before checking.',
      );
  } else if (
    !config.includes('vulpes-health-pr17-test') ||
    !config.includes('27421') ||
    existsSync(path.join(work, 'supabase/.temp/project-ref'))
  )
    throw new Error('Refusing an unexpected verification workspace.');
  // Verify every executable byte, permitting only the documented local harness substitutions.
  for (const f of executableFiles()) {
    const original = readFileSync(path.join(root, f));
    let expected = original;
    if (/\.(ts|tsx|json|toml|md)$/.test(f)) {
      let text = original.toString();
      for (const [a, b] of substitutions()) text = text.replaceAll(a, b);
      expected = Buffer.from(text);
    }
    if (!expected.equals(readFileSync(path.join(work, f))))
      throw new Error(
        'Verification copy differs from the candidate. Reconcile it before running checks.',
      );
  }
}
async function run(check: keyof typeof checks) {
  assertCopy();
  const before = identity();
  const namespace = versionedIdentity(before);
  mkdirSync(records, { recursive: true });
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error('Use npm run evidence:release.');
  const startedAt = new Date().toISOString();
  const invocation = releaseCheckInvocation(check, active.systemChrome);
  const chunks: Buffer[] = [];
  let size = 0;
  const child = spawn(process.execPath, [npm, ...invocation.command], {
    cwd: work,
    env: {
      ...localEnvironment(),
      VULPES_LIVE_AI_ENABLED: 'false',
      ...('environment' in invocation ? invocation.environment : {}),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  for (const stream of [child.stdout, child.stderr])
    stream.on('data', (b: Buffer) => {
      size += b.length;
      if (size > 16 * 1024 * 1024) child.kill();
      else chunks.push(b);
    });
  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', resolve);
  });
  const output = Buffer.concat(chunks);
  const stable = JSON.stringify(identity()) === JSON.stringify(before);
  const record = RecordSchema.parse({
    check,
    command: invocation.command,
    ...(invocation.browserChannel
      ? { browserChannel: invocation.browserChannel }
      : {}),
    ...before,
    ...namespace,
    startedAt,
    endedAt: new Date().toISOString(),
    exitCode: stable ? exitCode : null,
    status: stable && exitCode === 0 ? 'passed' : 'failed',
    outputSHA256: sha(output),
    outputBytes: size,
    summary: outputSummary(output.toString()),
    proof: safeProof(output.toString()),
  });
  const filename = `${check}-${Date.now()}.json`;
  writeFileSync(
    path.join(records, filename),
    JSON.stringify(record, null, 2) + '\n',
  );
  // Full output stays ignored and local. It may contain credentials; never upload it.
  writeFileSync(path.join(records, filename + '.private-output'), output, {
    mode: 0o600,
  });
  console.info(JSON.stringify(record, null, 2));
  if (record.status === 'failed') process.exitCode = 1;
}
export function currentOutcome(
  history: z.infer<typeof RecordSchema>[],
  check: keyof typeof checks,
  current: {
    sourceDigest: string;
    workspaceDigest: string;
    sourceRevision?: string;
    releaseVersion?: '0.2.0';
    candidate?: string;
    bindingSHA256?: string;
    browserChannel?: 'chromium' | 'chrome';
  },
) {
  const rows = history
    .filter(
      (r) =>
        r.check === check &&
        r.sourceDigest === current.sourceDigest &&
        r.workspaceDigest === current.workspaceDigest &&
        (!['browser', 'development', 'pwa'].includes(check) ||
          (r.browserChannel ?? (r.releaseVersion ? null : 'chromium')) ===
            (current.browserChannel ?? 'chromium')) &&
        ((!current.releaseVersion && !r.releaseVersion) ||
          (current.releaseVersion === '0.2.0' &&
            r.releaseVersion === current.releaseVersion &&
            r.candidate === current.candidate &&
            r.bindingSHA256 === current.bindingSHA256 &&
            r.sourceRevision === current.sourceRevision)),
    )
    .sort((a, b) => a.endedAt.localeCompare(b.endedAt));
  return rows.at(-1)?.status ?? 'not_run';
}
const AssessmentRowSchema = z.strictObject({
  id: z.string().regex(/^[A-Z]+-\d{2}$/),
  checks: z.array(Check),
  scope: z.string().min(1),
  external: z.string().min(1).nullable(),
  applicability: z.enum(['required', 'optional_disabled']),
  disposition: z.string().optional(),
});
const VersionedMapSchema = z.strictObject({
  schemaVersion: z.literal(2),
  releaseVersion: z.literal('0.2.0'),
  rows: z.array(AssessmentRowSchema),
});
export function acceptanceRequirements(version: ReleaseOptions['version']) {
  const retained = [
    ...readFileSync(
      path.join(root, 'docs/spec/v0.1.0/ACCEPTANCE_TESTS.md'),
      'utf8',
    ).matchAll(/^\| ([A-Z]+-\d+) \| ([^|]+) \| ([^|]+) \| ([^|]+) \|/gm),
  ].map((row) => ({
    id: row[1]!,
    gate: row[2]!.trim(),
    requirement: row[3]!.trim(),
    expected: row[4]!.trim(),
  }));
  if (version === '0.1.0') return retained;
  return [
    ...[
      ...readFileSync(
        path.join(root, 'docs/spec/v0.2.0/VULPES_V0.2.0_SPEC.md'),
        'utf8',
      ).matchAll(/^\| (AT-\d{2}) \| ([^|]+) \| ([^|]+) \|/gm),
    ].map((row) => ({
      id: row[1]!,
      gate: 'v0.2.0',
      requirement: row[2]!.trim(),
      expected: row[3]!.trim(),
    })),
    ...retained.filter((row) => /^(?:SEC|MOD|COST|TRACE|OPS)-/.test(row.id)),
  ];
}
export function validateAcceptanceMap(
  value: unknown,
  version: ReleaseOptions['version'],
) {
  const rows =
    version === '0.2.0'
      ? VersionedMapSchema.parse(value).rows
      : z.array(AssessmentRowSchema).parse(value);
  const expected = acceptanceRequirements(version);
  if (
    rows.length !== expected.length ||
    new Set(rows.map((row) => row.id)).size !== expected.length ||
    expected.some(
      (requirement) => !rows.some((row) => row.id === requirement.id),
    )
  )
    throw new Error('Acceptance inventory is incomplete.');
  if (
    rows.some((row) =>
      row.checks.some(
        (check) => !Object.hasOwn(selectedChecks(version), check),
      ),
    )
  )
    throw new Error('Unknown or unavailable acceptance evidence check.');
  return rows;
}
function acceptanceMap() {
  return validateAcceptanceMap(
    JSON.parse(
      readFileSync(
        path.join(
          root,
          active.version === '0.2.0'
            ? 'docs/evidence/v0.2.0/acceptance-map.json'
            : 'docs/evidence/release/acceptance-map.json',
        ),
        'utf8',
      ),
    ),
    active.version,
  );
}
const ScreenshotSchema = z.strictObject({
  file: z.string().regex(/^[a-zA-Z0-9_-]+\.png$/),
  sha256: Hash,
  reviewed: z.literal(true),
  description: z.string().min(1),
});
export function validateCandidateScreenshots(
  value: unknown,
  candidate: string,
  bindingSHA256: string,
) {
  const manifest = z
    .strictObject({
      schemaVersion: z.literal(2),
      releaseVersion: z.literal('0.2.0'),
      candidate: Candidate,
      bindingSHA256: Hash,
      items: z.array(ScreenshotSchema),
    })
    .parse(value);
  if (
    manifest.candidate !== candidate ||
    manifest.bindingSHA256 !== bindingSHA256
  )
    throw new Error('Screenshots do not bind this candidate.');
  return manifest.items;
}
function assemble() {
  assertCopy();
  const current = identity();
  const namespace = versionedIdentity(current);
  const history = existsSync(records)
    ? readdirSync(records)
        .filter((f) => f.endsWith('.json'))
        .map((f) =>
          RecordSchema.parse(
            JSON.parse(readFileSync(path.join(records, f), 'utf8')),
          ),
        )
    : [];
  const outcomes = Object.fromEntries(
    Object.keys(selectedChecks()).map((c) => [
      c,
      currentOutcome(history, c as keyof typeof checks, {
        ...current,
        ...namespace,
        browserChannel: active.systemChrome ? 'chrome' : 'chromium',
      }),
    ]),
  );
  const assessment = acceptanceMap();
  const acceptance = acceptanceRequirements(active.version).map((i) => {
    const a = assessment.find((a) => a.id === i.id)!;
    if (a.checks.some((c) => !Check.safeParse(c).success))
      throw new Error('Unknown acceptance evidence.');
    const localStatus =
      a.checks.length === 0
        ? 'not_run'
        : a.checks.some((c) => outcomes[c] === 'failed')
          ? 'failed'
          : a.checks.every((c) => outcomes[c] === 'passed')
            ? 'passed'
            : 'not_run';
    return {
      id: a.id,
      gate: i.gate,
      requirement: i.requirement,
      expected: i.expected,
      environment: `disposable local synthetic; ${active.systemChrome ? 'Chrome' : 'Chromium'} emulation`,
      testedRevision: current.sourceRevision,
      sourceDigest: current.sourceDigest,
      checks: a.checks,
      localScope: a.scope,
      localStatus,
      commands: a.checks.map((c) =>
        active.version === '0.2.0'
          ? `npm run evidence:release -- --version=0.2.0 --candidate=${active.candidate} --check=${c}${active.systemChrome && ['browser', 'development', 'pwa'].includes(c) ? ' --system-chrome' : ''}`
          : `npm ${checks[c].join(' ')}`,
      ),
      artifact: `${path.relative(root, destination).replaceAll('\\', '/')}/m6-local.json#verificationRecords`,
      manualProcedure: a.external
        ? 'docs/operations/release-readiness.md#required-deployment-and-pilot-checklist'
        : null,
      status:
        a.applicability === 'optional_disabled'
          ? 'optional_disabled'
          : localStatus === 'failed'
            ? 'failed'
            : a.external
              ? active.version === '0.2.0'
                ? 'not_run'
                : 'blocked'
              : localStatus,
      remainingConsequence: a.external,
      ...(active.version === '0.2.0'
        ? { externalStatus: a.external ? 'not_run' : 'not_applicable' }
        : {}),
      disposition: a.disposition ?? null,
    };
  });
  const pkg = JSON.parse(readFileSync(path.join(root, 'package.json'), 'utf8'));
  const dependencies = Object.fromEntries(
    Object.keys({ ...pkg.dependencies, ...pkg.devDependencies })
      .sort()
      .map((name) => {
        const file = path.join(root, 'node_modules', name, 'package.json');
        return [name, JSON.parse(readFileSync(file, 'utf8')).version as string];
      }),
  );
  const buildFiles = ['dist', '.build'].flatMap((dir) =>
    existsSync(path.join(work, dir))
      ? files(path.join(work, dir)).map((f) => ({
          path: `${dir}/${f}`,
          sha256: sha(readFileSync(path.join(work, dir, f))),
        }))
      : [],
  );
  const screenshots =
    active.version === '0.2.0' &&
    !existsSync(path.join(screenshotSource, 'screenshots.json'))
      ? []
      : active.version === '0.2.0'
        ? validateCandidateScreenshots(
            JSON.parse(
              readFileSync(
                path.join(screenshotSource, 'screenshots.json'),
                'utf8',
              ),
            ),
            active.candidate!,
            namespace.bindingSHA256!,
          )
        : (JSON.parse(
            readFileSync(
              path.join(screenshotSource, 'screenshots.json'),
              'utf8',
            ),
          ) as Array<{
            file: string;
            sha256: string;
            reviewed: boolean;
            description: string;
          }>);
  for (const s of screenshots)
    if (
      !s.reviewed ||
      sha(readFileSync(path.join(screenshotSource, s.file))) !== s.sha256
    )
      throw new Error('Screenshot review/hash missing.');
  const npm = process.env.npm_execpath;
  if (!npm) throw new Error('Use npm.');
  const measured = spawnSync(process.execPath, [npm, '--version'], {
    cwd: root,
    env: localEnvironment(),
    encoding: 'utf8',
  });
  if (measured.status !== 0 || !/^\d+\.\d+\.\d+$/.test(measured.stdout.trim()))
    throw new Error('npm version unavailable.');
  const report = {
    schemaVersion: active.version === '0.2.0' ? 2 : 1,
    generatedAt: new Date().toISOString(),
    ...current,
    ...namespace,
    ...(active.version === '0.2.0'
      ? { candidateBinding: candidateBinding(current) }
      : {}),
    environment: {
      node: process.version,
      platform: process.platform,
      npm: measured.stdout.trim(),
      declaredPackageManager: pkg.packageManager,
      substitutions: substitutions(),
      browserChannel: active.systemChrome ? 'chrome' : 'chromium',
    },
    releaseReady: false,
    providerRequests: 0,
    externalSpendUSD: '0',
    dependencies,
    buildFiles,
    commands: plannedChecks(),
    outcomes,
    verificationRecords: history,
    acceptance,
    screenshots,
    providers: Object.values(models).map((m) => ({
      role: m.role,
      model: m.modelId,
      adapter:
        m.provider === 'vertex_ai'
          ? vertexAdapterVersion
          : everydayAdapterVersion,
      template: everydayTemplateVersion,
      catalogSHA256: sha(
        readFileSync(path.join(root, 'server/config/models.ts')),
      ),
      priceStatus: m.price.status,
      privacy: m.privacyPolicy,
      production: getRoleAvailability(m.role),
      currentLiveEvidence:
        active.version === '0.1.0' && m.role === 'everyday'
          ? 'see docs/evidence/luna-owner-pilot-live.json'
          : 'not_run',
      historical:
        m.role === 'everyday'
          ? `M3 v3 and partial owner-pilot v4-v6 evidence retained; do not substitute for ${everydayTemplateVersion}`
          : 'none',
    })),
    limitations: [
      'Live provider results and host semantic review are recorded separately; no activation approval.',
      'No hosted routing/CSP/Auth/storage/restore verification.',
      'No physical keyboard/PWA/assistive-technology test.',
      'No human recovery handoff, account invitation or invited pilot.',
      'Formal release and invited-account acceptance remain separate from this local report.',
    ],
    approvedDeviations:
      active.version === '0.2.0'
        ? []
        : ['PR 14 remains deferred and disabled.'],
  };
  mkdirSync(destination, { recursive: true });
  writeFileSync(
    path.join(destination, 'm6-local.json'),
    JSON.stringify(report, null, 2) + '\n',
  );
  console.info(
    JSON.stringify({
      report: `${path.relative(root, destination).replaceAll('\\', '/')}/m6-local.json`,
      acceptanceRows: acceptance.length,
      outcomes,
      releaseReady: false,
    }),
  );
}
async function main() {
  active = parseReleaseArguments(process.argv.slice(2));
  const paths = releasePaths(active.version, active.candidate);
  work = path.join(root, paths.work);
  records = path.join(root, paths.records);
  destination = path.join(root, paths.destination);
  screenshotSource = path.join(root, paths.screenshotSource);
  if (active.mode === 'plan') {
    const assessment = acceptanceMap();
    const current = {
      sourceRevision: git(['rev-parse', 'HEAD']),
      sourceDigest: digest(root, executableFiles()),
      workspaceDigest: '',
    };
    console.info(
      JSON.stringify(
        {
          schemaVersion: 2,
          releaseVersion: active.version,
          candidate: active.candidate,
          mode: 'plan',
          paths,
          workspace: existsSync(work) ? 'present_unverified' : 'not_prepared',
          ...(active.version === '0.2.0'
            ? {
                candidateBinding: candidateBinding(current),
                ...versionedIdentity(current),
              }
            : {}),
          acceptanceRows: assessment.length,
          checks: plannedChecks(),
          browserChannel: active.systemChrome ? 'chrome' : 'chromium',
          ...(active.systemChrome
            ? { pwaEnvironment: { VULPES_TEST_BROWSER_CHANNEL: 'chrome' } }
            : {}),
          external: assessment
            .filter((row) => row.external)
            .map((row) => ({
              id: row.id,
              status: 'not_run',
              reason: row.external,
            })),
          providerRequests: 0,
          externalSpendUSD: '0',
          releaseReady: false,
          guard:
            'Prepare and inspect this isolated synthetic workspace before checks. Reset and the historical empty-stack upgrade are unavailable for v0.2.0; importUpgrade rehearses import/group migrations in temporary databases. No hosted or live-provider check is selected.',
        },
        null,
        2,
      ),
    );
  } else if (active.mode === 'prepare' || active.mode === 'sync')
    prepare(active.mode === 'sync');
  else if (active.mode === 'check') await run(active.check!);
  else assemble();
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  await main().catch(() => {
    console.error(
      'Release evidence failed closed. Inspect local private records; do not publish raw output.',
    );
    process.exitCode = 1;
  });

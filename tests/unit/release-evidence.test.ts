import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import {
  RecordSchema,
  currentOutcome,
  outputSummary,
  safeProof,
  parseReleaseArguments,
  releasePaths,
  assertVersionedWorkspace,
  validateAcceptanceMap,
  acceptanceRequirements,
  validateCandidateScreenshots,
  releaseCheckInvocation,
} from '../../scripts/release-evidence.js';
describe('release evidence integrity', () => {
  const digest = 'a'.repeat(64);
  const current = { sourceDigest: digest, workspaceDigest: digest };
  const row = RecordSchema.parse({
    check: 'unit',
    sourceRevision: 'b'.repeat(40),
    ...current,
    startedAt: '2026-10-30T00:00:00Z',
    endedAt: '2026-10-30T00:01:00Z',
    exitCode: 0,
    status: 'passed',
    outputSHA256: digest,
    outputBytes: 12,
    summary: ['Tests 4 passed (4)'],
  });
  it('does not infer success from missing, stale or different-environment records', () => {
    expect(currentOutcome([], 'unit', current)).toBe('not_run');
    expect(
      currentOutcome([row], 'unit', {
        ...current,
        sourceDigest: 'c'.repeat(64),
      }),
    ).toBe('not_run');
    expect(
      currentOutcome([row], 'unit', {
        ...current,
        workspaceDigest: 'c'.repeat(64),
      }),
    ).toBe('not_run');
  });
  it('keeps a later failure authoritative rather than selecting a green attempt', () => {
    const failed = {
      ...row,
      endedAt: '2026-10-30T00:02:00Z',
      exitCode: 1,
      status: 'failed' as const,
    };
    expect(currentOutcome([row, failed], 'unit', current)).toBe('failed');
    expect(() => RecordSchema.parse({ ...failed, status: 'passed' })).toThrow();
  });
  it('only publishes bounded numeric command output and omits secrets/content', () => {
    expect(
      outputSummary(
        'Authorization: Bearer secret\nprivate synthetic prompt\nTests 4 passed (4)\nTest Files 1 passed (1)\nTests 4 passed (4) token=secret\n',
      ),
    ).toEqual(['Tests 4 passed (4)', 'Test Files 1 passed (1)']);
    expect(outputSummary('Tests 4 passed private content (4)')).toEqual([]);
    expect(() =>
      RecordSchema.parse({
        ...row,
        summary: ['Tests 4 passed private content (4)'],
      }),
    ).toThrow();
    expect(
      safeProof(
        '{"capturedBytesEqual":true,"actualProviderRequests":0,"password":"private"}',
      ),
    ).toEqual({ capturedBytesEqual: true, actualProviderRequests: 0 });
    expect(safeProof('{"actualSpendUSD":"private"}')).toEqual({});
  });

  it('preserves historical default commands and makes the versioned default passive', () => {
    expect(parseReleaseArguments([])).toEqual({
      version: '0.1.0',
      candidate: null,
      mode: 'assemble',
    });
    expect(parseReleaseArguments(['--check=reset'])).toMatchObject({
      version: '0.1.0',
      mode: 'check',
      check: 'reset',
    });
    expect(
      parseReleaseArguments(['--version=0.2.0', '--candidate=integrated']),
    ).toEqual({ version: '0.2.0', candidate: 'integrated', mode: 'plan' });
    expect(
      parseReleaseArguments([
        '--version=0.2.0',
        '--candidate=integrated',
        '--check=importUpgrade',
      ]),
    ).toMatchObject({ check: 'importUpgrade' });
    for (const args of [
      ['--version=0.2.0'],
      ['--candidate=integrated'],
      ['--version=0.2.0', '--candidate=../retained'],
      ['--version=0.2.0', '--candidate=integrated', '--check=reset'],
      ['--version=0.2.0', '--candidate=integrated', '--check=upgrade'],
      ['--prepare', '--assemble'],
      ['--version=0.2.0', '--version=0.1.0'],
    ])
      expect(() => parseReleaseArguments(args)).toThrow();
  });

  it('binds an explicit installed Chrome choice without accepting browser flags on database checks', () => {
    expect(
      parseReleaseArguments([
        '--version=0.2.0',
        '--candidate=integrated',
        '--system-chrome',
        '--check=browser',
      ]),
    ).toMatchObject({ systemChrome: true, check: 'browser' });
    expect(releaseCheckInvocation('browser', true)).toEqual({
      command: ['run', 'test:e2e', '--', '--system-chrome'],
      browserChannel: 'chrome',
    });
    expect(releaseCheckInvocation('pwa', true)).toEqual({
      command: ['run', 'test:pwa'],
      browserChannel: 'chrome',
      environment: { VULPES_TEST_BROWSER_CHANNEL: 'chrome' },
    });
    expect(releaseCheckInvocation('browser')).toEqual({
      command: ['run', 'test:e2e'],
      browserChannel: 'chromium',
    });
    for (const args of [
      ['--system-chrome'],
      [
        '--version=0.2.0',
        '--candidate=integrated',
        '--prepare',
        '--system-chrome',
      ],
      [
        '--version=0.2.0',
        '--candidate=integrated',
        '--check=start',
        '--system-chrome',
      ],
    ])
      expect(() => parseReleaseArguments(args)).toThrow();
    const chrome = RecordSchema.parse({
      ...row,
      check: 'browser',
      ...releaseCheckInvocation('browser', true),
    });
    expect(
      currentOutcome([chrome], 'browser', {
        ...current,
        browserChannel: 'chrome',
      }),
    ).toBe('passed');
    expect(
      currentOutcome([chrome], 'browser', {
        ...current,
        browserChannel: 'chromium',
      }),
    ).toBe('not_run');
    expect(() =>
      RecordSchema.parse({
        ...chrome,
        command: ['run', 'test:e2e', '--', '--unreviewed-endpoint'],
      }),
    ).toThrow();
  });

  it('refuses retained stacks, linked projects, stale bindings and malformed synthetic markers', () => {
    const candidate = 'integrated',
      sourceRoot = path.resolve('synthetic-root');
    const workspace = path.resolve(
      sourceRoot,
      releasePaths('0.2.0', candidate).work,
    );
    const config =
      'project_id = "vulpes-health-v020-integrated-test"\n[api]\nport = 28621\n[db]\nport = 28622\nshadow_port = 28620\n';
    const marker = {
      schemaVersion: 1,
      releaseVersion: '0.2.0',
      candidate,
      syntheticOnly: true,
      projectId: 'vulpes-health-v020-integrated-test',
      ports: { api: 28621, database: 28622, shadow: 28620 },
      sourceDigest: digest,
    };
    const input = {
      workspace,
      sourceRoot,
      candidate,
      config,
      marker,
      linkedProject: false,
      sourceDigest: digest,
    };
    expect(() => assertVersionedWorkspace(input)).not.toThrow();
    for (const patch of [
      { workspace: sourceRoot },
      { linkedProject: true },
      { environmentFiles: ['.env.local'] },
      { sourceDigest: 'c'.repeat(64) },
      { config: config.replace('28621', String(54_320 + 1)) },
      { config: config.replace('28621', '28421') },
      { config: config.replace('28622', '28422') },
      { config: config.replace('28620', '28420') },
      {
        config: config
          .replace('28621', '28622')
          .replace('28622\nshadow', '28621\nshadow'),
      },
      { marker: { ...marker, candidate: 'other' } },
      { marker: { ...marker, syntheticOnly: false } },
      {
        marker: {
          ...marker,
          ports: { api: 28421, database: 28422, shadow: 28420 },
        },
      },
    ])
      expect(() => assertVersionedWorkspace({ ...input, ...patch })).toThrow();
  });

  it('never reuses old or different-candidate evidence to satisfy versioned checks', () => {
    const versioned = {
      ...row,
      releaseVersion: '0.2.0' as const,
      candidate: 'integrated',
      bindingSHA256: digest,
    };
    const binding = {
      ...current,
      sourceRevision: row.sourceRevision,
      releaseVersion: '0.2.0' as const,
      candidate: 'integrated',
      bindingSHA256: digest,
    };
    expect(() =>
      RecordSchema.parse({ ...row, releaseVersion: '0.2.0' }),
    ).toThrow();
    expect(currentOutcome([row], 'unit', binding)).toBe('not_run');
    expect(currentOutcome([versioned], 'unit', current)).toBe('not_run');
    expect(currentOutcome([versioned], 'unit', binding)).toBe('passed');
    for (const patch of [
      { candidate: 'other' },
      { bindingSHA256: 'c'.repeat(64) },
      { sourceRevision: 'c'.repeat(40) },
    ])
      expect(
        currentOutcome([versioned], 'unit', { ...binding, ...patch }),
      ).toBe('not_run');
  });

  it('maps every new acceptance ID and retained security/modularity/control requirement without claiming external acceptance', () => {
    const map: unknown = JSON.parse(
      readFileSync('docs/evidence/v0.2.0/acceptance-map.json', 'utf8'),
    );
    const rows = validateAcceptanceMap(map, '0.2.0');
    expect(rows.filter((row) => row.id.startsWith('AT-'))).toHaveLength(28);
    expect(rows.map((row) => row.id).sort()).toEqual(
      acceptanceRequirements('0.2.0')
        .map((row) => row.id)
        .sort(),
    );
    expect(rows.filter((row) => row.id.startsWith('MOD-'))).toHaveLength(6);
    expect(rows.filter((row) => row.id.startsWith('SEC-'))).toHaveLength(8);
    for (const id of [
      'AT-09',
      'AT-21',
      'AT-22',
      'AT-23',
      'AT-26',
      'AT-27',
      'AT-28',
    ])
      expect(rows.find((row) => row.id === id)?.external).toEqual(
        expect.any(String),
      );
    expect(() =>
      validateAcceptanceMap(
        { schemaVersion: 2, releaseVersion: '0.2.0', rows: rows.slice(1) },
        '0.2.0',
      ),
    ).toThrow();
    expect(() =>
      validateAcceptanceMap(
        {
          schemaVersion: 2,
          releaseVersion: '0.2.0',
          rows: [...rows.slice(1), rows[1]],
        },
        '0.2.0',
      ),
    ).toThrow();
    expect(() =>
      validateAcceptanceMap(
        {
          schemaVersion: 2,
          releaseVersion: '0.2.0',
          rows: rows.map((row) => ({ ...row, checks: ['reset'] })),
        },
        '0.2.0',
      ),
    ).toThrow();
  });

  it('requires fresh candidate-bound screenshots rather than relabeling a historical manifest', () => {
    const item = {
      file: 'synthetic.png',
      sha256: digest,
      reviewed: true,
      description: 'Synthetic result',
    };
    const manifest = {
      schemaVersion: 2,
      releaseVersion: '0.2.0',
      candidate: 'integrated',
      bindingSHA256: digest,
      items: [item],
    };
    expect(
      validateCandidateScreenshots(manifest, 'integrated', digest),
    ).toEqual([item]);
    expect(() =>
      validateCandidateScreenshots([item], 'integrated', digest),
    ).toThrow();
    expect(() =>
      validateCandidateScreenshots(manifest, 'other', digest),
    ).toThrow();
    expect(() =>
      validateCandidateScreenshots(
        { ...manifest, items: [{ ...item, file: '../historical.png' }] },
        'integrated',
        digest,
      ),
    ).toThrow();
  });

  it('runs the real versioned CLI plan without preparing or checking a workspace', () => {
    const candidate = `unit-${randomUUID().slice(0, 8)}`;
    const target = releasePaths('0.2.0', candidate).work;
    expect(existsSync(target)).toBe(false);
    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        'scripts/release-evidence.ts',
        '--version=0.2.0',
        `--candidate=${candidate}`,
        '--plan',
      ],
      { encoding: 'utf8', timeout: 30000 },
    );
    expect(child.status, child.stderr).toBe(0);
    const plan = JSON.parse(child.stdout) as {
      mode: string;
      workspace: string;
      acceptanceRows: number;
      checks: Record<string, unknown>;
      releaseReady: boolean;
      providerRequests: number;
    };
    expect(plan).toMatchObject({
      mode: 'plan',
      workspace: 'not_prepared',
      acceptanceRows: 61,
      releaseReady: false,
      providerRequests: 0,
    });
    expect(plan.checks).toHaveProperty('format');
    expect(plan.checks).toHaveProperty('importUpgrade');
    expect(plan.checks).not.toHaveProperty('reset');
    expect(plan.checks).not.toHaveProperty('upgrade');
    expect(existsSync(target)).toBe(false);
  });

  it('plans exact installed-Chrome browser and PWA invocations through the real passive CLI', () => {
    const candidate = `unit-${randomUUID().slice(0, 8)}`;
    const target = releasePaths('0.2.0', candidate).work;
    const child = spawnSync(
      process.execPath,
      [
        '--import',
        'tsx',
        'scripts/release-evidence.ts',
        '--version=0.2.0',
        `--candidate=${candidate}`,
        '--plan',
        '--system-chrome',
      ],
      { encoding: 'utf8', timeout: 30000 },
    );
    expect(child.status, child.stderr).toBe(0);
    const plan = JSON.parse(child.stdout) as {
      checks: Record<string, string[]>;
      browserChannel: string;
      pwaEnvironment: unknown;
      providerRequests: number;
    };
    expect(plan.browserChannel).toBe('chrome');
    expect(plan.checks.browser).toEqual([
      'run',
      'test:e2e',
      '--',
      '--system-chrome',
    ]);
    expect(plan.checks.pwa).toEqual(['run', 'test:pwa']);
    expect(plan.pwaEnvironment).toEqual({
      VULPES_TEST_BROWSER_CHANNEL: 'chrome',
    });
    expect(plan.providerRequests).toBe(0);
    expect(existsSync(target)).toBe(false);
  }, 30000);
});

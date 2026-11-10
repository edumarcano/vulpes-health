import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { renderSmokeReport, runSmoke } from '../../scripts/provider-smoke.js';
import { matchesSyntheticAnswer } from '../../scripts/live-everyday.js';
import { everydayTemplateVersion } from '../../server/config/everyday-versions.js';

const canary = 'synthetic-credential-canary-not-a-real-key';
async function cli(args: string[], liveSwitch = 'false') {
  const child = spawn(
    process.execPath,
    ['--import', 'tsx', 'scripts/provider-smoke.ts', ...args],
    {
      env: {
        ...process.env,
        VULPES_LIVE_AI_ENABLED: liveSwitch,
        OPENROUTER_API_KEY: canary,
        GOOGLE_APPLICATION_CREDENTIALS: canary,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  let stdout = '';
  let stderr = '';
  child.stdout.on('data', (chunk: Buffer) => {
    stdout += chunk.toString();
  });
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const [code] = await once(child, 'exit');
  expect(stdout + stderr).not.toContain(canary);
  return { code, stdout, stderr };
}

describe('real provider-smoke CLI', () => {
  it('accepts equivalent mathematical-minus spelling without accepting wrong magnitudes or direction', () => {
    for (const text of [
      '69.0 kg; change −0.7 kg',
      '69 kg; change -0.70 kg',
      '69 kg, decreased by 0.7 kg',
    ])
      expect(matchesSyntheticAnswer(text)).toBe(true);
    for (const text of [
      '69.7 kg; change −0.7 kg',
      '69 kg; change −0.8 kg',
      '69 kg, increased by 0.7 kg',
    ])
      expect(matchesSyntheticAnswer(text)).toBe(false);
  });
  it('runs all four synthetic roles with zero provider requests even when the live switch is true', async () => {
    const output = await cli([], 'true');
    expect(output.code).toBe(0);
    const report = JSON.parse(output.stdout.slice(output.stdout.indexOf('{')));
    expect(report.mode).toBe('synthetic');
    expect(report.actualProviderRequests).toBe(0);
    expect(report.inferenceSpendUSD).toBe('0');
    expect(report.rows).toHaveLength(4);
    expect(
      report.rows.map((row: { synthetic: string; liveSmoke: string }) => [
        row.synthetic,
        row.liveSmoke,
      ]),
    ).toEqual(Array.from({ length: 4 }, () => ['passed', 'not_run']));
    expect(
      report.rows.map(
        (row: { availability: { state: string } }) => row.availability.state,
      ),
    ).toEqual(['unavailable', 'unavailable', 'unavailable', 'disabled']);
  });
  it.each([
    [[], 'live_opt_in_required'],
    [['--role=everyday'], 'live_opt_in_required'],
    [['--role=everyday', '--allow-spend'], 'live_opt_in_required'],
    [['--allow-spend', '--max-cost-usd=0.01'], 'live_opt_in_required'],
    [
      ['--role=everyday', '--allow-spend', '--max-cost-usd=0'],
      'invalid_spend_limit',
    ],
    [
      ['--role=everyday', '--allow-spend', '--max-cost-usd=-1'],
      'invalid_spend_limit',
    ],
    [
      ['--role=everyday', '--allow-spend', '--max-cost-usd=1e3'],
      'invalid_spend_limit',
    ],
  ] as Array<[string[], string]>)(
    'denies live mode before transport: %j',
    async (args, expected) => {
      const output = await cli(['--mode=live', ...args]);
      expect(output.code).toBe(1);
      expect(JSON.parse(output.stderr)).toEqual({
        mode: 'blocked',
        code: expected,
        actualProviderRequests: 0,
        inferenceSpendUSD: '0',
      });
    },
  );
  it.each([
    ['false', 'live_ai_disabled'],
    ['true', 'capability_evidence_mismatch'],
    ['TRUE', 'invalid_live_switch'],
  ])(
    'denies fully supplied live flags with switch %s',
    async (liveSwitch, expected) => {
      const output = await cli(
        [
          '--mode=live',
          '--role=everyday',
          '--allow-spend',
          '--max-cost-usd=0.01',
        ],
        liveSwitch,
      );
      expect(output.code).toBe(1);
      expect(JSON.parse(output.stderr).code).toBe(expected);
      expect(JSON.parse(output.stderr).actualProviderRequests).toBe(0);
    },
  );
  it('still requires an attempt after matching synthetic capability evidence, before credential access', async () => {
    vi.resetModules();
    vi.doMock(
      '../../server/config/everyday-verification.js',
      async (importOriginal) => {
        const actual =
          await importOriginal<
            typeof import('../../server/config/everyday-verification.js')
          >();
        return {
          ...actual,
          everydayCapabilityEvidence: {
            ...actual.everydayCapabilityEvidence,
            templateVersion: everydayTemplateVersion,
          },
        };
      },
    );
    const env = new Proxy(
      { VULPES_LIVE_AI_ENABLED: 'true' },
      {
        get(target, key) {
          if (key === 'VULPES_LIVE_AI_ENABLED')
            return target.VULPES_LIVE_AI_ENABLED;
          throw new Error('credential_discovery');
        },
      },
    );
    try {
      const { runSmoke: matchingSmoke } =
        await import('../../scripts/provider-smoke.js');
      await expect(
        matchingSmoke(
          [
            '--mode=live',
            '--role=everyday',
            '--allow-spend',
            '--max-cost-usd=0.01',
          ],
          env,
        ),
      ).rejects.toThrow('verification_attempt_required');
    } finally {
      vi.doUnmock('../../server/config/everyday-verification.js');
      vi.resetModules();
    }
  });
  it.each([
    '--mode=unexpected',
    '--role=unknown',
    '--allow-spend',
    '--unknown-flag',
  ])('rejects malformed or ambiguous invocation %j', async (arg) => {
    const output = await cli([arg]);
    expect(output.code).toBe(1);
    expect(JSON.parse(output.stderr).actualProviderRequests).toBe(0);
  });
  it('never discovers credentials and renders a report without writing files', async () => {
    const env = new Proxy(
      {},
      {
        get() {
          throw new Error('Synthetic mode must not inspect environment.');
        },
      },
    );
    const { report, writeReport } = await runSmoke([], env);
    expect(writeReport).toBe(false);
    if (report.mode !== 'synthetic')
      throw new Error('Expected synthetic report.');
    const text = renderSmokeReport(report);
    expect(text).toContain('not_run');
    expect(text).toContain('disabled: optional_decision_disabled');
    expect(text).toContain('Actual provider requests: **0**');
    expect(text).not.toContain('synthetic-opaque');
    expect(text).not.toContain('mean is');
    const decision = (await runSmoke(['--role=decision'], env)).report;
    if (decision.mode !== 'synthetic')
      throw new Error('Expected synthetic report.');
    expect(decision.rows).toHaveLength(1);
  });
  it('rejects an unverified price before inspecting live credentials', async () => {
    vi.resetModules();
    vi.doMock('../../server/config/models.js', async (importOriginal) => {
      const actual =
        await importOriginal<typeof import('../../server/config/models.js')>();
      return {
        ...actual,
        models: {
          ...actual.models,
          everyday: {
            ...actual.models.everyday,
            price: { status: 'unverified' },
          },
        },
      };
    });
    const env = new Proxy(
      { VULPES_LIVE_AI_ENABLED: 'true' },
      {
        get(target, key) {
          if (key === 'VULPES_LIVE_AI_ENABLED')
            return target.VULPES_LIVE_AI_ENABLED;
          throw new Error('credential_discovery');
        },
      },
    );
    try {
      const { runSmoke: unverifiedSmoke } =
        await import('../../scripts/provider-smoke.js');
      await expect(
        unverifiedSmoke(
          [
            '--mode=live',
            '--role=everyday',
            '--allow-spend',
            '--max-cost-usd=1',
          ],
          env,
        ),
      ).rejects.toThrow('price_unverified');
    } finally {
      vi.doUnmock('../../server/config/models.js');
      vi.resetModules();
    }
  });
});

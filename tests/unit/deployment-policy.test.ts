import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';

const workflow = readFileSync('.github/workflows/ci.yml', 'utf8');
const gate = workflow.split('\n  release_gate:')[1]!;
const script = gate.split('        run: |\n')[1]!.trim();

describe('native production release policy', () => {
  it('allows native Git builds only for main and removes the competing deployment path', () => {
    expect(
      JSON.parse(readFileSync('vercel.json', 'utf8')).git.deploymentEnabled,
    ).toEqual({ '**': false, main: true });
    expect(existsSync('.github/workflows/production.yml')).toBe(false);
    expect(existsSync('scripts/deploy-production.ts')).toBe(false);
  });
  it('gives main push checks separate identities and waits for all required jobs', () => {
    for (const name of [
      'Fast checks',
      'Backend integration checks',
      'Browser integration checks',
    ])
      expect(workflow).toContain(
        `name: \${{ github.event_name == 'push' && 'Main / ${name}' || '${name}' }}`,
      );
    expect(gate).toContain(
      'needs: [fast, backend_integration, browser_integration]',
    );
    expect(gate).toContain(
      "name: ${{ github.event_name == 'push' && 'Main / Release gate' || 'No production release' }}",
    );
    expect(gate).toContain(
      "if: ${{ always() && github.event_name == 'push' && github.ref == 'refs/heads/main' }}",
    );
    for (const [variable, job] of [
      ['FAST_RESULT', 'fast'],
      ['BACKEND_RESULT', 'backend_integration'],
      ['BROWSER_RESULT', 'browser_integration'],
    ])
      expect(gate).toContain(`${variable}: \${{ needs.${job}.result }}`);
    expect(workflow).toContain(
      'github.event.pull_request.number || github.sha',
    );
    expect(gate).not.toContain('secrets.');
  });
  it('executes the actual workflow shell: only three successes authorize release', () => {
    const run = (patch: Record<string, string>) =>
      spawnSync('bash', ['-c', script], {
        env: {
          FAST_RESULT: 'success',
          BACKEND_RESULT: 'success',
          BROWSER_RESULT: 'success',
          ...patch,
        },
        encoding: 'utf8',
      });
    expect(run({}).status).toBe(0);
    for (const variable of ['FAST_RESULT', 'BACKEND_RESULT', 'BROWSER_RESULT'])
      for (const result of ['failure', 'cancelled', 'skipped', '', 'unknown']) {
        const outcome = run({ [variable]: result });
        expect(outcome.error).toBeUndefined();
        expect(outcome.status).not.toBe(0);
      }
  });
});

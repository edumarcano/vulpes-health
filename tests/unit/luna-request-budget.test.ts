import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { claimLunaRequest } from '../../scripts/luna-request-budget.js';

it('refuses the 51st send across concurrent cases and later process restarts', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'luna-request-budget-'));
  try {
    const results = await Promise.allSettled(
      Array.from({ length: 53 }, (_, i) =>
        claimLunaRequest(directory, `case-${i}`),
      ),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(50);
    expect(results.filter((r) => r.status === 'rejected')).toHaveLength(3);
    expect(await readdir(directory)).toHaveLength(50);
    await expect(claimLunaRequest(directory, 'later-case')).rejects.toThrow(
      'suite_request_limit',
    );
  } finally {
    await rm(directory, { recursive: true });
  }
});

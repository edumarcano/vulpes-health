import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { withRecoverySource } from '../helpers/recovery-source.js';
import { captureDatabase } from '../../scripts/recovery-database.js';
import {
  operationsStatusBinding,
  operationsStatusCommand,
  operationsStatusQuery,
} from '../../scripts/operations-status.js';
import { targetHash } from '../../scripts/hosting.js';

it('inspects actual PostgreSQL aggregates and authenticated separate backup bytes without changing the source', async () => {
  await withRecoverySource(async (f) => {
    const captured = await captureDatabase(f.target, f.source, f.keys);
    const archivePath = join(f.root, 'status-backup.enc'),
      copyPath = join(f.root, 'status-copy.enc'),
      manifest = join(f.root, 'status-manifest.json');
    await writeFile(archivePath, captured.archive, { flag: 'wx' });
    await writeFile(copyPath, captured.archive, { flag: 'wx' });
    await writeFile(
      manifest,
      JSON.stringify({ target: f.target, targetSHA256: targetHash(f.target) }),
      { flag: 'wx' },
    );
    const backup = {
      archivePath,
      copyPath,
      keyId: f.keys.keyId,
      backupKeyB64: f.keys.backup.toString('base64'),
      traces: Object.fromEntries(
        [...f.keys.traces.keys].map(([id, key]) => [
          id,
          key.toString('base64'),
        ]),
      ),
    };
    const before = await f.source.snapshot();
    let requests = 0;
    const network: typeof fetch = async (_url, init) => {
      requests++;
      expect(JSON.parse(String(init?.body))).toEqual({
        query: operationsStatusQuery,
        read_only: true,
      });
      return new Response(
        '[' +
          f.sql(
            'begin read only;select row_to_json(s) from (' +
              operationsStatusQuery.replace(/;\s*$/, '') +
              ') s;rollback;',
          ) +
          ']',
        { headers: { 'content-type': 'application/json' } },
      );
    };
    const report = await operationsStatusCommand(
      ['--inspect', '--allow-hosted', '--manifest=' + manifest],
      async () => ({
        accessToken: 'sbp_synthetic',
        backup,
        authorization: {
          purpose: 'synthetic-operations-inspect',
          targetSHA256: targetHash(f.target),
          bindingSHA256: operationsStatusBinding(backup),
          expiresAt: new Date(Date.now() + 3600000).toISOString(),
          approved: true,
        },
      }),
      network,
    );
    expect(report).toMatchObject({
      sourceWrites: 0,
      requests: 1,
      backup: {
        state: 'within_target',
        traceKeyVersionsVerified: 2,
        copiesAuthenticatedEqual: true,
        restoreVerified: false,
      },
      disk: { state: 'unknown' },
      retention: { payloadsDue: 0 },
    });
    expect(requests).toBe(1);
    expect(await f.source.snapshot()).toEqual(before);
    for (const user of f.users)
      expect(JSON.stringify(report)).not.toContain(user.id);
  });
}, 60000);

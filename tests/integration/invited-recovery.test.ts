import { spawnSync } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { withRecoverySource } from '../helpers/recovery-source.js';
import { captureDatabase } from '../../scripts/recovery-database.js';
import { databaseRestoreBinding } from '../../scripts/hosted-database-recovery.js';
import {
  InvitedRecoveryTargetSchema,
  recoveryTargetHash,
} from '../../scripts/recovery-target.js';
import { localEnvironment, projectRoot } from '../../scripts/local-database.js';

it('captures two named personal identities with synthetic data and restores the authenticated invited archive through the CLI', async () => {
  await withRecoverySource(async (f) => {
    const owner = f.users[0]!.id,
      member = f.users[1]!.id,
      target = InvitedRecoveryTargetSchema.parse({
        ...f.target,
        purpose: 'invited-pilot',
        ownerUserId: owner,
        invitedUserIds: [member],
        syntheticPeerUserIds: [],
      });
    f.sql(
      `update auth.users set raw_app_meta_data=raw_app_meta_data || '{"vulpes_data_scope":"invited-pilot"}'::jsonb;`,
    );
    await expect(captureDatabase(f.target, f.source, f.keys)).rejects.toThrow(
      'Synthetic source',
    );
    await expect(
      captureDatabase({ ...target, invitedUserIds: [] }, f.source, f.keys),
    ).rejects.toThrow('identity mismatch');
    const before = await f.source.snapshot(),
      captured = await captureDatabase(target, f.source, f.keys),
      archive = join(f.root, 'invited.vpb'),
      manifest = join(f.root, 'invited.json');
    expect(captured.report).toMatchObject({
      scope: 'invited_pilot_database_capture',
      sourceWrites: 0,
      traceKeyVersions: 2,
    });
    await writeFile(archive, captured.archive, { flag: 'wx' });
    await writeFile(
      manifest,
      JSON.stringify({ target, targetSHA256: recoveryTargetHash(target) }),
      { flag: 'wx' },
    );
    const input = {
      backupKeyB64: f.keys.backup.toString('base64'),
      keyId: f.keys.keyId,
      traces: {
        activeId: f.keys.traces.activeId,
        keys: Object.fromEntries(
          [...f.keys.traces.keys].map(([id, key]) => [
            id,
            key.toString('base64'),
          ]),
        ),
      },
      authorization: {
        purpose: 'invited-pilot-fenced-database-restore',
        targetSHA256: recoveryTargetHash(target),
        bindingSHA256: databaseRestoreBinding(captured.archive, f.image),
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
        approved: true,
      },
    };
    let destination: string | undefined;
    try {
      const cli = spawnSync(
        process.execPath,
        [
          'node_modules/tsx/dist/cli.mjs',
          'scripts/hosted-database-recovery.ts',
          '--restore',
          '--invited-pilot',
          '--allow-fenced-restore',
          '--manifest=' + manifest,
          '--archive=' + archive,
          '--image=' + f.image,
        ],
        {
          cwd: projectRoot,
          env: localEnvironment(),
          input: JSON.stringify(input),
          encoding: 'utf8',
          timeout: 60000,
        },
      );
      expect(cli.status).toBe(0);
      const report = JSON.parse(cli.stdout);
      destination = report.destination;
      expect(report).toMatchObject({
        scope: 'fenced_invited_pilot_database_restore',
        catalogAndRowsMatched: true,
        traceKeyVersions: 2,
        network: 'none',
        publishedPorts: 0,
        restoreAccessAuthorized: false,
      });
      for (const privateValue of [
        owner,
        member,
        input.backupKeyB64,
        ...Object.values(input.traces.keys),
      ])
        expect(cli.stdout + cli.stderr).not.toContain(privateValue);
      expect(
        f
          .run(['inspect', '--format', '{{.State.Running}}', destination!])
          .toString()
          .trim(),
      ).toBe('false');
      expect(await f.source.snapshot()).toEqual(before);
    } finally {
      if (destination) {
        expect(destination).toMatch(/^vulpes-recovery-[a-f0-9]{32}$/);
        f.run(['rm', '-v', destination]);
      }
    }
  });
}, 90000);

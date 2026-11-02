import {
  mkdtemp,
  writeFile,
  mkdir,
  utimes,
  readdir,
  rm,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import {
  cleanupExportArtifacts,
  cleanupBackupArtifacts,
} from '../../scripts/export-artifacts.js';

it('removes only stale known ciphertext artifacts within the bounded temporary inventory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vulpes-artifact-test-'));
  const now = Date.now(),
    old = new Date(now - 25 * 3600_000);
  try {
    for (const name of [
      'vulpes-export-old1',
      'vulpes-account-export-old2',
      'vulpes-account-export-new',
      'unrelated',
      'vulpes-export-unknown',
    ]) {
      const directory = join(root, name);
      await mkdir(directory);
      await writeFile(join(directory, 'data.enc'), 'synthetic ciphertext');
      if (name !== 'vulpes-account-export-new') {
        await utimes(join(directory, 'data.enc'), old, old);
        await utimes(directory, old, old);
      }
    }
    await writeFile(
      join(root, 'vulpes-export-unknown', 'unexpected.txt'),
      'preserve',
    );
    await utimes(join(root, 'vulpes-export-unknown'), old, old);
    expect(await cleanupExportArtifacts(now, root, 1)).toMatchObject({
      removed: 1,
      unfinished: true,
    });
    expect(await cleanupExportArtifacts(now, root, 100)).toMatchObject({
      removed: 1,
    });
    expect((await readdir(root)).sort()).toEqual([
      'unrelated',
      'vulpes-account-export-new',
      'vulpes-export-unknown',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it('physically removes expired known synthetic backup archives without touching other backup layouts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'vulpes-backup-retention-'));
  const now = Date.now(),
    old = new Date(now - 31 * 86400_000);
  try {
    for (const name of [
      'synthetic-1234abcd',
      'synthetic-5678abcd',
      'operator-layout',
    ]) {
      const directory = join(root, name);
      await mkdir(directory);
      await writeFile(
        join(directory, 'database.vpb'),
        'synthetic encrypted archive',
      );
      if (name !== 'synthetic-5678abcd')
        await utimes(join(directory, 'database.vpb'), old, old);
    }
    expect(await cleanupBackupArtifacts(root, now)).toEqual({
      removed: 1,
      unfinished: false,
    });
    expect((await readdir(root)).sort()).toEqual([
      'operator-layout',
      'synthetic-5678abcd',
    ]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

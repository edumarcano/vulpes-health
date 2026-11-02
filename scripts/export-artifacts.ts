import { readdir, lstat, unlink, rmdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Crashes leave ciphertext without a key. Only stale, known private export files are eligible.
export async function cleanupExportArtifacts(
  now = Date.now(),
  root = tmpdir(),
  limit = 100,
) {
  let removed = 0;
  let unfinished = false;
  for (const entry of await readdir(root, { withFileTypes: true })) {
    if (
      !entry.isDirectory() ||
      !/^vulpes-(?:account-)?export-[A-Za-z0-9]+$/.test(entry.name)
    )
      continue;
    const directory = join(root, entry.name);
    const stat = await lstat(directory);
    if (stat.isSymbolicLink() || stat.mtimeMs > now - 24 * 3600_000) continue;
    if (removed >= limit) {
      unfinished = true;
      break;
    }
    const files = await readdir(directory);
    if (files.some((file) => file !== 'data.enc')) continue;
    if (files.length) {
      const file = join(directory, 'data.enc');
      const stored = await lstat(file);
      if (
        !stored.isFile() ||
        stored.isSymbolicLink() ||
        stored.mtimeMs > now - 24 * 3600_000
      )
        continue;
      await unlink(file);
    }
    await rmdir(directory);
    removed++;
  }
  return { removed, unfinished };
}

export async function cleanupBackupArtifacts(
  root: string,
  now = Date.now(),
  limit = 100,
) {
  let removed = 0;
  let unfinished = false;
  const entries = await readdir(root, { withFileTypes: true }).catch(
    (error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    },
  );
  for (const entry of entries) {
    if (!entry.isDirectory() || !/^synthetic-[a-f0-9]{8}$/.test(entry.name))
      continue;
    const directory = join(root, entry.name);
    const stored = join(directory, 'database.vpb');
    const stat = await lstat(stored).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return null;
      throw error;
    });
    if (
      !stat?.isFile() ||
      stat.isSymbolicLink() ||
      stat.mtimeMs > now - 30 * 24 * 3600_000
    )
      continue;
    if (removed >= limit) {
      unfinished = true;
      break;
    }
    await unlink(stored);
    removed++;
    if ((await readdir(directory)).length === 0) await rmdir(directory);
  }
  return { removed, unfinished };
}

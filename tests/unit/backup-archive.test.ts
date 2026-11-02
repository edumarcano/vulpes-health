import { randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import { sealArchive, openArchive } from '../../scripts/backup-archive.js';

it('authenticates a versioned encrypted backup before exposing restore bytes', () => {
  const key = randomBytes(32),
    bytes = Buffer.from('Synthetic PostgreSQL archive');
  const keys = new Map([['test', key]]);
  const sealed = sealArchive(bytes, key, 'test', 'database');
  expect(sealed.includes(bytes)).toBe(false);
  expect(openArchive(sealed, keys, 'database').bytes).toEqual(bytes);
  for (const position of [8, sealed.length - 1, sealed.length - 20]) {
    const tampered = Buffer.from(sealed);
    tampered[position] = tampered[position]! ^ 1;
    expect(() => openArchive(tampered, keys, 'database')).toThrow();
  }
  expect(() => openArchive(sealed, new Map(), 'database')).toThrow();
  expect(() =>
    openArchive(sealed, new Map([['test', randomBytes(32)]]), 'database'),
  ).toThrow();
  expect(() => openArchive(sealed, keys, 'deletion_journal')).toThrow();
});
it('rejects expired backups and stale independently authenticated deletion journals', () => {
  const now = Date.now(),
    key = randomBytes(32),
    keys = new Map([['test', key]]);
  const backup = sealArchive(
    Buffer.from('synthetic'),
    key,
    'test',
    'database',
    now,
  );
  expect(() =>
    openArchive(backup, keys, 'database', now + 30 * 24 * 3600_000),
  ).toThrow();
  const journal = sealArchive(
    Buffer.from('synthetic'),
    key,
    'test',
    'deletion_journal',
    now,
  );
  expect(
    openArchive(
      journal,
      keys,
      'deletion_journal',
      now + 299_000,
    ).bytes.toString(),
  ).toBe('synthetic');
  expect(() =>
    openArchive(journal, keys, 'deletion_journal', now + 300_000),
  ).toThrow();
  expect(() => openArchive(backup, keys, 'database', now - 6000)).toThrow();
});

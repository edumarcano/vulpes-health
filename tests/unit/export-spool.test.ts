import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { expect, it } from 'vitest';
import { Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { stageExport } from '../../server/security/export-spool.js';
import { HttpFailure } from '../../server/http/failure.js';

it('preserves the original conflict when capture fails after writing a partial export', async () => {
  const conflict = new HttpFailure(
    409,
    'data_changed',
    'Synthetic concurrent change.',
  );
  await expect(
    stageExport(
      'synthetic-owner',
      (async function* () {
        yield 'partial synthetic bytes';
        throw conflict;
      })(),
      new AbortController().signal,
    ),
  ).rejects.toBe(conflict);
});

it('decrypts the complete export from the unlinked descriptor and closes it idempotently', async () => {
  const spool = await stageExport(
    'synthetic-owner',
    (async function* () {
      yield 'synthetic private ';
      yield 'export';
    })(),
    new AbortController().signal,
  );
  const chunks: Buffer[] = [],
    encrypted: Buffer[] = [];
  try {
    const stream = spool.open();
    stream.ciphertext.on('data', (chunk: Buffer) => encrypted.push(chunk));
    await pipeline(
      stream.ciphertext,
      stream.decipher,
      new Writable({
        write(chunk: Buffer, _encoding, done) {
          chunks.push(chunk);
          done();
        },
      }),
    );
    expect(Buffer.concat(chunks).toString()).toBe('synthetic private export');
    expect(
      Buffer.concat(encrypted).includes(
        Buffer.from('synthetic private export'),
      ),
    ).toBe(false);
  } finally {
    await spool.cleanup();
    await spool.cleanup();
  }
  expect(() => spool.open()).toThrow('closed');
});

it('leaves no named export artifact when the producing process exits without cleanup', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vulpes-crash-proof-'));
  try {
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', resolve('tests/fixtures/export-crash.ts')],
      {
        env: {
          ...process.env,
          TMPDIR: directory,
          TMP: directory,
          TEMP: directory,
        },
        encoding: 'utf8',
        timeout: 15000,
      },
    );
    expect(result.status, result.stderr).toBe(17);
    expect(
      (await readdir(directory)).filter((n) => n.startsWith('vulpes-')),
    ).toEqual([]);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

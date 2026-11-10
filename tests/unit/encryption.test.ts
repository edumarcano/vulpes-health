import {
  createCipheriv,
  createHash,
  randomBytes,
  randomUUID,
} from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import {
  decryptBytes,
  encryptBytes,
  MAX_PAYLOAD_BYTES,
  readEncryptionKeys,
  type Envelope,
} from '../../server/security/encryption.js';
const key = randomBytes(32);
const ring = {
  activeId: 'synthetic-v1',
  keys: new Map([['synthetic-v1', key]]),
};
const metadata = {
  id: randomUUID(),
  user_id: randomUUID(),
  purpose: 'ai_request' as const,
  expires_at: '2026-11-01T00:00:00Z',
};
const changeFirstByte = (value: string) =>
  `\\x${value.slice(2, 4) === '00' ? '01' : '00'}${value.slice(4)}`;
describe('authenticated private payload encryption', () => {
  it.each([
    Buffer.from('Synthetic UTF-8: fox 🦊\n\u0000 exact bytes'),
    randomBytes(4096),
    Buffer.alloc(0),
  ])('preserves original bytes and uses a fresh nonce', (input) => {
    const one = encryptBytes(metadata, input, ring);
    const two = encryptBytes(metadata, input, ring);
    expect(decryptBytes(one, ring)).toEqual(input);
    expect(decryptBytes(two, ring)).toEqual(input);
    expect(one.nonce).not.toBe(two.nonce);
    expect(one.encrypted_bytes).not.toBe(two.encrypted_bytes);
    if (input.length > 0)
      expect(one.encrypted_bytes).not.toContain(input.toString('utf8'));
  });
  it('rejects altered metadata, ciphertext, nonce, tag and wrong keys', () => {
    const encrypted = encryptBytes(
      metadata,
      Buffer.from('Synthetic bytes'),
      ring,
    );
    for (const patch of [
      { user_id: randomUUID() },
      { id: randomUUID() },
      { purpose: 'tool_input' },
      { payload_version: 2 },
      { expires_at: '2027-01-01T00:00:00Z' },
      { encoding: 'identity' },
      { content_hash: '0'.repeat(64) },
      { nonce: changeFirstByte(encrypted.nonce) },
      { encrypted_bytes: changeFirstByte(encrypted.encrypted_bytes) },
      {
        encrypted_bytes: `${encrypted.encrypted_bytes.slice(0, -2)}${encrypted.encrypted_bytes.endsWith('00') ? '01' : '00'}`,
      },
    ])
      expect(() => decryptBytes({ ...encrypted, ...patch }, ring)).toThrow();
    expect(() =>
      decryptBytes(encrypted, {
        activeId: ring.activeId,
        keys: new Map([[ring.activeId, randomBytes(32)]]),
      }),
    ).toThrow();
    expect(() =>
      decryptBytes(encrypted, { activeId: 'missing', keys: new Map() }),
    ).toThrow();
  });
  it.each(['00', '01', 'ff'])('changes an initial %s byte', (byte) => {
    const value = `\\x${byte}abcd`;
    expect(changeFirstByte(value)).not.toBe(value);
  });
  it('uses the recorded key ID after active-key rotation', () => {
    const encrypted = encryptBytes(
      metadata,
      Buffer.from('Synthetic rotation'),
      ring,
    );
    const rotated = {
      activeId: 'synthetic-v2',
      keys: new Map([...ring.keys, ['synthetic-v2', randomBytes(32)]]),
    };
    expect(decryptBytes(encrypted, rotated).toString()).toBe(
      'Synthetic rotation',
    );
    expect(
      encryptBytes(metadata, Buffer.from('New write'), rotated).key_id,
    ).toBe('synthetic-v2');
  });
  it('rejects oversized input and bounds authenticated gzip expansion', () => {
    expect(() =>
      encryptBytes(metadata, Buffer.alloc(MAX_PAYLOAD_BYTES + 1), ring),
    ).toThrow('size limit');
    for (const length of [MAX_PAYLOAD_BYTES, MAX_PAYLOAD_BYTES + 1]) {
      const expanded = Buffer.alloc(length);
      const header = {
        ...metadata,
        payload_version: 1 as const,
        encoding: 'gzip' as const,
        key_id: ring.activeId,
        content_hash: createHash('sha256').update(expanded).digest('hex'),
        encryption_algorithm: 'aes-256-gcm' as const,
      };
      const nonce = randomBytes(12);
      const cipher = createCipheriv('aes-256-gcm', key, nonce);
      cipher.setAAD(
        Buffer.from(
          JSON.stringify([
            header.id,
            header.user_id,
            header.purpose,
            header.payload_version,
            header.encoding,
            header.key_id,
            header.content_hash,
            new Date(header.expires_at).toISOString(),
          ]),
        ),
      );
      const encrypted = Buffer.concat([
        cipher.update(gzipSync(expanded)),
        cipher.final(),
        cipher.getAuthTag(),
      ]);
      const envelope: Envelope = {
        ...header,
        nonce: `\\x${nonce.toString('hex')}`,
        encrypted_bytes: `\\x${encrypted.toString('hex')}`,
      };
      if (length === MAX_PAYLOAD_BYTES)
        expect(decryptBytes(envelope, ring).equals(expanded)).toBe(true);
      else
        expect(() => decryptBytes(envelope, ring)).toThrow(
          expect.objectContaining({ code: 'ERR_BUFFER_TOO_LARGE' }),
        );
    }
  });
  it('validates key configuration without echoing secret values', () => {
    expect(
      readEncryptionKeys({
        VULPES_TRACE_ENCRYPTION_KEY_ID: 'active',
        VULPES_TRACE_ENCRYPTION_KEY_B64: key.toString('base64'),
      }).keys.get('active'),
    ).toEqual(key);
    for (const env of [
      {},
      {
        VULPES_TRACE_ENCRYPTION_KEY_ID: 'x',
        VULPES_TRACE_ENCRYPTION_KEY_B64: 'synthetic-bad-secret',
      },
      {
        VULPES_TRACE_ENCRYPTION_KEY_ID: 'x',
        VULPES_TRACE_ENCRYPTION_KEY_B64: key.toString('base64'),
        VULPES_TRACE_PREVIOUS_KEYS_JSON: '{"x":"secret"}',
      },
    ])
      expect(() => readEncryptionKeys(env)).toThrow(
        'Private payload encryption is not configured.',
      );
  });
});

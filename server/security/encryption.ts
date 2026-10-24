import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { gzipSync, gunzipSync } from 'node:zlib';
import { z } from 'zod';
import { UUIDSchema, ISOInstantSchema, HashSchema } from '../../shared/primitives.js';

export const MAX_PAYLOAD_BYTES = 4 * 1024 * 1024;
export const PayloadPurposeSchema = z.enum(['ai_request','ai_response','tool_input','tool_output','import_staging','provider_state']);
export type PayloadPurpose = z.infer<typeof PayloadPurposeSchema>;
export const EnvelopeSchema = z.object({
  id: UUIDSchema, user_id: UUIDSchema, purpose: PayloadPurposeSchema, payload_version: z.literal(1),
  encoding: z.enum(['identity','gzip']), key_id: z.string().min(1).max(200), content_hash: HashSchema,
  expires_at: ISOInstantSchema, encryption_algorithm: z.literal('aes-256-gcm'),
  encrypted_bytes: z.string().regex(/^\\x[0-9a-f]+$/).max(2 + MAX_PAYLOAD_BYTES * 2),
  nonce: z.string().regex(/^\\x[0-9a-f]{24}$/),
});
export type Envelope = z.infer<typeof EnvelopeSchema>;
export interface EncryptionKeys { activeId: string; keys: ReadonlyMap<string, Buffer> }
export function readEncryptionKeys(env: NodeJS.ProcessEnv = process.env): EncryptionKeys {
  try {
    const activeId = env.VULPES_TRACE_ENCRYPTION_KEY_ID;
    if (!activeId || activeId.length > 200) throw new Error();
    const previous: unknown = JSON.parse(env.VULPES_TRACE_PREVIOUS_KEYS_JSON ?? '{}');
    if (!previous || typeof previous !== 'object' || Array.isArray(previous) || Object.hasOwn(previous, activeId)) throw new Error();
    const keys = new Map<string, Buffer>();
    for (const [id, value] of [...Object.entries(previous), [activeId, env.VULPES_TRACE_ENCRYPTION_KEY_B64]]) {
      if (!id || id.length > 200 || typeof value !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(value)) throw new Error();
      const decoded = Buffer.from(value, 'base64');
      if (decoded.length !== 32 || decoded.toString('base64') !== value) throw new Error();
      keys.set(id, decoded);
    }
    return { activeId, keys };
  } catch { throw new Error('Private payload encryption is not configured.'); }
}
function aad(envelope: Omit<Envelope, 'encrypted_bytes' | 'nonce'>): Buffer {
  return Buffer.from(JSON.stringify([envelope.id, envelope.user_id, envelope.purpose, envelope.payload_version, envelope.encoding, envelope.key_id, envelope.content_hash, new Date(envelope.expires_at).toISOString()]), 'utf8');
}
export function encryptBytes(metadata: { id: string; user_id: string; purpose: PayloadPurpose; expires_at: string }, bytes: Uint8Array, keyring: EncryptionKeys): Envelope {
  if (bytes.byteLength > MAX_PAYLOAD_BYTES) throw new Error('Private payload exceeds the size limit.');
  const key = keyring.keys.get(keyring.activeId);
  if (!key) throw new Error('Private payload encryption is not configured.');
  const header = { ...metadata, payload_version: 1 as const, encoding: 'gzip' as const, key_id: keyring.activeId, content_hash: createHash('sha256').update(bytes).digest('hex'), encryption_algorithm: 'aes-256-gcm' as const };
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, nonce, { authTagLength: 16 });
  cipher.setAAD(aad(header));
  const encrypted = Buffer.concat([cipher.update(gzipSync(bytes)), cipher.final(), cipher.getAuthTag()]);
  if (encrypted.length > MAX_PAYLOAD_BYTES) throw new Error('Private payload exceeds the size limit.');
  return EnvelopeSchema.parse({ ...header, nonce: `\\x${nonce.toString('hex')}`, encrypted_bytes: `\\x${encrypted.toString('hex')}` });
}
export function decryptBytes(input: unknown, keyring: EncryptionKeys): Buffer {
  const envelope = EnvelopeSchema.parse(input);
  const key = keyring.keys.get(envelope.key_id);
  if (!key) throw new Error('Private payload key is unavailable.');
  const encrypted = Buffer.from(envelope.encrypted_bytes.slice(2), 'hex');
  if (encrypted.length < 16) throw new Error('Private payload is unavailable.');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.nonce.slice(2), 'hex'), { authTagLength: 16 });
  decipher.setAAD(aad(envelope)); decipher.setAuthTag(encrypted.subarray(-16));
  const compressed = Buffer.concat([decipher.update(encrypted.subarray(0,-16)), decipher.final()]);
  const bytes = envelope.encoding === 'gzip' ? gunzipSync(compressed, { maxOutputLength: MAX_PAYLOAD_BYTES }) : compressed;
  if (bytes.length > MAX_PAYLOAD_BYTES || createHash('sha256').update(bytes).digest('hex') !== envelope.content_hash) throw new Error('Private payload is unavailable.');
  return bytes;
}

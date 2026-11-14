import { randomUUID } from 'node:crypto';
import { UUIDSchema, ISOInstantSchema } from '../../shared/primitives.js';
import type { AuthContext } from '../auth/session.js';
import { administrativeClient } from '../db/administrative.js';
import { HttpFailure } from '../http/failure.js';
import {
  decryptBytes,
  encryptBytes,
  PayloadPurposeSchema,
  readEncryptionKeys,
  type PayloadPurpose,
} from './encryption.js';

export async function discardImportPayload(
  context: AuthContext,
  id: string,
): Promise<void> {
  UUIDSchema.parse(id);
  const { error } = await administrativeClient()
    .from('private_payloads')
    .delete()
    .eq('user_id', context.userId)
    .eq('id', id)
    .eq('purpose', 'import_staging');
  if (error)
    throw new HttpFailure(
      503,
      'payload_unavailable',
      'Private staging cleanup is unavailable.',
    );
}
export async function cleanupExpiredPayloads(
  ownerId: string | null = null,
): Promise<number> {
  return (await cleanupExpiredData(ownerId)).payloadsRemoved;
}
export async function cleanupExpiredData(ownerId: string | null = null) {
  if (ownerId !== null) UUIDSchema.parse(ownerId);
  const { data, error } = await administrativeClient().rpc('cleanup_data_v1', {
    ...(ownerId === null ? {} : { p_owner: ownerId }),
    p_batch_size: 100,
  });
  if (
    error ||
    !data ||
    typeof data !== 'object' ||
    Array.isArray(data) ||
    typeof data.payloadsRemoved !== 'number' ||
    typeof data.batchesExpired !== 'number' ||
    typeof data.workCount !== 'number'
  )
    throw new HttpFailure(
      503,
      'payload_unavailable',
      'Private payload cleanup is unavailable.',
    );
  return {
    payloadsRemoved: data.payloadsRemoved,
    batchesExpired: data.batchesExpired,
    workCount: data.workCount,
  };
}
export async function payloadExpiry(purpose: PayloadPurpose): Promise<string> {
  const { data, error } = await administrativeClient().rpc(
    'private_payload_expiry_v1',
    { p_purpose: PayloadPurposeSchema.parse(purpose) },
  );
  const expiry = ISOInstantSchema.safeParse(data);
  if (error || !expiry.success)
    throw new HttpFailure(
      503,
      'payload_unavailable',
      'Private payload expiry could not be verified.',
    );
  return new Date(expiry.data).toISOString();
}
export async function writePayload(
  context: AuthContext,
  purpose: 'import_staging',
  bytes: Uint8Array,
  maximumExpiry?: string,
) {
  const checkedPurpose = PayloadPurposeSchema.parse(purpose);
  const allocatedExpiry = await payloadExpiry(checkedPurpose);
  const expiresAt =
    maximumExpiry === undefined
      ? allocatedExpiry
      : new Date(
          Math.min(
            Date.parse(ISOInstantSchema.parse(maximumExpiry)),
            Date.parse(allocatedExpiry),
          ),
        ).toISOString();
  try {
    const envelope = encryptBytes(
      {
        id: randomUUID(),
        user_id: context.userId,
        purpose: checkedPurpose,
        expires_at: expiresAt,
      },
      bytes,
      readEncryptionKeys(),
    );
    const { data, error } = await administrativeClient().rpc(
      'store_private_payload_v1',
      { p_payload: envelope },
    );
    if (error || data !== envelope.id) throw new Error();
    await cleanupExpiredPayloads(context.userId);
    return { id: envelope.id, expiresAt };
  } catch {
    throw new HttpFailure(
      503,
      'payload_unavailable',
      'Private payload storage is unavailable.',
    );
  }
}
export type PayloadRead =
  | { state: 'available'; bytes: Buffer }
  | { state: 'expired' | 'not_found' | 'unavailable' };
export async function readPayload(
  context: AuthContext,
  id: string,
  expectedPurpose: PayloadPurpose,
  signal?: AbortSignal,
): Promise<PayloadRead> {
  if (
    !UUIDSchema.safeParse(id).success ||
    !PayloadPurposeSchema.safeParse(expectedPurpose).success
  )
    return { state: 'not_found' };
  try {
    signal?.throwIfAborted();
    const query = administrativeClient()
      .from('private_payloads')
      .select('*')
      .eq('user_id', context.userId)
      .eq('id', id)
      .eq('purpose', expectedPurpose);
    const { data, error } = await (
      signal ? query.abortSignal(signal) : query
    ).maybeSingle();
    signal?.throwIfAborted();
    if (error) return { state: 'unavailable' };
    if (!data) return { state: 'not_found' };
    if (Date.parse(data.expires_at) <= Date.now()) return { state: 'expired' };
    const bytes = decryptBytes(data, readEncryptionKeys());
    return { state: 'available', bytes };
  } catch {
    return { state: 'unavailable' };
  }
}

import { CSV_LIMIT_BYTES } from './import-limits.js';

export const HANDOFF_PROTOCOL = 1;
export const SHARE_ACTION = '/api/share-target';
export const HANDOFF_LIFETIME = 15 * 60_000;
export const RECOVERY_LIFETIME = 24 * 60 * 60_000;
export const SHARE_ENVELOPE_LIMIT = CSV_LIMIT_BYTES + 65_536;
export const CLAIM_LIFETIME = 30_000;
const referencePattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function handoffReference(hash: string): string | null {
  const value = hash.startsWith('#handoff=') ? hash.slice(9) : '';
  return referencePattern.test(value) ? value : null;
}

export function importReturnPath(path: string | null, hash = ''): string {
  if (
    !['/ask', '/goals', '/data', '/settings', '/data/import'].includes(
      path ?? '',
    )
  )
    return '/ask';
  return path + (path === '/data/import' && handoffReference(hash) ? hash : '');
}

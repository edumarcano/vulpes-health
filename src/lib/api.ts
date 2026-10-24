import { ErrorEnvelopeSchema } from '../../shared/api';
import type { IdentityScope } from './auth/identity';

export class ApiError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}
export async function ownedJson(path: string, token: string, scope: IdentityScope, expectedEpoch: number, init: RequestInit = {}): Promise<unknown> {
  if (!path.startsWith('/api/')) throw new Error('Invalid application API path.');
  if (scope.epoch !== expectedEpoch || scope.userId === null) throw new DOMException('The account changed.','AbortError');
  const owner = scope.capture();
  try {
    const response = await fetch(path,{ ...init,cache:'no-store',signal:AbortSignal.any([owner.signal,...(init.signal ? [init.signal] : [])]), headers:{ ...init.headers,Authorization:`Bearer ${token}`,...(init.body ? { 'Content-Type':'application/json' } : {}) } });
    const value: unknown = await response.json();
    if (!owner.current()) throw new DOMException('The account changed.','AbortError');
    if (!response.ok) {
      const parsed = ErrorEnvelopeSchema.safeParse(value);
      throw new ApiError(response.status,parsed.success ? parsed.data.error.message : 'The request could not be completed.');
    }
    return value;
  } finally { owner.release(); }
}

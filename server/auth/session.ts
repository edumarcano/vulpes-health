import type { IncomingMessage } from 'node:http';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { publicAuthConfig } from '../../shared/auth.js';
import type { Database } from '../db/database.types.js';
import { HttpFailure } from '../http/failure.js';

export interface AuthContext {
  readonly userId: string;
  readonly db: SupabaseClient<Database>;
}
export function serverAuthConfig(env: NodeJS.ProcessEnv = process.env) {
  try {
    const config = publicAuthConfig(
      env.VITE_SUPABASE_URL,
      env.VITE_SUPABASE_PUBLISHABLE_KEY,
    );
    if (config) return config;
  } catch {
    /* Never expose environment contents. */
  }
  throw new HttpFailure(503, 'auth_unavailable', 'Sign-in is not configured.');
}
export const serverClientOptions = {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
    detectSessionInUrl: false,
  },
  global: {
    fetch: (input: string | URL | Request, init?: RequestInit) =>
      fetch(input, {
        ...init,
        redirect: 'error',
        signal: AbortSignal.any([
          AbortSignal.timeout(10_000),
          ...(init?.signal ? [init.signal] : []),
        ]),
      }),
  },
};
// Only account status and deletion retry may use a verified identity without an active profile.
export async function verifyIdentity(
  request: Pick<IncomingMessage, 'headers'>,
  signal?: AbortSignal,
): Promise<AuthContext & { passwordAt: string | null }> {
  signal?.throwIfAborted();
  const authorization = request.headers.authorization;
  const match =
    typeof authorization === 'string'
      ? /^Bearer ([^\s,]+)$/i.exec(authorization)
      : null;
  if (!match)
    throw new HttpFailure(401, 'unauthorized', 'Sign in to continue.');
  const config = serverAuthConfig();
  const token = match[1]!;
  const db = createClient<Database>(config.url, config.key, {
    ...serverClientOptions,
    global: {
      ...serverClientOptions.global,
      headers: { Authorization: `Bearer ${token}` },
      ...(signal
        ? {
            fetch: (input: string | URL | Request, init?: RequestInit) =>
              serverClientOptions.global.fetch(input, {
                ...init,
                signal: AbortSignal.any([
                  signal,
                  ...(init?.signal ? [init.signal] : []),
                ]),
              }),
          }
        : {}),
    },
  });
  let result;
  try {
    result = await db.auth.getUser(token);
  } catch {
    signal?.throwIfAborted();
    throw new HttpFailure(
      503,
      'auth_unavailable',
      'Sign-in could not be verified. Try again.',
    );
  }
  signal?.throwIfAborted();
  if (result.error || !result.data.user) {
    if (
      result.error &&
      (!('status' in result.error) ||
        !result.error.status ||
        result.error.status >= 500)
    )
      throw new HttpFailure(
        503,
        'auth_unavailable',
        'Sign-in could not be verified. Try again.',
      );
    throw new HttpFailure(401, 'unauthorized', 'Sign in to continue.');
  }
  const userId = result.data.user.id;
  const liveSession = await db.rpc('owned_session_valid_v1');
  signal?.throwIfAborted();
  if (liveSession.error)
    throw new HttpFailure(
      503,
      'auth_unavailable',
      'Your session could not be verified.',
    );
  if (liveSession.data !== true)
    throw new HttpFailure(
      401,
      'session_revoked',
      'Sign in again. This session has ended.',
    );
  let passwordAt: string | null = null;
  try {
    const claims: unknown = JSON.parse(
      Buffer.from(token.split('.')[1]!, 'base64url').toString('utf8'),
    );
    if (
      claims &&
      typeof claims === 'object' &&
      'amr' in claims &&
      Array.isArray(claims.amr)
    ) {
      const times = claims.amr
        .filter(
          (entry: unknown): entry is { method: string; timestamp: number } =>
            !!entry &&
            typeof entry === 'object' &&
            'method' in entry &&
            entry.method === 'password' &&
            'timestamp' in entry &&
            typeof entry.timestamp === 'number' &&
            Number.isSafeInteger(entry.timestamp),
        )
        .map((entry) => entry.timestamp);
      if (times.length)
        passwordAt = new Date(Math.max(...times) * 1000).toISOString();
    }
  } catch {
    /* Missing or malformed authenticated AMR never establishes freshness. */
  }
  return Object.freeze({ userId, db, passwordAt });
}
export async function verifySession(
  request: Pick<IncomingMessage, 'headers'>,
  signal?: AbortSignal,
): Promise<AuthContext> {
  const { userId, db } = await verifyIdentity(request, signal);
  const profile = await db
    .from('profiles')
    .select('account_state')
    .eq('user_id', userId)
    .maybeSingle();
  signal?.throwIfAborted();
  if (profile.error)
    throw new HttpFailure(
      503,
      'account_unavailable',
      'Your account could not be loaded.',
    );
  if (!profile.data || profile.data.account_state !== 'active')
    throw new HttpFailure(
      403,
      'account_unavailable',
      'Your account is not available. Contact the operator.',
    );
  return Object.freeze({ userId, db });
}

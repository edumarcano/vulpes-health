import type { IncomingMessage } from 'node:http';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { publicAuthConfig } from '../../shared/auth.js';
import type { Database } from '../db/database.types.js';
import { HttpFailure } from '../http/failure.js';

export interface AuthContext { readonly userId: string; readonly db: SupabaseClient<Database> }
export function serverAuthConfig(env: NodeJS.ProcessEnv = process.env) {
  try {
    const config = publicAuthConfig(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_PUBLISHABLE_KEY);
    if (config) return config;
  } catch { /* Never expose environment contents. */ }
  throw new HttpFailure(503, 'auth_unavailable', 'Sign-in is not configured.');
}
export const serverClientOptions = {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  global: { fetch: (input: string | URL | Request, init?: RequestInit) => fetch(input, { ...init, redirect: 'error', signal: AbortSignal.any([AbortSignal.timeout(10_000), ...(init?.signal ? [init.signal] : [])]) }) },
};
export async function verifySession(request: Pick<IncomingMessage, 'headers'>): Promise<AuthContext> {
  const authorization = request.headers.authorization;
  const match = typeof authorization === 'string' ? /^Bearer ([^\s,]+)$/i.exec(authorization) : null;
  if (!match) throw new HttpFailure(401, 'unauthorized', 'Sign in to continue.');
  const config = serverAuthConfig();
  const token = match[1]!;
  const db = createClient<Database>(config.url, config.key, { ...serverClientOptions, global: { ...serverClientOptions.global, headers: { Authorization: `Bearer ${token}` } } });
  let result;
  try { result = await db.auth.getUser(token); }
  catch { throw new HttpFailure(503, 'auth_unavailable', 'Sign-in could not be verified. Try again.'); }
  if (result.error || !result.data.user) {
    if (result.error && (!('status' in result.error) || !result.error.status || result.error.status >= 500)) throw new HttpFailure(503, 'auth_unavailable', 'Sign-in could not be verified. Try again.');
    throw new HttpFailure(401, 'unauthorized', 'Sign in to continue.');
  }
  const userId = result.data.user.id;
  const profile = await db.from('profiles').select('account_state').eq('user_id', userId).maybeSingle();
  if (profile.error) throw new HttpFailure(503, 'account_unavailable', 'Your account could not be loaded.');
  if (!profile.data || profile.data.account_state !== 'active') throw new HttpFailure(403, 'account_unavailable', 'Your account is not available. Contact the operator.');
  return Object.freeze({ userId, db });
}

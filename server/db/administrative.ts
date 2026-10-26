import { createClient } from '@supabase/supabase-js';
import { serverAuthConfig, serverClientOptions } from '../auth/session.js';
import { HttpFailure } from '../http/failure.js';
import type { Database } from './database.types.js';

export function administrativeClient() {
  const config = serverAuthConfig();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) throw new HttpFailure(503, 'private_store_unavailable', 'Private storage is unavailable.');
  return createClient<Database>(config.url, key, serverClientOptions);
}

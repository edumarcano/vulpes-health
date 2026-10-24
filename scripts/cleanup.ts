import { localStatus } from './local-database.js';
import { cleanupExpiredPayloads } from '../server/security/private-payloads.js';

try {
  if (process.argv.length !== 2) throw new Error();
  const status = localStatus();
  process.env.VITE_SUPABASE_URL = status.apiUrl;
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = status.anonKey;
  process.env.SUPABASE_SERVICE_ROLE_KEY = status.adminKey;
  let removed = 0;
  let batches = 0;
  for (; batches < 100; batches++) {
    const count = await cleanupExpiredPayloads(); removed += count;
    if (count < 100) { batches++; break; }
  }
  console.info(JSON.stringify({ removed, batches, batchLimit: 100, maxBatches: 100, scope: 'local_synthetic_private_payloads' }));
} catch {
  console.error('Cleanup failed. A working disposable local stack is required; connection overrides are not accepted.');
  process.exitCode = 1;
}

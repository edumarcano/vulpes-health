import { createInterface } from 'node:readline/promises';
import { localStatus } from './local-database.js';
import { createClient } from '@supabase/supabase-js';
import { UUIDSchema, DecimalUSDSchema } from '../shared/primitives.js';

// Hosted targeting belongs to the separately approved deployment packet.
if (process.argv.length !== 2 || !process.stdin.isTTY)
  throw new Error('Use a private interactive terminal without arguments.');
const terminal = createInterface({
  input: process.stdin,
  output: process.stdout,
});
try {
  const owner = UUIDSchema.parse(
    (await terminal.question('Synthetic owner UUID: ')).trim(),
  );
  const app = DecimalUSDSchema.parse(
    (await terminal.question('Approved monthly app ceiling USD: ')).trim(),
  );
  const account = DecimalUSDSchema.parse(
    (await terminal.question('Approved monthly account ceiling USD: ')).trim(),
  );
  if (
    (await terminal.question('Type APPROVED LOCAL SYNTHETIC BUDGET: ')) !==
    'APPROVED LOCAL SYNTHETIC BUDGET'
  )
    throw new Error();
  const local = localStatus();
  const db = createClient(local.apiUrl, local.adminKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const result = await db.rpc('provision_pilot_budget_v1', {
    p_owner: owner,
    p_app_ceiling: app,
    p_account_ceiling: account,
  });
  if (result.error) throw new Error();
  console.info(
    'Current UTC-month allocation confirmed. Existing balances preserved; inference remains separately gated.',
  );
} catch {
  console.error(
    'Budget provisioning refused or failed. No existing balance was reset.',
  );
  process.exitCode = 1;
} finally {
  terminal.close();
}

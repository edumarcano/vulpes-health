import { z } from 'zod';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../db/database.types.js';
import { continueDeletion } from './account.js';

const count = z.number().int().nonnegative();
export const MaintenanceStatusSchema = z.strictObject({
  executed: z.boolean(),
  busy: z.boolean(),
  payloadsRemoved: count,
  batchesExpired: count,
  proposalsExpired: count,
  receiptsRemoved: count,
  interrupted: count,
  conservative: count,
  runsRemoved: count,
  payloadsDue: count,
  importsDue: count,
  proposalsDue: count,
  runsDue: count,
  receiptsDue: count,
  deletionPending: z.boolean(),
  pendingHolds: count,
  retryAfter: z.iso.datetime({ offset: true }).nullable(),
  unfinished: z.boolean(),
});
export const MaintenanceLimitsSchema = z.strictObject({
  batchSize: z.number().int().min(1).max(100).default(100),
  maxPasses: z.number().int().min(1).max(5).default(5),
  maxDeletionSteps: z.number().int().min(1).max(20).default(20),
});

// Never discovers owners or initiates deletion; callers supply an approved allowlist.
export async function maintainAccounts(
  admin: SupabaseClient<Database>,
  input: {
    owners: string[];
    execute: boolean;
    limits: z.input<typeof MaintenanceLimitsSchema>;
  },
) {
  const owners = z
    .array(z.uuid())
    .min(1)
    .max(10)
    .refine(
      (ids) => new Set(ids.map((id) => id.toLowerCase())).size === ids.length,
    )
    .parse(input.owners);
  const execute = z.boolean().parse(input.execute),
    limits = MaintenanceLimitsSchema.parse(input.limits);
  const changes = {
    payloadsRemoved: 0,
    batchesExpired: 0,
    proposalsExpired: 0,
    receiptsRemoved: 0,
    interrupted: 0,
    conservative: 0,
    runsRemoved: 0,
  };
  const reports: {
    index: number;
    status: z.infer<typeof MaintenanceStatusSchema>;
  }[] = [];
  let passes = 0,
    deletionSteps = 0,
    authRemovalsConfirmed = 0;
  const authAttempted = new Set<string>();
  async function status(owner: string, run: boolean) {
    const result = await admin.rpc('maintain_account_v1', {
      p_owner: owner,
      p_execute: run,
      p_batch_size: limits.batchSize,
    });
    if (result.error) throw new Error('Owned maintenance unavailable.');
    const checked = MaintenanceStatusSchema.parse(result.data);
    if (checked.executed !== (run && !checked.busy))
      throw new Error('Unexpected maintenance execution mode.');
    return checked;
  }
  for (const [index, owner] of owners.entries()) {
    let current = await status(owner, false);
    if (execute)
      for (
        let pass = 0;
        pass < limits.maxPasses && current.unfinished;
        pass++
      ) {
        current = await status(owner, true);
        passes++;
        for (const key of Object.keys(changes) as (keyof typeof changes)[])
          changes[key] += current[key];
        if (current.busy) break;
        let waitingForAccounting = false;
        if (current.deletionPending && !authAttempted.has(owner)) {
          while (deletionSteps < limits.maxDeletionSteps) {
            const deletion = await continueDeletion({ userId: owner }, admin);
            deletionSteps++;
            if (deletion.state === 'active') break;
            if (deletion.phase === 'completed') {
              authAttempted.add(owner);
              authRemovalsConfirmed++;
              break;
            }
            if (deletion.phase === 'auth_removal_pending') {
              authAttempted.add(owner);
              break;
            }
            if (deletion.outcome === 'waiting_for_accounting') {
              waitingForAccounting = true;
              break;
            }
          }
        }
        const after = await status(owner, false);
        // Locks/future accounting can leave work unavailable; bounded reruns never force it.
        const changed = Object.keys(changes).some(
          (key) => current[key as keyof typeof changes] > 0,
        );
        current = after;
        if (
          waitingForAccounting ||
          (!changed && (!current.deletionPending || authAttempted.has(owner)))
        )
          break;
      }
    reports.push({ index, status: current });
  }
  return {
    scope: 'owned_database_maintenance',
    mode: execute ? 'execute' : 'inspect',
    owners: owners.length,
    passes,
    deletionSteps,
    authRemovalsConfirmed,
    changes,
    reports,
    unfinished: reports.some((r) => r.status.unfinished),
    limits,
    excludes: [
      'hosted export temporary files',
      'backups and independent journal copies',
      'scheduler',
      'new deletion requests',
      'budget provisioning',
      'provider calls',
    ],
  };
}

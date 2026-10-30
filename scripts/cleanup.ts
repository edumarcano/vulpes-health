import { localStatus,projectRoot } from './local-database.js';
import { cleanupExpiredData } from '../server/security/private-payloads.js';
import { administrativeClient } from '../server/db/administrative.js';
import {continueDeletion} from '../server/services/account.js';
import {cleanupExportArtifacts,cleanupBackupArtifacts} from './export-artifacts.js';
import {join} from 'node:path';

try {
  if (process.argv.length !== 2) throw new Error();
  const status = localStatus();
  process.env.VITE_SUPABASE_URL = status.apiUrl;
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY = status.anonKey;
  process.env.SUPABASE_SERVICE_ROLE_KEY = status.adminKey;
  let removed = 0;
  let batches = 0;
  let expired = 0;
  let goalWork=0;
  let deletionsResumed=0;let deletionWorkRemaining=false;let retentionWorkRemaining=false;let receiptsRemoved=0;
  const authAttempted=new Set<string>();
  let runWork=0;let interrupted=0;let conservative=0;let runsRemoved=0;
  for (; batches < 100; batches++) {
    const retention=await administrativeClient().rpc('cleanup_account_retention_v1',{p_batch_size:100});
    if(retention.error || !retention.data || typeof retention.data!=='object' || Array.isArray(retention.data) || typeof retention.data.proposalsExpired!=='number' || typeof retention.data.receiptsRemoved!=='number' || typeof retention.data.unfinished!=='boolean')throw new Error('Retention unavailable.');
    goalWork+=retention.data.proposalsExpired;receiptsRemoved+=retention.data.receiptsRemoved;retentionWorkRemaining=retention.data.unfinished;
    const deletions=await administrativeClient().rpc('pending_account_deletions_v1',{p_batch_size:100});if(deletions.error)throw new Error('Deletion cleanup unavailable.');
    let advanced=0;
    for(const userId of deletions.data??[]){
      if(deletionsResumed>=100 || authAttempted.has(userId))continue;
      const status=await continueDeletion({userId});deletionsResumed++;advanced++;
      if(status.state==='deleting' && status.phase==='auth_removal_pending')authAttempted.add(userId);
    }
    deletionWorkRemaining=advanced>0;
    const reconciled=await administrativeClient().rpc('reconcile_runs_v1',{p_batch_size:100});
    if(reconciled.error || !reconciled.data || typeof reconciled.data!=='object' || Array.isArray(reconciled.data))throw new Error();
    const report=reconciled.data;
    if(typeof report.workCount!=='number' || typeof report.interrupted!=='number' || typeof report.conservative!=='number' || typeof report.runsRemoved!=='number')throw new Error();
    runWork+=report.workCount;interrupted+=report.interrupted;conservative+=report.conservative;runsRemoved+=report.runsRemoved;
    const result = await cleanupExpiredData(); removed += result.payloadsRemoved;expired += result.batchesExpired;
    if (result.workCount < 100 && report.workCount<100 && !retentionWorkRemaining && !deletionWorkRemaining) { batches++; break; }
  }
  const artifacts=await cleanupExportArtifacts();const backups=await cleanupBackupArtifacts(join(projectRoot,'backups'));const pending=await administrativeClient().from('account_deletion_receipts').select('id',{count:'exact',head:true}).neq('phase','completed');if(pending.error)throw new Error('Deletion status unavailable.');
  console.info(JSON.stringify({ removed, expired, batches, goalWork,runWork,interrupted,conservative,runsRemoved,receiptsRemoved,deletionsResumed,pendingDeletions:pending.count,unfinished:batches===100 || !!pending.count || deletionWorkRemaining || retentionWorkRemaining || artifacts.unfinished || backups.unfinished,exportArtifactsRemoved:artifacts.removed,expiredBackupsRemoved:backups.removed,batchLimit: 100, maxBatches: 100,maxDeletionSteps:100, scope: 'local_synthetic_private_payloads' }));
} catch {
  console.error('Cleanup failed. A working disposable local stack is required; connection overrides are not accepted.');
  process.exitCode = 1;
}

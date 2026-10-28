import { localStatus } from './local-database.js';
import { cleanupExpiredData } from '../server/security/private-payloads.js';
import { administrativeClient } from '../server/db/administrative.js';

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
  let runWork=0;let interrupted=0;let conservative=0;let runsRemoved=0;
  for (; batches < 100; batches++) {
    const proposals=await administrativeClient().from('action_proposals').select('user_id').eq('state','pending').lte('expires_at',new Date().toISOString()).limit(100);
    if(proposals.error)throw new Error('Goal cleanup unavailable.');
    for(const owner of new Set(proposals.data.map(p=>p.user_id))){const result=await administrativeClient().rpc('expire_goal_proposals_v1',{p_owner:owner});if(result.error)throw new Error('Goal cleanup unavailable.');}
    goalWork+=proposals.data.length;
    const reconciled=await administrativeClient().rpc('reconcile_runs_v1',{p_batch_size:100});
    if(reconciled.error || !reconciled.data || typeof reconciled.data!=='object' || Array.isArray(reconciled.data))throw new Error();
    const report=reconciled.data;
    if(typeof report.workCount!=='number' || typeof report.interrupted!=='number' || typeof report.conservative!=='number' || typeof report.runsRemoved!=='number')throw new Error();
    runWork+=report.workCount;interrupted+=report.interrupted;conservative+=report.conservative;runsRemoved+=report.runsRemoved;
    const result = await cleanupExpiredData(); removed += result.payloadsRemoved;expired += result.batchesExpired;
    if (result.workCount < 100 && report.workCount<100 && proposals.data.length<100) { batches++; break; }
  }
  console.info(JSON.stringify({ removed, expired, batches, goalWork,runWork,interrupted,conservative,runsRemoved,batchLimit: 100, maxBatches: 100, scope: 'local_synthetic_private_payloads' }));
} catch {
  console.error('Cleanup failed. A working disposable local stack is required; connection overrides are not accepted.');
  process.exitCode = 1;
}

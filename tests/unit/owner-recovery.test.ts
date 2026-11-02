import {randomBytes,randomUUID} from 'node:crypto';
import {mkdtemp,writeFile,unlink,rmdir} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {expect,it,vi} from 'vitest';
import {HostingTargetSchema,targetHash} from '../../scripts/hosting.js';
import {OwnerRecoveryTargetSchema,recoveryTargetHash,checkRecoveryUsers,checkRecoveryMode,type RecoveryTarget} from '../../scripts/recovery-target.js';
import {captureDatabase,restoreDatabase,recoveryRequiredPublicTables,type RecoverySnapshot,type RecoveryDestination} from '../../scripts/recovery-database.js';
import {captureRecoveryJournal,verifyRecoveryJournal,recoveryJournalCommand,recoveryPathHash} from '../../scripts/recovery-journal.js';
import {databaseRecoveryCommand} from '../../scripts/hosted-database-recovery.js';
import {hostedMaintenanceCommand} from '../../scripts/hosted-maintenance.js';
import {encryptBytes} from '../../server/security/encryption.js';
import {openArchive,sealArchive} from '../../scripts/backup-archive.js';

const synthetic={version:1,purpose:'synthetic-only',supabaseProjectRef:'abcdefghijklmnopqrst',recoveryProjectRef:null,databaseRegion:'us-east-1',vercelProjectId:'prj_SyntheticRecovery',appOrigin:'https://vulpes-synthetic.vercel.app'} as const;
const owner=randomUUID(),peer=randomUUID(),target=OwnerRecoveryTargetSchema.parse({...synthetic,purpose:'owner-pilot',ownerUserId:owner,syntheticPeerUserIds:[peer]});
const now=Date.now(),time=(offset=0)=>new Date(now+offset).toISOString(),traces={activeId:'synthetic-key',keys:new Map([['synthetic-key',randomBytes(32)]])},keys={backup:randomBytes(32),keyId:'synthetic-backup',traces};
function state():RecoverySnapshot{return {serverMajor:17,nonsyntheticUsers:1,userScope:[{id:owner,synthetic:false},{id:peer,synthetic:true}],storageObjects:0,extensions:[],catalog:{columns:[1],functions:[1],constraints:[1],triggers:[1],policies:[1],grants:[1],rls:[1]},inventory:Object.fromEntries([...recoveryRequiredPublicTables.map(t=>'public.'+t),'auth.users'].map(t=>[t,{count:2,hash:'a'.repeat(64)}])),traceKeyIds:['synthetic-key'],traceSamples:[encryptBytes({id:randomUUID(),user_id:owner,purpose:'ai_request',expires_at:time(3600000)},Buffer.from('Synthetic owner-mode trace'),traces)]};}
const source=(value=state())=>({snapshot:vi.fn(async()=>value),dump:vi.fn(async()=>Buffer.from('PGDMPsynthetic-only unit fixture'))});
const destination=(value:RecoverySnapshot):RecoveryDestination=>({create:vi.fn(async()=>{}),assertFenced:vi.fn(async()=>{}),assertEmpty:vi.fn(async()=>{}),restore:vi.fn(async()=>{}),snapshot:vi.fn(async()=>value),normalize:vi.fn(async v=>v),stop:vi.fn(async()=>{})});
async function manifest(input:RecoveryTarget,run:(path:string)=>Promise<void>){const root=await mkdtemp(join(tmpdir(),'vulpes-owner-mode-')),path=join(root,'manifest.json');try{await writeFile(path,JSON.stringify({target:input,targetSHA256:recoveryTargetHash(input)}));await run(path);}finally{await unlink(path);await rmdir(root);}}

it('separates explicit owner mode from unchanged synthetic hosting and target hashes',()=>{
 expect(HostingTargetSchema.safeParse(target).success).toBe(false);expect(recoveryTargetHash(synthetic)).toBe(targetHash(synthetic));expect(recoveryTargetHash(target)).not.toBe(targetHash(synthetic));
 for(const patch of [{ownerUserId:peer},{syntheticPeerUserIds:[peer,randomUUID()]},{recoveryProjectRef:target.supabaseProjectRef},{arbitraryOwner:true}])expect(OwnerRecoveryTargetSchema.safeParse({...target,...patch}).success).toBe(false);
 expect(()=>checkRecoveryMode(target,false)).toThrow();expect(()=>checkRecoveryMode(synthetic,true)).toThrow();expect(()=>checkRecoveryMode(target,true)).not.toThrow();
});
it.each([
 {users:undefined,nonsynthetic:1,count:2},
 {users:[{id:owner,synthetic:false}],nonsynthetic:1,count:1},
 {users:[{id:randomUUID(),synthetic:true},{id:peer,synthetic:true}],nonsynthetic:0,count:2},
 {users:[{id:owner,synthetic:false},{id:peer,synthetic:false}],nonsynthetic:2,count:2},
 {users:[{id:owner,synthetic:false},{id:peer,synthetic:true}],nonsynthetic:0,count:2},
 {users:[{id:owner,synthetic:false},{id:peer,synthetic:true}],nonsynthetic:1,count:3},
])('rejects missing, foreign, real-peer or inconsistent source identities before dumping: %j',async patch=>{
 const value={...state(),userScope:patch.users,nonsyntheticUsers:patch.nonsynthetic};value.inventory['auth.users']!.count=patch.count;const s=source(value);await expect(captureDatabase(target,s,keys,now)).rejects.toThrow();expect(s.dump).not.toHaveBeenCalled();
});
it('accepts only the named owner and declared synthetic peer, encrypts scope and refuses mode downgrade',async()=>{
 const value=state(),captured=await captureDatabase(target,source(value),keys,now),d=destination(value);
 expect(captured.report.scope).toBe('owner_pilot_database_capture');expect(JSON.stringify(captured.report)).not.toContain(owner);expect(captured.archive.includes(Buffer.from(owner))).toBe(false);
 expect(await restoreDatabase(target,captured.archive,keys,d,now)).toMatchObject({scope:'fenced_owner_pilot_database_restore',catalogAndRowsMatched:true,restoreAccessAuthorized:false});expect(d.stop).toHaveBeenCalledTimes(1);
 const denied=destination(value);await expect(restoreDatabase(synthetic,captured.archive,keys,denied,now)).rejects.toThrow();await expect(restoreDatabase({...target,ownerUserId:randomUUID()},captured.archive,keys,denied,now)).rejects.toThrow();expect(denied.create).not.toHaveBeenCalled();
 const opened=openArchive(captured.archive,new Map([[keys.keyId,keys.backup]]),'database',now);try{const record=JSON.parse(opened.bytes.toString());record.purpose='synthetic-database-recovery';const misleading=sealArchive(Buffer.from(JSON.stringify(record)),keys.backup,keys.keyId,'database',now);await expect(restoreDatabase(target,misleading,keys,denied,now)).rejects.toThrow();}finally{opened.bytes.fill(0);}expect(denied.create).not.toHaveBeenCalled();
});
it('keeps marked owner data out of synthetic capture and reads historical synthetic archives with new metadata',async()=>{
 const marked=source();await expect(captureDatabase(synthetic,marked,keys,now)).rejects.toThrow();expect(marked.dump).not.toHaveBeenCalled();
 const legacy=state();legacy.nonsyntheticUsers=0;delete legacy.userScope;const captured=await captureDatabase(synthetic,source(legacy),keys,now);
 const actual={...legacy,userScope:[{id:owner,synthetic:true},{id:peer,synthetic:true}]};expect(await restoreDatabase(synthetic,captured.archive,keys,destination(actual),now)).toMatchObject({catalogAndRowsMatched:true});
});
it('requires completed deletion evidence for missing named identities and rejects their resurrection',()=>{
 const users=[{id:peer,synthetic:true}];expect(()=>checkRecoveryUsers(target,0,users,1)).toThrow();expect(()=>checkRecoveryUsers(target,0,users,1,[owner])).not.toThrow();expect(()=>checkRecoveryUsers(target,0,users,1,[randomUUID()])).toThrow();expect(()=>checkRecoveryUsers(target,1,state().userScope,2,[owner])).toThrow();
});
it('requires owner purpose for journal capture and authenticates the scoped archive on verification',async()=>{
 const secret=randomBytes(32).toString('base64'),path=join(tmpdir(),'synthetic-owner-journal.vpb');
 const input={keyId:'synthetic-journal',journalKeyB64:secret,accessToken:'sbp_synthetic_canary',authorization:{purpose:'owner-pilot-recovery-journal-capture',targetSHA256:recoveryTargetHash(target),outputPathSHA256:recoveryPathHash(path),expiresAt:time(3600000),approved:true,independentJournalCustody:true,separateKeyCustody:true}};
 const send=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify([{captured_at:time(),accounting_sha256:'a'.repeat(64),nonsynthetic_users:1,user_scope:state().userScope,storage_objects:0,receipt_count:0,rows:[]}]),{headers:{'Content-Type':'application/json'}}));
 await expect(captureRecoveryJournal(target,path,{...input,authorization:{...input.authorization,purpose:'synthetic-recovery-journal-capture'}},send,()=>now)).rejects.toThrow();expect(send).not.toHaveBeenCalled();
 const captured=await captureRecoveryJournal(target,path,input,send,()=>now);expect(JSON.parse(String(send.mock.calls[0]![1]!.body)).read_only).toBe(true);
 expect(verifyRecoveryJournal(captured.archive,target,{keyId:input.keyId,journalKeyB64:secret,backupCreatedAt:time(-1000)},now).report).toMatchObject({scope:'independent_owner_pilot_deletion_journal',restoreAccessAuthorized:false});
 expect(()=>verifyRecoveryJournal(captured.archive,synthetic,{keyId:input.keyId,journalKeyB64:secret,backupCreatedAt:time(-1000)},now)).toThrow();
});
it('requires matching explicit owner CLI mode before credentials, network or Docker, including HTTP fixture refusal',async()=>{
 const read=vi.fn(),send=vi.fn();await manifest(target,async path=>{
  await expect(databaseRecoveryCommand(['--capture','--allow-hosted-capture','--manifest='+path,'--output=unused'],read,send)).rejects.toThrow();
  await expect(recoveryJournalCommand(['--capture','--allow-hosted','--manifest='+path,'--output=unused'],read,send)).rejects.toThrow();
  await expect(hostedMaintenanceCommand(['--allow-hosted','--manifest='+path],read,send)).rejects.toThrow();
  await expect(databaseRecoveryCommand(['--recover','--owner-pilot','--verify-http','--allow-fenced-restore','--allow-hosted-journal-read','--manifest='+path,'--archive=unused','--image=unused','--journal=unused','--journal-latest=unused'],read,send)).rejects.toThrow('synthetic-only');
 });expect(read).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
 await manifest(synthetic,async path=>{await expect(hostedMaintenanceCommand(['--owner-pilot','--allow-hosted','--manifest='+path],read,send)).rejects.toThrow();});expect(read).not.toHaveBeenCalled();
});
it('keeps owner plans inert and identifies the bounded scope',async()=>{
 const read=vi.fn(),send=vi.fn();expect(await databaseRecoveryCommand(['--plan','--owner-pilot'],read,send)).toMatchObject({networkRequests:0,scope:'owner_pilot_database_capture_and_fenced_restore'});expect(await recoveryJournalCommand(['--plan','--owner-pilot'],read,send)).toMatchObject({networkRequests:0});expect(await hostedMaintenanceCommand(['--plan','--owner-pilot'],read,send)).toMatchObject({networkRequests:0,maximumOwners:1});expect(read).not.toHaveBeenCalled();expect(send).not.toHaveBeenCalled();
});
it('checks exact maintenance ownership and purpose before any RPC and rejects a marked owner in synthetic mode',async()=>{
 const input={publishableKey:'sb_publishable_synthetic',adminKey:'sb_secret_synthetic',authorization:{purpose:'owner-pilot-maintenance',mode:'inspect',targetSHA256:recoveryTargetHash(target),owners:[owner],expiresAt:time(3600000),approved:true},limits:{}};
 const send=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({user:{id:owner,email:'synthetic@example.invalid',app_metadata:{vulpes_data_scope:'owner-pilot'}}}),{headers:{'Content-Type':'application/json'}}));
 await manifest(target,async path=>{for(const patch of [{owners:[peer]},{owners:[owner,peer]},{purpose:'synthetic-maintenance'}])await expect(hostedMaintenanceCommand(['--owner-pilot','--allow-hosted','--manifest='+path],async()=>({...input,authorization:{...input.authorization,...patch}}),send,now)).rejects.toThrow();});expect(send).not.toHaveBeenCalled();
 await manifest(synthetic,async path=>{await expect(hostedMaintenanceCommand(['--allow-hosted','--manifest='+path],async()=>({...input,authorization:{...input.authorization,purpose:'synthetic-maintenance',targetSHA256:targetHash(synthetic)}}),send,now)).rejects.toThrow();});expect(send).toHaveBeenCalledTimes(1);expect(String(send.mock.calls[0]![0])).toContain('/auth/v1/admin/users/');
});

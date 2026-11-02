import {isDeepStrictEqual} from 'node:util';
import {z} from 'zod';
import {EnvelopeSchema,decryptBytes,type EncryptionKeys} from '../server/security/encryption.js';
import {HostingTargetSchema,targetHash,type HostingTarget} from './hosting.js';
import {sealArchive,openArchive} from './backup-archive.js';
import type {Database} from '../server/db/database.types.js';

export const maximumDumpBytes=128*1024*1024;
export const recoveryRequiredPublicTables=['profiles','data_sources','import_batches','measurements','conversations','ai_runs','messages','goals','action_proposals','goal_revisions','ai_steps','private_payloads','usage_buckets','usage_reservations','audit_events','account_deletion_receipts','ai_route_cost_blocks','live_verification_allocations','vertex_policy_approval'] as const satisfies readonly (keyof Database['public']['Tables'])[];
const count=z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),hash=z.string().regex(/^[a-f0-9]{64}$/);
const catalogSchema=z.strictObject(Object.fromEntries(['columns','functions','constraints','triggers','policies','grants','rls'].map(k=>[k,z.array(z.unknown())])));
export const RecoverySnapshotSchema=z.strictObject({serverMajor:z.number().int().min(15).max(20),nonsyntheticUsers:count,storageObjects:count,extensions:z.array(z.unknown()),catalog:catalogSchema,
 inventory:z.record(z.string().regex(/^(public|auth|storage|supabase_migrations)\.[a-zA-Z0-9_]+$/),z.strictObject({count,hash})),traceKeyIds:z.array(z.string().min(1).max(200)).max(10),traceSamples:z.array(EnvelopeSchema).max(10)});
export type RecoverySnapshot=z.infer<typeof RecoverySnapshotSchema>;
const bundleSchema=z.strictObject({version:z.literal(1),purpose:z.literal('synthetic-database-recovery'),targetSHA256:hash,snapshot:RecoverySnapshotSchema,dumpBase64:z.string().max(Math.ceil(maximumDumpBytes/3)*4)});
export interface RecoverySource {snapshot:()=>Promise<unknown>;dump:()=>Promise<Buffer>}
export interface RecoveryDestination {
 create:()=>Promise<void>;assertFenced:()=>Promise<void>;assertEmpty:()=>Promise<void>;
 restore:(dump:Buffer)=>Promise<void>;snapshot:()=>Promise<unknown>;normalize:(value:RecoverySnapshot)=>Promise<RecoverySnapshot>;stop:()=>Promise<void>;
}
function snapshot(input:unknown){
 const checked=RecoverySnapshotSchema.parse(input);
 if(checked.nonsyntheticUsers||checked.storageObjects)throw new Error('Synthetic source with empty Storage required.');
 for(const table of [...recoveryRequiredPublicTables.map(t=>'public.'+t),'auth.users'])if(!checked.inventory[table])throw new Error('Required source inventory missing.');
 if(!checked.catalog.columns?.length||!checked.catalog.functions?.length||!checked.catalog.policies?.length||!checked.catalog.rls?.length)throw new Error('Source security catalog incomplete.');
 if(new Set(checked.traceKeyIds).size!==checked.traceKeyIds.length||!isDeepStrictEqual([...checked.traceKeyIds].sort(),checked.traceSamples.map(s=>s.key_id).sort()))throw new Error('Trace-key inventory incomplete.');
 return checked;
}
function verifyTraces(value:RecoverySnapshot,keys:EncryptionKeys){for(const sample of value.traceSamples){const bytes=decryptBytes(sample,keys);bytes.fill(0);}}
function dumpBytes(bytes:Buffer){if(bytes.length<5||bytes.length>maximumDumpBytes||bytes.subarray(0,5).toString('ascii')!=='PGDMP')throw new Error('Bounded custom PostgreSQL archive required.');return bytes;}

export async function captureDatabase(target:HostingTarget,source:RecoverySource,keys:{backup:Buffer;keyId:string;traces:EncryptionKeys},now=Date.now()){
 const checked=HostingTargetSchema.parse(target),before=snapshot(await source.snapshot());verifyTraces(before,keys.traces);
 const dump=await source.dump();
 try{
  dumpBytes(dump);const after=snapshot(await source.snapshot());
  if(!isDeepStrictEqual(before,after))throw new Error('Source changed during capture.');verifyTraces(after,keys.traces);
  const bytes=Buffer.from(JSON.stringify(bundleSchema.parse({version:1,purpose:'synthetic-database-recovery',targetSHA256:targetHash(checked),snapshot:before,dumpBase64:dump.toString('base64')})));
  try{return {archive:sealArchive(bytes,keys.backup,keys.keyId,'database',now),report:{scope:'synthetic_database_capture',targetSHA256:targetHash(checked),tables:Object.keys(before.inventory).length,traceKeyVersions:before.traceKeyIds.length,sourceWrites:0,restoreAccessAuthorized:false}};}
  finally{bytes.fill(0);}
 }finally{dump.fill(0);}
}
export async function restoreDatabase(target:HostingTarget,archive:Buffer,keys:{backup:Buffer;keyId:string;traces:EncryptionKeys},destination:RecoveryDestination,now=Date.now()){
 const opened=openArchive(archive,new Map([[keys.keyId,keys.backup]]),'database',now);let dump:Buffer|undefined;
 try{
  const record=bundleSchema.parse(JSON.parse(opened.bytes.toString('utf8')));
  if(record.targetSHA256!==targetHash(target))throw new Error('Backup source mismatch.');
  const expected=snapshot(record.snapshot);verifyTraces(expected,keys.traces);dump=dumpBytes(Buffer.from(record.dumpBase64,'base64'));
  if(dump.toString('base64')!==record.dumpBase64)throw new Error('Invalid dump encoding.');
  let created=false;
  try{
   // The native destination always creates a fresh, network-none container.
   created=true;await destination.create();await destination.assertFenced();await destination.assertEmpty();
   await destination.restore(dump);await destination.assertFenced();const actual=snapshot(await destination.snapshot());
   if(!isDeepStrictEqual(await destination.normalize(expected),await destination.normalize(actual)))throw new Error('Restored catalog, ownership, grants, policies, rows or keys differ.');verifyTraces(actual,keys.traces);
   return {scope:'fenced_synthetic_database_restore',targetSHA256:record.targetSHA256,tables:Object.keys(expected.inventory).length,traceKeyVersions:expected.traceKeyIds.length,encryptedArchiveAuthenticated:true,
    catalogAndRowsMatched:true,network:'none',publishedPorts:0,restoreAccessAuthorized:false,remaining:['current independent deletion journal completeness and replay','restored session revocation','Auth/API compatibility and isolation','separate access approval']};
  }finally{if(created)await destination.stop();}
 }finally{dump?.fill(0);opened.bytes.fill(0);}
}

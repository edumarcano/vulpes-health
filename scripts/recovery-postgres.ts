import {spawnSync} from 'node:child_process';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import {localEnvironment,isLocalDockerHost,assertLocalStack,projectId} from './local-database.js';
import {recoveryReadCatalogSql,recoveryReadInventorySql,normalizeRecoveryConstraintsSql} from './recovery-inventory.js';
import {maximumDumpBytes,type RecoverySource,type RecoveryDestination} from './recovery-database.js';
import type {HostingTarget} from './hosting.js';
import {recoveryReplayActions} from './recovery-replay.js';

const maxMetadata=32*1024*1024;
const client='supabase_db_vulpes-health-pr03-test';
export const RecoveryConnectionSchema=z.strictObject({host:z.string().max(200),port:z.literal(5432),user:z.string().max(100),password:z.string().min(1).max(1024),caCertificatePem:z.string().min(100).max(65536).regex(/^-----BEGIN CERTIFICATE-----[\s\S]+-----END CERTIFICATE-----\s*$/)});
export function connectionIdentity(target:HostingTarget,input:unknown){
 const c=RecoveryConnectionSchema.parse(input),direct=c.host===`db.${target.supabaseProjectRef}.supabase.co`&&c.user==='postgres',pooler=new RegExp(`^aws-[0-9]+-${target.databaseRegion}\\.pooler\\.supabase\\.com$`).test(c.host)&&c.user===`postgres.${target.supabaseProjectRef}`;
 if(!direct&&!pooler)throw new Error('PostgreSQL source binding mismatch.');
 return {host:c.host,port:c.port,user:c.user,database:'postgres',sslmode:'verify-full',caCertificateSHA256:createHash('sha256').update(c.caCertificatePem).digest('hex')};
}
function docker(args:string[],input?:Buffer,extra:NodeJS.ProcessEnv={},limit=maxMetadata,onFailure?:(stderr:Buffer)=>void){
 const r=spawnSync('docker',args,{input,env:{...localEnvironment(),...extra},encoding:undefined,maxBuffer:limit,timeout:180_000});
 if(r.error||r.status!==0){onFailure?.(Buffer.from(r.stderr??''));throw new Error('Recovery PostgreSQL command failed; private diagnostics omitted.');}return Buffer.from(r.stdout);
}
export function assertLocalRecoveryDocker(){
 const host=JSON.parse(docker(['context','inspect','--format','{{json .Endpoints.docker.Host}}']).toString()) as unknown;
 if(typeof host!=='string'||!isLocalDockerHost(host))throw new Error('Local Docker required.');
}
const metadataSql=`select jsonb_build_object('serverMajor',current_setting('server_version_num')::integer/10000,
 'nonsyntheticUsers',(select count(*) from auth.users where email is null or lower(email) not like '%@example.invalid'),
 'extensions',(select coalesce(jsonb_agg(jsonb_build_array(n.nspname,e.extname,e.extversion) order by n.nspname,e.extname),'[]') from pg_extension e join pg_namespace n on n.oid=e.extnamespace),
 'traceKeyIds',(select coalesce(jsonb_agg(key_id order by key_id),'[]') from(select distinct key_id from public.private_payloads) k),
 'traceSamples',(select coalesce(jsonb_agg(to_jsonb(p) order by key_id),'[]') from(select distinct on(key_id) * from public.private_payloads order by key_id,id) p));`;
async function snapshot(sql:(statement:string)=>Promise<string>){
 const metadata=JSON.parse(await sql(metadataSql)) as Record<string,unknown>,catalog=JSON.parse(await sql(recoveryReadCatalogSql)) as unknown,inventory=JSON.parse(await sql(recoveryReadInventorySql)) as Record<string,{count:number;hash:string}>;
 return {...metadata,catalog,inventory,storageObjects:inventory['storage.objects']?.count??0};
}
const dumpArguments=['pg_dump','--no-password','--format=custom','--schema=public','--schema=auth','--schema=storage','--schema=supabase_migrations'];
export function hostedRecoverySource(target:HostingTarget,connection:unknown,authorize:()=>void):RecoverySource{
 const c=RecoveryConnectionSchema.parse(connection);connectionIdentity(target,c);assertLocalRecoveryDocker();
 // No secret appears in argv or persistent container configuration. The public CA
 // is supplied on stdin and removed on every shell exit. libpq verifies host + CA.
 const shell='set -eu; ca=$(mktemp); trap \'rm -f "$ca"\' EXIT; cat > "$ca"; export PGSSLROOTCERT="$ca"; "$@"';
 function pg(args:string[],limit=maxMetadata){
  authorize();return docker(['exec','-i',...['PGHOST','PGPORT','PGUSER','PGDATABASE','PGPASSWORD','PGSSLMODE','PGOPTIONS','PGCONNECT_TIMEOUT'].flatMap(key=>['--env',key]),client,'sh','-c',shell,'sh',...args],Buffer.from(c.caCertificatePem),{PGHOST:c.host,PGPORT:'5432',PGUSER:c.user,PGDATABASE:'postgres',PGPASSWORD:c.password,PGSSLMODE:'verify-full',PGOPTIONS:'-c default_transaction_read_only=on -c statement_timeout=120000',PGCONNECT_TIMEOUT:'15'},limit);
 }
 return {snapshot:()=>snapshot(async statement=>pg(['psql','-X','-qAt','--no-password','-v','ON_ERROR_STOP=1','-c','begin read only;'+statement+'rollback;']).toString('utf8').trim()),dump:async()=>pg(dumpArguments,maximumDumpBytes)};
}

// Local test source is deliberately separate from the hosted CLI: no connection
// override flag can route an operator capture to a local or arbitrary database.
export function localRecoverySource(database:string):RecoverySource{
 assertLocalStack();if(!/^vulpes_capture_[a-f0-9]{32}$/.test(database))throw new Error('Disposable local source required.');
 const container='supabase_db_'+projectId;
 return {snapshot:()=>snapshot(async statement=>docker(['exec',container,'psql','-X','-qAt','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-c','begin read only;'+statement+'rollback;']).toString('utf8').trim()),dump:async()=>docker(['exec',container,...dumpArguments,'-U','postgres','-d',database],undefined,{},maximumDumpBytes)};
}

export function fencedRecoveryDestination(image:string,authorize:()=>void,onFailure?:(stderr:Buffer)=>void):RecoveryDestination&{name:string}{
 if(!/^sha256:[a-f0-9]{64}$/.test(image))throw new Error('Pinned cached image required.');assertLocalRecoveryDocker();
 const name='vulpes-recovery-'+randomUUID().replaceAll('-','');let ownedId:string|undefined;
 async function assertFenced(){
  if(!ownedId)throw new Error('No owned recovery destination.');
  const state=JSON.parse(docker(['inspect','--format','{{json .}}',ownedId]).toString()) as {Name:string;Image:string;HostConfig:{NetworkMode:string;PortBindings:Record<string,unknown>;Binds:unknown[]|null;Privileged:boolean};Mounts:{Type:string}[]};
  if(state.Name!=='/'+name||state.Image!==image||state.HostConfig.NetworkMode!=='none'||Object.keys(state.HostConfig.PortBindings??{}).length||state.HostConfig.Binds?.length||state.HostConfig.Privileged||state.Mounts.some(m=>m.Type!=='volume'))throw new Error('Recovery destination fence unavailable.');
 }
 function sql(statement:string,role='postgres'){if(!ownedId)throw new Error('No owned recovery destination.');return docker(['exec','-i',ownedId,'psql','-X','-qAt','-U',role,'-d','postgres','-v','ON_ERROR_STOP=1'],Buffer.from(statement),{},maxMetadata,onFailure).toString('utf8').trim();}
 return {name,
  create:async()=>{
   authorize();docker(['image','inspect',image]);
   const id=docker(['create','--pull=never','--network=none','--name',name,'--env','POSTGRES_PASSWORD','--env','POSTGRES_USER=supabase_admin','--env','POSTGRES_DB=postgres',image],undefined,{POSTGRES_PASSWORD:randomBytes(32).toString('base64')}).toString().trim();
   if(!/^[a-f0-9]{64}$/.test(id))throw new Error('Owned container ID unavailable.');ownedId=id;
   await assertFenced();docker(['start',ownedId]);
   // The entrypoint's temporary init server accepts Unix sockets before shutdown;
   // TCP loopback becomes ready only for the final server, still network-isolated.
   for(let n=0;n<80;n++){const ready=spawnSync('docker',['exec',ownedId,'pg_isready','-h','127.0.0.1','-U','supabase_admin'],{env:localEnvironment(),encoding:'utf8',timeout:2000});if(ready.status===0)return;await new Promise(resolve=>setTimeout(resolve,250));}throw new Error('Fenced database unavailable.');
  },assertFenced,
  assertEmpty:async()=>{
   await assertFenced();const existing=JSON.parse(sql('begin read only;'+recoveryReadInventorySql+'rollback;')) as Record<string,{count:number}>;
   // The cached image initializes empty Auth tables and its own migration metadata.
   if(Object.entries(existing).some(([table,value])=>table.startsWith('public.')||table.startsWith('supabase_migrations.')||table!=='auth.schema_migrations'&&value.count!==0))throw new Error('Recovery destination is populated.');
  },
  restore:async dump=>{authorize();await assertFenced();sql('drop schema if exists public,auth,storage,supabase_migrations cascade;','supabase_admin');docker(['exec','-i',ownedId!,'pg_restore','-U','supabase_admin','-d','postgres','--exit-on-error','--single-transaction'],dump,{},maximumDumpBytes,onFailure);},
  snapshot:()=>snapshot(async statement=>sql('begin read only;'+statement+'rollback;')),
  normalize:async value=>({...value,catalog:{...value.catalog,constraints:JSON.parse(sql('begin;'+normalizeRecoveryConstraintsSql(value.catalog.constraints??[])+'rollback;')) as unknown[]}}),
  recovery:recoveryReplayActions(sql,assertFenced,authorize),
  stop:async()=>{if(ownedId)docker(['stop',ownedId]);},
 };
}

import { spawn } from 'node:child_process';
import { randomBytes,randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { LocalSupabase } from '../tests/helpers/local-supabase.js';
import { localEnvironment, localStatus } from './local-database.js';

const require = createRequire(import.meta.url);
const db = new LocalSupabase();
let appId:string|undefined;
try {
  const args=process.argv.slice(2);const devProof=args.includes('--dev-proof');const diagnostics=args.includes('--diagnostic');
  if(new Set(args).size!==args.length||args.some(arg=>!['--dev-proof','--diagnostic'].includes(arg)))throw new Error('Browser tests accept only --dev-proof and --diagnostic; no connection overrides.');
  const status = localStatus();
  const a = await db.createUser(); const b = await db.createUser();const chat=await db.createUser();
  for (const [user,name] of [[a,'Synthetic A'],[b,'Synthetic B']] as const) await db.admin('/rest/v1/profiles','POST',{ user_id:user.id,display_name:name });
  await db.admin('/rest/v1/profiles','POST',{user_id:chat.id,display_name:'Synthetic Ask',consent_versions:{openrouter:{accepted_version:'openrouter_zdr_v1',accepted_at:new Date().toISOString()}}});
  appId=randomUUID();const period=new Date().toISOString().slice(0,7)+'-01';
  await db.admin('/rest/v1/usage_buckets','POST',{id:appId,scope:'app',period_start:period,allocated_ceiling_usd:'1'});
  await db.admin('/rest/v1/usage_buckets','POST',{user_id:a.id,scope:'account',period_start:period,allocated_ceiling_usd:'0.05'});
  await db.admin('/rest/v1/usage_buckets','POST',{user_id:chat.id,scope:'account',period_start:period,allocated_ceiling_usd:'1'});
  const encryptionKey=randomBytes(32).toString('base64');
  const secrets = [a.password,b.password,a.token,b.token,chat.password,chat.token,status.adminKey,encryptionKey];
  const env = { ...localEnvironment(),...(diagnostics?{DEBUG:'pw:webserver'}:{}), SUPABASE_SERVICE_ROLE_KEY:status.adminKey,VULPES_TRACE_ENCRYPTION_KEY_ID:'synthetic-browser',VULPES_TRACE_ENCRYPTION_KEY_B64:encryptionKey,VITE_SUPABASE_URL:status.apiUrl,VITE_SUPABASE_PUBLISHABLE_KEY:status.anonKey,VULPES_APP_ORIGIN:`http://127.0.0.1:${devProof ? 5173 : 4173}`,VULPES_LIVE_AI_ENABLED:'false',VULPES_TEST_ACCOUNTS_JSON:JSON.stringify([a,b,chat]),VULPES_TEST_CHAT_OWNER:chat.id,VULPES_TEST_MODE:devProof ? 'dev_proof' : 'preview' };
  async function run(args: string[]) {
    const child = spawn(process.execPath,args,{ env,stdio:['ignore','pipe','pipe'] });
    for (const stream of [child.stdout,child.stderr]) {
      let pending = '';
      const safe = (value: string) => secrets.reduce((text,secret) => text.replaceAll(secret,'[redacted]'),value);
      stream.setEncoding('utf8'); stream.on('data',(chunk: string) => {
        pending += chunk; const newline = pending.lastIndexOf('\n');
        if (newline >= 0) { process.stdout.write(safe(pending.slice(0,newline+1))); pending = pending.slice(newline+1); }
      });
      stream.on('end',() => { if (pending) process.stdout.write(safe(pending)); });
    }
    const code = await new Promise<number>((resolve,reject) => { child.once('error',reject); child.once('exit',(result) => resolve(result ?? 1)); });
    if (code !== 0) throw new Error('Browser verification failed.');
  }
  const npm = process.env.npm_execpath; if (!npm) throw new Error('Run with npm run test:e2e.');
  await run([npm,'run','build']);
  await run([require.resolve('@playwright/test/cli'),'test',...(devProof ? ['--grep','Ask |saves profile and explicit consent|manual entry persists|keyboard confirmation|chart loading failure|canonical CSV imports|M2 data journey'] : [])]);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Local browser verification failed.'); process.exitCode = 1;
} finally { await db.cleanup();if(appId)await db.admin(`/rest/v1/usage_buckets?id=eq.${appId}`,'DELETE'); }

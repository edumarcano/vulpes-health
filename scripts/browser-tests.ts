import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { LocalSupabase } from '../tests/helpers/local-supabase.js';
import { localEnvironment, localStatus } from './local-database.js';

const require = createRequire(import.meta.url);
const db = new LocalSupabase();
try {
  const devProof = process.argv[2] === '--dev-proof';
  if (process.argv.length !== (devProof ? 3 : 2)) throw new Error('Browser tests accept no connection overrides.');
  const status = localStatus();
  const a = await db.createUser(); const b = await db.createUser();
  for (const [user,name] of [[a,'Synthetic A'],[b,'Synthetic B']] as const) await db.admin('/rest/v1/profiles','POST',{ user_id:user.id,display_name:name });
  const encryptionKey=randomBytes(32).toString('base64');
  const secrets = [a.password,b.password,a.token,b.token,status.adminKey,encryptionKey];
  const env = { ...localEnvironment(), SUPABASE_SERVICE_ROLE_KEY:status.adminKey,VULPES_TRACE_ENCRYPTION_KEY_ID:'synthetic-browser',VULPES_TRACE_ENCRYPTION_KEY_B64:encryptionKey,VITE_SUPABASE_URL:status.apiUrl,VITE_SUPABASE_PUBLISHABLE_KEY:status.anonKey,VULPES_APP_ORIGIN:`http://127.0.0.1:${devProof ? 5173 : 4173}`,VULPES_LIVE_AI_ENABLED:'false',VULPES_TEST_ACCOUNTS_JSON:JSON.stringify([a,b]),VULPES_TEST_MODE:devProof ? 'dev_proof' : 'preview' };
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
  await run([require.resolve('@playwright/test/cli'),'test',...(devProof ? ['--grep','saves profile and explicit consent|manual entry persists|keyboard confirmation|chart loading failure|canonical CSV imports'] : [])]);
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Local browser verification failed.'); process.exitCode = 1;
} finally { await db.cleanup(); }

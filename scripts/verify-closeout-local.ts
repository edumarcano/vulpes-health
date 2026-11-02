import {spawnSync} from 'node:child_process';
import {createServer} from 'node:http';
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve,sep,extname} from 'node:path';
import {randomBytes,randomUUID} from 'node:crypto';
import {once} from 'node:events';
import {LocalSupabase} from '../tests/helpers/local-supabase.js';
import {localStatus,localEnvironment} from './local-database.js';
import {closeoutFixture,type CloseoutFixture} from './closeout-fixture.js';
import {verifyCloseoutBrowser} from './verify-closeout-browser.js';
import {verifyHostedCloseout} from './verify-hosted-closeout.js';
import {localRouter} from '../server/http/router.js';
import {administrativeClient} from '../server/db/administrative.js';
import {continueDeletion} from '../server/services/account.js';
import {securityHeadersForSupabase} from '../server/http/security.js';

if(process.argv.length!==2)throw Error('Local closeout proof accepts no targets or connection overrides.');
const status=localStatus(),db=new LocalSupabase(),secret=randomBytes(32),users:{id:string;email:string;password:string;token:string;fixture:CloseoutFixture}[]=[],directory='.scratch/closeout-local-'+randomUUID();
await mkdir(directory,{recursive:true});
Object.assign(process.env,{VITE_SUPABASE_URL:status.apiUrl,VITE_SUPABASE_PUBLISHABLE_KEY:status.anonKey,SUPABASE_SERVICE_ROLE_KEY:status.adminKey,VULPES_TRACE_ENCRYPTION_KEY_ID:'synthetic-closeout-local',VULPES_TRACE_ENCRYPTION_KEY_B64:secret.toString('base64'),VULPES_LIVE_AI_ENABLED:'false'});
const headers=securityHeadersForSupabase(status.apiUrl),root=resolve('dist'),mime:Record<string,string>={'.html':'text/html','.js':'text/javascript','.css':'text/css','.png':'image/png','.webmanifest':'application/manifest+json'};
const server=createServer((req,res)=>{
 const path=new URL(req.url??'/','http://localhost').pathname;
 if(path.startsWith('/api/')){localRouter(req,res);return;}
 if(req.method!=='GET'&&req.method!=='HEAD'){res.statusCode=405;res.end();return;}
 const file=resolve(root,'.'+path);if(file!==root&&!file.startsWith(root+sep)){res.statusCode=400;res.end();return;}
 void (async()=>{let bytes:Buffer,extension=extname(file);try{bytes=await readFile(file);}catch{if(extension){res.statusCode=404;res.end();return;}bytes=await readFile(resolve(root,'index.html'));extension='.html';}for(const[k,v]of Object.entries(headers))res.setHeader(k,v);res.setHeader('Content-Type',mime[extension]??'application/octet-stream');res.end(bytes);})().catch(()=>{res.statusCode=500;res.end();});
});
async function cleanupFixtures(){const admin=administrativeClient();for(const u of users){const p=await admin.from('profiles').select('user_id').eq('user_id',u.id).maybeSingle();if(p.data){const started=await admin.rpc('begin_account_deletion_v1',{p_owner:u.id,p_password_at:new Date().toISOString()});if(started.error)throw Error('Fixture deletion failed');let done=false;for(let n=0;n<30;n++){const r=await continueDeletion({userId:u.id},admin);if(r.state==='deleting'&&r.phase==='completed'){done=true;break;}}if(!done)throw Error('Fixture deletion incomplete');}else{const r=await admin.auth.admin.deleteUser(u.id);if(r.error)throw Error('Fixture Auth cleanup failed');}}}
let step='build';
try{
 const npm=process.env.npm_execpath;if(!npm)throw Error('Use npm run test:closeout.');
 const build=spawnSync(process.execPath,[npm,'run','build'],{env:{...localEnvironment(),VITE_SUPABASE_URL:status.apiUrl,VITE_SUPABASE_PUBLISHABLE_KEY:status.anonKey,VULPES_LIVE_AI_ENABLED:'false'},encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});await writeFile(directory+'/build.private.log',build.stdout+build.stderr);if(build.status!==0)throw Error('local_closeout_build_failed');
 server.listen(0,'127.0.0.1');await once(server,'listening');const addr=server.address();if(!addr||typeof addr==='string')throw Error('Loopback unavailable');const app='http://127.0.0.1:'+addr.port;process.env.VULPES_APP_ORIGIN=app;
 step='fixtures';for(let i=0;i<2;i++){const u=await db.createUser(),fixture=closeoutFixture(u.id,i,{activeId:'synthetic-closeout-local',keys:new Map([['synthetic-closeout-local',secret]])});users.push({...u,fixture});for(const entry of fixture.rows)await db.admin('/rest/v1/'+entry.table,'POST',entry.row);}
 const target={version:1,purpose:'synthetic-only',supabaseProjectRef:'abcdefghijklmnopqrst',recoveryProjectRef:null,databaseRegion:'us-east-1',vercelProjectId:'prj_SyntheticCloseout',appOrigin:'https://vulpes-synthetic.vercel.app'} as const;
 step='http';const http=await verifyHostedCloseout({target,publishableKey:status.anonKey,actors:users.map(u=>({token:u.token,fixture:u.fixture})) as [{token:string;fixture:CloseoutFixture},{token:string;fixture:CloseoutFixture}],approved:true},(url,init)=>{const u=new URL(String(url));if(![target.appOrigin,'https://abcdefghijklmnopqrst.supabase.co'].includes(u.origin))throw Error('Unexpected network');const h=new Headers(init?.headers);h.set('Origin',app);return fetch((u.origin===target.appOrigin?app:status.apiUrl)+u.pathname+u.search,{...init,headers:h});});
 step='browser';const browser=await verifyCloseoutBrowser({appOrigin:app,sourceOrigin:status.apiUrl,users:users.map(u=>({email:u.email,password:u.password,fixture:u.fixture})) as [typeof users[number],typeof users[number]],approved:true});
 const report={scope:'local-synthetic-final-hosting-checks',status:'passed',http,browser,providerRequests:0,paidSpendUSD:'0',hostedRequests:0};await writeFile(directory+'/proof.json',JSON.stringify(report,null,2)+'\n',{flag:'wx'});console.info(JSON.stringify(report));
}catch{console.info(JSON.stringify({scope:'local-synthetic-final-hosting-checks',status:'failed',step,privateContentLogged:false}));process.exitCode=1;}
finally{
 server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));
 try{await cleanupFixtures();}
 catch{console.error('Local closeout fixture cleanup needs inspection. No private diagnostics are logged.');process.exitCode=1;}
 finally{secret.fill(0);}
}

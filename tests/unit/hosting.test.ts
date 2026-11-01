import {readFileSync} from 'node:fs';
import {describe,it,expect,vi} from 'vitest';
import {HostingTargetSchema,renderHostingConfig,checkHostedEnvironment,hostingBuildArguments,targetHash,type HostingTarget} from '../../scripts/hosting.js';
import {hostedBuild} from '../../scripts/build-hosted.js';
import {prepareHosting} from '../../scripts/prepare-hosting.js';
import {probeHosting,probeHostingCommand} from '../../scripts/probe-hosting.js';
import {securityHeadersForSupabase} from '../../server/http/security.js';
const target:HostingTarget={version:1,purpose:'synthetic-only',supabaseProjectRef:'abcdefghijklmnopqrst',recoveryProjectRef:'tsrqponmlkjihgfedcba',databaseRegion:'us-east-1',vercelProjectId:'prj_SyntheticOnly',appOrigin:'https://vulpes-synthetic.vercel.app'};
const env=()=>({VERCEL:'1',VERCEL_ENV:'production',VERCEL_PROJECT_ID:target.vercelProjectId,VERCEL_PROJECT_PRODUCTION_URL:'vulpes-synthetic.vercel.app',VULPES_LIVE_AI_ENABLED:'false',
  VITE_SUPABASE_URL:'https://abcdefghijklmnopqrst.supabase.co',VITE_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_synthetic',VULPES_APP_ORIGIN:target.appOrigin,
  SUPABASE_SERVICE_ROLE_KEY:'sb_secret_synthetic_canary',VULPES_TRACE_ENCRYPTION_KEY_ID:'synthetic-hosting',VULPES_TRACE_ENCRYPTION_KEY_B64:Buffer.alloc(32,1).toString('base64')});
const request_id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const statusBody={data:{status:'ok'},request_id};
const errorBody={error:{code:'unauthorized',message:'Sign in.',retryable:false},request_id};
describe('synthetic hosting preparation',()=>{
 it('renders the exact auth origin, region and explicit API routes without enabling Git deployments',()=>{
   const config=renderHostingConfig(JSON.parse(readFileSync('vercel.json','utf8')),target);
   expect(config.git.deploymentEnabled).toBe(false);expect(config.regions).toEqual(['iad1']);
   expect(config.headers.find(h=>h.source==='/:path*')?.headers).toContainEqual({key:'Content-Security-Policy',value:securityHeadersForSupabase(env().VITE_SUPABASE_URL)['Content-Security-Policy']});
   for(const path of ['/api/goals','/api/approvals','/api/account'])expect(config.rewrites.some(r=>r.source===path)).toBe(true);
   expect(config.buildCommand).toBe('npm run build:hosted -- '+hostingBuildArguments(target).join(' '));
   expect(renderHostingConfig(JSON.parse(readFileSync('vercel.json','utf8')),{...target,databaseRegion:'eu-central-1'}).regions).toEqual(['fra1']);
 });
 it.each([{recoveryProjectRef:target.supabaseProjectRef},{supabaseProjectRef:'x;echo unsafe'},{appOrigin:'https://user:password@vulpes-synthetic.vercel.app'},{appOrigin:'https://vulpes-synthetic.vercel.app/?token=x'},{appOrigin:'https://vulpes-synthetic.vercel.app.evil.test'},{vercelProjectId:'prj_x&&bad'},{databaseRegion:'global'},{purpose:'real-data'}])('rejects an unsafe or ambiguous target %j',patch=>{expect(HostingTargetSchema.safeParse({...target,...patch}).success).toBe(false);});
 it('checks configuration without network and rejects wrong identities, provider keys and public secrets',()=>{
   expect(checkHostedEnvironment({projectRef:target.supabaseProjectRef,projectId:target.vercelProjectId,appOrigin:target.appOrigin},env())).toMatchObject({inferenceEnabled:false,configuration:'valid'});
   const args=hostingBuildArguments(target);expect(hostedBuild([...args,'--check-only'],{...env(),VITE_VERCEL_GIT_COMMIT_MESSAGE:'synthetic-unused-platform-metadata'})).toMatchObject({buildRan:false});
   for(const patch of [{VERCEL_ENV:'preview'},{VERCEL_PROJECT_ID:'prj_Other'},{VERCEL_PROJECT_PRODUCTION_URL:'other.vercel.app'},{VULPES_LIVE_AI_ENABLED:'true'},{OPENROUTER_API_KEY:'synthetic-provider-canary'},{GOOGLE_CLOUD_PROJECT:'synthetic-google'},{VITE_PRIVATE_TOKEN:'synthetic-token-canary'},{VITE_SUPABASE_URL:'https://tsrqponmlkjihgfedcba.supabase.co'},{VULPES_APP_ORIGIN:'https://other.vercel.app'},{SUPABASE_SERVICE_ROLE_KEY:'sb_publishable_wrong'},{VULPES_TRACE_ENCRYPTION_KEY_B64:'invalid'}])expect(()=>hostedBuild([...args,'--check-only'],{...env(),...patch})).toThrow();
 });
 it('prints preparation/probe plans and rejects missing opt-in before file, credential or network access',async()=>{
   expect(await prepareHosting(['--plan'])).toMatchObject({networkRequests:0,deploys:false});
   const send=vi.fn();expect(await probeHostingCommand(['--plan'],send)).toMatchObject({requests:0,requiresApproval:true});
   await expect(probeHostingCommand(['--manifest=missing'],send)).rejects.toThrow('hosted_read_approval_required');
   await expect(probeHosting(target,false,send)).rejects.toThrow('hosted_read_approval_required');expect(send).not.toHaveBeenCalled();
 });
 it('probes only public GETs, never sends credentials or follows redirects, and keeps untested gates explicit',async()=>{
   const security=securityHeadersForSupabase(env().VITE_SUPABASE_URL);
   const send=vi.fn(async(url:RequestInfo|URL,init?:RequestInit)=>{
     expect(init).toMatchObject({method:'GET',redirect:'error',credentials:'omit',cache:'no-store'});expect(init?.headers).toBeUndefined();
     const path=new URL(String(url)).pathname,api=path.startsWith('/api/');
     const status=path==='/api/status'?200:path==='/api/does-not-exist'?404:api?401:200;
     return new Response(api?JSON.stringify(path==='/api/status'?statusBody:errorBody):'<!doctype html>',{status,headers:{...security,'Content-Type':api?'application/json':'text/html',...(api?{'Cache-Control':'no-store'}:{})}});
   });
   const report=await probeHosting(target,true,send);expect(report).toMatchObject({status:'passed',requests:14,authenticatedIsolation:'not_run',recovery:'not_run',targetSHA256:targetHash(target)});expect(send).toHaveBeenCalledTimes(14);
 });
 it('fails at an API SPA fallback without reading unexpected bodies or logging them',async()=>{
   const security=securityHeadersForSupabase(env().VITE_SUPABASE_URL);
   const response=new Response('synthetic-private-response-canary',{status:200,headers:{...security,'Content-Type':'text/html'}});const read=vi.spyOn(response,'text');
   const send=vi.fn(async(url:RequestInfo|URL)=>new URL(String(url)).pathname==='/api/does-not-exist'?response:new Response(new URL(String(url)).pathname==='/api/status'?JSON.stringify(statusBody):'<!doctype html>',{headers:{...security,'Content-Type':new URL(String(url)).pathname==='/api/status'?'application/json':'text/html','Cache-Control':'no-store'}}));
   const report=await probeHosting(target,true,send);
   expect(report.status).toBe('failed');expect(report.requests).toBe(6);expect(report.checks.at(-1)).toEqual({path:'/api/does-not-exist',status:'failed'});expect(read).not.toHaveBeenCalled();expect(JSON.stringify(report)).not.toContain('synthetic-private-response-canary');
 });
 it.each(['{invalid',JSON.stringify({...statusBody,private:'synthetic-private-canary'}),'x'.repeat(4097)])('refuses malformed, unexpected or oversized public JSON',async body=>{
   const security=securityHeadersForSupabase(env().VITE_SUPABASE_URL);
   const report=await probeHosting(target,true,async input=>new Response(new URL(String(input)).pathname==='/api/status'?body:'<!doctype html>',{headers:{...security,'Content-Type':new URL(String(input)).pathname==='/api/status'?'application/json':'text/html','Cache-Control':'no-store'}}));
   expect(report.status).toBe('failed');expect(report.requests).toBe(5);expect(JSON.stringify(report)).not.toContain('synthetic-private-canary');
 });
 it.each(['https://a.supabase.co/path','https://a.supabase.co;script-src *','https://a.supabase.co\nunsafe','http://remote.test'])('rejects unsafe CSP origin %j',origin=>expect(()=>securityHeadersForSupabase(origin)).toThrow());
});

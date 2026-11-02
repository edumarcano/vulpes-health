import {z} from 'zod';
import {createHash} from 'node:crypto';
import {publicAuthConfig} from '../shared/auth.js';
import {securityHeadersForSupabase} from '../server/http/security.js';
import {readEncryptionKeys} from '../server/security/encryption.js';
import {getRoleAvailability} from '../server/config/models.js';

const projectRef=z.string().regex(/^[a-z0-9]{20}$/);
const projectId=z.string().regex(/^prj_[A-Za-z0-9]+$/).max(100);
const appOrigin=z.string().max(200).refine(value=>{
  try{const url=new URL(value);return url.origin===value&&url.protocol==='https:'&&/^[a-z0-9][a-z0-9-]*\.vercel\.app$/.test(url.hostname)&&!url.port&&!url.username&&!url.password;}catch{return false;}
});
export const HostingTargetSchema=z.strictObject({
  version:z.literal(1),purpose:z.literal('synthetic-only'),supabaseProjectRef:projectRef,recoveryProjectRef:projectRef.nullable(),
  databaseRegion:z.enum(['us-east-1','eu-central-1']),vercelProjectId:projectId,appOrigin,
}).refine(t=>t.supabaseProjectRef!==t.recoveryProjectRef,'Recovery must use a separate project.');
export type HostingTarget=z.infer<typeof HostingTargetSchema>;
export const hostingRegions={'us-east-1':'iad1','eu-central-1':'fra1'} as const;
export const hostingPlan={purpose:'synthetic-only',networkRequests:0,deploys:false,liveInference:false,
  requiredApproval:'resource creation, migrations and deployment are separate from preparation',
  recovery:'A separate recovery destination may be deferred for synthetic hosting; recovery verification is required before real data.',
  regions:hostingRegions,requiredSecrets:['SUPABASE_SERVICE_ROLE_KEY','VULPES_TRACE_ENCRYPTION_KEY_B64','VULPES_TRACE_ENCRYPTION_KEY_ID'],
  deferredProviders:['OpenRouter production activation','Flash','Argon','decision scoring'],
};
export const targetHash=(target:HostingTarget)=>createHash('sha256').update(JSON.stringify(HostingTargetSchema.parse(target))).digest('hex');
export const supabaseOrigin=(target:HostingTarget)=>`https://${target.supabaseProjectRef}.supabase.co`;

const HostedConfigSchema=z.strictObject({
  $schema:z.string(),framework:z.literal('vite'),buildCommand:z.string(),installCommand:z.string(),outputDirectory:z.literal('dist'),
  functions:z.record(z.string(),z.strictObject({maxDuration:z.number().int().positive()})),
  rewrites:z.array(z.strictObject({source:z.string(),destination:z.string()})),
  headers:z.array(z.strictObject({source:z.string(),headers:z.array(z.strictObject({key:z.string(),value:z.string()}))})),
  git:z.strictObject({deploymentEnabled:z.literal(false)}),regions:z.array(z.string()).optional(),
});
export function hostingBuildArguments(target:HostingTarget){
  const t=HostingTargetSchema.parse(target);
  return [`--project-ref=${t.supabaseProjectRef}`,`--project-id=${t.vercelProjectId}`,`--app-origin=${t.appOrigin}`];
}
export const HostedInferenceModeSchema=z.enum(['disabled','owner-pilot-luna']);
export type HostedInferenceMode=z.infer<typeof HostedInferenceModeSchema>;
export function renderHostingConfig(base:unknown,target:HostingTarget,mode:HostedInferenceMode='disabled'){
  const config=HostedConfigSchema.parse(base),t=HostingTargetSchema.parse(target);
  HostedInferenceModeSchema.parse(mode);
  const headers=securityHeadersForSupabase(supabaseOrigin(t));
  if(!config.headers.some(entry=>entry.source==='/:path*'))throw new Error('Missing security header template.');
  return {...config,regions:[hostingRegions[t.databaseRegion]],buildCommand:'npm run build:hosted -- '+hostingBuildArguments(t).join(' ')+(mode==='owner-pilot-luna'?' --mode=owner-pilot-luna':''),
    headers:config.headers.map(entry=>entry.source==='/:path*'?{source:entry.source,headers:Object.entries(headers).map(([key,value])=>({key,value}))}:entry)};
}

export const BuildTargetSchema=z.strictObject({projectRef,projectId,appOrigin});
export type BuildTarget=z.infer<typeof BuildTargetSchema>;
export function checkHostedEnvironment(input:BuildTarget,env:NodeJS.ProcessEnv,mode:HostedInferenceMode='disabled'){
  const target=BuildTargetSchema.parse(input);
  HostedInferenceModeSchema.parse(mode);
  const fail=(code:string):never=>{throw new Error(code);};
  if(env.VERCEL!=='1'||env.VERCEL_ENV!=='production'||env.VERCEL_PROJECT_ID!==target.projectId||
    env.VERCEL_PROJECT_PRODUCTION_URL!==new URL(target.appOrigin).hostname)fail('hosted_project_mismatch');
  if(mode==='disabled'){
    if(env.VULPES_LIVE_AI_ENABLED!=='false')fail('inference_must_remain_disabled');
    if(env.OPENROUTER_API_KEY)fail('provider_configuration_forbidden');
  }else{
    if(env.VULPES_LIVE_AI_ENABLED!=='true'||getRoleAvailability('everyday',true).state!=='available')fail('owner_pilot_inference_unverified');
    if(!/^sk-or-v1-[A-Za-z0-9_-]+$/.test(env.OPENROUTER_API_KEY??''))fail('owner_pilot_credential_missing');
  }
  if(['GOOGLE_CLOUD_PROJECT','GOOGLE_CLOUD_LOCATION','GOOGLE_APPLICATION_CREDENTIALS','VULPES_SMOKE_BATCH_ID'].some(name=>env[name]))fail('provider_configuration_forbidden');
  if(Object.keys(env).some(name=>name.startsWith('VITE_')&&!['VITE_SUPABASE_URL','VITE_SUPABASE_PUBLISHABLE_KEY'].includes(name)))fail('unexpected_public_configuration');
  const origin=`https://${target.projectRef}.supabase.co`;
  if(env.VITE_SUPABASE_URL!==origin||env.VULPES_APP_ORIGIN!==target.appOrigin)fail('hosted_origin_mismatch');
  try{if(!publicAuthConfig(env.VITE_SUPABASE_URL,env.VITE_SUPABASE_PUBLISHABLE_KEY))fail('public_authentication_missing');}catch{fail('invalid_public_authentication');}
  const key=env.SUPABASE_SERVICE_ROLE_KEY;
  if(!key||key===env.VITE_SUPABASE_PUBLISHABLE_KEY)throw new Error('administrative_key_missing');
  if(!/^sb_secret_[A-Za-z0-9_-]+$/.test(key)){
    try{const parts=key.split('.');if(parts.length!==3||JSON.parse(Buffer.from(parts[1]!,'base64url').toString()).role!=='service_role')fail('administrative_key_invalid');}catch{fail('administrative_key_invalid');}
  }
  try{readEncryptionKeys(env);}catch{fail('trace_keys_invalid');}
  return {purpose:'synthetic-only',inferenceEnabled:mode==='owner-pilot-luna',configuration:'valid'} as const;
}

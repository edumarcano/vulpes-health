import {z} from 'zod';

const image=z.string().regex(/^sha256:[a-f0-9]{64}$/);
export const RecoveryHttpSchema=z.strictObject({authImage:image,restImage:image,users:z.array(z.strictObject({id:z.uuid(),email:z.email().regex(/@example\.invalid$/i),password:z.string().min(12).max(1024)})).min(3).max(10)}).refine(v=>new Set(v.users.map(u=>u.id)).size===v.users.length&&new Set(v.users.map(u=>u.email.toLowerCase())).size===v.users.length);
export type RecoveryHttpInput=z.infer<typeof RecoveryHttpSchema>;
export interface RecoveryHttpClient {
 request:(service:'auth'|'rest',path:string,method:string,body?:unknown,token?:string)=>Promise<{status:number;body:unknown}>;
}
const loginSchema=z.object({access_token:z.string(),refresh_token:z.string(),user:z.object({id:z.uuid()})});

// Real GoTrue and PostgREST, inside the restored database's network-none namespace.
// Test accounts are pre-existing synthetic identities, never password-reset here.
export async function verifyRecoveryHttp(input:RecoveryHttpInput,keepers:Set<string>,client:RecoveryHttpClient){
 const users=input.users.filter(u=>keepers.has(u.id)),deleted=input.users.filter(u=>!keepers.has(u.id));
 if(users.length<2||!deleted.length)throw new Error('Two retained and one journal-deleted synthetic identity required.');
 let checks=0;
 function expect(ok:boolean,step:string){if(!ok)throw new Error('Recovery HTTP verification failed: '+step);checks++;}
 for(const u of deleted){const r=await client.request('auth','/token?grant_type=password','POST',{email:u.email,password:u.password});expect([400,401].includes(r.status),'deleted sign-in');}
 for(const u of users){
  const r=await client.request('auth','/token?grant_type=password','POST',{email:u.email,password:u.password});expect(r.status===200,'retained sign-in HTTP '+r.status);
  const session=loginSchema.parse(r.body);expect(session.user.id===u.id,'retained identity');
  const owned=await client.request('rest','/profiles?select=user_id','GET',undefined,session.access_token);
  expect(owned.status===200&&Array.isArray(owned.body)&&owned.body.length===1&&owned.body[0]?.user_id===u.id,'owned profile');
  const foreign=await client.request('rest','/profiles?select=user_id&user_id=neq.'+u.id,'GET',undefined,session.access_token);
  expect(foreign.status===200&&Array.isArray(foreign.body)&&foreign.body.length===0,'foreign profile');
  const conversations=await client.request('rest','/conversations?select=user_id','GET',undefined,session.access_token);
  expect(conversations.status===200&&Array.isArray(conversations.body)&&conversations.body.length>0&&conversations.body.every((v:{user_id:string})=>v.user_id===u.id),'conversation isolation');
  const privateRows=await client.request('rest','/private_payloads?select=id','GET',undefined,session.access_token);expect(privateRows.status===403,'private payload denial');
  const logout=await client.request('auth','/logout?scope=global','POST',{},session.access_token);expect(logout.status===204,'global logout');
  const valid=await client.request('rest','/rpc/owned_session_valid_v1','POST',{},session.access_token);expect(valid.status===200&&valid.body===false,'old session invalid');
  const old=await client.request('rest','/profiles?select=user_id','GET',undefined,session.access_token);expect(old.status===200&&Array.isArray(old.body)&&!old.body.length,'old session RLS');
  const refresh=await client.request('auth','/token?grant_type=refresh_token','POST',{refresh_token:session.refresh_token});expect([400,401].includes(refresh.status),'old refresh denial');
 }
 const anonymous=await client.request('rest','/profiles?select=user_id','GET');expect(anonymous.status===401||anonymous.status===403,'anonymous denial');
 const signup=await client.request('auth','/signup','POST',{email:'unapproved-recovery@example.invalid',password:'synthetic-unapproved-password'});
 expect([400,403,422].includes(signup.status)&&z.object({error_code:z.literal('signup_disabled')}).safeParse(signup.body).success,'signup disabled HTTP '+signup.status);
 return {authHttpVerified:true,apiHttpVerified:true,httpChecks:checks,httpRetainedUsers:users.length,httpDeletedUsers:deleted.length} as const;
}

import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {hostedLifecycle,LifecyclePlanSchema,type LifecyclePhase} from '../../scripts/hosted-lifecycle.js';

const plan=LifecyclePlanSchema.parse({purpose:'owner-pilot-3d2',runId:randomUUID(),createdAt:new Date().toISOString(),projectRef:'abcdefghijklmnopqrst',users:['vulpes-3d-a@example.invalid','vulpes-3d-b@example.invalid'].map(email=>({id:randomUUID(),email,password:'Synthetic-Initial-Password-123',nextPassword:'Synthetic-Changed-Password-456'}))});
const target={version:1,purpose:'synthetic-only',supabaseProjectRef:plan.projectRef,recoveryProjectRef:null,databaseRegion:'us-east-1',vercelProjectId:'prj_SyntheticOnly',appOrigin:'https://vulpes-synthetic.vercel.app'} as const;
const base={target,plan,publishableKey:'sb_publishable_synthetic',adminKey:'sb_secret_synthetic',phase:'journey' as LifecyclePhase,approved:true,csv:'synthetic',artifacts:{read:vi.fn(),write:vi.fn()}};
it.each([{approved:false},{approved:'yes' as unknown as boolean},{phase:'unknown' as LifecyclePhase},{plan:{...plan,projectRef:'other'}},{adminKey:'sb_publishable_synthetic'}])('refuses unsafe approval/phase/target/credentials before any network or artifact write',async patch=>{
 const network=vi.fn();await expect(hostedLifecycle({...base,...patch},network)).rejects.toThrow();expect(network).not.toHaveBeenCalled();expect(base.artifacts.write).not.toHaveBeenCalled();
});
it('restricts identities and reset credentials to the approved two distinct disposable accounts',()=>{
 for(const users of [[plan.users[0],plan.users[0]],[{...plan.users[0],email:'vulpes-owner@example.invalid'},plan.users[1]],[{...plan.users[0],nextPassword:plan.users[0].password},plan.users[1]]])expect(LifecyclePlanSchema.safeParse({...plan,users}).success).toBe(false);
});
it('does not reset or delete a pre-existing/mismatched identity and emits only a safe failed receipt',async()=>{
 const artifacts={read:async(name:string)=>({id:plan.users[name==='created-0'?0:1].id,projectRef:plan.projectRef,runId:plan.runId}),write:vi.fn()};
 const network=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({user:{id:plan.users[0].id,email:plan.users[0].email,app_metadata:{vulpes_rehearsal:'different-run'},user_metadata:{secret:'private-response-canary'}}}),{headers:{'Content-Type':'application/json'}}));
 const report=await hostedLifecycle({...base,phase:'reset',artifacts},network);
 expect(report.status).toBe('failed');expect(report.reason).toBe('owned_identity_mismatch');expect(artifacts.write).not.toHaveBeenCalled();expect(network.mock.calls.every(([,init])=>!init?.method||init.method==='GET')).toBe(true);
 expect(JSON.stringify(report)).not.toContain('private-response-canary');expect(JSON.stringify(report)).not.toContain(plan.users[0].password);
});
it('refuses a pre-existing approved email before provisioning or writing a creation receipt',async()=>{
 const artifacts={read:vi.fn(),write:vi.fn()};const network=vi.fn<typeof fetch>(async()=>new Response(JSON.stringify({users:[{id:randomUUID(),email:plan.users[0].email}],aud:'authenticated'}),{headers:{'Content-Type':'application/json'}}));
 const report=await hostedLifecycle({...base,phase:'provision',artifacts},network);
 expect(report.status).toBe('failed');expect(report.reason).toBe('preexisting_disposable_identity');expect(artifacts.write).not.toHaveBeenCalled();expect(network.mock.calls).toHaveLength(1);expect(network.mock.calls[0]?.[1]?.method).toBe('GET');
});
it('refuses mismatched local creation receipts before looking up or mutating remote identities',async()=>{
 const network=vi.fn(),artifacts={read:async()=>({id:randomUUID(),projectRef:plan.projectRef,runId:randomUUID()}),write:vi.fn()};
 const report=await hostedLifecycle({...base,phase:'delete-start',artifacts},network);
 expect(report.status).toBe('failed');expect(report.reason).toBe('creation_receipt_mismatch');expect(network).not.toHaveBeenCalled();expect(artifacts.write).not.toHaveBeenCalled();
});

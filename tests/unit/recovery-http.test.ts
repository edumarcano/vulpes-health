import {randomUUID} from 'node:crypto';
import {expect,it,vi} from 'vitest';
import {RecoveryHttpSchema} from '../../scripts/recovery-http.js';
import {databaseRecoveryBinding,databaseRecoveryCommand} from '../../scripts/hosted-database-recovery.js';

const proof={authImage:'sha256:'+'a'.repeat(64),restImage:'sha256:'+'b'.repeat(64),users:Array.from({length:3},()=>({id:randomUUID(),email:randomUUID()+'@example.invalid',password:'synthetic-only-password'}))};
it('binds exact cached services and synthetic identities without including password material',()=>{
 const bind=(http=proof)=>databaseRecoveryBinding(Buffer.from('archive'),proof.authImage,Buffer.from('journal'),'latest.enc',http);
 expect(bind({...proof,users:proof.users.map(u=>({...u,password:'changed-synthetic-password'}))})).toBe(bind());
 expect(bind({...proof,authImage:proof.restImage})).not.toBe(bind());
 expect(bind({...proof,users:proof.users.map((u,i)=>i?u:{...u,id:randomUUID()})})).not.toBe(bind());
 for(const patch of [{authImage:'supabase/auth:latest'},{users:[proof.users[0]!,proof.users[0]!,proof.users[1]!]},{users:proof.users.map(u=>({...u,email:'person@example.com'}))}])expect(()=>RecoveryHttpSchema.parse({...proof,...patch})).toThrow();
});
it('refuses HTTP mode outside explicitly approved recovery before reading private input',async()=>{
 const read=vi.fn();await expect(databaseRecoveryCommand(['--restore','--verify-http','--allow-fenced-restore','--manifest=missing','--archive=missing','--image='+proof.authImage],read)).rejects.toThrow('explicit recovery');expect(read).not.toHaveBeenCalled();
});

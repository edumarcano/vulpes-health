import { useCallback,useEffect, useRef, useState, type ReactNode } from 'react';
import { createClient } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { publicAuthConfig } from '../../../shared/auth';
import { AuthContext, type AuthState } from './auth-context';
import { IdentityScope } from './identity';
import type {Session} from '@supabase/supabase-js';
import {AccountStatusSchema,type AccountStatus} from '../../../shared/account';
import {successEnvelopeSchema} from '../../../shared/api';
import {ownedJson} from '../api';

export const SESSION_STORAGE_KEY = 'vulpes.auth.session.v1';
function createBrowserAuth() {
  try {
    const config = publicAuthConfig(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
    return config ? createClient(config.url,config.key,{ auth:{ persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storageKey:SESSION_STORAGE_KEY } }) : null;
  } catch { return null; }
}
const client = createBrowserAuth();
async function forgetDeviceSession(){
 let message:string|undefined;
 try{const result=await client?.auth.signOut({scope:'local'});if(result?.error)message='This device was cleared. Remote sign-out could not be confirmed; reconnect before relying on session revocation.';}
 catch{message='This device was cleared. Remote sign-out could not be confirmed; reconnect before relying on session revocation.';}
 try{localStorage.removeItem(SESSION_STORAGE_KEY);}catch{message='Local session storage could not be cleared. Close this browser before another account uses this device.';}
 return message;
}
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [scope] = useState(() => new IdentityScope(() => { void queryClient.cancelQueries(); queryClient.clear(); }));
  const [state,setState] = useState<AuthState>({ kind:client ? 'restoring' : 'unconfigured' });
  const operation = useRef<'idle'|'signing_in'|'signing_out'>('idle');
  const checkSequence=useRef(0);
  const knownAccount=useRef<{userId:string;mode:'active'|'deleting'}|null>(null);
  const restrictDeletion=useCallback((owner:string)=>{
    if(knownAccount.current?.userId===owner&&knownAccount.current.mode==='deleting')return;
    scope.transition(owner,true);knownAccount.current={userId:owner,mode:'deleting'};
  },[scope]);
  const completeDeletion=useCallback(async(receiptId:string)=>{
    checkSequence.current++;operation.current='signing_out';knownAccount.current=null;scope.transition(null,true);
    try{const message=await forgetDeviceSession();setState({kind:'deletion_completed',receiptId,...(message?{message}:{})});}
    finally{operation.current='idle';}
  },[scope]);
  const loadAccount=useCallback(async(session:Session)=>{
    const sequence=++checkSequence.current;
    scope.transition(session.user.id);const epoch=scope.epoch;
    if(knownAccount.current?.userId!==session.user.id)setState({kind:'checking_account',session});
    else setState(current=>'session' in current&&current.session.user.id===session.user.id?{...current,session}:current);
    try{
      const status=successEnvelopeSchema(AccountStatusSchema).parse(await ownedJson('/api/account',session.access_token,scope,epoch)).data;
      if(status.state==='deleting' && status.phase==='completed'){
        if(scope.epoch===epoch && checkSequence.current===sequence)await completeDeletion(status.receiptId);
        return;
      }
      scope.commit(epoch,()=>{
        if(checkSequence.current!==sequence)return;
        if(status.state==='active'){knownAccount.current={userId:session.user.id,mode:'active'};setState({kind:'signed_in',session});}
        else {restrictDeletion(session.user.id);setState({kind:'deleting',session,status});}
      });
    }catch{scope.commit(epoch,()=>{if(checkSequence.current===sequence)setState({kind:'account_unavailable',session,message:'Account access could not be verified. If deletion was underway, authentication failure does not confirm completion. Retry or contact the operator with your saved receipt.'});});}
  },[scope,completeDeletion,restrictDeletion]);
  useEffect(() => {
    if (!client) return;
    const { data } = client.auth.onAuthStateChange((event,session) => {
      if (operation.current !== 'idle') return;
      if (event === 'TOKEN_REFRESHED' && (!session || scope.userId !== session.user.id)) return;
      if (session) {
        // Avoid awaiting another auth operation inside Supabase's state callback.
        const epoch=scope.epoch;queueMicrotask(()=>{if(operation.current==='idle'&&scope.epoch===epoch)void loadAccount(session);});
      } else { knownAccount.current=null;scope.transition(null); setState({ kind:'signed_out' }); }
    });
    return () => { data.subscription.unsubscribe(); };
  },[scope,loadAccount]);
  async function signIn(email: string,password: string) {
    if (!client || operation.current !== 'idle') return;
    checkSequence.current++;operation.current = 'signing_in';knownAccount.current=null;scope.transition(null,true); setState({ kind:'signing_in' });
    try {
      const { data,error } = await client.auth.signInWithPassword({ email,password });
      if (error || !data.session) { setState({ kind:'signed_out',message:'Sign-in failed. Check your credentials and connection.' }); return; }
      await loadAccount(data.session);
    } catch { setState({ kind:'signed_out',message:'Sign-in failed. Check your credentials and connection.' }); }
    finally { operation.current = 'idle'; }
  }
  async function signOut() {
    if (!client || operation.current !== 'idle') return;
    checkSequence.current++;operation.current = 'signing_out';knownAccount.current=null;scope.transition(null,true); setState({ kind:'signing_out' });
    try{const message=await forgetDeviceSession();setState({kind:'signed_out',...(message?{message}:{})});}
    finally{operation.current='idle';}
  }
  async function reauthenticate(password:string){
    if(!client || state.kind!=='signed_in' || !state.session.user.email || operation.current!=='idle')throw new Error('Sign in with your password again.');
    const epoch=scope.epoch;operation.current='signing_in';
    try{
      const result=await client.auth.signInWithPassword({email:state.session.user.email,password});
      if(result.error || !result.data.session || result.data.session.user.id!==scope.userId || scope.epoch!==epoch)throw new Error('Password sign-in failed. Check your connection and credentials.');
      setState({kind:'signed_in',session:result.data.session});return result.data.session;
    }finally{operation.current='idle';}
  }
  async function enterDeletion(status:Extract<AccountStatus,{state:'deleting'}>,fresh?:Session){
    if(!('session' in state))return;
    const session=fresh??state.session;
    if(session.user.id!==scope.userId)return;
    if(status.phase==='completed'){
      await completeDeletion(status.receiptId);
    }else {
      checkSequence.current++;restrictDeletion(session.user.id);
      setState(current=>'session' in current&&current.session.user.id===session.user.id
        ?{kind:'deleting',session:fresh??current.session,status}:current);
    }
  }
  async function checkAccount(){if('session' in state)await loadAccount(state.session);}
  return <AuthContext.Provider value={{ state,scope,signIn,signOut,checkAccount,reauthenticate,enterDeletion }}>{children}</AuthContext.Provider>;
}

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createClient } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { publicAuthConfig } from '../../../shared/auth';
import { AuthContext, type AuthState } from './auth-context';
import { IdentityScope } from './identity';

export const SESSION_STORAGE_KEY = 'vulpes.auth.session.v1';
function createBrowserAuth() {
  try {
    const config = publicAuthConfig(import.meta.env.VITE_SUPABASE_URL, import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY);
    return config ? createClient(config.url,config.key,{ auth:{ persistSession:true,autoRefreshToken:true,detectSessionInUrl:false,storageKey:SESSION_STORAGE_KEY } }) : null;
  } catch { return null; }
}
const client = createBrowserAuth();
export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [scope] = useState(() => new IdentityScope(() => { void queryClient.cancelQueries(); queryClient.clear(); }));
  const [state,setState] = useState<AuthState>({ kind:client ? 'restoring' : 'unconfigured' });
  const operation = useRef<'idle'|'signing_in'|'signing_out'>('idle');
  useEffect(() => {
    if (!client) return;
    const { data } = client.auth.onAuthStateChange((event,session) => {
      if (operation.current !== 'idle') return;
      if (event === 'TOKEN_REFRESHED' && (!session || scope.userId !== session.user.id)) return;
      if (session) {
        scope.transition(session.user.id);
        setState({ kind:'signed_in',session });
      } else { scope.transition(null); setState({ kind:'signed_out' }); }
    });
    return () => { data.subscription.unsubscribe(); };
  },[scope]);
  async function signIn(email: string,password: string) {
    if (!client || operation.current !== 'idle') return;
    operation.current = 'signing_in'; scope.transition(null,true); setState({ kind:'signing_in' });
    try {
      const { data,error } = await client.auth.signInWithPassword({ email,password });
      if (error || !data.session) { setState({ kind:'signed_out',message:'Sign-in failed. Check your credentials and connection.' }); return; }
      scope.transition(data.session.user.id); setState({ kind:'signed_in',session:data.session });
    } catch { setState({ kind:'signed_out',message:'Sign-in failed. Check your credentials and connection.' }); }
    finally { operation.current = 'idle'; }
  }
  async function signOut() {
    if (!client || operation.current !== 'idle') return;
    operation.current = 'signing_out'; scope.transition(null,true); setState({ kind:'signing_out' });
    let message: string | undefined;
    try { const result = await client.auth.signOut({ scope:'local' }); if (result.error) message = 'This device was cleared. Remote sign-out could not be confirmed; reconnect before relying on session revocation.'; }
    catch { message = 'This device was cleared. Remote sign-out could not be confirmed; reconnect before relying on session revocation.'; }
    finally {
      try { localStorage.removeItem(SESSION_STORAGE_KEY); } catch { message = 'Local session storage could not be cleared. Close this browser before another account uses this device.'; }
      operation.current = 'idle'; setState({ kind:'signed_out',...(message ? { message } : {}) });
    }
  }
  return <AuthContext.Provider value={{ state,scope,signIn,signOut }}>{children}</AuthContext.Provider>;
}

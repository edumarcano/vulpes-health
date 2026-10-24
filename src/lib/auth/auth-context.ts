import { createContext, useContext } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { IdentityScope } from './identity';
export type AuthState = { kind: 'unconfigured' | 'restoring' | 'signed_out' | 'signing_in' | 'signing_out'; message?: string } | { kind: 'signed_in'; session: Session };
export interface AuthValue {
  state: AuthState; scope: IdentityScope;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
}
export const AuthContext = createContext<AuthValue | null>(null);
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('Missing authentication boundary.');
  return context;
}

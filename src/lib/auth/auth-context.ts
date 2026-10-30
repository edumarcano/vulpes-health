import { createContext, useContext } from 'react';
import type { Session } from '@supabase/supabase-js';
import type { IdentityScope } from './identity';
import type {AccountStatus} from '../../../shared/account';
export type AuthState = { kind: 'unconfigured' | 'restoring' | 'signed_out' | 'signing_in' | 'signing_out'; message?: string }
  | {kind:'signed_in'|'checking_account';session:Session}
  | {kind:'account_unavailable';session:Session;message:string}
  | {kind:'deleting';session:Session;status:Extract<AccountStatus,{state:'deleting'}>}
  | {kind:'deletion_completed';receiptId:string;message?:string};
export interface AuthValue {
  state: AuthState; scope: IdentityScope;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  checkAccount():Promise<void>;
  reauthenticate(password:string):Promise<Session>;
  enterDeletion(status:Extract<AccountStatus,{state:'deleting'}>,session?:Session):Promise<void>;
}
export const AuthContext = createContext<AuthValue | null>(null);
export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('Missing authentication boundary.');
  return context;
}

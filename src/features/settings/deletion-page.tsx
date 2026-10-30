import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Card} from '@/components/ui/card';
import {useAuth} from '@/lib/auth/auth-context';
import {ownedJson} from '@/lib/api';
import {AccountStatusSchema} from '../../../shared/account';
import {successEnvelopeSchema} from '../../../shared/api';

const phaseLabels={fenced:'New activity blocked; private removal is pending.',private_content_purged:'Private content removed; accounting cleanup is pending.',awaiting_settlement:'Finishing accounting and application cleanup.',app_data_purged:'Application data removed; identity removal is pending.',auth_removal_pending:'Identity removal is not yet confirmed.',completed:'Application data and identity removal confirmed.'};
export function DeletionPage(){
 const {state,scope,enterDeletion,checkAccount,signOut}=useAuth();const [operation,setOperation]=useState<'idle'|'continuing'>('idle');const [message,setMessage]=useState('');
 const heading=useRef<HTMLHeadingElement>(null);useEffect(()=>{heading.current?.focus();},[state.kind]);
 if(state.kind==='deletion_completed')return <Card className="settings-card account-lifecycle-card"><h1 ref={heading} tabIndex={-1}>Account deletion completed</h1><p>Application data and identity removal were confirmed by the server.</p><p>Receipt: <code>{state.receiptId}</code></p><p>Encrypted offline backups rotate within 30 days. Third-party provider security records follow their own contractual policies.</p>{state.message&&<p role="alert">{state.message}</p>}<Button onClick={()=>void signOut()}>Return to sign in</Button></Card>;
 if(state.kind==='account_unavailable')return <Card className="settings-card account-lifecycle-card"><h1 ref={heading} tabIndex={-1}>Account status unconfirmed</h1><p role="alert">{state.message}</p><Button onClick={()=>void checkAccount()}>Retry account status</Button><Button variant="outline" onClick={()=>void signOut()}>Sign out</Button></Card>;
 if(state.kind!=='deleting')return null;
 const {status,session}=state;
 async function continueRemoval(){
  if(operation!=='idle')return;setOperation('continuing');setMessage('');const epoch=scope.epoch;
  try{const value=successEnvelopeSchema(AccountStatusSchema).parse(await ownedJson('/api/account',session.access_token,scope,epoch,{method:'POST',body:JSON.stringify({action:'continue_delete'})})).data;
   if(value.state!=='deleting')throw new Error('Deletion status is unconfirmed.');
   if(scope.epoch===epoch)await enterDeletion(value);
  }catch{scope.commit(epoch,()=>setMessage('Deletion completion is unconfirmed. Retry, or contact the operator with the receipt below. Signing out or losing access does not confirm removal.'));}
  finally{setOperation('idle');}
 }
 return <Card className="settings-card account-lifecycle-card"><h1 ref={heading} tabIndex={-1}>Account deletion in progress</h1><p role="status">{phaseLabels[status.phase]}</p><p>Receipt: <code>{status.receiptId}</code></p><p>Save this receipt before signing out. Removal runs in bounded steps when you continue or the operator runs maintenance.</p>
  {status.outcome==='waiting_for_accounting'&&<p>Unknown sent charges remain reserved for up to 24 hours. Continue after {status.retryAfter?new Date(status.retryAfter).toLocaleString():'the settlement window'}, or ask the operator to resume maintenance. Private content has already been removed.</p>}
  <Button disabled={operation==='continuing'} onClick={()=>void continueRemoval()}>{operation==='continuing'?'Continuing removal…':'Continue account deletion'}</Button><Button variant="outline" disabled={operation==='continuing'} onClick={()=>void checkAccount()}>Refresh deletion status</Button><Button variant="outline" onClick={()=>void signOut()}>Sign out</Button><p role="alert">{message}</p>
 </Card>;
}

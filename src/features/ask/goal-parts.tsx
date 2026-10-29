import { useState,useEffect,useRef } from 'react';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { z } from 'zod';
import { ChatPartSchema } from '../../../shared/chat';
import { useAuth } from '@/lib/auth/auth-context';
import { ownedJson } from '@/lib/api';
import { Card } from '@/components/ui/card';
import { GoalProposalReview,Progress } from '../goals/goals-page';

export function ProposalPart({data}:{data:unknown}){
 const parsed=ChatPartSchema.safeParse(data);
 if(!parsed.success||parsed.data.type!=='goal_proposal')return <p>Goal proposal unavailable.</p>;
 return <OwnedProposal key={parsed.data.reference.proposalId} reference={parsed.data.reference}/>;
}
function OwnedProposal({reference}:{reference:Extract<z.infer<typeof ChatPartSchema>,{type:'goal_proposal'}>['reference']}){
 const {state,scope}=useAuth();const epoch=scope.epoch;const token=state.kind==='signed_in'?state.session.access_token:'';const client=useQueryClient();
 const root=['goals',scope.userId,epoch];const [notice,setNotice]=useState('');const [busy,setBusy]=useState(false);
 const status=useRef<HTMLParagraphElement>(null);useEffect(()=>{if(notice)status.current?.focus();},[notice]);
 const query=useQuery({queryKey:[...root,'proposal',reference.proposalId],enabled:!!token,retry:false,
   queryFn:async()=>z.object({data:z.record(z.string(),z.json())}).parse(await ownedJson('/api/goals?view=proposal&id='+reference.proposalId,token,scope,epoch)).data,
   refetchInterval:q=>q.state.data?.state==='pending'?5000:false,
 });
 const proposal=query.data;const valid=proposal?.id===reference.proposalId&&proposal.payload_hash===reference.payloadHash&&proposal.target_version===reference.expectedVersion;
 async function decide(action:'approve'|'reject'){
   setBusy(true);setNotice('');
   try{await ownedJson('/api/approvals',token,scope,epoch,{method:'POST',body:JSON.stringify({action,proposal_id:reference.proposalId,payload_hash:reference.payloadHash,expected_version:reference.expectedVersion,client_request_id:crypto.randomUUID()})});scope.commit(epoch,()=>setNotice(action==='approve'?'Goal approved.':'Proposal rejected.'));}
   catch(error){scope.commit(epoch,()=>setNotice(error instanceof Error?error.message:'Refresh and review the proposal.'));}
   finally{scope.commit(epoch,()=>{setBusy(false);void client.invalidateQueries({queryKey:root});void client.invalidateQueries({queryKey:['conversations',scope.userId,epoch]});});}
 }
 const result=z.object({goalId:z.uuid()}).safeParse(proposal?.result);
 return <Card className="chat-evidence">{query.isPending?<p>Loading goal proposal…</p>:!valid?<p role="alert">The goal proposal is unavailable. Refresh the conversation to review saved state.</p>:<GoalProposalReview proposal={proposal} busy={busy||query.isFetching} decide={decide}/>}<p ref={status} tabIndex={-1} role="status">{notice}</p>{result.success&&<Link to={'/goals?goal='+result.data.goalId}>Open approved goal</Link>}{query.isError&&<button onClick={()=>void query.refetch()}>Refresh proposal</button>}</Card>;
}
export function ProgressPart({data}:{data:unknown}){
 const parsed=ChatPartSchema.safeParse(data);
 if(!parsed.success||parsed.data.type!=='goal_progress')return <p>Goal progress unavailable.</p>;
 return <Card className="chat-evidence"><Progress value={parsed.data.result}/><Link to={'/goals?goal='+parsed.data.goalId}>Open Goals for current progress</Link></Card>;
}

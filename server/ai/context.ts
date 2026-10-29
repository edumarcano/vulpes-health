import { GenerationRequestSchema,type GenerationRequest } from './contracts.js';
import type { AuthContext } from '../auth/session.js';
import { readPayload } from '../security/private-payloads.js';
import { requestHash } from './ledger/execution.js';
import { safetyInstructions,templateVersion } from './prompts/everyday.js';
import { HttpFailure } from '../http/failure.js';
import type { ChatSendRequest } from '../../shared/api.js';
import type { ContextManifest } from '../../shared/domain.js';
import { blocksOf,continuationFor } from './continuation.js';

export interface ContextGroup {id:string;turns:GenerationRequest['turns'];continuation:GenerationRequest['continuation']}
export function boundContext(essential:GenerationRequest,groups:ContextGroup[],maxBytes:number) {
  const excluded:{referenceId:string;reason:string}[]=[];
  const selected=[...groups];
  const compose=():GenerationRequest=>{
    let offset=1;
    const blocks=selected.flatMap(g=>{const adjusted=blocksOf(g.continuation).map(b=>({...b,at:b.at+offset}));offset+=g.turns.length;return adjusted;});
    return {...essential,turns:[essential.turns[0]!,...selected.flatMap(g=>g.turns),...essential.turns.slice(1)],continuation:continuationFor(blocks)};
  };
  while(Buffer.byteLength(JSON.stringify(compose()))>maxBytes && selected.length)excluded.push({referenceId:selected.shift()!.id,reason:'context_limit'});
  const request=compose();
  if(Buffer.byteLength(JSON.stringify(request))>maxBytes)throw new HttpFailure(413,'context_too_large','The essential context cannot fit. Start a shorter question.');
  return {request:GenerationRequestSchema.parse(request),excluded,selected};
}
export async function buildContext(context:AuthContext,input:ChatSendRequest,runId:string,tools:GenerationRequest['tools'],maxBytes:number) {
  const profile=await context.db.from('profiles').select('timezone,units,data_revision').eq('user_id',context.userId).single();
  if(profile.error)throw new HttpFailure(503,'context_unavailable','Context could not be loaded.');
  const goals=await context.db.from('goals').select('id').eq('user_id',context.userId).neq('state','draft').neq('state','archived').not('current_revision_id','is',null).limit(1);
  if(goals.error)throw new HttpFailure(503,'context_unavailable','Goal context could not be loaded.');
  if(!goals.data.length)tools=tools.filter(tool=>tool.name!=='propose_goal_revision');
  let selectedGoal:unknown=null;
  if(input.context_selection?.goal_id) {
    const goal=await context.db.from('goals').select('id,title,state,version,review_status,current_revision_id').eq('user_id',context.userId).eq('id',input.context_selection.goal_id).single();
    if(goal.error)throw new HttpFailure(404,'goal_not_found','The selected goal was not found.');
    selectedGoal={id:goal.data.id,state:'unavailable',reason:'No approved goal revision is available.'};
    if(goal.data.state!=='draft'&&goal.data.current_revision_id) {
      const revision=await context.db.from('goal_revisions').select('id,revision_number,payload,approved_proposal_id').eq('user_id',context.userId).eq('goal_id',goal.data.id).eq('id',goal.data.current_revision_id).maybeSingle();
      if(revision.error)throw new HttpFailure(503,'context_unavailable','The selected revision could not be read.');
      if(revision.data) {
        const approval=await context.db.from('action_proposals').select('state').eq('user_id',context.userId).eq('id',revision.data.approved_proposal_id).maybeSingle();
        if(approval.error)throw new HttpFailure(503,'context_unavailable','The selected approval could not be checked.');
        if(approval.data?.state==='approved')selectedGoal={...goal.data,revision:{id:revision.data.id,revisionNumber:revision.data.revision_number,payload:revision.data.payload}};
      }
    }
  }
  const history=await context.db.from('messages').select('*').eq('user_id',context.userId).eq('conversation_id',input.conversation_id).neq('run_id',runId).order('created_at',{ascending:false}).order('id',{ascending:false}).limit(200);
  if(history.error)throw new HttpFailure(503,'context_unavailable','History could not be loaded.');
  const groups:ContextGroup[]=[];const exclusions:{referenceId:string;reason:string}[]=[];
  const ids=[...new Set(history.data.map(m=>m.run_id).filter((id):id is string=>id!==null))].reverse();
  for(const id of ids) {
    const pair=history.data.filter(m=>m.run_id===id);
    const run=await context.db.from('ai_runs').select('status,data_revision,trace_content_removed_at').eq('user_id',context.userId).eq('id',id).maybeSingle();
    if(run.error)throw new HttpFailure(503,'context_unavailable','History could not be loaded.');
    if(pair.length!==2 || pair.some(m=>m.status!=='completed'||m.context_state!=='eligible') || run.data?.status!=='completed' || run.data.data_revision!==profile.data.data_revision || run.data.trace_content_removed_at) {exclusions.push({referenceId:id,reason:'incomplete_or_invalidated'});continue;}
    const step=await context.db.from('ai_steps').select('continuation_payload_id').eq('user_id',context.userId).eq('run_id',id).order('sequence',{ascending:false}).limit(1).maybeSingle();
    if(step.error)throw new HttpFailure(503,'context_unavailable','History could not be loaded.');
    if(!step.data) {
      const turns=pair.sort((a,b)=>a.role==='user'?-1:b.role==='user'?1:0).flatMap(m=>Array.isArray(m.content_parts) ? m.content_parts.flatMap(part=>part && typeof part==='object' && !Array.isArray(part) && part.type==='text' && typeof part.text==='string' ? [{type:'message' as const,role:m.role as 'user'|'assistant',text:part.text}] : []) : []);
      groups.push({id,turns,continuation:null});continue;
    }
    if(!step.data.continuation_payload_id){exclusions.push({referenceId:id,reason:'continuation_unavailable'});continue;}
    const payload=await readPayload(context,step.data.continuation_payload_id,'provider_state');
    if(payload.state!=='available'){exclusions.push({referenceId:id,reason:'continuation_'+payload.state});continue;}
    let parsed:unknown;
    try{parsed=JSON.parse(payload.bytes.toString('utf8'));}catch{exclusions.push({referenceId:id,reason:'continuation_invalid'});continue;}
    const saved=GenerationRequestSchema.safeParse(parsed);
    if(!saved.success){exclusions.push({referenceId:id,reason:'continuation_invalid'});continue;}
    groups.push({id,turns:saved.data.turns,continuation:saved.data.continuation});
  }
  const essential:GenerationRequest={turns:[{type:'message',role:'system',text:safetyInstructions},{type:'message',role:'system',text:JSON.stringify({profile:profile.data,selection:input.context_selection,selectedGoal})},{type:'message',role:'user',text:input.message.text}],tools,continuation:null};
  const bounded=boundContext(essential,groups,maxBytes);
  const manifest:ContextManifest={captureVersion:2,templateVersion,included:[{reference:{id:`instruction:${templateVersion}`,kind:'instruction',label:'Safety instruction template'},contentHash:requestHash(safetyInstructions),tokenEstimate:Buffer.byteLength(safetyInstructions)},{reference:{id:'profile:timezone_units',kind:'profile_field',label:'Timezone and unit preferences'},contentHash:requestHash(profile.data),tokenEstimate:Buffer.byteLength(JSON.stringify(profile.data))},...bounded.selected.map(g=>({reference:{id:g.id,kind:'message' as const,label:'Complete conversation group'},contentHash:requestHash(g),tokenEstimate:Buffer.byteLength(JSON.stringify(g))}))],excluded:[...exclusions,...bounded.excluded],retrieval:{ragUsed:false,webUsed:false},consentVersion:'openrouter_zdr_v1',dataRevision:profile.data.data_revision};
  if(input.context_selection)manifest.included.push({reference:{id:`selection:${input.message.id}`,kind:'context_selection',label:'Selected data scope'},contentHash:requestHash(input.context_selection),tokenEstimate:Buffer.byteLength(JSON.stringify(input.context_selection))});
  if(selectedGoal!==null)manifest.included.push({reference:{id:`goal:${input.context_selection!.goal_id}`,kind:'goal_context',label:'Selected goal and revision status'},contentHash:requestHash(selectedGoal),tokenEstimate:Buffer.byteLength(JSON.stringify(selectedGoal))});
  manifest.included.push({reference:{id:input.message.id,kind:'message',label:'Current user message'},contentHash:requestHash(input.message.text),tokenEstimate:Buffer.byteLength(input.message.text)});
  return {...bounded,manifest,dataRevision:profile.data.data_revision};
}

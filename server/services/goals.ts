import { Temporal } from '@js-temporal/polyfill';
import { z } from 'zod';
import { GoalDefinitionSchema, GoalRevisionPayloadSchema, goalTransitions, type GoalDefinition, type GoalMutation, type FrozenBaseline, type GoalRevisionPayload } from '../../shared/goals.js';
import { GoalDraftSchema } from '../../shared/domain.js';
import type { ApprovalRequest } from '../../shared/api.js';
import type { AuthContext } from '../auth/session.js';
import { administrativeClient } from '../db/administrative.js';
import { HttpFailure } from '../http/failure.js';
import { goalPolicyAllows } from '../security/goal-policy.js';
import { goalObservations,readData } from './measurements.js';
import { selectionWindows,summarizeMeasurementsExact } from '../analytics/summary.js';
import { goalProgress } from '../analytics/goals.js';

export class GoalService {
  constructor(private readonly context:AuthContext) {}
  private fail(message:string):never {
    const status=message==='goal_not_found'?404:message==='goal_conflict'?409:message==='account_unavailable'?403:message==='invalid_goal'?400:503;
    throw new HttpFailure(status,message.startsWith('goal_')?message:'goals_unavailable','The goal operation could not proceed. Refresh and review.');
  }
  async expire(){const {error}=await administrativeClient().rpc('expire_goal_proposals_v1',{p_owner:this.context.userId});if(error)this.fail(error.message);}
  async owned(id:string){
    const {data,error}=await this.context.db.from('goals').select('*').eq('user_id',this.context.userId).eq('id',id).maybeSingle();
    if(error)this.fail(error.message);if(!data)this.fail('goal_not_found');return data;
  }
  async revision(id:string){
    const goal=await this.owned(id);
    const {data,error}=await this.context.db.from('goal_revisions').select('*').eq('user_id',this.context.userId).eq('goal_id',id).eq('id',goal.current_revision_id??'00000000-0000-4000-8000-000000000000').maybeSingle();
    if(error)this.fail(error.message);if(!data)this.fail('goal_not_found');
    const approval=await this.context.db.from('action_proposals').select('state').eq('user_id',this.context.userId).eq('id',data.approved_proposal_id).maybeSingle();
    if(approval.error)this.fail(approval.error.message);if(approval.data?.state!=='approved')this.fail('goal_not_found');
    return {goal,revision:data};
  }
  async proposal(id:string){
    await this.expire();
    const {data,error}=await this.context.db.from('action_proposals').select('*').eq('user_id',this.context.userId).eq('id',id).maybeSingle();
    if(error)this.fail(error.message);if(!data)this.fail('goal_not_found');return data;
  }
  private async baseline(d:GoalDefinition):Promise<FrozenBaseline>{
    const from=d.baselineFrom??Temporal.Now.instant().toString();const to=d.baselineTo??Temporal.Now.instant().add({seconds:1}).toString();
    const selection={metric:d.metric,source_id:d.sourceId,method:d.method,granularity:d.granularity,timezone:d.timezone,from,to};
    const profile=await this.context.db.from('profiles').select('data_revision').eq('user_id',this.context.userId).single();if(profile.error)this.fail(profile.error.message);
    if(d.baselineMethod==='user_reported')return {schemaVersion:2,selection,value:String(d.reportedBaseline),dataRevision:profile.data.data_revision,algorithmVersion:'user_reported_v1',provenance:'user_reported',references:[]};
    if(d.baselineMethod==='daily_median_mean_7d'){
      const a=Temporal.Instant.from(from).toZonedDateTimeISO(d.timezone);const b=Temporal.Instant.from(to).toZonedDateTimeISO(d.timezone);
      if(!a.equals(b.subtract({days:7})))throw new HttpFailure(400,'invalid_interval','Choose exactly seven local calendar days.');
      try{selectionWindows(selection);}catch{throw new HttpFailure(400,'invalid_interval','Choose seven complete local calendar days.');}
      const data=await goalObservations(this.context,selection);const calculation=summarizeMeasurementsExact(data.rows,selection,data.revision);
      return {schemaVersion:2,selection,value:calculation.exactValue,dataRevision:data.revision,algorithmVersion:'daily_median_mean_7d_v1',provenance:'calculated',references:data.rows.map(x=>({id:x.id,version:x.version}))};
    }
    const data=await goalObservations(this.context,selection);
    const items=data.rows.sort((a,b)=>(d.granularity==='daily_total'?(b.local_date??'').localeCompare(a.local_date??''):b.observed_at.localeCompare(a.observed_at)));
    const first=items[0];const tied=first?items.filter(x=>(d.granularity==='daily_total'?x.local_date===first.local_date:x.observed_at===first.observed_at)):[];
    return {schemaVersion:2,selection,value:first&&new Set(tied.map(x=>x.canonical_value)).size===1?first.canonical_value:null,dataRevision:data.revision,algorithmVersion:'latest_value_v1',provenance:'calculated',references:tied.map(x=>({id:x.id,version:x.version}))};
  }
  async propose(request:GoalMutation){
    const receipt=await administrativeClient().from('audit_events').select('object_id,safe_metadata').eq('user_id',this.context.userId).eq('event_type','goal_propose_v1').filter('safe_metadata->>request_id','eq',request.client_request_id).maybeSingle();
    if(receipt.error)this.fail(receipt.error.message);
    if(receipt.data){const result=await administrativeClient().rpc('register_goal_proposal_v1',{p_owner:this.context.userId,p_request:request,p_payload:{}});if(result.error)this.fail(result.error.message);return this.proposal(z.uuid().parse(result.data));}
    const payload=await this.prepareProposal(request);
    const {data,error}=await administrativeClient().rpc('register_goal_proposal_v1',{p_owner:this.context.userId,p_request:request,p_payload:payload});
    if(error)this.fail(error.message);return this.proposal(z.uuid().parse(data));
  }
  async prepareProposal(request:GoalMutation):Promise<GoalRevisionPayload>{
    if(request.action!=='propose_state'){
      const source=await this.context.db.from('data_sources').select('id').eq('user_id',this.context.userId).eq('id',request.definition.sourceId).maybeSingle();
      if(source.error)this.fail(source.error.message);if(!source.data)this.fail('goal_not_found');
    }
    let payload:GoalRevisionPayload;
    if(request.action==='propose_create'){
      const definition=GoalDefinitionSchema.parse(request.definition);const baseline=await this.baseline(definition);
      payload={schemaVersion:2,definition,baseline,state:baseline.value===null?'needs_data':'active',baselineResolution:'replace',reviewedDataRevision:baseline.dataRevision};
    }else{
      const {goal,revision}=await this.revision(request.goal_id);if(goal.version!==request.expected_version||goal.state==='archived')this.fail('goal_conflict');
      const previous=GoalRevisionPayloadSchema.safeParse(revision.payload);if(!previous.success)throw new HttpFailure(409,'unsupported_revision','This historical revision requires a fresh reviewed definition.');
      const profile=await this.context.db.from('profiles').select('data_revision').eq('user_id',this.context.userId).single();if(profile.error)this.fail(profile.error.message);
      if(request.action==='propose_state'){
        if(!goalTransitions[goal.state]?.includes(request.state)||request.state==='active'&&(goal.review_status!=='clear'||previous.data.baseline.value===null))this.fail('goal_conflict');
        payload={...previous.data,state:request.state,baselineResolution:'retain',reviewedDataRevision:profile.data.data_revision};
      }else{
        const definition=GoalDefinitionSchema.parse(request.definition);
        if(request.baseline_resolution==='retain'&&JSON.stringify({...definition,title:'',target:null,targetDate:null,constraints:[],proposedStrategy:null})!==JSON.stringify({...previous.data.definition,title:'',target:null,targetDate:null,constraints:[],proposedStrategy:null}))throw new HttpFailure(400,'invalid_baseline','Replace the baseline when changing its series or method.');
        const baseline=request.baseline_resolution==='retain'?previous.data.baseline:await this.baseline(definition);
        payload={schemaVersion:2,definition,baseline,state:baseline.value===null&&goal.state==='active'?'needs_data':goal.state==='needs_data'&&baseline.value!==null?'active':goal.state as GoalRevisionPayload['state'],baselineResolution:request.baseline_resolution,reviewedDataRevision:profile.data.data_revision};
      }
    }
    if(!goalPolicyAllows(payload.definition))throw new HttpFailure(403,'goal_policy','Vulpes cannot help pursue unsafe treatment or targets.');
    return payload;
  }
  async decide(request:ApprovalRequest){
    const current=await this.proposal(request.proposal_id);
    if(request.action==='approve'&&current.state==='pending'&&!goalPolicyAllows(current.canonical_payload))throw new HttpFailure(403,'goal_policy','This proposal cannot be approved.');
    const {data,error}=await administrativeClient().rpc('decide_goal_proposal_v1',{p_owner:this.context.userId,p_request:request});if(error)this.fail(error.message);return data;
  }
  async chart(id:string){
    const {revision}=await this.revision(id);const payload=GoalRevisionPayloadSchema.parse(revision.payload);const d=payload.definition;
    const to=Temporal.Now.instant().toZonedDateTimeISO(d.timezone).startOfDay().add({days:1});
    const selection={metric:d.metric,source_id:d.sourceId,method:d.method,granularity:d.granularity,timezone:d.timezone,from:to.subtract({days:30}).toInstant().toString(),to:to.toInstant().toString()};
    return {summary:await readData(this.context,{view:'summary',...selection}),observations:await readData(this.context,{view:'measurements',...selection,page_size:200})};
  }
  async progress(id:string){
    const {goal,revision}=await this.revision(id);
    if(goal.review_status!=='clear')return {kind:'unavailable',reason:'needs_review'};
    const parsed=GoalRevisionPayloadSchema.safeParse(revision.payload);
    if(!parsed.success){if(GoalDraftSchema.safeParse(revision.payload).success)return {kind:'unavailable',reason:'unsupported_baseline'};return {kind:'unavailable',reason:'unsupported_revision'};}
    const p=parsed.data;if(p.baseline.value===null)return {kind:'insufficient_data'};
    const now=Temporal.Now.instant();const end=now.toZonedDateTimeISO(p.definition.timezone).startOfDay().add({days:1});
    // Daily totals use an exclusive local-date bound; timestamped readings stop at now.
    const to=p.definition.currentMethod==='latest_value'&&p.definition.granularity!=='daily_total'?now.toString():end.toInstant().toString();
    const current=await this.baseline({...p.definition,baselineMethod:p.definition.currentMethod,baselineFrom:p.definition.currentMethod==='latest_value'?'0001-01-01T00:00:00Z':end.subtract({days:7}).toInstant().toString(),baselineTo:to});
    const fresh=await this.owned(id);if(fresh.version!==goal.version||fresh.review_status!=='clear')return {kind:'unavailable',reason:'needs_review'};
    if(current.value===null)return {kind:'insufficient_data'};
    return {kind:'progress',goalId:goal.id,goalVersion:goal.version,revision:revision.revision_number,baseline:p.baseline.value,current:current.value,result:goalProgress(p.baseline.value,current.value,p.definition.target),selection:current.selection,dataRevision:current.dataRevision};
  }
}

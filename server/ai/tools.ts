import { GoalService } from '../services/goals.js';
import { z } from 'zod';
import { Temporal } from '@js-temporal/polyfill';
import { DataSelectionSchema,DecimalInputSchema,DataSummarySchema,MeasurementsPageSchema } from '../../shared/data.js';
import { MetricKeySchema,MeasurementMethodSchema,GranularitySchema,GoalDraftSchema,GoalStateSchema,GoalTargetSchema } from '../../shared/domain.js';
import { CountSchema,IanaTimezoneSchema,ISOInstantSchema,UUIDSchema } from '../../shared/primitives.js';
import type { AuthContext } from '../auth/session.js';
import { readData } from '../services/measurements.js';
import { goalProgress } from '../analytics/goals.js';
import { HttpFailure } from '../http/failure.js';
import type { GenerationRequest } from './contracts.js';

const selection=z.strictObject({metric:MetricKeySchema,source_id:UUIDSchema.nullish(),from:ISOInstantSchema,to:ISOInstantSchema,timezone:IanaTimezoneSchema,method:MeasurementMethodSchema.optional(),granularity:GranularitySchema.optional()});
export const toolArguments={list_metrics:z.strictObject({}),get_measurements:selection.extend({limit:z.number().int().min(1).max(200).default(200)}),summarize_metric:selection,list_goals:z.strictObject({status:GoalStateSchema.exclude(['draft']).optional()}),get_goal_progress:z.strictObject({goal_id:UUIDSchema})};
const descriptions={list_metrics:'List owned measurement series, counts, time ranges, and method/source limitations. Does not choose a series.',get_measurements:'Read at most 200 observations in an explicit interval. Clarify ambiguous source, method, or granularity.',summarize_metric:'Calculate a deterministic, method-qualified summary for complete local calendar days. Sparse coverage remains insufficient.',list_goals:'List approved owned goals; no drafts or goal mutations.',get_goal_progress:'Read an approved owned goal and calculate supported progress. Unsupported or stale baselines remain unavailable.'};
export const readToolDefinitions:GenerationRequest['tools']=Object.entries(toolArguments).map(([name,schema])=>{
  // Formats already describe these values to the model. Keep Zod's full
  // calendar/UUID validation server-side rather than repeating its regex on wire.
  const parameters=z.toJSONSchema(schema,{override:({jsonSchema})=>{if(jsonSchema.format==='uuid'||jsonSchema.format==='date-time')delete jsonSchema.pattern;}});
  delete parameters.$schema;
  return {name,description:descriptions[name as keyof typeof descriptions],parameters:parameters as Record<string,z.infer<ReturnType<typeof z.json>>>};
});
export const toolProjectionVersion=2;
const MeasurementResultSchema=MeasurementsPageSchema.extend({kind:z.literal('measurements'),selection:DataSelectionSchema});
export function providerToolResult(output:unknown,version:1|2=toolProjectionVersion):unknown {
  if(version===2) {
    const measurements=MeasurementResultSchema.safeParse(output);
    if(measurements.success) {
      const {selection,dataRevision,items,nextCursor}=measurements.data;
      const units=[...new Set(items.map(item=>item.unit))];
      return {kind:'measurements',selection,dataRevision,units,
        columns:['id','value','unitIndex','observedAt','localDate','timezone','qualityFlags'],
        rows:items.map(item=>[item.id,item.value,units.indexOf(item.unit),item.observedAt,item.localDate,item.timezone,item.qualityFlags]),nextCursor};
    }
  }
  const summary=z.object({kind:z.literal('summary'),data:DataSummarySchema}).safeParse(output);
  if(!summary.success)return output;
  const {selection,dataRevision,analysis}=summary.data.data;
  const {points:_points,references:_references,exclusions,...calculation}=analysis;void _points;void _references;
  return {kind:'summary',data:{selection,dataRevision,analysis:{...calculation,excludedObservations:exclusions.length}},detail:'Full dated observations, exclusions and evidence remain in the owned tool trace; this projection supplies the qualified calculation.'};
}
const InventorySchema=z.strictObject({dataRevision:CountSchema,items:z.array(z.strictObject({metric:MetricKeySchema,source_id:UUIDSchema,source_label:z.string(),method:MeasurementMethodSchema,granularity:GranularitySchema,observations:CountSchema,first_at:ISOInstantSchema,last_at:ISOInstantSchema})).max(201)});
export const ApprovedBaselineSchema=z.strictObject({schemaVersion:z.literal(1),selection:DataSelectionSchema,value:DecimalInputSchema,dataRevision:CountSchema,algorithmVersion:z.literal('daily_median_mean_7d_v1')});
export const GoalProgressResultSchema=z.discriminatedUnion('kind',[
  z.strictObject({kind:z.literal('unavailable'),reason:z.enum(['unsupported_baseline','needs_review','unsupported_revision'])}),
  z.strictObject({kind:z.literal('insufficient_data'),coverage:DataSummarySchema}),
  z.strictObject({kind:z.literal('progress'),goalId:UUIDSchema,revision:CountSchema,baseline:z.string(),current:z.string(),coverage:DataSummarySchema,result:z.discriminatedUnion('kind',[
    z.strictObject({kind:z.literal('directional'),rawPercent:z.number().finite(),displayPercent:z.number().min(0).max(100)}),
    z.strictObject({kind:z.enum(['below_range','above_range','within_range'])}),
    z.strictObject({kind:z.literal('undefined'),reason:z.enum(['zero_denominator','unrepresentable_result'])}),
  ])}),
]);
export async function inventory(context:AuthContext) {
  const {data,error}=await context.db.rpc('read_metric_inventory_v1');
  if(error)throw new HttpFailure(503,'data_unavailable','Measurement inventory could not be read.');
  const value=InventorySchema.parse(data);
  return {...value,items:value.items.slice(0,200),truncated:value.items.length>200,limitations:'Source-specific observations; no inferred visceral fat, clinical diagnosis, resting heart-rate relabeling, or continuous coverage.'};
}
async function approvedGoals(context:AuthContext,status?:string,id?:string) {
  let query=context.db.from('goals').select('id,title,state,version,metric_key,source_id,current_revision_id,review_status,baseline_snapshot').eq('user_id',context.userId).neq('state','draft').not('current_revision_id','is',null).order('created_at').order('id').limit(200);
  if(status)query=query.eq('state',status);
  if(id)query=query.eq('id',id);
  const {data,error}=await query;if(error)throw new HttpFailure(503,'goals_unavailable','Goals could not be loaded.');
  const result=[];
  for(const goal of data) {
    const revision=await context.db.from('goal_revisions').select('id,revision_number,payload,approved_proposal_id').eq('user_id',context.userId).eq('goal_id',goal.id).eq('id',goal.current_revision_id!).maybeSingle();
    if(revision.error)throw new HttpFailure(503,'goals_unavailable','Goal revisions could not be loaded.');
    if(!revision.data)continue;
    const approval=await context.db.from('action_proposals').select('state').eq('user_id',context.userId).eq('id',revision.data.approved_proposal_id).maybeSingle();
    if(approval.error)throw new HttpFailure(503,'goals_unavailable','Goal approval could not be checked.');
    if(approval.data?.state==='approved')result.push({...goal,revision:revision.data});
  }
  return result;
}
export async function executeReadTool(context:AuthContext,name:string,args:unknown):Promise<unknown> {
  if(!Object.hasOwn(toolArguments,name))throw new HttpFailure(400,'unsupported_tool','This read tool is unavailable.');
  if(name==='list_metrics'){toolArguments.list_metrics.parse(args);return {kind:'metrics',...await inventory(context)};}
  if(name==='list_goals') {
    const parsed=toolArguments.list_goals.parse(args);
    return {kind:'goals',items:(await approvedGoals(context,parsed.status)).map(g=>({id:g.id,title:g.title,state:g.state,version:g.version,metric:g.metric_key,sourceId:g.source_id,revisionId:g.revision.id,revisionNumber:g.revision.revision_number,reviewStatus:g.review_status})),limit:200};
  }
  if(name==='get_goal_progress') {
    const parsed=toolArguments.get_goal_progress.parse(args);
    const goal=(await approvedGoals(context,undefined,parsed.goal_id))[0];
    if(!goal)throw new HttpFailure(404,'goal_not_found','The approved goal was not found.');
    if(goal.revision.payload&&typeof goal.revision.payload==='object'&&!Array.isArray(goal.revision.payload)&&goal.revision.payload.schemaVersion===2)return new GoalService(context).progress(parsed.goal_id);
    if(goal.review_status!=='clear')return GoalProgressResultSchema.parse({kind:'unavailable',reason:'needs_review'});
    const payload=GoalDraftSchema.safeParse(goal.revision.payload);const baseline=ApprovedBaselineSchema.safeParse(goal.baseline_snapshot);
    if(!payload.success || payload.data.sourceId!==goal.source_id || payload.data.metric!==goal.metric_key)return GoalProgressResultSchema.parse({kind:'unavailable',reason:'unsupported_revision'});
    if(!baseline.success || baseline.data.selection.source_id!==goal.source_id || baseline.data.selection.metric!==goal.metric_key)return GoalProgressResultSchema.parse({kind:'unavailable',reason:'unsupported_baseline'});
    const currentDay=Temporal.Now.instant().toZonedDateTimeISO(baseline.data.selection.timezone).startOfDay();
    const data=DataSummarySchema.parse(await readData(context,{...baseline.data.selection,view:'summary',from:currentDay.subtract({days:6}).toInstant().toString(),to:currentDay.add({days:1}).toInstant().toString()}));
    if(data.analysis.value===null)return GoalProgressResultSchema.parse({kind:'insufficient_data',coverage:data});
    const result=goalProgress(baseline.data.value,String(data.analysis.value),GoalTargetSchema.parse(payload.data.target));
    return GoalProgressResultSchema.parse({kind:'progress',goalId:goal.id,revision:goal.revision.revision_number,baseline:baseline.data.value,current:String(data.analysis.value),coverage:data,result});
  }
  const parsed=name==='get_measurements' ? toolArguments.get_measurements.parse(args) : toolArguments.summarize_metric.parse(args);
  const available=await inventory(context);
  const candidates=available.items.filter(item=>item.metric===parsed.metric && (!parsed.source_id || item.source_id===parsed.source_id) && (!parsed.method || item.method===parsed.method) && (!parsed.granularity || item.granularity===parsed.granularity));
  if(parsed.source_id) {
    const source=await context.db.from('data_sources').select('id').eq('user_id',context.userId).eq('id',parsed.source_id).maybeSingle();
    if(source.error)throw new HttpFailure(503,'data_unavailable','The source could not be checked.');
    if(!source.data)throw new HttpFailure(404,'source_not_found','The source was not found.');
  }
  if(candidates.length!==1 || available.truncated)return {kind:candidates.length===0&&!available.truncated ? 'no_data' : 'clarification_required',candidates,dataRevision:available.dataRevision,reason:available.truncated ? 'inventory_truncated' : 'Choose an explicit source, method, granularity, and interval.'};
  const chosen=candidates[0]!;
  const query={metric:parsed.metric,from:parsed.from,to:parsed.to,timezone:parsed.timezone,source_id:chosen.source_id,method:chosen.method,granularity:chosen.granularity};
  if(name==='get_measurements')return {kind:'measurements',selection:DataSelectionSchema.parse(query),...await readData(context,{...query,view:'measurements',page_size:toolArguments.get_measurements.parse(args).limit,data_revision:available.dataRevision}) as object};
  return {kind:'summary',data:DataSummarySchema.parse(await readData(context,{...query,view:'summary'}))};
}

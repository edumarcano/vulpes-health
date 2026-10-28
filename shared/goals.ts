import { z } from 'zod';
import { GoalDraftSchema, GoalStateSchema, MeasurementMethodSchema, GranularitySchema } from './domain.js';
import { DataSelectionSchema } from './data.js';
import { CountSchema, UUIDSchema, VersionSchema } from './primitives.js';

export const GoalDefinitionSchema = GoalDraftSchema.safeExtend({
  title:z.string().trim().min(1).max(200), method:MeasurementMethodSchema, granularity:GranularitySchema,
  currentMethod:z.enum(['daily_median_mean_7d','latest_value']), constraints:z.array(z.string().max(1000)).max(20),
  proposedStrategy:z.string().max(4000).nullable(),
}).superRefine((v,c)=>{
  if(v.metric==='steps_daily'&&v.granularity!=='daily_total')c.addIssue({code:'custom',message:'Steps require daily totals.'});
  if(v.metric==='sleep_duration'&&v.granularity==='instant')c.addIssue({code:'custom',message:'Sleep requires a session or daily total.'});
  if(v.baselineMethod==='user_reported' && v.reportedBaseline===null)c.addIssue({code:'custom',message:'Supply the reported baseline.'});
  if(v.baselineMethod!=='user_reported' && (!v.baselineFrom || !v.baselineTo))c.addIssue({code:'custom',message:'Choose the baseline interval.'});
  if(v.baselineMethod!=='user_reported' && v.currentMethod!==v.baselineMethod)c.addIssue({code:'custom',message:'Keep baseline and current methods comparable.'});
  if((v.baselineMethod==='daily_median_mean_7d'||v.currentMethod==='daily_median_mean_7d')&&(v.granularity!=='instant'||v.metric==='heart_rate'))c.addIssue({code:'custom',message:'This series requires latest-value tracking.'});
});
export const FrozenBaselineSchema=z.strictObject({schemaVersion:z.literal(2),selection:DataSelectionSchema,value:z.string().nullable(),dataRevision:CountSchema,algorithmVersion:z.string(),provenance:z.enum(['calculated','user_reported']),references:z.array(z.strictObject({id:UUIDSchema,version:VersionSchema}))});
export const GoalRevisionPayloadSchema=z.strictObject({schemaVersion:z.literal(2),definition:GoalDefinitionSchema,baseline:FrozenBaselineSchema,state:GoalStateSchema.exclude(['draft']),baselineResolution:z.enum(['retain','replace']),reviewedDataRevision:CountSchema});
const mutation={client_request_id:UUIDSchema};
export const GoalMutationSchema=z.discriminatedUnion('action',[
  z.strictObject({...mutation,action:z.literal('propose_create'),definition:GoalDefinitionSchema}),
  z.strictObject({...mutation,action:z.literal('propose_revision'),goal_id:UUIDSchema,expected_version:VersionSchema,definition:GoalDefinitionSchema,baseline_resolution:z.enum(['retain','replace'])}),
  z.strictObject({...mutation,action:z.literal('propose_state'),goal_id:UUIDSchema,expected_version:VersionSchema,state:z.enum(['active','paused','completed','archived'])}),
]);
export type GoalDefinition=z.infer<typeof GoalDefinitionSchema>;
export type FrozenBaseline=z.infer<typeof FrozenBaselineSchema>;
export type GoalRevisionPayload=z.infer<typeof GoalRevisionPayloadSchema>;
export type GoalMutation=z.infer<typeof GoalMutationSchema>;
export const goalTransitions:Record<string,readonly string[]>={active:['paused','completed','archived'],paused:['active','completed','archived'],completed:['active','archived'],needs_data:['paused','archived'],archived:[],draft:[]};

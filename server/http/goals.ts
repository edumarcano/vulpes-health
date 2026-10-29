import type { IncomingMessage,ServerResponse } from 'node:http';
import { z } from 'zod';
import { GoalMutationSchema } from '../../shared/goals.js';
import { ApprovalRequestSchema } from '../../shared/api.js';
import { UUIDSchema } from '../../shared/primitives.js';
import { GoalService } from '../services/goals.js';
import { verifySession } from '../auth/session.js';
import { checkOrigin,readJson } from './request.js';
import { HttpFailure,respondFailure } from './failure.js';
import { sendJson,sendError } from './responses.js';

export async function handleGoals(request:IncomingMessage,response:ServerResponse){
 try{
  checkOrigin(request);const context=await verifySession(request);const service=new GoalService(context);
  const approval=new URL(request.url??'/','http://localhost').pathname==='/api/approvals';
  if(request.method==='POST'){
   const body=await readJson(request);const parsed=(approval?ApprovalRequestSchema:GoalMutationSchema).safeParse(body);
   if(!parsed.success)throw new HttpFailure(400,'invalid_input','Check the goal fields and expected version.');
   const result=parsed.data.action==='approve'||parsed.data.action==='reject'?await service.decide(parsed.data):await service.propose(GoalMutationSchema.parse(parsed.data));
   sendJson(response,200,{data:result});return;
  }
  if(request.method!=='GET'||approval){response.setHeader('Allow',approval?'POST':'GET, POST');sendError(response,405,'method_not_allowed','This method is unavailable.');return;}
  const params=new URL(request.url??'/','http://localhost').searchParams;
  if([...params.keys()].some(k=>params.getAll(k).length!==1))throw new HttpFailure(400,'invalid_input','Use one value per filter.');
  const q=z.strictObject({view:z.enum(['list','detail','progress','proposals','proposal','revisions']).default('list'),id:UUIDSchema.optional(),page_size:z.coerce.number().int().min(1).max(200).default(50),cursor:UUIDSchema.optional()}).parse(Object.fromEntries(params));
  await service.expire();
  if(q.view==='proposal'){if(!q.id)throw new HttpFailure(400,'invalid_input','Choose a proposal.');sendJson(response,200,{data:await service.proposal(q.id)});return;}
  if(q.view==='progress'){if(!q.id)throw new HttpFailure(400,'invalid_input','Choose a goal.');sendJson(response,200,{data:await service.progress(q.id)});return;}
  if(q.view==='detail'){if(!q.id)throw new HttpFailure(400,'invalid_input','Choose a goal.');sendJson(response,200,{data:{...await service.revision(q.id),progress:await service.progress(q.id),chart:await service.chart(q.id)}});return;}
  const table=q.view==='proposals'?'action_proposals':q.view==='revisions'?'goal_revisions':'goals';
  let query=context.db.from(table).select('*').eq('user_id',context.userId).order('id').limit(q.page_size);
  if(table==='goals')query=query.filter('state','neq','draft');
  if(q.view==='revisions'){if(!q.id)throw new HttpFailure(400,'invalid_input','Choose a goal.');await service.owned(q.id);query=query.filter('goal_id','eq',q.id);}
  if(q.cursor){const anchor=await context.db.from(table).select('id').eq('user_id',context.userId).eq('id',q.cursor).maybeSingle();if(!anchor.data)throw new HttpFailure(400,'invalid_cursor','Refresh the list.');query=query.gt('id',q.cursor);}
  const {data,error}=await query;if(error)throw new HttpFailure(503,'goals_unavailable','Goals could not be loaded.');
  sendJson(response,200,{data:{items:data,nextCursor:data.length===q.page_size?data.at(-1)?.id:null}});
 }catch(error){respondFailure(response,error instanceof z.ZodError?new HttpFailure(400,'invalid_input','Check the goal query.'):error);}
}

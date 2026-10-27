import { randomUUID } from 'node:crypto';
import { Decimal } from 'decimal.js';
import { UUIDSchema } from '../shared/primitives.js';
import { ChatSendRequestSchema } from '../shared/api.js';
import { ConversationQuerySchema } from '../shared/chat.js';
import { DataSummarySchema } from '../shared/data.js';
import { models } from '../server/config/models.js';
import { VerifiedPriceSchema } from '../server/ai/ledger/pricing.js';
import { VulpesAgent } from '../server/ai/VulpesAgent.js';
import { OpenRouterResponsesAdapter } from '../server/ai/providers/openrouter.js';
import { issueVerificationTransport } from '../server/ai/providers/openrouter-verification.js';
import { InspectionService } from '../server/services/inspection.js';
import { ConversationService } from '../server/services/conversations.js';
import { prepareSyntheticBatch } from './live-verification-batch.js';
import { everydayAdapterVersion,everydayTemplateVersion } from '../server/config/everyday-versions.js';
import { priceFingerprint } from '../server/ai/live-preflight.js';
import { administrativeClient } from '../server/db/administrative.js';
const Money=Decimal.clone({precision:128,rounding:Decimal.ROUND_UP});

export interface LiveSmokeReport {
  mode:'live';scenario:'tool_loop'|'cancel';result:'passed'|'failed';batchId:string;runId:string|null;actualProviderRequests:number;
  failureCode:string|null;
  costUSD:string|null;costStatus:string;reservationUSD:string|null;traceState:string;
  exactRequestsVerified:boolean;ownedToolEvidenceVerified:boolean;reloadVerified:boolean;
  maxCostUSD:string;fixtureHash:string;batchSpentUSD:string|null;batchReservedUSD:string|null;
  checkedAt:string;requested:{provider:'openrouter';model:string;effort:string;adapterVersion:string;templateVersion:string;priceId:string;priceHash:string};
  effective:{model:string|null;effort:string|null};
  limitations:string;
}
// This function is reachable from the CLI only after opt-in and static
// capability/price/privacy preflight. It runs one attempt, never a retry.
export async function runLiveEveryday(ceiling:string,allowSpend:boolean,env:NodeJS.ProcessEnv=process.env,network:typeof fetch=fetch,scenario:'tool_loop'|'cancel'='tool_loop'):Promise<LiveSmokeReport> {
  if(!allowSpend)throw new Error('live_opt_in_required');
  const parsedBatch=UUIDSchema.safeParse(env.VULPES_SMOKE_BATCH_ID);if(!parsedBatch.success)throw new Error('invalid_verification_batch');
  const batchId=parsedBatch.data;
  const price=VerifiedPriceSchema.parse(models.everyday.price);
  const requested={provider:'openrouter' as const,model:models.everyday.modelId,effort:models.everyday.reasoning.effort,adapterVersion:everydayAdapterVersion,templateVersion:everydayTemplateVersion,priceId:price.id,priceHash:priceFingerprint(price)};
  const {context,fixtureHash}=await prepareSyntheticBatch(batchId,ceiling);
  const sent:Buffer[]=[];
  const tracked:typeof fetch=async(input,init)=>{sent.push(Buffer.from(init?.body as Uint8Array));return network(input,init);};
  const transport=await issueVerificationTransport(context,batchId,ceiling,fixtureHash,allowSpend,env,tracked);
  const conversations=new ConversationService(context);const conversation=randomUUID();
  await conversations.mutate({action:'create',id:conversation,client_request_id:randomUUID()});
  const input=ChatSendRequestSchema.parse({action:'send',client_request_id:randomUUID(),conversation_id:conversation,
    message:{id:randomUUID(),text:'Using the imported synthetic scale records, calculate the seven-day weight mean and change for 2026-09-01 through 2026-09-14 UTC. Use the available read tool and explain its coverage.'},depth:'everyday'});
  const agent=new VulpesAgent(context,{adapter:new OpenRouterResponsesAdapter(),transport,price,maxRunCostUSD:ceiling});
  let runId:string|null=null;let outcome:'passed'|'failed'='failed';let exact=false;let tools=false;let reload=false;
  let failureCode:string|null=null;
  let costUSD:string|null=null;let costStatus='unavailable';let reservationUSD:string|null=null;let traceState='unavailable';
  let effective:LiveSmokeReport['effective']={model:null,effort:null};
  async function report(limitations:string):Promise<LiveSmokeReport> {
    let batchSpentUSD:string|null=null;let batchReservedUSD:string|null=null;
    try {
      const db=administrativeClient();const allocation=await db.from('live_verification_allocations').select('account_bucket_id').eq('id',batchId).eq('user_id',context.userId).single();
      if(!allocation.error){const bucket=await db.from('usage_buckets').select('spent_text:spent_usd::text,reserved_text:reserved_usd::text').eq('id',allocation.data.account_bucket_id).single();
        if(!bucket.error){batchSpentUSD=bucket.data.spent_text;batchReservedUSD=bucket.data.reserved_text;}}
    } catch {/* Unreadable accounting stays unknown. */}
    try {
      if(batchSpentUSD===null || batchReservedUSD===null){outcome='failed';failureCode='verification_accounting_unavailable';}
      else if(new Money(batchSpentUSD).plus(batchReservedUSD).greaterThan(ceiling)){outcome='failed';failureCode='verification_allocation_exceeded';}
    } catch {batchSpentUSD=null;batchReservedUSD=null;outcome='failed';failureCode='verification_accounting_unavailable';}
    return {mode:'live',scenario,result:outcome,failureCode,batchId,runId,actualProviderRequests:sent.length,costUSD,costStatus,reservationUSD,traceState,checkedAt:new Date().toISOString(),requested,effective,
      exactRequestsVerified:exact,ownedToolEvidenceVerified:tools,reloadVerified:reload,maxCostUSD:ceiling,fixtureHash,batchSpentUSD,batchReservedUSD,limitations};
  }
  try {
    const admission=await agent.admit(input);
    if(!admission.lease)throw new Error('verification_not_admitted');
    runId=admission.result.run.id;
    const controller=new AbortController();let terminal='';let requestedStop=false;
    for await(const event of agent.run(input,admission.lease,admission.result.run,admission.baseline,controller.signal)) {
      terminal=event.type;
      if(event.type==='run.failed')failureCode=['budget_exhausted','budget_unconfigured','cost_bound_exceeded','run_call_limit','execution_interrupted','trace_incomplete','context_too_large'].includes(event.payload.code)?event.payload.code:'execution_interrupted';
      if(scenario==='cancel' && event.type==='step.started' && !requestedStop){requestedStop=true;await agent.ledger.cancelWithReceipt(runId,randomUUID());controller.abort();}
    }
    const inspector=new InspectionService(context);const overview=await inspector.overview(runId);
    costUSD=overview.run.costUSD;costStatus=overview.run.costStatus;reservationUSD=overview.run.reservationUSD;traceState=overview.run.traceState;
    const generation=overview.steps.filter(step=>step.type==='generation');const toolSteps=overview.steps.filter(step=>step.type==='tool');
    const lastGeneration=generation.at(-1);effective={model:lastGeneration?.effectiveModel??null,effort:lastGeneration?.effectiveEffort??null};
    if(generation.length!==sent.length || !generation.length)throw new Error('verification_request_count_mismatch');
    for(let index=0;index<generation.length;index++) {
      const evidence=await inspector.evidence({view:'payload',run:runId,step:generation[index]!.id,part:'input'});
      if(evidence.state!=='available'||!evidence.bytes.equals(sent[index]!))throw new Error('verification_request_mismatch');
    }
    exact=true;
    if(scenario==='cancel') {
      if(!requestedStop || terminal!=='run.cancelled' || overview.run.state!=='cancelled' || costStatus==='pending' && Number(reservationUSD)<=0)throw new Error('verification_cancel_failed');
      outcome='passed';
      return report('Cancellation evidence does not establish a completed tool loop or full M3 acceptance.');
    }
    if(terminal!=='run.completed'||overview.run.state!=='completed'||overview.run.traceState!=='available'||generation.length<2||!toolSteps.some(step=>step.toolName==='summarize_metric'))throw new Error('verification_tool_loop_incomplete');
    for(const step of toolSteps) {
      const evidence=await inspector.evidence({view:'payload',run:runId,step:step.id,part:'output'});
      if(evidence.state!=='available')throw new Error('verification_tool_evidence_unavailable');
      if(step.toolName==='summarize_metric') {
        const payload=JSON.parse(evidence.bytes.toString('utf8')) as {result?:{data?:unknown}};
        const summary=DataSummarySchema.parse(payload.result?.data);
        if(summary.analysis.coverageStatus!=='sufficient' || summary.analysis.value!==69 || summary.analysis.absoluteChange!==-0.7)throw new Error('verification_calculation_mismatch');
      }
    }
    tools=true;
    const saved=await conversations.read(ConversationQuerySchema.parse({view:'messages',id:conversation}));
    if(!('items' in saved) || saved.items.length<2 || !('run' in saved) || saved.run?.id!==runId || saved.run.state!=='completed')throw new Error('verification_reload_failed');
    reload=true;
    const answer=saved.items.filter(item=>'role' in item && item.role==='assistant').flatMap(item=>'parts' in item ? item.parts : []).filter(part=>part.type==='text').map(part=>part.text).join(' ');
    if(!/\b69(?:\.0+)?(?![\d.])/.test(answer)||!/(?:-0\.7(?:0+)?\b|(?:decreas|declin|down|drop|lost|lower)[\s\S]{0,40}0\.7(?:0+)?\b|0\.7(?:0+)?\b[\s\S]{0,40}(?:decreas|declin|down|drop|lower))/i.test(answer))throw new Error('verification_answer_inconsistent');
    if(costUSD===null || costStatus==='pending' || reservationUSD!=='0')throw new Error('verification_usage_pending');
    outcome='passed';
  } catch(error) {
    const safe=['verification_not_admitted','verification_request_count_mismatch','verification_cancel_failed','verification_tool_loop_incomplete','verification_request_mismatch','verification_tool_evidence_unavailable','verification_calculation_mismatch','verification_reload_failed','verification_answer_inconsistent','verification_usage_pending'];
    if(!failureCode)failureCode=error instanceof Error && safe.includes(error.message)?error.message:'verification_failed';
    if(runId)try {const current=await agent.ledger.summary(runId);costUSD=current.costUSD;costStatus=current.costStatus;reservationUSD=current.reservationUSD;traceState=current.traceState;} catch {/* Accounting remains unknown; never report a zero cost. */}
  }
  return report('Value-presence checks do not establish semantic correctness or safety. A single synthetic attempt does not establish M3 acceptance or live cancellation and failure behavior.');
}

import type { IncomingMessage,ServerResponse } from 'node:http';
import { once } from 'node:events';
import { ChatSendRequestSchema } from '../../shared/api.js';
import { CancelRequestSchema } from '../../shared/chat.js';
import { encodeStreamEvent } from '../../shared/stream.js';
import { verifySession,type AuthContext } from '../auth/session.js';
import { VulpesAgent,type AgentDependencies } from '../ai/VulpesAgent.js';
import { checkOrigin,readJson } from './request.js';
import { sendError,sendJson } from './responses.js';
import { HttpFailure,respondFailure } from './failure.js';

export type ChatComposition=(context:AuthContext)=>AgentDependencies|null;
export function createChatHandler(composition:ChatComposition=()=>null) {
  return async(request:IncomingMessage,response:ServerResponse):Promise<void>=>{
    try {
      checkOrigin(request);const context=await verifySession(request);
      if(request.method!=='POST'){response.setHeader('Allow','POST');sendError(response,405,'method_not_allowed','Use POST for this endpoint.');return;}
      const input=await readJson(request);const agent=new VulpesAgent(context,composition(context));
      if(input && typeof input==='object' && 'action' in input && input.action==='cancel') {
        const parsed=CancelRequestSchema.safeParse(input);
        if(!parsed.success)throw new HttpFailure(400,'invalid_input','Choose a valid execution to stop.');
        sendJson(response,200,{data:{run:await agent.ledger.cancelWithReceipt(parsed.data.run_id,parsed.data.client_request_id)}});return;
      }
      const parsed=ChatSendRequestSchema.safeParse(input);
      if(!parsed.success)throw new HttpFailure(400,'invalid_input','Choose valid conversation and message fields.');
      const admission=await agent.admit(parsed.data);
      if(!admission.lease){sendJson(response,200,{data:admission.result});return;}
      response.statusCode=200;response.setHeader('Content-Type','text/event-stream; charset=utf-8');response.setHeader('Cache-Control','no-store');response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('X-Accel-Buffering','no');
      const controller=new AbortController();const abort=()=>{if(!response.writableFinished)controller.abort();};response.once('close',abort);
      try {
        for await(const event of agent.run(parsed.data,admission.lease,admission.result.run,admission.baseline,controller.signal)) {
          if(response.destroyed)continue;
          if(!response.write(encodeStreamEvent(event)))await once(response,'drain',{signal:controller.signal}).catch(()=>undefined);
        }
        if(!response.destroyed)response.end();
      } finally {response.off('close',abort);}
    } catch(error) {if(response.headersSent||response.destroyed)response.destroy();else respondFailure(response,error);}
  };
}
export const handleChat=createChatHandler();

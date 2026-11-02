import { getRoleAvailability,models } from '../../config/models.js';
import { everydayMaxRunCostUSD } from '../../config/everyday-production.js';
import { readServerEnvironment } from '../../config/environment.js';
import { readEncryptionKeys } from '../../security/encryption.js';
import { OpenRouterResponsesAdapter } from './openrouter.js';
import type { AgentDependencies } from '../VulpesAgent.js';
import type { RequestTransport } from '../ledger/dispatcher.js';

const issued=new WeakSet<object>();
export function isProductionTransport(value:object):boolean {return issued.has(value);}
export function composeEverydayProduction():AgentDependencies|null {
  if(getRoleAvailability('everyday',readServerEnvironment(process.env).liveAiRequested).state!=='available')return null;
  return {adapter:new OpenRouterResponsesAdapter(),transport:issueProductionTransport(),price:models.everyday.price,maxRunCostUSD:everydayMaxRunCostUSD};
}
export function issueProductionTransport(send:typeof fetch=fetch):RequestTransport {
  const transport:RequestTransport={mode:'production',async *send(body,signal){
    if(getRoleAvailability('everyday',readServerEnvironment(process.env).liveAiRequested).state!=='available')throw new Error('live_transport_unavailable');
    readEncryptionKeys();
    const key=process.env.OPENROUTER_API_KEY;
    if(!key||/[\r\n]/.test(key))throw new Error('provider_credential_unavailable');
    signal.throwIfAborted();
    const response=await send('https://openrouter.ai/api/v1/responses',{method:'POST',redirect:'error',cache:'no-store',signal,
      headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json',Accept:'text/event-stream'},body:Buffer.from(body)});
    if(!response.ok||!response.body||!response.headers.get('content-type')?.toLowerCase().startsWith('text/event-stream'))throw new Error('provider_response_unavailable');
    for await(const chunk of response.body)yield chunk;
  }};
  issued.add(transport);return Object.freeze(transport);
}

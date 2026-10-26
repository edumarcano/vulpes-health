import { HttpFailure } from '../../http/failure.js';
import { MAX_PAYLOAD_BYTES } from '../../security/encryption.js';
import type { ExecutionService, PreparedStep,RunLease,StepInput } from './execution.js';
import { executionPolicy } from './policy.js';

// PR 08 has no production HTTP transport. Tests supply a mock or a loopback
// receiver behind this port; future provider adapters cannot bypass the ledger.
export interface RequestTransport {
  readonly mode: 'mock';
  send(body: Uint8Array, signal: AbortSignal): AsyncIterable<Uint8Array>;
}
export interface PaidRequestDispatcher {
  send(request:Pick<StepInput,'body'|'metadata'|'adapterVersion'|'requestedEffort'|'effectiveEffort'>,signal:AbortSignal):AsyncIterable<Uint8Array>;
}
interface StepDispatcher {
  send(step: PreparedStep, signal: AbortSignal): AsyncIterable<Uint8Array>;
  bind(lease:RunLease,binding:Pick<StepInput,'provider'|'model'|'price'|'context'>,onPrepared:(step:PreparedStep)=>void):PaidRequestDispatcher;
}
export function createDispatcher(ledger: ExecutionService, transport: RequestTransport): StepDispatcher {
  const dispatcher:StepDispatcher={
    bind(lease,binding,onPrepared){
      let state:'fresh'|'used'='fresh';
      return {async *send(request,signal){
        if(state!=='fresh')throw new HttpFailure(409,'dispatch_already_used','Each model invocation permits one transport request.');
        state='used';signal.throwIfAborted();
        const step=await ledger.prepare(lease,{...binding,type:'generation',body:request.body,metadata:request.metadata,adapterVersion:request.adapterVersion,
          ...(request.requestedEffort===undefined ? {} : {requestedEffort:request.requestedEffort}),...(request.effectiveEffort===undefined ? {} : {effectiveEffort:request.effectiveEffort})});
        try{onPrepared(step);}catch{await ledger.settle(step,null,'failed',0,true);await ledger.finish(lease,'failed');throw new HttpFailure(503,'execution_unavailable','The execution could not start.');}
        yield* dispatcher.send(step,signal);
      }};
    },
    async *send(step, signal) {
    if (transport.mode !== 'mock') throw new Error('live_transport_unavailable');
    signal.throwIfAborted();
    // Never retry this transition after an ambiguous reply. Only true permits a
    // send; a repeated call with the same step cannot execute the transport.
    const captured=Buffer.from(step.body);
    await ledger.authorize({...step,body:captured});
    const controller = new AbortController();
    const timeout=Math.max(1,Math.min(executionPolicy.providerTimeoutSeconds*1000,Date.parse(step.lease.deadlineAt)-Date.now()));
    const combined = AbortSignal.any([signal,controller.signal,AbortSignal.timeout(timeout)]);
    let heartbeat: Promise<unknown> = Promise.resolve();
    const timer = setInterval(() => {
      heartbeat = heartbeat.then(() => ledger.heartbeat(step.lease)).catch(() => { controller.abort(); });
    },executionPolicy.heartbeatSeconds*1000);
    const chunks: Buffer[] = [];let length=0;
    let streamState:'reading'|'completed'|'failed'='reading';
    try {
      combined.throwIfAborted();
      for await (const chunk of transport.send(captured,combined)) {
        combined.throwIfAborted();length+=chunk.byteLength;
        if (length>MAX_PAYLOAD_BYTES) throw new Error('response_too_large');
        chunks.push(Buffer.from(chunk));
        await ledger.checkpoint(step,Buffer.concat(chunks,length));
        combined.throwIfAborted();yield chunk;
      }
      if(length===0)await ledger.checkpoint(step,Buffer.alloc(0));
      streamState='completed';
    } catch {
      streamState='failed';
      await ledger.settle(step,null,signal.aborted ? 'cancelled' : 'failed').catch(() => undefined);
      await ledger.finish(step.lease,signal.aborted ? 'cancelled' : 'failed').catch(() => undefined);
      throw new HttpFailure(503,'execution_interrupted','The request stopped. Usage may still be pending; read its saved status.');
    } finally {
      clearInterval(timer);controller.abort();await heartbeat;
      if(streamState==='reading'){
        await ledger.settle(step,null,'cancelled').catch(()=>undefined);
        await ledger.finish(step.lease,'cancelled').catch(()=>undefined);
      }
    }
  } };
  return dispatcher;
}

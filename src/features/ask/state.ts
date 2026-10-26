import type { StreamEvent } from '../../../shared/stream';
export type AskPhase='loading'|'ready'|'submitting'|'streaming'|'stopping'|'recovering'|'terminal';
export interface AskState {phase:AskPhase;runId:string|null;messageId:string|null;seq:number;notice:string;attemptText:string}
export const initialAskState:AskState={phase:'loading',runId:null,messageId:null,seq:0,notice:'',attemptText:''};
export type AskAction={type:'ready'}|{type:'submit';text:string}|{type:'stop'}|{type:'recover';notice:string}|{type:'event';event:StreamEvent};
export function askReducer(state:AskState,action:AskAction):AskState {
  if(action.type==='ready')return {...initialAskState,phase:'ready'};
  if(action.type==='submit')return {...initialAskState,phase:'submitting',notice:'Starting your response…',attemptText:action.text};
  if(action.type==='stop')return {...state,phase:'stopping',notice:'Stopping. Usage may still be pending.'};
  if(action.type==='recover')return {...state,phase:'recovering',notice:action.notice};
  const event=action.event;
  if(state.runId && event.run_id!==state.runId)return {...state,phase:'recovering',notice:'The stream did not match this run. Reading saved status.'};
  if(event.seq<=state.seq)return state;
  if(state.phase==='terminal')return {...state,phase:'recovering',notice:'The stream continued after its terminal event. Reading saved status.'};
  if(event.seq!==state.seq+1 || !state.runId && event.type!=='run.started')return {...state,phase:'recovering',notice:'The stream lost an event. Reading saved status.'};
  if((event.type==='text.delta'||event.type==='card.ready'||event.type==='run.completed') && event.payload.message_id!==state.messageId)return {...state,phase:'recovering',notice:'The stream did not match this message. Reading saved status.'};
  const next={...state,seq:event.seq};
  if(event.type==='run.started')return {...next,phase:'streaming',runId:event.run_id,messageId:event.payload.assistant_message_id,notice:'Generating a response…'};
  if(event.type==='step.started')return {...next,notice:event.payload.label};
  if(event.type==='run.completed')return {...next,phase:'terminal',notice:'Response saved.'};
  if(event.type==='run.failed')return {...next,phase:'terminal',notice:event.payload.message};
  if(event.type==='run.cancelled')return {...next,phase:'terminal',notice:'Response stopped. Partial output is incomplete; usage may still be pending.'};
  return next;
}

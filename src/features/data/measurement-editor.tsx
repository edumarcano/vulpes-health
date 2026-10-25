import {useEffect,useRef,useState,type SubmitEvent} from 'react';
import {Button} from '@/components/ui/button';
import {ownedJson,ApiError} from '@/lib/api';
import {useAuth} from '@/lib/auth/auth-context';
import {successEnvelopeSchema} from '../../../shared/api';
import {MeasurementMutationSchema,MeasurementMutationResultSchema,measurementRegistry,type MeasurementMutation} from '../../../shared/data';
import type {MeasurementDTO} from '../../../shared/domain';

type Stage={kind:'editing'}|{kind:'review'|'saving';request:MeasurementMutation};
export function MeasurementEditor({reading,mode,source,onSaved,onCancel,onRefresh}:{reading:MeasurementDTO;mode:'correct'|'delete';source:string;onSaved:(message:string)=>void;onCancel:()=>void;onRefresh:()=>void}){
  const {state,scope}=useAuth();const session=state.kind==='signed_in' ? state.session : null;const epoch=scope.epoch;
  const [value,setValue]=useState(reading.originalValue);const [unit,setUnit]=useState(reading.originalUnit);const [observed,setObserved]=useState(reading.observedAt);
  const [zone,setZone]=useState(reading.timezone??'UTC');const [date,setDate]=useState(reading.localDate??'');
  const initial=mode==='delete' ? {kind:'review' as const,request:{action:'delete_measurement' as const,measurement_id:reading.id,expected_version:reading.version,client_request_id:crypto.randomUUID()}} : {kind:'editing' as const};
  const [stage,setStage]=useState<Stage>(initial);const [error,setError]=useState('');const [conflict,setConflict]=useState(false);
  const field=useRef<HTMLInputElement>(null);const confirm=useRef<HTMLButtonElement>(null);
  useEffect(()=>{if(stage.kind==='review')confirm.current?.focus();else if(stage.kind==='editing')field.current?.focus();},[stage.kind]);
  function review(event:SubmitEvent<HTMLFormElement>){
    event.preventDefault();setError('');setConflict(false);
    const request=MeasurementMutationSchema.safeParse({action:'correct_measurement',measurement_id:reading.id,expected_version:reading.version,client_request_id:crypto.randomUUID(),changes:{value,unit,observed_at:observed,timezone:zone,local_date:date||null}});
    if(!request.success){setError('Check the decimal value, unit, observation time and timezone.');return;}setStage({kind:'review',request:request.data});
  }
  async function save(){
    if(stage.kind!=='review' || !session)return;const request=stage.request;setError('');setStage({kind:'saving',request});
    try{
      const result=successEnvelopeSchema(MeasurementMutationResultSchema).parse(await ownedJson('/api/data',session.access_token,scope,epoch,{method:'POST',body:JSON.stringify(request)})).data;
      scope.commit(epoch,()=>onSaved(`${result.outcome==='deleted' ? 'Measurement deleted.' : 'Measurement corrected.'} ${result.baselinesMarked} goal baselines marked for review; ${result.previewsInvalidated} import previews invalidated.${result.outcome==='deleted' ? ' Retained exact trace content was removed; safe accounting and approved goal snapshots remain.' : ''} Data refreshed.`));
    }catch(e){scope.commit(epoch,()=>{setStage({kind:'review',request});setError(e instanceof Error ? e.message : 'The change could not be saved.');setConflict(e instanceof ApiError && (e.status===409 || e.status===404));});}
  }
  return <section className="data-confirm" role="region" aria-label={mode==='delete' ? 'Confirm deletion' : 'Correct measurement'}>
    <h3>{mode==='delete' ? 'Confirm deletion' : 'Correct measurement'}</h3><p>{measurementRegistry[reading.metric].label} · {source} · {reading.method} · {reading.granularity}. Version {reading.version}.</p>
    {mode==='correct' && <p>Source, metric, external identity, granularity and method stay fixed. Changing series identity requires deleting this reading and adding a new entry. Import lineage and source warnings are retained.</p>}
    {stage.kind==='editing' ? <form className="settings-form" onSubmit={review}>
      <label>Corrected value<input ref={field} required inputMode="decimal" maxLength={1024} value={value} onChange={e=>setValue(e.target.value)}/></label>
      <label htmlFor="correct-unit">Corrected unit</label><select id="correct-unit" value={unit} onChange={e=>setUnit(e.target.value)}>{measurementRegistry[reading.metric].units.map(u=><option key={u}>{u}</option>)}</select>
      <label>Corrected observation time<input required maxLength={100} value={observed} onChange={e=>setObserved(e.target.value)}/></label><p>Use an ISO date/time. Local times use the timezone below; ambiguous or nonexistent times require an explicit offset.</p>
      <label>Corrected timezone<input required maxLength={100} value={zone} onChange={e=>setZone(e.target.value)}/></label>
      <label>Corrected local date<input type="date" required={reading.granularity==='daily_total'} value={date} onChange={e=>setDate(e.target.value)}/></label>
      <Button type="submit">Review correction</Button><Button type="button" variant="outline" onClick={onCancel}>Cancel correction</Button>
    </form> : <>
      {stage.request.action==='correct_measurement' ? <><h4>Review correction</h4><p>Before: {reading.originalValue} {reading.originalUnit}; {reading.observedAt}; {reading.timezone}; {reading.localDate??'no local date'}.</p><p>After: {stage.request.changes.value} {stage.request.changes.unit}; {stage.request.changes.observed_at}; {stage.request.changes.timezone}; {stage.request.changes.local_date??'no local date'}.</p><p>This marks the observation as user-corrected and invalidates pending import previews. Approved goal baselines remain frozen and may need review.</p></> : <><p>Delete {reading.originalValue} {reading.originalUnit} at {reading.observedAt}?</p><p>The reading is physically removed from future analysis. Pending import previews and retained exact request, response, tool and provider-state traces are removed. Safe accounting remains.</p><p>Approved goal baseline snapshots remain as frozen historical decisions and are marked for review when potentially affected. They are never silently recalculated. A fresh import can recreate a deleted reading; replaying a committed batch cannot.</p></>}
      <div className="data-actions"><Button ref={confirm} disabled={stage.kind==='saving' || conflict} onClick={()=>void save()}>{stage.kind==='saving' ? 'Saving change…' : mode==='delete' ? 'Confirm delete measurement' : 'Confirm correction'}</Button>
        {mode==='correct' && <Button variant="outline" disabled={stage.kind==='saving'} onClick={()=>{setStage({kind:'editing'});setError('');setConflict(false);}}>Back to correction</Button>}
        <Button variant="outline" disabled={stage.kind==='saving'} onClick={onCancel}>Cancel change</Button></div>
    </>}
    {error && <p role="alert">{error}</p>}{conflict && <Button variant="outline" onClick={onRefresh}>Refresh reading</Button>}
  </section>;
}

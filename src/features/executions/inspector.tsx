import { useEffect, useRef, useState } from 'react';
import { useQuery,useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { ownedJson } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-context';
import { successEnvelopeSchema } from '../../../shared/api';
import { ContextManifestSchema } from '../../../shared/domain';
import { DataSummarySchema } from '../../../shared/data';
import { InspectionOverviewSchema, InspectionPayloadSchema } from '../../../shared/inspection';

type Part = 'input' | 'output' | 'context' | 'usage';
function bytesFromBase64(value:string) { return Uint8Array.from(atob(value), c=>c.charCodeAt(0)); }
function Evidence({run,step,part,incomplete=false}:{run:string;step:string;part:Part;incomplete?:boolean}) {
  const {state,scope}=useAuth();const session=state.kind==='signed_in'?state.session:null;const epoch=scope.epoch;
  const [visible,setVisible]=useState(false);const [notice,setNotice]=useState('');
  const query=useQuery({queryKey:['inspection',session?.user.id,epoch,run,step,part],enabled:visible&&!!session,retry:false,
    queryFn:async({signal})=>successEnvelopeSchema(InspectionPayloadSchema).parse(await ownedJson('/api/executions?'+new URLSearchParams({view:'payload',run,step,part}),session!.access_token,scope,epoch,{signal})).data});
  const data=query.data;let raw:string|null=null;let formatted:string|null=null;let context:ReturnType<typeof ContextManifestSchema.safeParse>|null=null;let summary:z.infer<typeof DataSummarySchema>|null=null;
  if(data?.state==='available') {
    try { raw=new TextDecoder('utf-8',{fatal:true}).decode(bytesFromBase64(data.base64)); } catch { raw=null; }
    if(raw!==null)try { const parsed:unknown=JSON.parse(raw);formatted=JSON.stringify(parsed,null,2);if(part==='context')context=ContextManifestSchema.safeParse(parsed);if(part==='output'){const result=z.object({result:z.object({kind:z.literal('summary'),data:DataSummarySchema})}).safeParse(parsed);if(result.success)summary=result.data.result.data;} } catch { /* An observed stream need not be JSON. */ }
  }
  function share(action:'copy'|'export') {
    if(!data||data.state!=='available'||(action==='copy'&&raw===null))return;
    if(!window.confirm('This evidence can contain private health data and conversation text. Continue?'))return;
    if(action==='copy'&&raw!==null) { void navigator.clipboard.writeText(raw).then(()=>setNotice('Copied exact text.'),()=>setNotice('Copy failed.'));return; }
    const url=URL.createObjectURL(new Blob([bytesFromBase64(data.base64)],{type:'application/octet-stream'}));
    const a=document.createElement('a');a.href=url;a.download=`vulpes-${part}-${step}.bin`;a.click();URL.revokeObjectURL(url);setNotice('Evidence exported.');
  }
  return <section className="inspection-evidence"><h4>{part==='input'?'Exact input':part==='output'?'Observed output':part==='context'?'Context manifest':'Raw usage'}</h4>
    {part==='output'&&incomplete&&<p>This is an incomplete observed prefix, not a completed response.</p>}
    {!visible&&<Button variant="outline" onClick={()=>setVisible(true)}>Load {part}</Button>}
    {query.isPending&&visible&&<p role="status">Loading evidence…</p>}{query.isError&&<p role="alert">Evidence could not be loaded.</p>}
    {data&&data.state!=='available'&&<p>Evidence {data.state}. Exact content cannot be reconstructed.</p>}
    {data?.state==='available'&&<><p>Available until {data.expiresAt}. Private content.</p>
      {data.completeness==='partial'&&<p>This older context manifest is partial; some included items were not recorded.</p>}
      {raw===null&&<p>These bytes are not valid UTF-8. Exact byte export is available.</p>}
      {part==='context'&&(context?.success?<><h5>Included</h5><ul>{context.data.included.map(item=><li key={item.reference.id}>{item.reference.label} ({item.reference.kind}) · hash {item.contentHash}</li>)}</ul><h5>Excluded</h5>{context.data.excluded.length?<ul>{context.data.excluded.map((item,i)=><li key={`${item.referenceId}:${i}`}>{item.referenceId}: {item.reason}</li>)}</ul>:<p>No exclusions recorded.</p>}</>:<p>Context manifest is malformed.</p>)}
      {summary&&<section><h5>Calculation and sources</h5><p>{summary.selection.metric} · source {summary.selection.source_id} · {summary.selection.method} · {summary.selection.granularity}</p><p>{summary.selection.from} to {summary.selection.to} (end excluded) · {summary.selection.timezone}</p><p>{summary.analysis.algorithmVersion} · {summary.analysis.validDays} valid days · {summary.analysis.observationCount} observations · {summary.analysis.coverageStatus}</p><ul>{summary.analysis.references.map(reference=><li key={`${reference.kind}:${reference.id}`}>{reference.label} ({reference.kind}: {reference.id})</li>)}</ul></section>}
      {raw!==null&&<pre className="inspection-raw">{raw}</pre>}{formatted!==null&&<details><summary>Formatted JSON (not the raw bytes)</summary><pre className="inspection-raw">{formatted}</pre></details>}<div className="inspection-actions">{raw!==null&&<Button variant="outline" onClick={()=>share('copy')}>Copy exact text</Button>}<Button variant="outline" onClick={()=>share('export')}>Export exact bytes</Button></div><p role="status">{notice}</p></>}
  </section>;
}

export default function Inspector({run,onClose}:{run:string;onClose:()=>void}) {
  const {state,scope}=useAuth();const session=state.kind==='signed_in'?state.session:null;const epoch=scope.epoch;const dialog=useRef<HTMLDialogElement>(null);
  const client=useQueryClient();const userId=session?.user.id;
  useEffect(()=>()=>{client.removeQueries({queryKey:['inspection',userId,epoch,run]});},[client,userId,epoch,run]);
  useEffect(()=>{const node=dialog.current;node?.showModal();return ()=>node?.close();},[]);
  const query=useQuery({queryKey:['inspection',session?.user.id,epoch,run,'overview'],enabled:!!session,retry:false,
    queryFn:async({signal})=>successEnvelopeSchema(InspectionOverviewSchema).parse(await ownedJson('/api/executions?'+new URLSearchParams({run}),session!.access_token,scope,epoch,{signal})).data});
  function close() { dialog.current?.close();onClose(); }
  return <dialog ref={dialog} className="inspection-dialog" aria-labelledby="inspection-title" onCancel={e=>{e.preventDefault();close();}}>
    <header><h2 id="inspection-title">Execution inspector</h2><Button variant="outline" onClick={close}>Close</Button></header>
    {query.isPending&&<p role="status">Loading execution…</p>}{query.isError&&<div role="alert"><p>Execution could not be loaded.</p><Button variant="outline" onClick={()=>void query.refetch()}>Retry execution</Button></div>}
    {query.data&&<><section><h3>Overview</h3><p>{query.data.run.state} · trace {query.data.run.traceState} · {query.data.run.admittedAt}</p>
      <p>{query.data.run.route?.role ?? 'No model'} · {query.data.run.route?.provider ?? 'unknown provider'} · {query.data.run.route?.model ?? 'unknown model'}</p>
      <p>Cost {query.data.run.costStatus}: {query.data.run.costUSD===null?'unknown':`$${query.data.run.costUSD}`} · known ${query.data.run.knownCostUSD} · reserved ${query.data.run.reservationUSD}</p>
      {query.data.routeHistory.map(change=><p key={change.sourceStepId}>Authorized handoff: Everyday → Intermediate · {change.reason}</p>)}
        <p>Evidence revision: {query.data.evidenceRevision}{query.data.evidenceRevision==='stale'?' (historical; current data has changed)':''}.</p>
      <p>Seven-day private trace retention. RAG and web research were not used. This view shows what Vulpes sent and received, not hidden provider instructions or reasoning.</p></section>
      {query.data.steps.map(step=><section key={step.id} className="inspection-step" data-step-id={step.id}><h3>Step {step.sequence}: {step.type}{step.toolName?` · ${step.toolName}`:''}</h3>
        <p>{step.status} · dispatch {step.dispatchState} · {step.startedAt}</p><p>{step.provider??'Local tool'} · adapter {step.adapterVersion??'unknown'}</p>
        <p>Model requested {step.model??'none'}, provider-reported {step.effectiveModel??'unknown'}</p>
        <p>Effort requested {step.requestedEffort??'unknown'}, provider-reported {step.effectiveEffort??'unknown'} · finish {step.finishReason??'unknown'} (adapter-normalized)</p>
        <p>Request SHA-256: {step.requestBodyHash??'unavailable'}</p><p>Cost {step.costStatus}: {step.costUSD===null?'unknown':`$${step.costUSD}`} · bound {step.costBoundState}</p>
        <p>Tokens: input {step.usage.inputTokens??'unknown'}, output {step.usage.outputTokens??'unknown'}, reasoning {step.usage.reasoningTokens??'unknown'}, cache read {step.usage.cacheReadTokens??'unknown'}, cache write {step.usage.cacheWriteTokens??'unknown'}</p>
        <details><summary>Request metadata and price snapshot</summary><pre className="inspection-raw">{JSON.stringify({request:step.requestMetadata,price:step.priceSnapshot,providerRequestId:step.providerRequestId},null,2)}</pre></details>
        <Evidence run={run} step={step.id} part="input"/><Evidence run={run} step={step.id} part="output" incomplete={step.status!=='completed'}/>{step.type!=='tool'&&<><Evidence run={run} step={step.id} part="context"/><Evidence run={run} step={step.id} part="usage"/></>}
      </section>)}
    </>}
  </dialog>;
}

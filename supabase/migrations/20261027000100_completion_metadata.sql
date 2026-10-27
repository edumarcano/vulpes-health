begin;
alter table public.ai_steps add column effective_model_id text;

-- Only settlement can persist bounded, observable response metadata. The same
-- content fence as encrypted evidence prevents late writes after invalidation.
create function public.record_step_completion_v1(p_owner uuid,p_run uuid,p_executor uuid,p_fence bigint,p_step uuid,p_completion jsonb) returns void
language plpgsql security definer set search_path='' as $$
declare r public.ai_runs; s public.ai_steps; field text; value text;
begin
  r:=public.lock_run_v1(p_owner,p_run,p_executor,p_fence,true);
  select * into s from public.ai_steps where user_id=p_owner and run_id=p_run and id=p_step for update;
  if not found or s.step_type='tool' or s.status<>'started' or s.dispatch_state<>'send_authorized' or s.output_payload_id is null then raise exception 'invalid_completion'; end if;
  if jsonb_typeof(p_completion) is distinct from 'object'
    or not (p_completion ?& array['finishReason','providerRequestId','effectiveModel','effectiveEffort'])
    or (p_completion-array['finishReason','providerRequestId','effectiveModel','effectiveEffort'])<>'{}'::jsonb
    or coalesce(p_completion->>'finishReason','') not in ('stop','tool_calls','length','blocked') then raise exception 'invalid_completion'; end if;
  foreach field in array array['providerRequestId','effectiveModel','effectiveEffort'] loop
    value:=p_completion->>field;
    if jsonb_typeof(p_completion->field) not in ('string','null') or (value is not null and
      (char_length(value) not between 1 and case when field='effectiveEffort' then 100 else 200 end or value !~ '^[A-Za-z0-9][A-Za-z0-9._:/-]*$')) then raise exception 'invalid_completion'; end if;
  end loop;
  update public.ai_steps set provider_request_id=p_completion->>'providerRequestId',finish_reason=p_completion->>'finishReason',
    effective_model_id=p_completion->>'effectiveModel',effective_effort=p_completion->>'effectiveEffort' where id=s.id;
end;
$$;
revoke all on function public.record_step_completion_v1(uuid,uuid,uuid,bigint,uuid,jsonb) from public,anon,authenticated,service_role;

create or replace function public.settle_step_v1(p_owner uuid,p_run uuid,p_step uuid,p_evidence jsonb,p_status text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.ai_runs; s public.ai_steps; v public.usage_reservations; amount numeric; delta numeric; next_hash text; trace_failed boolean:=coalesce((p_evidence->>'traceIncomplete')::boolean,false);
  source text:=p_evidence->>'source'; now_at timestamptz:=clock_timestamp();
begin
  r:=public.lock_run_v1(p_owner,p_run);
  select * into s from public.ai_steps where user_id=p_owner and run_id=p_run and id=p_step for update;
  if not found or p_status not in ('completed','failed','cancelled','interrupted') or source not in ('reported','estimated','conservative','not_sent','pending') then raise exception 'invalid_settlement'; end if;
  if s.status<>'started' then p_status:=s.status; end if;
  if s.step_type='tool' then
    if source<>'not_sent' then raise exception 'invalid_settlement'; end if;
    update public.ai_steps set status=p_status,finished_at=coalesce(finished_at,now_at),cost_usd=0,cost_status='reported' where id=s.id;
    return public.run_summary_v1(p_owner,p_run);
  end if;
  -- Bucket lock order is identical to reservation, even for late corrections.
  perform 1 from public.usage_buckets where id=(select app_bucket_id from public.usage_reservations where user_id=p_owner and step_id=p_step) for update;
  perform 1 from public.usage_buckets where id=(select account_bucket_id from public.usage_reservations where user_id=p_owner and step_id=p_step) for update;
  select * into v from public.usage_reservations where user_id=p_owner and step_id=p_step for update;
  if not found then raise exception 'invalid_settlement'; end if;
  next_hash:=encode(sha256(convert_to((p_evidence-array['expectedVersion','usagePayload','executor','fence'])::text,'UTF8')),'hex');
  if v.evidence_hash=next_hash then return public.run_summary_v1(p_owner,p_run); end if;
  if (p_evidence->>'expectedVersion')::integer is distinct from v.evidence_version then raise exception 'settlement_conflict'; end if;
  if (p_evidence ? 'usagePayload' or p_evidence ? 'completion') and r.status in ('admitted','running') and r.trace_content_removed_at is null then
    begin
      if p_evidence ? 'usagePayload' then
        perform public.record_step_usage_v1(p_owner,p_run,(p_evidence->>'executor')::uuid,(p_evidence->>'fence')::bigint,p_step,p_evidence->'usage',p_evidence->'usagePayload');
      end if;
      if p_evidence ? 'completion' then
        perform public.record_step_completion_v1(p_owner,p_run,(p_evidence->>'executor')::uuid,(p_evidence->>'fence')::bigint,p_step,p_evidence->'completion');
      end if;
    exception when others then trace_failed:=true;
    end;
  end if;
  if trace_failed and s.status='started' then p_status:='failed'; end if;
  if source='not_sent' and s.dispatch_state<>'prepared' then raise exception 'invalid_settlement'; end if;
  if source in ('reported','estimated','pending') and s.dispatch_state='prepared' then raise exception 'invalid_settlement'; end if;
  if source='conservative' and (v.uncertain_since is null or v.uncertain_since+interval '24 hours'>now_at) then raise exception 'settlement_not_due'; end if;
  if source='pending' then
    if v.status='settled' then raise exception 'settlement_conflict'; end if;
    update public.usage_reservations set status='pending',uncertain_since=coalesce(uncertain_since,now_at),evidence_version=evidence_version+1,evidence_hash=next_hash where id=v.id;
  else
    amount:=case when source='not_sent' then 0 when source='conservative' then v.amount_usd else (p_evidence->>'costUSD')::numeric end;
    if amount is null or amount<0 or amount in ('NaN'::numeric,'Infinity'::numeric) then raise exception 'invalid_settlement'; end if;
    if v.status='settled' and source in ('conservative','not_sent') then raise exception 'settlement_conflict'; end if;
    delta:=amount-case when v.status='settled' then v.known_cost_usd else 0 end;
    update public.usage_buckets set spent_usd=spent_usd+delta,reserved_usd=reserved_usd-case when v.status='settled' then 0 else v.amount_usd end where id in(v.app_bucket_id,v.account_bucket_id);
    update public.usage_reservations set status='settled',known_cost_usd=amount,unknown_cost=source='conservative',settled_at=coalesce(settled_at,now_at),
      evidence_version=evidence_version+1,evidence_hash=next_hash where id=v.id;
  end if;
  update public.ai_steps set status=p_status,finished_at=coalesce(finished_at,now_at),
    dispatch_state=case when source='not_sent' then dispatch_state else 'finished' end,
    cost_usd=case when source='pending' then null else amount end,cost_status=case when source='not_sent' then 'reported' else source end,
    cost_bound_state=case when amount>v.amount_usd then 'exceeded' else cost_bound_state end where id=s.id;
  update public.ai_runs set cost_usd=(public.run_summary_v1(p_owner,p_run)->>'costUSD')::numeric,
    cost_status=public.run_summary_v1(p_owner,p_run)->>'costStatus',
    trace_state=case when trace_failed and trace_state<>'removed' then 'incomplete' else trace_state end
    where user_id=p_owner and id=p_run;
  return public.run_summary_v1(p_owner,p_run);
end;
$$;
commit;

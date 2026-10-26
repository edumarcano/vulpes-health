begin;

alter table public.profiles add column monthly_preference_usd numeric
  check (monthly_preference_usd >= 0 and monthly_preference_usd not in ('NaN'::numeric,'Infinity'::numeric));
alter table public.ai_runs alter column conversation_id drop not null;
alter table public.ai_runs add column executor_hash text check (executor_hash ~ '^[0-9a-f]{64}$'),
  add column fence bigint not null default 1 check (fence>0),
  add column lease_expires_at timestamptz not null default (clock_timestamp()+interval '30 seconds'),
  add column deadline_at timestamptz not null default (clock_timestamp()+interval '210 seconds'),
  add column accounting_period date not null default ((date_trunc('month',clock_timestamp() at time zone 'UTC'))::date),
  add column max_cost_usd numeric not null default 0 check (max_cost_usd>=0 and max_cost_usd not in ('NaN'::numeric,'Infinity'::numeric)),
  add column data_revision bigint not null default 0,
  add column trace_state text not null default 'unavailable' check (trace_state in ('available','expired','removed','incomplete','unavailable')),
  add column partial_output boolean not null default false;
update public.ai_runs set accounting_period=(date_trunc('month',admitted_at at time zone 'UTC'))::date,
  deadline_at=admitted_at+interval '210 seconds',lease_expires_at=coalesce(heartbeat_at,admitted_at)+interval '30 seconds';
alter table public.ai_runs add constraint run_period_month check (extract(day from accounting_period)=1);
create index ai_runs_admission_rate on public.ai_runs(user_id,admitted_at);
alter table public.ai_steps add column dispatch_state text not null default 'prepared'
    check (dispatch_state in ('prepared','send_authorized','finished','not_applicable')),
  add column dispatch_authorized_at timestamptz,
  add column request_body_hash text check (request_body_hash ~ '^[0-9a-f]{64}$'),
  add column context_payload_id uuid,
  add column continuation_payload_id uuid,
  add column request_metadata jsonb not null default '{}' check (octet_length(request_metadata::text)<=16384),
  add column cost_bound_state text not null default 'within_bound' check (cost_bound_state in ('within_bound','exceeded')),
  add constraint steps_context_payload_fk foreign key(user_id,context_payload_id) references public.private_payloads(user_id,id) on delete set null(context_payload_id),
  add constraint steps_continuation_payload_fk foreign key(user_id,continuation_payload_id) references public.private_payloads(user_id,id) on delete set null(continuation_payload_id);
create index ai_steps_cost_bound on public.ai_steps(provider,model_id) where cost_bound_state='exceeded';
alter table public.usage_reservations add column uncertain_since timestamptz,
  add column evidence_version integer not null default 0 check (evidence_version>=0),
  add column evidence_hash text check (evidence_hash ~ '^[0-9a-f]{64}$');
alter table public.messages add column client_request_id uuid,
  add column request_hash text check (request_hash ~ '^[0-9a-f]{64}$'),
  add column context_state text not null default 'eligible' check (context_state in ('eligible','source_removed'));
create unique index messages_request_receipt on public.messages(user_id,client_request_id) where client_request_id is not null;

-- Helpers are internal to the narrow definer RPCs. No caller, including the
-- service role, receives EXECUTE on these helpers.
create function public.lock_run_v1(p_owner uuid,p_run uuid,p_executor uuid default null,p_fence bigint default null,p_content boolean default false)
returns public.ai_runs language plpgsql security definer set search_path='' as $$
declare r public.ai_runs; profile public.profiles;
begin
  select * into profile from public.profiles where user_id=p_owner for update;
  if not found then raise exception 'run_not_found'; end if;
  select * into r from public.ai_runs where user_id=p_owner and id=p_run;
  if not found then raise exception 'run_not_found'; end if;
  perform 1 from public.conversations where user_id=p_owner and id=r.conversation_id for update;
  select * into r from public.ai_runs where user_id=p_owner and id=p_run for update;
  if p_executor is not null and r.executor_hash is distinct from encode(sha256(convert_to(p_executor::text,'UTF8')),'hex') then raise exception 'executor_denied'; end if;
  if p_content and (profile.account_state<>'active' or p_executor is null or p_fence is distinct from r.fence
    or r.status not in ('admitted','running') or r.trace_content_removed_at is not null
    or r.data_revision<>profile.data_revision or clock_timestamp()>=r.deadline_at or clock_timestamp()>=r.lease_expires_at
    or not exists(select 1 from public.conversations where user_id=p_owner and id=r.conversation_id and not archived)) then raise exception 'run_not_writable'; end if;
  return r;
end;
$$;
create function public.run_summary_v1(p_owner uuid,p_run uuid) returns jsonb
language sql security definer set search_path='' as $$
  select jsonb_build_object('id',r.id,'conversationId',r.conversation_id,'state',r.status,
    'requestedDepth',r.requested_depth,'route',r.route,'assistantMessageId',(select id from public.messages where user_id=r.user_id and run_id=r.id and role='assistant' order by created_at,id limit 1),
    'admittedAt',r.admitted_at,'deadlineAt',r.deadline_at,'finishedAt',r.finished_at,'accountingPeriod',r.accounting_period,
    'traceState',case when r.trace_content_removed_at is not null then 'removed'
      when r.trace_state='available' and exists(select 1 from public.ai_steps s left join public.private_payloads p on p.user_id=s.user_id and p.id=s.input_payload_id
        where s.run_id=r.id and s.user_id=r.user_id and (p.id is null or p.expires_at<=clock_timestamp())) then 'expired' else r.trace_state end,
    'partialOutput',r.partial_output,'costUSD',case when coalesce(a.pending,0)>0 then null else coalesce(a.known,0)::text end,
    'knownCostUSD',coalesce(a.known,0)::text,'reservationUSD',coalesce(a.held,0)::text,
    'costStatus',case when coalesce(a.pending,0)>0 then 'pending' when coalesce(a.conservative,0)>0 then 'conservative'
      when coalesce(a.estimated,0)>0 then 'estimated' else 'reported' end)
  from public.ai_runs r left join lateral(select
    sum(case when v.status='settled' then v.known_cost_usd else 0 end) known,
    sum(case when v.status<>'settled' then v.amount_usd else 0 end) held,
    count(*) filter(where v.status<>'settled') pending,
    count(*) filter(where s.cost_status='conservative') conservative,count(*) filter(where s.cost_status='estimated') estimated
    from public.usage_reservations v join public.ai_steps s on s.user_id=v.user_id and s.id=v.step_id where v.user_id=r.user_id and v.run_id=r.id) a on true
  where r.user_id=p_owner and r.id=p_run;
$$;
create function public.store_run_envelope_v1(p_owner uuid,p_envelope jsonb,p_purpose text) returns uuid
language plpgsql security definer set search_path='' as $$
declare e public.private_payloads;
begin
  e:=jsonb_populate_record(null::public.private_payloads,p_envelope);
  if e.user_id is distinct from p_owner or e.purpose is distinct from p_purpose or e.payload_version<>1
    or e.expires_at<=clock_timestamp() or e.expires_at>clock_timestamp()+interval '7 days' then raise exception 'invalid_run_payload'; end if;
  insert into public.private_payloads(id,user_id,purpose,payload_version,encrypted_bytes,nonce,key_id,content_hash,encoding,encryption_algorithm,expires_at)
    values(e.id,e.user_id,e.purpose,e.payload_version,e.encrypted_bytes,e.nonce,e.key_id,e.content_hash,e.encoding,e.encryption_algorithm,e.expires_at);
  return e.id;
end;
$$;

create function public.admit_run_v1(p_owner uuid,p_request jsonb,p_executor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare profile public.profiles; r public.ai_runs; conversation uuid; depth text; route jsonb; now_at timestamptz:=clock_timestamp();
begin
  select * into profile from public.profiles where user_id=p_owner for update;
  if not found or profile.account_state<>'active' then raise exception 'account_unavailable'; end if;
  conversation:=(p_request->>'conversationId')::uuid;
  perform 1 from public.conversations where user_id=p_owner and id=conversation for update;
  if not found then raise exception 'run_not_found'; end if;
  select * into r from public.ai_runs where user_id=p_owner and client_request_id=(p_request->>'clientRequestId')::uuid;
  if found then
    if r.request_hash is distinct from p_request->>'requestHash' then raise exception 'idempotency_conflict'; end if;
    return jsonb_build_object('kind','existing','run',public.run_summary_v1(p_owner,r.id));
  end if;
  if exists(select 1 from public.conversations where user_id=p_owner and id=conversation and archived) then raise exception 'run_not_writable'; end if;
  select * into r from public.ai_runs where user_id=p_owner and status in ('admitted','running','cancellation_requested');
  if found then return jsonb_build_object('kind','busy','run',public.run_summary_v1(p_owner,r.id)); end if;
  if (select count(*) from public.ai_runs where user_id=p_owner and admitted_at>now_at-interval '1 minute')>=10 then raise exception 'run_rate_limited'; end if;
  depth:=p_request->>'depth';route:=p_request->'route';
  if depth not in ('auto','everyday','intermediate','advanced') or (p_request->>'maxCostUSD')::numeric<=0
    or route->>'provider' not in ('openrouter','vertex_ai') or char_length(route->>'model') not between 1 and 200
    or profile.consent_versions#>>array[route->>'provider','accepted_version'] is distinct from p_request->>'consentVersion'
    or profile.consent_versions#>>array[route->>'provider','accepted_at'] is null then raise exception 'run_policy_denied'; end if;
  insert into public.ai_runs(user_id,conversation_id,client_request_id,request_hash,requested_depth,route,policy_version,consent_versions,
    executor_hash,admitted_at,deadline_at,lease_expires_at,accounting_period,max_cost_usd,data_revision,limits)
  values(p_owner,conversation,(p_request->>'clientRequestId')::uuid,p_request->>'requestHash',depth,route,'vulpes-run-v1',profile.consent_versions,
    encode(sha256(convert_to(p_executor::text,'UTF8')),'hex'),now_at,now_at+interval '210 seconds',now_at+interval '30 seconds',
    date_trunc('month',now_at at time zone 'UTC')::date,(p_request->>'maxCostUSD')::numeric,profile.data_revision,
    '{"modelRequests":4,"toolCalls":6,"deadlineSeconds":210}'::jsonb) returning * into r;
  return jsonb_build_object('kind','admitted','run',public.run_summary_v1(p_owner,r.id));
end;
$$;

create function public.prepare_step_v1(p_owner uuid,p_run uuid,p_executor uuid,p_fence bigint,p_step jsonb,p_input jsonb,p_context jsonb default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.ai_runs; s public.ai_steps; household public.usage_buckets; account public.usage_buckets; preference numeric;
  amount numeric:=(p_step->>'reservationUSD')::numeric; input_id uuid; context_id uuid; seq integer; paid boolean:=p_step->>'type'<>'tool';
begin
  r:=public.lock_run_v1(p_owner,p_run,p_executor,p_fence,true);
  if p_step->>'type' not in ('generation','decision','tool') or amount is null or amount<0 or amount in ('NaN'::numeric,'Infinity'::numeric)
    or (not paid and amount<>0) then raise exception 'invalid_step'; end if;
  if exists(select 1 from public.ai_steps where user_id=p_owner and run_id=p_run and status='started') then raise exception 'step_in_progress'; end if;
  if (select count(*) from public.ai_steps where user_id=p_owner and run_id=p_run and (step_type='tool')=(not paid)) >= (case when paid then 4 else 6 end) then raise exception 'run_call_limit'; end if;
  if paid then
    if p_step->>'provider' is distinct from r.route->>'provider' or p_step->>'model' is distinct from r.route->>'model'
      or p_step#>>'{price,status}' is distinct from 'verified' or p_step#>>'{price,currency}' is distinct from 'USD'
      or p_step#>>'{price,outputLimitVerified}' is distinct from 'true' or p_step#>>'{price,inputBoundVerified}' is distinct from 'true'
      or (select consent_versions#>>array[p_step->>'provider','accepted_version'] from public.profiles where user_id=p_owner)
        is distinct from r.consent_versions#>>array[p_step->>'provider','accepted_version']
      or (select consent_versions#>>array[p_step->>'provider','accepted_at'] from public.profiles where user_id=p_owner) is null
      then raise exception 'run_policy_denied'; end if;
    if exists(select 1 from public.ai_steps where provider=p_step->>'provider' and model_id=p_step->>'model' and cost_bound_state='exceeded') then raise exception 'cost_bound_exceeded'; end if;
    select * into household from public.usage_buckets where scope='household' and period_start=r.accounting_period for update;
    if not found then raise exception 'budget_unconfigured'; end if;
    select * into account from public.usage_buckets where user_id=p_owner and scope='user' and period_start=r.accounting_period for update;
    if not found then raise exception 'budget_unconfigured'; end if;
    select monthly_preference_usd into preference from public.profiles where user_id=p_owner;
    if household.spent_usd+household.reserved_usd+amount>household.allocated_ceiling_usd
      or account.spent_usd+account.reserved_usd+amount>least(account.allocated_ceiling_usd,coalesce(account.lower_preference_usd,account.allocated_ceiling_usd),coalesce(preference,account.allocated_ceiling_usd))
      or amount+coalesce((select sum(case when status='settled' then known_cost_usd else amount_usd end) from public.usage_reservations where user_id=p_owner and run_id=p_run),0)>r.max_cost_usd then raise exception 'budget_exhausted'; end if;
  end if;
  input_id:=public.store_run_envelope_v1(p_owner,p_input,case when paid then 'ai_request' else 'tool_input' end);
  if p_context is not null then context_id:=public.store_run_envelope_v1(p_owner,p_context,'provider_state'); end if;
  select coalesce(max(sequence),0)+1 into seq from public.ai_steps where user_id=p_owner and run_id=p_run;
  insert into public.ai_steps(id,user_id,run_id,sequence,step_type,status,dispatch_state,provider,model_id,adapter_version,requested_effort,effective_effort,tool_name,
    input_payload_id,context_payload_id,request_body_hash,request_metadata,price_snapshot)
  values((p_step->>'id')::uuid,p_owner,p_run,seq,p_step->>'type','started',case when paid then 'prepared' else 'not_applicable' end,
    p_step->>'provider',p_step->>'model',p_step->>'adapterVersion',p_step->>'requestedEffort',p_step->>'effectiveEffort',p_step->>'toolName',
    input_id,context_id,p_input->>'content_hash',coalesce(p_step->'metadata','{}'),case when paid then p_step->'price' else null end) returning * into s;
  if paid then
    update public.usage_buckets set reserved_usd=reserved_usd+amount where id in (household.id,account.id);
    insert into public.usage_reservations(user_id,run_id,step_id,period_start,user_bucket_id,household_bucket_id,amount_usd)
      values(p_owner,p_run,s.id,r.accounting_period,account.id,household.id,amount);
  end if;
  update public.ai_runs set status='running',started_at=coalesce(started_at,clock_timestamp()),trace_state='available',
    input_tokens=case when paid then null else input_tokens end,output_tokens=case when paid then null else output_tokens end where user_id=p_owner and id=p_run;
  return s.id;
end;
$$;

create function public.authorize_send_v1(p_owner uuid,p_run uuid,p_executor uuid,p_fence bigint,p_step uuid,p_body_hash text) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.ai_runs; s public.ai_steps;
begin
  r:=public.lock_run_v1(p_owner,p_run,p_executor,p_fence,true);
  select * into s from public.ai_steps where user_id=p_owner and run_id=p_run and id=p_step for update;
  if not found or s.status<>'started' or s.step_type='tool' then raise exception 'invalid_step'; end if;
  if s.request_body_hash is distinct from p_body_hash then raise exception 'trace_unavailable'; end if;
  if s.dispatch_state<>'prepared' then return false; end if;
  if (select consent_versions#>>array[s.provider,'accepted_version'] from public.profiles where user_id=p_owner)
      is distinct from r.consent_versions#>>array[s.provider,'accepted_version']
    or (select consent_versions#>>array[s.provider,'accepted_at'] from public.profiles where user_id=p_owner) is null then raise exception 'run_policy_denied'; end if;
  if (select consent_versions->s.provider from public.profiles where user_id=p_owner) is distinct from r.consent_versions->s.provider then raise exception 'run_policy_denied'; end if;
  perform 1 from public.usage_buckets where id=(select household_bucket_id from public.usage_reservations where user_id=p_owner and step_id=p_step) for update;
  perform 1 from public.usage_buckets where id=(select user_bucket_id from public.usage_reservations where user_id=p_owner and step_id=p_step) for update;
  if exists(select 1 from public.usage_buckets b join public.usage_reservations v on b.id in(v.user_bucket_id,v.household_bucket_id)
    join public.profiles p on p.user_id=v.user_id where v.user_id=p_owner and v.step_id=p_step
      and b.spent_usd+b.reserved_usd>least(b.allocated_ceiling_usd,coalesce(b.lower_preference_usd,b.allocated_ceiling_usd),
        case when b.scope='user' then coalesce(p.monthly_preference_usd,b.allocated_ceiling_usd) else b.allocated_ceiling_usd end)) then raise exception 'budget_exhausted'; end if;
  if not exists(select 1 from public.private_payloads where user_id=p_owner and id=s.input_payload_id and purpose='ai_request' and expires_at>clock_timestamp()) then raise exception 'trace_unavailable'; end if;
  update public.ai_steps set dispatch_state='send_authorized',dispatch_authorized_at=clock_timestamp() where id=s.id;
  return true;
end;
$$;

create function public.heartbeat_run_v1(p_owner uuid,p_run uuid,p_executor uuid,p_fence bigint) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.ai_runs;
begin
  r:=public.lock_run_v1(p_owner,p_run,p_executor,p_fence,true);
  update public.ai_runs set heartbeat_at=clock_timestamp(),lease_expires_at=least(deadline_at,clock_timestamp()+interval '30 seconds') where id=p_run;
  return public.run_summary_v1(p_owner,p_run);
end;
$$;

create function public.checkpoint_step_v1(p_owner uuid,p_run uuid,p_executor uuid,p_fence bigint,p_step uuid,p_output jsonb,p_message jsonb default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.ai_runs; s public.ai_steps; next_id uuid;
begin
  r:=public.lock_run_v1(p_owner,p_run,p_executor,p_fence,true);
  select * into s from public.ai_steps where user_id=p_owner and run_id=p_run and id=p_step for update;
  if not found or s.status<>'started' or (s.step_type<>'tool' and s.dispatch_state<>'send_authorized') then raise exception 'invalid_step'; end if;
  next_id:=public.store_run_envelope_v1(p_owner,p_output,case when s.step_type='tool' then 'tool_output' else 'ai_response' end);
  update public.ai_steps set output_payload_id=next_id where id=s.id;
  delete from public.private_payloads where user_id=p_owner and id=s.output_payload_id;
  if p_message is not null then
    if jsonb_typeof(p_message->'parts') is distinct from 'array' or octet_length((p_message->'parts')::text)>2097152 then raise exception 'invalid_message'; end if;
    update public.messages set content_parts=p_message->'parts' where user_id=p_owner and run_id=p_run and id=(p_message->>'id')::uuid and role='assistant' and status='streaming';
    if not found then raise exception 'invalid_message'; end if;
  end if;
  update public.ai_runs set partial_output=partial_output or (p_message is not null and exists(
    select 1 from jsonb_array_elements(p_message->'parts') part where (part->>'type'='text' and coalesce(part->>'text','')<>'') or part->>'type'='card')) where id=p_run;
  return next_id;
end;
$$;

create function public.settle_step_v1(p_owner uuid,p_run uuid,p_step uuid,p_evidence jsonb,p_status text) returns jsonb
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
  perform 1 from public.usage_buckets where id=(select household_bucket_id from public.usage_reservations where user_id=p_owner and step_id=p_step) for update;
  perform 1 from public.usage_buckets where id=(select user_bucket_id from public.usage_reservations where user_id=p_owner and step_id=p_step) for update;
  select * into v from public.usage_reservations where user_id=p_owner and step_id=p_step for update;
  if not found then raise exception 'invalid_settlement'; end if;
  next_hash:=encode(sha256(convert_to((p_evidence-array['expectedVersion','usagePayload','executor','fence'])::text,'UTF8')),'hex');
  if v.evidence_hash=next_hash then return public.run_summary_v1(p_owner,p_run); end if;
  if (p_evidence->>'expectedVersion')::integer is distinct from v.evidence_version then raise exception 'settlement_conflict'; end if;
  if p_evidence ? 'usagePayload' and r.status in ('admitted','running') and r.trace_content_removed_at is null then
    begin
      perform public.record_step_usage_v1(p_owner,p_run,(p_evidence->>'executor')::uuid,(p_evidence->>'fence')::bigint,p_step,p_evidence->'usage',p_evidence->'usagePayload');
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
    update public.usage_buckets set spent_usd=spent_usd+delta,reserved_usd=reserved_usd-case when v.status='settled' then 0 else v.amount_usd end where id in(v.household_bucket_id,v.user_bucket_id);
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

create function public.cancel_run_v1(p_owner uuid,p_run uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.ai_runs;
begin
  r:=public.lock_run_v1(p_owner,p_run);
  if r.status in ('admitted','running') then
    update public.ai_runs set status='cancellation_requested',cancellation_requested_at=clock_timestamp(),fence=fence+1 where id=p_run;
  end if;
  return public.run_summary_v1(p_owner,p_run);
end;
$$;

create function public.finish_run_v1(p_owner uuid,p_run uuid,p_executor uuid,p_status text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.ai_runs; target text;
begin
  r:=public.lock_run_v1(p_owner,p_run,p_executor);
  if r.status in ('completed','failed','cancelled','interrupted') then return public.run_summary_v1(p_owner,p_run); end if;
  if p_status not in ('completed','failed','cancelled','interrupted') then raise exception 'invalid_run_state'; end if;
  if exists(select 1 from public.ai_steps where user_id=p_owner and run_id=p_run and status='started') then raise exception 'step_in_progress'; end if;
  target:=case when r.status='cancellation_requested' then 'cancelled'
    when clock_timestamp()>=least(r.lease_expires_at,r.deadline_at) or r.data_revision<>(select data_revision from public.profiles where user_id=p_owner) then 'interrupted'
    when exists(select 1 from public.ai_steps where user_id=p_owner and run_id=p_run and status='failed') then 'failed' else p_status end;
  update public.ai_runs set status=target,finished_at=clock_timestamp(),fence=fence+1,
    trace_state=case when target in ('failed','interrupted') and trace_state='available' then 'incomplete' else trace_state end where id=p_run;
  update public.messages set status=case when target='completed' then 'completed' when target='failed' then 'failed' else 'interrupted' end
    where user_id=p_owner and run_id=p_run and role='assistant' and status='streaming';
  return public.run_summary_v1(p_owner,p_run);
end;
$$;

-- Ordinary payload writes remain available for import staging only. AI evidence
-- must pass the run-bound transaction above, including deletion fencing.
create or replace function public.store_private_payload_v1(p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare e public.private_payloads;
begin
  e:=jsonb_populate_record(null::public.private_payloads,p_payload);
  perform 1 from public.profiles where user_id=e.user_id and account_state='active' for update;
  if not found then raise exception 'account_unavailable'; end if;
  if e.purpose is distinct from 'import_staging' or e.expires_at<=clock_timestamp() or e.expires_at>clock_timestamp()+interval '24 hours' then raise exception 'invalid_expiry'; end if;
  insert into public.private_payloads(id,user_id,purpose,payload_version,encrypted_bytes,nonce,key_id,content_hash,encoding,encryption_algorithm,expires_at)
    values(e.id,e.user_id,e.purpose,e.payload_version,e.encrypted_bytes,e.nonce,e.key_id,e.content_hash,e.encoding,e.encryption_algorithm,e.expires_at);
  return e.id;
end;
$$;

revoke all on function public.lock_run_v1(uuid,uuid,uuid,bigint,boolean),public.run_summary_v1(uuid,uuid),public.store_run_envelope_v1(uuid,jsonb,text),
 public.admit_run_v1(uuid,jsonb,uuid),public.prepare_step_v1(uuid,uuid,uuid,bigint,jsonb,jsonb,jsonb),public.authorize_send_v1(uuid,uuid,uuid,bigint,uuid,text),
 public.heartbeat_run_v1(uuid,uuid,uuid,bigint),public.checkpoint_step_v1(uuid,uuid,uuid,bigint,uuid,jsonb,jsonb),public.settle_step_v1(uuid,uuid,uuid,jsonb,text),
 public.cancel_run_v1(uuid,uuid),public.finish_run_v1(uuid,uuid,uuid,text) from public,anon,authenticated,service_role;
grant execute on function public.run_summary_v1(uuid,uuid),public.admit_run_v1(uuid,jsonb,uuid),public.prepare_step_v1(uuid,uuid,uuid,bigint,jsonb,jsonb,jsonb),
 public.authorize_send_v1(uuid,uuid,uuid,bigint,uuid,text),public.heartbeat_run_v1(uuid,uuid,uuid,bigint),public.checkpoint_step_v1(uuid,uuid,uuid,bigint,uuid,jsonb,jsonb),
 public.settle_step_v1(uuid,uuid,uuid,jsonb,text),public.cancel_run_v1(uuid,uuid),public.finish_run_v1(uuid,uuid,uuid,text) to service_role;
commit;

begin;

-- One atomic cutover: retain bucket/reservation identities, amounts, periods and
-- evidence. ACCESS EXCLUSIVE locks prevent accounting writes during the rename.
lock table public.usage_buckets, public.usage_reservations in access exclusive mode;
alter table public.usage_reservations drop constraint usage_reservations_household_bucket_id_household_scope_per_fkey;
alter table public.usage_buckets drop constraint usage_buckets_scope_check;
alter table public.usage_buckets drop constraint usage_buckets_check1;
drop index public.usage_buckets_user_period;
drop index public.usage_buckets_household_period;

alter table public.usage_reservations rename column user_bucket_id to account_bucket_id;
alter table public.usage_reservations rename column household_bucket_id to app_bucket_id;
alter table public.usage_reservations drop column household_scope;
alter table public.usage_reservations add column app_scope text generated always as ('app'::text) stored;
update public.usage_buckets set scope=case scope when 'user' then 'account' when 'household' then 'app' end;
alter table public.usage_buckets add constraint usage_buckets_scope_check check (scope in ('account','app'));
alter table public.usage_buckets add constraint usage_buckets_scope_owner_check
  check ((scope='account' and user_id is not null) or (scope='app' and user_id is null and lower_preference_usd is null));
create unique index usage_buckets_account_period on public.usage_buckets(user_id,period_start) where scope='account';
create unique index usage_buckets_app_period on public.usage_buckets(period_start) where scope='app';
alter table public.usage_reservations rename constraint usage_reservations_user_id_user_bucket_id_period_start_fkey to usage_reservations_account_bucket_fk;
alter table public.usage_reservations add constraint usage_reservations_app_bucket_fk
  foreign key (app_bucket_id,app_scope,period_start) references public.usage_buckets(id,scope,period_start) on delete restrict;

-- Replacements preserve signatures, grants, ownership checks and lock order.
create or replace function public.prepare_step_v1(p_owner uuid,p_run uuid,p_executor uuid,p_fence bigint,p_step jsonb,p_input jsonb,p_context jsonb default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare r public.ai_runs; s public.ai_steps; app public.usage_buckets; account public.usage_buckets; preference numeric;
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
    select * into app from public.usage_buckets where scope='app' and period_start=r.accounting_period for update;
    if not found then raise exception 'budget_unconfigured'; end if;
    select * into account from public.usage_buckets where user_id=p_owner and scope='account' and period_start=r.accounting_period for update;
    if not found then raise exception 'budget_unconfigured'; end if;
    select monthly_preference_usd into preference from public.profiles where user_id=p_owner;
    if app.spent_usd+app.reserved_usd+amount>app.allocated_ceiling_usd
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
    update public.usage_buckets set reserved_usd=reserved_usd+amount where id in (app.id,account.id);
    insert into public.usage_reservations(user_id,run_id,step_id,period_start,account_bucket_id,app_bucket_id,amount_usd)
      values(p_owner,p_run,s.id,r.accounting_period,account.id,app.id,amount);
  end if;
  update public.ai_runs set status='running',started_at=coalesce(started_at,clock_timestamp()),trace_state='available',
    input_tokens=case when paid then null else input_tokens end,output_tokens=case when paid then null else output_tokens end where user_id=p_owner and id=p_run;
  return s.id;
end;
$$;

create or replace function public.authorize_send_v1(p_owner uuid,p_run uuid,p_executor uuid,p_fence bigint,p_step uuid,p_body_hash text) returns boolean
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
  perform 1 from public.usage_buckets where id=(select app_bucket_id from public.usage_reservations where user_id=p_owner and step_id=p_step) for update;
  perform 1 from public.usage_buckets where id=(select account_bucket_id from public.usage_reservations where user_id=p_owner and step_id=p_step) for update;
  if exists(select 1 from public.usage_buckets b join public.usage_reservations v on b.id in(v.account_bucket_id,v.app_bucket_id)
    join public.profiles p on p.user_id=v.user_id where v.user_id=p_owner and v.step_id=p_step
      and b.spent_usd+b.reserved_usd>least(b.allocated_ceiling_usd,coalesce(b.lower_preference_usd,b.allocated_ceiling_usd),
        case when b.scope='account' then coalesce(p.monthly_preference_usd,b.allocated_ceiling_usd) else b.allocated_ceiling_usd end)) then raise exception 'budget_exhausted'; end if;
  if not exists(select 1 from public.private_payloads where user_id=p_owner and id=s.input_payload_id and purpose='ai_request' and expires_at>clock_timestamp()) then raise exception 'trace_unavailable'; end if;
  update public.ai_steps set dispatch_state='send_authorized',dispatch_authorized_at=clock_timestamp() where id=s.id;
  return true;
end;
$$;

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

create or replace function public.update_settings_v1(p_request jsonb)
returns public.profiles
language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  current_profile public.profiles;
  changes jsonb;
  consent jsonb;
  request_id uuid;
  request_hash text;
  receipt jsonb;
  changed_at timestamptz;
  provider_id text;
  normalized_display_name text;
begin
  if owner_id is null then raise exception 'unauthorized'; end if;
  if jsonb_typeof(p_request) is distinct from 'object'
    or not (p_request ?& array['client_request_id','expected_updated_at','changes'])
    or (p_request - array['client_request_id','expected_updated_at','changes']) <> '{}'::jsonb
    or jsonb_typeof(p_request->'client_request_id') is distinct from 'string'
    or jsonb_typeof(p_request->'expected_updated_at') is distinct from 'string'
    or jsonb_typeof(p_request->'changes') is distinct from 'object'
  then raise exception 'invalid_settings'; end if;
  request_id := (p_request->>'client_request_id')::uuid;
  changes := p_request->'changes';
  if changes = '{}'::jsonb or (changes - array['display_name','timezone','units','provider_consent','monthly_spending_preference_usd']) <> '{}'::jsonb then raise exception 'invalid_settings'; end if;
  if changes ? 'display_name' then
    if jsonb_typeof(changes->'display_name') not in ('string','null') then raise exception 'invalid_settings'; end if;
    -- Match String.trim() at the direct RPC boundary; char_length matches Zod's code-point limit.
    normalized_display_name := btrim(changes->>'display_name', U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
    if normalized_display_name is not null then
      if char_length(normalized_display_name) not between 1 and 200 then raise exception 'invalid_settings'; end if;
    end if;
  end if;
  if changes ? 'timezone' and (jsonb_typeof(changes->'timezone') is distinct from 'string' or char_length(changes->>'timezone') > 100 or changes->>'timezone' = 'Factory' or not exists(select 1 from pg_catalog.pg_timezone_names where name = changes->>'timezone')) then raise exception 'invalid_settings'; end if;
  if changes ? 'units' and (jsonb_typeof(changes->'units') is distinct from 'string' or changes->>'units' not in ('metric','imperial')) then raise exception 'invalid_settings'; end if;
  if changes ? 'provider_consent' then
    consent := changes->'provider_consent';
    if jsonb_typeof(consent) is distinct from 'object' or not (consent ?& array['provider','accepted','policy_version'])
      or (consent - array['provider','accepted','policy_version']) <> '{}'::jsonb
      or jsonb_typeof(consent->'provider') is distinct from 'string'
      or consent->>'provider' not in ('openrouter','vertex_ai')
      or jsonb_typeof(consent->'accepted') is distinct from 'boolean'
      or jsonb_typeof(consent->'policy_version') is distinct from 'string'
      or char_length(consent->>'policy_version') not between 1 and 100
    then raise exception 'invalid_settings'; end if;
    provider_id := consent->>'provider';
    if (consent->>'accepted')::boolean and
      (provider_id <> 'openrouter' or consent->>'policy_version' <> 'openrouter_zdr_v1')
    then raise exception 'consent_policy_denied'; end if;
  end if;
  select * into current_profile from public.profiles where user_id = owner_id for update;
  if not found or current_profile.account_state <> 'active' then raise exception 'account_unavailable'; end if;
  request_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_request::text,'UTF8')),'hex');
  receipt := current_profile.preferences->'_settings_last_write';
  if receipt->>'request_id' = request_id::text then
    if receipt->>'request_hash' = request_hash then return current_profile; end if;
    raise exception 'settings_conflict';
  end if;
  if (p_request->>'expected_updated_at')::timestamptz is distinct from current_profile.updated_at then raise exception 'settings_conflict'; end if;
  if changes ? 'monthly_spending_preference_usd' then
    if jsonb_typeof(changes->'monthly_spending_preference_usd') not in ('string','null')
      or (changes->>'monthly_spending_preference_usd' is not null and
        (char_length(changes->>'monthly_spending_preference_usd')>80 or changes->>'monthly_spending_preference_usd' !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$')) then raise exception 'invalid_settings'; end if;
    perform 1 from public.usage_buckets where scope='app' and period_start=date_trunc('month',clock_timestamp() at time zone 'UTC')::date for update;
    perform 1 from public.usage_buckets where user_id=owner_id and scope='account' and period_start=date_trunc('month',clock_timestamp() at time zone 'UTC')::date for update;
    if changes->>'monthly_spending_preference_usd' is not null and not exists(select 1 from public.usage_buckets where user_id=owner_id and scope='account'
      and period_start=date_trunc('month',clock_timestamp() at time zone 'UTC')::date and allocated_ceiling_usd>=(changes->>'monthly_spending_preference_usd')::numeric) then raise exception 'invalid_settings'; end if;
    update public.usage_buckets set lower_preference_usd=(changes->>'monthly_spending_preference_usd')::numeric
      where user_id=owner_id and scope='account' and period_start=date_trunc('month',clock_timestamp() at time zone 'UTC')::date;
  end if;
  changed_at := greatest(clock_timestamp(), current_profile.updated_at + interval '1 microsecond');
  update public.profiles set
    display_name = case when changes ? 'display_name' then normalized_display_name else display_name end,
    timezone = coalesce(changes->>'timezone', timezone), units = coalesce(changes->>'units', units),
    consent_versions = case when consent is not null then jsonb_set(consent_versions, array[provider_id], jsonb_build_object(
      'accepted_version', case when (consent->>'accepted')::boolean then consent->>'policy_version' else null end,
      'accepted_at', case when (consent->>'accepted')::boolean then changed_at else null end
    )) else consent_versions end,
    monthly_preference_usd = case when changes ? 'monthly_spending_preference_usd' then (changes->>'monthly_spending_preference_usd')::numeric else monthly_preference_usd end,
    preferences = jsonb_set(preferences, '{_settings_last_write}', jsonb_build_object('request_id',request_id,'request_hash',request_hash,'updated_at',changed_at)),
    updated_at = changed_at
  where user_id = owner_id returning * into current_profile;
  return current_profile;
end;
$$;

create or replace function public.read_budget_v1() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('periodStart',date_trunc('month',now() at time zone 'UTC')::date,
    'resetsAt',(date_trunc('month',now() at time zone 'UTC') at time zone 'UTC')+interval '1 month',
    'allocationUSD',b.allocated_ceiling_usd::text,'preferenceUSD',least(p.monthly_preference_usd,b.lower_preference_usd)::text,
    'spentUSD',coalesce(b.spent_usd,0)::text,'reservedUSD',coalesce(b.reserved_usd,0)::text,
    'availableUSD',case when b.id is null then null else greatest(0,least(b.allocated_ceiling_usd,coalesce(b.lower_preference_usd,b.allocated_ceiling_usd),coalesce(p.monthly_preference_usd,b.allocated_ceiling_usd))-b.spent_usd-b.reserved_usd)::text end,
    'state',case when b.id is null then 'unconfigured' else 'configured' end)
  from public.profiles p left join public.usage_buckets b on b.user_id=p.user_id and b.scope='account'
    and b.period_start=date_trunc('month',now() at time zone 'UTC')::date
  where p.user_id=auth.uid() and p.account_state='active';
$$;

commit;

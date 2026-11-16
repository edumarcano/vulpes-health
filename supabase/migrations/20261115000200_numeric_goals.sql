begin;

create function public.goal_metric_value_valid_v2(p_metric text,p_unit text,p_value numeric) returns boolean
language sql immutable set search_path='' as $$
 select coalesce((public.metric_definition_v2(p_metric)->>'analytics')::boolean
  and public.metric_definition_v2(p_metric)->>'unit'=p_unit
  and public.metric_representation_valid_v2(public.metric_definition_v2(p_metric)->>'representation',p_value),false);
$$;

-- Replace the legacy metric/unit and representation checks, retaining shape,
-- finite-number, source, ownership, revision and state constraints.
do $$ declare c record; begin
 for c in select conname from pg_catalog.pg_constraint where conrelid='public.goals'::regclass and contype='c'
  and pg_catalog.pg_get_constraintdef(oid) like '%metric_key%' loop
  execute format('alter table public.goals drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.goals add constraint goals_numeric_target_v2 check (
 case when direction='maintain_range' then public.goal_metric_value_valid_v2(metric_key,canonical_unit,target_lower)
  and public.goal_metric_value_valid_v2(metric_key,canonical_unit,target_upper)
 else public.goal_metric_value_valid_v2(metric_key,canonical_unit,target_value) end);

create function public.goal_definition_valid_v2(d jsonb) returns boolean
language plpgsql immutable set search_path='' as $$
declare v jsonb; a timestamptz; b timestamptz; days integer; age numeric;
begin
 if jsonb_typeof(d) is distinct from 'object' or not (d ?& array['schemaVersion','title','metric','unit','sourceId','target','baselineMethod','baselineFrom','baselineTo','reportedBaseline','timezone','targetDate','constraints','proposedStrategy','method','granularity','currentMethod'])
  or d-array['schemaVersion','title','metric','unit','sourceId','target','baselineMethod','baselineFrom','baselineTo','reportedBaseline','timezone','targetDate','constraints','proposedStrategy','method','granularity','currentMethod','maxEvidenceAgeDays']<>'{}'::jsonb
  or d->>'schemaVersion' is distinct from '1' or jsonb_typeof(d->'title') is distinct from 'string' or length(btrim(d->>'title')) not between 1 and 200
  or jsonb_typeof(d->'metric') is distinct from 'string' or jsonb_typeof(d->'unit') is distinct from 'string'
  or d->>'sourceId' is null or (d->>'sourceId')::uuid is null
  or d->>'method' is null or d->>'method' not in ('device_reported','device_estimate','user_reported','unknown')
  or d->>'granularity' is null or d->>'granularity' not in ('instant','daily_total','session_total')
  or d->>'baselineMethod' is null or d->>'baselineMethod' not in ('user_reported','latest_value','daily_median_mean_7d')
  or d->>'currentMethod' is null or d->>'currentMethod' not in ('latest_value','daily_median_mean_7d')
  or jsonb_typeof(d->'timezone') is distinct from 'string' then return false; end if;
 -- PostgreSQL validates the selected timezone during the timestamp conversions.
 perform timestamptz '2026-01-01 00:00Z' at time zone (d->>'timezone');
 if jsonb_typeof(d->'target') is distinct from 'object' then return false; end if;
 if d#>>'{target,direction}'='maintain_range' then
  if not ((d->'target') ?& array['direction','lower','upper']) or (d->'target')-array['direction','lower','upper']<>'{}'::jsonb
   or jsonb_typeof(d#>'{target,lower}') is distinct from 'number' or jsonb_typeof(d#>'{target,upper}') is distinct from 'number'
   or not public.goal_metric_value_valid_v2(d->>'metric',d->>'unit',(d#>>'{target,lower}')::numeric)
   or not public.goal_metric_value_valid_v2(d->>'metric',d->>'unit',(d#>>'{target,upper}')::numeric)
   or (d#>>'{target,lower}')::numeric>(d#>>'{target,upper}')::numeric then return false; end if;
 elsif d#>>'{target,direction}' in ('increase_to','decrease_to') then
  if not ((d->'target') ?& array['direction','value']) or (d->'target')-array['direction','value']<>'{}'::jsonb
   or jsonb_typeof(d#>'{target,value}') is distinct from 'number'
   or not public.goal_metric_value_valid_v2(d->>'metric',d->>'unit',(d#>>'{target,value}')::numeric) then return false; end if;
 else return false; end if;
 if d->>'metric'='steps_daily' and d->>'granularity'<>'daily_total' or d->>'metric'='sleep_duration' and d->>'granularity'='instant' then return false; end if;
 if d->>'baselineMethod'<>'user_reported' and d->>'baselineMethod'<>d->>'currentMethod' then return false; end if;
 if (d->>'baselineMethod'='daily_median_mean_7d' or d->>'currentMethod'='daily_median_mean_7d') and (d->>'granularity'<>'instant' or d->>'metric'='heart_rate') then return false; end if;
 if d->'reportedBaseline'<>'null'::jsonb then
  if jsonb_typeof(d->'reportedBaseline') is distinct from 'number' or not public.goal_metric_value_valid_v2(d->>'metric',d->>'unit',(d->>'reportedBaseline')::numeric) then return false; end if;
 elsif d->>'baselineMethod'='user_reported' then return false; end if;
 if d->>'baselineMethod'<>'user_reported' then
  if d->>'baselineFrom' is null or d->>'baselineTo' is null then return false; end if;
  a:=(d->>'baselineFrom')::timestamptz; b:=(d->>'baselineTo')::timestamptz;
  days:=(b at time zone (d->>'timezone'))::date-(a at time zone (d->>'timezone'))::date;
  if not isfinite(a) or not isfinite(b) or a>=b or days not between 1 and 366
   or (a at time zone (d->>'timezone'))::time<>time '00:00' or (b at time zone (d->>'timezone'))::time<>time '00:00'
   or d->>'baselineMethod'='daily_median_mean_7d' and days<>7 then return false; end if;
 end if;
 if d ? 'maxEvidenceAgeDays' and d->'maxEvidenceAgeDays'<>'null'::jsonb then
  if jsonb_typeof(d->'maxEvidenceAgeDays') is distinct from 'number' then return false; end if;
  age:=(d->>'maxEvidenceAgeDays')::numeric;
  if age<>trunc(age) or age not between 1 and 3660 then return false; end if;
 end if;
 if jsonb_typeof(d->'constraints') is distinct from 'array' or jsonb_array_length(d->'constraints')>20 then return false; end if;
 for v in select value from jsonb_array_elements(d->'constraints') loop
  if jsonb_typeof(v)<>'string' or length(v#>>'{}')>1000 then return false; end if;
 end loop;
 if d->'proposedStrategy'<>'null'::jsonb and (jsonb_typeof(d->'proposedStrategy')<>'string' or length(d->>'proposedStrategy')>4000) then return false; end if;
 if d->'targetDate'<>'null'::jsonb and (jsonb_typeof(d->'targetDate')<>'string' or not isfinite((d->>'targetDate')::date)) then return false; end if;
 return true;
exception when others then return false;
end;
$$;

create function public.goal_payload_valid_v2(p_owner uuid,p jsonb) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare d jsonb:=p->'definition'; b jsonb:=p->'baseline'; r jsonb; v numeric;
begin
 if jsonb_typeof(p) is distinct from 'object' or not (p ?& array['schemaVersion','definition','baseline','state','baselineResolution','reviewedDataRevision'])
  or p->>'schemaVersion' is distinct from '2' or not public.goal_definition_valid_v2(d)
  or p->>'state' is null or p->>'state' not in ('active','paused','completed','needs_data','archived')
  or p->>'baselineResolution' is null or p->>'baselineResolution' not in ('retain','replace')
  or jsonb_typeof(p->'reviewedDataRevision') is distinct from 'number' or (p->>'reviewedDataRevision')::bigint<0
  or not exists(select 1 from public.data_sources where user_id=p_owner and id=(d->>'sourceId')::uuid)
  or jsonb_typeof(b) is distinct from 'object' or octet_length(b::text)>65536
  or not (b ?& array['schemaVersion','selection','value','dataRevision','algorithmVersion','provenance','references'])
  or b->>'schemaVersion' is distinct from '2' or jsonb_typeof(b->'dataRevision') is distinct from 'number'
  or (b->>'dataRevision')::bigint<0 or (b->>'dataRevision')::bigint>(p->>'reviewedDataRevision')::bigint
  or b->>'algorithmVersion' is null or b->>'provenance' is null or b->>'provenance' not in ('calculated','user_reported')
  or b#>>'{selection,metric}' is distinct from d->>'metric' or b#>>'{selection,source_id}' is distinct from d->>'sourceId'
  or b#>>'{selection,method}' is distinct from d->>'method' or b#>>'{selection,granularity}' is distinct from d->>'granularity'
  or b#>>'{selection,timezone}' is distinct from d->>'timezone'
  or jsonb_typeof(b->'references') is distinct from 'array' then return false; end if;
 -- Retained approved evidence remains usable; preparation of new evidence is bounded.
 -- Mutation entry points additionally bind this exception to the locked target.
 if jsonb_array_length(b->'references')>200 and (p->>'baselineResolution'<>'retain' or not exists(
  select 1 from public.goals g join public.goal_revisions gr on gr.user_id=g.user_id and gr.goal_id=g.id and gr.id=g.current_revision_id
  join public.action_proposals ap on ap.user_id=gr.user_id and ap.id=gr.approved_proposal_id and ap.state='approved'
  where g.user_id=p_owner and gr.payload->'baseline'=b
 )) then return false; end if;
 if b->'value'<>'null'::jsonb then
  if jsonb_typeof(b->'value') is distinct from 'string' then return false; end if;
  v:=(b->>'value')::numeric;
  if not public.goal_metric_value_valid_v2(d->>'metric',d->>'unit',v) then return false; end if;
 elsif p->>'state'='active' then return false; end if;
 if b->>'provenance'='calculated' and b->'value'<>'null'::jsonb and jsonb_array_length(b->'references')=0 then return false; end if;
 if b->>'provenance'='user_reported' and jsonb_array_length(b->'references')<>0 then return false; end if;
 for r in select value from jsonb_array_elements(b->'references') loop
  if jsonb_typeof(r) is distinct from 'object' or not (r ?& array['id','version']) or (r->>'version')::integer<1
   or not exists(select 1 from public.measurements m where m.user_id=p_owner and m.id=(r->>'id')::uuid and m.deleted_at is null
    and m.source_id=(d->>'sourceId')::uuid and m.metric_key=d->>'metric' and m.measurement_method=d->>'method' and m.granularity=d->>'granularity'
    and m.version=(r->>'version')::integer and (not (r ? 'observedAt') or m.observed_at=(r->>'observedAt')::timestamptz)) then return false; end if;
 end loop;
 return true;
exception when others then return false;
end;
$$;

revoke all on function public.goal_metric_value_valid_v2(text,text,numeric),public.goal_definition_valid_v2(jsonb),public.goal_payload_valid_v2(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.goal_metric_value_valid_v2(text,text,numeric),public.goal_definition_valid_v2(jsonb) to authenticated,service_role;
grant execute on function public.goal_payload_valid_v2(uuid,jsonb) to service_role;

create index measurements_analysis_daily_latest_v2 on public.measurements
 (user_id,source_id,metric_key,measurement_method,local_date desc,observed_at desc,id desc)
 where deleted_at is null and granularity='daily_total';


create or replace function public.read_analysis_v1(p_queries jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare owner_id uuid:=auth.uid(); revision bigint; q jsonb; results jsonb:='[]';
 records jsonb; events jsonb; details jsonb; amount integer:=0; row_limit integer;
 v_source_id uuid; mode text; window_item jsonb; import_time timestamptz; latest_date date; latest_time timestamptz;
begin
 select data_revision into revision from public.profiles where user_id=owner_id and account_state='active';
 if not found then raise exception 'account_unavailable' using errcode='42501'; end if;
 if p_queries is null or jsonb_typeof(p_queries)<>'array' or jsonb_array_length(p_queries) not between 1 and 24 then
  raise exception 'invalid_analysis' using errcode='22023';
 end if;
 select max(committed_at) into import_time from public.import_batches where user_id=owner_id and status='committed';
 for q in select value from jsonb_array_elements(p_queries) loop
  v_source_id:=(q->>'source_id')::uuid; mode:=q->>'mode';
  if q->>'timezone' is null or not exists(select 1 from pg_catalog.pg_timezone_names where name=q->>'timezone') then
   raise exception 'invalid_analysis' using errcode='22023';
  end if;
  if not exists(select 1 from public.data_sources s where s.user_id=owner_id and s.id=v_source_id) then
   raise exception 'data_not_found' using errcode='PT404';
  end if;
  if mode is null or mode not in ('rows','latest','event','endpoints') or jsonb_typeof(q->'windows') is distinct from 'array' or jsonb_array_length(q->'windows')>2 then
   raise exception 'invalid_analysis' using errcode='22023';
  end if;
  for window_item in select value from jsonb_array_elements(q->'windows') loop
   if (window_item->>'from') is null or (window_item->>'to') is null
    or not isfinite((window_item->>'from')::timestamptz) or not isfinite((window_item->>'to')::timestamptz)
    or (window_item->>'from')::timestamptz >= (window_item->>'to')::timestamptz
    or ((window_item->>'to')::timestamptz at time zone (q->>'timezone'))::date-((window_item->>'from')::timestamptz at time zone (q->>'timezone'))::date not between 1 and 366
    or ((window_item->>'from')::timestamptz at time zone (q->>'timezone'))::time <> time '00:00'
    or ((window_item->>'to')::timestamptz at time zone (q->>'timezone'))::time <> time '00:00' then
     raise exception 'invalid_analysis' using errcode='22023';
   end if;
  end loop;
  if q ? 'before' and (q->>'before' is null or not isfinite((q->>'before')::timestamptz)
   or q->>'granularity'='daily_total' and ((q->>'before')::timestamptz at time zone (q->>'timezone'))::time<>time '00:00') then
   raise exception 'invalid_analysis' using errcode='22023';
  end if;
  if mode='rows' and jsonb_array_length(q->'windows')=0 then raise exception 'invalid_analysis' using errcode='22023'; end if;
  if mode='event' then
   select coalesce(jsonb_agg(to_jsonb(e) order by e.observed_at desc,e.id desc),'[]') into events from (
    select e.id,e.observed_at from public.weigh_in_events e where e.user_id=owner_id and e.source_id=v_source_id
     and (jsonb_array_length(q->'windows')=0 or exists(select 1 from jsonb_array_elements(q->'windows') w where e.observed_at >= (w->>'from')::timestamptz and e.observed_at < (w->>'to')::timestamptz))
    order by e.observed_at desc,e.id desc limit 2
   ) e;
   details:=null;
   if jsonb_array_length(events)>0 and (jsonb_array_length(events)=1 or events->0->>'observed_at' <> events->1->>'observed_at') then
    details:=public.read_event_v2((events->0->>'id')::uuid);
    amount:=amount+jsonb_array_length(details->'observations');
   end if;
   results:=results||jsonb_build_array(jsonb_build_object('rows','[]'::jsonb,'events',events,'event',details));
  else
   if public.metric_definition_v2(q->>'metric') is null or q->>'method' is null or q->>'method' not in ('device_reported','device_estimate','user_reported','unknown') or q->>'granularity' is null or q->>'granularity' not in ('instant','daily_total','session_total') then
    raise exception 'invalid_analysis' using errcode='22023';
   end if;
   if mode='endpoints' and (jsonb_typeof(q->'ids') is distinct from 'array' or jsonb_array_length(q->'ids')<>2 or (q->'ids'->>0)::uuid=(q->'ids'->>1)::uuid) then raise exception 'invalid_analysis' using errcode='22023'; end if;
   if mode='latest' then
    latest_date:=null; latest_time:=null;
    if q->>'granularity'='daily_total' then
     select m.local_date into latest_date from public.measurements m where m.user_id=owner_id and m.deleted_at is null and m.source_id=v_source_id
      and m.metric_key=q->>'metric' and m.measurement_method=q->>'method' and m.granularity='daily_total'
      and (not (q ? 'before') or m.local_date < ((q->>'before')::timestamptz at time zone (q->>'timezone'))::date)
      and (jsonb_array_length(q->'windows')=0 or exists(select 1 from jsonb_array_elements(q->'windows') w
       where m.local_date >= ((w->>'from')::timestamptz at time zone (q->>'timezone'))::date and m.local_date < ((w->>'to')::timestamptz at time zone (q->>'timezone'))::date))
      order by m.local_date desc,m.observed_at desc,m.id desc limit 1;
    else
     select m.observed_at into latest_time from public.measurements m where m.user_id=owner_id and m.deleted_at is null and m.source_id=v_source_id
      and m.metric_key=q->>'metric' and m.measurement_method=q->>'method' and m.granularity=q->>'granularity'
      and (not (q ? 'before') or m.observed_at < (q->>'before')::timestamptz)
      and (jsonb_array_length(q->'windows')=0 or exists(select 1 from jsonb_array_elements(q->'windows') w where m.observed_at >= (w->>'from')::timestamptz and m.observed_at < (w->>'to')::timestamptz))
      order by m.observed_at desc,m.id desc limit 1;
    end if;
    select coalesce(jsonb_agg(to_jsonb(r)-'user_id'-'provenance'||jsonb_build_object('canonical_value',r.canonical_value::text) order by r.observed_at,r.id),'[]') into records from (
     select m.* from public.measurements m where m.user_id=owner_id and m.deleted_at is null and m.source_id=v_source_id
      and m.metric_key=q->>'metric' and m.measurement_method=q->>'method' and m.granularity=q->>'granularity'
      and (case when m.granularity='daily_total' then m.local_date=latest_date else m.observed_at=latest_time end)
      order by m.observed_at,m.id limit 25001-amount
    ) r;
   else
   row_limit:=case when mode='endpoints' then 2 else 25001-amount end;
   select coalesce(jsonb_agg(to_jsonb(r)-'user_id'-'provenance' || jsonb_build_object('canonical_value',r.canonical_value::text) order by r.observed_at,r.id),'[]') into records from (
    select m.* from public.measurements m where m.user_id=owner_id and m.deleted_at is null and m.source_id=v_source_id
     and m.metric_key=q->>'metric' and m.measurement_method=q->>'method' and m.granularity=q->>'granularity'
     and (not (q ? 'before') or case when m.granularity='daily_total' then m.local_date < ((q->>'before')::timestamptz at time zone (q->>'timezone'))::date else m.observed_at < (q->>'before')::timestamptz end)
     and (mode<>'endpoints' or m.id in (select value::uuid from jsonb_array_elements_text(q->'ids')))
     and (jsonb_array_length(q->'windows')=0 or exists(select 1 from jsonb_array_elements(q->'windows') w where
       case when m.granularity='daily_total' then m.local_date >= ((w->>'from')::timestamptz at time zone (q->>'timezone'))::date and m.local_date < ((w->>'to')::timestamptz at time zone (q->>'timezone'))::date
       else m.observed_at >= (w->>'from')::timestamptz and m.observed_at < (w->>'to')::timestamptz end))
    order by m.observed_at desc,m.id desc limit row_limit
   ) r;
   end if;
   if mode='endpoints' and jsonb_array_length(records)<>2 then raise exception 'data_not_found' using errcode='PT404'; end if;
   amount:=amount+jsonb_array_length(records);
   results:=results||jsonb_build_array(jsonb_build_object('rows',records,'events','[]'::jsonb,'event',null));
  end if;
  if amount>25000 then raise exception 'analysis_limit' using errcode='54000'; end if;
 end loop;
 return jsonb_build_object('revision',revision,'lastSuccessfulImportAt',import_time,'snapshots',results);
end;
$$;

create or replace function public.register_goal_proposal_v1(p_owner uuid,p_request jsonb,p_payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare old public.audit_events; ident uuid; g public.goals; fingerprint text:=encode(sha256(convert_to(p_request::text,'UTF8')),'hex');
begin
 perform 1 from public.profiles where user_id=p_owner and account_state='active' for update;
 if not found then raise exception 'account_unavailable'; end if;
 select * into old from public.audit_events where user_id=p_owner and event_type='goal_propose_v1' and safe_metadata->>'request_id'=((p_request->>'client_request_id')::uuid)::text;
 if found then
  if old.safe_metadata->>'hash'<>fingerprint then raise exception 'goal_conflict'; end if;
  return old.object_id;
 end if;
 if jsonb_typeof(p_payload->'reviewedDataRevision')='number' and (p_payload->>'reviewedDataRevision')::bigint is distinct from (select data_revision from public.profiles where user_id=p_owner) then raise exception 'goal_conflict'; end if;
 if not public.goal_payload_valid_v2(p_owner,p_payload) then raise exception 'invalid_goal'; end if;
 if p_request->>'action' not in ('propose_create','propose_revision','propose_state') or p_payload->>'schemaVersion'<>'2' then raise exception 'invalid_goal'; end if;
 if (p_payload->>'reviewedDataRevision')::bigint<>(select data_revision from public.profiles where user_id=p_owner) then raise exception 'goal_conflict'; end if;
 if not exists(select 1 from public.data_sources where user_id=p_owner and id=(p_payload->'definition'->>'sourceId')::uuid) then raise exception 'goal_not_found'; end if;
 if p_request->>'action'<>'propose_create' then
  select * into g from public.goals where user_id=p_owner and id=(p_request->>'goal_id')::uuid for update;
  if not found then raise exception 'goal_not_found'; end if;
  if g.version<>(p_request->>'expected_version')::integer or g.state='archived' then raise exception 'goal_conflict'; end if;
 end if;
 if jsonb_array_length(p_payload#>'{baseline,references}')>200 and (g.id is null or p_payload->>'baselineResolution'<>'retain' or
  not exists(select 1 from public.goal_revisions gr where gr.user_id=p_owner and gr.goal_id=g.id and gr.id=g.current_revision_id and gr.payload->'baseline'=p_payload->'baseline')) then raise exception 'invalid_goal'; end if;
 insert into public.action_proposals(user_id,kind,target_id,target_version,payload_version,canonical_payload,payload_hash,summary,expires_at)
 values(p_owner,case p_request->>'action' when 'propose_create' then 'goal.create' when 'propose_revision' then 'goal.revise' else 'goal.state' end,g.id,g.version,2,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),p_payload->'definition'->>'title',clock_timestamp()+interval '24 hours') returning id into ident;
 insert into public.audit_events(user_id,event_type,object_id,safe_metadata) values(p_owner,'goal_propose_v1',ident,jsonb_build_object('request_id',((p_request->>'client_request_id')::uuid)::text,'hash',fingerprint));
 return ident;
end;
$$;
create or replace function public.decide_goal_proposal_v1(p_owner uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.action_proposals; g public.goals; d jsonb; b jsonb; rev uuid:=gen_random_uuid(); goal uuid; n integer; receipt public.audit_events; fingerprint text:=encode(sha256(convert_to(p_request::text,'UTF8')),'hex'); answer jsonb;
begin
 perform 1 from public.profiles where user_id=p_owner and account_state='active' for update;
 if not found then raise exception 'account_unavailable'; end if;
 select * into receipt from public.audit_events where user_id=p_owner and event_type='goal_decide_v1' and safe_metadata->>'request_id'=((p_request->>'client_request_id')::uuid)::text;
 if found then
  if receipt.safe_metadata->>'hash'<>fingerprint then raise exception 'goal_conflict'; end if;
  return receipt.safe_metadata->'result';
 end if;
 select * into p from public.action_proposals where user_id=p_owner and id=(p_request->>'proposal_id')::uuid for update;
 if not found then raise exception 'goal_not_found'; end if;
 if p.payload_hash<>p_request->>'payload_hash' or p.target_version is distinct from (p_request->>'expected_version')::integer then raise exception 'goal_conflict'; end if;
 if p.state='approved' and p_request->>'action'='approve' or p.state='rejected' and p_request->>'action'='reject' then
  insert into public.audit_events(user_id,event_type,object_id,safe_metadata) values(p_owner,'goal_decide_v1',p.id,jsonb_build_object('request_id',((p_request->>'client_request_id')::uuid)::text,'hash',fingerprint,'result',p.result));
  return p.result; end if;
 if p.state<>'pending' or p.expires_at<=clock_timestamp() then raise exception 'goal_conflict'; end if;
 if p.payload_hash<>encode(sha256(convert_to(p.canonical_payload::text,'UTF8')),'hex') or p.payload_version<>2 then raise exception 'goal_conflict'; end if;
 if p_request->>'action'='approve' and not public.goal_payload_valid_v2(p_owner,p.canonical_payload) then raise exception 'invalid_goal'; end if;
 if (p.canonical_payload->>'reviewedDataRevision')::bigint<>(select data_revision from public.profiles where user_id=p_owner) then raise exception 'goal_conflict'; end if;
 if p.target_id is not null then
  select * into g from public.goals where user_id=p_owner and id=p.target_id for update;
  if not found then raise exception 'goal_not_found'; end if;
  if g.version<>p.target_version or g.state='archived' then raise exception 'goal_conflict'; end if;
 end if;
 if p_request->>'action'='approve' and jsonb_array_length(p.canonical_payload#>'{baseline,references}')>200 and (g.id is null or p.canonical_payload->>'baselineResolution'<>'retain' or
  not exists(select 1 from public.goal_revisions gr where gr.user_id=p_owner and gr.goal_id=g.id and gr.id=g.current_revision_id and gr.payload->'baseline'=p.canonical_payload->'baseline')) then raise exception 'invalid_goal'; end if;
 if p_request->>'action'='reject' then
  answer:=jsonb_build_object('proposalId',p.id,'outcome','rejected');
  update public.action_proposals set state='rejected',canonical_payload=null,result=answer where id=p.id;
 elsif p_request->>'action'='approve' then
  d:=p.canonical_payload->'definition'; b:=p.canonical_payload->'baseline'; goal:=coalesce(g.id,gen_random_uuid());
  n:=coalesce((select max(revision_number) from public.goal_revisions where user_id=p_owner and goal_id=goal),0)+1;
  if g.id is null then
   insert into public.goals(id,user_id,title,metric_key,canonical_unit,direction,target_value,target_lower,target_upper,source_id)
   values(goal,p_owner,d->>'title',d->>'metric',d->>'unit',d->'target'->>'direction',(d->'target'->>'value')::numeric,(d->'target'->>'lower')::numeric,(d->'target'->>'upper')::numeric,(d->>'sourceId')::uuid);
  end if;
  insert into public.goal_revisions(id,user_id,goal_id,revision_number,previous_revision_id,approved_proposal_id,payload_version,payload)
   values(rev,p_owner,goal,n,g.current_revision_id,p.id,2,p.canonical_payload);
  update public.goals set title=d->>'title',metric_key=d->>'metric',canonical_unit=d->>'unit',direction=d->'target'->>'direction',target_value=(d->'target'->>'value')::numeric,target_lower=(d->'target'->>'lower')::numeric,target_upper=(d->'target'->>'upper')::numeric,source_id=(d->>'sourceId')::uuid,
   source_policy=jsonb_build_object('schema_version',1,'method',d->>'method','granularity',d->>'granularity','currentMethod',d->>'currentMethod'),baseline_snapshot=b,current_revision_id=rev,version=case when g.id is null then 1 else g.version+1 end,state=p.canonical_payload->>'state',review_status=case when p.kind='goal.state' then coalesce(g.review_status,'clear') else 'clear' end,target_date=(d->>'targetDate')::date,constraints=d->'constraints',updated_at=clock_timestamp() where user_id=p_owner and id=goal;
  answer:=jsonb_build_object('proposalId',p.id,'outcome','approved','goalId',goal,'revisionId',rev,'revisionNumber',n,'version',coalesce(g.version,0)+1);
  update public.action_proposals set state='approved',result=answer where id=p.id;
 else raise exception 'invalid_goal'; end if;
 insert into public.audit_events(user_id,event_type,object_id,safe_metadata) values(p_owner,'goal_decide_v1',p.id,jsonb_build_object('request_id',((p_request->>'client_request_id')::uuid)::text,'hash',fingerprint,'result',answer));
 return answer;
end;
$$;

commit;

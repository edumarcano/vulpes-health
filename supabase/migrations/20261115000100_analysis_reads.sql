begin;

create index measurements_analysis_latest_v1 on public.measurements
 (user_id,source_id,metric_key,measurement_method,granularity,observed_at desc,id desc)
 where deleted_at is null;

-- One statement snapshot bounds the whole batch. Arithmetic remains in TypeScript.
create function public.read_analysis_v1(p_queries jsonb) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare owner_id uuid:=auth.uid(); revision bigint; q jsonb; results jsonb:='[]';
 records jsonb; events jsonb; details jsonb; amount integer:=0; row_limit integer;
 v_source_id uuid; mode text; window_item jsonb; import_time timestamptz;
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
   row_limit:=case when mode='latest' then 1 when mode='endpoints' then 2 else 25001-amount end;
   select coalesce(jsonb_agg(to_jsonb(r)-'user_id'-'provenance' || jsonb_build_object('canonical_value',r.canonical_value::text) order by r.observed_at,r.id),'[]') into records from (
    select m.* from public.measurements m where m.user_id=owner_id and m.deleted_at is null and m.source_id=v_source_id
     and m.metric_key=q->>'metric' and m.measurement_method=q->>'method' and m.granularity=q->>'granularity'
     and (mode<>'endpoints' or m.id in (select value::uuid from jsonb_array_elements_text(q->'ids')))
     and (jsonb_array_length(q->'windows')=0 or exists(select 1 from jsonb_array_elements(q->'windows') w where
       case when m.granularity='daily_total' then m.local_date >= ((w->>'from')::timestamptz at time zone (q->>'timezone'))::date and m.local_date < ((w->>'to')::timestamptz at time zone (q->>'timezone'))::date
       else m.observed_at >= (w->>'from')::timestamptz and m.observed_at < (w->>'to')::timestamptz end))
    order by m.observed_at desc,m.id desc limit row_limit
   ) r;
   if mode='endpoints' and jsonb_array_length(records)<>2 then raise exception 'data_not_found' using errcode='PT404'; end if;
   amount:=amount+jsonb_array_length(records);
   results:=results||jsonb_build_array(jsonb_build_object('rows',records,'events','[]'::jsonb,'event',null));
  end if;
  if amount>25000 then raise exception 'analysis_limit' using errcode='54000'; end if;
 end loop;
 return jsonb_build_object('revision',revision,'lastSuccessfulImportAt',import_time,'snapshots',results);
end;
$$;

create function public.read_metric_inventory_v2(p_limit integer default 200,p_after jsonb default null,p_revision bigint default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare owner_id uuid:=auth.uid(); revision bigint; items jsonb;
begin
 select data_revision into revision from public.profiles where user_id=owner_id and account_state='active';
 if not found then raise exception 'account_unavailable' using errcode='42501'; end if;
 if p_limit is null or p_limit not between 1 and 200 then raise exception 'invalid_analysis' using errcode='22023'; end if;
 if (p_after is not null and p_revision is null) or (p_revision is not null and p_revision<>revision) then raise exception 'data_conflict' using errcode='PT409'; end if;
 select coalesce(jsonb_agg(to_jsonb(series) order by metric,source_id,method,granularity),'[]') into items from (
  select m.metric_key metric,m.source_id,s.label source_label,m.measurement_method method,m.granularity,
    count(*) observations,min(m.observed_at) first_at,max(m.observed_at) last_at
  from public.measurements m join public.data_sources s on s.user_id=m.user_id and s.id=m.source_id
  where m.user_id=owner_id and m.deleted_at is null
   and (p_after is null or (m.metric_key,m.source_id,m.measurement_method,m.granularity)>(p_after->>'metric',(p_after->>'source_id')::uuid,p_after->>'method',p_after->>'granularity'))
  group by m.metric_key,m.source_id,s.label,m.measurement_method,m.granularity
  order by m.metric_key,m.source_id,m.measurement_method,m.granularity limit p_limit+1
 ) series;
 return jsonb_build_object('dataRevision',revision,'items',items);
end;
$$;

revoke all on function public.read_analysis_v1(jsonb),public.read_metric_inventory_v2(integer,jsonb,bigint) from public,anon,authenticated,service_role;
grant execute on function public.read_analysis_v1(jsonb),public.read_metric_inventory_v2(integer,jsonb,bigint) to authenticated;
commit;

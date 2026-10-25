begin;

create unique index data_mutation_request on public.audit_events(user_id, (safe_metadata->>'client_request_id')) where event_type = 'data_mutation_v1';

create function public.add_measurement_v1(p_request jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  owner_id uuid := auth.uid();
  observation jsonb := p_request->'observation';
  source_input jsonb := p_request->'source';
  source_row public.data_sources;
  reading public.measurements;
  receipt public.audit_events;
  revision bigint;
  request_hash text;
  request_id uuid;
  canonical numeric;
  unit_name text;
  instant timestamptz;
  offset_minutes integer;
  local_day date;
  fingerprint_hash text;
  result jsonb;
  factor numeric;
  trimmed_label text;
begin
  if owner_id is null then raise exception 'unauthorized' using errcode='28000'; end if;
  select data_revision into revision from public.profiles where user_id=owner_id and account_state='active' for update;
  if not found then raise exception 'account_unavailable' using errcode='42501'; end if;
  if jsonb_typeof(p_request) <> 'object' or p_request - array['action','client_request_id','source','observation'] <> '{}'::jsonb
    or not p_request ?& array['action','client_request_id','source','observation']
    or p_request->>'action' is distinct from 'add_measurement' or jsonb_typeof(p_request->'client_request_id') <> 'string'
    or octet_length(p_request::text)>16384 then raise exception 'invalid_measurement' using errcode='22023'; end if;
  request_id := (p_request->>'client_request_id')::uuid;
  request_hash := encode(sha256(convert_to((p_request-'client_request_id')::text,'UTF8')),'hex');
  select * into receipt from public.audit_events where user_id=owner_id and event_type='data_mutation_v1' and safe_metadata->>'client_request_id'=request_id::text;
  if found then
    if receipt.safe_metadata->>'request_hash' <> request_hash then raise exception 'data_conflict' using errcode='40001'; end if;
    return receipt.safe_metadata->'result';
  end if;
  if jsonb_typeof(observation) <> 'object' or observation - array['metric','value','unit','observed_at','timezone','local_date','granularity','method','quality_flags'] <> '{}'::jsonb
    or not observation ?& array['metric','value','unit','observed_at','timezone','local_date','granularity','method','quality_flags']
    or jsonb_typeof(observation->'value') <> 'string' or char_length(observation->>'value')>1024
    or observation->>'value' !~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)$'
    or jsonb_typeof(observation->'quality_flags') <> 'array' or not observation->'quality_flags' <@ '["review_requested"]'::jsonb or jsonb_array_length(observation->'quality_flags')>1
    or observation->>'method' not in ('device_reported','device_estimate','user_reported','unknown')
    or observation->>'granularity' not in ('instant','daily_total','session_total')
    or observation->>'observed_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$'
    or char_length(observation->>'observed_at')>100
    or not exists(select 1 from pg_catalog.pg_timezone_names where name=observation->>'timezone' and name<>'Factory')
    or jsonb_typeof(observation->'local_date') not in ('null','string') then raise exception 'invalid_measurement' using errcode='22023'; end if;
  -- Check JSON types too: ->> alone would silently accept JSON numbers as text.
  if exists(select 1 from jsonb_each(observation) e where e.key not in ('local_date','quality_flags') and jsonb_typeof(e.value)<>'string') then raise exception 'invalid_measurement' using errcode='22023'; end if;
  select canonical_unit, multiplier into unit_name,factor from (values
    ('weight','kg','kg',1::numeric),('weight','lb','kg',0.45359237::numeric),('body_fat_percent','%','%',1::numeric),
    ('renpho.visceral_fat_index','index','index',1::numeric),('heart_rate','bpm','bpm',1::numeric),('resting_heart_rate','bpm','bpm',1::numeric),
    ('height','cm','cm',1::numeric),('height','m','cm',100::numeric),('height','in','cm',2.54::numeric),('steps_daily','count','count',1::numeric),
    ('sleep_duration','min','min',1::numeric),('sleep_duration','h','min',60::numeric)
  ) units(metric,input_unit,canonical_unit,multiplier) where metric=observation->>'metric' and input_unit=observation->>'unit';
  if not found then raise exception 'invalid_measurement' using errcode='22023'; end if;
  canonical := (observation->>'value')::numeric * factor;
  if canonical <> 0 and canonical::double precision = 0 then raise exception 'invalid_measurement' using errcode='22023'; end if;
  instant := (observation->>'observed_at')::timestamptz;
  offset_minutes := case when right(observation->>'observed_at',1)='Z' then 0 else
    (case when substring(right(observation->>'observed_at',6),1,1)='-' then -1 else 1 end) *
    (substring(right(observation->>'observed_at',6),2,2)::integer*60+right(observation->>'observed_at',2)::integer) end;
  if abs(offset_minutes)>840 then raise exception 'invalid_measurement' using errcode='22023'; end if;
  if observation->>'local_date' is not null then
    if observation->>'local_date' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid_measurement' using errcode='22023'; end if;
    local_day := (observation->>'local_date')::date;
    if not isfinite(local_day) then raise exception 'invalid_measurement' using errcode='22023'; end if;
  end if;
  if observation->>'granularity'='daily_total' and (local_day is null or local_day<>(instant at time zone (observation->>'timezone'))::date) then raise exception 'invalid_measurement' using errcode='22023'; end if;
  if jsonb_typeof(source_input)<>'object' then raise exception 'invalid_measurement' using errcode='22023'; end if;
  if source_input->>'kind'='existing' then
    if source_input-array['kind','id']<>'{}'::jsonb then raise exception 'invalid_measurement' using errcode='22023'; end if;
    select * into source_row from public.data_sources where user_id=owner_id and id=(source_input->>'id')::uuid;
    if not found then raise exception 'data_not_found' using errcode='P0002'; end if;
  elsif source_input->>'kind'='new' then
    trimmed_label := btrim(source_input->>'label', U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
    if source_input-array['kind','label','origin_app','device_label']<>'{}'::jsonb or not source_input ?& array['kind','label','origin_app','device_label']
      or jsonb_typeof(source_input->'label')<>'string' or char_length(trimmed_label) not between 1 and 200
      or exists(select 1 from jsonb_each(source_input) e where e.key in ('origin_app','device_label') and (jsonb_typeof(e.value) not in ('null','string') or char_length(e.value#>>'{}')>200)) then raise exception 'invalid_measurement' using errcode='22023'; end if;
    insert into public.data_sources(user_id,kind,label,origin_app,device_label,source_namespace,measurement_method)
      values(owner_id,'manual',trimmed_label,source_input->>'origin_app',source_input->>'device_label',gen_random_uuid()::text,observation->>'method') returning * into source_row;
  else raise exception 'invalid_measurement' using errcode='22023'; end if;
  fingerprint_hash := encode(sha256(convert_to(jsonb_build_array(source_row.source_namespace,observation->>'metric',trim_scale(extract(epoch from instant))::text,offset_minutes,observation->>'granularity',trim_scale(canonical)::text,local_day)::text,'UTF8')),'hex');
  select * into reading from public.measurements where user_id=owner_id and source_id=source_row.id and metric_key=observation->>'metric' and deleted_at is null
    and ((observed_at=instant and granularity=observation->>'granularity') or (granularity='daily_total' and observation->>'granularity'='daily_total' and local_date=local_day)) order by id limit 1;
  if found then
    if reading.canonical_value<>canonical or reading.measurement_method<>observation->>'method' or reading.local_date is distinct from local_day or reading.timezone is distinct from observation->>'timezone' or reading.quality_flags is distinct from array(select jsonb_array_elements_text(observation->'quality_flags')) then raise exception 'data_conflict' using errcode='40001'; end if;
    result := jsonb_build_object('id',reading.id,'sourceId',source_row.id,'outcome','duplicate','version',reading.version,'dataRevision',revision);
  else
    insert into public.measurements(user_id,source_id,metric_key,canonical_value,canonical_unit,original_value,original_unit,observed_at,original_offset_minutes,timezone,local_date,granularity,measurement_method,quality_flags,fingerprint,provenance)
    values(owner_id,source_row.id,observation->>'metric',canonical,unit_name,observation->>'value',observation->>'unit',instant,offset_minutes,observation->>'timezone',local_day,observation->>'granularity',observation->>'method',array(select jsonb_array_elements_text(observation->'quality_flags')),fingerprint_hash,'{"schema_version":1,"adapter":"manual","reviewed":true}') returning * into reading;
    update public.profiles set data_revision=data_revision+1 where user_id=owner_id returning data_revision into revision;
    result := jsonb_build_object('id',reading.id,'sourceId',source_row.id,'outcome','created','version',reading.version,'dataRevision',revision);
  end if;
  insert into public.audit_events(user_id,event_type,object_id,safe_metadata) values(owner_id,'data_mutation_v1',reading.id,jsonb_build_object('client_request_id',request_id::text,'operation','add_measurement','request_hash',request_hash,'result',result));
  return result;
exception when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation or datetime_field_overflow or invalid_datetime_format then
  raise exception 'invalid_measurement' using errcode='22023';
end;
$$;

-- Invoker reads retain RLS. A single SQL statement binds rows and revision to
-- the same snapshot; all decimal values cross PostgREST as text.
create function public.read_data_v1(p_query jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('revision',p.data_revision,'timezone',p.timezone,
    'sources',case when p_query->>'view'='sources' then coalesce((select jsonb_agg(s.obj order by s.id) from (
      select ds.id,jsonb_build_object('id',ds.id,'kind',ds.kind,'label',ds.label,'namespace',ds.source_namespace,'originApp',ds.origin_app,'deviceLabel',ds.device_label,'method',ds.measurement_method) obj
      from public.data_sources ds where ds.user_id=p.user_id and (p_query->>'after_id' is null or ds.id>(p_query->>'after_id')::uuid) order by ds.id limit least(greatest(coalesce((p_query->>'limit')::integer,100),1),200)
    ) s),'[]'::jsonb) else '[]'::jsonb end,
    'rows',case when p_query->>'view'='measurements' then coalesce((select jsonb_agg(r.obj order by r.observed_at,r.id) from (
      select m.observed_at,m.id,to_jsonb(m)-'user_id'-'provenance' || jsonb_build_object('canonical_value',m.canonical_value::text) obj
      from public.measurements m where m.user_id=p.user_id and m.deleted_at is null and m.source_id=(p_query->>'source_id')::uuid
        and m.metric_key=p_query->>'metric' and m.measurement_method=p_query->>'method' and m.granularity=p_query->>'granularity'
        and (case when m.granularity='daily_total' then
          m.local_date >= ((p_query->>'from')::timestamptz at time zone (p_query->>'timezone'))::date and m.local_date < ((p_query->>'to')::timestamptz at time zone (p_query->>'timezone'))::date
        else m.observed_at >= (p_query->>'from')::timestamptz and m.observed_at < (p_query->>'to')::timestamptz end)
        and (p_query->>'after_id' is null or (m.observed_at,m.id)>(select a.observed_at,a.id from public.measurements a where a.user_id=p.user_id and a.id=(p_query->>'after_id')::uuid))
      order by m.observed_at,m.id limit least(greatest(coalesce((p_query->>'limit')::integer,100),1),200)
    ) r),'[]'::jsonb) else '[]'::jsonb end)
  from public.profiles p where p.user_id=auth.uid() and p.account_state='active';
$$;
revoke all on function public.add_measurement_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.read_data_v1(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.add_measurement_v1(jsonb),public.read_data_v1(jsonb) to authenticated;
commit;

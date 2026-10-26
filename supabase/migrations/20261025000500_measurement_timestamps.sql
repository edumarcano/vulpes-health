begin;

-- Reject unsupported second-60 input before timestamptz can change its day.
-- Replace only validation; existing rows, receipts, locks and grants are preserved.
create or replace function public.add_measurement_v1(p_request jsonb)
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
    or observation->>'observed_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:[0-5]\d(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$'
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

create or replace function public.mutate_measurement_v1(p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  owner_id uuid:=auth.uid(); revision bigint; reading public.measurements; receipt public.audit_events;
  request_id uuid; request_hash text; changes jsonb:=p_request->'changes'; instant timestamptz;
  local_day date; canonical numeric; factor numeric; unit_name text; offset_minutes integer;
  fingerprint_hash text; answer jsonb; marked integer; invalidated integer; removed integer:=0;
begin
  if owner_id is null then raise exception 'unauthorized' using errcode='28000'; end if;
  select data_revision into revision from public.profiles where user_id=owner_id and account_state='active' for update;
  if not found then raise exception 'account_unavailable' using errcode='42501'; end if;
  if jsonb_typeof(p_request) is distinct from 'object' or octet_length(p_request::text)>16384
    or p_request->>'action' not in ('correct_measurement','delete_measurement')
    or not p_request ?& array['action','measurement_id','expected_version','client_request_id']
    or p_request-array['action','measurement_id','expected_version','client_request_id','changes']<>'{}'::jsonb
    or jsonb_typeof(p_request->'expected_version') is distinct from 'number'
    or (p_request->>'expected_version')::numeric<>trunc((p_request->>'expected_version')::numeric)
    or (p_request->>'expected_version')::integer<1
    or exists(select 1 from jsonb_each(p_request) e where e.key in ('action','measurement_id','client_request_id') and jsonb_typeof(e.value)<>'string')
    or (p_request->>'action'='delete_measurement' and p_request ? 'changes')
    then raise exception 'invalid_measurement' using errcode='22023'; end if;
  request_id:=(p_request->>'client_request_id')::uuid;
  request_hash:=encode(sha256(convert_to((p_request-'client_request_id')::text,'UTF8')),'hex');
  select * into receipt from public.audit_events where user_id=owner_id and event_type='data_mutation_v1' and safe_metadata->>'client_request_id'=request_id::text;
  if found then
    if receipt.safe_metadata->>'request_hash' is distinct from request_hash then raise exception 'data_conflict' using errcode='PT409'; end if;
    return receipt.safe_metadata->'result';
  end if;
  select * into reading from public.measurements where user_id=owner_id and id=(p_request->>'measurement_id')::uuid and deleted_at is null for update;
  if not found then raise exception 'data_not_found' using errcode='PT404'; end if;
  if reading.version<>(p_request->>'expected_version')::integer then raise exception 'data_conflict' using errcode='PT409'; end if;
  if p_request->>'action'='correct_measurement' then
    if jsonb_typeof(changes) is distinct from 'object' or not changes ?& array['value','unit','observed_at','timezone','local_date']
      or changes-array['value','unit','observed_at','timezone','local_date']<>'{}'::jsonb
      or exists(select 1 from jsonb_each(changes) e where e.key<>'local_date' and jsonb_typeof(e.value)<>'string')
      or jsonb_typeof(changes->'local_date') not in ('null','string')
      or char_length(changes->>'value')>1024 or changes->>'value' !~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)$'
      or changes->>'observed_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:[0-5]\d(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$'
      or not exists(select 1 from pg_catalog.pg_timezone_names where name=changes->>'timezone' and name<>'Factory')
      then raise exception 'invalid_measurement' using errcode='22023'; end if;
    select canonical_unit,multiplier into unit_name,factor from (values
      ('weight','kg','kg',1::numeric),('weight','lb','kg',0.45359237::numeric),('body_fat_percent','%','%',1::numeric),
      ('renpho.visceral_fat_index','index','index',1::numeric),('heart_rate','bpm','bpm',1::numeric),('resting_heart_rate','bpm','bpm',1::numeric),
      ('height','cm','cm',1::numeric),('height','m','cm',100::numeric),('height','in','cm',2.54::numeric),('steps_daily','count','count',1::numeric),
      ('sleep_duration','min','min',1::numeric),('sleep_duration','h','min',60::numeric)
    ) units(metric,input_unit,canonical_unit,multiplier) where metric=reading.metric_key and input_unit=changes->>'unit';
    if not found then raise exception 'invalid_measurement' using errcode='22023'; end if;
    canonical:=(changes->>'value')::numeric*factor;
    if canonical<>0 and canonical::double precision=0 then raise exception 'invalid_measurement' using errcode='22023'; end if;
    instant:=(changes->>'observed_at')::timestamptz;
    offset_minutes:=case when right(changes->>'observed_at',1)='Z' then 0 else
      (case when substring(right(changes->>'observed_at',6),1,1)='-' then -1 else 1 end)*
      (substring(right(changes->>'observed_at',6),2,2)::integer*60+right(changes->>'observed_at',2)::integer) end;
    if abs(offset_minutes)>840 then raise exception 'invalid_measurement' using errcode='22023'; end if;
    if changes->>'local_date' is not null then
      if changes->>'local_date' !~ '^\d{4}-\d{2}-\d{2}$' then raise exception 'invalid_measurement' using errcode='22023'; end if;
      local_day:=(changes->>'local_date')::date;
    end if;
    if reading.granularity='daily_total' and (local_day is null or local_day<>(instant at time zone (changes->>'timezone'))::date) then raise exception 'invalid_measurement' using errcode='22023'; end if;
    if exists(select 1 from public.measurements m where m.user_id=owner_id and m.source_id=reading.source_id and m.metric_key=reading.metric_key and m.id<>reading.id and m.deleted_at is null
      and ((m.observed_at=instant and m.granularity=reading.granularity) or (m.granularity='daily_total' and reading.granularity='daily_total' and m.local_date=local_day)))
      then raise exception 'data_conflict' using errcode='PT409'; end if;
    fingerprint_hash:=(select encode(sha256(convert_to(jsonb_build_array(s.source_namespace,reading.metric_key,trim_scale(extract(epoch from instant))::text,offset_minutes,
      reading.granularity,trim_scale(canonical)::text,local_day)::text,'UTF8')),'hex') from public.data_sources s where s.user_id=owner_id and s.id=reading.source_id);
    update public.measurements set canonical_value=canonical,canonical_unit=unit_name,original_value=changes->>'value',original_unit=changes->>'unit',
      observed_at=instant,original_offset_minutes=offset_minutes,timezone=changes->>'timezone',local_date=local_day,fingerprint=fingerprint_hash,version=version+1,
      quality_flags=case when 'user_corrected'=any(quality_flags) then quality_flags else array_append(quality_flags,'user_corrected') end,
      provenance=provenance||'{"user_corrected":true}'::jsonb
      where user_id=owner_id and id=reading.id;
  else
    delete from public.measurements where user_id=owner_id and id=reading.id;
    delete from public.private_payloads where user_id=owner_id and purpose in ('ai_request','ai_response','tool_input','tool_output','provider_state');
    get diagnostics removed=row_count;
    update public.ai_runs set trace_content_removed_at=clock_timestamp() where user_id=owner_id;
  end if;
  -- M2 has no authoritative baseline dependency schema yet. Conservatively mark
  -- matching series; never edit approved snapshots, states, targets or revisions.
  update public.goals set review_status='needs_review',version=version+1 where user_id=owner_id and review_status<>'needs_review'
    and source_id=reading.source_id and metric_key=reading.metric_key;
  get diagnostics marked=row_count;
  update public.import_batches set status=case when expires_at<=clock_timestamp() then 'expired' else 'failed' end,staging_payload_id=null where user_id=owner_id and status='previewed';
  get diagnostics invalidated=row_count;
  -- Includes unregistered staging written just before a competing registration.
  delete from public.private_payloads where user_id=owner_id and purpose='import_staging';
  update public.profiles set data_revision=data_revision+1 where user_id=owner_id returning data_revision into revision;
  answer:=jsonb_build_object('id',reading.id,'sourceId',reading.source_id,'outcome',case when p_request->>'action'='correct_measurement' then 'corrected' else 'deleted' end,
    'version',reading.version+1,'dataRevision',revision,'baselinesMarked',marked,'previewsInvalidated',invalidated,'tracePayloadsRemoved',removed);
  insert into public.audit_events(user_id,event_type,object_id,safe_metadata) values(owner_id,'data_mutation_v1',reading.id,
    jsonb_build_object('client_request_id',request_id::text,'operation',p_request->>'action','request_hash',request_hash,'result',answer));
  return answer;
exception
  when unique_violation then raise exception 'data_conflict' using errcode='PT409';
  when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation or datetime_field_overflow or invalid_datetime_format then raise exception 'invalid_measurement' using errcode='22023';
end;
$$;

commit;

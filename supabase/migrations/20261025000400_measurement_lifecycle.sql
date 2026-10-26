begin;

-- Exact trace content can be removed independently of permitted accounting.
alter table public.ai_runs add column trace_content_removed_at timestamptz;

create function public.mutate_measurement_v1(p_request jsonb) returns jsonb
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
      or changes->>'observed_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$'
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

create function public.read_export_v1(p_query jsonb) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('revision',p.data_revision,'rows',coalesce((select jsonb_agg(r.obj order by r.observed_at,r.id) from (
    select m.observed_at,m.id,to_jsonb(m)-'user_id'||jsonb_build_object('canonical_value',m.canonical_value::text,
      'source',jsonb_build_object('label',s.label,'kind',s.kind,'namespace',s.source_namespace,'origin_app',s.origin_app,'device_label',s.device_label)) obj
    from public.measurements m join public.data_sources s on s.user_id=m.user_id and s.id=m.source_id
    where m.user_id=p.user_id and m.deleted_at is null and m.source_id=(p_query->>'source_id')::uuid and m.metric_key=p_query->>'metric'
      and m.measurement_method=p_query->>'method' and m.granularity=p_query->>'granularity'
      and (case when m.granularity='daily_total' then
        m.local_date>=((p_query->>'from')::timestamptz at time zone (p_query->>'timezone'))::date and m.local_date<((p_query->>'to')::timestamptz at time zone (p_query->>'timezone'))::date
        else m.observed_at>=(p_query->>'from')::timestamptz and m.observed_at<(p_query->>'to')::timestamptz end)
      and (p_query->>'after_id' is null or (m.observed_at,m.id)>(select a.observed_at,a.id from public.measurements a where a.user_id=p.user_id and a.id=(p_query->>'after_id')::uuid))
    order by m.observed_at,m.id limit 200
  ) r),'[]'::jsonb)) from public.profiles p where p.user_id=auth.uid() and p.account_state='active';
$$;

-- Bounded work, with the same profile -> batch -> envelope lock order as writes.
create function public.cleanup_data_v1(p_owner uuid default null,p_batch_size integer default 100) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_row record; batch record; amount integer; work integer:=0; expired integer:=0; removed integer:=0;
begin
  if p_batch_size is null or p_batch_size not between 1 and 100 then raise exception 'invalid_batch_size'; end if;
  for owner_row in select p.user_id from public.profiles p where (p_owner is null or p.user_id=p_owner)
    and (exists(select 1 from public.import_batches b where b.user_id=p.user_id and b.status='previewed' and b.expires_at<=clock_timestamp())
      or exists(select 1 from public.private_payloads e where e.user_id=p.user_id and e.expires_at<=clock_timestamp()))
    order by p.user_id limit p_batch_size for update of p skip locked loop
    for batch in select id,staging_payload_id from public.import_batches where user_id=owner_row.user_id and status='previewed' and expires_at<=clock_timestamp()
      order by expires_at,id limit p_batch_size-work for update loop
      update public.import_batches set status='expired',staging_payload_id=null where user_id=owner_row.user_id and id=batch.id;
      delete from public.private_payloads where user_id=owner_row.user_id and id=batch.staging_payload_id and purpose='import_staging';
      get diagnostics amount=row_count; removed:=removed+amount; expired:=expired+1; work:=work+1;
    end loop;
    with candidates as (select id from public.private_payloads where user_id=owner_row.user_id and expires_at<=clock_timestamp() order by expires_at,id limit p_batch_size-work for update)
      delete from public.private_payloads where user_id=owner_row.user_id and id in(select id from candidates);
    get diagnostics amount=row_count; removed:=removed+amount; work:=work+amount;
    exit when work>=p_batch_size;
  end loop;
  return jsonb_build_object('workCount',work,'batchesExpired',expired,'payloadsRemoved',removed);
end;
$$;

revoke all on function public.mutate_measurement_v1(jsonb),public.read_export_v1(jsonb),public.cleanup_data_v1(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.mutate_measurement_v1(jsonb),public.read_export_v1(jsonb) to authenticated;
grant execute on function public.cleanup_data_v1(uuid,integer) to service_role;
commit;

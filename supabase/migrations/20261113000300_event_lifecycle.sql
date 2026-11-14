begin;

alter table public.goal_revisions add column private_content_removed_at timestamptz;
alter table public.action_proposals add column private_content_removed_at timestamptz;

create function public.invalidate_measurement_copies_v2(p_owner uuid,p_source uuid,p_metric text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare marked integer; invalidated integer; removed integer; c record;
begin
 select count(*) into marked from public.goals where user_id=p_owner and source_id=p_source and (p_metric is null or metric_key=p_metric) and review_status<>'needs_review';
 update public.goals set review_status='needs_review',version=version+case when review_status<>'needs_review' then 1 else 0 end,
  baseline_snapshot=case when baseline_snapshot is null then null else (baseline_snapshot-array['value','measurementIds','references'])||'{"value":null,"references":[],"contentRemoved":true}'::jsonb end
 where user_id=p_owner and source_id=p_source and (p_metric is null or metric_key=p_metric);
 update public.goal_revisions r set payload=case when r.payload ? 'baseline' then jsonb_set(r.payload,'{baseline}',(r.payload->'baseline')||'{"value":null,"references":[]}'::jsonb) else r.payload end,
  private_content_removed_at=clock_timestamp()
 where r.user_id=p_owner
  and coalesce(r.payload#>>'{baseline,selection,source_id}',r.payload#>>'{definition,sourceId}',r.payload->>'sourceId')=p_source::text
  and (p_metric is null or coalesce(r.payload#>>'{baseline,selection,metric}',r.payload#>>'{definition,metric}',r.payload->>'metric')=p_metric);
 update public.action_proposals a set canonical_payload=case when a.canonical_payload ? 'baseline' then jsonb_set(a.canonical_payload,'{baseline}',(a.canonical_payload->'baseline')||'{"value":null,"references":[]}'::jsonb) else a.canonical_payload end,
  private_content_removed_at=clock_timestamp()
 where a.user_id=p_owner and a.state='approved' and exists(select 1 from public.goal_revisions r where r.user_id=p_owner and r.approved_proposal_id=a.id and r.private_content_removed_at is not null);
 select count(*) into removed from public.private_payloads where user_id=p_owner and purpose<>'import_staging';
 for c in select id from public.conversations where user_id=p_owner order by id loop
  perform public.mutate_conversation_v1(p_owner,jsonb_build_object('action','delete','id',c.id,'confirm',true,'client_request_id',gen_random_uuid()));
 end loop;
 delete from public.private_payloads where user_id=p_owner and purpose<>'import_staging';
 update public.ai_runs set trace_content_removed_at=clock_timestamp(),trace_state='removed' where user_id=p_owner;
 update public.import_batches set status=case when expires_at<=clock_timestamp() then 'expired' else 'failed' end,staging_payload_id=null where user_id=p_owner and status='previewed';
 get diagnostics invalidated=row_count;
 delete from public.private_payloads where user_id=p_owner and purpose='import_staging';
 return jsonb_build_object('baselinesMarked',marked,'previewsInvalidated',invalidated,'tracePayloadsRemoved',removed);
end;
$$;

create or replace function public.add_measurement_v2(p_request jsonb)
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
  if owner_id is null or not public.owned_session_valid_v1() then raise exception 'unauthorized' using errcode='28000'; end if;
  select data_revision into revision from public.profiles where user_id=owner_id and account_state='active' for update;
  if not found then raise exception 'account_unavailable' using errcode='42501'; end if;
  if jsonb_typeof(p_request) <> 'object' or p_request - array['action','client_request_id','source','observation','schema_version'] <> '{}'::jsonb
    or p_request->>'schema_version' is distinct from '2'
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
  unit_name:=public.metric_definition_v2(observation->>'metric')->>'unit';
  canonical:=public.normalize_value_v2(observation->>'metric',observation->>'unit',observation->>'value');
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

create or replace function public.mutate_measurement_v2(p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare
  owner_id uuid:=auth.uid(); revision bigint; reading public.measurements; receipt public.audit_events;
  request_id uuid; request_hash text; changes jsonb:=p_request->'changes'; instant timestamptz;
  local_day date; canonical numeric; factor numeric; unit_name text; offset_minutes integer;
  fingerprint_hash text; answer jsonb; marked integer; invalidated integer; removed integer:=0; invalidation jsonb;
begin
  if owner_id is null or not public.owned_session_valid_v1() then raise exception 'unauthorized' using errcode='28000'; end if;
  select data_revision into revision from public.profiles where user_id=owner_id and account_state='active' for update;
  if not found then raise exception 'account_unavailable' using errcode='42501'; end if;
  if jsonb_typeof(p_request) is distinct from 'object' or octet_length(p_request::text)>16384
    or p_request->>'action' not in ('correct_measurement','delete_measurement')
    or not p_request ?& array['action','measurement_id','expected_version','client_request_id']
    or p_request-array['action','measurement_id','expected_version','client_request_id','changes','schema_version']<>'{}'::jsonb
    or p_request->>'schema_version' is distinct from '2'
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
    unit_name:=public.metric_definition_v2(reading.metric_key)->>'unit';
    canonical:=public.normalize_value_v2(reading.metric_key,changes->>'unit',changes->>'value');
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
    if reading.event_id is not null then
      if instant<>reading.observed_at or changes->>'timezone' is distinct from reading.timezone or local_day is distinct from reading.local_date then raise exception 'event_time_review_required' using errcode='PT409'; end if;
      offset_minutes:=reading.original_offset_minutes;
    end if;
    fingerprint_hash:=(select encode(sha256(convert_to(jsonb_build_array(s.source_namespace,reading.metric_key,trim_scale(extract(epoch from instant))::text,offset_minutes,
      reading.granularity,trim_scale(canonical)::text,local_day)::text,'UTF8')),'hex') from public.data_sources s where s.user_id=owner_id and s.id=reading.source_id);
    update public.measurements set canonical_value=canonical,canonical_unit=unit_name,original_value=changes->>'value',original_unit=changes->>'unit',
      observed_at=instant,original_offset_minutes=offset_minutes,timezone=changes->>'timezone',local_date=local_day,fingerprint=fingerprint_hash,version=version+1,
      quality_flags=case when 'user_corrected'=any(quality_flags) then quality_flags else array_append(quality_flags,'user_corrected') end,
      provenance=provenance||case when provenance ? 'original_import' then '{}'::jsonb else jsonb_build_object('original_import',jsonb_build_object('value',reading.original_value,'unit',reading.original_unit,'observed_at',reading.observed_at,'timezone',reading.timezone,'offset',reading.original_offset_minutes)) end||'{"user_corrected":true}'::jsonb
      where user_id=owner_id and id=reading.id;
  else
    delete from public.measurements where user_id=owner_id and id=reading.id;
  end if;
  invalidation:=public.invalidate_measurement_copies_v2(owner_id,reading.source_id,reading.metric_key);
  marked:=(invalidation->>'baselinesMarked')::integer;
  invalidated:=(invalidation->>'previewsInvalidated')::integer;
  removed:=(invalidation->>'tracePayloadsRemoved')::integer;
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

create or replace function public.continue_account_deletion_v1(p_owner uuid,p_batch_size integer default 100) returns jsonb language plpgsql security definer set search_path='' as $$
declare receipt public.account_deletion_receipts; table_name text; affected integer; r public.ai_runs; s public.ai_steps; reservation public.usage_reservations; target_run uuid;
begin
 if p_batch_size is null or p_batch_size not between 1 and 100 then raise exception 'invalid_batch_size'; end if;
 perform 1 from public.profiles where user_id=p_owner for update;
 select * into receipt from public.account_deletion_receipts where user_id=p_owner for update;
 if not found then raise exception 'deletion_not_found'; end if;
 if receipt.phase='fenced' then
   for table_name in select unnest(array['private_payloads','messages']) loop
    execute format('delete from public.%I where user_id=$1 and id in(select id from public.%I where user_id=$1 order by id limit $2)',table_name,table_name) using p_owner,p_batch_size;
    get diagnostics affected=row_count; exit when affected>0;
   end loop;
   if affected=0 then
   -- Transcripts no longer reference the composite run/conversation key.
   with candidates as(select id from public.ai_runs where user_id=p_owner and trace_content_removed_at is null order by id limit p_batch_size)
    update public.ai_runs set trace_content_removed_at=clock_timestamp(),conversation_id=null,consent_versions='{}',route_history='[]' where user_id=p_owner and id in(select id from candidates);
   get diagnostics affected=row_count;
   end if;
   if affected=0 then
    with candidates as(select id from public.ai_steps where user_id=p_owner and (raw_usage is not null or source_references<>'[]'::jsonb or request_metadata<>'{}'::jsonb) order by id limit p_batch_size)
     update public.ai_steps set raw_usage=null,source_references='[]',request_metadata='{}' where user_id=p_owner and id in(select id from candidates);
    get diagnostics affected=row_count;
   end if;
   if affected=0 then
    -- Break the approved-history cycle in bounded groups before leaf-first revision removal.
    with candidates as(select id from public.goals where user_id=p_owner and current_revision_id is not null order by id limit p_batch_size)
     update public.goals set state='draft',current_revision_id=null where user_id=p_owner and id in(select id from candidates);
    get diagnostics affected=row_count;
   end if;
   if affected=0 then
    with candidates as(select g.id from public.goal_revisions g where g.user_id=p_owner and not exists(select 1 from public.goal_revisions n where n.user_id=p_owner and n.previous_revision_id=g.id) order by g.id limit p_batch_size)
     delete from public.goal_revisions where user_id=p_owner and id in(select id from candidates);
    get diagnostics affected=row_count;
   end if;
   if affected=0 then
    for table_name in select unnest(array['private_payloads','messages','action_proposals','goals','measurements','weigh_in_events','import_batches','data_sources','conversations','audit_events']) loop
     execute format('delete from public.%I where user_id=$1 and id in(select id from public.%I where user_id=$1 order by id limit $2)',table_name,table_name) using p_owner,p_batch_size;
     get diagnostics affected=row_count;
     exit when affected>0;
    end loop;
   end if;
   if affected=0 then
    update public.profiles set display_name=null,timezone='UTC',units='metric',preferences='{}',consent_versions='{}' where user_id=p_owner;
    update public.account_deletion_receipts set phase='private_content_purged',updated_at=clock_timestamp() where user_id=p_owner;
   end if;
 elsif receipt.phase='private_content_purged' then
   update public.account_deletion_receipts set phase='awaiting_settlement',updated_at=clock_timestamp() where user_id=p_owner;
 elsif receipt.phase='awaiting_settlement' then
   -- Sent requests keep their original-month hold; no content can be restored by settlement.
   for target_run in select id from public.ai_runs where user_id=p_owner and (status in ('admitted','running','cancellation_requested') or exists(select 1 from public.usage_reservations v where v.user_id=p_owner and v.run_id=ai_runs.id and (v.status='reserved' or v.status='pending' and v.uncertain_since+interval '24 hours'<=clock_timestamp()))) order by id limit p_batch_size loop
    r:=public.lock_run_v1(p_owner,target_run);
    for s in select * from public.ai_steps where user_id=p_owner and run_id=r.id order by sequence loop
     select * into reservation from public.usage_reservations where user_id=p_owner and step_id=s.id;
     if s.step_type='tool' and s.status='started' then
      perform public.settle_step_v1(p_owner,r.id,s.id,'{"source":"not_sent","expectedVersion":0,"costUSD":"0"}','interrupted');
     elsif reservation.id is not null and reservation.status<>'settled' then
      if reservation.status='reserved' then
       perform public.settle_step_v1(p_owner,r.id,s.id,jsonb_build_object('source',case when s.dispatch_state='prepared' then 'not_sent' else 'pending' end,'expectedVersion',reservation.evidence_version,'costUSD','0'),'interrupted');
      elsif reservation.uncertain_since+interval '24 hours'<=clock_timestamp() then
       perform public.settle_step_v1(p_owner,r.id,s.id,jsonb_build_object('source','conservative','expectedVersion',reservation.evidence_version,'costUSD',null),'interrupted');
      end if;
     end if;
    end loop;
    update public.ai_runs set status='interrupted',finished_at=coalesce(finished_at,clock_timestamp()),fence=fence+1 where id=r.id and status in ('admitted','running','cancellation_requested');
   end loop;
   if exists(select 1 from public.usage_reservations where user_id=p_owner and status<>'settled') then
    update public.account_deletion_receipts set outcome='waiting_for_accounting',updated_at=clock_timestamp() where user_id=p_owner;
   else
    update public.account_deletion_receipts set outcome='in_progress',updated_at=clock_timestamp() where user_id=p_owner;
    for table_name in select unnest(array['live_verification_allocations','usage_reservations','ai_steps','ai_runs','audit_events','usage_buckets']) loop
     execute format('delete from public.%I where user_id=$1 and id in(select id from public.%I where user_id=$1 order by id limit $2)',table_name,table_name) using p_owner,p_batch_size;
     get diagnostics affected=row_count; exit when affected>0;
    end loop;
    if affected=0 then update public.account_deletion_receipts set phase='app_data_purged',outcome='in_progress',updated_at=clock_timestamp() where user_id=p_owner; end if;
   end if;
 elsif receipt.phase='app_data_purged' then
   delete from public.profiles where user_id=p_owner;
   update public.account_deletion_receipts set phase='auth_removal_pending',updated_at=clock_timestamp() where user_id=p_owner;
 end if;
 update public.profiles set deletion_progress=jsonb_build_object('schema_version',1,'phase',(select phase from public.account_deletion_receipts where user_id=p_owner)) where user_id=p_owner;
 return public.account_status_v1(p_owner);
end;
$$;

create or replace function public.account_export_rows_v1(p_owner uuid,p_section text) returns table(id text,body jsonb) language plpgsql stable security definer set search_path='' as $$
declare projection text; numeric_fields text; table_name text:=p_section;
begin
 if p_section not in ('account_identity','profiles','data_sources','weigh_in_events','measurements','import_batches','goals','goal_revisions','action_proposals','conversations','messages','ai_runs','ai_steps','usage_buckets','usage_reservations','audit_events','live_verification_allocations','staging','trace_inventory') then raise exception 'invalid_export_section'; end if;
 if p_section='account_identity' then
  return query select a.id::text,jsonb_build_object('id',a.id,'email',a.email,'phone',a.phone,'created_at',a.created_at,'updated_at',a.updated_at,'email_confirmed_at',a.email_confirmed_at,'phone_confirmed_at',a.phone_confirmed_at)
   from auth.users a where a.id=p_owner; return;
 end if;
 if p_section='trace_inventory' then
  return query select p.id::text,jsonb_build_object('id',p.id,'purpose',p.purpose,'expires_at',p.expires_at,'content_hash',p.content_hash,'envelope_hash',encode(sha256(convert_to(to_jsonb(p)::text,'UTF8')),'hex'),'state',case when p.expires_at>statement_timestamp() then 'unexpired' else 'expired' end)
   from public.private_payloads p where p.user_id=p_owner and p.purpose<>'import_staging'; return;
 end if;
 if p_section='staging' then
  return query select p.id::text,jsonb_build_object('id',p.id,'purpose',p.purpose,'expires_at',p.expires_at,'content_hash',p.content_hash,'state',case when p.expires_at>statement_timestamp() then 'available' else 'expired' end)
   from public.private_payloads p where p.user_id=p_owner and p.purpose='import_staging'; return;
 end if;
 projection:='to_jsonb(t)-''user_id''';
 if p_section='action_proposals' then
  projection:='(case when t.state=''pending'' and t.expires_at<=statement_timestamp() then (to_jsonb(t)-''user_id'')||jsonb_build_object(''state'',''expired'',''canonical_payload'',null) else to_jsonb(t)-''user_id'' end)';
 end if;
 if p_section='profiles' then projection:=projection||'-''deletion_progress''||jsonb_build_object(''preferences'',t.preferences-''_settings_last_write'')'; end if;
 if p_section='ai_runs' then projection:=projection||'-''executor_hash'''; end if;
 if p_section='ai_steps' then projection:=projection||'-array[''raw_usage'',''continuation_payload_id'',''request_metadata'']'; end if;
 -- Decimal values cross JSON as exact strings, including monetary amounts.
 select string_agg(format('%L,t.%I::text',a.attname,a.attname),',') into numeric_fields from pg_catalog.pg_attribute a
  where a.attrelid=('public.'||table_name)::regclass and a.attnum>0 and not a.attisdropped and a.atttypid in ('numeric'::regtype,'int8'::regtype);
 if numeric_fields is not null then projection:=projection||'||jsonb_build_object('||numeric_fields||')'; end if;
 return query execute format('select %s::text,%s from public.%I t where t.user_id=$1',case when table_name='profiles' then 't.user_id' else 't.id' end,projection,table_name) using p_owner;
end;
$$;

create or replace function public.account_export_manifest_v1(p_owner uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare section text; inventory jsonb:='{}'; signature text; amount bigint;
begin
 perform 1 from public.profiles where user_id=p_owner and account_state='active' for update;
 if not found then raise exception 'account_unavailable' using errcode='PT409'; end if;
 foreach section in array array['account_identity','profiles','data_sources','weigh_in_events','measurements','import_batches','goals','goal_revisions','action_proposals','conversations','messages','ai_runs','ai_steps','usage_buckets','usage_reservations','audit_events','live_verification_allocations','staging','trace_inventory'] loop
  select count(*),encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(body::text,'UTF8')),'hex'),'' order by id),''),'UTF8')),'hex') into amount,signature from public.account_export_rows_v1(p_owner,section);
  inventory:=inventory||jsonb_build_object(section,jsonb_build_object('count',amount,'fingerprint',signature));
 end loop;
 return jsonb_build_object('dataRevision',(select data_revision::text from public.profiles where user_id=p_owner),'sections',inventory);
end;
$$;

create function public.mutate_event_v2(p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); revision bigint; e public.weigh_in_events; receipt public.audit_events; rid uuid; digest text; answer jsonb; invalidation jsonb;
 instant timestamptz; resolved_offset integer; affected integer; namespace text;
begin
 if owner_id is null or not public.owned_session_valid_v1() then raise exception 'unauthorized' using errcode='28000'; end if;
 select data_revision into revision from public.profiles where user_id=owner_id and account_state='active' for update;
 if not found then raise exception 'account_unavailable' using errcode='42501'; end if;
 if p_request->>'schema_version' is distinct from '2' or p_request->>'action' not in ('correct_event_time','update_event_annotations','delete_event')
  or not p_request ?& array['schema_version','action','event_id','expected_version','client_request_id']
  or p_request-array['schema_version','action','event_id','expected_version','client_request_id','changes']<>'{}'::jsonb
  or octet_length(p_request::text)>16384 or jsonb_typeof(p_request->'expected_version')<>'number' then raise exception 'invalid_measurement' using errcode='22023'; end if;
 rid:=(p_request->>'client_request_id')::uuid;
 digest:=encode(sha256(convert_to((p_request-'client_request_id')::text,'UTF8')),'hex');
 select * into receipt from public.audit_events where user_id=owner_id and event_type='data_mutation_v1' and safe_metadata->>'client_request_id'=rid::text;
 if found then
  if receipt.safe_metadata->>'request_hash' is distinct from digest then raise exception 'data_conflict' using errcode='PT409'; end if;
  return receipt.safe_metadata->'result';
 end if;
 select * into e from public.weigh_in_events where user_id=owner_id and id=(p_request->>'event_id')::uuid for update;
 if not found then raise exception 'data_not_found' using errcode='PT404'; end if;
 if (p_request->>'expected_version')::numeric<>e.version then raise exception 'data_conflict' using errcode='PT409'; end if;
 select count(*) into affected from public.measurements where user_id=owner_id and event_id=e.id;
 if p_request->>'action'='correct_event_time' then
  if jsonb_typeof(p_request->'changes')<>'object' or (p_request->'changes')-array['observed_at','timezone','offset_minutes']<>'{}'::jsonb
   or not p_request->'changes' ?& array['observed_at','timezone','offset_minutes']
   or p_request->'changes'->>'observed_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:[0-5]\d(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$'
   or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_request->'changes'->>'timezone' and name<>'Factory') then raise exception 'invalid_measurement' using errcode='22023'; end if;
  instant:=(p_request->'changes'->>'observed_at')::timestamptz;
  resolved_offset:=(p_request->'changes'->>'offset_minutes')::integer;
  if abs(resolved_offset)>840 or ((instant at time zone (p_request->'changes'->>'timezone'))-(instant at time zone 'UTC'))<>make_interval(mins=>resolved_offset) then raise exception 'invalid_measurement' using errcode='22023'; end if;
  if exists(select 1 from public.weigh_in_events where user_id=owner_id and source_id=e.source_id and id<>e.id and (observed_at=instant or source_observed_at=instant))
   or exists(select 1 from public.measurements m where m.user_id=owner_id and m.source_id=e.source_id and m.event_id is distinct from e.id and m.observed_at=instant and m.granularity='instant' and m.metric_key in(select metric_key from public.measurements where user_id=owner_id and event_id=e.id)) then raise exception 'data_conflict' using errcode='PT409'; end if;
  select source_namespace into namespace from public.data_sources where user_id=owner_id and id=e.source_id;
  update public.weigh_in_events set observed_at=instant,timezone=p_request->'changes'->>'timezone',offset_minutes=resolved_offset,version=version+1 where user_id=owner_id and id=e.id;
  update public.measurements m set observed_at=instant,timezone=p_request->'changes'->>'timezone',original_offset_minutes=resolved_offset,version=version+1,
   quality_flags=case when 'user_corrected'=any(quality_flags) then quality_flags else array_append(quality_flags,'user_corrected') end,
   fingerprint=encode(sha256(convert_to(jsonb_build_array(namespace,m.metric_key,trim_scale(extract(epoch from instant))::text,resolved_offset,m.granularity,trim_scale(m.canonical_value)::text,m.local_date)::text,'UTF8')),'hex')
   where m.user_id=owner_id and m.event_id=e.id;
 elsif p_request->>'action'='update_event_annotations' then
  if not public.event_annotations_valid_v2(p_request->'changes') then raise exception 'invalid_measurement' using errcode='22023'; end if;
  update public.weigh_in_events set annotations=p_request->'changes',annotation_provenance=jsonb_build_object('user_corrected',true),version=version+1 where user_id=owner_id and id=e.id;
 else
  if p_request ? 'changes' then raise exception 'invalid_measurement' using errcode='22023'; end if;
  delete from public.measurements where user_id=owner_id and event_id=e.id;
  delete from public.weigh_in_events where user_id=owner_id and id=e.id;
 end if;
 invalidation:=public.invalidate_measurement_copies_v2(owner_id,e.source_id,case when p_request->>'action'='update_event_annotations' then '__annotations__' else null end);
 update public.profiles set data_revision=data_revision+1 where user_id=owner_id returning data_revision into revision;
 answer:=jsonb_build_object('id',e.id,'sourceId',e.source_id,'outcome',p_request->>'action','version',e.version+1,'dataRevision',revision,'observations',affected)||invalidation;
 insert into public.audit_events(user_id,event_type,object_id,safe_metadata) values(owner_id,'data_mutation_v1',e.id,jsonb_build_object('client_request_id',rid::text,'operation',p_request->>'action','request_hash',digest,'result',answer));
 return answer;
exception when unique_violation then raise exception 'data_conflict' using errcode='PT409';
 when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation or invalid_datetime_format or datetime_field_overflow then raise exception 'invalid_measurement' using errcode='22023';
end;
$$;

create function public.update_source_defaults_v2(p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); s public.data_sources; revision bigint; digest text; rid uuid; receipt public.audit_events; answer jsonb;
begin
 if owner_id is null or not public.owned_session_valid_v1() then raise exception 'unauthorized' using errcode='28000'; end if;
 select data_revision into revision from public.profiles where user_id=owner_id and account_state='active' for update;
 if not found then raise exception 'account_unavailable' using errcode='42501'; end if;
 if p_request->>'schema_version' is distinct from '2' or p_request->>'action' is distinct from 'update_source_defaults'
  or not p_request ?& array['schema_version','action','source_id','expected_version','client_request_id','mapping']
  or p_request-array['schema_version','action','source_id','expected_version','client_request_id','mapping']<>'{}'::jsonb
  or octet_length(p_request::text)>65536 or not public.import_mapping_valid_v2(p_request->'mapping')
  or not exists(select 1 from pg_catalog.pg_timezone_names where name=p_request->'mapping'->>'timezone' and name<>'Factory')
  or p_request->'mapping'->>'format' not in ('renpho','canonical','wide')
  or p_request->'mapping'->>'schema_version' is distinct from '1'
  or (p_request->'mapping'->'profile'='null'::jsonb and p_request->'mapping'->>'single_profile' is distinct from 'true')
  or (p_request->'mapping'->>'format'='renpho' and (p_request->'mapping'->>'single_profile' is distinct from 'true' or p_request->'mapping'->>'timezone_confirmed' is distinct from 'true' or p_request->'mapping'->'profile' is distinct from 'null'::jsonb))
  then raise exception 'invalid_import' using errcode='22023'; end if;
 rid:=(p_request->>'client_request_id')::uuid;
 digest:=encode(sha256(convert_to((p_request-'client_request_id')::text,'UTF8')),'hex');
 select * into receipt from public.audit_events where user_id=owner_id and event_type='data_mutation_v1' and safe_metadata->>'client_request_id'=rid::text;
 if found then
  if receipt.safe_metadata->>'request_hash' is distinct from digest then raise exception 'data_conflict' using errcode='PT409'; end if;
  return receipt.safe_metadata->'result';
 end if;
 select * into s from public.data_sources where user_id=owner_id and id=(p_request->>'source_id')::uuid for update;
 if not found then raise exception 'data_not_found' using errcode='PT404'; end if;
 if (p_request->>'expected_version')::numeric<>s.settings_version then raise exception 'data_conflict' using errcode='PT409'; end if;
 update public.data_sources set import_defaults=jsonb_build_object('schema_version',2,'adapter_version',case when p_request->'mapping'->>'format'='renpho' then 'renpho-en-body-composition-v1' else 'csv-v2' end,'mapping',p_request->'mapping'),settings_version=settings_version+1 where user_id=owner_id and id=s.id;
 update public.import_batches set status='failed',staging_payload_id=null where user_id=owner_id and status='previewed';
 delete from public.private_payloads where user_id=owner_id and purpose='import_staging';
 update public.profiles set data_revision=data_revision+1 where user_id=owner_id returning data_revision into revision;
 answer:=jsonb_build_object('source_id',s.id,'settings_version',s.settings_version+1,'dataRevision',revision);
 insert into public.audit_events(user_id,event_type,object_id,safe_metadata) values(owner_id,'data_mutation_v1',s.id,jsonb_build_object('client_request_id',rid::text,'operation','update_source_defaults','request_hash',digest,'result',answer));
 return answer;
end;
$$;

revoke all on function public.invalidate_measurement_copies_v2(uuid,uuid,text),public.add_measurement_v2(jsonb),public.mutate_measurement_v2(jsonb),public.mutate_event_v2(jsonb),public.update_source_defaults_v2(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.add_measurement_v2(jsonb),public.mutate_measurement_v2(jsonb) to authenticated;
grant execute on function public.mutate_event_v2(jsonb),public.update_source_defaults_v2(jsonb) to authenticated;

commit;

begin;

create function public.resolve_import_local_v2(p_local text,p_zone text) returns jsonb
language plpgsql stable set search_path='' as $$
declare local_time timestamp; preferred timestamptz; answer timestamptz; possibilities integer; offset_minutes integer;
begin
 if p_local is null or p_local !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:[0-5]\d$' or p_zone is null then raise exception 'invalid_import' using errcode='22023'; end if;
 local_time:=p_local::timestamp;
 preferred:=local_time at time zone p_zone;
 with offsets as (
  select distinct (sample at time zone p_zone)-(sample at time zone 'UTC') delta
  from (values(preferred),(preferred-interval '2 days'),(preferred+interval '2 days'),(preferred-interval '180 days'),(preferred+interval '180 days')) t(sample)
 ), candidates as (
  select (local_time-delta) at time zone 'UTC' instant from offsets
  where (((local_time-delta) at time zone 'UTC') at time zone p_zone)=local_time
 ) select count(distinct instant),min(instant) into possibilities,answer from candidates;
 if possibilities<>1 then raise exception 'invalid_import' using errcode='22023'; end if;
 if mod(extract(epoch from (local_time-(answer at time zone 'UTC'))),60)<>0 then raise exception 'invalid_import' using errcode='22023'; end if;
 offset_minutes:=extract(epoch from (local_time-(answer at time zone 'UTC')))/60;
 if abs(offset_minutes)>840 then raise exception 'invalid_import' using errcode='22023'; end if;
 return jsonb_build_object('instant',answer,'offset',offset_minutes);
end;
$$;

create function public.import_annotations_v2(e jsonb) returns jsonb
language sql immutable set search_path='' as $$
 select coalesce(jsonb_object_agg(key,convert_from(decode(value#>>'{}','base64'),'UTF8')),'{}'::jsonb) from jsonb_each(e->'annotations_base64');
$$;

create function public.import_rows_v2(b jsonb) returns table(ord bigint,event_ordinal integer,r jsonb)
language sql immutable set search_path='' as $$
 with event_values as (
  select e.value event,e.ordinality event_ord,v.value value,v.ordinality value_ord
  from jsonb_array_elements(b->'events') with ordinality e
  cross join lateral jsonb_array_elements(e.value->'values') with ordinality v
 ), definitions as materialized (
  select key,public.metric_definition_v2(key) d from (select distinct value->>0 key from event_values) keys
 ), renpho as (
  select row_number() over(order by event_ord,value_ord) ord,event_ord::integer event_ordinal,
   jsonb_build_object('metric_key',value->>0,'original_value',value->>1,'canonical_value',value->>2,
    'original_unit',definitions.d->>'original_unit','canonical_unit',definitions.d->>'unit',
    'observed_at',event->>'instant','original_offset_minutes',(event->>'offset')::integer,'timezone',b->'mapping'->>'timezone','local_date',null,
    'granularity','instant','measurement_method',definitions.d->>'method',
    'quality_flags',case when b->'mapping'->>'review_requested'='true' then '["review_requested"]'::jsonb else '[]'::jsonb end,'external_record_id',null,
    'provenance',jsonb_build_object('schema_version',2,'adapter',b->>'adapter_version','row',(event->>'row')::integer,'column',definitions.d->>'header')) r
  from event_values join definitions on definitions.key=event_values.value->>0
 ), generic as (
  select a.ordinality ord,null::integer event_ordinal,jsonb_build_object('metric_key',a.value->>0,'original_value',a.value->>1,'original_unit',a.value->>2,
   'canonical_value',a.value->>3,'canonical_unit',a.value->>4,'observed_at',a.value->>5,'original_offset_minutes',(a.value->>6)::integer,
   'timezone',a.value->>7,'local_date',a.value->>8,'granularity',a.value->>9,'measurement_method',a.value->>10,'quality_flags',a.value->11,
   'external_record_id',a.value->>12,'provenance',jsonb_build_object('schema_version',2,'adapter','csv','row',(a.value->>13)::integer,'column',a.value->>14)) r
  from jsonb_array_elements(b->'observations') with ordinality a
 ) select * from renpho union all select * from generic;
$$;

create function public.import_mapping_valid_v2(m jsonb) returns boolean
language plpgsql stable set search_path='' as $$
declare allowed text[]; cell jsonb;
begin
 if jsonb_typeof(m) is distinct from 'object' or m->>'schema_version' is distinct from '1'
  or not m ?& array['schema_version','format','timezone','profile','single_profile','review_requested']
  or jsonb_typeof(m->'single_profile') is distinct from 'boolean' or jsonb_typeof(m->'review_requested') is distinct from 'boolean'
  or not exists(select 1 from pg_catalog.pg_timezone_names where name=m->>'timezone' and name<>'Factory') then return false; end if;
 if m->'profile'='null'::jsonb then
  if m->>'single_profile'<>'true' then return false; end if;
 elsif jsonb_typeof(m->'profile')='object' then
  if not m->'profile' ?& array['column','value'] or (m->'profile')-array['column','value']<>'{}'::jsonb
   or jsonb_typeof(m->'profile'->'column') is distinct from 'string' or jsonb_typeof(m->'profile'->'value') is distinct from 'string'
   or char_length(m->'profile'->>'column') not between 1 and 200 or char_length(m->'profile'->>'value') not between 1 and 200 then return false; end if;
 else return false; end if;
 allowed:=array['schema_version','format','timezone','profile','single_profile','review_requested'];
 case m->>'format'
 when 'renpho' then
  allowed:=allowed||array['timezone_confirmed'];
  if m->'profile' is distinct from 'null'::jsonb or m->>'single_profile'<>'true' or m->'timezone_confirmed' is distinct from 'true'::jsonb then return false; end if;
 when 'canonical' then
  allowed:=allowed||array['source_label'];
  if jsonb_typeof(m->'source_label') is distinct from 'string' or char_length(m->>'source_label') not between 1 and 200 then return false; end if;
 when 'wide' then
  allowed:=allowed||array['timestamp_column','local_date_column','external_id_column','granularity','metrics'];
  if not m ?& array['timestamp_column','local_date_column','external_id_column','granularity','metrics']
   or jsonb_typeof(m->'timestamp_column') is distinct from 'string' or char_length(m->>'timestamp_column') not between 1 and 200
   or coalesce(m->>'granularity','') not in ('instant','daily_total','session_total')
   or jsonb_typeof(m->'metrics') is distinct from 'array' or jsonb_array_length(m->'metrics') not between 1 and 8 then return false; end if;
  if exists(select 1 from jsonb_each(m) e where e.key in ('local_date_column','external_id_column') and (jsonb_typeof(e.value) not in ('null','string') or (e.value<>'null'::jsonb and char_length(e.value#>>'{}') not between 1 and 200))) then return false; end if;
  for cell in select value from jsonb_array_elements(m->'metrics') loop
   if jsonb_typeof(cell) is distinct from 'object' or not cell ?& array['column','metric','unit','method'] or cell-array['column','metric','unit','method']<>'{}'::jsonb
    or jsonb_typeof(cell->'column') is distinct from 'string' or char_length(cell->>'column') not between 1 and 200
    or public.metric_definition_v2(cell->>'metric') is null
    or not ((public.metric_definition_v2(cell->>'metric')->'units') ? (cell->>'unit'))
    or coalesce(cell->>'method','') not in ('device_reported','device_estimate','user_reported','unknown') then return false; end if;
  end loop;
 else return false;
 end case;
 return m-allowed='{}'::jsonb;
end;
$$;
revoke all on function public.import_mapping_valid_v2(jsonb) from public,anon,authenticated,service_role;

create function public.validate_import_bundle_v2(b jsonb) returns void
language plpgsql stable set search_path='' as $$
declare e jsonb; resolved jsonb; amount integer;
begin
 if not public.import_mapping_valid_v2(b->'mapping') or b->>'schema_version' is distinct from '2' or b->>'registry_version' is distinct from 'body-composition-v1'
  or octet_length(b::text)>8388608 or jsonb_typeof(b->'events') is distinct from 'array' or jsonb_typeof(b->'observations') is distinct from 'array'
  or jsonb_array_length(b->'events')>10000 or jsonb_array_length(b->'observations')>25000
  or (b->>'source_rows')::integer not between 0 and 10000 or jsonb_typeof(b->'issues') is distinct from 'array'
  or jsonb_array_length(b->'issues')>250000 or jsonb_typeof(b->'review') is distinct from 'object'
  or (b->'review')-array['exclude_invalid','exclude_conflicts','acknowledge_unknown']<>'{}'::jsonb
  or not b->'review' ?& array['exclude_invalid','exclude_conflicts','acknowledge_unknown']
  or exists(select 1 from jsonb_each(b->'review') where jsonb_typeof(value)<>'boolean')
  or not exists(select 1 from pg_catalog.pg_timezone_names where name=b->'mapping'->>'timezone' and name<>'Factory') then raise exception 'invalid_import' using errcode='22023'; end if;
 if b->'mapping'->>'format'='renpho' then
  if b->>'adapter_version' is distinct from 'renpho-en-body-composition-v1' or jsonb_array_length(b->'observations')<>0
   or b->'mapping'->>'single_profile' is distinct from 'true' or b->'mapping'->>'timezone_confirmed' is distinct from 'true'
   or b->'mapping'->'profile' is distinct from 'null'::jsonb then raise exception 'invalid_import' using errcode='22023'; end if;
  for e in select value from jsonb_array_elements(b->'events') loop
   resolved:=public.resolve_import_local_v2(e->>'local',b->'mapping'->>'timezone');
   if (resolved->>'instant')::timestamptz is distinct from (e->>'instant')::timestamptz or (resolved->>'offset')::integer is distinct from (e->>'offset')::integer
    or not public.event_annotations_valid_v2(public.import_annotations_v2(e)) or (e->>'row')::integer not between 2 and 10001 or char_length(convert_from(decode(e->>'no_base64','base64'),'UTF8'))>500
    or jsonb_typeof(e->'values') is distinct from 'array' or jsonb_array_length(e->'values') not between 1 and 24
    or (select count(distinct v->>0) from jsonb_array_elements(e->'values') v)<>jsonb_array_length(e->'values') then raise exception 'invalid_import' using errcode='22023'; end if;
  end loop;
  if exists(select 1 from (select distinct v->>0 metric from jsonb_array_elements(b->'events') source_event(event_record) cross join lateral jsonb_array_elements(source_event.event_record->'values') v) keys where public.metric_definition_v2(metric)->>'header' is null) then raise exception 'invalid_import' using errcode='22023'; end if;
 elsif jsonb_array_length(b->'events')<>0 or b->>'adapter_version' is distinct from 'csv-v2' then raise exception 'invalid_import' using errcode='22023'; end if;
 select count(*) into amount from public.import_rows_v2(b);
 if amount>25000 then raise exception 'invalid_import' using errcode='22023'; end if;
 if exists(select 1 from (select distinct r->>'timezone' zone from public.import_rows_v2(b)) zones
  left join pg_catalog.pg_timezone_names names on names.name=zones.zone where names.name is null or zones.zone='Factory')
  then raise exception 'invalid_import' using errcode='22023'; end if;
 if exists(with input as materialized (select * from public.import_rows_v2(b)),
 definitions as materialized (select metric,public.metric_definition_v2(metric) d from (select distinct r->>'metric_key' metric from input) keys)
 select 1 from input t join definitions on definitions.metric=t.r->>'metric_key' where
  r->>'canonical_value' is null or char_length(r->>'canonical_value')>2100 or r->>'canonical_value' !~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)$'
  or (r->>'canonical_value')::numeric is distinct from public.normalize_defined_value_v2(definitions.d,r->>'original_unit',r->>'original_value')
  or r->>'canonical_unit' is distinct from definitions.d->>'unit'
  or r->>'observed_at' !~ '^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:[0-5]\d(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$'
  or not isfinite((r->>'observed_at')::timestamptz) or abs((r->>'original_offset_minutes')::integer)>840
  or r->>'granularity' not in ('instant','daily_total','session_total') or r->>'measurement_method' not in ('device_reported','device_estimate','user_reported','unknown')
  or jsonb_typeof(r->'quality_flags') is distinct from 'array' or jsonb_array_length(r->'quality_flags')>20
  or exists(select 1 from jsonb_array_elements(r->'quality_flags') f where jsonb_typeof(f)<>'string' or char_length(f#>>'{}') not between 1 and 100)
  or (r->>'granularity'='daily_total' and (r->>'local_date' is null or (r->>'local_date')::date<>((r->>'observed_at')::timestamptz at time zone (r->>'timezone'))::date))
  or (r->>'metric_key'='steps_daily' and r->>'granularity'<>'daily_total') or (r->>'metric_key'='sleep_duration' and r->>'granularity'='instant')
  or char_length(r->>'external_record_id')>500 or (r->'provenance'->>'row')::integer not between 2 and 10001
 ) then raise exception 'invalid_import' using errcode='22023'; end if;
end;
$$;

create or replace function public.import_equal_key_v1(r jsonb) returns jsonb language sql immutable set search_path='' as $$
 select jsonb_build_array(r->>'metric_key',trim_scale((r->>'canonical_value')::numeric)::text,r->>'canonical_unit',
  extract(epoch from (r->>'observed_at')::timestamptz),r->'original_offset_minutes',r->>'timezone',r->>'local_date',r->>'granularity',r->>'measurement_method');
$$;

create function public.classify_import_v2(p_owner uuid,p_source uuid,b jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare answer jsonb; generic_rows jsonb;
begin
 if b->'mapping'->>'format'<>'renpho' then
  select coalesce(jsonb_agg(r order by ord),'[]'::jsonb) into generic_rows from public.import_rows_v2(b);
  return jsonb_build_object('classifications',public.classify_import_v1(p_owner,p_source,generic_rows),'event_ids','[]'::jsonb,'time_conflicts','[]'::jsonb,'annotation_classes','[]'::jsonb);
 end if;
 with input_events as materialized (
  select value e,ordinality::integer eo from jsonb_array_elements(b->'events') with ordinality
 ), input_rows as materialized (
  select * from public.import_rows_v2(b)
 ), ambiguous as materialized (
  select instant from (
   select e->>'instant' instant,v->>0 field,count(distinct trim_scale((v->>2)::numeric))>1 conflict
   from input_events cross join lateral jsonb_array_elements(e->'values') v group by e->>'instant',v->>0
   union all
   select e->>'instant',a.key,count(distinct a.value)>1 from input_events cross join lateral jsonb_each(public.import_annotations_v2(e)) a group by e->>'instant',a.key
  ) q where conflict
 ), matched as materialized (
  select i.*,m.id,m.observed_at,m.source_observed_at,m.source_local_time,m.source_timezone,m.annotations,
   (exists(select 1 from ambiguous a where a.instant=i.e->>'instant') or (m.id is not null and
    (m.observed_at<>(i.e->>'instant')::timestamptz or m.source_observed_at<>(i.e->>'instant')::timestamptz or m.source_local_time<>(i.e->>'local')::timestamp or m.source_timezone<>b->'mapping'->>'timezone'))
    or (select count(*) from public.weigh_in_events w where w.user_id=p_owner and w.source_id=p_source and
      (w.source_local_time=(i.e->>'local')::timestamp or w.observed_at=(i.e->>'instant')::timestamptz or w.source_observed_at=(i.e->>'instant')::timestamptz))>1) time_conflict
  from input_events i left join lateral (
   select w.* from public.weigh_in_events w where w.user_id=p_owner and w.source_id=p_source and
    (w.source_local_time=(i.e->>'local')::timestamp or w.observed_at=(i.e->>'instant')::timestamptz or w.source_observed_at=(i.e->>'instant')::timestamptz) order by w.id limit 1
  ) m on true
 ), first_rows as materialized (
  select r->>'metric_key' metric,r->>'observed_at' instant,min(ord) first_ord from input_rows group by r->>'metric_key',r->>'observed_at'
 ), labels as (
  select i.ord,case when e.time_conflict then 'conflict'
   when old.n>0 then case when old.equal_values and old.equal_method then 'duplicate' else 'conflict' end
   when i.ord>first_rows.first_ord then 'duplicate' when e.id is not null then 'enrichment' else 'new' end label
  from input_rows i join matched e on e.eo=i.event_ordinal join first_rows on first_rows.metric=i.r->>'metric_key' and first_rows.instant=i.r->>'observed_at'
  cross join lateral (
   select count(*) n,bool_and(m.canonical_value=(i.r->>'canonical_value')::numeric and m.canonical_unit=i.r->>'canonical_unit') equal_values,
    bool_and(m.measurement_method=i.r->>'measurement_method' and m.granularity='instant' and m.timezone=i.r->>'timezone' and m.original_offset_minutes=(i.r->>'original_offset_minutes')::integer) equal_method
   from public.measurements m where m.user_id=p_owner and m.source_id=p_source and m.metric_key=i.r->>'metric_key' and m.observed_at=(i.r->>'observed_at')::timestamptz and m.deleted_at is null
  ) old
 ), eligible_events as (
  select distinct i.event_ordinal from input_rows i join labels l on l.ord=i.ord where l.label<>'conflict'
 ) select jsonb_build_object(
  'classifications',(select coalesce(jsonb_agg(label order by ord),'[]'::jsonb) from labels),
  'event_ids',(select coalesce(jsonb_agg(id order by eo),'[]'::jsonb) from matched),
  'time_conflicts',(select coalesce(jsonb_agg(time_conflict order by eo),'[]'::jsonb) from matched),
  'annotation_classes',(select coalesce(jsonb_agg(coalesce((select jsonb_object_agg(a.key,case when time_conflict or (m.id is null and m.eo not in (select event_ordinal from eligible_events)) then 'conflict' when not coalesce(m.annotations,'{}'::jsonb) ? a.key then case when exists(select 1 from input_events previous where previous.eo<m.eo and previous.e->>'instant'=m.e->>'instant' and public.import_annotations_v2(previous.e)->a.key=a.value) then 'duplicate' else 'new' end when m.annotations->a.key=a.value then 'duplicate' else 'conflict' end) from jsonb_each(public.import_annotations_v2(m.e)) a),'{}'::jsonb) order by eo),'[]'::jsonb) from matched m)
 ) into answer;
 return answer;
end;
$$;

create function public.inspect_import_v2(p_source jsonb,p_bundle jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); sid uuid; revision bigint;
begin
 if owner_id is null or not public.owned_session_valid_v1() then raise exception 'unauthorized' using errcode='28000'; end if;
 select data_revision into revision from public.profiles where user_id=owner_id and account_state='active';
 if not found then raise exception 'account_unavailable' using errcode='42501'; end if;
 perform public.validate_import_bundle_v2(p_bundle);
 if p_source->>'kind'='existing' then
  select id into sid from public.data_sources where user_id=owner_id and id=(p_source->>'id')::uuid;
  if not found then raise exception 'data_not_found' using errcode='PT404'; end if;
 elsif p_source->>'kind' is distinct from 'new' then raise exception 'invalid_import' using errcode='22023'; end if;
 return public.classify_import_v2(owner_id,sid,p_bundle)||jsonb_build_object('revision',revision);
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then raise exception 'invalid_import' using errcode='22023';
end;
$$;

create function public.register_import_v2(p_payload_id uuid,p_bytes text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); b jsonb; envelope public.private_payloads; sid uuid; revision bigint; inspection jsonb; batch public.import_batches;
 request_id uuid; request_hash text; receipt public.audit_events; source_input jsonb; n integer; dup integer; conflict integer; enriched integer;
begin
 if owner_id is null or not public.owned_session_valid_v1() then raise exception 'unauthorized' using errcode='28000'; end if;
 select data_revision into revision from public.profiles where user_id=owner_id and account_state='active' for update;
 if not found then raise exception 'account_unavailable' using errcode='42501'; end if;
 if octet_length(p_bytes)>4194304 then raise exception 'invalid_import' using errcode='22023'; end if;
 select * into envelope from public.private_payloads where user_id=owner_id and id=p_payload_id and purpose='import_staging' for update;
 if not found then raise exception 'data_not_found' using errcode='PT404'; end if;
 if envelope.expires_at<=clock_timestamp() or envelope.content_hash<>encode(sha256(convert_to(p_bytes,'UTF8')),'hex') then raise exception 'import_changed' using errcode='PT409'; end if;
 b:=p_bytes::jsonb;
 perform public.validate_import_bundle_v2(b);
 request_id:=(b->>'client_request_id')::uuid;
 request_hash:=encode(sha256(convert_to(jsonb_build_array('preview_csv_v2',b->>'file_hash',b->>'mapping_hash',b->'source')::text,'UTF8')),'hex');
 select * into receipt from public.audit_events where user_id=owner_id and event_type='data_mutation_v1' and safe_metadata->>'client_request_id'=request_id::text;
 if found then
  if receipt.safe_metadata->>'operation'<>'preview_csv_v2' or receipt.safe_metadata->>'request_hash'<>request_hash then raise exception 'import_changed' using errcode='PT409'; end if;
  select * into batch from public.import_batches where user_id=owner_id and id=(receipt.safe_metadata->'result'->>'batch_id')::uuid and contract_version=2;
  if not found then raise exception 'import_changed' using errcode='PT409'; end if;
  if p_payload_id is distinct from batch.staging_payload_id then delete from public.private_payloads where id=p_payload_id and user_id=owner_id; end if;
  return to_jsonb(batch)-'user_id';
 end if;
 source_input:=b->'source';
 if source_input->>'kind'='existing' then
  select id into sid from public.data_sources where user_id=owner_id and id=(source_input->>'id')::uuid;
  if not found then raise exception 'data_not_found' using errcode='PT404'; end if;
  select * into batch from public.import_batches where user_id=owner_id and source_id=sid and file_hash=b->>'file_hash' and mapping_hash=b->>'mapping_hash' and status='committed' and contract_version=2;
  if found then
   insert into public.audit_events(user_id,event_type,object_id,safe_metadata) values(owner_id,'data_mutation_v1',batch.id,jsonb_build_object('client_request_id',request_id::text,'operation','preview_csv_v2','request_hash',request_hash,'result',jsonb_build_object('batch_id',batch.id)));
   delete from public.private_payloads where id=p_payload_id and user_id=owner_id;
   return to_jsonb(batch)-'user_id';
  end if;
 elsif source_input->>'kind'='new' then
  if char_length(btrim(source_input->>'label')) not between 1 and 200 or octet_length(source_input::text)>65536 then raise exception 'invalid_import' using errcode='22023'; end if;
  insert into public.data_sources(user_id,kind,label,origin_app,device_label,source_namespace,measurement_method)
   values(owner_id,'csv',btrim(source_input->>'label'),source_input->>'origin_app',source_input->>'device_label',gen_random_uuid()::text,'unknown') returning id into sid;
 else raise exception 'invalid_import' using errcode='22023'; end if;
 if (b->>'data_revision')::bigint<>revision then raise exception 'import_changed' using errcode='PT409'; end if;
 inspection:=public.classify_import_v2(owner_id,sid,b)||jsonb_build_object('revision',revision);
 if inspection is distinct from b->'inspection' then raise exception 'import_changed' using errcode='PT409'; end if;
 select count(*) filter(where value in ('"new"','"enrichment"')),count(*) filter(where value='"duplicate"'),count(*) filter(where value='"conflict"'),count(*) filter(where value='"enrichment"') into n,dup,conflict,enriched from jsonb_array_elements(inspection->'classifications');
 insert into public.import_batches(user_id,source_id,file_hash,mapping_hash,payload_hash,observation_count,new_count,duplicate_count,conflict_count,staging_payload_id,expires_at,preview_data_revision,source_hash,
  contract_version,adapter_version,registry_version,normalized_hash,source_rows,event_count,enriched_count,mapping)
 values(owner_id,sid,b->>'file_hash',b->>'mapping_hash',envelope.content_hash,n+dup+conflict,n,dup,conflict,p_payload_id,envelope.expires_at,revision,
  (select encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from public.data_sources s where s.user_id=owner_id and s.id=sid),2,b->>'adapter_version',b->>'registry_version',
  encode(sha256(convert_to((b-'review')::text,'UTF8')),'hex'),(b->>'source_rows')::integer,jsonb_array_length(b->'events'),enriched,b->'mapping') returning * into batch;
 insert into public.audit_events(user_id,event_type,object_id,safe_metadata) values(owner_id,'data_mutation_v1',batch.id,jsonb_build_object('client_request_id',request_id::text,'operation','preview_csv_v2','request_hash',request_hash,'result',jsonb_build_object('batch_id',batch.id)));
 return to_jsonb(batch)-'user_id';
end;
$$;

create function public.review_import_v2(p_batch_id uuid,p_expected_hash text,p_payload_id uuid,p_bytes text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); batch public.import_batches; envelope public.private_payloads; b jsonb; old_payload uuid; revision bigint;
begin
 if owner_id is null or not public.owned_session_valid_v1() then raise exception 'unauthorized' using errcode='28000'; end if;
 select data_revision into revision from public.profiles where user_id=owner_id and account_state='active' for update;
 if not found then raise exception 'account_unavailable' using errcode='42501'; end if;
 select * into batch from public.import_batches where user_id=owner_id and id=p_batch_id and contract_version=2 for update;
 if not found then raise exception 'data_not_found' using errcode='PT404'; end if;
 select * into envelope from public.private_payloads where user_id=owner_id and id=p_payload_id and purpose='import_staging' for update;
 if not found or envelope.expires_at<=clock_timestamp() or envelope.content_hash<>encode(sha256(convert_to(p_bytes,'UTF8')),'hex') or octet_length(p_bytes)>4194304 then raise exception 'import_changed' using errcode='PT409'; end if;
 b:=p_bytes::jsonb;
 if batch.status<>'previewed' or batch.expires_at<=clock_timestamp() or batch.preview_data_revision<>revision
  or encode(sha256(convert_to((b-'review')::text,'UTF8')),'hex') is distinct from batch.normalized_hash
  or batch.source_hash is distinct from (select encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from public.data_sources s where s.user_id=owner_id and s.id=batch.source_id)
  then raise exception 'import_changed' using errcode='PT409'; end if;
 if batch.payload_hash=envelope.content_hash then
  if p_payload_id<>batch.staging_payload_id then delete from public.private_payloads where user_id=owner_id and id=p_payload_id; end if;
  return to_jsonb(batch)-'user_id';
 end if;
 if batch.payload_hash<>p_expected_hash then raise exception 'import_changed' using errcode='PT409'; end if;
 perform public.validate_import_bundle_v2(b);
 -- Reviewing cannot extend the original preview expiry.
 if envelope.expires_at<batch.expires_at then raise exception 'import_changed' using errcode='PT409'; end if;
 old_payload:=batch.staging_payload_id;
 update public.import_batches set payload_hash=envelope.content_hash,staging_payload_id=p_payload_id where user_id=owner_id and id=batch.id returning * into batch;
 delete from public.private_payloads where user_id=owner_id and id=old_payload;
 return to_jsonb(batch)-'user_id';
end;
$$;

create function public.commit_import_v2(p_request jsonb,p_bytes text) returns jsonb
language plpgsql security definer set search_path='' set jit=off as $$
declare owner_id uuid:=auth.uid(); revision bigint; batch public.import_batches; envelope public.private_payloads; b jsonb; inspection jsonb; source_row public.data_sources;
 request_id uuid; request_hash text; receipt public.audit_events; answer jsonb; classes jsonb; e jsonb; eo integer; target_event_id uuid; observation_offset integer:=0; first_observation integer; existing_event public.weigh_in_events;
 new_annotations jsonb; annotation_origins jsonb; a record; added integer; total_annotations integer:=0; inserted integer:=0; events_inserted integer:=0; linked integer:=0; changed boolean:=false;
begin
 if owner_id is null or not public.owned_session_valid_v1() then raise exception 'unauthorized' using errcode='28000'; end if;
 select data_revision into revision from public.profiles where user_id=owner_id and account_state='active' for update;
 if not found then raise exception 'account_unavailable' using errcode='42501'; end if;
 if jsonb_typeof(p_request)<>'object' or p_request-array['action','batch_id','payload_hash','client_request_id','schema_version']<>'{}'::jsonb
  or not p_request ?& array['action','batch_id','payload_hash','client_request_id','schema_version'] or p_request->>'schema_version' is distinct from '2' or p_request->>'action' is distinct from 'commit_import'
  then raise exception 'invalid_import' using errcode='22023'; end if;
 request_id:=(p_request->>'client_request_id')::uuid;
 request_hash:=encode(sha256(convert_to((p_request-'client_request_id')::text,'UTF8')),'hex');
 select * into batch from public.import_batches where user_id=owner_id and id=(p_request->>'batch_id')::uuid and contract_version=2 for update;
 if not found then raise exception 'data_not_found' using errcode='PT404'; end if;
 if p_request->>'payload_hash' is distinct from batch.payload_hash then raise exception 'import_changed' using errcode='PT409'; end if;
 select * into receipt from public.audit_events where user_id=owner_id and event_type='data_mutation_v1' and safe_metadata->>'client_request_id'=request_id::text;
 if found then
  if receipt.safe_metadata->>'operation'<>'commit_import_v2' or receipt.safe_metadata->>'request_hash'<>request_hash then raise exception 'import_changed' using errcode='PT409'; end if;
  return receipt.safe_metadata->'result';
 end if;
 if batch.status='committed' then answer:=batch.result;
 else
  if batch.status<>'previewed' or batch.expires_at<=clock_timestamp() or batch.preview_data_revision<>revision then raise exception 'import_changed' using errcode='PT409'; end if;
  select * into envelope from public.private_payloads where user_id=owner_id and id=batch.staging_payload_id and purpose='import_staging' for update;
  if not found or envelope.expires_at<=clock_timestamp() or envelope.content_hash<>batch.payload_hash or octet_length(p_bytes)>4194304
   or encode(sha256(convert_to(p_bytes,'UTF8')),'hex')<>batch.payload_hash then raise exception 'import_changed' using errcode='PT409'; end if;
  b:=p_bytes::jsonb;
  perform public.validate_import_bundle_v2(b);
  select * into source_row from public.data_sources where user_id=owner_id and id=batch.source_id for update;
  if not found or batch.source_hash is distinct from encode(sha256(convert_to(to_jsonb(source_row)::text,'UTF8')),'hex') then raise exception 'import_changed' using errcode='PT409'; end if;
  inspection:=public.classify_import_v2(owner_id,batch.source_id,b)||jsonb_build_object('revision',revision);
  classes:=inspection->'classifications';
  if inspection is distinct from b->'inspection' then raise exception 'import_changed' using errcode='PT409'; end if;
  if (jsonb_array_length(b->'issues')>0 and b->'review'->>'exclude_invalid'<>'true')
   or (jsonb_array_length(b->'populated_unknown_columns')>0 and b->'review'->>'acknowledge_unknown'<>'true')
   or ((batch.conflict_count>0 or exists(select 1 from jsonb_array_elements(inspection->'annotation_classes') ac cross join lateral jsonb_each_text(ac) v where v.value='conflict')) and b->'review'->>'exclude_conflicts'<>'true')
   then raise exception 'review_required' using errcode='PT409'; end if;

  for e,eo in select value,ordinality::integer from jsonb_array_elements(b->'events') with ordinality loop
   first_observation:=observation_offset; observation_offset:=observation_offset+jsonb_array_length(e->'values');
   if (inspection->'time_conflicts'->>(eo-1))::boolean then continue; end if;
   select * into existing_event from public.weigh_in_events where user_id=owner_id and source_id=batch.source_id and source_local_time=(e->>'local')::timestamp for update;
   if existing_event.id is null and not exists(select 1 from jsonb_array_elements(e->'values') with ordinality v where classes->>(first_observation+v.ordinality::integer-1)<>'conflict') then continue; end if;
   new_annotations:='{}'::jsonb; annotation_origins:='{}'::jsonb; added:=0;
   for a in select key,value from jsonb_each(public.import_annotations_v2(e)) loop
    if inspection->'annotation_classes'->(eo-1)->>a.key='new' then
     new_annotations:=new_annotations||jsonb_build_object(a.key,a.value);
     annotation_origins:=annotation_origins||jsonb_build_object(a.key,jsonb_build_object('batch_id',batch.id,'row',(e->>'row')::integer));
     added:=added+1;
    end if;
   end loop;
   if existing_event.id is null then
    insert into public.weigh_in_events(user_id,source_id,import_batch_id,adapter_version,source_local_time,source_observed_at,source_timezone,source_offset_minutes,observed_at,timezone,offset_minutes,annotations,annotation_provenance,source_row,source_row_id)
    values(owner_id,batch.source_id,batch.id,b->>'adapter_version',(e->>'local')::timestamp,(e->>'instant')::timestamptz,b->'mapping'->>'timezone',(e->>'offset')::integer,(e->>'instant')::timestamptz,b->'mapping'->>'timezone',(e->>'offset')::integer,new_annotations,annotation_origins,(e->>'row')::integer,convert_from(decode(e->>'no_base64','base64'),'UTF8')) returning id into target_event_id;
    events_inserted:=events_inserted+1; changed:=true;
   else
    target_event_id:=existing_event.id;
    select coalesce(jsonb_object_agg(key,value),'{}'::jsonb) into new_annotations from jsonb_each(new_annotations) where not existing_event.annotations ? key;
    if new_annotations<>'{}'::jsonb then
     update public.weigh_in_events set annotations=weigh_in_events.annotations||new_annotations,annotation_provenance=weigh_in_events.annotation_provenance||annotation_origins,version=version+1 where user_id=owner_id and id=target_event_id;
     changed:=true;
    else added:=0; end if;
   end if;
   total_annotations:=total_annotations+added;
   -- A genuine reviewed RENPHO row may link equivalent existing unlinked readings.
   update public.measurements m set event_id=target_event_id where m.user_id=owner_id and m.source_id=batch.source_id and m.event_id is null
    and m.observed_at=(e->>'instant')::timestamptz and m.granularity='instant' and m.timezone=b->'mapping'->>'timezone' and m.original_offset_minutes=(e->>'offset')::integer
    and exists(select 1 from jsonb_array_elements(e->'values') v where m.metric_key=v->>0 and m.canonical_value=(v->>2)::numeric and m.measurement_method=public.metric_definition_v2(v->>0)->>'method');
   get diagnostics linked=row_count;
   if linked>0 then changed:=true; end if;
  end loop;

  insert into public.measurements(user_id,source_id,import_batch_id,event_id,metric_key,canonical_value,canonical_unit,original_value,original_unit,observed_at,original_offset_minutes,timezone,local_date,granularity,measurement_method,quality_flags,external_record_id,fingerprint,provenance)
  select owner_id,batch.source_id,batch.id,w.id,r->>'metric_key',(r->>'canonical_value')::numeric,r->>'canonical_unit',r->>'original_value',r->>'original_unit',(r->>'observed_at')::timestamptz,
   (r->>'original_offset_minutes')::integer,r->>'timezone',(r->>'local_date')::date,r->>'granularity',r->>'measurement_method',array(select jsonb_array_elements_text(r->'quality_flags')),r->>'external_record_id',
   encode(sha256(convert_to(jsonb_build_array(source_row.source_namespace,r->>'metric_key',trim_scale(extract(epoch from (r->>'observed_at')::timestamptz))::text,(r->>'original_offset_minutes')::integer,r->>'granularity',trim_scale((r->>'canonical_value')::numeric)::text,(r->>'local_date')::date)::text,'UTF8')),'hex'),r->'provenance'
  from public.import_rows_v2(b) t left join public.weigh_in_events w on t.event_ordinal is not null and w.user_id=owner_id and w.source_id=batch.source_id and w.observed_at=(r->>'observed_at')::timestamptz
  where classes->>(t.ord::integer-1) in ('new','enrichment');
  get diagnostics inserted=row_count;
  changed:=changed or inserted>0;
  if source_row.import_defaults is distinct from jsonb_build_object('schema_version',2,'adapter_version',b->>'adapter_version','mapping',b->'mapping') then
   update public.data_sources set import_defaults=jsonb_build_object('schema_version',2,'adapter_version',b->>'adapter_version','mapping',b->'mapping'),settings_version=settings_version+1 where user_id=owner_id and id=batch.source_id;
   -- Settings are revision-bound, but a pure same-settings duplicate remains a no-op.
   changed:=true;
  end if;
  if changed then update public.profiles set data_revision=data_revision+1 where user_id=owner_id returning data_revision into revision; end if;
  answer:=jsonb_build_object('batch_id',batch.id,'source_id',batch.source_id,'outcome','committed','inserted',inserted,'duplicate',batch.duplicate_count,'conflict',batch.conflict_count,'dataRevision',revision,'inserted_events',events_inserted,'enriched',batch.enriched_count,'annotations_added',total_annotations);
  update public.import_batches set status='committed',committed_at=clock_timestamp(),result=answer,staging_payload_id=null where user_id=owner_id and id=batch.id;
  delete from public.private_payloads where user_id=owner_id and id=envelope.id;
 end if;
 insert into public.audit_events(user_id,event_type,object_id,safe_metadata) values(owner_id,'data_mutation_v1',batch.id,jsonb_build_object('client_request_id',request_id::text,'operation','commit_import_v2','request_hash',request_hash,'result',answer));
 return answer;
exception when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation or datetime_field_overflow or invalid_datetime_format then raise exception 'invalid_import' using errcode='22023';
end;
$$;

create function public.discard_import_v2(p_batch_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); batch public.import_batches;
begin
 if owner_id is null or not public.owned_session_valid_v1() then raise exception 'unauthorized' using errcode='28000'; end if;
 perform 1 from public.profiles where user_id=owner_id and account_state='active' for update;
 if not found then raise exception 'account_unavailable' using errcode='42501'; end if;
 select * into batch from public.import_batches where user_id=owner_id and id=p_batch_id and contract_version=2 for update;
 if not found then raise exception 'data_not_found' using errcode='PT404'; end if;
 if batch.status='previewed' then
  update public.import_batches set status=case when expires_at<=clock_timestamp() then 'expired' else 'discarded' end,staging_payload_id=null where user_id=owner_id and id=batch.id;
  delete from public.private_payloads where user_id=owner_id and id=batch.staging_payload_id and purpose='import_staging';
  select * into batch from public.import_batches where user_id=owner_id and id=p_batch_id;
 end if;
 return jsonb_build_object('batch_id',batch.id,'status',batch.status,'result',batch.result);
end;
$$;

create function public.read_import_status_v2(p_batch_id uuid default null,p_request_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); batch public.import_batches; target_id uuid;
begin
 if owner_id is null or not public.owned_session_valid_v1() then raise exception 'unauthorized' using errcode='28000'; end if;
 if not exists(select 1 from public.profiles where user_id=owner_id and account_state='active') then raise exception 'account_unavailable' using errcode='42501'; end if;
 if (p_batch_id is null)=(p_request_id is null) then raise exception 'invalid_import' using errcode='22023'; end if;
 target_id:=p_batch_id;
 if p_request_id is not null then
  select (safe_metadata->'result'->>'batch_id')::uuid into target_id from public.audit_events where user_id=owner_id and event_type='data_mutation_v1' and safe_metadata->>'operation'='preview_csv_v2' and safe_metadata->>'client_request_id'=p_request_id::text;
 end if;
 select * into batch from public.import_batches where user_id=owner_id and id=target_id and contract_version=2;
 if not found then raise exception 'data_not_found' using errcode='PT404'; end if;
 return to_jsonb(batch)-'user_id';
end;
$$;

revoke all on function public.import_annotations_v2(jsonb),public.resolve_import_local_v2(text,text),public.import_rows_v2(jsonb),public.validate_import_bundle_v2(jsonb),public.classify_import_v2(uuid,uuid,jsonb),public.inspect_import_v2(jsonb,jsonb),public.register_import_v2(uuid,text),public.review_import_v2(uuid,text,uuid,text),public.commit_import_v2(jsonb,text),public.discard_import_v2(uuid),public.read_import_status_v2(uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.inspect_import_v2(jsonb,jsonb),public.register_import_v2(uuid,text),public.review_import_v2(uuid,text,uuid,text),public.commit_import_v2(jsonb,text),public.discard_import_v2(uuid) to authenticated;
grant execute on function public.read_import_status_v2(uuid,uuid) to authenticated;

commit;

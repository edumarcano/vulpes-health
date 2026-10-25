begin;

alter table public.import_batches add column preview_data_revision bigint not null default 0 check(preview_data_revision>=0),
  add column source_hash text check(source_hash ~ '^[0-9a-f]{64}$'),
  add column result jsonb check(result is null or jsonb_typeof(result)='object');

-- Private helpers are executable only through the owner-checking entry points.
create function public.import_equal_key_v1(r jsonb) returns jsonb language sql immutable set search_path='' as $$
  select jsonb_build_array(r->>'metric_key',trim_scale((r->>'canonical_value')::numeric)::text,r->>'canonical_unit',
    extract(epoch from (r->>'observed_at')::timestamptz),r->'original_offset_minutes',r->>'timezone',r->>'local_date',
    r->>'granularity',r->>'measurement_method',r->'quality_flags');
$$;
create function public.classify_import_v1(p_owner uuid,p_source uuid,p_rows jsonb) returns jsonb
language sql stable security definer set search_path='' as $$
  with input as materialized (
    select r,ord,public.import_equal_key_v1(r) k from jsonb_array_elements(p_rows) with ordinality t(r,ord)
  ), existing as (
    select to_jsonb(m) r,0::bigint ord,public.import_equal_key_v1(to_jsonb(m)) k from public.measurements m
    where m.user_id=p_owner and m.source_id=p_source and m.deleted_at is null
  ), identities as materialized (
    select a.ord,a.k,jsonb_build_array(a.r->>'metric_key',v.kind,v.identity) identity
    from (select * from input union all select * from existing) a cross join lateral (values
      ('external',case when a.r->>'external_record_id' is not null then to_jsonb(a.r->>'external_record_id') end),
      ('instant',jsonb_build_array(a.r->>'granularity',extract(epoch from (a.r->>'observed_at')::timestamptz))),
      ('daily',case when a.r->>'granularity'='daily_total' then to_jsonb(a.r->>'local_date') end)
    ) v(kind,identity) where v.identity is not null
  ), groups as (
    select identity,min(ord) first_ord,count(distinct k)>1 conflict from identities group by identity
  ), classified as (
    select i.ord,case when bool_or(g.conflict) then 'conflict' when bool_or(g.first_ord<i.ord) then 'duplicate' else 'new' end classification
    from identities i join groups g using(identity) where i.ord>0 group by i.ord
  ) select coalesce(jsonb_agg(classification order by ord),'[]'::jsonb) from classified;
$$;

create function public.inspect_import_v1(p_source jsonb,p_rows jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); sid uuid; revision bigint;
begin
  if owner_id is null then raise exception 'unauthorized' using errcode='28000'; end if;
  select data_revision into revision from public.profiles where user_id=owner_id and account_state='active';
  if not found then raise exception 'account_unavailable' using errcode='42501'; end if;
  if octet_length(p_rows::text)>8388608 or jsonb_typeof(p_rows)<>'array' or jsonb_array_length(p_rows)>5000 then raise exception 'invalid_import' using errcode='22023'; end if;
  if p_source->>'kind'='existing' then
    select id into sid from public.data_sources where user_id=owner_id and id=(p_source->>'id')::uuid;
    if not found then raise exception 'data_not_found' using errcode='PT404'; end if;
  elsif p_source->>'kind' is distinct from 'new' then raise exception 'invalid_import' using errcode='22023'; end if;
  return jsonb_build_object('revision',revision,'classifications',public.classify_import_v1(owner_id,sid,p_rows));
exception when invalid_text_representation or numeric_value_out_of_range or invalid_datetime_format or datetime_field_overflow then raise exception 'invalid_import' using errcode='22023';
end;
$$;

create function public.register_import_v1(p_payload_id uuid,p_bytes text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); bundle jsonb; envelope public.private_payloads; source_input jsonb; sid uuid;
  revision bigint; classes jsonb; batch public.import_batches; request_id uuid; request_hash text; receipt public.audit_events; source_label text;
begin
  if owner_id is null then raise exception 'unauthorized' using errcode='28000'; end if;
  select data_revision into revision from public.profiles where user_id=owner_id and account_state='active' for update;
  if not found then raise exception 'account_unavailable' using errcode='42501'; end if;
  if octet_length(p_bytes)>4194304 then raise exception 'invalid_import' using errcode='22023'; end if;
  select * into envelope from public.private_payloads where user_id=owner_id and id=p_payload_id and purpose='import_staging' for update;
  if not found then raise exception 'data_not_found' using errcode='PT404'; end if;
  if envelope.expires_at<=clock_timestamp() or envelope.content_hash<>encode(sha256(convert_to(p_bytes,'UTF8')),'hex') then raise exception 'import_changed' using errcode='PT409'; end if;
  bundle:=p_bytes::jsonb;
  request_id:=(bundle->>'client_request_id')::uuid;
  request_hash:=encode(sha256(convert_to(jsonb_build_array('preview_csv',bundle->>'file_hash',bundle->>'mapping_hash',bundle->'source')::text,'UTF8')),'hex');
  select * into receipt from public.audit_events where user_id=owner_id and event_type='data_mutation_v1' and safe_metadata->>'client_request_id'=request_id::text;
  if found then
    if receipt.safe_metadata->>'operation'<>'preview_csv' or receipt.safe_metadata->>'request_hash'<>request_hash then raise exception 'import_changed' using errcode='PT409'; end if;
    select * into batch from public.import_batches where user_id=owner_id and id=(receipt.safe_metadata->'result'->>'batch_id')::uuid;
    if p_payload_id is distinct from batch.staging_payload_id then delete from public.private_payloads where id=p_payload_id and user_id=owner_id; end if;
    return to_jsonb(batch)-'user_id';
  end if;
  if bundle->'source'->>'kind'='existing' then
    select * into batch from public.import_batches where user_id=owner_id and source_id=(bundle->'source'->>'id')::uuid
      and file_hash=bundle->>'file_hash' and mapping_hash=bundle->>'mapping_hash' and status='committed';
    if found then
      insert into public.audit_events(user_id,event_type,object_id,safe_metadata) values(owner_id,'data_mutation_v1',batch.id,
        jsonb_build_object('client_request_id',request_id::text,'operation','preview_csv','request_hash',request_hash,'result',jsonb_build_object('batch_id',batch.id)));
      delete from public.private_payloads where id=p_payload_id and user_id=owner_id;
      return to_jsonb(batch)-'user_id';
    end if;
  end if;
  if bundle->>'schema_version'<>'1' or (bundle->>'data_revision')::bigint<>revision or jsonb_array_length(bundle->'observations')>5000 then raise exception 'import_changed' using errcode='PT409'; end if;
  source_input:=bundle->'source';
  if source_input->>'kind'='existing' then
    select id into sid from public.data_sources where user_id=owner_id and id=(source_input->>'id')::uuid;
    if not found then raise exception 'data_not_found' using errcode='PT404'; end if;
  elsif source_input->>'kind'='new' then
    source_label:=btrim(source_input->>'label',U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
    if char_length(source_label) not between 1 and 200 then raise exception 'invalid_import' using errcode='22023'; end if;
    insert into public.data_sources(user_id,kind,label,origin_app,device_label,source_namespace,measurement_method)
      values(owner_id,'csv',source_label,source_input->>'origin_app',source_input->>'device_label',gen_random_uuid()::text,'unknown') returning id into sid;
  else raise exception 'invalid_import' using errcode='22023'; end if;
  classes:=public.classify_import_v1(owner_id,sid,bundle->'observations');
  if classes is distinct from bundle->'classifications' then raise exception 'import_changed' using errcode='PT409'; end if;
  insert into public.import_batches(user_id,source_id,file_hash,mapping_hash,payload_hash,observation_count,new_count,duplicate_count,conflict_count,staging_payload_id,expires_at,preview_data_revision,source_hash)
  values(owner_id,sid,bundle->>'file_hash',bundle->>'mapping_hash',envelope.content_hash,(bundle->'counts'->>'observations')::integer,
    (bundle->'counts'->>'new')::integer,(bundle->'counts'->>'duplicate')::integer,(bundle->'counts'->>'conflict')::integer,p_payload_id,envelope.expires_at,revision,
    (select encode(sha256(convert_to(to_jsonb(s)::text,'UTF8')),'hex') from public.data_sources s where s.user_id=owner_id and s.id=sid)) returning * into batch;
  insert into public.audit_events(user_id,event_type,object_id,safe_metadata) values(owner_id,'data_mutation_v1',batch.id,
    jsonb_build_object('client_request_id',request_id::text,'operation','preview_csv','request_hash',request_hash,'result',jsonb_build_object('batch_id',batch.id)));
  return to_jsonb(batch)-'user_id';
end;
$$;

create function public.commit_import_v1(p_request jsonb,p_bytes text) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); revision bigint; batch public.import_batches; envelope public.private_payloads;
  bundle jsonb; classes jsonb; source_row public.data_sources; r jsonb; idx integer; inserted integer:=0;
  request_id uuid; request_hash text; receipt public.audit_events; answer jsonb; fingerprint_hash text;
begin
  if owner_id is null then raise exception 'unauthorized' using errcode='28000'; end if;
  select data_revision into revision from public.profiles where user_id=owner_id and account_state='active' for update;
  if not found then raise exception 'account_unavailable' using errcode='42501'; end if;
  if jsonb_typeof(p_request)<>'object' or p_request-array['action','batch_id','payload_hash','client_request_id']<>'{}'::jsonb or not p_request ?& array['action','batch_id','payload_hash','client_request_id']
    or p_request->>'action' is distinct from 'commit_import' then raise exception 'invalid_import' using errcode='22023'; end if;
  request_id:=(p_request->>'client_request_id')::uuid;
  request_hash:=encode(sha256(convert_to(jsonb_build_array('commit_import',(p_request->>'batch_id')::uuid,p_request->>'payload_hash')::text,'UTF8')),'hex');
  select * into batch from public.import_batches where user_id=owner_id and id=(p_request->>'batch_id')::uuid for update;
  if not found then raise exception 'data_not_found' using errcode='PT404'; end if;
  if p_request->>'payload_hash' is distinct from batch.payload_hash then raise exception 'import_changed' using errcode='PT409'; end if;
  select * into receipt from public.audit_events where user_id=owner_id and event_type='data_mutation_v1' and safe_metadata->>'client_request_id'=request_id::text;
  if found then
    if receipt.safe_metadata->>'operation'<>'commit_import' or receipt.safe_metadata->>'request_hash'<>request_hash then raise exception 'import_changed' using errcode='PT409'; end if;
    return receipt.safe_metadata->'result';
  end if;
  if batch.status='committed' then answer:=batch.result;
  else
    if batch.status<>'previewed' or batch.expires_at<=clock_timestamp() or batch.preview_data_revision<>revision then raise exception 'import_changed' using errcode='PT409'; end if;
    select * into envelope from public.private_payloads where user_id=owner_id and id=batch.staging_payload_id and purpose='import_staging' for update;
    if not found then raise exception 'import_changed' using errcode='PT409'; end if;
    if envelope.expires_at<=clock_timestamp() or batch.expires_at>envelope.expires_at or octet_length(p_bytes)>4194304
      or envelope.content_hash<>batch.payload_hash or encode(sha256(convert_to(p_bytes,'UTF8')),'hex')<>batch.payload_hash then raise exception 'import_changed' using errcode='PT409'; end if;
    bundle:=p_bytes::jsonb;
    select * into source_row from public.data_sources where user_id=owner_id and id=batch.source_id;
    if not found then raise exception 'data_not_found' using errcode='PT404'; end if;
    if batch.source_hash is distinct from encode(sha256(convert_to(to_jsonb(source_row)::text,'UTF8')),'hex') then raise exception 'import_changed' using errcode='PT409'; end if;
    if (bundle->>'data_revision')::bigint<>revision then raise exception 'import_changed' using errcode='PT409'; end if;
    classes:=public.classify_import_v1(owner_id,batch.source_id,bundle->'observations');
    if classes is distinct from bundle->'classifications' then raise exception 'import_changed' using errcode='PT409'; end if;
    for r,idx in select value,ordinality::integer from jsonb_array_elements(bundle->'observations') with ordinality loop
      if classes->>(idx-1)<>'new' then continue; end if;
      fingerprint_hash:=encode(sha256(convert_to(jsonb_build_array(source_row.source_namespace,r->>'metric_key',trim_scale(extract(epoch from (r->>'observed_at')::timestamptz))::text,
        (r->>'original_offset_minutes')::integer,r->>'granularity',trim_scale((r->>'canonical_value')::numeric)::text,(r->>'local_date')::date)::text,'UTF8')),'hex');
      insert into public.measurements(user_id,source_id,import_batch_id,metric_key,canonical_value,canonical_unit,original_value,original_unit,observed_at,original_offset_minutes,timezone,local_date,granularity,measurement_method,quality_flags,external_record_id,fingerprint,provenance)
      values(owner_id,batch.source_id,batch.id,r->>'metric_key',(r->>'canonical_value')::numeric,r->>'canonical_unit',r->>'original_value',r->>'original_unit',(r->>'observed_at')::timestamptz,
        (r->>'original_offset_minutes')::integer,r->>'timezone',(r->>'local_date')::date,r->>'granularity',r->>'measurement_method',array(select jsonb_array_elements_text(r->'quality_flags')),r->>'external_record_id',fingerprint_hash,r->'provenance');
      inserted:=inserted+1;
    end loop;
    if inserted>0 then update public.profiles set data_revision=data_revision+1 where user_id=owner_id returning data_revision into revision; end if;
    answer:=jsonb_build_object('batch_id',batch.id,'source_id',batch.source_id,'outcome','committed','inserted',inserted,'duplicate',batch.duplicate_count,'conflict',batch.conflict_count,'dataRevision',revision);
    update public.import_batches set status='committed',committed_at=clock_timestamp(),result=answer,staging_payload_id=null where id=batch.id and user_id=owner_id;
    delete from public.private_payloads where id=envelope.id and user_id=owner_id;
  end if;
  insert into public.audit_events(user_id,event_type,object_id,safe_metadata) values(owner_id,'data_mutation_v1',batch.id,jsonb_build_object('client_request_id',request_id::text,'operation','commit_import','request_hash',request_hash,'result',answer));
  return answer;
exception when invalid_text_representation or numeric_value_out_of_range or check_violation or not_null_violation or datetime_field_overflow or invalid_datetime_format then raise exception 'invalid_import' using errcode='22023';
end;
$$;

create function public.discard_import_v1(p_batch_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); batch public.import_batches;
begin
  if owner_id is null then raise exception 'unauthorized' using errcode='28000'; end if;
  perform 1 from public.profiles where user_id=owner_id and account_state='active' for update;
  if not found then raise exception 'account_unavailable' using errcode='42501'; end if;
  select * into batch from public.import_batches where user_id=owner_id and id=p_batch_id for update;
  if not found then raise exception 'data_not_found' using errcode='PT404'; end if;
  if batch.status<>'previewed' then return; end if;
  update public.import_batches set status=case when expires_at<=clock_timestamp() then 'expired' else 'failed' end,staging_payload_id=null where user_id=owner_id and id=p_batch_id;
  delete from public.private_payloads where user_id=owner_id and id=batch.staging_payload_id and purpose='import_staging';
end;
$$;

revoke all on function public.import_equal_key_v1(jsonb),public.classify_import_v1(uuid,uuid,jsonb),public.inspect_import_v1(jsonb,jsonb),public.register_import_v1(uuid,text),public.commit_import_v1(jsonb,text),public.discard_import_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.inspect_import_v1(jsonb,jsonb),public.register_import_v1(uuid,text),public.commit_import_v1(jsonb,text),public.discard_import_v1(uuid) to authenticated;
commit;

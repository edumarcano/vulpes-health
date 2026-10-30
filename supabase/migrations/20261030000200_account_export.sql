begin;
-- The closed inventory is shared by paging and fingerprint validation. No caller-supplied SQL.
create function public.account_export_rows_v1(p_owner uuid,p_section text) returns table(id text,body jsonb) language plpgsql stable security definer set search_path='' as $$
declare projection text; numeric_fields text; table_name text:=p_section;
begin
 if p_section not in ('account_identity','profiles','data_sources','measurements','import_batches','goals','goal_revisions','action_proposals','conversations','messages','ai_runs','ai_steps','usage_buckets','usage_reservations','audit_events','live_verification_allocations','staging','trace_inventory') then raise exception 'invalid_export_section'; end if;
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
create function public.read_account_export_v1(p_owner uuid,p_section text,p_after text default null) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.profiles where user_id=p_owner and account_state='active' for update;
 if not found then raise exception 'account_unavailable' using errcode='PT409'; end if;
 return (select jsonb_build_object('rows',coalesce(jsonb_agg(body order by id),'[]')) from(select id,body from public.account_export_rows_v1(p_owner,p_section) where p_after is null or id>p_after order by id limit 200) r);
end;
$$;
create function public.account_export_manifest_v1(p_owner uuid) returns jsonb language plpgsql security definer set search_path='' as $$
declare section text; inventory jsonb:='{}'; signature text; amount bigint;
begin
 perform 1 from public.profiles where user_id=p_owner and account_state='active' for update;
 if not found then raise exception 'account_unavailable' using errcode='PT409'; end if;
 foreach section in array array['account_identity','profiles','data_sources','measurements','import_batches','goals','goal_revisions','action_proposals','conversations','messages','ai_runs','ai_steps','usage_buckets','usage_reservations','audit_events','live_verification_allocations','staging','trace_inventory'] loop
  select count(*),encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(body::text,'UTF8')),'hex'),'' order by id),''),'UTF8')),'hex') into amount,signature from public.account_export_rows_v1(p_owner,section);
  inventory:=inventory||jsonb_build_object(section,jsonb_build_object('count',amount,'fingerprint',signature));
 end loop;
 return jsonb_build_object('dataRevision',(select data_revision::text from public.profiles where user_id=p_owner),'sections',inventory);
end;
$$;
revoke all on function public.account_export_rows_v1(uuid,text),public.read_account_export_v1(uuid,text,text),public.account_export_manifest_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.read_account_export_v1(uuid,text,text),public.account_export_manifest_v1(uuid) to service_role;
commit;

begin;
-- Expired pending drafts remain inaccessible even before physical cleanup.
create policy unexpired_pending_proposal on public.action_proposals as restrictive for select to authenticated
 using (state<>'pending' or expires_at>statement_timestamp());
create or replace function public.account_export_rows_v1(p_owner uuid,p_section text) returns table(id text,body jsonb) language plpgsql stable security definer set search_path='' as $$
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
commit;

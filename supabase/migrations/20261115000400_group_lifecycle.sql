begin;

create or replace function public.invalidate_measurement_copies_v2(p_owner uuid,p_source uuid,p_metric text) returns jsonb
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

 -- Composite parents retain their original approval hash after private copies are removed.
 update public.action_proposals a set canonical_payload=jsonb_set(a.canonical_payload,'{members}',(
  select jsonb_agg(case when
   coalesce(m.value#>>'{payload,baseline,selection,source_id}',m.value#>>'{payload,definition,sourceId}')=p_source::text
   and (p_metric is null or coalesce(m.value#>>'{payload,baseline,selection,metric}',m.value#>>'{payload,definition,metric}')=p_metric)
   then jsonb_set(m.value,'{payload,baseline}',(m.value#>'{payload,baseline}')||'{"value":null,"references":[]}'::jsonb)
   else m.value end order by m.ordinality)
  from jsonb_array_elements(a.canonical_payload->'members') with ordinality as m(value,ordinality)
 )),private_content_removed_at=clock_timestamp()
 where a.user_id=p_owner and a.state='approved' and a.payload_version=3 and a.kind like 'goal_group.%'
  and exists(select 1 from jsonb_array_elements(a.canonical_payload->'members') m where
   coalesce(m#>>'{payload,baseline,selection,source_id}',m#>>'{payload,definition,sourceId}')=p_source::text
   and (p_metric is null or coalesce(m#>>'{payload,baseline,selection,metric}',m#>>'{payload,definition,metric}')=p_metric));
 update public.goal_groups gg set review_status='needs_review',version=gg.version+1,updated_at=clock_timestamp()
 where gg.user_id=p_owner and gg.review_status<>'needs_review' and exists(
  select 1 from public.goal_group_members gm join public.goal_revisions gr on gr.user_id=gm.user_id and gr.goal_id=gm.goal_id and gr.id=gm.reviewed_revision_id
  where gm.user_id=p_owner and gm.group_id=gg.id
   and coalesce(gr.payload#>>'{baseline,selection,source_id}',gr.payload#>>'{definition,sourceId}',gr.payload->>'sourceId')=p_source::text
   and (p_metric is null or coalesce(gr.payload#>>'{baseline,selection,metric}',gr.payload#>>'{definition,metric}',gr.payload->>'metric')=p_metric));
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
    -- Archive before membership removal; clear the proposal cycle before deleting parents.
    with candidates as(select id from public.goal_groups where user_id=p_owner and (state<>'archived' or current_approval_id is not null) order by id limit p_batch_size)
     update public.goal_groups set state='archived',current_approval_id=null where user_id=p_owner and id in(select id from candidates);
    get diagnostics affected=row_count;
   end if;
   if affected=0 then
    delete from public.goal_group_members where user_id=p_owner and id in(select id from public.goal_group_members where user_id=p_owner order by id limit p_batch_size);
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
    for table_name in select unnest(array['private_payloads','messages','action_proposals','goal_groups','goals','measurements','weigh_in_events','import_batches','data_sources','conversations','audit_events']) loop
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
 if p_section not in ('account_identity','profiles','data_sources','weigh_in_events','measurements','import_batches','goals','goal_revisions','goal_groups','goal_group_members','action_proposals','conversations','messages','ai_runs','ai_steps','usage_buckets','usage_reservations','audit_events','live_verification_allocations','staging','trace_inventory') then raise exception 'invalid_export_section'; end if;
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
 foreach section in array array['account_identity','profiles','data_sources','weigh_in_events','measurements','import_batches','goals','goal_revisions','goal_groups','goal_group_members','action_proposals','conversations','messages','ai_runs','ai_steps','usage_buckets','usage_reservations','audit_events','live_verification_allocations','staging','trace_inventory'] loop
  select count(*),encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(body::text,'UTF8')),'hex'),'' order by id),''),'UTF8')),'hex') into amount,signature from public.account_export_rows_v1(p_owner,section);
  inventory:=inventory||jsonb_build_object(section,jsonb_build_object('count',amount,'fingerprint',signature));
 end loop;
 return jsonb_build_object('dataRevision',(select data_revision::text from public.profiles where user_id=p_owner),'sections',inventory);
end;
$$;

commit;

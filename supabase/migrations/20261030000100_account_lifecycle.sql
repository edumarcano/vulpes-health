begin;

-- Independent of both profile and Auth lifetime; no content or executor authority.
create table public.account_deletion_receipts (
 user_id uuid primary key, id uuid not null unique default gen_random_uuid(),
 phase text not null check(phase in ('fenced','private_content_purged','awaiting_settlement','app_data_purged','auth_removal_pending','completed')),
 requested_at timestamptz not null default clock_timestamp(), updated_at timestamptz not null default clock_timestamp(),
 completed_at timestamptz, outcome text not null default 'in_progress' check(outcome in ('in_progress','waiting_for_accounting','auth_unavailable','completed')),
 check((phase='completed')=(completed_at is not null))
);
alter table public.account_deletion_receipts enable row level security;
revoke all on public.account_deletion_receipts from public,anon,authenticated,service_role;
grant select on public.account_deletion_receipts to service_role;

create or replace function public.fence_deleting_account_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
 if new.account_state='active' and exists(select 1 from public.account_deletion_receipts where user_id=new.user_id) then raise exception 'account_unavailable'; end if;
 if tg_op='UPDATE' then
  if new.account_state='deleting' and old.account_state<>'deleting' then
   update public.ai_runs set status='cancellation_requested',cancellation_requested_at=clock_timestamp(),fence=fence+1 where user_id=new.user_id and status in ('admitted','running');
  end if;
 end if;
 return new;
end;
$$;
create trigger fence_profile_recreation before insert on public.profiles for each row execute function public.fence_deleting_account_v1();

create function public.account_status_v1(p_owner uuid) returns jsonb language sql security definer set search_path='' as $$
 select coalesce((select jsonb_build_object('state','deleting','receiptId',d.id,'phase',d.phase,'requestedAt',d.requested_at,'updatedAt',d.updated_at,'outcome',d.outcome,
 'retryAfter',(select min(v.uncertain_since+interval '24 hours') from public.usage_reservations v where v.user_id=p_owner and v.status='pending')) from public.account_deletion_receipts d where d.user_id=p_owner),
 (select jsonb_build_object('state','active') from public.profiles where user_id=p_owner and account_state='active'));
$$;

create function public.begin_account_deletion_v1(p_owner uuid,p_password_at timestamptz) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 -- Every lifecycle transaction takes the profile first, then the journal, matching run/domain writes.
 perform 1 from public.profiles where user_id=p_owner for update;
 if exists(select 1 from public.account_deletion_receipts where user_id=p_owner) then return public.account_status_v1(p_owner); end if;
 if not found or p_password_at is null or p_password_at<clock_timestamp()-interval '5 minutes' or p_password_at>clock_timestamp()+interval '5 seconds' then raise exception 'recent_password_required'; end if;
 update public.profiles set account_state='deleting',deletion_progress='{"schema_version":1,"phase":"fenced"}' where user_id=p_owner;
 insert into public.account_deletion_receipts(user_id,phase) values(p_owner,'fenced');
 return public.account_status_v1(p_owner);
end;
$$;

create function public.continue_account_deletion_v1(p_owner uuid,p_batch_size integer default 100) returns jsonb language plpgsql security definer set search_path='' as $$
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
    for table_name in select unnest(array['private_payloads','messages','action_proposals','goals','measurements','import_batches','data_sources','conversations','audit_events']) loop
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

create function public.finish_account_deletion_v1(p_owner uuid,p_auth_absent boolean) returns jsonb language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.account_deletion_receipts where user_id=p_owner for update;
 if not found then raise exception 'deletion_not_found'; end if;
 if exists(select 1 from public.profiles where user_id=p_owner) then raise exception 'deletion_incomplete'; end if;
 if exists(select 1 from public.account_deletion_receipts where user_id=p_owner and phase not in ('auth_removal_pending','completed')) then raise exception 'deletion_incomplete'; end if;
 if p_auth_absent and not exists(select 1 from auth.users where id=p_owner) then
  update public.account_deletion_receipts set phase='completed',outcome='completed',updated_at=clock_timestamp(),completed_at=coalesce(completed_at,clock_timestamp()) where user_id=p_owner;
 else update public.account_deletion_receipts set outcome='auth_unavailable',updated_at=clock_timestamp() where user_id=p_owner and phase<>'completed'; end if;
 return public.account_status_v1(p_owner);
end;
$$;

-- Direct owner reads also fail closed during deletion, even with an unexpired JWT.
alter policy owner_read on public.profiles using ((select auth.uid())=user_id and account_state='active');
do $$ declare t text; begin
 foreach t in array array['data_sources','import_batches','measurements','goals','goal_revisions','conversations','messages','action_proposals','ai_runs','ai_steps'] loop
  execute format('alter policy owner_read on public.%I using ((select auth.uid())=user_id and exists(select 1 from public.profiles p where p.user_id=(select auth.uid()) and p.account_state=''active''))',t);
 end loop;
end $$;
create or replace function public.cancel_chat_v1(p_owner uuid,p_run uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare receipt public.audit_events; answer jsonb;
begin
 perform 1 from public.profiles where user_id=p_owner and account_state='active' for update;
 if not found then raise exception 'account_unavailable'; end if;
 select * into receipt from public.audit_events where user_id=p_owner and event_type='chat_cancel_v1' and safe_metadata->>'client_request_id'=p_request::text;
 if found then
  if receipt.object_id is distinct from p_run then raise exception 'idempotency_conflict'; end if;
  return public.run_summary_v1(p_owner,p_run);
 end if;
 answer:=public.cancel_run_v1(p_owner,p_run);
 insert into public.audit_events(user_id,event_type,object_id,safe_metadata) values(p_owner,'chat_cancel_v1',p_run,jsonb_build_object('client_request_id',p_request));
 return answer;
end;
$$;
revoke all on function public.account_status_v1(uuid),public.begin_account_deletion_v1(uuid,timestamptz),public.continue_account_deletion_v1(uuid,integer),public.finish_account_deletion_v1(uuid,boolean) from public,anon,authenticated,service_role;
grant execute on function public.account_status_v1(uuid),public.begin_account_deletion_v1(uuid,timestamptz),public.continue_account_deletion_v1(uuid,integer),public.finish_account_deletion_v1(uuid,boolean) to service_role;
commit;

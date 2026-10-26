begin;
create function public.fence_removed_run_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.trace_content_removed_at is not null and old.trace_content_removed_at is null then
    new.trace_state:='removed';new.fence:=old.fence+1;
    if old.status in ('admitted','running') then new.status:='cancellation_requested';new.cancellation_requested_at:=clock_timestamp(); end if;
    update public.messages set context_state='source_removed' where user_id=new.user_id and run_id=new.id;
  end if;
  return new;
end;
$$;
create trigger fence_removed_run before update of trace_content_removed_at on public.ai_runs
  for each row execute function public.fence_removed_run_v1();
create function public.fence_deleting_account_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.account_state='deleting' and old.account_state<>'deleting' then
    update public.ai_runs set status='cancellation_requested',cancellation_requested_at=clock_timestamp(),fence=fence+1
      where user_id=new.user_id and status in ('admitted','running');
  end if;
  return new;
end;
$$;
create trigger fence_deleting_account after update of account_state on public.profiles
  for each row execute function public.fence_deleting_account_v1();

create function public.reconcile_runs_v1(p_owner uuid default null,p_batch_size integer default 100) returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_row record; target_run_id uuid; r public.ai_runs; s record; reservation_row public.usage_reservations;
  work integer:=0; interrupted integer:=0; conservative integer:=0; removed integer:=0;
begin
  if p_batch_size is null or p_batch_size not between 1 and 100 then raise exception 'invalid_batch_size'; end if;
  for owner_row in select p.user_id from public.profiles p where (p_owner is null or p.user_id=p_owner) and exists(
    select 1 from public.ai_runs a where a.user_id=p.user_id and
      ((a.status in ('admitted','running','cancellation_requested') and least(a.deadline_at,a.lease_expires_at)<=clock_timestamp())
        or a.expires_at<=clock_timestamp()
        or exists(select 1 from public.usage_reservations v where v.user_id=a.user_id and v.run_id=a.id and v.status='pending' and v.uncertain_since+interval '24 hours'<=clock_timestamp())))
    order by p.user_id limit p_batch_size for update of p skip locked loop
    for target_run_id in select a.id from public.ai_runs a where a.user_id=owner_row.user_id and
      ((a.status in ('admitted','running','cancellation_requested') and least(a.deadline_at,a.lease_expires_at)<=clock_timestamp())
        or a.expires_at<=clock_timestamp()
        or exists(select 1 from public.usage_reservations v where v.user_id=a.user_id and v.run_id=a.id and v.status='pending' and v.uncertain_since+interval '24 hours'<=clock_timestamp()))
      order by a.admitted_at,a.id limit p_batch_size-work loop
      r:=public.lock_run_v1(owner_row.user_id,target_run_id);
      if r.status in ('admitted','running','cancellation_requested') and least(r.deadline_at,r.lease_expires_at)<=clock_timestamp() then
        for s in select id,step_type,dispatch_state from public.ai_steps where user_id=r.user_id and run_id=r.id and status='started' order by sequence loop
          select * into reservation_row from public.usage_reservations where user_id=r.user_id and step_id=s.id;
          perform public.settle_step_v1(r.user_id,r.id,s.id,jsonb_build_object('expectedVersion',coalesce(reservation_row.evidence_version,0),
            'source',case when s.step_type='tool' or s.dispatch_state='prepared' then 'not_sent' else 'pending' end,'costUSD',null),'interrupted');
          update public.usage_reservations set uncertain_since=least(coalesce(uncertain_since,clock_timestamp()),least(r.deadline_at,r.lease_expires_at))
            where user_id=r.user_id and step_id=s.id and status='pending';
        end loop;
        update public.ai_runs set status='interrupted',finished_at=clock_timestamp(),fence=fence+1,
          trace_state=case when trace_state='available' then 'incomplete' else trace_state end where id=r.id;
        update public.messages set status='interrupted' where user_id=r.user_id and run_id=r.id and role='assistant' and status='streaming';
        interrupted:=interrupted+1;
      end if;
      for reservation_row in select * from public.usage_reservations where user_id=r.user_id and run_id=r.id and status='pending' and uncertain_since+interval '24 hours'<=clock_timestamp() order by id loop
        perform public.settle_step_v1(r.user_id,r.id,reservation_row.step_id,jsonb_build_object('expectedVersion',reservation_row.evidence_version,'source','conservative','costUSD',null),'interrupted');
        conservative:=conservative+1;
      end loop;
      if r.expires_at<=clock_timestamp() and not exists(select 1 from public.usage_reservations where user_id=r.user_id and run_id=r.id and status<>'settled')
        and exists(select 1 from public.ai_runs where id=r.id and status in ('completed','failed','cancelled','interrupted')) then
        -- Core transcript and proposal history outlive safe execution metadata.
        update public.messages set run_id=null where user_id=r.user_id and run_id=r.id;
        update public.action_proposals set source_run_id=null where user_id=r.user_id and source_run_id=r.id;
        delete from public.private_payloads where user_id=r.user_id and id in(
          select input_payload_id from public.ai_steps where user_id=r.user_id and run_id=r.id union
          select output_payload_id from public.ai_steps where user_id=r.user_id and run_id=r.id union
          select context_payload_id from public.ai_steps where user_id=r.user_id and run_id=r.id union
          select continuation_payload_id from public.ai_steps where user_id=r.user_id and run_id=r.id union
          select usage_payload_id from public.ai_steps where user_id=r.user_id and run_id=r.id);
        delete from public.usage_reservations where user_id=r.user_id and run_id=r.id;
        delete from public.ai_steps where user_id=r.user_id and run_id=r.id;
        delete from public.ai_runs where user_id=r.user_id and id=r.id;
        removed:=removed+1;
      end if;
      work:=work+1;exit when work>=p_batch_size;
    end loop;
    exit when work>=p_batch_size;
  end loop;
  return jsonb_build_object('workCount',work,'interrupted',interrupted,'conservative',conservative,'runsRemoved',removed);
end;
$$;
revoke all on function public.fence_removed_run_v1(),public.fence_deleting_account_v1(),public.reconcile_runs_v1(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.reconcile_runs_v1(uuid,integer) to service_role;
commit;

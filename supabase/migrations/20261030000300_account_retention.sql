begin;
create index deletion_receipts_retention on public.account_deletion_receipts(completed_at,user_id) where phase='completed';
create function public.cleanup_account_retention_v1(p_batch_size integer default 100) returns jsonb language plpgsql security definer set search_path='' as $$
declare owner_id uuid; candidate uuid; proposals integer:=0; receipts integer:=0;
begin
 if p_batch_size is null or p_batch_size not between 1 and 100 then raise exception 'invalid_batch_size'; end if;
 for owner_id in select p.user_id from public.profiles p where exists(select 1 from public.action_proposals a where a.user_id=p.user_id and a.state='pending' and a.expires_at<=clock_timestamp()) order by p.user_id limit p_batch_size for update of p skip locked loop
  for candidate in select id from public.action_proposals where user_id=owner_id and state='pending' and expires_at<=clock_timestamp() order by expires_at,id limit p_batch_size-proposals for update loop
   update public.action_proposals set state='expired',canonical_payload=null where id=candidate;
   proposals:=proposals+1;
  end loop;
  exit when proposals>=p_batch_size;
 end loop;
 -- A full extra day beyond the maximum encrypted backup lifetime protects rotation boundaries.
 with candidates as(select user_id from public.account_deletion_receipts where phase='completed' and completed_at<clock_timestamp()-interval '31 days' order by completed_at,user_id limit p_batch_size for update skip locked)
  delete from public.account_deletion_receipts where user_id in(select user_id from candidates);
 get diagnostics receipts=row_count;
 return jsonb_build_object('proposalsExpired',proposals,'receiptsRemoved',receipts,'unfinished',
  exists(select 1 from public.action_proposals where state='pending' and expires_at<=clock_timestamp()) or
  exists(select 1 from public.account_deletion_receipts where phase='completed' and completed_at<clock_timestamp()-interval '31 days'));
end;
$$;
create function public.pending_account_deletions_v1(p_batch_size integer default 100) returns setof uuid language plpgsql security definer set search_path='' as $$
begin
 if p_batch_size is null or p_batch_size not between 1 and 100 then raise exception 'invalid_batch_size'; end if;
 return query select d.user_id from public.account_deletion_receipts d where d.phase<>'completed' and
 (d.outcome<>'waiting_for_accounting' or not exists(select 1 from public.usage_reservations v where v.user_id=d.user_id and v.status<>'settled')
  or exists(select 1 from public.usage_reservations v where v.user_id=d.user_id and (v.status='reserved' or v.status='pending' and v.uncertain_since+interval '24 hours'<=clock_timestamp()))) order by d.updated_at,d.user_id limit p_batch_size;
end;
$$;
revoke all on function public.cleanup_account_retention_v1(integer),public.pending_account_deletions_v1(integer) from public,anon,authenticated,service_role;
grant execute on function public.cleanup_account_retention_v1(integer),public.pending_account_deletions_v1(integer) to service_role;
commit;

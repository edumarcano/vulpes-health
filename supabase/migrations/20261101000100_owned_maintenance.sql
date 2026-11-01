begin;

-- Default inspection is read-only. Every mutation requires a non-null owner.
create function public.maintain_account_v1(p_owner uuid,p_execute boolean default false,p_batch_size integer default 100) returns jsonb
language plpgsql security definer set search_path='' as $$
declare candidate uuid; proposals integer:=0; receipts integer:=0; profile_present boolean; busy boolean:=false;
 payload_result jsonb:='{"payloadsRemoved":0,"batchesExpired":0,"workCount":0}';
 run_result jsonb:='{"interrupted":0,"conservative":0,"runsRemoved":0,"workCount":0}';
 payloads_due bigint; imports_due bigint; proposals_due bigint; runs_due bigint; receipts_due bigint; deletion_pending boolean; pending_holds bigint; retry_after timestamptz;
begin
 if p_owner is null then raise exception 'owner_required'; end if;
 if p_execute is null then raise exception 'execution_mode_required'; end if;
 if p_batch_size is null or p_batch_size not between 1 and 100 then raise exception 'invalid_batch_size'; end if;
 if p_execute then
  select exists(select 1 from public.profiles where user_id=p_owner) into profile_present;
  perform 1 from public.profiles where user_id=p_owner for update skip locked;
  busy:=profile_present and not found;
  if not busy then
   -- Preserve the established profile -> run/bucket and profile -> payload order.
   run_result:=public.reconcile_runs_v1(p_owner,p_batch_size);
   payload_result:=public.cleanup_data_v1(p_owner,p_batch_size);
   for candidate in select id from public.action_proposals where user_id=p_owner and state='pending' and expires_at<=clock_timestamp()
    order by expires_at,id limit p_batch_size for update skip locked loop
    update public.action_proposals set state='expired',canonical_payload=null where id=candidate and user_id=p_owner;
    proposals:=proposals+1;
   end loop;
   -- Retain unfinished receipts and a full day beyond the 30-day backup ceiling.
   with candidates as(select user_id from public.account_deletion_receipts where user_id=p_owner and phase='completed'
    and completed_at<clock_timestamp()-interval '31 days' for update skip locked)
    delete from public.account_deletion_receipts where user_id=p_owner and user_id in(select user_id from candidates);
   get diagnostics receipts=row_count;
  end if;
 end if;
 select count(*) into payloads_due from public.private_payloads where user_id=p_owner and expires_at<=clock_timestamp();
 select count(*) into imports_due from public.import_batches where user_id=p_owner and status='previewed' and expires_at<=clock_timestamp();
 select count(*) into proposals_due from public.action_proposals where user_id=p_owner and state='pending' and expires_at<=clock_timestamp();
 select count(*) into runs_due from public.ai_runs a where a.user_id=p_owner and
  ((a.status in ('admitted','running','cancellation_requested') and least(a.deadline_at,a.lease_expires_at)<=clock_timestamp())
   or a.expires_at<=clock_timestamp()
   or exists(select 1 from public.usage_reservations v where v.user_id=p_owner and v.run_id=a.id and v.status='pending' and v.uncertain_since+interval '24 hours'<=clock_timestamp()));
 select count(*) into receipts_due from public.account_deletion_receipts where user_id=p_owner and phase='completed' and completed_at<clock_timestamp()-interval '31 days';
 select exists(select 1 from public.account_deletion_receipts where user_id=p_owner and phase<>'completed') into deletion_pending;
 select count(*),min(uncertain_since+interval '24 hours') into pending_holds,retry_after from public.usage_reservations where user_id=p_owner and status='pending';
 return jsonb_build_object('executed',p_execute and not busy,'busy',busy,'payloadsRemoved',(payload_result->>'payloadsRemoved')::integer,
  'batchesExpired',(payload_result->>'batchesExpired')::integer,'proposalsExpired',proposals,'receiptsRemoved',receipts,
  'interrupted',(run_result->>'interrupted')::integer,'conservative',(run_result->>'conservative')::integer,'runsRemoved',(run_result->>'runsRemoved')::integer,
  'payloadsDue',payloads_due,'importsDue',imports_due,'proposalsDue',proposals_due,'runsDue',runs_due,'receiptsDue',receipts_due,
  'deletionPending',deletion_pending,'pendingHolds',pending_holds,'retryAfter',retry_after,'unfinished',busy or deletion_pending or payloads_due+imports_due+proposals_due+runs_due+receipts_due>0);
end;
$$;
revoke all on function public.maintain_account_v1(uuid,boolean,integer) from public,anon,authenticated,service_role;
grant execute on function public.maintain_account_v1(uuid,boolean,integer) to service_role;
commit;

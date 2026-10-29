begin;
create function public.invalidate_goal_drafts_v1() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.data_revision is distinct from old.data_revision then
  update public.action_proposals set state='conflicted',canonical_payload=null where user_id=new.user_id and state='pending' and payload_version=2 and (canonical_payload->>'reviewedDataRevision')::bigint<>new.data_revision;
 end if;
 return new;
end;
$$;
revoke all on function public.invalidate_goal_drafts_v1() from public,anon,authenticated,service_role;
create trigger invalidate_goal_drafts after update of data_revision on public.profiles for each row execute function public.invalidate_goal_drafts_v1();
alter policy owner_read on public.action_proposals using ((select auth.uid()) is not null and (select auth.uid())=user_id and (state<>'pending' or expires_at>clock_timestamp()));
commit;

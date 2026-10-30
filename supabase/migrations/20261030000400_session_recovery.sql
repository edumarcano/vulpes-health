begin;
-- GoTrue access JWTs can outlive refresh/session revocation. Check the owned session too.
create function public.owned_session_valid_v1() returns boolean language sql stable security definer set search_path='' as $$
 select auth.uid() is not null and exists(select 1 from auth.sessions s where s.user_id=auth.uid() and s.id=(auth.jwt()->>'session_id')::uuid);
$$;
create function public.enforce_owned_session_v1() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if auth.role()='authenticated' and not public.owned_session_valid_v1() then raise exception 'session_revoked' using errcode='PT401'; end if;
 if tg_op='DELETE' then return old; end if;
 return new;
end;
$$;
do $$ declare t text; begin
 foreach t in array array['profiles','data_sources','measurements','import_batches','goals','goal_revisions','action_proposals','messages','conversations','ai_runs','ai_steps','private_payloads','usage_buckets','usage_reservations','audit_events'] loop
  execute format('create trigger enforce_owned_session before insert or update or delete on public.%I for each row execute function public.enforce_owned_session_v1()',t);
 end loop;
 foreach t in array array['profiles','data_sources','import_batches','measurements','goals','goal_revisions','conversations','messages','action_proposals','ai_runs','ai_steps'] loop
  execute format('create policy live_session on public.%I as restrictive for select to authenticated using ((select public.owned_session_valid_v1()))',t);
 end loop;
end $$;
create function public.revoke_account_sessions_v1(p_owner uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.profiles where user_id=p_owner and account_state='active' for update;
 if not found then raise exception 'account_unavailable'; end if;
 delete from auth.refresh_tokens where user_id=p_owner::text;
 delete from auth.sessions where user_id=p_owner;
end;
$$;
revoke all on function public.owned_session_valid_v1(),public.enforce_owned_session_v1(),public.revoke_account_sessions_v1(uuid) from public,anon,authenticated,service_role;
grant execute on function public.owned_session_valid_v1() to authenticated;
grant execute on function public.revoke_account_sessions_v1(uuid) to service_role;
commit;

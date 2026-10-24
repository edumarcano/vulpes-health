begin;

revoke create on schema public from public, anon, authenticated;
-- PostgreSQL's built-in PUBLIC EXECUTE default is global; a schema-local
-- REVOKE cannot remove it. Feature functions must grant execution explicitly.
alter default privileges for role postgres revoke execute on functions from public;
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated, service_role;
alter default privileges for role postgres in schema public revoke execute on functions from public, anon, authenticated, service_role;

do $$
declare
  table_name text;
begin
  foreach table_name in array array[
    'profiles', 'data_sources', 'import_batches', 'measurements', 'goals',
    'goal_revisions', 'conversations', 'messages', 'action_proposals', 'ai_runs',
    'ai_steps', 'private_payloads', 'usage_buckets', 'usage_reservations', 'audit_events'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', table_name);
    execute format('grant select, insert, delete on table public.%I to service_role', table_name);
    if table_name <> 'goal_revisions' then
      execute format('grant update on table public.%I to service_role', table_name);
    end if;
    if table_name not in ('private_payloads', 'usage_buckets', 'usage_reservations', 'audit_events') then
      execute format('grant select on table public.%I to authenticated', table_name);
      execute format('create policy owner_read on public.%I for select to authenticated using ((select auth.uid()) is not null and (select auth.uid()) = user_id)', table_name);
    end if;
  end loop;
end;
$$;

-- Future feature RPCs must add their own narrow grants. None are exposed here.
commit;

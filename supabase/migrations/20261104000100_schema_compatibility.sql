-- Read-only deployment metadata. No health data or schema mutation is exposed.
create or replace function public.schema_version_v1()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select pg_catalog.jsonb_build_object(
    'versions', coalesce(pg_catalog.jsonb_agg(version order by version), '[]'::jsonb)
  )
  from supabase_migrations.schema_migrations;
$$;

revoke all on function public.schema_version_v1() from public, anon, authenticated;
grant execute on function public.schema_version_v1() to service_role;

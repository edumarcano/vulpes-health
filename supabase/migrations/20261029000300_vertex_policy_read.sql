begin;
create function public.read_vertex_policy_v1(p_project text,p_location text) returns jsonb
language sql stable security definer set search_path='' as $$
 select jsonb_build_object('version',policy_version,'acceptanceAvailable',true,'notice',notice)
 from public.vertex_policy_approval where id and project=p_project and location=p_location and auth.uid() is not null;
$$;
revoke all on function public.read_vertex_policy_v1(text,text) from public,anon;
grant execute on function public.read_vertex_policy_v1(text,text) to authenticated;
commit;

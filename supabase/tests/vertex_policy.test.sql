begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select ok((select relrowsecurity from pg_class where oid='public.vertex_policy_approval'::regclass),'Google approval uses RLS');
select ok(not has_table_privilege(role_name,'public.vertex_policy_approval',privilege),role_name||' cannot '||privilege||' Google approval')
from unnest(array['anon','authenticated']) role_name cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) privilege;
select ok(not has_function_privilege(role_name,'public.handoff_flash_v1(uuid,uuid,uuid,bigint,uuid,text)','EXECUTE'),role_name||' cannot hand off') from unnest(array['anon','authenticated']) role_name;
select ok(has_function_privilege('service_role','public.handoff_flash_v1(uuid,uuid,uuid,bigint,uuid,text)','EXECUTE'),'only service owns handoff');
select is((select count(*) from public.vertex_policy_approval),0::bigint,'migration installs no Google approval');
select ok(has_function_privilege('authenticated','public.read_vertex_policy_v1(text,text)','EXECUTE'),'authenticated can read matching safe policy notice');
select ok(not has_function_privilege('anon','public.read_vertex_policy_v1(text,text)','EXECUTE'),'anonymous cannot inspect policy');
select * from finish();
rollback;

begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select ok((select relrowsecurity from pg_class where oid='public.ai_route_cost_blocks'::regclass),'durable route blocks use RLS');
select ok(not has_table_privilege(role_name,'public.ai_route_cost_blocks',privilege),role_name||' cannot '||privilege||' route blocks')
from unnest(array['anon','authenticated','service_role']) role_name cross join unnest(array['INSERT','UPDATE','DELETE']) privilege;
select ok(not has_table_privilege(role_name,'public.ai_route_cost_blocks','SELECT'),role_name||' cannot read route blocks') from unnest(array['anon','authenticated']) role_name;
select ok(has_table_privilege('service_role','public.ai_route_cost_blocks','SELECT'),'service can inspect route blocks');
select ok(not has_function_privilege(role_name,signature,'EXECUTE'),role_name||' cannot invoke '||signature)
from unnest(array['anon','authenticated','service_role']) role_name cross join unnest(array['public.record_route_cost_block_v1()','public.enforce_route_cost_block_v1()']) signature;
select * from finish();
rollback;

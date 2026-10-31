begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select ok(not has_function_privilege(role_name,'public.private_payload_expiry_v1(text)','EXECUTE'),role_name||' cannot mint payload expiry')
 from unnest(array['anon','authenticated']) role_name;
select ok(has_function_privilege('service_role','public.private_payload_expiry_v1(text)','EXECUTE'),'trusted capture can obtain database expiry');
select ok(public.private_payload_expiry_v1(purpose)<=clock_timestamp()+interval '7 days'
 and public.private_payload_expiry_v1(purpose)>clock_timestamp()+interval '7 days'-interval '1 second',purpose||' expiry uses database seven-day bound')
 from unnest(array['ai_request','ai_response','tool_input','tool_output','provider_state']) purpose;
select ok(public.private_payload_expiry_v1('import_staging')<=clock_timestamp()+interval '24 hours'
 and public.private_payload_expiry_v1('import_staging')>clock_timestamp()+interval '24 hours'-interval '1 second','staging expiry uses database 24-hour bound');
select is(public.private_payload_expiry_v1('unknown'),null::timestamptz,'unknown purpose cannot obtain expiry');
select ok(not has_function_privilege(role_name,'public.bind_vertex_step_policy_v1()','EXECUTE'),role_name||' cannot invoke policy binding trigger')
 from unnest(array['anon','authenticated','service_role']) role_name;
select ok(exists(select 1 from pg_policies where schemaname='public' and tablename='action_proposals' and policyname='unexpired_pending_proposal' and permissive='RESTRICTIVE'),'proposal expiry restricts all authenticated row reads');
select * from finish();
rollback;

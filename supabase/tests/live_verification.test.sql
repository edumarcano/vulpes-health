begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select ok((select relrowsecurity from pg_class where oid='public.live_verification_allocations'::regclass),'verification allocations use RLS');
select ok(not has_table_privilege(role_name,'public.live_verification_allocations',privilege),role_name||' cannot '||privilege||' allocations')
from unnest(array['anon','authenticated']) role_name cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) privilege;
select ok(has_table_privilege('service_role','public.live_verification_allocations','SELECT'),'service can read allocations');
select ok(has_table_privilege('service_role','public.live_verification_allocations','INSERT'),'service can register allocations');
select ok(not has_table_privilege('service_role','public.live_verification_allocations','UPDATE'),'service cannot replenish allocations');
select ok(not has_table_privilege('service_role','public.live_verification_allocations','DELETE'),'service cannot discard allocations');
insert into auth.users(id,email) values ('10000000-0000-4000-8000-000000000001','pr03-10000000-0000-4000-8000-000000000001@example.test');
insert into public.profiles(user_id,display_name) values ('10000000-0000-4000-8000-000000000001','Synthetic verification');
insert into public.usage_buckets(id,user_id,scope,period_start,allocated_ceiling_usd) values
 ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','account',date_trunc('month',clock_timestamp() at time zone 'UTC')::date,0.03);
insert into public.usage_buckets(id,scope,period_start,allocated_ceiling_usd) values
 ('20000000-0000-4000-8000-000000000002','app',date_trunc('month',clock_timestamp() at time zone 'UTC')::date,1);
select throws_ok($q$insert into public.live_verification_allocations(id,user_id,account_bucket_id,period_start,ceiling_usd,data_revision,fixture_hash)
 values ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',date_trunc('month',clock_timestamp() at time zone 'UTC')::date,1,0,repeat('a',64))$q$,'P0001','verification_allocation_invalid','allocation cannot exceed its configured account ceiling');
update public.profiles set display_name='Other account' where user_id='10000000-0000-4000-8000-000000000001';
select throws_ok($q$insert into public.live_verification_allocations(id,user_id,account_bucket_id,period_start,ceiling_usd,data_revision,fixture_hash)
 values ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',date_trunc('month',clock_timestamp() at time zone 'UTC')::date,0.03,0,repeat('a',64))$q$,'P0001','verification_allocation_invalid','non-synthetic profile cannot be registered');
update public.profiles set display_name='Synthetic verification' where user_id='10000000-0000-4000-8000-000000000001';
insert into public.live_verification_allocations(id,user_id,account_bucket_id,period_start,ceiling_usd,data_revision,fixture_hash)
 values ('30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001',date_trunc('month',clock_timestamp() at time zone 'UTC')::date,0.03,0,repeat('a',64));
-- Even if an operator raises the ordinary account ceiling, the fixed batch
-- ceiling remains authoritative for its reservations.
update public.usage_buckets set allocated_ceiling_usd=1 where id='20000000-0000-4000-8000-000000000001';
insert into public.conversations(id,user_id,title) values ('40000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','Synthetic');
insert into public.ai_runs(id,user_id,conversation_id,client_request_id,request_hash,requested_depth,policy_version) values
 ('50000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','40000000-0000-4000-8000-000000000001','60000000-0000-4000-8000-000000000001',repeat('a',64),'everyday','synthetic');
insert into public.ai_steps(id,user_id,run_id,sequence,step_type,status) values
 ('70000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',1,'generation','started'),
 ('70000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001',2,'generation','started');
update public.usage_buckets set reserved_usd=0.022 where id='20000000-0000-4000-8000-000000000001';
insert into public.usage_reservations(user_id,run_id,step_id,account_bucket_id,app_bucket_id,period_start,amount_usd,status)
 values ('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',date_trunc('month',clock_timestamp() at time zone 'UTC')::date,0.022,'pending');
select throws_ok($q$do $body$ begin
 update public.usage_buckets set reserved_usd=reserved_usd+0.022 where id='20000000-0000-4000-8000-000000000001';
 insert into public.usage_reservations(user_id,run_id,step_id,account_bucket_id,app_bucket_id,period_start,amount_usd)
 values ('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',date_trunc('month',clock_timestamp() at time zone 'UTC')::date,0.022);
 end $body$$q$,'P0001','budget_exhausted','uncertain hold prevents a second over-ceiling reservation');
select is((select reserved_usd from public.usage_buckets where id='20000000-0000-4000-8000-000000000001'),0.022::numeric,'failed reservation rolls back its bucket increment');
insert into public.usage_buckets(id,user_id,scope,period_start,allocated_ceiling_usd) values
 ('20000000-0000-4000-8000-000000000003','10000000-0000-4000-8000-000000000001','account',(date_trunc('month',clock_timestamp() at time zone 'UTC')+interval '1 month')::date,1);
insert into public.usage_buckets(id,scope,period_start,allocated_ceiling_usd) values
 ('20000000-0000-4000-8000-000000000004','app',(date_trunc('month',clock_timestamp() at time zone 'UTC')+interval '1 month')::date,1);
select throws_ok($q$insert into public.usage_reservations(user_id,run_id,step_id,account_bucket_id,app_bucket_id,period_start,amount_usd)
 values ('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000003','20000000-0000-4000-8000-000000000004',(date_trunc('month',clock_timestamp() at time zone 'UTC')+interval '1 month')::date,0.001)$q$,'P0001','budget_exhausted','a new accounting month cannot replenish a verification allocation');
update public.profiles set data_revision=1 where user_id='10000000-0000-4000-8000-000000000001';
select throws_ok($q$insert into public.usage_reservations(user_id,run_id,step_id,account_bucket_id,app_bucket_id,period_start,amount_usd)
 values ('10000000-0000-4000-8000-000000000001','50000000-0000-4000-8000-000000000001','70000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000002',date_trunc('month',clock_timestamp() at time zone 'UTC')::date,0.001)$q$,'P0001','verification_fixture_changed','changed synthetic data cannot enter the allocation');
select * from finish();
rollback;

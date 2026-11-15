begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create temporary table analysis_fixture as select gen_random_uuid() owner_id, gen_random_uuid() foreign_id, gen_random_uuid() source_id, gen_random_uuid() foreign_source;
grant select on analysis_fixture to authenticated;
insert into auth.users(id,email)
 select owner_id,'analysis-a-'||owner_id||'@example.test' from analysis_fixture
 union all select foreign_id,'analysis-b-'||foreign_id||'@example.test' from analysis_fixture;
insert into public.profiles(user_id,display_name)
 select owner_id,'Synthetic analysis A' from analysis_fixture
 union all select foreign_id,'Synthetic analysis B' from analysis_fixture;
insert into public.data_sources(id,user_id,kind,label,source_namespace)
 select source_id,owner_id,'manual','Synthetic analysis','synthetic-analysis' from analysis_fixture
 union all select foreign_source,foreign_id,'manual','Synthetic foreign','synthetic-analysis' from analysis_fixture;
insert into auth.sessions(id,user_id) select owner_id,owner_id from analysis_fixture;
create temporary table analysis_queries as select jsonb_build_object(
 'mode','rows','source_id',source_id,'metric','weight','method','unknown','granularity','instant','timezone','UTC',
 'windows',jsonb_build_array(jsonb_build_object('from','2026-09-01T00:00:00Z','to','2026-09-15T00:00:00Z'))
) q from analysis_fixture;
grant select on analysis_queries to authenticated;

select ok(not has_function_privilege('anon','public.read_analysis_v1(jsonb)','execute'),'anonymous analysis is denied');
select ok(not has_function_privilege('service_role','public.read_analysis_v1(jsonb)','execute'),'analysis requires an authenticated owner');
set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',(select owner_id from analysis_fixture),'role','authenticated','session_id',(select owner_id from analysis_fixture))::text,true);
select throws_ok('select public.read_analysis_v1(null)', '22023','invalid_analysis','null batch is rejected');
select throws_ok('select public.read_analysis_v1(''[]''::jsonb)', '22023','invalid_analysis','empty batch is rejected');
select throws_ok(format('select public.read_analysis_v1(%L::jsonb)',(select jsonb_build_array(q-'timezone') from analysis_queries)), '22023','invalid_analysis','missing timezone cannot bypass window validation');
select throws_ok(format('select public.read_analysis_v1(%L::jsonb)',(select jsonb_build_array(q||jsonb_build_object('source_id',foreign_source)) from analysis_queries cross join analysis_fixture)), 'PT404','data_not_found','existing foreign source is denied');
select throws_ok('select public.read_metric_inventory_v2(201)', '22023','invalid_analysis','direct inventory page limit is enforced');
select throws_ok('select public.read_metric_inventory_v2(1,null,1000000)', 'PT409','data_conflict','stale inventory revision is rejected');
reset role;

insert into public.measurements(user_id,source_id,metric_key,canonical_value,canonical_unit,original_value,original_unit,observed_at,granularity,fingerprint)
 select owner_id,source_id,'weight',70,'kg','70','kg','2026-09-01T00:00:00Z'::timestamptz + make_interval(secs=>i),'instant',md5(i::text)||md5(i::text)
 from analysis_fixture cross join generate_series(1,12500) i;
set local role authenticated;
select is((select jsonb_array_length(public.read_analysis_v1(jsonb_build_array(q,q))->'snapshots') from analysis_queries),2,'combined 25000-row boundary succeeds');
reset role;
insert into public.measurements(user_id,source_id,metric_key,canonical_value,canonical_unit,original_value,original_unit,observed_at,granularity,fingerprint)
 select owner_id,source_id,'weight',70,'kg','70','kg','2026-09-01T04:00:00Z','instant',repeat('f',64) from analysis_fixture;
set local role authenticated;
select throws_ok(format('select public.read_analysis_v1(%L::jsonb)',(select jsonb_build_array(q,q) from analysis_queries)), '54000','analysis_limit','combined batch budget rejects excess rather than returning partial rows');
reset role;
select * from finish();
rollback;

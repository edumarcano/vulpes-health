begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create temporary table timestamp_fixture as
  select gen_random_uuid() owner_id, gen_random_uuid() source_id, gen_random_uuid() reading_id;
grant select on timestamp_fixture to authenticated;
insert into auth.users(id,email) select owner_id,'timestamp-'||owner_id||'@example.test' from timestamp_fixture;
insert into public.profiles(user_id,display_name) select owner_id,'Synthetic timestamp test' from timestamp_fixture;
insert into public.data_sources(id,user_id,kind,label,source_namespace)
  select source_id,owner_id,'manual','Synthetic timestamp source','synthetic-timestamp' from timestamp_fixture;
insert into public.measurements(id,user_id,source_id,metric_key,canonical_value,canonical_unit,original_value,original_unit,observed_at,granularity,fingerprint)
  select reading_id,owner_id,source_id,'weight',70,'kg','70','kg','2026-09-01T23:59:59.123456Z','instant',repeat('a',64) from timestamp_fixture;

set local role authenticated;
select set_config('request.jwt.claims',json_build_object('sub',(select owner_id from timestamp_fixture),'role','authenticated')::text,true);
select throws_ok(format('select public.add_measurement_v1(%L::jsonb)',jsonb_build_object(
  'action','add_measurement','client_request_id',gen_random_uuid(),
  'source',jsonb_build_object('kind','new','label','Synthetic rejected source','origin_app',null,'device_label',null),
  'observation',jsonb_build_object('metric','weight','value','70','unit','kg','observed_at',bad_time,'timezone','UTC','local_date',null,'granularity','instant','method','device_reported','quality_flags','[]'::jsonb)
)), '22023','invalid_measurement','direct entry rejects second 60: '||bad_time)
from unnest(array['2026-09-01T23:59:60Z','2026-09-01T23:59:60.123456+00:00','2026-09-01T23:59:60-04:00']) bad_time;
select throws_ok(format('select public.mutate_measurement_v1(%L::jsonb)',jsonb_build_object(
  'action','correct_measurement','client_request_id',gen_random_uuid(),'measurement_id',reading_id,'expected_version',1,
  'changes',jsonb_build_object('value','69','unit','kg','observed_at',bad_time,'timezone','UTC','local_date',null)
)), '22023','invalid_measurement','direct correction rejects second 60: '||bad_time)
from timestamp_fixture cross join unnest(array['2026-09-01T23:59:60Z','2026-09-01T23:59:60.123456+00:00','2026-09-01T23:59:60-04:00']) bad_time;
select is((select data_revision from public.profiles),0::bigint,'rejected times leave the revision unchanged');
select is((select count(*) from public.data_sources),1::bigint,'rejected entry creates no source');
select is((select count(*) from public.measurements),1::bigint,'rejected entry creates no reading');
select is((select version from public.measurements where id=(select reading_id from timestamp_fixture)),1,'rejected correction leaves the version unchanged');
select is((select observed_at from public.measurements where id=(select reading_id from timestamp_fixture)),'2026-09-01T23:59:59.123456Z'::timestamptz,'rejected correction preserves the original instant');
reset role;
select * from finish();
rollback;

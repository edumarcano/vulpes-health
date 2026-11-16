begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

select ok(not has_function_privilege(role_name,signature,'execute'),signature||' denies '||role_name)
 from unnest(array['anon','authenticated','service_role']) role_name cross join unnest(array[
 'public.apply_goal_payload_v2(uuid,uuid,text,uuid,integer,jsonb)',
 'public.goal_group_payload_valid_v1(uuid,jsonb)',
 'public.check_goal_group_members_v1(uuid,jsonb)'
 ]) signature;
select ok(not has_function_privilege(role_name,signature,'execute'),signature||' denies '||role_name)
 from unnest(array['anon','authenticated']) role_name cross join unnest(array['public.register_goal_group_proposal_v1(uuid,jsonb,jsonb)','public.decide_goal_group_proposal_v1(uuid,jsonb)']) signature;
select ok(has_function_privilege('service_role',signature,'execute'),signature||' is service-only')
 from unnest(array['public.register_goal_group_proposal_v1(uuid,jsonb,jsonb)','public.decide_goal_group_proposal_v1(uuid,jsonb)']) signature;

create temporary table atomic_group_fixture as select gen_random_uuid() owner_id,gen_random_uuid() source_id;
insert into auth.users(id,email) select owner_id,'atomic-group-'||owner_id||'@example.test' from atomic_group_fixture;
insert into public.profiles(user_id) select owner_id from atomic_group_fixture;
insert into public.data_sources(id,user_id,kind,label,source_namespace) select source_id,owner_id,'manual','Synthetic atomic group',gen_random_uuid()::text from atomic_group_fixture;
create temporary table atomic_group_children as
 select f.owner_id,v.position,jsonb_build_object('schemaVersion',2,'state','active','baselineResolution','replace','reviewedDataRevision',0,
  'definition',jsonb_build_object('schemaVersion',1,'title',v.title,'metric','renpho.muscle_mass','unit','kg','sourceId',f.source_id,
  'target',jsonb_build_object('direction','increase_to','value',51),'baselineMethod','user_reported','reportedBaseline',50,'baselineFrom',null,'baselineTo',null,
  'timezone','UTC','targetDate',null,'constraints','[]'::jsonb,'proposedStrategy',null,'method','device_estimate','granularity','instant','currentMethod','latest_value'),
  'baseline',jsonb_build_object('schemaVersion',2,'selection',jsonb_build_object('metric','renpho.muscle_mass','source_id',f.source_id,'method','device_estimate','granularity','instant','timezone','UTC','from','2026-09-01T00:00:00Z','to','2026-09-08T00:00:00Z'),
   'value','50','dataRevision',0,'algorithmVersion','user_reported_v1','provenance','user_reported','references','[]'::jsonb)) payload
 from atomic_group_fixture f cross join (values(1,'Synthetic first child'),(2,'Synthetic late failure')) v(position,title);
create temporary table atomic_group_root as select f.owner_id,jsonb_build_object('schemaVersion',3,'name','Synthetic atomic reviewed group','state','active','reviewedDataRevision',0,
 'members',(select jsonb_agg(jsonb_build_object('kind','create','payload',c.payload) order by c.position) from atomic_group_children c)) payload from atomic_group_fixture f;
select is(public.goal_group_payload_valid_v1(owner_id,payload),true,'valid bounded parent admits all ordinary child definitions') from atomic_group_root;
select is(public.goal_group_payload_valid_v1(owner_id,jsonb_set(payload,'{members}',(payload->'members')|| (payload->'members')||jsonb_build_array(payload#>'{members,0}'))),false,'five-member parent is rejected') from atomic_group_root;
select is(public.goal_group_payload_valid_v1(owner_id,jsonb_set(payload,'{reviewedDataRevision}','null')),false,'null data revision cannot bypass validation') from atomic_group_root;
create temporary table atomic_group_pending as select r.*,public.register_goal_group_proposal_v1(owner_id,jsonb_build_object('action','propose_group_create','client_request_id',gen_random_uuid()),payload) proposal_id from atomic_group_root r;

create function pg_temp.reject_last_group_child() returns trigger language plpgsql as $$
begin
 if new.title='Synthetic late failure' then raise exception 'synthetic_group_last_failure'; end if;
 return new;
end;
$$;
create trigger synthetic_group_late_failure before insert on public.goals for each row execute function pg_temp.reject_last_group_child();
select throws_ok(format('select public.decide_goal_group_proposal_v1(%L,%L::jsonb)',f.owner_id,
 jsonb_build_object('action','approve','client_request_id',gen_random_uuid(),'proposal_id',p.id,'payload_hash',p.payload_hash,'expected_version',null)),
 'P0001','synthetic_group_last_failure','failure while inserting last child rolls back earlier child application')
 from atomic_group_pending f join public.action_proposals p on p.id=f.proposal_id;
select is((select count(*) from public.goals where user_id=(select owner_id from atomic_group_fixture)),0::bigint,'no partially activated child survives');
select is((select count(*) from public.goal_revisions where user_id=(select owner_id from atomic_group_fixture)),0::bigint,'no partial revision survives');
select is((select count(*) from public.goal_groups where user_id=(select owner_id from atomic_group_fixture)),0::bigint,'no partial group survives');
select is((select state from public.action_proposals where id=(select proposal_id from atomic_group_pending)),'pending','failed approval preserves pending parent for retry');
drop trigger synthetic_group_late_failure on public.goals;
select lives_ok(format('select public.decide_goal_group_proposal_v1(%L,%L::jsonb)',f.owner_id,
 jsonb_build_object('action','approve','client_request_id',gen_random_uuid(),'proposal_id',p.id,'payload_hash',p.payload_hash,'expected_version',null)),
 'unchanged parent succeeds after transient application failure is removed') from atomic_group_pending f join public.action_proposals p on p.id=f.proposal_id;
select is((select count(*) from public.goal_revisions where user_id=(select owner_id from atomic_group_fixture)),2::bigint,'one parent approves both ordinary revisions');
select is((select count(*) from public.goal_group_members where user_id=(select owner_id from atomic_group_fixture)),2::bigint,'one group contains both reviewed members');
select throws_ok(format('delete from public.goal_group_members where user_id=%L;set constraints all immediate;',owner_id),'23514','invalid_group_cardinality','active group cannot become empty through direct database mutation') from atomic_group_fixture;
select throws_ok(format('delete from public.goals where user_id=%L',owner_id),'23503',null,'required members cannot be hard-deleted') from atomic_group_fixture;

-- An unexpired session must not expose group data during bounded deletion.
insert into auth.sessions(id,user_id) select owner_id,owner_id from atomic_group_fixture;
select public.begin_account_deletion_v1(owner_id,clock_timestamp()) from atomic_group_fixture;
select set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated','session_id',owner_id)::text,true) from atomic_group_fixture;
set local role authenticated;
select is((select count(*) from public.goal_groups),0::bigint,'deletion fence hides groups before physical purge');
select is((select count(*) from public.goal_group_members),0::bigint,'deletion fence hides membership before physical purge');
reset role;

select * from finish();
rollback;

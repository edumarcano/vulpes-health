begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();

create temporary table group_fixture as select n,gen_random_uuid() owner_id,gen_random_uuid() source_id,gen_random_uuid() group_id,gen_random_uuid() current_proposal,gen_random_uuid() historical_proposal
 from generate_series(1,2) n;
insert into auth.users(id,email) select owner_id,'group-lifecycle-'||owner_id||'@example.test' from group_fixture;
insert into public.profiles(user_id,display_name) select owner_id,'Synthetic group lifecycle' from group_fixture;
insert into public.data_sources(id,user_id,kind,label,source_namespace) select source_id,owner_id,'manual','Synthetic group source','group-lifecycle' from group_fixture;
insert into public.goal_groups(id,user_id,name,state) select group_id,owner_id,'Synthetic reviewed group','archived' from group_fixture;
create temporary table group_children as
 select f.*,v.position,v.metric,v.unit,v.value,gen_random_uuid() goal_id,gen_random_uuid() revision_id,gen_random_uuid() measurement_id,null::jsonb payload
 from group_fixture f cross join (values(1,'renpho.muscle_mass','kg','50'),(2,'body_fat_percent','%','20')) v(position,metric,unit,value);
insert into public.measurements(id,user_id,source_id,metric_key,canonical_value,canonical_unit,original_value,original_unit,observed_at,granularity,measurement_method,fingerprint)
 select measurement_id,owner_id,source_id,metric,value::numeric,unit,value,unit,'2026-09-02T08:00:00Z','instant','device_estimate',md5(measurement_id::text)||md5(measurement_id::text) from group_children;
update group_children set payload=jsonb_build_object('schemaVersion',2,'state','active','baselineResolution','replace','reviewedDataRevision',0,
 'definition',jsonb_build_object('schemaVersion',1,'title','Synthetic member '||position,'metric',metric,'unit',unit,'sourceId',source_id,
 'target',jsonb_build_object('direction','increase_to','value',value::numeric+1),'baselineMethod','latest_value','baselineFrom','2026-09-01T00:00:00Z','baselineTo','2026-09-08T00:00:00Z','reportedBaseline',null,
 'timezone','UTC','targetDate',null,'constraints','[]'::jsonb,'proposedStrategy',null,'method','device_estimate','granularity','instant','currentMethod','latest_value'),
 'baseline',jsonb_build_object('schemaVersion',2,'selection',jsonb_build_object('metric',metric,'source_id',source_id,'method','device_estimate','granularity','instant','timezone','UTC','from','2026-09-01T00:00:00Z','to','2026-09-08T00:00:00Z'),
 'value',value,'dataRevision',0,'algorithmVersion','latest_value_v1','provenance','calculated','references',jsonb_build_array(jsonb_build_object('id',measurement_id,'version',1,'observedAt','2026-09-02T08:00:00Z'))));
insert into public.goals(id,user_id,title,metric_key,canonical_unit,direction,target_value,source_id)
 select goal_id,owner_id,'Synthetic member '||position,metric,unit,'increase_to',value::numeric+1,source_id from group_children;
create temporary table group_roots as select f.*,jsonb_build_object('schemaVersion',3,'name','Synthetic reviewed group','state','active','reviewedDataRevision',0,
 'members',(select jsonb_agg(jsonb_build_object('kind','create','payload',c.payload) order by c.position) from group_children c where c.owner_id=f.owner_id)) payload
 from group_fixture f;
insert into public.action_proposals(id,user_id,kind,payload_version,canonical_payload,payload_hash,summary,state,expires_at,result)
 select current_proposal,owner_id,'goal_group.create',3,payload,encode(sha256(convert_to(payload::text,'UTF8')),'hex'),'Synthetic reviewed group','approved',clock_timestamp()+interval '1 day',
 jsonb_build_object('groupId',group_id,'version',1,'members',(select jsonb_agg(jsonb_build_object('goalId',c.goal_id,'revisionId',c.revision_id,'version',1) order by c.position) from group_children c where c.owner_id=r.owner_id)) from group_roots r;
insert into public.goal_revisions(id,user_id,goal_id,revision_number,approved_proposal_id,payload_version,payload)
 select revision_id,owner_id,goal_id,1,current_proposal,2,payload from group_children;
update public.goals g set state='active',current_revision_id=c.revision_id,baseline_snapshot=c.payload->'baseline' from group_children c where g.id=c.goal_id;
insert into public.goal_group_members(user_id,group_id,goal_id,position,reviewed_goal_version,reviewed_revision_id)
 select owner_id,group_id,goal_id,position,1,revision_id from group_children;
update public.goal_groups g set state='active',current_approval_id=f.current_proposal from group_fixture f where g.id=f.group_id;
insert into public.action_proposals(id,user_id,kind,group_target_id,target_version,payload_version,canonical_payload,payload_hash,summary,state,expires_at)
 select historical_proposal,owner_id,'goal_group.revise',group_id,1,3,payload,encode(sha256(convert_to(payload::text,'UTF8')),'hex'),'Synthetic historical parent','approved',clock_timestamp()+interval '1 day' from group_roots;
create temporary table before_group_privacy as select id,user_id,payload_hash,canonical_payload,private_content_removed_at from public.action_proposals where user_id in(select owner_id from group_fixture);

select public.invalidate_measurement_copies_v2(owner_id,source_id,'renpho.muscle_mass') from group_fixture where n=1;
select is((select count(*) from public.action_proposals p join group_fixture f on p.user_id=f.owner_id where f.n=1 and p.canonical_payload#>'{members,0,payload,baseline,value}'='null'::jsonb and p.canonical_payload#>'{members,0,payload,baseline,references}'='[]'::jsonb),2::bigint,'both current and historical group parents lose affected private baseline values and dated references');
select is((select count(*) from public.action_proposals p join group_fixture f on p.user_id=f.owner_id where f.n=1 and p.canonical_payload#>>'{members,1,payload,baseline,value}'='20' and jsonb_array_length(p.canonical_payload#>'{members,1,payload,baseline,references}')=1),2::bigint,'unaffected metric copies remain intact in the same parents');
select is((select count(*) from public.action_proposals p join before_group_privacy b using(id) join group_fixture f on p.user_id=f.owner_id where f.n=1 and p.payload_hash=b.payload_hash and p.private_content_removed_at is not null),2::bigint,'approval hashes survive with explicit private removal markers');
select is((select count(*) from public.action_proposals p join before_group_privacy b using(id) join group_fixture f on p.user_id=f.owner_id where f.n=2 and p.canonical_payload=b.canonical_payload and p.payload_hash=b.payload_hash and p.private_content_removed_at is null),2::bigint,'foreign group copies and removal markers are unchanged');
select is((select review_status from public.goal_groups where id=(select group_id from group_fixture where n=1)),'needs_review','affected current group requires review');
select is((select version from public.goal_groups where id=(select group_id from group_fixture where n=1)),2,'group invalidation advances its version once');
select public.invalidate_measurement_copies_v2(owner_id,source_id,'renpho.muscle_mass') from group_fixture where n=1;
select is((select version from public.goal_groups where id=(select group_id from group_fixture where n=1)),2,'repeat invalidation does not advance an already invalidated group');
select is((select review_status from public.goal_groups where id=(select group_id from group_fixture where n=2)),'clear','foreign group remains clear');
select is((select count(*) from group_fixture f cross join lateral public.account_export_rows_v1(f.owner_id,'goal_groups') where f.n=1),1::bigint,'account export includes the owned group');
select is((select count(*) from group_fixture f cross join lateral public.account_export_rows_v1(f.owner_id,'goal_group_members') where f.n=1),2::bigint,'account export includes every reviewed member');
select * from finish();
rollback;

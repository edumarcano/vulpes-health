begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create temporary table numeric_goal_owner as select gen_random_uuid() owner_id,gen_random_uuid() source_id;
insert into auth.users(id,email) select owner_id,'numeric-goals-'||owner_id||'@example.test' from numeric_goal_owner;
insert into public.profiles(user_id,display_name) select owner_id,'Synthetic numeric goals' from numeric_goal_owner;
insert into public.data_sources(id,user_id,kind,label,source_namespace) select source_id,owner_id,'manual','Synthetic numeric goals','numeric-goals' from numeric_goal_owner;
create temporary table numeric_goal_metrics(metric text,unit text,method text,granularity text);
insert into numeric_goal_metrics values
 ('weight','kg','device_reported','instant'),('renpho.bmi','kg/m2','device_estimate','instant'),('body_fat_percent','%','device_estimate','instant'),
 ('renpho.body_fat_mass','kg','device_estimate','instant'),('renpho.muscle_percent','%','device_estimate','instant'),('renpho.muscle_mass','kg','device_estimate','instant'),
 ('renpho.skeletal_muscle_percent','%','device_estimate','instant'),('renpho.skeletal_muscle_mass','kg','device_estimate','instant'),
 ('renpho.bone_percent','%','device_estimate','instant'),('renpho.bone_mass','kg','device_estimate','instant'),
 ('renpho.protein_percent','%','device_estimate','instant'),('renpho.protein_mass','kg','device_estimate','instant'),
 ('renpho.body_water_percent','%','device_estimate','instant'),('renpho.body_water_mass','kg','device_estimate','instant'),
 ('renpho.fat_free_mass','kg','device_estimate','instant'),('renpho.subcutaneous_fat_percent','%','device_estimate','instant'),
 ('renpho.visceral_fat_index','index','device_estimate','instant'),('renpho.metabolic_age','years','device_estimate','instant'),
 ('renpho.waist_hip_ratio','ratio','device_estimate','instant'),('renpho.optimal_weight','kg','device_estimate','instant'),
 ('heart_rate','bpm','unknown','instant'),('resting_heart_rate','bpm','unknown','instant'),('height','cm','unknown','instant'),
 ('steps_daily','count','unknown','daily_total'),('sleep_duration','min','unknown','session_total');

select lives_ok(format('insert into public.goals(user_id,title,metric_key,canonical_unit,direction,target_value,target_lower,target_upper,source_id) values(%L,''Synthetic goal'',%L,%L,%L,%s,%s,%s,%L)',
 o.owner_id,m.metric,m.unit,d.direction,case when d.direction='maintain_range' then 'null' else '20' end,case when d.direction='maintain_range' then '20' else 'null' end,case when d.direction='maintain_range' then '21' else 'null' end,o.source_id),m.metric||' '||d.direction||' reaches the actual SQL table constraint')
 from numeric_goal_owner o cross join numeric_goal_metrics m cross join (values('increase_to'),('decrease_to'),('maintain_range')) d(direction);
select is((select count(*)::integer from public.goals where user_id=(select owner_id from numeric_goal_owner)),75,'all25metrics in all3modes inserted');
select is(public.goal_metric_value_valid_v2(null,'kg',20),false,'null metric returns false');
select is(public.goal_metric_value_valid_v2('weight',null,20),false,'null unit returns false');
select is(public.goal_metric_value_valid_v2('weight','kg',null),false,'null value returns false');
select is(public.goal_metric_value_valid_v2('renpho.muscle_percent','%',101),false,'percentage upper bound is enforced');
select is(public.goal_metric_value_valid_v2('renpho.metabolic_age','years',20.5),true,'age-like vendor estimates retain decimals');
select is(public.goal_metric_value_valid_v2('renpho.visceral_fat_index','index',1.25),true,'vendor index retains decimals');
select is(public.goal_metric_value_valid_v2('steps_daily','count',20.5),false,'daily steps remain integral');
select is(public.goal_metric_value_valid_v2(metric,unit,10),false,metric||' remains ineligible') from (values('renpho.bmr','kcal'),('renpho.target_weight_delta','kg'),('renpho.target_muscle_delta','kg'),('renpho.target_fat_delta','kg'),('unknown','kg')) d(metric,unit);
select ok(not has_table_privilege('authenticated','public.goals','insert'),'authenticated direct goal writes remain denied');
select ok(not has_function_privilege('authenticated','public.goal_payload_valid_v2(uuid,jsonb)','execute'),'private baseline validation is service-only');
select ok(not has_function_privilege('authenticated','public.register_goal_proposal_v1(uuid,jsonb,jsonb)','execute'),'proposal registration remains service-only');

create temporary table numeric_goal_definition as select jsonb_build_object('schemaVersion',1,'title','Synthetic reviewed goal','metric','renpho.metabolic_age','unit','years','sourceId',source_id,
 'target',jsonb_build_object('direction','decrease_to','value',20.5),'baselineMethod','user_reported','baselineFrom',null,'baselineTo',null,'reportedBaseline',21.5,
 'timezone','UTC','targetDate',null,'constraints','[]'::jsonb,'proposedStrategy',null,'method','device_estimate','granularity','instant','currentMethod','latest_value') d from numeric_goal_owner;
select is(public.goal_definition_valid_v2(d),true,'complete decimal-estimate definition validates without new defaults') from numeric_goal_definition;
select is(public.goal_definition_valid_v2(d-'metric'),false,'missing metric cannot pass SQL null logic') from numeric_goal_definition;
select is(public.goal_definition_valid_v2(jsonb_set(d,'{target,value}','null')),false,'null target cannot pass SQL null logic') from numeric_goal_definition;
select is(public.goal_definition_valid_v2(d||'{"maxEvidenceAgeDays":2}'),true,'explicit integer age policy validates') from numeric_goal_definition;
select is(public.goal_definition_valid_v2(d||'{"maxEvidenceAgeDays":null}'),true,'explicit absent-policy null validates') from numeric_goal_definition;
select is(public.goal_definition_valid_v2(d||'{"maxEvidenceAgeDays":0.5}'),false,'fractional age policy fails') from numeric_goal_definition;
select is(public.goal_definition_valid_v2(d||'{"maxEvidenceAgeDays":3661}'),false,'oversized age policy fails') from numeric_goal_definition;
select is(public.goal_definition_valid_v2(d||'{"unknown":true}'),false,'unknown definition key fails') from numeric_goal_definition;

-- Historical approved evidence can exceed the new preparation cap while still
-- fitting the existing64KiB bound. Explicit state controls must remain usable.
insert into public.measurements(user_id,source_id,metric_key,canonical_value,canonical_unit,original_value,original_unit,observed_at,granularity,measurement_method,fingerprint)
 select owner_id,source_id,'renpho.muscle_mass',70,'kg','70','kg','2026-09-02T08:00:00Z'::timestamptz,'instant','device_estimate',md5('retained'||i)||md5('retained'||i)
 from numeric_goal_owner cross join generate_series(1,201) i;
create temporary table retained_goal as select gen_random_uuid() goal_id,gen_random_uuid() revision_id,gen_random_uuid() proposal_id,
 jsonb_build_object('schemaVersion',1,'title','Synthetic historical goal','metric','renpho.muscle_mass','unit','kg','sourceId',o.source_id,
  'target',jsonb_build_object('direction','increase_to','value',75),'baselineMethod','latest_value','baselineFrom','2026-09-01T00:00:00Z','baselineTo','2026-09-08T00:00:00Z','reportedBaseline',null,
  'timezone','UTC','targetDate',null,'constraints','[]'::jsonb,'proposedStrategy',null,'method','device_estimate','granularity','instant','currentMethod','latest_value') d
 from numeric_goal_owner o;
alter table retained_goal add column payload jsonb;
update retained_goal r set payload=jsonb_build_object('schemaVersion',2,'definition',d,'state','active','baselineResolution','replace','reviewedDataRevision',p.data_revision,
 'baseline',jsonb_build_object('schemaVersion',2,'selection',jsonb_build_object('metric','renpho.muscle_mass','source_id',o.source_id,'method','device_estimate','granularity','instant','timezone','UTC','from','2026-09-01T00:00:00Z','to','2026-09-08T00:00:00Z'),
 'value','70','dataRevision',p.data_revision,'algorithmVersion','latest_value_v1','provenance','calculated','references',
 (select jsonb_agg(jsonb_build_object('id',m.id,'version',m.version) order by m.id) from public.measurements m where m.user_id=o.owner_id and m.metric_key='renpho.muscle_mass')))
 from numeric_goal_owner o join public.profiles p on p.user_id=o.owner_id;
insert into public.goals(id,user_id,title,metric_key,canonical_unit,direction,target_value,source_id)
 select r.goal_id,o.owner_id,'Synthetic historical goal','renpho.muscle_mass','kg','increase_to',75,o.source_id from retained_goal r cross join numeric_goal_owner o;
insert into public.action_proposals(id,user_id,kind,payload_version,canonical_payload,payload_hash,summary,state,expires_at,result)
 select r.proposal_id,o.owner_id,'goal.create',2,r.payload,encode(sha256(convert_to(r.payload::text,'UTF8')),'hex'),'Synthetic historical goal','approved',clock_timestamp()+interval '1 day',jsonb_build_object('goalId',r.goal_id,'revisionId',r.revision_id)
 from retained_goal r cross join numeric_goal_owner o;
insert into public.goal_revisions(id,user_id,goal_id,revision_number,approved_proposal_id,payload_version,payload)
 select r.revision_id,o.owner_id,r.goal_id,1,r.proposal_id,2,r.payload from retained_goal r cross join numeric_goal_owner o;
update public.goals g set current_revision_id=r.revision_id,state='active',baseline_snapshot=r.payload->'baseline' from retained_goal r where g.id=r.goal_id;
select lives_ok(format('select public.register_goal_proposal_v1(%L::uuid,%L::jsonb,%L::jsonb)',o.owner_id,
 jsonb_build_object('action','propose_state','client_request_id',gen_random_uuid(),'goal_id',r.goal_id,'expected_version',1,'state','paused'),
 r.payload||jsonb_build_object('state','paused','baselineResolution','retain')),'retained201-reference baseline permits an explicit pause proposal') from retained_goal r cross join numeric_goal_owner o;
select lives_ok(format('select public.decide_goal_proposal_v1(%L::uuid,%L::jsonb)',o.owner_id,
 jsonb_build_object('action','approve','client_request_id',gen_random_uuid(),'proposal_id',p.id,'payload_hash',p.payload_hash,'expected_version',1)),
 'retained historical baseline can be approved without replacement') from retained_goal r cross join numeric_goal_owner o
 left join public.action_proposals p on p.user_id=o.owner_id and p.target_id=r.goal_id and p.state='pending';
select is((select state from public.goals where id=(select goal_id from retained_goal)),'paused','historical goal state control succeeds');
select is(public.goal_payload_valid_v2(o.owner_id,r.payload),false,'newly prepared evidence still cannot exceed200 references') from retained_goal r cross join numeric_goal_owner o;
select throws_ok(format('select public.register_goal_proposal_v1(%L::uuid,%L::jsonb,%L::jsonb)',o.owner_id,
 jsonb_build_object('action','propose_create','client_request_id',gen_random_uuid(),'definition',r.d),
 r.payload||jsonb_build_object('baselineResolution','retain')),'P0001','invalid_goal','retained oversized evidence cannot be transplanted into a new goal') from retained_goal r cross join numeric_goal_owner o;

update public.profiles set data_revision=1 where user_id=(select owner_id from numeric_goal_owner);
select throws_ok(format('select public.register_goal_proposal_v1(%L::uuid,%L::jsonb,%L::jsonb)',o.owner_id,
 jsonb_build_object('action','propose_create','client_request_id',gen_random_uuid(),'definition',d),
 jsonb_build_object('schemaVersion',2,'definition',d,'state','active','baselineResolution','replace','reviewedDataRevision',0,
  'baseline',jsonb_build_object('schemaVersion',2,'selection',jsonb_build_object('metric',d->>'metric','source_id',o.source_id,'method',d->>'method','granularity',d->>'granularity','timezone','UTC','from','2026-09-01T00:00:00Z','to','2026-09-08T00:00:00Z'),
  'value','21.5','dataRevision',1,'algorithmVersion','user_reported_v1','provenance','user_reported','references','[]'::jsonb))),
 'P0001','goal_conflict','concurrent baseline revision is a conflict before payload validation')
 from numeric_goal_owner o cross join numeric_goal_definition;

-- Latest daily values are selected by declared dates, independent of UTC order.
insert into public.measurements(user_id,source_id,metric_key,canonical_value,canonical_unit,original_value,original_unit,observed_at,local_date,timezone,granularity,measurement_method,fingerprint)
 select owner_id,source_id,'steps_daily',200,'count','200','count','2026-09-01T12:00:00Z'::timestamptz,'2026-09-02'::date,'Pacific/Kiritimati','daily_total','unknown',repeat('a',64) from numeric_goal_owner
 union all select owner_id,source_id,'steps_daily',100,'count','100','count','2026-09-01T22:00:00Z'::timestamptz,'2026-09-01'::date,'UTC','daily_total','unknown',repeat('b',64) from numeric_goal_owner;
insert into public.measurements(user_id,source_id,metric_key,canonical_value,canonical_unit,original_value,original_unit,observed_at,granularity,measurement_method,fingerprint)
 select owner_id,source_id,'weight',70,'kg','70','kg','2026-09-01T08:00:00Z'::timestamptz,'instant','unknown',repeat('c',64) from numeric_goal_owner
 union all select owner_id,source_id,'weight',72,'kg','72','kg','2026-09-01T08:00:00Z'::timestamptz,'instant','unknown',repeat('d',64) from numeric_goal_owner;
insert into auth.sessions(id,user_id) select owner_id,owner_id from numeric_goal_owner;
grant select on numeric_goal_owner to authenticated;
set local role authenticated;
select set_config('request.jwt.claims',jsonb_build_object('sub',owner_id,'role','authenticated','session_id',owner_id)::text,true) from numeric_goal_owner;
select is((public.read_analysis_v1(jsonb_build_array(jsonb_build_object('mode','latest','source_id',source_id,'metric','steps_daily','method','unknown','granularity','daily_total','timezone','UTC','windows','[]'::jsonb)))#>>'{snapshots,0,rows,0,canonical_value}'),'200','latest daily read uses declared local date') from numeric_goal_owner;
select is((public.read_analysis_v1(jsonb_build_array(jsonb_build_object('mode','latest','source_id',source_id,'metric','steps_daily','method','unknown','granularity','daily_total','timezone','UTC','before','2026-09-02T00:00:00Z','windows','[]'::jsonb)))#>>'{snapshots,0,rows,0,canonical_value}'),'100','daily cutoff uses exclusive declared local date') from numeric_goal_owner;
select is(jsonb_array_length(public.read_analysis_v1(jsonb_build_array(jsonb_build_object('mode','latest','source_id',source_id,'metric','weight','method','unknown','granularity','instant','timezone','UTC','before','2026-09-01T09:00:00Z','windows','[]'::jsonb)))#>'{snapshots,0,rows}'),2,'latest reads retain every tied candidate for deterministic conflict detection') from numeric_goal_owner;
reset role;
select * from finish();
rollback;

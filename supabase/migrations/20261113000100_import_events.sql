begin;

create function public.metric_definition_v2(p_metric text) returns jsonb
language sql immutable set search_path='' as $$
  select jsonb_build_object('unit',unit,'units',units,'representation',representation,'method',method,'header',header,'original_unit',original_unit,'analytics',analytics)
  from (values
    ('weight','kg','["kg","lb"]'::jsonb,'positive','device_reported','Weight(lb)','lb',true),
    ('renpho.bmi','kg/m2','["kg/m2"]'::jsonb,'positive','device_estimate','BMI','kg/m2',true),
    ('body_fat_percent','%','["%"]'::jsonb,'percentage','device_estimate','Body Fat Percentage(%)','%',true),
    ('renpho.body_fat_mass','kg','["kg","lb"]'::jsonb,'nonnegative','device_estimate','Body Fat Mass(lb)','lb',true),
    ('renpho.muscle_percent','%','["%"]'::jsonb,'percentage','device_estimate','Muscle Percentage(%)','%',true),
    ('renpho.muscle_mass','kg','["kg","lb"]'::jsonb,'nonnegative','device_estimate','Muscle Mass(lb)','lb',true),
    ('renpho.skeletal_muscle_percent','%','["%"]'::jsonb,'percentage','device_estimate','Skeletal Muscle Percentage(%)','%',true),
    ('renpho.skeletal_muscle_mass','kg','["kg","lb"]'::jsonb,'nonnegative','device_estimate','Skeletal Muscle Mass(lb)','lb',true),
    ('renpho.bone_percent','%','["%"]'::jsonb,'percentage','device_estimate','Bone Percentage(%)','%',true),
    ('renpho.bone_mass','kg','["kg","lb"]'::jsonb,'nonnegative','device_estimate','Bone Mass(lb)','lb',true),
    ('renpho.protein_percent','%','["%"]'::jsonb,'percentage','device_estimate','Protein Percentage(%)','%',true),
    ('renpho.protein_mass','kg','["kg","lb"]'::jsonb,'nonnegative','device_estimate','Protein Mass(lb)','lb',true),
    ('renpho.body_water_percent','%','["%"]'::jsonb,'percentage','device_estimate','Body Water Percentage(%)','%',true),
    ('renpho.body_water_mass','kg','["kg","lb"]'::jsonb,'nonnegative','device_estimate','Body Water Mass(lb)','lb',true),
    ('renpho.fat_free_mass','kg','["kg","lb"]'::jsonb,'nonnegative','device_estimate','Fat-Free Mass(lb)','lb',true),
    ('renpho.subcutaneous_fat_percent','%','["%"]'::jsonb,'percentage','device_estimate','Subcutaneous Fat(%)','%',true),
    ('renpho.visceral_fat_index','index','["index"]'::jsonb,'nonnegative','device_estimate','Visceral Fat','index',true),
    ('renpho.bmr','kcal','["kcal"]'::jsonb,'positive','device_estimate','BMR(kcal)','kcal',false),
    ('renpho.metabolic_age','years','["years"]'::jsonb,'nonnegative','device_estimate','Metabolic Age','years',true),
    ('renpho.waist_hip_ratio','ratio','["ratio"]'::jsonb,'positive','device_estimate','WHR (Waist-to-Hip Ratio)','ratio',true),
    ('renpho.optimal_weight','kg','["kg","lb"]'::jsonb,'positive','device_estimate','Optimal Weight(lb)','lb',true),
    ('renpho.target_weight_delta','kg','["kg","lb"]'::jsonb,'signed','device_estimate','Target to optimal weight(lb)','lb',false),
    ('renpho.target_muscle_delta','kg','["kg","lb"]'::jsonb,'signed','device_estimate','Target to optimal muscle mass(lb)','lb',false),
    ('renpho.target_fat_delta','kg','["kg","lb"]'::jsonb,'signed','device_estimate','Target to optimal fat mass(lb)','lb',false),
    ('heart_rate','bpm','["bpm"]'::jsonb,'positive','unknown',null,null,true),
    ('resting_heart_rate','bpm','["bpm"]'::jsonb,'positive','unknown',null,null,true),
    ('height','cm','["cm","m","in"]'::jsonb,'positive','unknown',null,null,true),
    ('steps_daily','count','["count"]'::jsonb,'integer','unknown',null,null,true),
    ('sleep_duration','min','["min","h"]'::jsonb,'nonnegative','unknown',null,null,true)
  ) d(metric,unit,units,representation,method,header,original_unit,analytics) where metric=p_metric;
$$;

create function public.metric_representation_valid_v2(p_representation text,p_value numeric) returns boolean
language sql immutable set search_path='' as $$
 select coalesce(p_value not in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric) and
 case p_representation
 when 'positive' then p_value>0 when 'nonnegative' then p_value>=0 when 'percentage' then p_value between 0 and 100
 when 'integer' then p_value between 0 and 9007199254740991 and p_value=trunc(p_value) when 'signed' then true else false end,false);
$$;
create function public.metric_value_valid_v2(p_metric text,p_unit text,p_value numeric) returns boolean
language plpgsql immutable set search_path='' as $$
declare definition jsonb:=public.metric_definition_v2(p_metric);
begin
 return coalesce(p_unit=definition->>'unit' and public.metric_representation_valid_v2(definition->>'representation',p_value),false);
end;
$$;

create function public.normalize_defined_value_v2(definition jsonb,p_unit text,p_original text) returns numeric
language plpgsql immutable set search_path='' as $$
declare v numeric; factor numeric;
begin
 if definition is null or p_unit is null or p_original is null or char_length(p_original)>1024 or p_original !~ '^[+-]?([0-9]+(\.[0-9]*)?|\.[0-9]+)$'
  or not definition->'units' ? p_unit then raise exception 'invalid_measurement' using errcode='22023'; end if;
 factor:=case p_unit when 'lb' then 0.45359237 when 'm' then 100 when 'in' then 2.54 when 'h' then 60 else 1 end;
 v:=p_original::numeric*factor;
 if not public.metric_representation_valid_v2(definition->>'representation',v) or (v<>0 and v::double precision=0) then raise exception 'invalid_measurement' using errcode='22023'; end if;
 return v;
end;
$$;

create function public.normalize_value_v2(p_metric text,p_unit text,p_original text) returns numeric
language sql immutable set search_path='' as $$
 select public.normalize_defined_value_v2(public.metric_definition_v2(p_metric),p_unit,p_original);
$$;

alter table public.data_sources add column import_defaults jsonb check(import_defaults is null or (jsonb_typeof(import_defaults)='object' and octet_length(import_defaults::text)<=65536)),
 add column settings_version integer not null default 1 check(settings_version>0);
alter table public.import_batches add column contract_version integer not null default 1,
 add column adapter_version text,
 add column registry_version text,
 add column normalized_hash text check(normalized_hash ~ '^[0-9a-f]{64}$'),
 add column source_rows integer not null default 0 check(source_rows between 0 and 10000),
 add column event_count integer not null default 0 check(event_count between 0 and 10000),
 add column enriched_count integer not null default 0 check(enriched_count>=0),
 add column mapping jsonb check(mapping is null or octet_length(mapping::text)<=65536);
do $$ declare c record; begin
 for c in select conname from pg_constraint where conrelid='public.import_batches'::regclass and contype='c' and (pg_get_constraintdef(oid) like '%observation_count%' or pg_get_constraintdef(oid) like '%status%') loop
  execute format('alter table public.import_batches drop constraint %I',c.conname);
 end loop;
 for c in select conname from pg_constraint where conrelid='public.measurements'::regclass and contype='c' and (pg_get_constraintdef(oid) like '%canonical_value%' or pg_get_constraintdef(oid) like '%canonical_unit%' or pg_get_constraintdef(oid) like '%provenance%') loop
  execute format('alter table public.measurements drop constraint %I',c.conname);
 end loop;
end $$;
alter table public.import_batches add constraint import_numeric_capacity_v2 check(observation_count between 0 and 25000),
 add constraint import_counts_v2 check(new_count+duplicate_count+conflict_count<=observation_count),
 add constraint import_status_v2 check(status in ('previewed','committed','expired','discarded','failed')),
 add constraint import_committed_v2 check((status='committed')=(committed_at is not null));
alter table public.measurements add constraint metric_representation_v2 check(public.metric_value_valid_v2(metric_key,canonical_unit,canonical_value)),
 add constraint measurement_provenance_v2 check(jsonb_typeof(provenance)='object' and provenance ? 'schema_version' and provenance->>'schema_version' in ('1','2') and octet_length(provenance::text)<=65536);

create function public.event_annotations_valid_v2(a jsonb) returns boolean language sql immutable set search_path='' as $$
 select coalesce(jsonb_typeof(a)='object' and a-array['weight_level','body_type','remarks']='{}'::jsonb
  and not exists(select 1 from jsonb_each(a) e where jsonb_typeof(e.value)<>'string' or case when e.key='remarks' then octet_length(e.value#>>'{}')>4096 else char_length(e.value#>>'{}')>200 end),false);
$$;
create table public.weigh_in_events (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(user_id) on delete restrict,
 source_id uuid not null,
 import_batch_id uuid not null,
 adapter_version text not null check(adapter_version='renpho-en-body-composition-v1'),
 source_local_time timestamp without time zone not null check(isfinite(source_local_time)),
 source_observed_at timestamptz not null check(isfinite(source_observed_at)),
 source_timezone text not null check(char_length(source_timezone) between 1 and 100),
 source_offset_minutes smallint not null check(source_offset_minutes between -840 and 840),
 observed_at timestamptz not null check(isfinite(observed_at)),
 timezone text not null check(char_length(timezone) between 1 and 100),
 offset_minutes smallint not null check(offset_minutes between -840 and 840),
 annotations jsonb not null default '{}' check(public.event_annotations_valid_v2(annotations)),
 annotation_provenance jsonb not null default '{}' check(jsonb_typeof(annotation_provenance)='object' and octet_length(annotation_provenance::text)<=4096),
 source_row integer not null check(source_row between 2 and 10001),
 source_row_id text check(char_length(source_row_id)<=500),
 version integer not null default 1 check(version>0),
 created_at timestamptz not null default clock_timestamp(),
 unique(user_id,id), unique(user_id,id,source_id,observed_at),
 unique(user_id,source_id,source_local_time), unique(user_id,source_id,observed_at),
 foreign key(user_id,source_id) references public.data_sources(user_id,id) on delete restrict,
 foreign key(user_id,import_batch_id) references public.import_batches(user_id,id) on delete restrict,
 check(source_local_time=(source_observed_at at time zone 'UTC')+make_interval(mins=>source_offset_minutes))
);
alter table public.import_batches add constraint import_batch_source_identity_v2 unique(user_id,id,source_id);
alter table public.weigh_in_events add constraint event_batch_source_v2 foreign key(user_id,import_batch_id,source_id) references public.import_batches(user_id,id,source_id) on delete restrict;
alter table public.measurements add constraint measurement_batch_source_v2 foreign key(user_id,import_batch_id,source_id) references public.import_batches(user_id,id,source_id) on delete restrict;
create index weigh_in_events_source_time on public.weigh_in_events(user_id,source_id,source_observed_at);
create index weigh_in_events_owner_time on public.weigh_in_events(user_id,source_id,observed_at,id);
alter table public.weigh_in_events enable row level security;
revoke all on public.weigh_in_events from public,anon,authenticated,service_role;
grant select on public.weigh_in_events to authenticated;
grant select,insert,update,delete on public.weigh_in_events to service_role;
create policy owner_read on public.weigh_in_events for select to authenticated using((select auth.uid())=user_id and exists(select 1 from public.profiles p where p.user_id=(select auth.uid()) and p.account_state='active') and public.owned_session_valid_v1());
alter table public.measurements add column event_id uuid,
 add constraint measurement_event_parent_v2 foreign key(user_id,event_id,source_id,observed_at) references public.weigh_in_events(user_id,id,source_id,observed_at) deferrable initially deferred;
create unique index measurements_event_metric_v2 on public.measurements(user_id,event_id,metric_key) where event_id is not null;

create function public.check_event_link_v2() returns trigger language plpgsql security definer set search_path='' as $$
declare e public.weigh_in_events; m public.measurements;
begin
 if tg_table_name='measurements' then
  select * into m from public.measurements where id=new.id;
  if not found or m.event_id is null then return null; end if;
  select * into e from public.weigh_in_events where user_id=m.user_id and id=m.event_id;
  if not found or m.original_offset_minutes is distinct from e.offset_minutes or m.timezone is distinct from e.timezone or m.granularity<>'instant' then raise exception 'invalid_event_link' using errcode='23514'; end if;
 else
  select * into e from public.weigh_in_events where id=new.id;
  if found then
   if not exists(select 1 from public.measurements where user_id=e.user_id and event_id=e.id) then raise exception 'empty_event' using errcode='23514'; end if;
   if exists(select 1 from public.measurements where user_id=e.user_id and event_id=e.id and (observed_at<>e.observed_at or original_offset_minutes is distinct from e.offset_minutes or timezone is distinct from e.timezone)) then raise exception 'invalid_event_link' using errcode='23514'; end if;
  end if;
 end if;
 return null;
end;
$$;
create constraint trigger measurement_event_link_v2 after insert or update on public.measurements deferrable initially deferred for each row execute function public.check_event_link_v2();
create constraint trigger event_nonempty_v2 after insert or update on public.weigh_in_events deferrable initially deferred for each row execute function public.check_event_link_v2();
create function public.remove_empty_event_v2() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if old.event_id is not null then delete from public.weigh_in_events where user_id=old.user_id and id=old.event_id and not exists(select 1 from public.measurements m where m.user_id=old.user_id and m.event_id=old.event_id); end if;
 return null;
end;
$$;
create trigger remove_empty_event_v2 after delete on public.measurements for each row execute function public.remove_empty_event_v2();

revoke all on function public.normalize_defined_value_v2(jsonb,text,text),public.metric_representation_valid_v2(text,numeric),public.metric_definition_v2(text),public.metric_value_valid_v2(text,text,numeric),public.normalize_value_v2(text,text,text),public.event_annotations_valid_v2(jsonb),public.check_event_link_v2(),public.remove_empty_event_v2() from public,anon,authenticated,service_role;
-- CHECK expressions execute under a caller's role, without exposing private data.
grant execute on function public.metric_representation_valid_v2(text,numeric),public.metric_definition_v2(text),public.metric_value_valid_v2(text,text,numeric),public.event_annotations_valid_v2(jsonb) to authenticated,service_role;
commit;

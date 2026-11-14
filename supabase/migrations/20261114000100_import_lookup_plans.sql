begin;

-- Reimports probe only unlinked readings when attaching existing observations.
create index measurements_unlinked_source_time
 on public.measurements(user_id,source_id,observed_at) where event_id is null;

create or replace function public.classify_import_v2(p_owner uuid,p_source uuid,b jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare answer jsonb; generic_rows jsonb;
begin
 if b->'mapping'->>'format'<>'renpho' then
  select coalesce(jsonb_agg(r order by ord),'[]'::jsonb) into generic_rows from public.import_rows_v2(b);
  return jsonb_build_object('classifications',public.classify_import_v1(p_owner,p_source,generic_rows),'event_ids','[]'::jsonb,'time_conflicts','[]'::jsonb,'annotation_classes','[]'::jsonb);
 end if;
 -- Parse times once even when fresh statistics produce repeated event scans.
 with input_events as materialized (
  select value e,ordinality::integer eo,(value->>'local')::timestamp local_time,(value->>'instant')::timestamptz instant
  from jsonb_array_elements(b->'events') with ordinality
 ), input_rows as materialized (
  select * from public.import_rows_v2(b)
 ), ambiguous as materialized (
  select instant from (
   select e->>'instant' instant,v->>0 field,count(distinct trim_scale((v->>2)::numeric))>1 conflict
   from input_events cross join lateral jsonb_array_elements(e->'values') v group by e->>'instant',v->>0
   union all
   select e->>'instant',a.key,count(distinct a.value)>1 from input_events cross join lateral jsonb_each(public.import_annotations_v2(e)) a group by e->>'instant',a.key
  ) q where conflict
 ), matched as materialized (
  select i.*,m.id,m.observed_at,m.source_observed_at,m.source_local_time,m.source_timezone,m.annotations,
   (exists(select 1 from ambiguous a where a.instant=i.e->>'instant') or (m.id is not null and
    (m.observed_at<>i.instant or m.source_observed_at<>i.instant or m.source_local_time<>i.local_time or m.source_timezone<>b->'mapping'->>'timezone'))
    or (select count(*) from public.weigh_in_events w where w.user_id=p_owner and w.source_id=p_source and
      (w.source_local_time=i.local_time or w.observed_at=i.instant or w.source_observed_at=i.instant))>1) time_conflict
  from input_events i left join lateral (
   select w.* from public.weigh_in_events w where w.user_id=p_owner and w.source_id=p_source and
    (w.source_local_time=i.local_time or w.observed_at=i.instant or w.source_observed_at=i.instant) order by w.id limit 1
  ) m on true
 ), first_rows as materialized (
  select r->>'metric_key' metric,r->>'observed_at' instant,min(ord) first_ord from input_rows group by r->>'metric_key',r->>'observed_at'
 ), labels as (
  select i.ord,case when e.time_conflict then 'conflict'
   when old.n>0 then case when old.equal_values and old.equal_method then 'duplicate' else 'conflict' end
   when i.ord>first_rows.first_ord then 'duplicate' when e.id is not null then 'enrichment' else 'new' end label
  from input_rows i join matched e on e.eo=i.event_ordinal join first_rows on first_rows.metric=i.r->>'metric_key' and first_rows.instant=i.r->>'observed_at'
  cross join lateral (
   select count(*) n,bool_and(m.canonical_value=(i.r->>'canonical_value')::numeric and m.canonical_unit=i.r->>'canonical_unit') equal_values,
    bool_and(m.measurement_method=i.r->>'measurement_method' and m.granularity='instant' and m.timezone=i.r->>'timezone' and m.original_offset_minutes=(i.r->>'original_offset_minutes')::integer) equal_method
   from public.measurements m where m.user_id=p_owner and m.source_id=p_source and m.metric_key=i.r->>'metric_key' and m.observed_at=(i.r->>'observed_at')::timestamptz and m.deleted_at is null
  ) old
 ), eligible_events as (
  select distinct i.event_ordinal from input_rows i join labels l on l.ord=i.ord where l.label<>'conflict'
 ) select jsonb_build_object(
  'classifications',(select coalesce(jsonb_agg(label order by ord),'[]'::jsonb) from labels),
  'event_ids',(select coalesce(jsonb_agg(id order by eo),'[]'::jsonb) from matched),
  'time_conflicts',(select coalesce(jsonb_agg(time_conflict order by eo),'[]'::jsonb) from matched),
  'annotation_classes',(select coalesce(jsonb_agg(coalesce((select jsonb_object_agg(a.key,case when time_conflict or (m.id is null and m.eo not in (select event_ordinal from eligible_events)) then 'conflict' when not coalesce(m.annotations,'{}'::jsonb) ? a.key then case when exists(select 1 from input_events previous where previous.eo<m.eo and previous.e->>'instant'=m.e->>'instant' and public.import_annotations_v2(previous.e)->a.key=a.value) then 'duplicate' else 'new' end when m.annotations->a.key=a.value then 'duplicate' else 'conflict' end) from jsonb_each(public.import_annotations_v2(m.e)) a),'{}'::jsonb) order by eo),'[]'::jsonb) from matched m)
 ) into answer;
 return answer;
end;
$$;

commit;

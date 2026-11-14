begin;

create or replace function public.read_data_v1(p_query jsonb)
returns jsonb language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('revision',p.data_revision,'timezone',p.timezone,
    'sources',case when p_query->>'view'='sources' then coalesce((select jsonb_agg(s.obj order by s.id) from (
      select ds.id,jsonb_build_object('id',ds.id,'kind',ds.kind,'label',ds.label,'namespace',ds.source_namespace,'originApp',ds.origin_app,'deviceLabel',ds.device_label,'method',ds.measurement_method,'importDefaults',ds.import_defaults,'settingsVersion',ds.settings_version) obj
      from public.data_sources ds where ds.user_id=p.user_id and (p_query->>'after_id' is null or ds.id>(p_query->>'after_id')::uuid) order by ds.id limit least(greatest(coalesce((p_query->>'limit')::integer,100),1),200)
    ) s),'[]'::jsonb) else '[]'::jsonb end,
    'rows',case when p_query->>'view'='measurements' then coalesce((select jsonb_agg(r.obj order by r.observed_at,r.id) from (
      select m.observed_at,m.id,to_jsonb(m)-'user_id'-'provenance' || jsonb_build_object('canonical_value',m.canonical_value::text) obj
      from public.measurements m where m.user_id=p.user_id and m.deleted_at is null and m.source_id=(p_query->>'source_id')::uuid
        and m.metric_key=p_query->>'metric' and m.measurement_method=p_query->>'method' and m.granularity=p_query->>'granularity'
        and (case when m.granularity='daily_total' then
          m.local_date >= ((p_query->>'from')::timestamptz at time zone (p_query->>'timezone'))::date and m.local_date < ((p_query->>'to')::timestamptz at time zone (p_query->>'timezone'))::date
        else m.observed_at >= (p_query->>'from')::timestamptz and m.observed_at < (p_query->>'to')::timestamptz end)
        and (p_query->>'after_id' is null or (m.observed_at,m.id)>(select a.observed_at,a.id from public.measurements a where a.user_id=p.user_id and a.id=(p_query->>'after_id')::uuid))
      order by m.observed_at,m.id limit least(greatest(coalesce((p_query->>'limit')::integer,100),1),200)
    ) r),'[]'::jsonb) else '[]'::jsonb end)
  from public.profiles p where p.user_id=auth.uid() and p.account_state='active';
$$;

create or replace function public.read_metric_inventory_v1() returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); revision bigint;
begin
  select data_revision into revision from public.profiles where user_id=owner_id and account_state='active' for share;
  if not found then raise exception 'account_unavailable'; end if;
  return jsonb_build_object('dataRevision',revision,'items',coalesce((select jsonb_agg(to_jsonb(series)) from (
    select m.metric_key metric,m.source_id,s.label source_label,m.measurement_method method,m.granularity,
      count(*) observations,min(m.observed_at) first_at,max(m.observed_at) last_at
    from public.measurements m join public.data_sources s on s.user_id=m.user_id and s.id=m.source_id
    where m.user_id=owner_id and m.deleted_at is null and m.metric_key in ('weight','body_fat_percent','renpho.visceral_fat_index','heart_rate','resting_heart_rate','height','steps_daily','sleep_duration') group by m.metric_key,m.source_id,s.label,m.measurement_method,m.granularity
    order by m.metric_key,m.source_id,m.measurement_method,m.granularity limit 201
  ) series),'[]'::jsonb));
end;
$$;

create function public.read_event_v2(p_event uuid) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare e public.weigh_in_events; revision bigint;
begin
 select data_revision into revision from public.profiles where user_id=auth.uid() and account_state='active';
 if not found then raise exception 'account_unavailable' using errcode='42501'; end if;
 select * into e from public.weigh_in_events where user_id=auth.uid() and id=p_event;
 if not found then raise exception 'data_not_found' using errcode='PT404'; end if;
 return jsonb_build_object('event',to_jsonb(e)-'user_id','dataRevision',revision,'observations',
  (select coalesce(jsonb_agg(to_jsonb(m)-'user_id'||jsonb_build_object('canonical_value',m.canonical_value::text) order by m.metric_key),'[]'::jsonb) from public.measurements m where m.user_id=auth.uid() and m.event_id=e.id));
end;
$$;

create function public.read_events_v2(p_source uuid,p_from timestamptz,p_to timestamptz,p_limit integer default 100,p_after uuid default null,p_revision bigint default null) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare revision bigint; items jsonb; anchor public.weigh_in_events; next_id uuid;
begin
 select data_revision into revision from public.profiles where user_id=auth.uid() and account_state='active';
 if not found then raise exception 'account_unavailable' using errcode='42501'; end if;
 if not exists(select 1 from public.data_sources where user_id=auth.uid() and id=p_source) then raise exception 'data_not_found' using errcode='PT404'; end if;
 if p_limit is null or p_limit not between 1 and 200 or not isfinite(p_from) or not isfinite(p_to) or p_from>=p_to or p_to-p_from>interval '367 days' then raise exception 'invalid_import' using errcode='22023'; end if;
 if p_revision is not null and p_revision<>revision then raise exception 'data_conflict' using errcode='PT409'; end if;
 if p_after is not null then
  if p_revision is null then raise exception 'data_conflict' using errcode='PT409'; end if;
  select * into anchor from public.weigh_in_events where user_id=auth.uid() and source_id=p_source and id=p_after and observed_at>=p_from and observed_at<p_to;
  if not found then raise exception 'data_not_found' using errcode='PT404'; end if;
 end if;
 select coalesce(jsonb_agg(to_jsonb(e)-'user_id' order by e.observed_at,e.id),'[]'::jsonb) into items from (
  select * from public.weigh_in_events where user_id=auth.uid() and source_id=p_source and observed_at>=p_from and observed_at<p_to
   and (p_after is null or (observed_at,id)>(anchor.observed_at,anchor.id)) order by observed_at,id limit p_limit
 ) e;
 if jsonb_array_length(items)=p_limit then next_id:=(items->(p_limit-1)->>'id')::uuid; end if;
 return jsonb_build_object('items',items,'nextCursor',next_id,'dataRevision',revision);
end;
$$;

-- Old write RPCs are incompatible; preserve historical definitions for migration replay,
-- but only the versioned entry points may be called by application clients.
revoke execute on function public.inspect_import_v1(jsonb,jsonb),public.register_import_v1(uuid,text),public.commit_import_v1(jsonb,text),public.discard_import_v1(uuid),public.add_measurement_v1(jsonb),public.mutate_measurement_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.read_event_v2(uuid),public.read_events_v2(uuid,timestamptz,timestamptz,integer,uuid,bigint) from public,anon,authenticated,service_role;
grant execute on function public.read_event_v2(uuid),public.read_events_v2(uuid,timestamptz,timestamptz,integer,uuid,bigint) to authenticated;

-- Incompatible pending work cannot cross the contract transition. Financial rows
-- and approved decisions are preserved; no consent or allocation is renewed.
update public.import_batches set status='failed',staging_payload_id=null where status='previewed' and contract_version<>2;
delete from public.private_payloads where purpose='import_staging' and not exists(select 1 from public.import_batches b where b.staging_payload_id=private_payloads.id and b.user_id=private_payloads.user_id);
update public.action_proposals set state='conflicted',canonical_payload=null where state='pending';

create or replace function public.read_export_v1(p_query jsonb) returns jsonb
language sql stable security invoker set search_path='' as $$
  select jsonb_build_object('revision',p.data_revision,'rows',coalesce((select jsonb_agg(r.obj order by r.observed_at,r.id) from (
    select m.observed_at,m.id,to_jsonb(m)-'user_id'||jsonb_build_object('canonical_value',m.canonical_value::text,
      'event', (select to_jsonb(e)-'user_id' from public.weigh_in_events e where e.user_id=m.user_id and e.id=m.event_id),
      'source',jsonb_build_object('label',s.label,'kind',s.kind,'namespace',s.source_namespace,'origin_app',s.origin_app,'device_label',s.device_label,'import_defaults',s.import_defaults,'settings_version',s.settings_version)) obj
    from public.measurements m join public.data_sources s on s.user_id=m.user_id and s.id=m.source_id
    where m.user_id=p.user_id and m.deleted_at is null and m.source_id=(p_query->>'source_id')::uuid and m.metric_key=p_query->>'metric'
      and m.measurement_method=p_query->>'method' and m.granularity=p_query->>'granularity'
      and (case when m.granularity='daily_total' then
        m.local_date>=((p_query->>'from')::timestamptz at time zone (p_query->>'timezone'))::date and m.local_date<((p_query->>'to')::timestamptz at time zone (p_query->>'timezone'))::date
        else m.observed_at>=(p_query->>'from')::timestamptz and m.observed_at<(p_query->>'to')::timestamptz end)
      and (p_query->>'after_id' is null or (m.observed_at,m.id)>(select a.observed_at,a.id from public.measurements a where a.user_id=p.user_id and a.id=(p_query->>'after_id')::uuid))
    order by m.observed_at,m.id limit 200
  ) r),'[]'::jsonb)) from public.profiles p where p.user_id=auth.uid() and p.account_state='active';
$$;


commit;

begin;
create function public.read_metric_inventory_v1() returns jsonb
language plpgsql security definer set search_path='' as $$
declare owner_id uuid:=auth.uid(); revision bigint;
begin
  select data_revision into revision from public.profiles where user_id=owner_id and account_state='active' for share;
  if not found then raise exception 'account_unavailable'; end if;
  return jsonb_build_object('dataRevision',revision,'items',coalesce((select jsonb_agg(to_jsonb(series)) from (
    select m.metric_key metric,m.source_id,s.label source_label,m.measurement_method method,m.granularity,
      count(*) observations,min(m.observed_at) first_at,max(m.observed_at) last_at
    from public.measurements m join public.data_sources s on s.user_id=m.user_id and s.id=m.source_id
    where m.user_id=owner_id and m.deleted_at is null group by m.metric_key,m.source_id,s.label,m.measurement_method,m.granularity
    order by m.metric_key,m.source_id,m.measurement_method,m.granularity limit 201
  ) series),'[]'::jsonb));
end;
$$;
revoke all on function public.read_metric_inventory_v1() from public,anon,authenticated,service_role;
grant execute on function public.read_metric_inventory_v1() to authenticated;
commit;

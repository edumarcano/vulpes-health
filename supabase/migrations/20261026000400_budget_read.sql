begin;
create function public.read_budget_v1() returns jsonb
language sql stable security definer set search_path='' as $$
  select jsonb_build_object('periodStart',date_trunc('month',now() at time zone 'UTC')::date,
    'resetsAt',(date_trunc('month',now() at time zone 'UTC') at time zone 'UTC')+interval '1 month',
    'allocationUSD',b.allocated_ceiling_usd::text,'preferenceUSD',least(p.monthly_preference_usd,b.lower_preference_usd)::text,
    'spentUSD',coalesce(b.spent_usd,0)::text,'reservedUSD',coalesce(b.reserved_usd,0)::text,
    'availableUSD',case when b.id is null then null else greatest(0,least(b.allocated_ceiling_usd,coalesce(b.lower_preference_usd,b.allocated_ceiling_usd),coalesce(p.monthly_preference_usd,b.allocated_ceiling_usd))-b.spent_usd-b.reserved_usd)::text end,
    'state',case when b.id is null then 'unconfigured' else 'configured' end)
  from public.profiles p left join public.usage_buckets b on b.user_id=p.user_id and b.scope='user'
    and b.period_start=date_trunc('month',now() at time zone 'UTC')::date
  where p.user_id=auth.uid() and p.account_state='active';
$$;
revoke all on function public.read_budget_v1() from public,anon,authenticated,service_role;
grant execute on function public.read_budget_v1() to authenticated;
commit;

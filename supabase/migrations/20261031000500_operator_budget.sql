begin;
create function public.provision_pilot_budget_v1(p_owner uuid,p_app_ceiling numeric,p_account_ceiling numeric)
returns void language plpgsql security invoker set search_path = '' as $$
declare period date := date_trunc('month',clock_timestamp() at time zone 'UTC')::date;
begin
  if p_app_ceiling is null or p_account_ceiling is null or p_app_ceiling<=0 or p_account_ceiling<=0
    or p_app_ceiling::text in ('NaN','Infinity','-Infinity') or p_account_ceiling::text in ('NaN','Infinity','-Infinity')
    or p_account_ceiling>p_app_ceiling then raise exception 'invalid_budget'; end if;
  perform 1 from public.profiles where user_id=p_owner and account_state='active' for update;
  if not found then raise exception 'account_unavailable'; end if;
  perform pg_advisory_xact_lock(731031);
  if exists(select 1 from public.usage_buckets where period_start=period and
    ((scope='app' and allocated_ceiling_usd<>p_app_ceiling) or (scope='account' and user_id=p_owner and allocated_ceiling_usd<>p_account_ceiling)))
    then raise exception 'budget_already_configured'; end if;
  insert into public.usage_buckets(scope,period_start,allocated_ceiling_usd)
    select 'app',period,p_app_ceiling where not exists(select 1 from public.usage_buckets where scope='app' and period_start=period);
  insert into public.usage_buckets(scope,user_id,period_start,allocated_ceiling_usd)
    select 'account',p_owner,period,p_account_ceiling where not exists(select 1 from public.usage_buckets where scope='account' and user_id=p_owner and period_start=period);
end;
$$;
revoke all on function public.provision_pilot_budget_v1(uuid,numeric,numeric) from public,anon,authenticated;
grant execute on function public.provision_pilot_budget_v1(uuid,numeric,numeric) to service_role;
commit;

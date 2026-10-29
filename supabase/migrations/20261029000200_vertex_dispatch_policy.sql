-- Recheck operator policy at the last authorized send boundary.
begin;
create or replace function public.authorize_send_v1(p_owner uuid,p_run uuid,p_executor uuid,p_fence bigint,p_step uuid,p_body_hash text) returns boolean
language plpgsql security definer set search_path='' as $$
declare r public.ai_runs; s public.ai_steps;
begin
  r:=public.lock_run_v1(p_owner,p_run,p_executor,p_fence,true);
  select * into s from public.ai_steps where user_id=p_owner and run_id=p_run and id=p_step for update;
  if not found or s.status<>'started' or s.step_type='tool' then raise exception 'invalid_step'; end if;
  if s.provider='vertex_ai' and (s.provider is distinct from r.route->>'provider' or s.model_id is distinct from r.route->>'model'
   or not exists(select 1 from public.vertex_policy_approval a where a.id and a.policy_version=r.consent_versions#>>'{vertex_ai,accepted_version}')) then raise exception 'run_policy_denied'; end if;
  if s.request_body_hash is distinct from p_body_hash then raise exception 'trace_unavailable'; end if;
  if s.dispatch_state<>'prepared' then return false; end if;
  if (select consent_versions#>>array[s.provider,'accepted_version'] from public.profiles where user_id=p_owner)
      is distinct from r.consent_versions#>>array[s.provider,'accepted_version']
    or (select consent_versions#>>array[s.provider,'accepted_at'] from public.profiles where user_id=p_owner) is null then raise exception 'run_policy_denied'; end if;
  if (select consent_versions->s.provider from public.profiles where user_id=p_owner) is distinct from r.consent_versions->s.provider then raise exception 'run_policy_denied'; end if;
  perform 1 from public.usage_buckets where id=(select app_bucket_id from public.usage_reservations where user_id=p_owner and step_id=p_step) for update;
  perform 1 from public.usage_buckets where id=(select account_bucket_id from public.usage_reservations where user_id=p_owner and step_id=p_step) for update;
  if exists(select 1 from public.usage_buckets b join public.usage_reservations v on b.id in(v.account_bucket_id,v.app_bucket_id)
    join public.profiles p on p.user_id=v.user_id where v.user_id=p_owner and v.step_id=p_step
      and b.spent_usd+b.reserved_usd>least(b.allocated_ceiling_usd,coalesce(b.lower_preference_usd,b.allocated_ceiling_usd),
        case when b.scope='account' then coalesce(p.monthly_preference_usd,b.allocated_ceiling_usd) else b.allocated_ceiling_usd end)) then raise exception 'budget_exhausted'; end if;
  if not exists(select 1 from public.private_payloads where user_id=p_owner and id=s.input_payload_id and purpose='ai_request' and expires_at>clock_timestamp()) then raise exception 'trace_unavailable'; end if;
  update public.ai_steps set dispatch_state='send_authorized',dispatch_authorized_at=clock_timestamp() where id=s.id;
  return true;
end;
$$;
commit;

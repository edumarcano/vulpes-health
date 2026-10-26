begin;
alter table public.ai_steps add column usage_payload_id uuid,
  add constraint steps_usage_payload_fk foreign key(user_id,usage_payload_id) references public.private_payloads(user_id,id) on delete set null(usage_payload_id);
create function public.record_step_usage_v1(p_owner uuid,p_run uuid,p_executor uuid,p_fence bigint,p_step uuid,p_usage jsonb,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare r public.ai_runs; s public.ai_steps; next_id uuid;
begin
  r:=public.lock_run_v1(p_owner,p_run,p_executor,p_fence,true);
  select * into s from public.ai_steps where user_id=p_owner and run_id=p_run and id=p_step for update;
  if not found or s.step_type='tool' then raise exception 'invalid_step'; end if;
  if jsonb_typeof(p_usage) is distinct from 'object' or (p_usage-array['inputTokens','outputTokens','reasoningTokens','cacheReadTokens','cacheWriteTokens','reasoningIsOutputSubset','cacheReadIsInputSubset','cacheWriteIsInputSubset'])<>'{}'::jsonb then raise exception 'invalid_usage'; end if;
  next_id:=public.store_run_envelope_v1(p_owner,p_payload,'provider_state');
  update public.ai_steps set usage_payload_id=next_id,input_tokens=(p_usage->>'inputTokens')::bigint,output_tokens=(p_usage->>'outputTokens')::bigint,
    reasoning_tokens=(p_usage->>'reasoningTokens')::bigint,cache_read_tokens=(p_usage->>'cacheReadTokens')::bigint,cache_write_tokens=(p_usage->>'cacheWriteTokens')::bigint,
    raw_usage=p_usage where id=s.id;
  delete from public.private_payloads where user_id=p_owner and id=s.usage_payload_id;
  update public.ai_runs set input_tokens=case when exists(select 1 from public.ai_steps where user_id=p_owner and run_id=p_run and step_type<>'tool' and input_tokens is null) then null else
    (select sum(input_tokens) from public.ai_steps where user_id=p_owner and run_id=p_run and step_type<>'tool') end,
    output_tokens=case when exists(select 1 from public.ai_steps where user_id=p_owner and run_id=p_run and step_type<>'tool' and output_tokens is null) then null else
    (select sum(output_tokens) from public.ai_steps where user_id=p_owner and run_id=p_run and step_type<>'tool') end where id=p_run;
  return next_id;
end;
$$;
revoke all on function public.record_step_usage_v1(uuid,uuid,uuid,bigint,uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
commit;

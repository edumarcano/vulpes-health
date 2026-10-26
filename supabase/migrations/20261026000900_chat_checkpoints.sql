begin;
create function public.checkpoint_message_v1(p_owner uuid,p_run uuid,p_executor uuid,p_fence bigint,p_parts jsonb) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform public.lock_run_v1(p_owner,p_run,p_executor,p_fence,true);
  if jsonb_typeof(p_parts)<>'array' or octet_length(p_parts::text)>2097152 then raise exception 'invalid_message'; end if;
  update public.messages set content_parts=p_parts where user_id=p_owner and run_id=p_run and role='assistant' and status='streaming';
  if not found then raise exception 'invalid_message'; end if;
  update public.ai_runs set partial_output=(jsonb_array_length(p_parts)>0) where user_id=p_owner and id=p_run;
end;
$$;
revoke all on function public.checkpoint_message_v1(uuid,uuid,uuid,bigint,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.checkpoint_message_v1(uuid,uuid,uuid,bigint,jsonb) to service_role;
commit;

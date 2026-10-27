begin;
create function public.cancel_chat_v1(p_owner uuid,p_run uuid,p_request uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare receipt public.audit_events; answer jsonb;
begin
  perform 1 from public.profiles where user_id=p_owner for update;
  if not found then raise exception 'run_not_found'; end if;
  select * into receipt from public.audit_events where user_id=p_owner and event_type='chat_cancel_v1' and safe_metadata->>'client_request_id'=p_request::text;
  if found then
    if receipt.object_id is distinct from p_run then raise exception 'idempotency_conflict'; end if;
    return public.run_summary_v1(p_owner,p_run);
  end if;
  answer:=public.cancel_run_v1(p_owner,p_run);
  insert into public.audit_events(user_id,event_type,object_id,safe_metadata) values(p_owner,'chat_cancel_v1',p_run,jsonb_build_object('client_request_id',p_request));
  return answer;
end;
$$;
revoke all on function public.cancel_chat_v1(uuid,uuid,uuid) from public,anon,authenticated,service_role;
grant execute on function public.cancel_chat_v1(uuid,uuid,uuid) to service_role;
commit;

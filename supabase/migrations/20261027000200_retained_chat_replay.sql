begin;
-- Profile/conversation locks serialize lookup with admission, retention and deletion.
create function public.replay_chat_v1(p_owner uuid,p_request jsonb,p_message jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare profile public.profiles; receipt public.messages; r public.ai_runs;
  request_id uuid:=(p_request->>'clientRequestId')::uuid; message_id uuid:=(p_message->>'id')::uuid;
  conversation uuid:=(p_request->>'conversationId')::uuid;
begin
  select * into profile from public.profiles where user_id=p_owner for update;
  if not found or profile.account_state<>'active' then raise exception 'account_unavailable'; end if;
  perform 1 from public.conversations where user_id=p_owner and id=conversation for update;
  if not found then raise exception 'run_not_found'; end if;
  if exists(select 1 from public.messages where user_id=p_owner and id=message_id and client_request_id is distinct from request_id) then raise exception 'idempotency_conflict'; end if;
  select * into receipt from public.messages where user_id=p_owner and client_request_id=request_id;
  if found and (receipt.id is distinct from message_id or receipt.conversation_id is distinct from conversation
    or receipt.request_hash is distinct from p_request->>'requestHash' or receipt.role<>'user') then raise exception 'idempotency_conflict'; end if;
  select * into r from public.ai_runs where user_id=p_owner and client_request_id=request_id;
  if found then
    if r.request_hash is distinct from p_request->>'requestHash' or r.conversation_id is distinct from conversation then raise exception 'idempotency_conflict'; end if;
    return jsonb_build_object('kind','existing','run',public.run_summary_v1(p_owner,r.id));
  end if;
  if receipt.id is not null then
    return jsonb_build_object('kind','retained','conversationId',receipt.conversation_id,'message',jsonb_build_object('id',receipt.id,'status',receipt.status));
  end if;
  return null;
end;
$$;
revoke all on function public.replay_chat_v1(uuid,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.replay_chat_v1(uuid,jsonb,jsonb) to service_role;

create or replace function public.admit_chat_v1(p_owner uuid,p_request jsonb,p_executor uuid,p_message jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare answer jsonb; run_id uuid; assistant_id uuid:=gen_random_uuid();
begin
  perform 1 from public.profiles where user_id=p_owner and account_state='active' for update;
  if not found then raise exception 'account_unavailable'; end if;
  answer:=public.replay_chat_v1(p_owner,p_request,p_message);
  if answer is not null then return answer; end if;
  if char_length(p_message->>'text') not between 1 and 16000 or p_message->>'text' !~ '[^[:space:]]' then raise exception 'invalid_message'; end if;
  answer:=public.admit_run_v1(p_owner,p_request,p_executor);
  if answer->>'kind'<>'admitted' then return answer; end if;
  run_id:=(answer#>>'{run,id}')::uuid;
  insert into public.messages(id,user_id,conversation_id,role,content_parts,run_id,status,client_request_id,request_hash)
    values((p_message->>'id')::uuid,p_owner,(p_request->>'conversationId')::uuid,'user',jsonb_build_array(jsonb_build_object('type','text','text',p_message->>'text')),run_id,'completed',(p_request->>'clientRequestId')::uuid,p_request->>'requestHash');
  insert into public.messages(id,user_id,conversation_id,role,content_parts,run_id,status,created_at)
    values(assistant_id,p_owner,(p_request->>'conversationId')::uuid,'assistant','[]',run_id,'streaming',clock_timestamp());
  update public.conversations set title=case when title='New conversation' and not exists(select 1 from public.messages prior_message where prior_message.user_id=p_owner and prior_message.conversation_id=(p_request->>'conversationId')::uuid and prior_message.role='user' and prior_message.id<>(p_message->>'id')::uuid) then left(trim(regexp_replace(p_message->>'text','[[:space:]]+',' ','g')),80) else title end,updated_at=clock_timestamp()
    where user_id=p_owner and id=(p_request->>'conversationId')::uuid;
  return jsonb_build_object('kind','admitted','run',public.run_summary_v1(p_owner,run_id));
end;
$$;
commit;

begin;

create or replace function public.admit_run_v1(p_owner uuid,p_request jsonb,p_executor uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare profile public.profiles; r public.ai_runs; conversation uuid; depth text; route jsonb; now_at timestamptz:=clock_timestamp();
begin
  select * into profile from public.profiles where user_id=p_owner for update;
  if not found or profile.account_state<>'active' then raise exception 'account_unavailable'; end if;
  conversation:=(p_request->>'conversationId')::uuid;
  perform 1 from public.conversations where user_id=p_owner and id=conversation for update;
  if not found then raise exception 'run_not_found'; end if;
  select * into r from public.ai_runs where user_id=p_owner and client_request_id=(p_request->>'clientRequestId')::uuid;
  if found then
    if r.request_hash is distinct from p_request->>'requestHash' then raise exception 'idempotency_conflict'; end if;
    return jsonb_build_object('kind','existing','run',public.run_summary_v1(p_owner,r.id));
  end if;
  if exists(select 1 from public.conversations where user_id=p_owner and id=conversation and archived) then raise exception 'run_not_writable'; end if;
  select * into r from public.ai_runs where user_id=p_owner and status in ('admitted','running','cancellation_requested');
  if found then return jsonb_build_object('kind','busy','run',public.run_summary_v1(p_owner,r.id)); end if;
  if (select count(*) from public.ai_runs where user_id=p_owner and admitted_at>now_at-interval '1 minute')>=10 then raise exception 'run_rate_limited'; end if;
  depth:=p_request->>'depth';route:=p_request->'route';
  if depth not in ('auto','everyday','intermediate','advanced') or ((p_request->>'baseline') is distinct from 'safety-v1' and (p_request->>'maxCostUSD')::numeric<=0)
    or route->>'provider' not in ('openrouter','vertex_ai') or char_length(route->>'model') not between 1 and 200
    or ((p_request->>'baseline') is distinct from 'safety-v1' and (profile.consent_versions#>>array[route->>'provider','accepted_version'] is distinct from p_request->>'consentVersion'
    or profile.consent_versions#>>array[route->>'provider','accepted_at'] is null)) then raise exception 'run_policy_denied'; end if;
  insert into public.ai_runs(user_id,conversation_id,client_request_id,request_hash,requested_depth,route,policy_version,consent_versions,
    executor_hash,admitted_at,deadline_at,lease_expires_at,accounting_period,max_cost_usd,data_revision,limits)
  values(p_owner,conversation,(p_request->>'clientRequestId')::uuid,p_request->>'requestHash',depth,route,'vulpes-run-v1',profile.consent_versions,
    encode(sha256(convert_to(p_executor::text,'UTF8')),'hex'),now_at,now_at+interval '210 seconds',now_at+interval '30 seconds',
    date_trunc('month',now_at at time zone 'UTC')::date,(p_request->>'maxCostUSD')::numeric,profile.data_revision,
    '{"modelRequests":4,"toolCalls":6,"deadlineSeconds":210}'::jsonb) returning * into r;
  return jsonb_build_object('kind','admitted','run',public.run_summary_v1(p_owner,r.id));
end;
$$;


-- The existing admission transaction is extended rather than duplicated. Profile
-- locking serializes message IDs, mutation receipts, and conversation deletion.
create function public.admit_chat_v1(p_owner uuid,p_request jsonb,p_executor uuid,p_message jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare answer jsonb; run_id uuid; assistant_id uuid:=gen_random_uuid();
begin
  perform 1 from public.profiles where user_id=p_owner and account_state='active' for update;
  if not found then raise exception 'account_unavailable'; end if;
  if exists(select 1 from public.messages where user_id=p_owner and id=(p_message->>'id')::uuid
    and client_request_id is distinct from (p_request->>'clientRequestId')::uuid) then raise exception 'idempotency_conflict'; end if;
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

create function public.mutate_conversation_v1(p_owner uuid,p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare receipt public.audit_events; c public.conversations; r public.ai_runs; rid uuid:=(p_request->>'client_request_id')::uuid;
  digest text:=encode(sha256(convert_to(p_request::text,'UTF8')),'hex'); answer jsonb; payload_ids uuid[];
begin
  perform 1 from public.profiles where user_id=p_owner and account_state='active' for update;
  if not found then raise exception 'account_unavailable'; end if;
  select * into receipt from public.audit_events where user_id=p_owner and event_type='conversation_mutation_v1' and safe_metadata->>'client_request_id'=rid::text;
  if found then
    if receipt.safe_metadata->>'request_hash'<>digest then raise exception 'idempotency_conflict'; end if;
    return receipt.safe_metadata->'result';
  end if;
  if p_request->>'action'='create' then
    insert into public.conversations(id,user_id,title) values((p_request->>'id')::uuid,p_owner,'New conversation') returning * into c;
  else
    select * into c from public.conversations where user_id=p_owner and id=(p_request->>'id')::uuid for update;
    if not found then raise exception 'conversation_not_found'; end if;
    if p_request->>'action'='archive' then
      -- Archive invalidates executor content authority through lock_run_v1.
      update public.conversations set archived=true,updated_at=clock_timestamp() where id=c.id;
      for r in select * from public.ai_runs where user_id=p_owner and conversation_id=c.id and status in ('admitted','running','cancellation_requested') order by id loop
        perform public.cancel_run_v1(p_owner,r.id);
      end loop;
    elsif p_request->>'action'='delete' and p_request->>'confirm'='true' then
      -- Keep permitted accounting metadata and unsettled reservations, never content.
      for r in select * from public.ai_runs where user_id=p_owner and conversation_id=c.id order by id loop
        update public.ai_runs set trace_content_removed_at=clock_timestamp(),trace_state='removed' where user_id=p_owner and id=r.id;
      end loop;
      select array_agg(id) into payload_ids from (
        select s.input_payload_id id from public.ai_steps s join public.ai_runs owner_run on owner_run.user_id=s.user_id and owner_run.id=s.run_id where owner_run.user_id=p_owner and owner_run.conversation_id=c.id union
        select s.output_payload_id from public.ai_steps s join public.ai_runs owner_run on owner_run.user_id=s.user_id and owner_run.id=s.run_id where owner_run.user_id=p_owner and owner_run.conversation_id=c.id union
        select s.context_payload_id from public.ai_steps s join public.ai_runs owner_run on owner_run.user_id=s.user_id and owner_run.id=s.run_id where owner_run.user_id=p_owner and owner_run.conversation_id=c.id union
        select s.continuation_payload_id from public.ai_steps s join public.ai_runs owner_run on owner_run.user_id=s.user_id and owner_run.id=s.run_id where owner_run.user_id=p_owner and owner_run.conversation_id=c.id union
        select s.usage_payload_id from public.ai_steps s join public.ai_runs owner_run on owner_run.user_id=s.user_id and owner_run.id=s.run_id where owner_run.user_id=p_owner and owner_run.conversation_id=c.id
      ) ids;
      delete from public.private_payloads where user_id=p_owner and id=any(payload_ids);
      delete from public.messages where user_id=p_owner and conversation_id=c.id;
      update public.ai_runs set conversation_id=null where user_id=p_owner and conversation_id=c.id;
      delete from public.conversations where user_id=p_owner and id=c.id;
    else raise exception 'invalid_conversation'; end if;
  end if;
  answer:=jsonb_build_object('id',c.id,'outcome',p_request->>'action');
  insert into public.audit_events(user_id,event_type,object_id,safe_metadata) values(p_owner,'conversation_mutation_v1',c.id,jsonb_build_object('client_request_id',rid,'request_hash',digest,'result',answer));
  return answer;
exception when unique_violation then raise exception 'idempotency_conflict';
end;
$$;

create function public.save_chat_state_v1(p_owner uuid,p_run uuid,p_executor uuid,p_fence bigint,p_step uuid,p_state jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare previous uuid; next_id uuid;
begin
  perform public.lock_run_v1(p_owner,p_run,p_executor,p_fence,true);
  select continuation_payload_id into previous from public.ai_steps where user_id=p_owner and run_id=p_run and id=p_step for update;
  if not found then raise exception 'invalid_step'; end if;
  next_id:=public.store_run_envelope_v1(p_owner,p_state,'provider_state');
  update public.ai_steps set continuation_payload_id=next_id where user_id=p_owner and id=p_step;
  delete from public.private_payloads where user_id=p_owner and id=previous;
  return next_id;
end;
$$;

create function public.baseline_chat_v1(p_owner uuid,p_run uuid,p_executor uuid,p_fence bigint,p_text text) returns jsonb
language plpgsql security definer set search_path='' as $$
begin
  perform public.lock_run_v1(p_owner,p_run,p_executor,p_fence,true);
  if exists(select 1 from public.ai_steps where user_id=p_owner and run_id=p_run) then raise exception 'invalid_step'; end if;
  update public.messages set content_parts=jsonb_build_array(jsonb_build_object('type','text','text',p_text)) where user_id=p_owner and run_id=p_run and role='assistant' and status='streaming';
  return public.finish_run_v1(p_owner,p_run,p_executor,'completed');
end;
$$;
revoke all on function public.admit_chat_v1(uuid,jsonb,uuid,jsonb),public.mutate_conversation_v1(uuid,jsonb),public.save_chat_state_v1(uuid,uuid,uuid,bigint,uuid,jsonb),public.baseline_chat_v1(uuid,uuid,uuid,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.admit_chat_v1(uuid,jsonb,uuid,jsonb),public.mutate_conversation_v1(uuid,jsonb),public.save_chat_state_v1(uuid,uuid,uuid,bigint,uuid,jsonb),public.baseline_chat_v1(uuid,uuid,uuid,bigint,text) to service_role;
commit;

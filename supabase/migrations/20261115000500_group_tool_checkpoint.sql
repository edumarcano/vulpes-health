begin;

-- Registration, the authenticated proposal reference, encrypted evidence and
-- zero-cost tool settlement share the same fenced transaction.
create or replace function public.checkpoint_goal_proposal_v1(p_owner uuid,p_run uuid,p_executor uuid,p_fence bigint,p_step uuid,p_request jsonb,p_payload jsonb,p_output jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.ai_runs; s public.ai_steps; m public.messages; p public.action_proposals; ident uuid; ref jsonb; parts jsonb; grouped boolean; action text;
begin
 r:=public.lock_run_v1(p_owner,p_run,p_executor,p_fence,true);
 select * into s from public.ai_steps where user_id=p_owner and run_id=p_run and id=p_step for update;
 if not found or s.step_type<>'tool' or s.tool_name not in ('prepare_goals','propose_goal','propose_goal_revision') then raise exception 'invalid_step'; end if;
 action:=p_request->>'action';
 if (p_request->>'client_request_id')::uuid is distinct from p_step or action is null or
   (s.tool_name='prepare_goals' and action not in ('propose_create','propose_revision','propose_group_create','propose_group_revision')) or
   (s.tool_name='propose_goal' and action<>'propose_create') or
   (s.tool_name='propose_goal_revision' and action<>'propose_revision') then raise exception 'invalid_goal'; end if;
 grouped:=action in ('propose_group_create','propose_group_revision');
 select * into m from public.messages where user_id=p_owner and run_id=p_run and role='assistant' and status='streaming' for update;
 if not found then raise exception 'invalid_message'; end if;
 select * into p from public.action_proposals where user_id=p_owner and source_step_id=p_step;
 if found then
   -- Registration receipts verify the exact request even after body removal.
   if grouped then
     ident:=public.register_goal_group_proposal_v1(p_owner,p_request,p_payload);
   else
     ident:=public.register_goal_proposal_v1(p_owner,p_request,p_payload);
   end if;
   if ident is distinct from p.id or p.source_run_id is distinct from p_run or p.source_message_id is distinct from m.id then raise exception 'invalid_goal'; end if;
 else
   if s.status<>'started' or (p_payload->>'reviewedDataRevision')::bigint is distinct from r.data_revision then raise exception 'run_not_writable'; end if;
   if grouped then
     ident:=public.register_goal_group_proposal_v1(p_owner,p_request,p_payload);
   else
     ident:=public.register_goal_proposal_v1(p_owner,p_request,p_payload);
   end if;
   update public.action_proposals set source_run_id=p_run,source_step_id=p_step,source_message_id=m.id where user_id=p_owner and id=ident returning * into p;
   ref:=jsonb_build_object('version',1,'proposalId',p.id,'payloadHash',p.payload_hash,'expectedVersion',p.target_version);
   parts:=m.content_parts||jsonb_build_array(jsonb_build_object('type',case when grouped then 'goal_group_proposal' else 'goal_proposal' end,'reference',ref));
   perform public.checkpoint_step_v1(p_owner,p_run,p_executor,p_fence,p_step,p_output,jsonb_build_object('id',m.id,'parts',parts));
   perform public.settle_step_v1(p_owner,p_run,p_step,'{"expectedVersion":0,"source":"not_sent","costUSD":"0"}'::jsonb,'completed');
   update public.ai_runs set partial_output=true where user_id=p_owner and id=p_run;
 end if;
 return jsonb_build_object('reference',jsonb_build_object('version',1,'proposalId',p.id,'payloadHash',p.payload_hash,'expectedVersion',p.target_version),'parts',(select content_parts from public.messages where user_id=p_owner and id=m.id));
end;
$$;
revoke all on function public.checkpoint_goal_proposal_v1(uuid,uuid,uuid,bigint,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.checkpoint_goal_proposal_v1(uuid,uuid,uuid,bigint,uuid,jsonb,jsonb,jsonb) to service_role;
commit;

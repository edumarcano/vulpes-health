begin;
alter table public.action_proposals add column source_step_id uuid;
alter table public.action_proposals add column source_message_id uuid;
alter table public.action_proposals add constraint proposal_source_step foreign key(user_id,source_step_id) references public.ai_steps(user_id,id) on delete set null (source_step_id);
alter table public.action_proposals add constraint proposal_source_message foreign key(user_id,source_message_id) references public.messages(user_id,id) on delete set null (source_message_id);
create unique index proposal_tool_once on public.action_proposals(user_id,source_step_id) where source_step_id is not null;

create function public.checkpoint_goal_proposal_v1(p_owner uuid,p_run uuid,p_executor uuid,p_fence bigint,p_step uuid,p_request jsonb,p_payload jsonb,p_output jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare r public.ai_runs; s public.ai_steps; m public.messages; p public.action_proposals; ident uuid; ref jsonb; parts jsonb;
begin
 r:=public.lock_run_v1(p_owner,p_run,p_executor,p_fence,true);
 select * into s from public.ai_steps where user_id=p_owner and run_id=p_run and id=p_step for update;
 if not found or s.step_type<>'tool' or s.tool_name not in ('propose_goal','propose_goal_revision') then raise exception 'invalid_step'; end if;
 if (p_request->>'client_request_id')::uuid is distinct from p_step or
   p_request->>'action' is distinct from (case when s.tool_name='propose_goal' then 'propose_create' else 'propose_revision' end) then raise exception 'invalid_goal'; end if;
 select * into m from public.messages where user_id=p_owner and run_id=p_run and role='assistant' and status='streaming' for update;
 if not found then raise exception 'invalid_message'; end if;
 select * into p from public.action_proposals where user_id=p_owner and source_step_id=p_step;
 if found then
   -- The receipt still checks the exact request, even after the draft body is gone.
   perform public.register_goal_proposal_v1(p_owner,p_request,p_payload);
 else
   if s.status<>'started' or (p_payload->>'reviewedDataRevision')::bigint is distinct from r.data_revision then raise exception 'run_not_writable'; end if;
   ident:=public.register_goal_proposal_v1(p_owner,p_request,p_payload);
   update public.action_proposals set source_run_id=p_run,source_step_id=p_step,source_message_id=m.id where user_id=p_owner and id=ident returning * into p;
   ref:=jsonb_build_object('version',1,'proposalId',p.id,'payloadHash',p.payload_hash,'expectedVersion',p.target_version);
   parts:=m.content_parts||jsonb_build_array(jsonb_build_object('type','goal_proposal','reference',ref));
   perform public.checkpoint_step_v1(p_owner,p_run,p_executor,p_fence,p_step,p_output,jsonb_build_object('id',m.id,'parts',parts));
   perform public.settle_step_v1(p_owner,p_run,p_step,'{"expectedVersion":0,"source":"not_sent","costUSD":"0"}'::jsonb,'completed');
   update public.ai_runs set partial_output=true where user_id=p_owner and id=p_run;
 end if;
 return jsonb_build_object('reference',jsonb_build_object('version',1,'proposalId',p.id,'payloadHash',p.payload_hash,'expectedVersion',p.target_version),'parts',(select content_parts from public.messages where user_id=p_owner and id=m.id));
end;
$$;
revoke all on function public.checkpoint_goal_proposal_v1(uuid,uuid,uuid,bigint,uuid,jsonb,jsonb,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.checkpoint_goal_proposal_v1(uuid,uuid,uuid,bigint,uuid,jsonb,jsonb,jsonb) to service_role;

create function public.invalidate_message_proposals_v1() returns trigger language plpgsql security definer set search_path='' as $$
begin
 update public.action_proposals set state='conflicted',canonical_payload=null where user_id=old.user_id and source_message_id=old.id and state='pending';
 return old;
end;
$$;
revoke all on function public.invalidate_message_proposals_v1() from public,anon,authenticated,service_role;
create trigger invalidate_message_proposals before delete on public.messages for each row execute function public.invalidate_message_proposals_v1();
commit;

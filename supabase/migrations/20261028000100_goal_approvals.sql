begin;
alter table public.action_proposals alter column canonical_payload drop not null;
alter table public.action_proposals add constraint proposals_live_body check (state not in ('pending','approved') or canonical_payload is not null);
alter table public.action_proposals add column result jsonb;

create function public.expire_goal_proposals_v1(p_owner uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.profiles where user_id=p_owner for update;
 update public.action_proposals p set state=case when p.expires_at<=clock_timestamp() then 'expired' else 'conflicted' end,canonical_payload=null
 where p.user_id=p_owner and p.state='pending' and (p.expires_at<=clock_timestamp() or
 (p.payload_version=2 and (p.canonical_payload->>'reviewedDataRevision')::bigint<>(select data_revision from public.profiles where user_id=p_owner)) or
 (p.target_id is not null and p.target_version<>(select version from public.goals where user_id=p_owner and id=p.target_id)));
end;
$$;
create function public.register_goal_proposal_v1(p_owner uuid,p_request jsonb,p_payload jsonb) returns uuid language plpgsql security definer set search_path='' as $$
declare old public.audit_events; ident uuid; g public.goals; fingerprint text:=encode(sha256(convert_to(p_request::text,'UTF8')),'hex');
begin
 perform 1 from public.profiles where user_id=p_owner and account_state='active' for update;
 if not found then raise exception 'account_unavailable'; end if;
 select * into old from public.audit_events where user_id=p_owner and event_type='goal_propose_v1' and safe_metadata->>'request_id'=((p_request->>'client_request_id')::uuid)::text;
 if found then
  if old.safe_metadata->>'hash'<>fingerprint then raise exception 'goal_conflict'; end if;
  return old.object_id;
 end if;
 if p_request->>'action' not in ('propose_create','propose_revision','propose_state') or p_payload->>'schemaVersion'<>'2' then raise exception 'invalid_goal'; end if;
 if (p_payload->>'reviewedDataRevision')::bigint<>(select data_revision from public.profiles where user_id=p_owner) then raise exception 'goal_conflict'; end if;
 if not exists(select 1 from public.data_sources where user_id=p_owner and id=(p_payload->'definition'->>'sourceId')::uuid) then raise exception 'goal_not_found'; end if;
 if p_request->>'action'<>'propose_create' then
  select * into g from public.goals where user_id=p_owner and id=(p_request->>'goal_id')::uuid for update;
  if not found then raise exception 'goal_not_found'; end if;
  if g.version<>(p_request->>'expected_version')::integer or g.state='archived' then raise exception 'goal_conflict'; end if;
 end if;
 insert into public.action_proposals(user_id,kind,target_id,target_version,payload_version,canonical_payload,payload_hash,summary,expires_at)
 values(p_owner,case p_request->>'action' when 'propose_create' then 'goal.create' when 'propose_revision' then 'goal.revise' else 'goal.state' end,g.id,g.version,2,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),p_payload->'definition'->>'title',clock_timestamp()+interval '24 hours') returning id into ident;
 insert into public.audit_events(user_id,event_type,object_id,safe_metadata) values(p_owner,'goal_propose_v1',ident,jsonb_build_object('request_id',((p_request->>'client_request_id')::uuid)::text,'hash',fingerprint));
 return ident;
end;
$$;
create function public.decide_goal_proposal_v1(p_owner uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.action_proposals; g public.goals; d jsonb; b jsonb; rev uuid:=gen_random_uuid(); goal uuid; n integer; receipt public.audit_events; fingerprint text:=encode(sha256(convert_to(p_request::text,'UTF8')),'hex'); answer jsonb;
begin
 perform 1 from public.profiles where user_id=p_owner and account_state='active' for update;
 if not found then raise exception 'account_unavailable'; end if;
 select * into receipt from public.audit_events where user_id=p_owner and event_type='goal_decide_v1' and safe_metadata->>'request_id'=((p_request->>'client_request_id')::uuid)::text;
 if found then
  if receipt.safe_metadata->>'hash'<>fingerprint then raise exception 'goal_conflict'; end if;
  return receipt.safe_metadata->'result';
 end if;
 select * into p from public.action_proposals where user_id=p_owner and id=(p_request->>'proposal_id')::uuid for update;
 if not found then raise exception 'goal_not_found'; end if;
 if p.payload_hash<>p_request->>'payload_hash' or p.target_version is distinct from (p_request->>'expected_version')::integer then raise exception 'goal_conflict'; end if;
 if p.state='approved' and p_request->>'action'='approve' or p.state='rejected' and p_request->>'action'='reject' then
  insert into public.audit_events(user_id,event_type,object_id,safe_metadata) values(p_owner,'goal_decide_v1',p.id,jsonb_build_object('request_id',((p_request->>'client_request_id')::uuid)::text,'hash',fingerprint,'result',p.result));
  return p.result; end if;
 if p.state<>'pending' or p.expires_at<=clock_timestamp() then raise exception 'goal_conflict'; end if;
 if p.payload_hash<>encode(sha256(convert_to(p.canonical_payload::text,'UTF8')),'hex') or p.payload_version<>2 then raise exception 'goal_conflict'; end if;
 if (p.canonical_payload->>'reviewedDataRevision')::bigint<>(select data_revision from public.profiles where user_id=p_owner) then raise exception 'goal_conflict'; end if;
 if p.target_id is not null then
  select * into g from public.goals where user_id=p_owner and id=p.target_id for update;
  if not found then raise exception 'goal_not_found'; end if;
  if g.version<>p.target_version or g.state='archived' then raise exception 'goal_conflict'; end if;
 end if;
 if p_request->>'action'='reject' then
  answer:=jsonb_build_object('proposalId',p.id,'outcome','rejected');
  update public.action_proposals set state='rejected',canonical_payload=null,result=answer where id=p.id;
 elsif p_request->>'action'='approve' then
  d:=p.canonical_payload->'definition'; b:=p.canonical_payload->'baseline'; goal:=coalesce(g.id,gen_random_uuid());
  n:=coalesce((select max(revision_number) from public.goal_revisions where user_id=p_owner and goal_id=goal),0)+1;
  if g.id is null then
   insert into public.goals(id,user_id,title,metric_key,canonical_unit,direction,target_value,target_lower,target_upper,source_id)
   values(goal,p_owner,d->>'title',d->>'metric',d->>'unit',d->'target'->>'direction',(d->'target'->>'value')::numeric,(d->'target'->>'lower')::numeric,(d->'target'->>'upper')::numeric,(d->>'sourceId')::uuid);
  end if;
  insert into public.goal_revisions(id,user_id,goal_id,revision_number,previous_revision_id,approved_proposal_id,payload_version,payload)
   values(rev,p_owner,goal,n,g.current_revision_id,p.id,2,p.canonical_payload);
  update public.goals set title=d->>'title',metric_key=d->>'metric',canonical_unit=d->>'unit',direction=d->'target'->>'direction',target_value=(d->'target'->>'value')::numeric,target_lower=(d->'target'->>'lower')::numeric,target_upper=(d->'target'->>'upper')::numeric,source_id=(d->>'sourceId')::uuid,
   source_policy=jsonb_build_object('schema_version',1,'method',d->>'method','granularity',d->>'granularity','currentMethod',d->>'currentMethod'),baseline_snapshot=b,current_revision_id=rev,version=case when g.id is null then 1 else g.version+1 end,state=p.canonical_payload->>'state',review_status=case when p.kind='goal.state' then coalesce(g.review_status,'clear') else 'clear' end,target_date=(d->>'targetDate')::date,constraints=d->'constraints',updated_at=clock_timestamp() where user_id=p_owner and id=goal;
  answer:=jsonb_build_object('proposalId',p.id,'outcome','approved','goalId',goal,'revisionId',rev,'revisionNumber',n,'version',coalesce(g.version,0)+1);
  update public.action_proposals set state='approved',result=answer where id=p.id;
 else raise exception 'invalid_goal'; end if;
 insert into public.audit_events(user_id,event_type,object_id,safe_metadata) values(p_owner,'goal_decide_v1',p.id,jsonb_build_object('request_id',((p_request->>'client_request_id')::uuid)::text,'hash',fingerprint,'result',answer));
 return answer;
end;
$$;
revoke all on function public.expire_goal_proposals_v1(uuid),public.register_goal_proposal_v1(uuid,jsonb,jsonb),public.decide_goal_proposal_v1(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.expire_goal_proposals_v1(uuid),public.register_goal_proposal_v1(uuid,jsonb,jsonb),public.decide_goal_proposal_v1(uuid,jsonb) to service_role;
commit;

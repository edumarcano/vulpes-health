begin;

create table public.goal_groups (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(user_id) on delete restrict,
 name text not null check(length(btrim(name)) between 1 and 200),
 state text not null check(state in ('active','archived')),
 version integer not null default 1 check(version>0),
 review_status text not null default 'clear' check(review_status in ('clear','needs_review')),
 current_approval_id uuid,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),
 unique(user_id,id),
 foreign key(user_id,current_approval_id) references public.action_proposals(user_id,id) on delete restrict,
 check(state<>'active' or current_approval_id is not null)
);
create table public.goal_group_members (
 id uuid primary key default gen_random_uuid(),
 user_id uuid not null references public.profiles(user_id) on delete restrict,
 group_id uuid not null,
 goal_id uuid not null,
 position integer not null check(position between 1 and 4),
 reviewed_goal_version integer not null check(reviewed_goal_version>0),
 reviewed_revision_id uuid not null,
 unique(user_id,id),
 unique(user_id,group_id,goal_id),
 unique(user_id,group_id,position),
 foreign key(user_id,group_id) references public.goal_groups(user_id,id) on delete cascade,
 foreign key(user_id,goal_id) references public.goals(user_id,id) on delete restrict,
 foreign key(user_id,reviewed_revision_id,goal_id) references public.goal_revisions(user_id,id,goal_id) on delete restrict
);
create index group_members_goal on public.goal_group_members(user_id,goal_id,group_id);
alter table public.action_proposals add column group_target_id uuid;
alter table public.action_proposals add constraint proposal_group_target foreign key(user_id,group_target_id) references public.goal_groups(user_id,id) on delete restrict;
alter table public.action_proposals drop constraint action_proposals_kind_check;
alter table public.action_proposals drop constraint action_proposals_check1;
alter table public.action_proposals add constraint proposal_kind check(kind in ('goal.create','goal.revise','goal.state','goal_group.create','goal_group.revise','goal_group.state'));
alter table public.action_proposals add constraint proposal_target check(
 (kind='goal.create' and target_id is null and group_target_id is null and target_version is null) or
 (kind in ('goal.revise','goal.state') and target_id is not null and group_target_id is null and target_version is not null) or
 (kind='goal_group.create' and target_id is null and group_target_id is null and target_version is null and payload_version=3) or
 (kind in ('goal_group.revise','goal_group.state') and target_id is null and group_target_id is not null and target_version is not null and payload_version=3)
);
alter table public.goal_revisions drop constraint goal_revisions_user_id_approved_proposal_id_key;
alter table public.goal_revisions add constraint revision_proposal_per_goal unique(user_id,goal_id,approved_proposal_id);

alter table public.goal_groups enable row level security;
alter table public.goal_group_members enable row level security;
revoke all on public.goal_groups,public.goal_group_members from public,anon,authenticated;
grant select on public.goal_groups,public.goal_group_members to authenticated;
grant all on public.goal_groups,public.goal_group_members to service_role;
create policy owner_read on public.goal_groups for select to authenticated using(user_id=(select auth.uid()) and exists(select 1 from public.profiles p where p.user_id=(select auth.uid()) and p.account_state='active'));
create policy owner_read on public.goal_group_members for select to authenticated using(user_id=(select auth.uid()) and exists(select 1 from public.profiles p where p.user_id=(select auth.uid()) and p.account_state='active'));
create policy live_session on public.goal_groups as restrictive for select to authenticated using((select public.owned_session_valid_v1()));
create policy live_session on public.goal_group_members as restrictive for select to authenticated using((select public.owned_session_valid_v1()));
create trigger enforce_owned_session before insert or update or delete on public.goal_groups for each row execute function public.enforce_owned_session_v1();
create trigger enforce_owned_session before insert or update or delete on public.goal_group_members for each row execute function public.enforce_owned_session_v1();

create function public.check_goal_group_cardinality_v1() returns trigger language plpgsql security invoker set search_path='' as $$
declare groups uuid[]; ident uuid; amount integer;
begin
 if tg_table_name='goal_groups' then groups:=array[coalesce(new.id,old.id)];
 else groups:=array[case when tg_op<>'INSERT' then old.group_id end,case when tg_op<>'DELETE' then new.group_id end]; end if;
 for ident in select distinct u.id from unnest(groups) as u(id) where u.id is not null loop
  if exists(select 1 from public.goal_groups where id=ident and state='active') then
   select count(*) into amount from public.goal_group_members where group_id=ident;
   if amount not between 1 and 4 then raise exception 'invalid_group_cardinality' using errcode='23514'; end if;
  end if;
 end loop;
 return null;
end;
$$;
create constraint trigger group_cardinality after insert or update on public.goal_groups deferrable initially deferred for each row execute function public.check_goal_group_cardinality_v1();
create constraint trigger group_cardinality after insert or update or delete on public.goal_group_members deferrable initially deferred for each row execute function public.check_goal_group_cardinality_v1();

-- Shape and ordinary child admission. Existing links retain the exact approved body;
-- the locked-member check below establishes its owner/revision binding.
create function public.goal_group_payload_valid_v1(p_owner uuid,p jsonb) returns boolean
language plpgsql stable security invoker set search_path='' as $$
declare m jsonb; ids uuid[]:='{}'; ident uuid;
begin
 if jsonb_typeof(p) is distinct from 'object' or p-array['schemaVersion','name','state','members','reviewedDataRevision']<>'{}'::jsonb
  or not(p ?& array['schemaVersion','name','state','members','reviewedDataRevision']) or p->>'schemaVersion' is distinct from '3'
  or jsonb_typeof(p->'name') is distinct from 'string' or length(btrim(p->>'name')) not between 1 and 200
  or p->>'state' is null or p->>'state' not in ('active','archived')
  or jsonb_typeof(p->'reviewedDataRevision') is distinct from 'number' or (p->>'reviewedDataRevision')::bigint<0
  or jsonb_typeof(p->'members') is distinct from 'array' or jsonb_array_length(p->'members') not between 1 and 4
  or octet_length(p::text)>300000 then return false; end if;
 for m in select value from jsonb_array_elements(p->'members') loop
  if jsonb_typeof(m) is distinct from 'object' or m->>'kind' is null or m->>'kind' not in ('existing','create','revise')
   or jsonb_typeof(m->'payload') is distinct from 'object' then return false; end if;
  if m->>'kind'='create' then
   if m-array['kind','payload']<>'{}'::jsonb or m#>>'{payload,baselineResolution}' is distinct from 'replace' then return false; end if;
  else
   if not(m ?& array['goalId','expectedVersion','revisionId','payload']) or m-array['kind','goalId','expectedVersion','revisionId','payload']<>'{}'::jsonb
    or jsonb_typeof(m->'expectedVersion') is distinct from 'number' or (m->>'expectedVersion')::integer<1
    or (m->>'revisionId')::uuid is null then return false; end if;
   ident:=(m->>'goalId')::uuid;
   if ident is null or ident=any(ids) then return false; end if;
   ids:=array_append(ids,ident);
  end if;
  if p->>'state'='active' and m->>'kind'<>'existing' and (not public.goal_payload_valid_v2(p_owner,m->'payload')
   or (m#>>'{payload,reviewedDataRevision}')::bigint<>(p->>'reviewedDataRevision')::bigint) then return false; end if;
 end loop;
 return true;
exception when others then return false;
end;
$$;

create function public.check_goal_group_members_v1(p_owner uuid,p jsonb) returns void
language plpgsql security invoker set search_path='' as $$
declare m jsonb; g public.goals; r public.goal_revisions; ap public.action_proposals;
begin
 -- Profile serialization precedes stable child locks in every approval path.
 perform 1 from public.goals where user_id=p_owner and id in(select (x->>'goalId')::uuid from jsonb_array_elements(p->'members') x where x->>'kind'<>'create') order by id for update;
 for m in select value from jsonb_array_elements(p->'members') loop
  if m->>'kind'='create' then continue; end if;
  select * into g from public.goals where user_id=p_owner and id=(m->>'goalId')::uuid;
  if not found then raise exception 'goal_not_found'; end if;
  if g.version<>(m->>'expectedVersion')::integer or g.current_revision_id is distinct from (m->>'revisionId')::uuid or g.state in ('draft','archived') then raise exception 'goal_conflict'; end if;
  select * into r from public.goal_revisions where user_id=p_owner and goal_id=g.id and id=g.current_revision_id;
  if not found then raise exception 'goal_conflict'; end if;
  select * into ap from public.action_proposals where user_id=p_owner and id=r.approved_proposal_id and state='approved';
  if not found then raise exception 'goal_conflict'; end if;
  if ap.kind like 'goal_group.%' and not exists(select 1 from jsonb_array_elements(ap.result->'members') x where x->>'goalId'=g.id::text and x->>'revisionId'=r.id::text) then raise exception 'goal_conflict'; end if;
  if m->>'kind'='existing' then
   if m->'payload' is distinct from r.payload then raise exception 'goal_conflict'; end if;
  elsif jsonb_array_length(m#>'{payload,baseline,references}')>200 and (m#>>'{payload,baselineResolution}'<>'retain' or m#>'{payload,baseline}' is distinct from r.payload->'baseline') then raise exception 'invalid_goal';
  end if;
 end loop;
end;
$$;

-- Internal child application has no proposal/receipt side effects. The parent
-- transaction owns validation, approval and all-or-nothing publication.
create function public.apply_goal_payload_v2(p_owner uuid,p_proposal uuid,p_kind text,p_goal uuid,p_expected_version integer,p_payload jsonb) returns jsonb
language plpgsql security invoker set search_path='' as $$
declare g public.goals; d jsonb:=p_payload->'definition'; b jsonb:=p_payload->'baseline'; ident uuid:=coalesce(p_goal,gen_random_uuid()); rev uuid:=gen_random_uuid(); n integer;
begin
 if not public.goal_payload_valid_v2(p_owner,p_payload) then raise exception 'invalid_goal'; end if;
 if p_goal is not null then
  select * into g from public.goals where user_id=p_owner and id=p_goal for update;
  if not found then raise exception 'goal_not_found'; end if;
  if g.version is distinct from p_expected_version or g.state='archived' then raise exception 'goal_conflict'; end if;
 elsif p_expected_version is not null or p_payload->>'baselineResolution'<>'replace' then raise exception 'invalid_goal'; end if;
 if jsonb_array_length(b->'references')>200 and (g.id is null or p_payload->>'baselineResolution'<>'retain' or
  not exists(select 1 from public.goal_revisions r where r.user_id=p_owner and r.goal_id=g.id and r.id=g.current_revision_id and r.payload->'baseline'=b)) then raise exception 'invalid_goal'; end if;
 n:=coalesce((select max(revision_number) from public.goal_revisions where user_id=p_owner and goal_id=ident),0)+1;
 if g.id is null then
  insert into public.goals(id,user_id,title,metric_key,canonical_unit,direction,target_value,target_lower,target_upper,source_id)
   values(ident,p_owner,d->>'title',d->>'metric',d->>'unit',d#>>'{target,direction}',(d#>>'{target,value}')::numeric,(d#>>'{target,lower}')::numeric,(d#>>'{target,upper}')::numeric,(d->>'sourceId')::uuid);
 end if;
 insert into public.goal_revisions(id,user_id,goal_id,revision_number,previous_revision_id,approved_proposal_id,payload_version,payload)
  values(rev,p_owner,ident,n,g.current_revision_id,p_proposal,2,p_payload);
 update public.goals set title=d->>'title',metric_key=d->>'metric',canonical_unit=d->>'unit',direction=d#>>'{target,direction}',target_value=(d#>>'{target,value}')::numeric,target_lower=(d#>>'{target,lower}')::numeric,target_upper=(d#>>'{target,upper}')::numeric,source_id=(d->>'sourceId')::uuid,
  source_policy=jsonb_build_object('schema_version',1,'method',d->>'method','granularity',d->>'granularity','currentMethod',d->>'currentMethod'),baseline_snapshot=b,current_revision_id=rev,version=coalesce(g.version,0)+1,state=p_payload->>'state',review_status=case when p_kind='goal.state' then coalesce(g.review_status,'clear') else 'clear' end,target_date=(d->>'targetDate')::date,constraints=d->'constraints',updated_at=clock_timestamp() where user_id=p_owner and id=ident;
 return jsonb_build_object('proposalId',p_proposal,'outcome','approved','goalId',ident,'revisionId',rev,'revisionNumber',n,'version',coalesce(g.version,0)+1);
end;
$$;

create function public.register_goal_group_proposal_v1(p_owner uuid,p_request jsonb,p_payload jsonb) returns uuid
language plpgsql security definer set search_path='' as $$
declare old public.audit_events; g public.goal_groups; prior public.action_proposals; ident uuid; kind text; fingerprint text:=encode(sha256(convert_to(p_request::text,'UTF8')),'hex');
begin
 perform 1 from public.profiles where user_id=p_owner and account_state='active' for update;
 if not found then raise exception 'account_unavailable'; end if;
 select * into old from public.audit_events where user_id=p_owner and event_type='group_propose_v1' and safe_metadata->>'request_id'=((p_request->>'client_request_id')::uuid)::text;
 if found then
  if old.safe_metadata->>'hash'<>fingerprint then raise exception 'goal_conflict'; end if;
  return old.object_id;
 end if;
 if jsonb_typeof(p_payload->'reviewedDataRevision')='number' and (p_payload->>'reviewedDataRevision')::bigint is distinct from (select data_revision from public.profiles where user_id=p_owner) then raise exception 'goal_conflict'; end if;
 kind:=case p_request->>'action' when 'propose_group_create' then 'goal_group.create' when 'propose_group_revision' then 'goal_group.revise' when 'propose_group_state' then 'goal_group.state' end;
 if kind is null then raise exception 'invalid_goal'; end if;
 if kind<>'goal_group.create' then
  select * into g from public.goal_groups where user_id=p_owner and id=(p_request->>'group_id')::uuid for update;
  if not found then raise exception 'goal_not_found'; end if;
  if g.version is distinct from (p_request->>'expected_version')::integer or g.state='archived' then raise exception 'goal_conflict'; end if;
 end if;
 if kind='goal_group.state' then
  if not public.goal_group_payload_valid_v1(p_owner,p_payload) then raise exception 'invalid_goal'; end if;
  select * into prior from public.action_proposals where user_id=p_owner and id=g.current_approval_id and state='approved';
  if not found or p_payload->>'schemaVersion' is distinct from '3' or p_payload->>'state' is distinct from 'archived'
   or p_payload->'name' is distinct from prior.canonical_payload->'name' or p_payload->'members' is distinct from prior.canonical_payload->'members'
   or p_request->>'state' is distinct from 'archived' then raise exception 'goal_conflict'; end if;
 else
  if not public.goal_group_payload_valid_v1(p_owner,p_payload) or p_payload->>'state'<>'active' then raise exception 'invalid_goal'; end if;
  perform public.check_goal_group_members_v1(p_owner,p_payload);
 end if;
 insert into public.action_proposals(user_id,kind,group_target_id,target_version,payload_version,canonical_payload,payload_hash,summary,expires_at)
  values(p_owner,kind,g.id,g.version,3,p_payload,encode(sha256(convert_to(p_payload::text,'UTF8')),'hex'),p_payload->>'name',clock_timestamp()+interval '24 hours') returning id into ident;
 insert into public.audit_events(user_id,event_type,object_id,safe_metadata) values(p_owner,'group_propose_v1',ident,jsonb_build_object('request_id',((p_request->>'client_request_id')::uuid)::text,'hash',fingerprint));
 return ident;
end;
$$;

create function public.decide_goal_group_proposal_v1(p_owner uuid,p_request jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare p public.action_proposals; g public.goal_groups; prior public.action_proposals; receipt public.audit_events; fingerprint text:=encode(sha256(convert_to(p_request::text,'UTF8')),'hex'); answer jsonb; child jsonb; members jsonb:='[]'; m jsonb; ident uuid; ordinal integer:=0;
begin
 perform 1 from public.profiles where user_id=p_owner and account_state='active' for update;
 if not found then raise exception 'account_unavailable'; end if;
 select * into receipt from public.audit_events where user_id=p_owner and event_type='group_decide_v1' and safe_metadata->>'request_id'=((p_request->>'client_request_id')::uuid)::text;
 if found then
  if receipt.safe_metadata->>'hash'<>fingerprint then raise exception 'goal_conflict'; end if;
  return receipt.safe_metadata->'result';
 end if;
 select * into p from public.action_proposals where user_id=p_owner and id=(p_request->>'proposal_id')::uuid and kind like 'goal_group.%' for update;
 if not found then raise exception 'goal_not_found'; end if;
 if p.payload_hash is distinct from p_request->>'payload_hash' or p.target_version is distinct from (p_request->>'expected_version')::integer then raise exception 'goal_conflict'; end if;
 if p.state='approved' and p_request->>'action'='approve' or p.state='rejected' and p_request->>'action'='reject' then
  insert into public.audit_events(user_id,event_type,object_id,safe_metadata) values(p_owner,'group_decide_v1',p.id,jsonb_build_object('request_id',((p_request->>'client_request_id')::uuid)::text,'hash',fingerprint,'result',p.result));
  return p.result;
 end if;
 if p.state<>'pending' or p.expires_at<=clock_timestamp() or p.payload_version<>3 or p.payload_hash<>encode(sha256(convert_to(p.canonical_payload::text,'UTF8')),'hex')
  or (p.canonical_payload->>'reviewedDataRevision')::bigint is distinct from (select data_revision from public.profiles where user_id=p_owner) then raise exception 'goal_conflict'; end if;
 if p.group_target_id is not null then
  select * into g from public.goal_groups where user_id=p_owner and id=p.group_target_id for update;
  if not found then raise exception 'goal_not_found'; end if;
  if g.version is distinct from p.target_version or g.state='archived' then raise exception 'goal_conflict'; end if;
 end if;
 if p_request->>'action'='reject' then
  answer:=jsonb_build_object('proposalId',p.id,'outcome','rejected');
  update public.action_proposals set state='rejected',canonical_payload=null,result=answer where id=p.id;
 elsif p_request->>'action'='approve' then
  if p.kind='goal_group.state' then
   if not public.goal_group_payload_valid_v1(p_owner,p.canonical_payload) then raise exception 'invalid_goal'; end if;
   select * into prior from public.action_proposals where user_id=p_owner and id=g.current_approval_id and state='approved';
   if not found or p.canonical_payload->>'state' is distinct from 'archived' or p.canonical_payload->'name' is distinct from prior.canonical_payload->'name'
    or p.canonical_payload->'members' is distinct from prior.canonical_payload->'members' then raise exception 'goal_conflict'; end if;
   members:=prior.result->'members';
  else
   if not public.goal_group_payload_valid_v1(p_owner,p.canonical_payload) or p.canonical_payload->>'state'<>'active' then raise exception 'invalid_goal'; end if;
   perform public.check_goal_group_members_v1(p_owner,p.canonical_payload);
   for m in select value from jsonb_array_elements(p.canonical_payload->'members') loop
    ordinal:=ordinal+1;
    if m->>'kind'='existing' then
     child:=jsonb_build_object('goalId',m->>'goalId','revisionId',m->>'revisionId','version',(m->>'expectedVersion')::integer);
    else
     child:=public.apply_goal_payload_v2(p_owner,p.id,'goal.revise',(m->>'goalId')::uuid,(m->>'expectedVersion')::integer,m->'payload');
    end if;
    members:=members||jsonb_build_array(child||jsonb_build_object('position',ordinal));
   end loop;
  end if;
  ident:=coalesce(g.id,gen_random_uuid());
  if g.id is null then
   insert into public.goal_groups(id,user_id,name,state,current_approval_id) values(ident,p_owner,p.canonical_payload->>'name','active',p.id);
  else
   update public.goal_groups set name=p.canonical_payload->>'name',state=p.canonical_payload->>'state',version=g.version+1,review_status=case when p.kind='goal_group.state' then g.review_status else 'clear' end,current_approval_id=p.id,updated_at=clock_timestamp() where user_id=p_owner and id=ident;
  end if;
  if p.kind<>'goal_group.state' then
   delete from public.goal_group_members where user_id=p_owner and group_id=ident;
   insert into public.goal_group_members(user_id,group_id,goal_id,position,reviewed_goal_version,reviewed_revision_id)
    select p_owner,ident,(x->>'goalId')::uuid,(x->>'position')::integer,(x->>'version')::integer,(x->>'revisionId')::uuid from jsonb_array_elements(members) x;
  end if;
  answer:=jsonb_build_object('proposalId',p.id,'outcome','approved','groupId',ident,'version',coalesce(g.version,0)+1,'members',members);
  update public.action_proposals set state='approved',result=answer where id=p.id;
 else raise exception 'invalid_goal'; end if;
 insert into public.audit_events(user_id,event_type,object_id,safe_metadata) values(p_owner,'group_decide_v1',p.id,jsonb_build_object('request_id',((p_request->>'client_request_id')::uuid)::text,'hash',fingerprint,'result',answer));
 return answer;
end;
$$;

create or replace function public.expire_goal_proposals_v1(p_owner uuid) returns void language plpgsql security definer set search_path='' as $$
begin
 perform 1 from public.profiles where user_id=p_owner for update;
 update public.action_proposals p set state=case when p.expires_at<=clock_timestamp() then 'expired' else 'conflicted' end,canonical_payload=null
 where p.user_id=p_owner and p.state='pending' and (p.expires_at<=clock_timestamp() or
  (p.payload_version in (2,3) and (p.canonical_payload->>'reviewedDataRevision')::bigint is distinct from (select data_revision from public.profiles where user_id=p_owner)) or
  (p.target_id is not null and p.target_version is distinct from (select version from public.goals where user_id=p_owner and id=p.target_id)) or
  (p.group_target_id is not null and p.target_version is distinct from (select version from public.goal_groups where user_id=p_owner and id=p.group_target_id)) or
  (p.payload_version=3 and p.kind<>'goal_group.state' and exists(select 1 from jsonb_array_elements(p.canonical_payload->'members') m left join public.goals g on g.user_id=p_owner and g.id=(m->>'goalId')::uuid
   where m->>'kind'<>'create' and (g.id is null or g.version is distinct from (m->>'expectedVersion')::integer or g.current_revision_id is distinct from (m->>'revisionId')::uuid or g.state='archived'))));
end;
$$;
create or replace function public.invalidate_goal_drafts_v1() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.data_revision is distinct from old.data_revision then
  update public.action_proposals set state='conflicted',canonical_payload=null where user_id=new.user_id and state='pending' and payload_version in (2,3) and (canonical_payload->>'reviewedDataRevision')::bigint is distinct from new.data_revision;
 end if;
 return new;
end;
$$;

revoke all on function public.check_goal_group_cardinality_v1(),public.goal_group_payload_valid_v1(uuid,jsonb),public.check_goal_group_members_v1(uuid,jsonb),public.apply_goal_payload_v2(uuid,uuid,text,uuid,integer,jsonb),public.register_goal_group_proposal_v1(uuid,jsonb,jsonb),public.decide_goal_group_proposal_v1(uuid,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.register_goal_group_proposal_v1(uuid,jsonb,jsonb),public.decide_goal_group_proposal_v1(uuid,jsonb) to service_role;

-- Single-goal approval retains its historical gates and receipts.
create or replace function public.decide_goal_proposal_v1(p_owner uuid,p_request jsonb) returns jsonb language plpgsql security definer set search_path='' as $$
declare p public.action_proposals; g public.goals; receipt public.audit_events; fingerprint text:=encode(sha256(convert_to(p_request::text,'UTF8')),'hex'); answer jsonb;
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
 if p_request->>'action'='approve' and not public.goal_payload_valid_v2(p_owner,p.canonical_payload) then raise exception 'invalid_goal'; end if;
 if (p.canonical_payload->>'reviewedDataRevision')::bigint<>(select data_revision from public.profiles where user_id=p_owner) then raise exception 'goal_conflict'; end if;
 if p.target_id is not null then
  select * into g from public.goals where user_id=p_owner and id=p.target_id for update;
  if not found then raise exception 'goal_not_found'; end if;
  if g.version<>p.target_version or g.state='archived' then raise exception 'goal_conflict'; end if;
 end if;
 if p_request->>'action'='approve' and jsonb_array_length(p.canonical_payload#>'{baseline,references}')>200 and (g.id is null or p.canonical_payload->>'baselineResolution'<>'retain' or
  not exists(select 1 from public.goal_revisions gr where gr.user_id=p_owner and gr.goal_id=g.id and gr.id=g.current_revision_id and gr.payload->'baseline'=p.canonical_payload->'baseline')) then raise exception 'invalid_goal'; end if;
 if p_request->>'action'='reject' then
  answer:=jsonb_build_object('proposalId',p.id,'outcome','rejected');
  update public.action_proposals set state='rejected',canonical_payload=null,result=answer where id=p.id;
 elsif p_request->>'action'='approve' then
  answer:=public.apply_goal_payload_v2(p_owner,p.id,p.kind,g.id,g.version,p.canonical_payload);
  update public.action_proposals set state='approved',result=answer where id=p.id;
 else raise exception 'invalid_goal'; end if;
 insert into public.audit_events(user_id,event_type,object_id,safe_metadata) values(p_owner,'goal_decide_v1',p.id,jsonb_build_object('request_id',((p_request->>'client_request_id')::uuid)::text,'hash',fingerprint,'result',answer));
 return answer;
end;
$$;

commit;

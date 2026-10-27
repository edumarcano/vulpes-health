begin;

-- A violated provider/model cost bound must outlive 90-day execution cleanup.
-- The row contains no account or prompt data and is cleared only by a
-- separately reviewed operator action, never by routine reconciliation.
create table public.ai_route_cost_blocks (
  provider text not null,
  model_id text not null,
  blocked_at timestamptz not null default clock_timestamp(),
  primary key(provider,model_id)
);
alter table public.ai_route_cost_blocks enable row level security;
revoke all on public.ai_route_cost_blocks from public,anon,authenticated,service_role;
grant select on public.ai_route_cost_blocks to service_role;
insert into public.ai_route_cost_blocks(provider,model_id)
 select distinct provider,model_id from public.ai_steps
 where cost_bound_state='exceeded' and provider is not null and model_id is not null
 on conflict do nothing;

create function public.record_route_cost_block_v1() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.cost_bound_state='exceeded' and new.provider is not null and new.model_id is not null then
    insert into public.ai_route_cost_blocks(provider,model_id) values(new.provider,new.model_id) on conflict do nothing;
  end if;
  return new;
end;
$$;
create trigger record_route_cost_block after update of cost_bound_state on public.ai_steps
  for each row execute function public.record_route_cost_block_v1();

create function public.enforce_route_cost_block_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare route_provider text; route_model text;
begin
  if tg_table_name='usage_reservations' then
    select provider,model_id into route_provider,route_model from public.ai_steps
      where user_id=new.user_id and run_id=new.run_id and id=new.step_id;
  else
    if new.dispatch_state<>'send_authorized' or old.dispatch_state<>'prepared' then return new; end if;
    route_provider:=new.provider;route_model:=new.model_id;
  end if;
  if exists(select 1 from public.ai_route_cost_blocks where provider=route_provider and model_id=route_model)
    then raise exception 'cost_bound_exceeded'; end if;
  return new;
end;
$$;
create trigger enforce_route_cost_block_reservation before insert on public.usage_reservations
  for each row execute function public.enforce_route_cost_block_v1();
create trigger enforce_route_cost_block_dispatch before update of dispatch_state on public.ai_steps
  for each row execute function public.enforce_route_cost_block_v1();
revoke all on function public.record_route_cost_block_v1(),public.enforce_route_cost_block_v1() from public,anon,authenticated,service_role;
commit;

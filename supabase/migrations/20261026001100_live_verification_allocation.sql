begin;

-- A verification batch has one immutable account bucket and one admission
-- month. Its balance survives run/trace cleanup and is never replenished by
-- the smoke command. Other accounts continue using the ordinary ledger.
create table public.live_verification_allocations (
  id uuid primary key,
  user_id uuid not null unique references public.profiles(user_id) on delete restrict,
  account_bucket_id uuid not null unique,
  period_start date not null check (extract(day from period_start)=1),
  ceiling_usd numeric not null check (ceiling_usd>0 and ceiling_usd not in ('NaN'::numeric,'Infinity'::numeric)),
  data_revision bigint not null check (data_revision>=0),
  fixture_hash text not null check (fixture_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (user_id,account_bucket_id,period_start) references public.usage_buckets(user_id,id,period_start) on delete restrict
);
alter table public.live_verification_allocations enable row level security;
revoke all on public.live_verification_allocations from public,anon,authenticated,service_role;
grant select,insert on public.live_verification_allocations to service_role;

create function public.validate_live_verification_allocation_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare bucket public.usage_buckets; profile public.profiles;
begin
  select * into profile from public.profiles where user_id=new.user_id for update;
  select * into bucket from public.usage_buckets where id=new.account_bucket_id for update;
  if not found or profile.user_id is null or profile.account_state<>'active' or profile.display_name is distinct from 'Synthetic verification' or profile.data_revision<>new.data_revision
    or not exists(select 1 from auth.users where id=new.user_id and email ~ '^pr03-[0-9a-f-]{36}@example[.]test$')
    or bucket.user_id<>new.user_id or bucket.scope<>'account' or bucket.period_start<>new.period_start
    or bucket.allocated_ceiling_usd<>new.ceiling_usd or bucket.spent_usd<>0 or bucket.reserved_usd<>0
    or new.period_start<>(date_trunc('month',clock_timestamp() at time zone 'UTC'))::date
    or exists(select 1 from public.ai_runs where user_id=new.user_id)
    then raise exception 'verification_allocation_invalid'; end if;
  return new;
end;
$$;
create trigger validate_live_verification_allocation before insert on public.live_verification_allocations
  for each row execute function public.validate_live_verification_allocation_v1();

create function public.enforce_live_verification_allocation_v1() returns trigger
language plpgsql security definer set search_path='' as $$
declare allocation public.live_verification_allocations; bucket public.usage_buckets;
begin
  select * into allocation from public.live_verification_allocations where user_id=new.user_id;
  if not found then return new; end if;
  select * into bucket from public.usage_buckets where id=allocation.account_bucket_id;
  if (select data_revision from public.profiles where user_id=new.user_id) is distinct from allocation.data_revision
    then raise exception 'verification_fixture_changed'; end if;
  -- prepare_step_v1 has already locked and incremented this bucket in the same
  -- transaction. Failure here rolls back the reservation and encrypted input.
  if new.account_bucket_id<>allocation.account_bucket_id or new.period_start<>allocation.period_start
    or allocation.period_start<>(date_trunc('month',clock_timestamp() at time zone 'UTC'))::date
    or bucket.spent_usd+bucket.reserved_usd>allocation.ceiling_usd
    then raise exception 'budget_exhausted'; end if;
  return new;
end;
$$;
create trigger enforce_live_verification_allocation before insert on public.usage_reservations
  for each row execute function public.enforce_live_verification_allocation_v1();
revoke all on function public.validate_live_verification_allocation_v1(),public.enforce_live_verification_allocation_v1() from public,anon,authenticated,service_role;
commit;

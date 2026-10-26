begin;

create or replace function public.update_settings_v1(p_request jsonb)
returns public.profiles
language plpgsql security definer set search_path = ''
as $$
declare
  owner_id uuid := auth.uid();
  current_profile public.profiles;
  changes jsonb;
  consent jsonb;
  request_id uuid;
  request_hash text;
  receipt jsonb;
  changed_at timestamptz;
  provider_id text;
  normalized_display_name text;
begin
  if owner_id is null then raise exception 'unauthorized'; end if;
  if jsonb_typeof(p_request) is distinct from 'object'
    or not (p_request ?& array['client_request_id','expected_updated_at','changes'])
    or (p_request - array['client_request_id','expected_updated_at','changes']) <> '{}'::jsonb
    or jsonb_typeof(p_request->'client_request_id') is distinct from 'string'
    or jsonb_typeof(p_request->'expected_updated_at') is distinct from 'string'
    or jsonb_typeof(p_request->'changes') is distinct from 'object'
  then raise exception 'invalid_settings'; end if;
  request_id := (p_request->>'client_request_id')::uuid;
  changes := p_request->'changes';
  if changes = '{}'::jsonb or (changes - array['display_name','timezone','units','provider_consent','monthly_spending_preference_usd']) <> '{}'::jsonb then raise exception 'invalid_settings'; end if;
  if changes ? 'display_name' then
    if jsonb_typeof(changes->'display_name') not in ('string','null') then raise exception 'invalid_settings'; end if;
    -- Match String.trim() at the direct RPC boundary; char_length matches Zod's code-point limit.
    normalized_display_name := btrim(changes->>'display_name', U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF');
    if normalized_display_name is not null then
      if char_length(normalized_display_name) not between 1 and 200 then raise exception 'invalid_settings'; end if;
    end if;
  end if;
  if changes ? 'timezone' and (jsonb_typeof(changes->'timezone') is distinct from 'string' or char_length(changes->>'timezone') > 100 or changes->>'timezone' = 'Factory' or not exists(select 1 from pg_catalog.pg_timezone_names where name = changes->>'timezone')) then raise exception 'invalid_settings'; end if;
  if changes ? 'units' and (jsonb_typeof(changes->'units') is distinct from 'string' or changes->>'units' not in ('metric','imperial')) then raise exception 'invalid_settings'; end if;
  if changes ? 'provider_consent' then
    consent := changes->'provider_consent';
    if jsonb_typeof(consent) is distinct from 'object' or not (consent ?& array['provider','accepted','policy_version'])
      or (consent - array['provider','accepted','policy_version']) <> '{}'::jsonb
      or jsonb_typeof(consent->'provider') is distinct from 'string'
      or consent->>'provider' not in ('openrouter','vertex_ai')
      or jsonb_typeof(consent->'accepted') is distinct from 'boolean'
      or jsonb_typeof(consent->'policy_version') is distinct from 'string'
      or char_length(consent->>'policy_version') not between 1 and 100
    then raise exception 'invalid_settings'; end if;
    provider_id := consent->>'provider';
    if (consent->>'accepted')::boolean and
      (provider_id <> 'openrouter' or consent->>'policy_version' <> 'openrouter_zdr_v1')
    then raise exception 'consent_policy_denied'; end if;
  end if;
  select * into current_profile from public.profiles where user_id = owner_id for update;
  if not found or current_profile.account_state <> 'active' then raise exception 'account_unavailable'; end if;
  request_hash := pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(p_request::text,'UTF8')),'hex');
  receipt := current_profile.preferences->'_settings_last_write';
  if receipt->>'request_id' = request_id::text then
    if receipt->>'request_hash' = request_hash then return current_profile; end if;
    raise exception 'settings_conflict';
  end if;
  if (p_request->>'expected_updated_at')::timestamptz is distinct from current_profile.updated_at then raise exception 'settings_conflict'; end if;
  if changes ? 'monthly_spending_preference_usd' then
    if jsonb_typeof(changes->'monthly_spending_preference_usd') not in ('string','null')
      or (changes->>'monthly_spending_preference_usd' is not null and
        (char_length(changes->>'monthly_spending_preference_usd')>80 or changes->>'monthly_spending_preference_usd' !~ '^(0|[1-9][0-9]*)(\.[0-9]+)?$')) then raise exception 'invalid_settings'; end if;
    perform 1 from public.usage_buckets where scope='household' and period_start=date_trunc('month',clock_timestamp() at time zone 'UTC')::date for update;
    perform 1 from public.usage_buckets where user_id=owner_id and scope='user' and period_start=date_trunc('month',clock_timestamp() at time zone 'UTC')::date for update;
    if changes->>'monthly_spending_preference_usd' is not null and not exists(select 1 from public.usage_buckets where user_id=owner_id and scope='user'
      and period_start=date_trunc('month',clock_timestamp() at time zone 'UTC')::date and allocated_ceiling_usd>=(changes->>'monthly_spending_preference_usd')::numeric) then raise exception 'invalid_settings'; end if;
    update public.usage_buckets set lower_preference_usd=(changes->>'monthly_spending_preference_usd')::numeric
      where user_id=owner_id and scope='user' and period_start=date_trunc('month',clock_timestamp() at time zone 'UTC')::date;
  end if;
  changed_at := greatest(clock_timestamp(), current_profile.updated_at + interval '1 microsecond');
  update public.profiles set
    display_name = case when changes ? 'display_name' then normalized_display_name else display_name end,
    timezone = coalesce(changes->>'timezone', timezone), units = coalesce(changes->>'units', units),
    consent_versions = case when consent is not null then jsonb_set(consent_versions, array[provider_id], jsonb_build_object(
      'accepted_version', case when (consent->>'accepted')::boolean then consent->>'policy_version' else null end,
      'accepted_at', case when (consent->>'accepted')::boolean then changed_at else null end
    )) else consent_versions end,
    monthly_preference_usd = case when changes ? 'monthly_spending_preference_usd' then (changes->>'monthly_spending_preference_usd')::numeric else monthly_preference_usd end,
    preferences = jsonb_set(preferences, '{_settings_last_write}', jsonb_build_object('request_id',request_id,'request_hash',request_hash,'updated_at',changed_at)),
    updated_at = changed_at
  where user_id = owner_id returning * into current_profile;
  return current_profile;
end;
$$;
revoke all on function public.update_settings_v1(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.update_settings_v1(jsonb) to authenticated;

commit;

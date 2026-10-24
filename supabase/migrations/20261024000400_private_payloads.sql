begin;

create function public.store_private_payload_v1(p_payload jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  envelope public.private_payloads;
  owner_state text;
  ttl interval;
begin
  envelope := jsonb_populate_record(null::public.private_payloads, p_payload);
  select account_state into owner_state from public.profiles where user_id = envelope.user_id for update;
  if not found or owner_state <> 'active' then raise exception 'account_unavailable'; end if;
  ttl := case when envelope.purpose = 'import_staging' then interval '24 hours' else interval '7 days' end;
  if not isfinite(envelope.expires_at) or envelope.expires_at <= clock_timestamp() or envelope.expires_at > clock_timestamp() + ttl then raise exception 'invalid_expiry'; end if;
  insert into public.private_payloads(id,user_id,purpose,payload_version,encrypted_bytes,nonce,key_id,content_hash,encoding,encryption_algorithm,expires_at)
  values(envelope.id,envelope.user_id,envelope.purpose,envelope.payload_version,envelope.encrypted_bytes,envelope.nonce,envelope.key_id,envelope.content_hash,envelope.encoding,envelope.encryption_algorithm,envelope.expires_at);
  return envelope.id;
end;
$$;

create function public.cleanup_private_payloads_v1(p_owner uuid default null, p_batch_size integer default 100)
returns integer language plpgsql security definer set search_path = '' as $$
declare removed integer;
begin
  if p_batch_size is null or p_batch_size not between 1 and 100 then raise exception 'invalid_batch_size'; end if;
  with candidates as (
    select id from public.private_payloads where expires_at <= clock_timestamp() and (p_owner is null or user_id = p_owner)
    order by expires_at,id limit p_batch_size for update skip locked
  )
  delete from public.private_payloads where id in (select id from candidates);
  get diagnostics removed = row_count;
  return removed;
end;
$$;
revoke all on function public.store_private_payload_v1(jsonb) from public,anon,authenticated,service_role;
revoke all on function public.cleanup_private_payloads_v1(uuid,integer) from public,anon,authenticated,service_role;
grant execute on function public.store_private_payload_v1(jsonb) to service_role;
grant execute on function public.cleanup_private_payloads_v1(uuid,integer) to service_role;

commit;

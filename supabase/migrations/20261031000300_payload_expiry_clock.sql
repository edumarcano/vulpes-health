begin;
-- Encryption authenticates expiry, so obtain it from the validating database
-- before sealing bytes rather than changing the envelope after encryption.
create function public.private_payload_expiry_v1(p_purpose text) returns timestamptz
language sql volatile security invoker set search_path='' as $$
 select date_trunc('milliseconds',clock_timestamp()+case
   when p_purpose='import_staging' then interval '24 hours'
   when p_purpose in ('ai_request','ai_response','tool_input','tool_output','provider_state') then interval '7 days'
   else null end);
$$;
revoke all on function public.private_payload_expiry_v1(text) from public,anon,authenticated;
grant execute on function public.private_payload_expiry_v1(text) to service_role;
commit;

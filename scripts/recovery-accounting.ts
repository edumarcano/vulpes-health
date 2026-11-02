// Included in the same snapshot as the independent deletion journal. Requests
// authorized for deletion are excluded from both sides of reconciliation; shared
// allocations and all other owners' ledger/dispatch authority must match exactly.
// query_to_xml permits a read-only fingerprint without creating source functions.
// A missing table or XML fingerprint yields SQL NULL, which capture/replay reject.
export const recoveryAccountingExpression=`(select case when count(*)=7 and count(fingerprint)=7
 and bool_and(fingerprint ~ '^[a-f0-9]{64}$')
 then encode(sha256(convert_to(jsonb_object_agg(tablename,fingerprint order by tablename)::text,'UTF8')),'hex') end
 from(select t.tablename,
 (xpath('/row/fingerprint/text()',query_to_xml(format(
 'select encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to(to_jsonb(r)::text,''UTF8'')),''hex''),'''' order by to_jsonb(r)::text),''''),''UTF8'')),''hex'') as fingerprint from public.%I r %s',t.tablename,
 case when t.tablename in ('ai_route_cost_blocks','vertex_policy_approval') then '' else 'where r.user_id is null or not exists(select 1 from public.account_deletion_receipts d where d.user_id=r.user_id)' end),false,true,'')))[1]::text as fingerprint
 from pg_tables t where t.schemaname='public' and t.tablename in ('usage_buckets','usage_reservations','live_verification_allocations','ai_runs','ai_steps','ai_route_cost_blocks','vertex_policy_approval')) fingerprints)`;

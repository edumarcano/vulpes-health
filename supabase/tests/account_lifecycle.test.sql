begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
select has_table('public','account_deletion_receipts','Deletion journal exists');
select ok((select relrowsecurity from pg_class where oid='public.account_deletion_receipts'::regclass),'Deletion journal has RLS');
select is((select count(*) from pg_constraint where conrelid='public.account_deletion_receipts'::regclass and contype='f'),0::bigint,'Journal outlives profile/Auth foreign keys');
select ok(not has_table_privilege(role_name,'public.account_deletion_receipts',privilege),'Journal denies direct '||role_name||' '||privilege)
 from unnest(array['anon','authenticated']) role_name cross join unnest(array['SELECT','INSERT','UPDATE','DELETE']) privilege;
select ok(not has_table_privilege('service_role','public.account_deletion_receipts',privilege),'Journal mutation requires narrow RPC: '||privilege) from unnest(array['INSERT','UPDATE','DELETE']) privilege;
select ok(has_function_privilege('service_role',signature,'EXECUTE'),signature||' permits trusted lifecycle operations') from unnest(array[
 'public.account_status_v1(uuid)','public.begin_account_deletion_v1(uuid,timestamptz)','public.continue_account_deletion_v1(uuid,integer)','public.finish_account_deletion_v1(uuid,boolean)',
 'public.account_export_manifest_v1(uuid)','public.read_account_export_v1(uuid,text,text)','public.cleanup_account_retention_v1(integer)','public.pending_account_deletions_v1(integer)','public.revoke_account_sessions_v1(uuid)']) signature;
select ok(not has_function_privilege(role_name,signature,'EXECUTE'),signature||' denies '||role_name) from unnest(array['anon','authenticated']) role_name cross join unnest(array[
 'public.account_status_v1(uuid)','public.begin_account_deletion_v1(uuid,timestamptz)','public.continue_account_deletion_v1(uuid,integer)','public.finish_account_deletion_v1(uuid,boolean)',
 'public.account_export_manifest_v1(uuid)','public.read_account_export_v1(uuid,text,text)','public.cleanup_account_retention_v1(integer)','public.pending_account_deletions_v1(integer)','public.revoke_account_sessions_v1(uuid)']) signature;
select ok(not has_function_privilege(role_name,'public.account_export_rows_v1(uuid,text)','EXECUTE'),'Internal export inventory denies '||role_name) from unnest(array['anon','authenticated','service_role']) role_name;
select is((select proconfig[1] from pg_proc where oid=signature::regprocedure),'search_path=""',signature||' pins search path') from unnest(array[
 'public.account_status_v1(uuid)','public.begin_account_deletion_v1(uuid,timestamptz)','public.continue_account_deletion_v1(uuid,integer)','public.finish_account_deletion_v1(uuid,boolean)',
 'public.account_export_manifest_v1(uuid)','public.read_account_export_v1(uuid,text,text)','public.cleanup_account_retention_v1(integer)','public.pending_account_deletions_v1(integer)','public.revoke_account_sessions_v1(uuid)','public.owned_session_valid_v1()']) signature;
select throws_ok('select public.continue_account_deletion_v1(gen_random_uuid(),101)','P0001','invalid_batch_size','Deletion batches cannot exceed 100');
select throws_ok('select public.cleanup_account_retention_v1(0)','P0001','invalid_batch_size','Retention rejects empty batch sizes');
select is(public.owned_session_valid_v1(),false,'No JWT session cannot establish recovery access');
select * from finish();
rollback;

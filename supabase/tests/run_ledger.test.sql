begin;
create extension if not exists pgtap with schema extensions;
set local search_path=public,extensions;
select no_plan();
create temporary table ledger_rpc(signature text primary key,service_access boolean);
insert into ledger_rpc values
 ('public.lock_run_v1(uuid,uuid,uuid,bigint,boolean)',false),
 ('public.record_step_completion_v1(uuid,uuid,uuid,bigint,uuid,jsonb)',false),
 ('public.store_run_envelope_v1(uuid,jsonb,text)',false),
 ('public.run_summary_v1(uuid,uuid)',true),
 ('public.admit_run_v1(uuid,jsonb,uuid)',true),
 ('public.prepare_step_v1(uuid,uuid,uuid,bigint,jsonb,jsonb,jsonb)',true),
 ('public.authorize_send_v1(uuid,uuid,uuid,bigint,uuid,text)',true),
 ('public.heartbeat_run_v1(uuid,uuid,uuid,bigint)',true),
 ('public.checkpoint_step_v1(uuid,uuid,uuid,bigint,uuid,jsonb,jsonb)',true),
 ('public.settle_step_v1(uuid,uuid,uuid,jsonb,text)',true),
 ('public.cancel_run_v1(uuid,uuid)',true),
 ('public.finish_run_v1(uuid,uuid,uuid,text)',true),
 ('public.reconcile_runs_v1(uuid,integer)',true),
 ('public.record_step_usage_v1(uuid,uuid,uuid,bigint,uuid,jsonb,jsonb)',false);
select ok(not has_function_privilege(role_name,signature,'EXECUTE'),signature||' denies '||role_name)
 from ledger_rpc cross join unnest(array['anon','authenticated']) role_name;
select is(has_function_privilege('service_role',signature,'EXECUTE'),service_access,signature||' has narrow server grant') from ledger_rpc;
select is((select proconfig[1] from pg_proc where oid=signature::regprocedure),'search_path=""',signature||' pins empty search path') from ledger_rpc;
select ok((select prosecdef from pg_proc where oid=signature::regprocedure),signature||' has reviewed definer authorization') from ledger_rpc;
select ok(has_function_privilege('authenticated','public.read_budget_v1()','EXECUTE'),'owned budget read available to authenticated users');
select ok(not has_function_privilege('anon','public.read_budget_v1()','EXECUTE'),'owned budget read denies anonymous users');
select ok(not has_function_privilege('service_role','public.read_budget_v1()','EXECUTE'),'owned budget read has no administrative owner override');
select has_column('public','ai_runs','executor_hash','executor capabilities are stored as hashes');
select has_column('public','ai_runs','fence','run writes have a persistent fence');
select has_column('public','ai_runs','accounting_period','run retains its original month');
select col_type_is('public','ai_runs','max_cost_usd','numeric','run ceiling uses decimal storage');
select has_column('public','ai_steps','dispatch_state','step dispatch is separate from termination');
select has_column('public','ai_steps','request_body_hash','dispatch binds captured bytes');
select has_column('public','ai_steps','usage_payload_id','raw usage has an encrypted evidence reference');
select has_column('public','usage_reservations','uncertain_since','uncertain holds have a durable deadline');
select has_column('public','usage_reservations','evidence_version','corrections use optimistic settlement versions');
select has_column('public','messages','context_state','deleted evidence can be excluded from future context');
select has_column('public','ai_steps','effective_model_id','provider-reported model remains distinct from requested model');
select * from finish();
rollback;

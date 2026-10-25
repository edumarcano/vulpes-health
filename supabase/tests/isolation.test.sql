begin;
create extension if not exists pgtap with schema extensions;
set local search_path = public, extensions;
select no_plan();

create temporary table expected_tables(name text primary key, readable boolean not null);
insert into expected_tables values
  ('profiles', true), ('data_sources', true), ('import_batches', true), ('measurements', true),
  ('goals', true), ('goal_revisions', true), ('conversations', true), ('messages', true),
  ('action_proposals', true), ('ai_runs', true), ('ai_steps', true), ('private_payloads', false),
  ('usage_buckets', false), ('usage_reservations', false), ('audit_events', false);

select has_table('public', name, name || ' exists') from expected_tables order by name;
select ok(c.relrowsecurity, t.name || ' enables RLS')
from expected_tables t join pg_class c on c.oid = format('public.%I', t.name)::regclass;
select col_not_null('public', name, 'user_id', name || ' has a nonnull owner') from expected_tables where name <> 'usage_buckets';
select ok(exists (
  select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f' and c.conrelid = 'public.profiles'::regclass and c.confrelid = 'auth.users'::regclass and cardinality(c.conkey) = 1 and a.attname = 'user_id'
), 'profile identity references Auth');
select ok(exists (
  select 1 from pg_constraint c join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f' and c.conrelid = format('public.%I', t.name)::regclass and c.confrelid = 'public.profiles'::regclass and cardinality(c.conkey) = 1 and a.attname = 'user_id'
), name || ' references a real profile owner') from expected_tables t where name <> 'profiles';
select col_type_is('public', table_name, column_name, 'numeric', table_name || '.' || column_name || ' preserves decimal storage')
from (values ('measurements','canonical_value'), ('goals','target_value'), ('ai_runs','cost_usd'), ('ai_steps','cost_usd'),
  ('usage_buckets','allocated_ceiling_usd'), ('usage_buckets','lower_preference_usd'), ('usage_buckets','spent_usd'), ('usage_buckets','reserved_usd'),
  ('usage_reservations','amount_usd'), ('usage_reservations','known_cost_usd')) numeric_columns(table_name,column_name);
select ok(has_table_privilege('authenticated', format('public.%I', name), 'SELECT') = readable, name || ' explicit read grant') from expected_tables;
select ok(not has_table_privilege('anon', format('public.%I', name), 'SELECT'), name || ' denies anonymous read') from expected_tables;
select ok(not has_table_privilege(role_name, format('public.%I', name), privilege), name || ' denies ' || role_name || ' ' || privilege)
from expected_tables cross join (values ('anon'), ('authenticated')) roles(role_name)
cross join (values ('INSERT'), ('UPDATE'), ('DELETE'), ('TRUNCATE'), ('REFERENCES'), ('TRIGGER')) privileges(privilege);
select ok(not has_schema_privilege('authenticated', 'public', 'CREATE'), 'clients cannot create public objects');
select is((select count(*) from pg_proc p join pg_namespace n on p.pronamespace = n.oid where n.nspname = 'public' and p.prosecdef and p.proname not in ('update_settings_v1','store_private_payload_v1','cleanup_private_payloads_v1','add_measurement_v1','classify_import_v1','inspect_import_v1','register_import_v1','commit_import_v1','discard_import_v1')), 0::bigint, 'only reviewed feature security-definer functions exist');
select ok(has_function_privilege('authenticated',signature,'EXECUTE'),signature || ' permits authenticated users') from unnest(array['public.inspect_import_v1(jsonb,jsonb)','public.register_import_v1(uuid,text)','public.commit_import_v1(jsonb,text)','public.discard_import_v1(uuid)']) signature;
select ok(not has_function_privilege(role_name,signature,'EXECUTE'),signature || ' denies ' || role_name) from unnest(array['anon','service_role']) role_name cross join unnest(array['public.inspect_import_v1(jsonb,jsonb)','public.register_import_v1(uuid,text)','public.commit_import_v1(jsonb,text)','public.discard_import_v1(uuid)']) signature;
select ok(not has_function_privilege(role_name,signature,'EXECUTE'),signature || ' private helper denies ' || role_name) from unnest(array['anon','authenticated','service_role']) role_name cross join unnest(array['public.import_equal_key_v1(jsonb)','public.classify_import_v1(uuid,uuid,jsonb)']) signature;
select is((select proconfig[1] from pg_proc where oid=signature::regprocedure),'search_path=""',signature || ' pins empty search path') from unnest(array['public.inspect_import_v1(jsonb,jsonb)','public.register_import_v1(uuid,text)','public.commit_import_v1(jsonb,text)','public.discard_import_v1(uuid)']) signature;
select ok(has_function_privilege('authenticated',signature,'EXECUTE'),signature || ' permits authenticated users') from unnest(array['public.add_measurement_v1(jsonb)','public.read_data_v1(jsonb)']) signature;
select ok(not has_function_privilege(role_name,signature,'EXECUTE'),signature || ' denies ' || role_name) from unnest(array['anon','service_role']) role_name cross join unnest(array['public.add_measurement_v1(jsonb)','public.read_data_v1(jsonb)']) signature;
select is((select proconfig[1] from pg_proc where oid='public.add_measurement_v1(jsonb)'::regprocedure),'search_path=""','measurement mutation pins empty search path');
select ok(not (select prosecdef from pg_proc where oid='public.read_data_v1(jsonb)'::regprocedure),'measurement reads retain invoker RLS');
select ok(not has_function_privilege(role_name,signature,'EXECUTE'), signature || ' denies ' || role_name) from unnest(array['anon','authenticated']) role_name cross join unnest(array['public.store_private_payload_v1(jsonb)','public.cleanup_private_payloads_v1(uuid,integer)']) signature;
select ok(has_function_privilege('service_role',signature,'EXECUTE'), signature || ' allows service role') from unnest(array['public.store_private_payload_v1(jsonb)','public.cleanup_private_payloads_v1(uuid,integer)']) signature;
select ok(has_function_privilege('authenticated','public.update_settings_v1(jsonb)','EXECUTE'), 'authenticated can execute owned settings transaction');
select ok(not has_function_privilege(role_name,'public.update_settings_v1(jsonb)','EXECUTE'), 'settings transaction denies ' || role_name) from unnest(array['anon','service_role']) role_name;
select is((select proconfig[1] from pg_proc where oid = 'public.update_settings_v1(jsonb)'::regprocedure), 'search_path=""', 'settings transaction pins empty search path');
select ok(not has_table_privilege('service_role', 'public.goal_revisions', 'UPDATE'), 'trusted client cannot rewrite immutable revisions');

create temporary table expected_links(child text, child_columns text[], parent text, parent_columns text[]);
insert into expected_links values
  ('import_batches', array['user_id','source_id'], 'data_sources', array['user_id','id']),
  ('import_batches', array['user_id','staging_payload_id'], 'private_payloads', array['user_id','id']),
  ('measurements', array['user_id','source_id'], 'data_sources', array['user_id','id']),
  ('measurements', array['user_id','import_batch_id'], 'import_batches', array['user_id','id']),
  ('ai_runs', array['user_id','conversation_id'], 'conversations', array['user_id','id']),
  ('messages', array['user_id','conversation_id'], 'conversations', array['user_id','id']),
  ('messages', array['user_id','run_id','conversation_id'], 'ai_runs', array['user_id','id','conversation_id']),
  ('goals', array['user_id','source_id'], 'data_sources', array['user_id','id']),
  ('goals', array['user_id','current_revision_id','id'], 'goal_revisions', array['user_id','id','goal_id']),
  ('action_proposals', array['user_id','target_id'], 'goals', array['user_id','id']),
  ('action_proposals', array['user_id','source_run_id'], 'ai_runs', array['user_id','id']),
  ('goal_revisions', array['user_id','goal_id'], 'goals', array['user_id','id']),
  ('goal_revisions', array['user_id','approved_proposal_id'], 'action_proposals', array['user_id','id']),
  ('goal_revisions', array['user_id','previous_revision_id','goal_id'], 'goal_revisions', array['user_id','id','goal_id']),
  ('ai_steps', array['user_id','run_id'], 'ai_runs', array['user_id','id']),
  ('ai_steps', array['user_id','input_payload_id'], 'private_payloads', array['user_id','id']),
  ('ai_steps', array['user_id','output_payload_id'], 'private_payloads', array['user_id','id']),
  ('usage_reservations', array['user_id','run_id'], 'ai_runs', array['user_id','id']),
  ('usage_reservations', array['user_id','step_id','run_id'], 'ai_steps', array['user_id','id','run_id']),
  ('usage_reservations', array['user_id','user_bucket_id','period_start'], 'usage_buckets', array['user_id','id','period_start']),
  ('usage_reservations', array['household_bucket_id','household_scope','period_start'], 'usage_buckets', array['id','scope','period_start']);
select ok(exists (
  select 1 from pg_constraint c
  where c.contype = 'f' and c.conrelid = format('public.%I', e.child)::regclass and c.confrelid = format('public.%I', e.parent)::regclass
  and (select array_agg(a.attname::text order by k.ord) from unnest(c.conkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.num) = e.child_columns
  and (select array_agg(a.attname::text order by k.ord) from unnest(c.confkey) with ordinality k(num,ord) join pg_attribute a on a.attrelid = c.confrelid and a.attnum = k.num) = e.parent_columns
), e.child || ' has expected composite parent ' || array_to_string(e.child_columns, ',')) from expected_links e;

create temporary table fixture_ids (
  user_id uuid primary key default gen_random_uuid(),
  source_id uuid not null default gen_random_uuid(),
  payload_id uuid not null default gen_random_uuid(),
  batch_id uuid not null default gen_random_uuid(),
  measurement_id uuid not null default gen_random_uuid(),
  conversation_id uuid not null default gen_random_uuid(),
  run_id uuid not null default gen_random_uuid(),
  step_id uuid not null default gen_random_uuid(),
  goal_id uuid not null default gen_random_uuid(),
  proposal_id uuid not null default gen_random_uuid(),
  revision_id uuid not null default gen_random_uuid(),
  previous_proposal_id uuid not null default gen_random_uuid(),
  previous_revision_id uuid not null default gen_random_uuid(),
  bucket_id uuid not null default gen_random_uuid(),
  label text not null
);
insert into fixture_ids(label) values ('A'), ('B');
grant select on fixture_ids, expected_tables to authenticated, service_role;

insert into auth.users(id, email) select user_id, 'pr03-db-' || user_id || '@example.test' from fixture_ids;
insert into public.profiles(user_id, display_name) select user_id, 'Synthetic ' || label from fixture_ids;
insert into public.data_sources(id, user_id, kind, label, source_namespace) select source_id, user_id, 'manual', 'Synthetic scale', 'synthetic-scale' from fixture_ids;
insert into public.private_payloads(id, user_id, purpose, encrypted_bytes, nonce, key_id, content_hash, encoding, expires_at)
select payload_id, user_id, 'ai_request', decode(repeat('00',16),'hex'), decode(repeat('00',12),'hex'), 'synthetic-envelope', repeat('a',64), 'identity', now() + interval '1 hour' from fixture_ids;
insert into public.import_batches(id, user_id, source_id, file_hash, mapping_hash, payload_hash, staging_payload_id)
select batch_id, user_id, source_id, repeat('a',64), repeat('a',64), repeat('a',64), payload_id from fixture_ids;
insert into public.measurements(id, user_id, source_id, import_batch_id, metric_key, canonical_value, canonical_unit, original_value, original_unit, observed_at, granularity, fingerprint)
select measurement_id, user_id, source_id, batch_id, 'weight', 70, 'kg', '70', 'kg', '2026-10-01T12:00:00Z', 'instant', repeat('a',64) from fixture_ids;
insert into public.conversations(id, user_id, title) select conversation_id, user_id, 'Synthetic conversation' from fixture_ids;
insert into public.ai_runs(id, user_id, conversation_id, client_request_id, request_hash, requested_depth, policy_version)
select run_id, user_id, conversation_id, gen_random_uuid(), repeat('a',64), 'everyday', 'synthetic-v1' from fixture_ids;
insert into public.messages(user_id, conversation_id, run_id, role, content_parts, status)
select user_id, conversation_id, run_id, 'user', '[{"type":"text","text":"Synthetic only"}]', 'completed' from fixture_ids;
insert into public.ai_steps(id, user_id, run_id, sequence, step_type, status, input_payload_id, output_payload_id)
select step_id, user_id, run_id, 1, 'generation', 'started', payload_id, payload_id from fixture_ids;
insert into public.goals(id, user_id, title, metric_key, canonical_unit, direction, target_value, source_id)
select goal_id, user_id, 'Synthetic draft', 'weight', 'kg', 'decrease_to', 69, source_id from fixture_ids;
insert into public.action_proposals(id, user_id, kind, target_id, target_version, canonical_payload, payload_hash, summary, source_run_id, expires_at, state)
select proposal_id, user_id, 'goal.revise', goal_id, 1, '{"schemaVersion":1}'::jsonb, repeat('a',64), 'Synthetic proposal', run_id, now() + interval '1 hour', 'approved' from fixture_ids
union all
select previous_proposal_id, user_id, 'goal.create', null, null, '{"schemaVersion":1}'::jsonb, repeat('a',64), 'Synthetic initial proposal', run_id, now() + interval '1 hour', 'approved' from fixture_ids;
insert into public.goal_revisions(id, user_id, goal_id, revision_number, approved_proposal_id, payload)
select previous_revision_id, user_id, goal_id, 1, previous_proposal_id, '{"schemaVersion":1}' from fixture_ids;
insert into public.goal_revisions(id, user_id, goal_id, revision_number, previous_revision_id, approved_proposal_id, payload)
select revision_id, user_id, goal_id, 2, previous_revision_id, proposal_id, '{"schemaVersion":1}' from fixture_ids;
update public.goals g set current_revision_id = f.revision_id from fixture_ids f where g.user_id = f.user_id;
insert into public.usage_buckets(id, user_id, scope, period_start, allocated_ceiling_usd, lower_preference_usd)
select bucket_id, user_id, 'user', '2026-10-01', 10, 5 from fixture_ids;
insert into public.usage_buckets(scope, period_start, allocated_ceiling_usd) values ('household', '2026-10-01', 20), ('household', '2026-11-01', 20);
insert into public.usage_reservations(user_id, run_id, step_id, user_bucket_id, household_bucket_id, period_start, amount_usd)
select user_id, run_id, step_id, bucket_id, (select id from public.usage_buckets where scope = 'household' and period_start = '2026-10-01'), '2026-10-01', 0.1 from fixture_ids;
insert into public.audit_events(user_id, event_type, object_id) select user_id, 'synthetic_fixture', measurement_id from fixture_ids;

-- Exercise the actual relational constraints as database owner, independently of RLS or grants.
with foreign_keys as (
  select format('public.%I', child) as child, format('public.%I', parent) as parent,
    child_columns[k] as child_key, parent_columns[k] as parent_key
  from expected_links cross join lateral (select min(i) as k from generate_subscripts(child_columns, 1) i where child_columns[i] <> 'user_id') chosen_key
)
select throws_ok(format('update %s set %I = (select %I from %s where user_id = %L and %I is not null limit 1) where id = (select id from %s where user_id = %L and %I is not null limit 1)',
  child, child_key, parent_key, parent, b.user_id, parent_key, child, a.user_id, child_key), '23503', null, child || '.' || child_key || ' rejects foreign owner/scope')
from foreign_keys cross join fixture_ids a cross join fixture_ids b where a.label = 'A' and b.label = 'B';

select throws_ok(format('update public.measurements set canonical_value = %L where user_id = %L', invalid, user_id), '23514', null, 'rejects nonfinite/invalid weight ' || invalid)
from fixture_ids cross join (values ('NaN'), ('Infinity'), ('-Infinity'), ('0'), ('-1')) values_to_reject(invalid) where label = 'A';
select throws_ok(format('update public.measurements set canonical_unit = ''lb'' where user_id = %L', user_id), '23514', null, 'canonical unit must match metric') from fixture_ids where label = 'A';
select throws_ok(format('update public.measurements set observed_at = ''infinity'' where user_id = %L', user_id), '23514', null, 'rejects infinite timestamp') from fixture_ids where label = 'A';
select throws_ok(format('update public.measurements set granularity = ''daily_total'' where user_id = %L', user_id), '23514', null, 'daily summaries require local date/timezone') from fixture_ids where label = 'A';
select throws_ok(format('update public.measurements set metric_key = ''steps_daily'', canonical_unit = ''count'' where user_id = %L', user_id), '23514', null, 'steps require daily granularity') from fixture_ids where label = 'A';
select throws_ok(format('update public.measurements set metric_key = ''sleep_duration'', canonical_unit = ''min'' where user_id = %L', user_id), '23514', null, 'sleep is not an instantaneous sample') from fixture_ids where label = 'A';
select throws_ok(format('update public.measurements set start_at = now(), end_at = now() - interval ''1 hour'' where user_id = %L', user_id), '23514', null, 'rejects reversed interval') from fixture_ids where label = 'A';
select throws_ok(format('update public.measurements set version = 0 where user_id = %L', user_id), '23514', null, 'versions are positive') from fixture_ids where label = 'A';
select throws_ok(format('update public.measurements set provenance = ''{}'' where user_id = %L', user_id), '23514', null, 'provenance requires its schema version') from fixture_ids where label = 'A';
select throws_ok(format('update public.profiles set deletion_progress = ''{}'' where user_id = %L', user_id), '23514', null, 'deletion progress requires its schema version') from fixture_ids where label = 'A';
select throws_ok(format('update public.goals set source_policy = ''{}'' where user_id = %L', user_id), '23514', null, 'source policy requires its schema version') from fixture_ids where label = 'A';
select throws_ok(format('update public.goals set target_value = -1 where user_id = %L', user_id), '23514', null, 'goal target obeys hard metric representation') from fixture_ids where label = 'A';
select throws_ok(format('update public.goals set direction = ''maintain_range'', target_value = null, target_lower = 71, target_upper = 69 where user_id = %L', user_id), '23514', null, 'goal range is ordered') from fixture_ids where label = 'A';
select throws_ok(format('update public.goals set state = ''active'', current_revision_id = null where user_id = %L', user_id), '23514', null, 'active goal requires an approved revision reference') from fixture_ids where label = 'A';
select throws_ok(format('insert into public.goals(user_id,title,metric_key,canonical_unit,direction,target_value,source_id,current_revision_id) values (%L,''Another synthetic goal'',''weight'',''kg'',''decrease_to'',69,%L,%L)', user_id, source_id, revision_id), '23503', null, 'current revision must belong to this goal even for same owner') from fixture_ids where label = 'A';
select throws_ok(format('insert into public.measurements(user_id,source_id,metric_key,canonical_value,canonical_unit,original_value,original_unit,observed_at,granularity,fingerprint) values (%L,%L,''weight'',70,''kg'',''70'',''kg'',now(),''instant'',%L)', user_id,source_id,repeat('a',64)), '23505', null, 'fingerprints are tenant unique') from fixture_ids where label = 'A';
select lives_ok(format('update public.measurements set external_record_id = ''synthetic-record'' where user_id = %L', user_id), 'external ID can be equal in separate tenants') from fixture_ids;
select throws_ok(format('insert into public.measurements(user_id,source_id,metric_key,canonical_value,canonical_unit,original_value,original_unit,observed_at,granularity,fingerprint,external_record_id) values (%L,%L,''weight'',71,''kg'',''71'',''kg'',now(),''instant'',%L,''synthetic-record'')', user_id,source_id,repeat('b',64)), '23505', null, 'changed value cannot duplicate external identity') from fixture_ids where label = 'A';
select lives_ok(format('update public.import_batches set status = ''committed'', committed_at = now() where user_id = %L', user_id), 'valid batch commit representation') from fixture_ids;
select throws_ok(format('insert into public.import_batches(user_id,source_id,file_hash,mapping_hash,payload_hash,status,committed_at) values (%L,%L,%L,%L,%L,''committed'',now())', user_id,source_id,repeat('a',64),repeat('a',64),repeat('a',64)), '23505', null, 'cannot double commit file/mapping identity') from fixture_ids where label = 'A';
select lives_ok(format('insert into public.import_batches(user_id,source_id,file_hash,mapping_hash,payload_hash,status) values (%L,%L,%L,%L,%L,''expired'')', user_id,source_id,repeat('a',64),repeat('a',64),repeat('a',64)), 'expired preview does not block re-preview') from fixture_ids where label = 'A';
select throws_ok(format('insert into public.ai_runs(user_id,conversation_id,client_request_id,request_hash,requested_depth,policy_version,status,finished_at) select user_id,conversation_id,client_request_id,request_hash,requested_depth,policy_version,''completed'',now() from public.ai_runs where user_id = %L', user_id), '23505', null, 'rejects duplicate send identity independently of active-run index') from fixture_ids where label = 'A';
select throws_ok(format('insert into public.ai_runs(user_id,conversation_id,client_request_id,request_hash,requested_depth,policy_version) values (%L,%L,gen_random_uuid(),%L,''auto'',''synthetic'')', user_id,conversation_id,repeat('a',64)), '23505', null, 'one admitted run per user') from fixture_ids where label = 'A';
select throws_ok(format('insert into public.ai_steps(user_id,run_id,sequence,step_type,status) values (%L,%L,1,''tool'',''started'')', user_id,run_id), '23505', null, 'one sequence number per run') from fixture_ids where label = 'A';
select throws_ok(format('update public.usage_buckets set lower_preference_usd = 11 where user_id = %L', user_id), '23514', null, 'preference cannot exceed allocation') from fixture_ids where label = 'A';
select throws_ok('insert into public.usage_buckets(scope,period_start,allocated_ceiling_usd) values (''household'',''2026-10-01'',20)', '23505', null, 'one household bucket per UTC month');
select throws_ok(format('update public.usage_reservations set period_start = ''2026-11-01'' where user_id = %L', user_id), '23503', null, 'reservation preserves admission period') from fixture_ids where label = 'A';
select throws_ok(format('update public.usage_reservations set household_bucket_id = (select id from public.usage_buckets where scope = ''household'' and period_start = ''2026-11-01'') where user_id = %L', user_id), '23503', null, 'household bucket period must also match') from fixture_ids where label = 'A';
select throws_ok(format('update public.usage_buckets set allocated_ceiling_usd = ''NaN'' where user_id = %L', user_id), '23514', null, 'money is finite') from fixture_ids where label = 'A';
select throws_ok(format('update public.usage_reservations set unknown_cost = false where user_id = %L', user_id), '23514', null, 'unknown usage is not fabricated as free') from fixture_ids where label = 'A';

-- Policy execution with actual authenticated database role and A/B JWT claims.
set local role authenticated;
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from fixture_ids where label = 'A'), 'role', 'authenticated')::text, true);
select results_eq(format('select distinct user_id::text from public.%I', name), array[(select user_id::text from fixture_ids where label = 'A')], name || ' RLS filters to A') from expected_tables where readable;
select set_config('request.jwt.claims', json_build_object('sub', (select user_id from fixture_ids where label = 'B'), 'role', 'authenticated')::text, true);
select results_eq(format('select distinct user_id::text from public.%I', name), array[(select user_id::text from fixture_ids where label = 'B')], name || ' RLS filters to B') from expected_tables where readable;
reset role;

-- Payload expiry cleanup may clear references, but must preserve ownership and metadata.
select lives_ok(format('delete from public.private_payloads where user_id = %L', user_id), 'payload cleanup is possible without deleting safe metadata') from fixture_ids where label = 'A';
select is((select count(*) from public.ai_steps s join fixture_ids f using(user_id) where f.label = 'A' and s.input_payload_id is null and s.output_payload_id is null), 1::bigint, 'step references clear without losing owner');
select is((select count(*) from public.import_batches b join fixture_ids f using(user_id) where f.label = 'A' and b.staging_payload_id is null), 2::bigint, 'staging references clear without losing owner');

create table public.future_grants_probe(id uuid);
select ok(not has_table_privilege(role_name, 'public.future_grants_probe', privilege), 'future table denies ' || role_name || ' ' || privilege)
from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name) cross join (values ('SELECT'), ('INSERT'), ('UPDATE'), ('DELETE')) privileges(privilege);
create function public.future_function_probe() returns integer language sql as 'select 1';
select ok(not has_function_privilege(role_name, 'public.future_function_probe()', 'EXECUTE'), 'future function denies ' || role_name)
from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name);
create sequence public.future_sequence_probe;
select ok(not has_sequence_privilege(role_name, 'public.future_sequence_probe', 'USAGE'), 'future sequence denies ' || role_name)
from (values ('anon'), ('authenticated'), ('service_role')) roles(role_name);
select * from finish();
rollback;

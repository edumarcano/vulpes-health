begin;

create table public.profiles (
  user_id uuid primary key references auth.users(id) on delete restrict,
  display_name text check (char_length(display_name) between 1 and 200),
  timezone text not null default 'UTC' check (char_length(timezone) between 1 and 100),
  units text not null default 'metric' check (units in ('metric', 'imperial')),
  preferences jsonb not null default '{}' check (jsonb_typeof(preferences) = 'object' and octet_length(preferences::text) <= 65536),
  consent_versions jsonb not null default '{}' check (jsonb_typeof(consent_versions) = 'object' and octet_length(consent_versions::text) <= 65536),
  data_revision bigint not null default 0 check (data_revision >= 0),
  account_state text not null default 'active' check (account_state in ('active', 'deleting')),
  deletion_progress jsonb not null default '{"schema_version":1}' check (jsonb_typeof(deletion_progress) = 'object' and deletion_progress @> '{"schema_version":1}' and octet_length(deletion_progress::text) <= 65536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.data_sources (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete restrict,
  kind text not null check (kind in ('manual', 'csv')),
  label text not null check (char_length(label) between 1 and 200),
  origin_app text,
  device_label text,
  measurement_method text not null default 'unknown' check (measurement_method in ('device_reported', 'device_estimate', 'user_reported', 'unknown')),
  source_namespace text not null check (char_length(source_namespace) between 1 and 200),
  created_at timestamptz not null default now(),
  unique (user_id, id),
  unique (user_id, source_namespace)
);

create table public.private_payloads (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete restrict,
  purpose text not null check (purpose in ('ai_request', 'ai_response', 'tool_input', 'tool_output', 'import_staging', 'provider_state')),
  payload_version integer not null default 1 check (payload_version > 0),
  encrypted_bytes bytea not null check (octet_length(encrypted_bytes) between 16 and 4194304),
  nonce bytea not null check (octet_length(nonce) = 12),
  key_id text not null check (char_length(key_id) between 1 and 200),
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  encoding text not null check (encoding in ('identity', 'gzip')),
  encryption_algorithm text not null default 'aes-256-gcm' check (encryption_algorithm = 'aes-256-gcm'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null check (isfinite(expires_at) and expires_at > created_at),
  unique (user_id, id)
);
create index private_payloads_expiry on public.private_payloads(expires_at, id);

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete restrict,
  source_id uuid not null,
  file_hash text not null check (file_hash ~ '^[0-9a-f]{64}$'),
  mapping_hash text not null check (mapping_hash ~ '^[0-9a-f]{64}$'),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  status text not null default 'previewed' check (status in ('previewed', 'committed', 'expired', 'failed')),
  observation_count integer not null default 0 check (observation_count between 0 and 5000),
  new_count integer not null default 0 check (new_count >= 0),
  duplicate_count integer not null default 0 check (duplicate_count >= 0),
  conflict_count integer not null default 0 check (conflict_count >= 0),
  staging_payload_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '24 hours') check (isfinite(expires_at) and expires_at > created_at),
  committed_at timestamptz,
  unique (user_id, id),
  foreign key (user_id, source_id) references public.data_sources(user_id, id) on delete restrict,
  foreign key (user_id, staging_payload_id) references public.private_payloads(user_id, id) on delete set null (staging_payload_id),
  check (new_count + duplicate_count + conflict_count <= observation_count),
  check ((status = 'committed') = (committed_at is not null))
);
create index import_batches_owner_time on public.import_batches(user_id, created_at, id);
create index import_batches_expiry on public.import_batches(expires_at, id);
-- An expired preview must not prevent a new preview. Only successful commits are unique.
create unique index import_batches_committed_identity on public.import_batches(user_id, source_id, file_hash, mapping_hash) where status = 'committed';

create table public.measurements (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete restrict,
  source_id uuid not null,
  import_batch_id uuid,
  metric_key text not null,
  canonical_value numeric not null check (canonical_value not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
  canonical_unit text not null,
  original_value text not null check (original_value ~ '\S'),
  original_unit text not null check (original_unit ~ '\S'),
  observed_at timestamptz not null check (isfinite(observed_at)),
  start_at timestamptz,
  end_at timestamptz,
  original_offset_minutes smallint check (original_offset_minutes between -840 and 840),
  timezone text check (char_length(timezone) between 1 and 100),
  local_date date check (isfinite(local_date)),
  granularity text not null check (granularity in ('instant', 'daily_total', 'session_total')),
  measurement_method text not null default 'unknown' check (measurement_method in ('device_reported', 'device_estimate', 'user_reported', 'unknown')),
  provenance jsonb not null default '{"schema_version":1}' check (jsonb_typeof(provenance) = 'object' and provenance @> '{"schema_version":1}' and octet_length(provenance::text) <= 65536),
  quality_flags text[] not null default '{}',
  external_record_id text check (char_length(external_record_id) between 1 and 500),
  fingerprint text not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  version integer not null default 1 check (version > 0),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, source_id) references public.data_sources(user_id, id) on delete restrict,
  foreign key (user_id, import_batch_id) references public.import_batches(user_id, id) on delete restrict,
  check ((metric_key, canonical_unit) in (('weight','kg'), ('body_fat_percent','%'), ('renpho.visceral_fat_index','index'), ('heart_rate','bpm'), ('resting_heart_rate','bpm'), ('height','cm'), ('steps_daily','count'), ('sleep_duration','min'))),
  check (case
    when metric_key in ('weight', 'height', 'heart_rate', 'resting_heart_rate') then canonical_value > 0
    when metric_key = 'body_fat_percent' then canonical_value between 0 and 100
    when metric_key = 'steps_daily' then canonical_value between 0 and 9007199254740991 and canonical_value = trunc(canonical_value)
    when metric_key = 'sleep_duration' then canonical_value >= 0
    else true end),
  check (granularity <> 'daily_total' or (local_date is not null and timezone is not null)),
  check (metric_key <> 'steps_daily' or granularity = 'daily_total'),
  check (metric_key <> 'sleep_duration' or granularity <> 'instant'),
  check ((start_at is null and end_at is null) or (start_at is not null and end_at is not null and isfinite(start_at) and isfinite(end_at) and start_at < end_at))
);
create index measurements_owner_source_time on public.measurements(user_id, source_id, metric_key, observed_at, id);
create unique index measurements_external_identity on public.measurements(user_id, source_id, external_record_id, metric_key) where external_record_id is not null;
create unique index measurements_fingerprint on public.measurements(user_id, fingerprint) where external_record_id is null;

create table public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete restrict,
  title text not null check (char_length(title) between 1 and 200),
  archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id)
);
create index conversations_owner_time on public.conversations(user_id, updated_at, id);

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete restrict,
  conversation_id uuid not null,
  client_request_id uuid not null,
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  requested_depth text not null check (requested_depth in ('auto', 'everyday', 'intermediate', 'advanced')),
  route jsonb check (jsonb_typeof(route) = 'object' and octet_length(route::text) <= 65536),
  status text not null default 'admitted' check (status in ('admitted', 'running', 'cancellation_requested', 'completed', 'failed', 'cancelled', 'interrupted')),
  limits jsonb not null default '{}' check (jsonb_typeof(limits) = 'object' and octet_length(limits::text) <= 65536),
  consent_versions jsonb not null default '{}' check (jsonb_typeof(consent_versions) = 'object' and octet_length(consent_versions::text) <= 65536),
  policy_version text not null,
  input_tokens bigint check (input_tokens >= 0),
  output_tokens bigint check (output_tokens >= 0),
  cost_usd numeric check (cost_usd >= 0 and cost_usd not in ('NaN'::numeric, 'Infinity'::numeric)),
  cost_status text not null default 'pending' check (cost_status in ('reported', 'estimated', 'pending', 'conservative')),
  admitted_at timestamptz not null default now(),
  started_at timestamptz,
  heartbeat_at timestamptz,
  cancellation_requested_at timestamptz,
  finished_at timestamptz,
  expires_at timestamptz not null default (now() + interval '90 days') check (isfinite(expires_at)),
  unique (user_id, id),
  unique (user_id, id, conversation_id),
  unique (user_id, client_request_id),
  foreign key (user_id, conversation_id) references public.conversations(user_id, id) on delete restrict,
  check ((status in ('completed', 'failed', 'cancelled', 'interrupted')) = (finished_at is not null))
);
create unique index ai_runs_one_active_per_user on public.ai_runs(user_id) where status in ('admitted', 'running', 'cancellation_requested');
create index ai_runs_owner_conversation on public.ai_runs(user_id, conversation_id, admitted_at, id);
create index ai_runs_expiry on public.ai_runs(expires_at, id);

create table public.messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete restrict,
  conversation_id uuid not null,
  role text not null check (role in ('user', 'assistant', 'tool', 'system')),
  content_parts jsonb not null check (jsonb_typeof(content_parts) = 'array' and octet_length(content_parts::text) <= 2097152),
  run_id uuid,
  status text not null check (status in ('streaming', 'completed', 'interrupted', 'failed')),
  created_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, conversation_id) references public.conversations(user_id, id) on delete restrict,
  foreign key (user_id, run_id, conversation_id) references public.ai_runs(user_id, id, conversation_id) on delete restrict
);
create index messages_owner_conversation on public.messages(user_id, conversation_id, created_at, id);

create table public.goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete restrict,
  title text not null check (char_length(title) between 1 and 200),
  metric_key text not null,
  canonical_unit text not null,
  direction text not null check (direction in ('increase_to', 'decrease_to', 'maintain_range')),
  target_value numeric,
  target_lower numeric,
  target_upper numeric,
  source_id uuid not null,
  source_policy jsonb not null default '{"schema_version":1}' check (jsonb_typeof(source_policy) = 'object' and source_policy @> '{"schema_version":1}' and octet_length(source_policy::text) <= 65536),
  baseline_snapshot jsonb check (jsonb_typeof(baseline_snapshot) = 'object' and octet_length(baseline_snapshot::text) <= 65536),
  current_revision_id uuid,
  version integer not null default 1 check (version > 0),
  state text not null default 'draft' check (state in ('draft', 'needs_data', 'active', 'paused', 'completed', 'archived')),
  review_status text not null default 'clear' check (review_status in ('clear', 'needs_review')),
  target_date date check (isfinite(target_date)),
  constraints jsonb not null default '[]' check (jsonb_typeof(constraints) = 'array' and octet_length(constraints::text) <= 65536),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, id),
  foreign key (user_id, source_id) references public.data_sources(user_id, id) on delete restrict,
  check ((metric_key, canonical_unit) in (('weight','kg'), ('body_fat_percent','%'), ('renpho.visceral_fat_index','index'), ('heart_rate','bpm'), ('resting_heart_rate','bpm'), ('height','cm'), ('steps_daily','count'), ('sleep_duration','min'))),
  check ((direction = 'maintain_range' and target_value is null and target_lower is not null and target_upper is not null and target_lower <= target_upper) or (direction <> 'maintain_range' and target_value is not null and target_lower is null and target_upper is null)),
  check (target_value is null or target_value not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
  check (target_lower is null or target_lower not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
  check (target_upper is null or target_upper not in ('NaN'::numeric, 'Infinity'::numeric, '-Infinity'::numeric)),
  check (case
    when metric_key in ('weight', 'height', 'heart_rate', 'resting_heart_rate') then coalesce(target_value, target_lower) > 0 and coalesce(target_value, target_upper) > 0
    when metric_key = 'body_fat_percent' then coalesce(target_value, target_lower) between 0 and 100 and coalesce(target_value, target_upper) between 0 and 100
    when metric_key = 'steps_daily' then coalesce(target_value, target_lower) between 0 and 9007199254740991 and coalesce(target_value, target_upper) between 0 and 9007199254740991 and coalesce(target_value, target_lower) = trunc(coalesce(target_value, target_lower)) and coalesce(target_value, target_upper) = trunc(coalesce(target_value, target_upper))
    when metric_key = 'sleep_duration' then coalesce(target_value, target_lower) >= 0 and coalesce(target_value, target_upper) >= 0
    else true end),
  check (state in ('draft', 'needs_data') or current_revision_id is not null)
);
create index goals_owner_state on public.goals(user_id, state, id);

create table public.action_proposals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete restrict,
  kind text not null check (kind in ('goal.create', 'goal.revise', 'goal.state')),
  target_id uuid,
  target_version integer check (target_version > 0),
  payload_version integer not null default 1 check (payload_version > 0),
  canonical_payload jsonb not null check (jsonb_typeof(canonical_payload) = 'object' and octet_length(canonical_payload::text) <= 2097152),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  state text not null default 'pending' check (state in ('pending', 'approved', 'rejected', 'expired', 'conflicted')),
  summary text not null,
  source_run_id uuid,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null check (isfinite(expires_at) and expires_at > created_at),
  unique (user_id, id),
  foreign key (user_id, target_id) references public.goals(user_id, id) on delete restrict,
  foreign key (user_id, source_run_id) references public.ai_runs(user_id, id) on delete restrict,
  check ((kind = 'goal.create' and target_id is null and target_version is null) or (kind <> 'goal.create' and target_id is not null and target_version is not null))
);
create index proposals_owner_state on public.action_proposals(user_id, state, created_at, id);
create index proposals_expiry on public.action_proposals(expires_at, id);

create table public.goal_revisions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete restrict,
  goal_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  previous_revision_id uuid,
  approved_proposal_id uuid not null,
  payload_version integer not null default 1 check (payload_version > 0),
  payload jsonb not null check (jsonb_typeof(payload) = 'object' and octet_length(payload::text) <= 2097152),
  approved_at timestamptz not null default now(),
  unique (user_id, id),
  unique (user_id, id, goal_id),
  unique (user_id, goal_id, revision_number),
  unique (user_id, approved_proposal_id),
  foreign key (user_id, goal_id) references public.goals(user_id, id) on delete no action deferrable initially immediate,
  foreign key (user_id, approved_proposal_id) references public.action_proposals(user_id, id) on delete restrict,
  foreign key (user_id, previous_revision_id, goal_id) references public.goal_revisions(user_id, id, goal_id) on delete no action deferrable initially immediate,
  check (previous_revision_id is null or previous_revision_id <> id)
);
alter table public.goals add constraint goals_current_revision_fkey foreign key (user_id, current_revision_id, id) references public.goal_revisions(user_id, id, goal_id) on delete no action deferrable initially immediate;

create table public.ai_steps (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete restrict,
  run_id uuid not null,
  sequence integer not null check (sequence > 0),
  step_type text not null check (step_type in ('generation', 'decision', 'tool')),
  status text not null check (status in ('started', 'completed', 'failed', 'cancelled', 'interrupted')),
  provider text,
  model_id text,
  adapter_version text,
  requested_effort text,
  effective_effort text,
  tool_name text,
  input_payload_id uuid,
  output_payload_id uuid,
  source_references jsonb not null default '[]' check (jsonb_typeof(source_references) = 'array' and octet_length(source_references::text) <= 65536),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  provider_request_id text,
  finish_reason text,
  input_tokens bigint check (input_tokens >= 0),
  output_tokens bigint check (output_tokens >= 0),
  reasoning_tokens bigint check (reasoning_tokens >= 0),
  cache_read_tokens bigint check (cache_read_tokens >= 0),
  cache_write_tokens bigint check (cache_write_tokens >= 0),
  raw_usage jsonb check (jsonb_typeof(raw_usage) = 'object' and octet_length(raw_usage::text) <= 65536),
  price_snapshot jsonb check (jsonb_typeof(price_snapshot) = 'object' and octet_length(price_snapshot::text) <= 65536),
  cost_usd numeric check (cost_usd >= 0 and cost_usd not in ('NaN'::numeric, 'Infinity'::numeric)),
  cost_status text not null default 'pending' check (cost_status in ('reported', 'estimated', 'pending', 'conservative')),
  unique (user_id, id),
  unique (user_id, id, run_id),
  unique (user_id, run_id, sequence),
  foreign key (user_id, run_id) references public.ai_runs(user_id, id) on delete restrict,
  foreign key (user_id, input_payload_id) references public.private_payloads(user_id, id) on delete set null (input_payload_id),
  foreign key (user_id, output_payload_id) references public.private_payloads(user_id, id) on delete set null (output_payload_id)
);

create table public.usage_buckets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles(user_id) on delete restrict,
  scope text not null check (scope in ('user', 'household')),
  period_start date not null check (isfinite(period_start) and extract(day from period_start) = 1),
  allocated_ceiling_usd numeric not null check (allocated_ceiling_usd >= 0 and allocated_ceiling_usd not in ('NaN'::numeric, 'Infinity'::numeric)),
  lower_preference_usd numeric check (lower_preference_usd >= 0 and lower_preference_usd <= allocated_ceiling_usd),
  spent_usd numeric not null default 0 check (spent_usd >= 0 and spent_usd not in ('NaN'::numeric, 'Infinity'::numeric)),
  reserved_usd numeric not null default 0 check (reserved_usd >= 0 and reserved_usd not in ('NaN'::numeric, 'Infinity'::numeric)),
  unique (user_id, id),
  unique (user_id, id, period_start),
  unique (id, scope, period_start),
  check ((scope = 'user' and user_id is not null) or (scope = 'household' and user_id is null and lower_preference_usd is null))
);
create unique index usage_buckets_user_period on public.usage_buckets(user_id, period_start) where scope = 'user';
create unique index usage_buckets_household_period on public.usage_buckets(period_start) where scope = 'household';

create table public.usage_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete restrict,
  run_id uuid not null,
  step_id uuid not null,
  period_start date not null,
  user_bucket_id uuid not null,
  household_bucket_id uuid not null,
  household_scope text generated always as ('household'::text) stored,
  amount_usd numeric not null check (amount_usd >= 0 and amount_usd not in ('NaN'::numeric, 'Infinity'::numeric)),
  status text not null default 'reserved' check (status in ('reserved', 'pending', 'settled')),
  known_cost_usd numeric check (known_cost_usd >= 0 and known_cost_usd not in ('NaN'::numeric, 'Infinity'::numeric)),
  unknown_cost boolean not null default true,
  created_at timestamptz not null default now(),
  settled_at timestamptz,
  unique (user_id, id),
  unique (user_id, step_id),
  foreign key (user_id, run_id) references public.ai_runs(user_id, id) on delete restrict,
  foreign key (user_id, step_id, run_id) references public.ai_steps(user_id, id, run_id) on delete restrict,
  foreign key (user_id, user_bucket_id, period_start) references public.usage_buckets(user_id, id, period_start) on delete restrict,
  foreign key (household_bucket_id, household_scope, period_start) references public.usage_buckets(id, scope, period_start) on delete restrict,
  check ((status = 'settled') = (settled_at is not null)),
  check (unknown_cost or known_cost_usd is not null)
);
create index reservations_owner_run on public.usage_reservations(user_id, run_id, id);

create table public.audit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(user_id) on delete restrict,
  event_type text not null check (char_length(event_type) between 1 and 100),
  object_id uuid,
  created_at timestamptz not null default now(),
  metadata_version integer not null default 1 check (metadata_version > 0),
  safe_metadata jsonb not null default '{}' check (jsonb_typeof(safe_metadata) = 'object' and octet_length(safe_metadata::text) <= 65536),
  unique (user_id, id)
);
create index audit_events_owner_time on public.audit_events(user_id, created_at, id);

-- Fail closed even if migration execution stops before the access migration.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'profiles', 'data_sources', 'import_batches', 'measurements', 'goals',
    'goal_revisions', 'conversations', 'messages', 'action_proposals', 'ai_runs',
    'ai_steps', 'private_payloads', 'usage_buckets', 'usage_reservations', 'audit_events'
  ] loop
    execute format('alter table public.%I enable row level security', table_name);
    execute format('revoke all on table public.%I from public, anon, authenticated, service_role', table_name);
  end loop;
end;
$$;

commit;

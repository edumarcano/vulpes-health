
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {

  "public": {
          Tables: {
            "account_deletion_receipts": {
                  Row: {
                    "completed_at": string | null,"id": string,"outcome": string,"phase": string,"requested_at": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "completed_at"?: string | null,"id"?: string,"outcome"?: string,"phase": string,"requested_at"?: string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "completed_at"?: string | null,"id"?: string,"outcome"?: string,"phase"?: string,"requested_at"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [

                  ]
                },"action_proposals": {
                  Row: {
                    "canonical_payload": Json | null,"created_at": string,"expires_at": string,"id": string,"kind": string,"payload_hash": string,"payload_version": number,"result": Json | null,"source_message_id": string | null,"source_run_id": string | null,"source_step_id": string | null,"state": string,"summary": string,"target_id": string | null,"target_version": number | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "canonical_payload"?: Json | null,"created_at"?: string,"expires_at": string,"id"?: string,"kind": string,"payload_hash": string,"payload_version"?: number,"result"?: Json | null,"source_message_id"?: string | null,"source_run_id"?: string | null,"source_step_id"?: string | null,"state"?: string,"summary": string,"target_id"?: string | null,"target_version"?: number | null,"user_id": string
                  }
                  Update: {
                    "canonical_payload"?: Json | null,"created_at"?: string,"expires_at"?: string,"id"?: string,"kind"?: string,"payload_hash"?: string,"payload_version"?: number,"result"?: Json | null,"source_message_id"?: string | null,"source_run_id"?: string | null,"source_step_id"?: string | null,"state"?: string,"summary"?: string,"target_id"?: string | null,"target_version"?: number | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "action_proposals_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "action_proposals_user_id_source_run_id_fkey"
      columns: ["user_id","source_run_id"]
isOneToOne: false
      referencedRelation: "ai_runs"
      referencedColumns: ["user_id","id"]
    },{
      foreignKeyName: "action_proposals_user_id_target_id_fkey"
      columns: ["user_id","target_id"]
isOneToOne: false
      referencedRelation: "goals"
      referencedColumns: ["user_id","id"]
    },{
      foreignKeyName: "proposal_source_message"
      columns: ["user_id","source_message_id"]
isOneToOne: false
      referencedRelation: "messages"
      referencedColumns: ["user_id","id"]
    },{
      foreignKeyName: "proposal_source_step"
      columns: ["user_id","source_step_id"]
isOneToOne: false
      referencedRelation: "ai_steps"
      referencedColumns: ["user_id","id"]
    }
                  ]
                },"ai_route_cost_blocks": {
                  Row: {
                    "blocked_at": string,"model_id": string,"provider": string
                  }
                  ComputedFields: never
                  Insert: {
                    "blocked_at"?: string,"model_id": string,"provider": string
                  }
                  Update: {
                    "blocked_at"?: string,"model_id"?: string,"provider"?: string
                  }
                  Relationships: [

                  ]
                },"ai_runs": {
                  Row: {
                    "accounting_period": string,"admitted_at": string,"cancellation_requested_at": string | null,"client_request_id": string,"consent_versions": NonNullable<Json>,"conversation_id": string | null,"cost_status": string,"cost_usd": number | null,"data_revision": number,"deadline_at": string,"executor_hash": string | null,"expires_at": string,"fence": number,"finished_at": string | null,"heartbeat_at": string | null,"id": string,"input_tokens": number | null,"lease_expires_at": string,"limits": NonNullable<Json>,"max_cost_usd": number,"output_tokens": number | null,"partial_output": boolean,"policy_version": string,"request_hash": string,"requested_depth": string,"route": Json | null,"route_history": NonNullable<Json>,"started_at": string | null,"status": string,"trace_content_removed_at": string | null,"trace_state": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "accounting_period"?: string,"admitted_at"?: string,"cancellation_requested_at"?: string | null,"client_request_id": string,"consent_versions"?: NonNullable<Json>,"conversation_id"?: string | null,"cost_status"?: string,"cost_usd"?: number | null,"data_revision"?: number,"deadline_at"?: string,"executor_hash"?: string | null,"expires_at"?: string,"fence"?: number,"finished_at"?: string | null,"heartbeat_at"?: string | null,"id"?: string,"input_tokens"?: number | null,"lease_expires_at"?: string,"limits"?: NonNullable<Json>,"max_cost_usd"?: number,"output_tokens"?: number | null,"partial_output"?: boolean,"policy_version": string,"request_hash": string,"requested_depth": string,"route"?: Json | null,"route_history"?: NonNullable<Json>,"started_at"?: string | null,"status"?: string,"trace_content_removed_at"?: string | null,"trace_state"?: string,"user_id": string
                  }
                  Update: {
                    "accounting_period"?: string,"admitted_at"?: string,"cancellation_requested_at"?: string | null,"client_request_id"?: string,"consent_versions"?: NonNullable<Json>,"conversation_id"?: string | null,"cost_status"?: string,"cost_usd"?: number | null,"data_revision"?: number,"deadline_at"?: string,"executor_hash"?: string | null,"expires_at"?: string,"fence"?: number,"finished_at"?: string | null,"heartbeat_at"?: string | null,"id"?: string,"input_tokens"?: number | null,"lease_expires_at"?: string,"limits"?: NonNullable<Json>,"max_cost_usd"?: number,"output_tokens"?: number | null,"partial_output"?: boolean,"policy_version"?: string,"request_hash"?: string,"requested_depth"?: string,"route"?: Json | null,"route_history"?: NonNullable<Json>,"started_at"?: string | null,"status"?: string,"trace_content_removed_at"?: string | null,"trace_state"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_runs_user_id_conversation_id_fkey"
      columns: ["user_id","conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["user_id","id"]
    },{
      foreignKeyName: "ai_runs_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"ai_steps": {
                  Row: {
                    "adapter_version": string | null,"cache_read_tokens": number | null,"cache_write_tokens": number | null,"context_payload_id": string | null,"continuation_payload_id": string | null,"cost_bound_state": string,"cost_status": string,"cost_usd": number | null,"dispatch_authorized_at": string | null,"dispatch_state": string,"effective_effort": string | null,"effective_model_id": string | null,"finish_reason": string | null,"finished_at": string | null,"id": string,"input_payload_id": string | null,"input_tokens": number | null,"model_id": string | null,"output_payload_id": string | null,"output_tokens": number | null,"price_snapshot": Json | null,"provider": string | null,"provider_request_id": string | null,"raw_usage": Json | null,"reasoning_tokens": number | null,"request_body_hash": string | null,"request_metadata": NonNullable<Json>,"requested_effort": string | null,"run_id": string,"sequence": number,"source_references": NonNullable<Json>,"started_at": string,"status": string,"step_type": string,"tool_name": string | null,"usage_payload_id": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "adapter_version"?: string | null,"cache_read_tokens"?: number | null,"cache_write_tokens"?: number | null,"context_payload_id"?: string | null,"continuation_payload_id"?: string | null,"cost_bound_state"?: string,"cost_status"?: string,"cost_usd"?: number | null,"dispatch_authorized_at"?: string | null,"dispatch_state"?: string,"effective_effort"?: string | null,"effective_model_id"?: string | null,"finish_reason"?: string | null,"finished_at"?: string | null,"id"?: string,"input_payload_id"?: string | null,"input_tokens"?: number | null,"model_id"?: string | null,"output_payload_id"?: string | null,"output_tokens"?: number | null,"price_snapshot"?: Json | null,"provider"?: string | null,"provider_request_id"?: string | null,"raw_usage"?: Json | null,"reasoning_tokens"?: number | null,"request_body_hash"?: string | null,"request_metadata"?: NonNullable<Json>,"requested_effort"?: string | null,"run_id": string,"sequence": number,"source_references"?: NonNullable<Json>,"started_at"?: string,"status": string,"step_type": string,"tool_name"?: string | null,"usage_payload_id"?: string | null,"user_id": string
                  }
                  Update: {
                    "adapter_version"?: string | null,"cache_read_tokens"?: number | null,"cache_write_tokens"?: number | null,"context_payload_id"?: string | null,"continuation_payload_id"?: string | null,"cost_bound_state"?: string,"cost_status"?: string,"cost_usd"?: number | null,"dispatch_authorized_at"?: string | null,"dispatch_state"?: string,"effective_effort"?: string | null,"effective_model_id"?: string | null,"finish_reason"?: string | null,"finished_at"?: string | null,"id"?: string,"input_payload_id"?: string | null,"input_tokens"?: number | null,"model_id"?: string | null,"output_payload_id"?: string | null,"output_tokens"?: number | null,"price_snapshot"?: Json | null,"provider"?: string | null,"provider_request_id"?: string | null,"raw_usage"?: Json | null,"reasoning_tokens"?: number | null,"request_body_hash"?: string | null,"request_metadata"?: NonNullable<Json>,"requested_effort"?: string | null,"run_id"?: string,"sequence"?: number,"source_references"?: NonNullable<Json>,"started_at"?: string,"status"?: string,"step_type"?: string,"tool_name"?: string | null,"usage_payload_id"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "ai_steps_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "ai_steps_user_id_input_payload_id_fkey"
      columns: ["user_id","input_payload_id"]
isOneToOne: false
      referencedRelation: "private_payloads"
      referencedColumns: ["user_id","id"]
    },{
      foreignKeyName: "ai_steps_user_id_output_payload_id_fkey"
      columns: ["user_id","output_payload_id"]
isOneToOne: false
      referencedRelation: "private_payloads"
      referencedColumns: ["user_id","id"]
    },{
      foreignKeyName: "ai_steps_user_id_run_id_fkey"
      columns: ["user_id","run_id"]
isOneToOne: false
      referencedRelation: "ai_runs"
      referencedColumns: ["user_id","id"]
    },{
      foreignKeyName: "steps_context_payload_fk"
      columns: ["user_id","context_payload_id"]
isOneToOne: false
      referencedRelation: "private_payloads"
      referencedColumns: ["user_id","id"]
    },{
      foreignKeyName: "steps_continuation_payload_fk"
      columns: ["user_id","continuation_payload_id"]
isOneToOne: false
      referencedRelation: "private_payloads"
      referencedColumns: ["user_id","id"]
    },{
      foreignKeyName: "steps_usage_payload_fk"
      columns: ["user_id","usage_payload_id"]
isOneToOne: false
      referencedRelation: "private_payloads"
      referencedColumns: ["user_id","id"]
    }
                  ]
                },"audit_events": {
                  Row: {
                    "created_at": string,"event_type": string,"id": string,"metadata_version": number,"object_id": string | null,"safe_metadata": NonNullable<Json>,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"event_type": string,"id"?: string,"metadata_version"?: number,"object_id"?: string | null,"safe_metadata"?: NonNullable<Json>,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"event_type"?: string,"id"?: string,"metadata_version"?: number,"object_id"?: string | null,"safe_metadata"?: NonNullable<Json>,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "audit_events_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"conversations": {
                  Row: {
                    "archived": boolean,"created_at": string,"id": string,"title": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived"?: boolean,"created_at"?: string,"id"?: string,"title": string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "archived"?: boolean,"created_at"?: string,"id"?: string,"title"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "conversations_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"data_sources": {
                  Row: {
                    "created_at": string,"device_label": string | null,"id": string,"kind": string,"label": string,"measurement_method": string,"origin_app": string | null,"source_namespace": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"device_label"?: string | null,"id"?: string,"kind": string,"label": string,"measurement_method"?: string,"origin_app"?: string | null,"source_namespace": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"device_label"?: string | null,"id"?: string,"kind"?: string,"label"?: string,"measurement_method"?: string,"origin_app"?: string | null,"source_namespace"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "data_sources_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"goal_revisions": {
                  Row: {
                    "approved_at": string,"approved_proposal_id": string,"goal_id": string,"id": string,"payload": NonNullable<Json>,"payload_version": number,"previous_revision_id": string | null,"revision_number": number,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "approved_at"?: string,"approved_proposal_id": string,"goal_id": string,"id"?: string,"payload": NonNullable<Json>,"payload_version"?: number,"previous_revision_id"?: string | null,"revision_number": number,"user_id": string
                  }
                  Update: {
                    "approved_at"?: string,"approved_proposal_id"?: string,"goal_id"?: string,"id"?: string,"payload"?: NonNullable<Json>,"payload_version"?: number,"previous_revision_id"?: string | null,"revision_number"?: number,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "goal_revisions_user_id_approved_proposal_id_fkey"
      columns: ["user_id","approved_proposal_id"]
isOneToOne: true
      referencedRelation: "action_proposals"
      referencedColumns: ["user_id","id"]
    },{
      foreignKeyName: "goal_revisions_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "goal_revisions_user_id_goal_id_fkey"
      columns: ["user_id","goal_id"]
isOneToOne: false
      referencedRelation: "goals"
      referencedColumns: ["user_id","id"]
    },{
      foreignKeyName: "goal_revisions_user_id_previous_revision_id_goal_id_fkey"
      columns: ["user_id","previous_revision_id","goal_id"]
isOneToOne: false
      referencedRelation: "goal_revisions"
      referencedColumns: ["user_id","id","goal_id"]
    }
                  ]
                },"goals": {
                  Row: {
                    "baseline_snapshot": Json | null,"canonical_unit": string,"constraints": NonNullable<Json>,"created_at": string,"current_revision_id": string | null,"direction": string,"id": string,"metric_key": string,"review_status": string,"source_id": string,"source_policy": NonNullable<Json>,"state": string,"target_date": string | null,"target_lower": number | null,"target_upper": number | null,"target_value": number | null,"title": string,"updated_at": string,"user_id": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "baseline_snapshot"?: Json | null,"canonical_unit": string,"constraints"?: NonNullable<Json>,"created_at"?: string,"current_revision_id"?: string | null,"direction": string,"id"?: string,"metric_key": string,"review_status"?: string,"source_id": string,"source_policy"?: NonNullable<Json>,"state"?: string,"target_date"?: string | null,"target_lower"?: number | null,"target_upper"?: number | null,"target_value"?: number | null,"title": string,"updated_at"?: string,"user_id": string,"version"?: number
                  }
                  Update: {
                    "baseline_snapshot"?: Json | null,"canonical_unit"?: string,"constraints"?: NonNullable<Json>,"created_at"?: string,"current_revision_id"?: string | null,"direction"?: string,"id"?: string,"metric_key"?: string,"review_status"?: string,"source_id"?: string,"source_policy"?: NonNullable<Json>,"state"?: string,"target_date"?: string | null,"target_lower"?: number | null,"target_upper"?: number | null,"target_value"?: number | null,"title"?: string,"updated_at"?: string,"user_id"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "goals_current_revision_fkey"
      columns: ["user_id","current_revision_id","id"]
isOneToOne: false
      referencedRelation: "goal_revisions"
      referencedColumns: ["user_id","id","goal_id"]
    },{
      foreignKeyName: "goals_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "goals_user_id_source_id_fkey"
      columns: ["user_id","source_id"]
isOneToOne: false
      referencedRelation: "data_sources"
      referencedColumns: ["user_id","id"]
    }
                  ]
                },"import_batches": {
                  Row: {
                    "committed_at": string | null,"conflict_count": number,"created_at": string,"duplicate_count": number,"expires_at": string,"file_hash": string,"id": string,"mapping_hash": string,"new_count": number,"observation_count": number,"payload_hash": string,"preview_data_revision": number,"result": Json | null,"source_hash": string | null,"source_id": string,"staging_payload_id": string | null,"status": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "committed_at"?: string | null,"conflict_count"?: number,"created_at"?: string,"duplicate_count"?: number,"expires_at"?: string,"file_hash": string,"id"?: string,"mapping_hash": string,"new_count"?: number,"observation_count"?: number,"payload_hash": string,"preview_data_revision"?: number,"result"?: Json | null,"source_hash"?: string | null,"source_id": string,"staging_payload_id"?: string | null,"status"?: string,"user_id": string
                  }
                  Update: {
                    "committed_at"?: string | null,"conflict_count"?: number,"created_at"?: string,"duplicate_count"?: number,"expires_at"?: string,"file_hash"?: string,"id"?: string,"mapping_hash"?: string,"new_count"?: number,"observation_count"?: number,"payload_hash"?: string,"preview_data_revision"?: number,"result"?: Json | null,"source_hash"?: string | null,"source_id"?: string,"staging_payload_id"?: string | null,"status"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "import_batches_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "import_batches_user_id_source_id_fkey"
      columns: ["user_id","source_id"]
isOneToOne: false
      referencedRelation: "data_sources"
      referencedColumns: ["user_id","id"]
    },{
      foreignKeyName: "import_batches_user_id_staging_payload_id_fkey"
      columns: ["user_id","staging_payload_id"]
isOneToOne: false
      referencedRelation: "private_payloads"
      referencedColumns: ["user_id","id"]
    }
                  ]
                },"live_verification_allocations": {
                  Row: {
                    "account_bucket_id": string,"ceiling_usd": number,"created_at": string,"data_revision": number,"fixture_hash": string,"id": string,"period_start": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_bucket_id": string,"ceiling_usd": number,"created_at"?: string,"data_revision": number,"fixture_hash": string,"id": string,"period_start": string,"user_id": string
                  }
                  Update: {
                    "account_bucket_id"?: string,"ceiling_usd"?: number,"created_at"?: string,"data_revision"?: number,"fixture_hash"?: string,"id"?: string,"period_start"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "live_verification_allocations_user_id_account_bucket_id_pe_fkey"
      columns: ["user_id","account_bucket_id","period_start"]
isOneToOne: false
      referencedRelation: "usage_buckets"
      referencedColumns: ["user_id","id","period_start"]
    },{
      foreignKeyName: "live_verification_allocations_user_id_fkey"
      columns: ["user_id"]
isOneToOne: true
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"measurements": {
                  Row: {
                    "canonical_unit": string,"canonical_value": number,"created_at": string,"deleted_at": string | null,"end_at": string | null,"external_record_id": string | null,"fingerprint": string,"granularity": string,"id": string,"import_batch_id": string | null,"local_date": string | null,"measurement_method": string,"metric_key": string,"observed_at": string,"original_offset_minutes": number | null,"original_unit": string,"original_value": string,"provenance": NonNullable<Json>,"quality_flags": (string)[],"source_id": string,"start_at": string | null,"timezone": string | null,"user_id": string,"version": number
                  }
                  ComputedFields: never
                  Insert: {
                    "canonical_unit": string,"canonical_value": number,"created_at"?: string,"deleted_at"?: string | null,"end_at"?: string | null,"external_record_id"?: string | null,"fingerprint": string,"granularity": string,"id"?: string,"import_batch_id"?: string | null,"local_date"?: string | null,"measurement_method"?: string,"metric_key": string,"observed_at": string,"original_offset_minutes"?: number | null,"original_unit": string,"original_value": string,"provenance"?: NonNullable<Json>,"quality_flags"?: (string)[],"source_id": string,"start_at"?: string | null,"timezone"?: string | null,"user_id": string,"version"?: number
                  }
                  Update: {
                    "canonical_unit"?: string,"canonical_value"?: number,"created_at"?: string,"deleted_at"?: string | null,"end_at"?: string | null,"external_record_id"?: string | null,"fingerprint"?: string,"granularity"?: string,"id"?: string,"import_batch_id"?: string | null,"local_date"?: string | null,"measurement_method"?: string,"metric_key"?: string,"observed_at"?: string,"original_offset_minutes"?: number | null,"original_unit"?: string,"original_value"?: string,"provenance"?: NonNullable<Json>,"quality_flags"?: (string)[],"source_id"?: string,"start_at"?: string | null,"timezone"?: string | null,"user_id"?: string,"version"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "measurements_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "measurements_user_id_import_batch_id_fkey"
      columns: ["user_id","import_batch_id"]
isOneToOne: false
      referencedRelation: "import_batches"
      referencedColumns: ["user_id","id"]
    },{
      foreignKeyName: "measurements_user_id_source_id_fkey"
      columns: ["user_id","source_id"]
isOneToOne: false
      referencedRelation: "data_sources"
      referencedColumns: ["user_id","id"]
    }
                  ]
                },"messages": {
                  Row: {
                    "client_request_id": string | null,"content_parts": NonNullable<Json>,"context_state": string,"conversation_id": string,"created_at": string,"id": string,"request_hash": string | null,"role": string,"run_id": string | null,"status": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "client_request_id"?: string | null,"content_parts": NonNullable<Json>,"context_state"?: string,"conversation_id": string,"created_at"?: string,"id"?: string,"request_hash"?: string | null,"role": string,"run_id"?: string | null,"status": string,"user_id": string
                  }
                  Update: {
                    "client_request_id"?: string | null,"content_parts"?: NonNullable<Json>,"context_state"?: string,"conversation_id"?: string,"created_at"?: string,"id"?: string,"request_hash"?: string | null,"role"?: string,"run_id"?: string | null,"status"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "messages_user_id_conversation_id_fkey"
      columns: ["user_id","conversation_id"]
isOneToOne: false
      referencedRelation: "conversations"
      referencedColumns: ["user_id","id"]
    },{
      foreignKeyName: "messages_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "messages_user_id_run_id_conversation_id_fkey"
      columns: ["user_id","run_id","conversation_id"]
isOneToOne: false
      referencedRelation: "ai_runs"
      referencedColumns: ["user_id","id","conversation_id"]
    }
                  ]
                },"private_payloads": {
                  Row: {
                    "content_hash": string,"created_at": string,"encoding": string,"encrypted_bytes": string,"encryption_algorithm": string,"expires_at": string,"id": string,"key_id": string,"nonce": string,"payload_version": number,"purpose": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "content_hash": string,"created_at"?: string,"encoding": string,"encrypted_bytes": string,"encryption_algorithm"?: string,"expires_at": string,"id"?: string,"key_id": string,"nonce": string,"payload_version"?: number,"purpose": string,"user_id": string
                  }
                  Update: {
                    "content_hash"?: string,"created_at"?: string,"encoding"?: string,"encrypted_bytes"?: string,"encryption_algorithm"?: string,"expires_at"?: string,"id"?: string,"key_id"?: string,"nonce"?: string,"payload_version"?: number,"purpose"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "private_payloads_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "account_state": string,"consent_versions": NonNullable<Json>,"created_at": string,"data_revision": number,"deletion_progress": NonNullable<Json>,"display_name": string | null,"monthly_preference_usd": number | null,"preferences": NonNullable<Json>,"timezone": string,"units": string,"updated_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_state"?: string,"consent_versions"?: NonNullable<Json>,"created_at"?: string,"data_revision"?: number,"deletion_progress"?: NonNullable<Json>,"display_name"?: string | null,"monthly_preference_usd"?: number | null,"preferences"?: NonNullable<Json>,"timezone"?: string,"units"?: string,"updated_at"?: string,"user_id": string
                  }
                  Update: {
                    "account_state"?: string,"consent_versions"?: NonNullable<Json>,"created_at"?: string,"data_revision"?: number,"deletion_progress"?: NonNullable<Json>,"display_name"?: string | null,"monthly_preference_usd"?: number | null,"preferences"?: NonNullable<Json>,"timezone"?: string,"units"?: string,"updated_at"?: string,"user_id"?: string
                  }
                  Relationships: [

                  ]
                },"usage_buckets": {
                  Row: {
                    "allocated_ceiling_usd": number,"id": string,"lower_preference_usd": number | null,"period_start": string,"reserved_usd": number,"scope": string,"spent_usd": number,"user_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "allocated_ceiling_usd": number,"id"?: string,"lower_preference_usd"?: number | null,"period_start": string,"reserved_usd"?: number,"scope": string,"spent_usd"?: number,"user_id"?: string | null
                  }
                  Update: {
                    "allocated_ceiling_usd"?: number,"id"?: string,"lower_preference_usd"?: number | null,"period_start"?: string,"reserved_usd"?: number,"scope"?: string,"spent_usd"?: number,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "usage_buckets_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    }
                  ]
                },"usage_reservations": {
                  Row: {
                    "account_bucket_id": string,"amount_usd": number,"app_bucket_id": string,"app_scope": string | null,"created_at": string,"evidence_hash": string | null,"evidence_version": number,"id": string,"known_cost_usd": number | null,"period_start": string,"run_id": string,"settled_at": string | null,"status": string,"step_id": string,"uncertain_since": string | null,"unknown_cost": boolean,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "account_bucket_id": string,"amount_usd": number,"app_bucket_id": string,"app_scope"?: never,"created_at"?: string,"evidence_hash"?: string | null,"evidence_version"?: number,"id"?: string,"known_cost_usd"?: number | null,"period_start": string,"run_id": string,"settled_at"?: string | null,"status"?: string,"step_id": string,"uncertain_since"?: string | null,"unknown_cost"?: boolean,"user_id": string
                  }
                  Update: {
                    "account_bucket_id"?: string,"amount_usd"?: number,"app_bucket_id"?: string,"app_scope"?: never,"created_at"?: string,"evidence_hash"?: string | null,"evidence_version"?: number,"id"?: string,"known_cost_usd"?: number | null,"period_start"?: string,"run_id"?: string,"settled_at"?: string | null,"status"?: string,"step_id"?: string,"uncertain_since"?: string | null,"unknown_cost"?: boolean,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "usage_reservations_account_bucket_fk"
      columns: ["user_id","account_bucket_id","period_start"]
isOneToOne: false
      referencedRelation: "usage_buckets"
      referencedColumns: ["user_id","id","period_start"]
    },{
      foreignKeyName: "usage_reservations_app_bucket_fk"
      columns: ["app_bucket_id","app_scope","period_start"]
isOneToOne: false
      referencedRelation: "usage_buckets"
      referencedColumns: ["id","scope","period_start"]
    },{
      foreignKeyName: "usage_reservations_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "profiles"
      referencedColumns: ["user_id"]
    },{
      foreignKeyName: "usage_reservations_user_id_run_id_fkey"
      columns: ["user_id","run_id"]
isOneToOne: false
      referencedRelation: "ai_runs"
      referencedColumns: ["user_id","id"]
    },{
      foreignKeyName: "usage_reservations_user_id_step_id_run_id_fkey"
      columns: ["user_id","step_id","run_id"]
isOneToOne: false
      referencedRelation: "ai_steps"
      referencedColumns: ["user_id","id","run_id"]
    }
                  ]
                },"vertex_policy_approval": {
                  Row: {
                    "id": boolean,"location": string,"notice": string,"policy_version": string,"privacy_fingerprint": string,"project": string
                  }
                  ComputedFields: never
                  Insert: {
                    "id"?: boolean,"location": string,"notice": string,"policy_version": string,"privacy_fingerprint": string,"project": string
                  }
                  Update: {
                    "id"?: boolean,"location"?: string,"notice"?: string,"policy_version"?: string,"privacy_fingerprint"?: string,"project"?: string
                  }
                  Relationships: [

                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "account_export_manifest_v1":
{ Args: { "p_owner": string }; Returns: Json
                           },
"account_export_rows_v1":
{ Args: { "p_owner": string,"p_section": string }; Returns: {
              "body": Json,"id": string
            }[]
                           },
"account_status_v1":
{ Args: { "p_owner": string }; Returns: Json
                           },
"add_measurement_v1":
{ Args: { "p_request": Json }; Returns: Json
                           },
"admit_chat_v1":
{ Args: { "p_executor": string,"p_message": Json,"p_owner": string,"p_request": Json }; Returns: Json
                           },
"admit_run_v1":
{ Args: { "p_executor": string,"p_owner": string,"p_request": Json }; Returns: Json
                           },
"authorize_send_v1":
{ Args: { "p_body_hash": string,"p_executor": string,"p_fence": number,"p_owner": string,"p_run": string,"p_step": string }; Returns: boolean
                           },
"baseline_chat_v1":
{ Args: { "p_executor": string,"p_fence": number,"p_owner": string,"p_run": string,"p_text": string }; Returns: Json
                           },
"begin_account_deletion_v1":
{ Args: { "p_owner": string,"p_password_at": string }; Returns: Json
                           },
"cancel_chat_v1":
{ Args: { "p_owner": string,"p_request": string,"p_run": string }; Returns: Json
                           },
"cancel_run_v1":
{ Args: { "p_owner": string,"p_run": string }; Returns: Json
                           },
"checkpoint_goal_proposal_v1":
{ Args: { "p_executor": string,"p_fence": number,"p_output": Json,"p_owner": string,"p_payload": Json,"p_request": Json,"p_run": string,"p_step": string }; Returns: Json
                           },
"checkpoint_message_v1":
{ Args: { "p_executor": string,"p_fence": number,"p_owner": string,"p_parts": Json,"p_run": string }; Returns: undefined
                           },
"checkpoint_step_v1":
{ Args: { "p_executor": string,"p_fence": number,"p_message"?: Json,"p_output": Json,"p_owner": string,"p_run": string,"p_step": string }; Returns: string
                           },
"classify_import_v1":
{ Args: { "p_owner": string,"p_rows": Json,"p_source": string }; Returns: Json
                           },
"cleanup_account_retention_v1":
{ Args: { "p_batch_size"?: number }; Returns: Json
                           },
"cleanup_data_v1":
{ Args: { "p_batch_size"?: number,"p_owner"?: string }; Returns: Json
                           },
"cleanup_private_payloads_v1":
{ Args: { "p_batch_size"?: number,"p_owner"?: string }; Returns: number
                           },
"commit_import_v1":
{ Args: { "p_bytes": string,"p_request": Json }; Returns: Json
                           },
"continue_account_deletion_v1":
{ Args: { "p_batch_size"?: number,"p_owner": string }; Returns: Json
                           },
"decide_goal_proposal_v1":
{ Args: { "p_owner": string,"p_request": Json }; Returns: Json
                           },
"discard_import_v1":
{ Args: { "p_batch_id": string }; Returns: undefined
                           },
"expire_goal_proposals_v1":
{ Args: { "p_owner": string }; Returns: undefined
                           },
"finish_account_deletion_v1":
{ Args: { "p_auth_absent": boolean,"p_owner": string }; Returns: Json
                           },
"finish_run_v1":
{ Args: { "p_executor": string,"p_owner": string,"p_run": string,"p_status": string }; Returns: Json
                           },
"handoff_flash_v1":
{ Args: { "p_executor": string,"p_fence": number,"p_owner": string,"p_reason": string,"p_run": string,"p_step": string }; Returns: Json
                           },
"heartbeat_run_v1":
{ Args: { "p_executor": string,"p_fence": number,"p_owner": string,"p_run": string }; Returns: Json
                           },
"import_equal_key_v1":
{ Args: { "r": Json }; Returns: Json
                           },
"inspect_import_v1":
{ Args: { "p_rows": Json,"p_source": Json }; Returns: Json
                           },
"lock_run_v1":
{ Args: { "p_content"?: boolean,"p_executor"?: string,"p_fence"?: number,"p_owner": string,"p_run": string }; Returns: {
              "accounting_period": string,
"admitted_at": string,
"cancellation_requested_at": string | null,
"client_request_id": string,
"consent_versions": NonNullable<Json>,
"conversation_id": string | null,
"cost_status": string,
"cost_usd": number | null,
"data_revision": number,
"deadline_at": string,
"executor_hash": string | null,
"expires_at": string,
"fence": number,
"finished_at": string | null,
"heartbeat_at": string | null,
"id": string,
"input_tokens": number | null,
"lease_expires_at": string,
"limits": NonNullable<Json>,
"max_cost_usd": number,
"output_tokens": number | null,
"partial_output": boolean,
"policy_version": string,
"request_hash": string,
"requested_depth": string,
"route": Json | null,
"route_history": NonNullable<Json>,
"started_at": string | null,
"status": string,
"trace_content_removed_at": string | null,
"trace_state": string,
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "ai_runs"
        isOneToOne: true
        isSetofReturn: false
      } },
"mutate_conversation_v1":
{ Args: { "p_owner": string,"p_request": Json }; Returns: Json
                           },
"mutate_measurement_v1":
{ Args: { "p_request": Json }; Returns: Json
                           },
"owned_session_valid_v1":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"pending_account_deletions_v1":
{ Args: { "p_batch_size"?: number }; Returns: string[]
                           },
"prepare_step_v1":
{ Args: { "p_context"?: Json,"p_executor": string,"p_fence": number,"p_input": Json,"p_owner": string,"p_run": string,"p_step": Json }; Returns: string
                           },
"read_account_export_v1":
{ Args: { "p_after"?: string,"p_owner": string,"p_section": string }; Returns: Json
                           },
"read_budget_v1":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"read_data_v1":
{ Args: { "p_query": Json }; Returns: Json
                           },
"read_export_v1":
{ Args: { "p_query": Json }; Returns: Json
                           },
"read_metric_inventory_v1":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"read_vertex_policy_v1":
{ Args: { "p_location": string,"p_project": string }; Returns: Json
                           },
"reconcile_runs_v1":
{ Args: { "p_batch_size"?: number,"p_owner"?: string }; Returns: Json
                           },
"record_step_completion_v1":
{ Args: { "p_completion": Json,"p_executor": string,"p_fence": number,"p_owner": string,"p_run": string,"p_step": string }; Returns: undefined
                           },
"record_step_usage_v1":
{ Args: { "p_executor": string,"p_fence": number,"p_owner": string,"p_payload": Json,"p_run": string,"p_step": string,"p_usage": Json }; Returns: string
                           },
"register_goal_proposal_v1":
{ Args: { "p_owner": string,"p_payload": Json,"p_request": Json }; Returns: string
                           },
"register_import_v1":
{ Args: { "p_bytes": string,"p_payload_id": string }; Returns: Json
                           },
"replay_chat_v1":
{ Args: { "p_message": Json,"p_owner": string,"p_request": Json }; Returns: Json
                           },
"revoke_account_sessions_v1":
{ Args: { "p_owner": string }; Returns: undefined
                           },
"run_summary_v1":
{ Args: { "p_owner": string,"p_run": string }; Returns: Json
                           },
"save_chat_state_v1":
{ Args: { "p_executor": string,"p_fence": number,"p_owner": string,"p_run": string,"p_state": Json,"p_step": string }; Returns: string
                           },
"settle_step_v1":
{ Args: { "p_evidence": Json,"p_owner": string,"p_run": string,"p_status": string,"p_step": string }; Returns: Json
                           },
"store_private_payload_v1":
{ Args: { "p_payload": Json }; Returns: string
                           },
"store_run_envelope_v1":
{ Args: { "p_envelope": Json,"p_owner": string,"p_purpose": string }; Returns: string
                           },
"update_settings_v1":
{ Args: { "p_request": Json }; Returns: {
              "account_state": string,
"consent_versions": NonNullable<Json>,
"created_at": string,
"data_revision": number,
"deletion_progress": NonNullable<Json>,
"display_name": string | null,
"monthly_preference_usd": number | null,
"preferences": NonNullable<Json>,
"timezone": string,
"units": string,
"updated_at": string,
"user_id": string
            }
                          SetofOptions: {
        from: "*"
        to: "profiles"
        isOneToOne: true
        isSetofReturn: false
      } }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {

          }
        }
} as const

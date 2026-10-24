# Contract references

`domain.ts` and `stream.ts` are original TypeScript reference contracts. They have no runtime validation and do not implement the backend. During Milestone 0/1, convert these shapes into one tested runtime-schema source in `shared/` and derive TypeScript types from it.

Use camelCase in internal domain DTOs and the explicitly documented snake_case wire envelope fields. API examples that show shortened payloads are illustrative; real proposals must validate the complete GoalDraft or the dedicated revision/state schema.

UUIDs, timestamps, monetary decimals, finite numbers, metric-unit pairs, source ownership, valid ranges and referenced IDs all need runtime checks. A string typed as UUID is not proof of a valid or authorized record.

The SSE `event:` name equals the event's `type`. The JSON `data:` carries `v`, `run_id`, `seq` and `payload`; `type` may be reconstructed from the SSE event name. Do not mistakenly require a missing duplicate type field when parsing the documented example.

`retrieval` is deliberately fixed to unused in this version. Future RAG/web sources require an explicit new schema version and evidence snapshots, not pretending URLs were actually read.

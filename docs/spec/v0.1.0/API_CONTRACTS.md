# API contracts

## 1. General conventions

Use nine thin Node function entry points. Group operations by a validated `action` discriminant rather than creating many independently deployed endpoints. Every route except a minimal unauthenticated liveness response requires a verified Supabase session.

Requests use `Authorization: Bearer <access token>`. Never send provider credentials from the browser. JSON body limit: 2 MiB. Mutations carry a client-generated UUID idempotency key. Query ranges are `[from,to)` with explicit timezone. Paginate lists; maximum page size 200. Cursors are owner-bound and validated, not raw SQL fragments.

Success envelope: `{ "data": ..., "request_id": "..." }`. Error envelope: `{ "error": { "code": "...", "message": "safe user-facing text", "retryable": false }, "request_id": "..." }`.

Use 400 for invalid input, 401 for missing/invalid auth, 403 for denied consent/policy, 404 for absent or foreign owned objects, 409 for stale versions/idempotency conflicts, 413 for oversized requests, 429 for limits, and 503 for a disabled/unavailable provider. Never return another user's object existence through a detailed error.

## 2. HTTP surface

| Route | Method and operation | Contract |
|---|---|---|
| `/api/status` | GET | Public liveness has no config; authenticated response lists feature and provider availability, never secrets |
| `/api/conversations` | GET | List own threads or `id=<id>&view=messages` with pagination |
| `/api/conversations` | POST `create`, `archive`, `delete` | Explicit user mutations; delete uses confirmation and purges owned trace references |
| `/api/chat` | POST `send` | Starts one bounded streamed run, or returns existing idempotent run |
| `/api/chat` | POST `cancel` | Mark owned run cancellation requested; best-effort upstream abort |
| `/api/data` | GET | Measurements, sources or deterministic summary by `view`, metric/source/range |
| `/api/data` | POST `preview_csv`, `commit_import` | Encrypted staging and explicit validated commit |
| `/api/data` | POST `add_measurement`, `correct_measurement`, `delete_measurement` | Manual, owner-confirmed UI actions; expected version for correction/deletion |
| `/api/data` | GET `view=export` | Owned canonical CSV; spreadsheet-safe escaping; authenticated no-store response |
| `/api/goals` | GET | Owned goal list/detail/progress |
| `/api/goals` | POST `propose_create`, `propose_revision`, `propose_state` | Returns a persisted proposal, not an active mutation |
| `/api/approvals` | POST `approve`, `reject` | Consume an owned proposal with exact hash/version checks |
| `/api/settings` | GET / PATCH | User-owned preferences/consent; explicit user action; server enforces operator caps |
| `/api/executions` | GET | Owned run/steps; `view=payload` or `view=export` for available private trace content |
| `/api/account` | POST `export`, `delete` | Reauthentication and explicit confirmation for delete; app operation, never an AI tool |

No `/web-search`, `/rag`, `/memory/auto-save`, `/health-connect/sync` or `/scale/connect` endpoint is shipped in v0.1.0.

Authenticated status retains its role-state strings and adds optional `roleDetails` with safe state/reason values. Reading status performs no inference or credential refresh. Everyday can be `available`; the inference boolean reports configuration readiness, not user consent or spending authorization. Settings also returns optional `inferenceAvailability` from the same assessment.

## 3. Chat input

```json
{
  "action": "send",
  "client_request_id": "11111111-1111-4111-8111-111111111111",
  "conversation_id": "22222222-2222-4222-8222-222222222222",
  "message": { "id": "33333333-3333-4333-8333-333333333333", "text": "How is my weight trend?" },
  "depth": "auto",
  "context_selection": {
    "metric": "weight",
    "source_id": null,
    "goal_id": null,
    "from": "2026-09-01T00:00:00Z",
    "to": "2026-09-15T00:00:00Z",
    "timezone": "UTC"
  }
}
```

Retain `auto`, `everyday`, `intermediate`, `advanced` for historical parsing and replay. The browser sends `auto`; new public Intermediate/Advanced requests are unavailable. Backend verification can select those roles through trusted composition. Validate all referenced IDs against the authenticated user. The server loads the authoritative transcript and data. Ignore/reject injected system messages, tool results, arbitrary model IDs, budgets, user IDs and provider URLs in client input.

`context_selection` may be omitted or null; both normalize to null before idempotency hashing. A supplied selection must satisfy the complete schema. Messages are nonblank and limited to 16,000 characters. Recognizable credentials are rejected before persistence. Intermediate/Advanced return explicit unavailability in PR 09. Deterministic baseline safety guidance requires no provider request or consent.

Initial admission inserts the user message and assistant placeholder in the same transaction, then returns SSE. Identical replay returns JSON `{data:{kind:"existing",run:RunSummary},request_id}`. Another active request returns the same envelope with `kind:"busy"`; its run includes the owned conversation link. Neither response grants execution authority. Reusing a message ID for another request conflicts.

After 90-day execution retention removes the run, an identical retained user-message receipt returns `{data:{kind:"retained",conversationId,message:{id,status:"completed"}},request_id}`. The client reloads conversation history; this response contains no execution authority or reconstructed run. Receipt checks precede provider availability checks and repeat inside admission. Changed input, message ID, conversation, or request-key reuse returns 409; a deleted or foreign conversation returns 404.

### Conversation operations

| Operation | Fields / response |
|---|---|
| GET list | Optional `view=list`, `archived=true/false` (default false), `page_size` (default 50, maximum 200), `cursor`. Returns `items`, `nextCursor`, and inference `availability`. Availability is `available` only after the production evidence and enablement gates pass; otherwise `unavailable`. `synthetic` exists only in test composition. |
| GET messages | `view=messages`, `id`, optional `page_size` (default 100, maximum 200), `cursor`. Returns conversation metadata, messages, `nextCursor`, and active/latest `RunSummary`. |
| POST create | `{action:"create",id,client_request_id}`. Default title `New conversation`; first admitted text normalizes whitespace and supplies at most 80 characters. |
| POST archive | `{action:"archive",id,client_request_id}`. Stops future content writes and requests cancellation of active runs. |
| POST delete | `{action:"delete",id,client_request_id,confirm:true}`. Fences runs and deletes transcript/private payloads; retained accounting metadata loses its conversation link. |
| POST cancel to `/api/chat` | `{action:"cancel",run_id,client_request_id}`. Idempotent receipt bound to the owned run; reuse for another run conflicts. Returns current `RunSummary`. |

Conversation mutations return `{id,outcome}` within the success envelope. Reusing a mutation key with changed input returns 409. Lists use descending `(created_at,id)`; message pages return their selected latest records in ascending order, with a cursor for earlier records. Cursors bind the owner, view, filter/conversation and an existing anchor. Reads reconcile stale runs without claiming an executor or replaying inference.

Stored message parts are escaped `text` or server-issued `metric_summary`. The latter binds a versioned owner/run/step/result/data-revision reference to a deterministic summary. Reads resolve it against the owned completed tool output; forged, unavailable, expired or stale evidence becomes an unavailable notice. No model-supplied HTML, URLs or card objects become executable UI.

### Execution inspection

`GET /api/executions?run=<uuid>` returns the owned run summary, ordered safe step metadata and whether its data revision is current, stale or removed. `view=payload` and `view=export` additionally require an owned `step` and a `part` of `input`, `output`, `context` or `usage`. The server resolves the permitted payload through the owned run and step; arbitrary payload identifiers and opaque continuation state are not accepted. Foreign runs and steps return 404.

Payload reads return a no-store JSON envelope with `state` and, when available, base64-encoded exact bytes and expiry. Context payloads additionally report whether their manifest is complete or predates complete capture; binary context exports carry the same label in `X-Vulpes-Evidence-Completeness`. `view=export` returns the same bytes as an authenticated no-store binary attachment; unavailable content returns its explicit state in JSON. States include expired, removed, incomplete, corrupt and unavailable. Input hashes, context manifests, tool names, arguments, output references and provider projections are checked before evidence is presented. Exact bytes are never reconstructed from a formatted view.

A repeated request ID with identical input returns the same run status, not another paid call. Same ID with different input returns 409. An already-running user receives the current run link rather than an implicit parallel run. An unavailable explicit depth is reported; it is not silently downgraded.

## 4. Streaming protocol: Vulpes event stream v1

POST via `fetch`; response is `text/event-stream`, `Cache-Control: no-store`. Do not use an unauthenticated EventSource URL with a bearer token in its query string. The server normalizes provider-specific streaming events.

Each event has a monotonically increasing `seq`, a run ID and a version. Example:

```text
event: text.delta
data: {"v":1,"run_id":"run-uuid","seq":5,"payload":{"message_id":"message-uuid","text":"Your seven-day average"}}

```

Allowed event types:

| Event | Payload |
|---|---|
| `run.started` | Canonical run and assistant-message IDs |
| `route.selected` | Effective role/model/provider/effort, safe route reason |
| `step.started` | Step ID/type and user-friendly status label |
| `tool.result` | Tool name, validated result reference, safe summary |
| `card.ready` | Predefined card type and validated props/result reference |
| `text.delta` | Assistant message ID and new text only |
| `run.usage` | Known usage and actual/estimated/pending cost state |
| `run.completed` | Final message ID and inspectable run ID |
| `run.failed` | Safe error code, partial-output flag, retry guidance |
| `run.cancelled` | Partial-output flag and cost reconciliation state |

Exactly one terminal state is persisted. In a process crash the next authorized status check closes a stale run as interrupted, without replaying inference. Stream sequence numbers prevent duplicate client rendering. Full token deltas need not be stored separately if the final/partial message and request steps are retained; do not claim token-level replay of an interrupted stream.

Before headers are sent, return standard HTTP errors. After streaming starts, emit a terminal error event when possible. The client preserves received text as incomplete and refetches stored status. No automatic paid retry on a lost stream.

## 5. Proposal contract

```json
{
  "id": "proposal-uuid",
  "kind": "goal.create",
  "target_id": null,
  "target_version": null,
  "payload_hash": "sha256-of-canonical-payload",
  "state": "pending",
  "expires_at": "2026-10-20T12:00:00Z",
  "summary": "Create a draft numeric goal with the displayed target and source policy.",
  "payload_version": 2,
  "canonical_payload": { "schemaVersion": 2 }
}
```

A real payload is fully schema-validated; the abbreviated example is not sufficient to create a goal. The approval request contains only `action`, `proposal_id`, `payload_hash`, `expected_version` and `client_request_id`. It cannot supply a replacement target or changed plan. Show the exact material fields before approval.

The server rechecks safety/policy, owner, version, pending state and expiry within the same transaction as the mutation. Repeated approvals return the existing outcome. Expired, altered or conflicting proposals fail and require a new proposal. A conversational "yes" can open the matching approval card; v0.1.0 does not apply a persistent change from an ambiguous short reply.

## 6. Import contract

`preview_csv` accepts CSV text, source selection and a versioned mapping object. The server validates format/limits, stages normalized observations privately and returns `batch_id`, `payload_hash`, `expires_at`, counts, errors and a bounded preview.

The response also includes `selections` for navigating to imported readings after commit: metric, method, granularity, timezone, and inclusive local `from`/`to` dates. These cover all normalized new/duplicate observations, independently of the first-20 preview, excluding conflicts. Each series uses at most 366 days ending at its latest observation. Navigation does not commit data or change the validated import result.

`commit_import` accepts the owned batch ID, hash and idempotency key. Committing a preview from another account is 404. Changed mappings require a new preview. All-or-nothing commit for valid staged observations; rejected rows are explicitly excluded in the approved preview rather than silently skipped during commit.

Executable import contracts are in [`shared/imports.ts`](../../../shared/imports.ts). Preview requires `action`, `client_request_id`, `csv`, `source` (the manual Data source-selection shape), and `mapping`. Mapping version 1 declares `format`, `timezone`, nullable exact `profile` column/value filter, `single_profile`, and `review_requested`. Without a filter, the single-profile declaration must be true.

| Format | Additional mapping fields |
|---|---|
| `canonical` | Exact `source_label` to include; other source labels are counted as excluded. Required and optional columns follow DATA_MODEL. Canonical timestamps require offsets. |
| `wide` | `timestamp_column`, nullable `local_date_column` and `external_id_column`, `granularity`, and 1–8 `metrics` with column, metric, unit and method. Unmapped columns are reported as ignored. |
| `renpho` | English RENPHO Health 31-column export in lb, matched by named headers plus exactly one empty terminal header. Requires `profile: null`, `single_profile: true` and `timezone_confirmed: true`. Imports only `Weight(lb)` as device-reported weight and `Body Fat Percentage(%)` as device-estimated body fat, at instant granularity. |

RENPHO `Date` (`YYYY.MM.DD`) and `Time` (`HH:mm:ss`) are local wall time in the explicitly confirmed IANA timezone; DST overlaps/gaps and invalid dates are excluded as invalid observations. Header order is independent for named columns.

Every terminal-column cell must be empty or the whole file is rejected; the empty terminal column has no observation or ignored-column label. Other named columns are reported as ignored and their values are not staged. `No.` is ignored, never an external record ID.

Original file hashing and row/column provenance use the uploaded CSV directly, without conversion. To deduplicate earlier canonical conversions, choose their existing CSV source and matching timezone/method metadata. Matching instants with changed normalized values or metadata remain conflicts under the existing CSV rules; a new source creates a separate identity namespace.

CSV text is limited to 1 MiB UTF-8, with 100 unique headers, 10,000 data rows, 64 KiB per record and 5,000 nonblank candidate observations. Normalized encrypted staging has a separate 4 MiB limit; excess input fails explicitly without truncation. Responses show at most 20 observations and 50 row errors, with a count of omitted errors. Preview counts distinguish new, duplicate, conflicting, invalid, blank, profile-excluded and source-excluded input.

Canonical CSV also accepts `quality_flags`: semicolon-separated source-warning text (up to 20 nonblank flags of 100 characters each, including an optional `review_requested` flag). Warnings are retained as data, with no automatic diagnosis, correction or clinical interpretation. Manual entry continues to accept only the explicit review flag.

The encrypted bundle binds normalized observations, mapping/profile/source selection, classifications, counts, file/mapping hashes and data revision. Registration binds source metadata and expiry to the batch and staging envelope. Commit revalidates normalization and checks the exact original staged bytes, envelope hash, owned source, expiry, revision and classifications inside the transaction. Only observations approved as new are inserted, atomically; conflicts/duplicates stay excluded. Any changed selection requires a fresh preview. Real inserts advance the data revision once per batch.

Committed file/source/mapping identities return their recorded result on reimport, even after later data changes. They never recreate removed readings. Mutation acknowledgements are historical; clients refetch current readings. Raw CSV is not persisted. Successful commit or terminal invalidation removes staging; untouched staging expires within 24 hours. Bounded owned cleanup runs opportunistically on Data requests and payload access/write. The guarded local `maintenance:cleanup` command expires import batches and removes staging after inactivity; hosted scheduling remains an operational gate.

## 7. Read tool result references

An analytical result contains stable source references such as `measurement:<uuid>`, `goal_revision:<uuid>` and `analysis:<step-id>`, all resolved through authenticated APIs. The model can cite only references included in its context or tool results. A valid-looking invented ID is rejected by the renderer.

Future evidence references may add document passages and web snapshots. Do not create fake source entries for model background knowledge.

## 8. Export and deletion

Strict requests/status are defined in [`shared/account.ts`](../../../shared/account.ts). `/api/account` shares the Settings deployment entry point through an explicit rewrite and never accepts an owner ID or query filter.

| Request | Contract |
|---|---|
| GET | Verified identity returns active state or the owned deletion phase, receipt, timestamps, safe outcome and settlement retry time. |
| POST `export` | `{action:"export",trace_parts:[],sensitive_content_acknowledged:false}`. Choose `input`, `output`, `context`, `usage`; nonempty selection requires acknowledgement. Active account required. |
| POST `delete` | `{action:"delete",confirmation:"DELETE MY VULPES ACCOUNT"}`. Password AMR must be within five minutes; refresh alone is insufficient. Atomically fences the account and creates one journal entry. |
| POST `continue_delete` | `{action:"continue_delete"}`. Verified identity resumes bounded deletion after profile removal; retries cannot recreate content or repeat charges. |

Export is an authenticated `no-store` JSON attachment with schema version 1, safe account email/phone identity, all owned product sections, exact decimal strings, source/units/version metadata, available staging and chosen trace parts. Credentials, sessions, executor authority, opaque continuation content and shared operator configuration are excluded. Trace reads use inspector integrity/expiry checks and explicit unavailable states. Pages contain at most 200 rows; section/data-revision fingerprints are revalidated before sending. Concurrent changes return JSON 409 without an attachment. Capture interval, inventory and integrity hashes describe the output; it is not a transactional backup.

Capture uses an encrypted temporary file and request-only key. Cancellation/error/completion clean the file/key. Account changes abort/discard browser downloads and revoke their object URLs.

Deletion phases are `fenced`, `private_content_purged`, `awaiting_settlement`, `app_data_purged`, `auth_removal_pending`, `completed`. Private purges are bounded/resumable. Unknown charges retain the 24-hour hold; shared app charges and route-cost blocks survive owned ledger removal. Ordinary APIs require active account/live owned session; only status/continuation accepts a verified deleting identity. Completion requires confirmed app/Auth removal. Authentication failure or a lost final response is unconfirmed. See the [operating procedure](../../operations/account-lifecycle.md).

## 9. Settings foundation

Executable settings/status shapes are in [`shared/auth.ts`](../../../shared/auth.ts). Settings PATCH requires `client_request_id`, `expected_updated_at` (the unchanged token returned by GET), and a nonempty `changes` object. Allowed changes are `display_name`, `timezone`, `units`, one `provider_consent` containing `provider`, `accepted`, and `policy_version`, and `monthly_spending_preference_usd`. The personal spending limit is a nonnegative decimal string within the current account AI allocation, or null to use that allocation. Unknown or privileged fields are rejected.

The transaction binds changes to the authenticated owner and current update token. Repeating the latest identical request returns its result; changed input under the same key or an older stale retry returns 409 without changing settings. Responses expose the owned profile, provider policy/consent states and fixed retention defaults; internal write receipts are not returned. Google acceptance remains unavailable until the separate region/retention decision. Consent never establishes live provider availability.

The owned `budget` response contains UTC period/reset, allocation, personal spending limit, spent, reserved and available account amounts as decimal strings. An absent allocation has state `unconfigured` and nullable allocation/available amounts. App-wide balances and operator credentials are never exposed. Lowering a preference does not release existing holds or replenish spend; dispatch rechecks the effective ceiling.

| Spending control | Meaning |
|---|---|
| App AI spending limit | Server-only aggregate cap across all accounts in this deployment |
| Account AI allocation | Operator-assigned account ceiling |
| Personal spending limit | Account holder's lower monthly preference |

`/api/settings`, `allocationUSD`, `preferenceUSD` and `monthly_spending_preference_usd` retain their neutral wire names.

## 10. Manual Data foundation

Executable Data contracts live in [`shared/data.ts`](../../../shared/data.ts). `add_measurement` requires `client_request_id`, a source selection (`kind: existing` with `id`, or `kind: new` with label and nullable app/device metadata), and an observation. The observation declares metric, decimal-string value, input unit, date/time, IANA timezone, nullable local date, granularity, method, and optional review flags represented as an array. Ownership and source namespace are server-controlled.

Observation timestamps support seconds `00`–`59`, with up to six fractional digits. Second `60` is unsupported: entry and correction return a validation error, and CSV preview excludes the row as invalid. No ingestion path silently constrains or rolls that input into another instant.

The acknowledgement contains `id`, `sourceId`, `outcome` (`created` or `duplicate`), `version`, and `dataRevision`. Identical request-key retries return their recorded acknowledgement, not a reconstructed current reading. Changed input under the same owner/request key returns 409. A duplicate-only request does not advance the revision.

`view=sources` supports `page_size` and `cursor`. `view=measurements` and `view=summary` require metric, source ID, method, granularity, `[from,to)`, and timezone. The Data UI selects complete local calendar days, bounded to 366 days. Measurements additionally support pagination and an expected `data_revision`. Cursors bind owner, filters, revision, and an owned anchor; they are navigation state, not authority to read a record. Reads fail with 409 if a multi-page result crosses revisions.

Summary returns the selected interval, its daily chart series, latest reading, data revision, and an analytical result. Scalar headlines always describe the explicitly returned seven-day interval ending at `to`, independently of the chart's selected range, with a preceding comparison window. Daily totals retain their declared local dates rather than being shifted by their summary timestamps. Heart-rate statistics describe observed samples only. Sleep sessions are listed individually, without aggregation.

Data analytical results require method, granularity, statistic kind, nullable sample statistics, and previous-window coverage. These fields are optional in the shared base `AnalysisResult` for compatibility with existing reference results, and validated by typed trend cards. Calculation uses exact decimal storage/transport; numeric DTO serialization and UI display rounding remain separate. This slice displays canonical units and preserves original input units in the table.

Data entry, import, correction, deletion and export do not activate goals or inference.

## 11. Measurement correction, deletion and selected export

Executable schemas remain in [`shared/data.ts`](../../../shared/data.ts). Both mutations require `measurement_id`, `expected_version` and `client_request_id`. They derive ownership from the verified session, serialize with import/add using the active profile lock, and return 409 for a stale version or identity conflict. The safe acknowledgement includes ID, source ID, outcome, resulting version, data revision, baseline-review count, invalidated-preview count and removed-trace count. Identical retries return the historical acknowledgement even after subsequent deletion; changed input under the same request key fails with 409.

| Action | Effect |
|---|---|
| `correct_measurement` | Requires `changes`: decimal-string `value`, `unit`, `observed_at`, IANA `timezone` and nullable `local_date`. Keeps metric, source, external identity, granularity, method and import lineage. Adds `user_corrected`; preserves source warnings. Changing series identity requires deletion and a new entry. |
| `delete_measurement` | Physically removes the row and all owned retained request/response/tool/provider-state payloads. Safe accounting remains; `ai_runs.trace_content_removed_at` records removal. |
| Both | Advance data revision once; mark matching source/metric goal baselines `needs_review` and advance goal version only when the marker changes. M2 lacks authoritative window/reference dependency metadata, so matching-series marking is conservative. Frozen snapshots, target/state and revision payloads stay unchanged. Invalidate pending owned previews and remove owned import staging, including unregistered envelopes. |

`GET view=export` uses the same complete-day selection as the Data table: source, metric, method, granularity, `[from,to)` and timezone, with an optional expected `data_revision`. It reads owned pages of at most 200 rows and checks revision between pages and at completion, before sending CSV. Pages stream into a private AES-GCM-encrypted temporary file, using a random key retained only for the request; validated content then streams to the response. Completion/failure removes the file and zeros the key. Cancellation aborts page reads and streaming. A process crash can leave unreadable ciphertext in OS temporary storage; no recoverable CSV or export URL is retained. Changed data returns a JSON 409, without a partial CSV. The response is authenticated `text/csv; charset=utf-8`, attachment, `no-store`, with `X-Data-Revision`.

CSV contains canonical import columns, schema version 1, measurement/version/revision IDs, original decimal value/unit/offset, source metadata and namespace, batch/fingerprint/provenance identifiers, and available session start/end times. Canonical/original decimals cross PostgreSQL as text and are written without numeric rounding or formula prefixes. Text uses CSV quoting and an apostrophe before formula operators after leading whitespace/control/format characters; leading tab/CR/LF text is also protected. The apostrophe is a documented spreadsheet-safety transformation of text. This is selected measurement export, not complete account/trace export.

The browser downloads through authenticated fetch, aborts/discards work after an identity change, and revokes its object URL. It refetches authoritative data after mutations and disables an open preview when the known data revision changes. Deletion confirmation explains retained frozen goal decisions, trace removal, and the distinction between a fresh import and replay of an existing committed batch.

## 12. Direct goal workflow

Executable direct-goal inputs and revision/baseline schemas live in `shared/goals.ts`. These operations use no model. `GET /api/goals` defaults to `view=list`; `detail`, `progress`, `proposal`, and `revisions` require an owned `id`. `proposals` lists owned proposal metadata and available bodies. Lists accept `page_size` (default 50, maximum 200) and an owned UUID `cursor`. Detail returns the current goal/revision, progress and a 30-local-day chart with up to 200 observations; Data remains the complete measurement browser.

| Action | Required fields beyond action and client_request_id |
|---|---|
| propose_create | definition |
| propose_revision | goal_id, expected_version, definition, baseline_resolution (retain or replace) |
| propose_state | goal_id, expected_version, state (active, paused, completed or archived) |
| approve / reject at /api/approvals | proposal_id, payload_hash, expected_version (null for create) |

Definitions extend the version-1 goal fields with measurement `method`, `granularity`, and fixed `currentMethod`. Seven-day tracking uses eligible scalar series; latest-value tracking preserves individual daily/session semantics. User-reported baselines require provenance and an explicit current method. Numeric inputs must be finite; blank form fields never become zero.

New canonical proposal/revision payloads have schemaVersion 2 and contain the complete definition, frozen baseline, resulting state, review disposition and reviewed data revision. PostgreSQL JSONB text is the canonical hash representation. The server constructs this payload; approval cannot replace it. Storage results use proposal table field names including id, payload_hash, target_version, state and canonical_payload; consumed decisions return proposalId/outcome and, for approval, goalId/revisionId/revisionNumber/version.

A proposal expires after 24 hours. Rejection, conflict and expiry remove its draft body while retaining safe replay metadata. Data-revision changes invalidate pending version-2 bodies atomically. Approved payloads remain historical decisions. Approval checks exact hash, ownership, expiry, current goal version and reviewed data revision in the transaction that writes the revision. Goal version includes review-marker changes; revisionNumber counts approved decisions. Replays return historical outcomes, and changed input under the same request key conflicts.

Missing baselines yield needs_data; later imports cannot activate a goal. A reviewed revision supplies its baseline. Corrections/deletions retain approved snapshots and require review; retaining history or replacing it both require explicit approval. Paused/completed goals can reactivate through approval; archived goals are read-only. Target crossing never completes a goal automatically.

## 13. Chat goal proposal and progress parts

`shared/chat.ts` persists the following additional typed parts. They are issued by server tool execution, never accepted as user/model inline cards. Text resembling a card remains text.

| Part | Stored fields | Resolution |
|---|---|---|
| goal_proposal | reference: {version:1, proposalId, payloadHash, expectedVersion} | Owned proposal must match the message ID, hash and goal version; reload reads its current status and available body through /api/goals |
| goal_progress | evidence, goalId, result | Shared deterministic progress union; owned completed tool evidence must match and remain current/available; numeric results bind the goal version as well as the data revision |

`card.ready` emits the same proposal reference only after the proposal/evidence/message transaction commits. The review card fetches the canonical owned proposal, displays its complete definition and before/after revision, and sends the existing exact approval envelope directly to `/api/approvals`. Approval/rejection makes no inference request. Pending status refreshes every five seconds while displayed; expiry/conflict/rejection removes confirmation controls. Conflicts require fresh review, without automatic resubmission.

Proposal resolution does not depend on decrypting old traces. Deleting a conversation closes pending proposals through their durable message binding, removes draft bodies and prevents a fenced executor from adding another proposal. Approved goal revisions survive conversation deletion. Trace and execution expiry retain their existing accounting and privacy rules.

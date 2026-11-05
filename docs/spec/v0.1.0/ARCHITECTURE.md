# Architecture

## 1. One application, not a distributed agent platform

Use a single TypeScript repository. Implement domain services as ordinary modules inside a modular monolith backend, not independently deployed services. No agent framework is required. Name the orchestrator `VulpesAgent` or `AgentOrchestrator`.

- **Language and runtime policy:** TypeScript (strict) and TSX for all v0.1.0 application frontend, backend, model/provider adapters, routing, agent tools, and deterministic health analytics. SQL for PostgreSQL migrations and Row Level Security policies; CSS/Tailwind for styling. Kotlin only when an Android native bridge is implemented in a future milestone. Do not create a FastAPI/Python service in v0.1.0; a Python analytical worker/service may be introduced in a later milestone only when validated scientific libraries provide a demonstrated benefit, behind a tested `AnalyticsService` boundary.
- **Provider independence:** Core domain services and UI never import AI provider SDKs (OpenRouter, Vertex) or mobile-source SDKs. Replaceable provider adapters implement narrow capability-oriented interfaces.
- **Analytics independence:** Trends, imports, and goal progress calculations are deterministic pure functions and must work with all AI providers disabled.

```text
React/Vite PWA
  |-- shadcn/ui: shell, goals, data, settings
  |-- assistant-ui: conversations and predefined tool/result cards
  |-- Supabase Auth: sign-in/session
  |
  | HTTPS + verified user session
  v
Vercel Node API
  |-- authorization + schema validation
  |-- import / analytics / goals / proposals
  |-- context builder + bounded tool orchestrator
  |-- model adapters + budget reservations
  |-- execution ledger + export/deletion
  |
  +--> Supabase PostgreSQL (owned rows, RLS, transactional mutations)
  +--> OpenRouter (Luna; separate decision-scoring adapter)
  +--> Vertex AI (Flash; Argon)

Later only:
Capacitor Android -> Health Connect -> authenticated ingest service
```

Vite is supported on Vercel; SPA deep links need deliberate routing. Avoid rewriting API requests to the app shell. [S01](SOURCES.md#s01)

## 2. Proposed repository layout to create during implementation

```text
api/                         # Eight thin Vercel entry points; see API_CONTRACTS
src/
  app/                       # Router, shell, providers
  features/{ask,goals,data,settings}/
  components/ui/             # shadcn source components
  components/assistant-ui/   # assistant-ui presentation components
  components/vulpes/         # Typed cards, inspector, branding
  lib/{api,auth,formatting}/
server/
  auth/                      # Verified identity; user-scoped clients
  services/                  # Imports, measurements, goals, approvals
  analytics/                 # Deterministic pure functions
  ai/{adapters,context,tools,routing,ledger}/
  security/                  # Encryption, policy and redaction
  db/                        # Typed queries and narrowly scoped RPC clients
shared/                      # Runtime schemas and DTOs, no server secrets
supabase/{migrations,tests}/
tests/{unit,integration,e2e,evals}/
public/{brand,icons}/         # Only shipped, optimized approved assets
```

The supplied `contracts/` files are a starting contract reference; implement executable validation in `shared/`. Do not expose the whole `server/` tree through client imports. Use lint/build rules to enforce this boundary.

## 3. Frontend choices

React, TypeScript strict mode, Vite, React Router, Tailwind, shadcn/ui, assistant-ui, Recharts, Motion and Lucide. Use one async query/cache layer, not several overlapping stores. A small explicit conversation store maps server events into assistant-ui ExternalStoreRuntime. That runtime supports an externally owned message array and callbacks. [S02](SOURCES.md#s02)

Vulpes owns thread persistence, message IDs, business actions and provider choice. Do not enable assistant-ui's optional hosted persistence or introduce a provider-specific frontend agent. Hide unsupported editing/branching controls rather than wiring them to untracked model calls.

Pin a coherent stable dependency set after the initial build smoke test and commit the lockfile. Do not infer version numbers from this document or mix examples from different major versions. shadcn has a Vite installation path. [S03](SOURCES.md#s03)

## 4. Auth and database access

Supabase Auth manages credentials and sessions. Every API call verifies the bearer token using supported server-side verification; decoding JWT text is not verification. Resolve `user_id` from the verified session, never from request JSON or model tool arguments.

Ordinary reads use a user-scoped Supabase client so RLS applies. Enable RLS on every exposed private table. Deny anonymous access. Use ownership checks on every linked parent record and composite `(user_id, id)` foreign keys where appropriate. RLS and privileged key behavior are documented by Supabase. [S04](SOURCES.md#s04)

Business mutations use narrow database functions with validation and transaction boundaries. A security-definer function must check `auth.uid()`, pin its search path, restrict grants and validate parent ownership. Server-only ledger/budget operations can use a dedicated privileged client, but never accept a browser-supplied owner ID or arbitrary SQL. Keep the administrative credential inaccessible to the model and frontend.

The app does not need an ORM initially: use migrations, generated database types and the Supabase client/RPC interface. Test the policies as two real authenticated test users, not only as the database owner.

## 5. Request and inference lifecycle

1. Verify session, consent, endpoint schema, input size and ownership.
2. Check idempotency and claim a per-user inference slot.
3. Select a permitted role and reserve maximum expected cost atomically.
4. Build bounded context from authoritative server records and approved tools.
5. Serialize the exact provider body; persist the encrypted trace before sending it.
6. Call the provider; validate events; execute only allowlisted tool calls.
7. Each subsequent provider request is another ledger step and budget admission.
8. Persist the final or partial message, settle known usage, retain uncertain spend conservatively, release the slot and return the final stream state.

A closed browser connection triggers an abort attempt but is not evidence that a provider stopped billing. No detached in-memory job is assumed to survive a serverless response. Reopening the chat reads persisted state; it never automatically repeats inference.

## 6. Provider layer and modularity boundaries

Implement small, replaceable adapters for OpenRouter Responses (`everyday`), Vertex GenerateContent (`intermediate`, `advanced`), and OpenRouter Decisions (`decision`). Maintain strict boundaries:

1. **One typed model catalog:** Model roles live in one typed, server-only catalog (`server/config/models.ts` or equivalent); no per-model `.env` duplication. Catalog reasoning settings are read-only to users. Luna starts chat; one bounded Flash handoff is permitted; Argon is backend-only. Provider-specific parameter mapping, reasoning and caching live in provider adapters; see [PROVIDER_SETUP.md](PROVIDER_SETUP.md).
2. **Provider independence:** Core domain services and UI cannot import OpenRouter, Vertex, or any vendor SDK. Provider adapters implement narrow capability-oriented interfaces: generation/streaming, typed decision scoring, and normalized usage. Validate capabilities and fail closed.
3. **Model changes:** A compatible replacement model requires edits only to the catalog, the responsible adapter if needed, and tests. Do not rework goals, analytics, memory, conversation state, or client screens when a model changes.
4. **Data source normalization:** CSV/manual and future Health Connect adapters normalize through one measurement schema before analytics or goals access them.
5. **Agent/UI separation:** assistant-ui owns conversation rendering only. The server owns prompt construction, model routing, tools, permissions, costs, safety checks, and execution logs. Predefined result cards are typed data, never executable model HTML/JS.
6. **Analytics independence:** Trends, imports, and goal progress work with all AI providers disabled.
7. **Minimal abstraction:** Use adapters where real variability exists; avoid speculative plugin registries, multiple frameworks, and microservices.

Keep no conversation state at a model provider. Maintain tool-call IDs and any required opaque continuation/signature fields within the Vulpes-owned transcript. Do not confuse opaque provider state with user-visible reasoning. Tools, schema checks and permissions remain server-owned whichever model runs.

No generic parameters object is blindly copied between providers. Each adapter maps only documented capabilities; see [PROVIDER_SETUP.md](PROVIDER_SETUP.md).

## 7. Service interfaces

- `MeasurementService`: validate, ingest, list, correct, remove and export owned observations.
- `AnalyticsService`: deterministic coverage, daily summaries, change and goal-progress calculations.
- `GoalService`: create drafts, calculate baselines, evaluate proposals and apply approved revisions.
- `ContextService`: return a manifest of included inputs, exclusions, source references and token estimates.
- `ModelGateway`: generation or decision scoring with route metadata and normalized usage via provider adapters.
- `BudgetService`: atomic reserve, reconcile, hold uncertain cost and enforce allocated ceilings.
- `ExecutionService`: authenticated run inspection, encrypted payload retention and export.

These are module boundaries within a modular monolith. Do not deploy seven microservices.

## 8. PWA and offline behavior

Cache only versioned public assets and an offline shell. Use network-only handling for `/api/*`, auth callbacks, model streams and health data. Do not persist conversations, measurements or bearer tokens in the service worker cache. No offline measurement queue in this release.

Session persistence is separate from health-data caching. Use the supported Supabase session mechanism with a restrictive Content Security Policy and no untrusted HTML. Offer sign out; clear user-specific in-memory caches and revoke/refresh sessions as appropriate. Test switching between family accounts on one device.

Future Capacitor builds can reuse the interface. Health Connect permission and synchronization logic belongs in the native bridge; it is not delivered by installing the PWA. [S05](SOURCES.md#s05) [S06](SOURCES.md#s06)

## 9. Failure and observability

Expose operational metadata only in general hosting logs: error code, request ID, duration and status. No prompts, measurements, auth headers, source files or full provider errors in console logs, analytics or exception trackers.

Application traces live in the private execution store. If trace persistence fails before a paid call, do not make the unlogged call. If persistence fails after output starts, stop the run, retain any recoverable state and label the trace incomplete rather than inventing it later.

## 10. Limits by design

Prototype defaults: 1 MiB CSV text, 5,000 normalized observations per import, 2 MiB API JSON bodies, one concurrent run per user, four total model requests per run including optional decisions, six tool calls, and a 210-second application deadline. These are application limits, not vendor entitlements. The Vercel example grants 240 seconds, below the documented Hobby Fluid Compute ceiling at research time. [S07](SOURCES.md#s07)

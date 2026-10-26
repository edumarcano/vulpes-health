# Decisions and scope control

Target: v0.1.0. These decisions consolidate the supplied project conversation; they do not imply implementation.

## Approved product decisions

**D01 - Identity.** Vulpes, descriptor Personal Health Intelligence, repository `vulpes-health`; use the supplied fox and mixed-case wordmark without redesign.

**D02 - AI-first hybrid.** Ask Vulpes (`/ask`, 'Ask' bottom tab) is the initial screen. Goals and Data are usable without spending AI tokens. Settings contains configuration and privacy controls. Charts and approvals are predefined components within conversations, not model-generated executable UI. No mandatory LLM call on opening Ask.

**D03 - Stack and language policy.** React + TypeScript (strict) + Vite, shadcn/ui, assistant-ui, Tailwind CSS, Recharts, Motion and Lucide. TypeScript/TSX runs all v0.1.0 application frontend, backend, model/provider adapters, routing, agent tools, and deterministic analytics. SQL for PostgreSQL migrations and RLS; CSS/Tailwind for styling. Kotlin later for the native Android bridge. No FastAPI/Python service for v0.1.0; a Python analytics worker may be added in a later milestone only on demonstrated scientific benefit, behind a tested `AnalyticsService` boundary. No dedicated generative-UI framework, agent framework or second component suite.

**D04 - Deployment.** Vercel frontend plus Node functions; Supabase PostgreSQL and Auth. No second application backend on Supabase Edge Functions for v0.1.0. No paid scheduler, queue, vector store or analytics vendor.

**D05 - Family-ready.** Private separate accounts, ownership on all private records, RLS and server checks. No household data sharing, shared credentials, admin health dashboard or permissions to read another family member's data through the app.

**D06 - Ingestion.** v0.1.0 supports manual numeric entries and CSV. v0.2 is the intended Health Connect milestone. Dependable Android synchronization is a v1.0 requirement, not an MVP claim. A PWA alone is not an automatic phone-health connector.

**D07 - Scale.** No direct Bluetooth or impedance integration in the planned v1.0 scope. Preserve a data-source interface for a future experiment. Do not describe exported body fat or visceral fat index as raw sensor data.

**D08 - Models and typed catalog.** Use the four selected model/provider roles (Everyday Intelligence: GPT-6 Luna via OpenRouter Responses; Intermediate Reasoning: Gemini 3.8 Flash via Vertex AI; Advanced Reasoning: Gemini 4 Argon via Vertex AI; Decision Engine: Microsoft-Decision-1 via OpenRouter Decisions). Model identities, provider assignments, reasoning parameters, token limits and default routing live in one server-side typed catalog (`server/config/models.ts`), not duplicated across `.env` and JSON. Keep provider adapters independent from domain services. Decision scoring is optional and off by default until tested; no decision-model call on every message.

**D09 - Autonomy.** Reading permitted data, calculation, bounded inference and temporary drafts are allowed within standing permissions and budget. Consequential changes require a specific approval. Reversibility alone does not make a change safe or authorized. Data deletion, sharing, purchases and privacy changes are not agent tools.

**D10 - Transparency.** Save inspectable application-visible inputs and outputs per actual model invocation, including follow-up tool turns and routing calls. Never promise provider-hidden reasoning, provider-injected instructions or downstream requests that are not observable.

**D11 - Evidence scope.** Personal measurements and deterministic analysis are available in v0.1.0. Scientific RAG, reference uploads and web search are deferred. The agent must not claim to have researched or verified a recommendation when it has not.

**D12 - Memory.** v0.1.0 persists conversations, goals and explicit profile/settings fields. No autonomous permanent-memory writer. Later memory will be sparse, source-linked, editable, separable from health measurements and opt-in by policy.

**D13 - Modularity and replaceability.** Core domain services never import AI-provider SDKs, mobile-source SDKs, or assistant-ui. Replaceable provider adapters implement narrow capability interfaces: generation/streaming, typed decision scoring, and normalized usage. Normalized measurement adapters feed deterministic analytics that work with all AI disabled. Enforce progressive replaceability tests. Avoid speculative plugin registries, multiple frameworks, and microservices.

## Implementation defaults chosen for this package

These fill gaps without reopening the approved product direction. They are editable decisions, not assumed prior user approvals.

| Default | Rationale |
|---|---|
| Email/password accounts manually provisioned by the operator | No public signup; no dependency on paid email for the first personal account |
| Adults only for the initial family pilot | Avoid pretending the wellness/safety behavior has been evaluated for children |
| Online-only health data; static PWA shell offline | Avoid silently persisting sensitive records in browser caches |
| assistant-ui ExternalStoreRuntime | Vulpes owns persisted messages, approvals and stream state |
| Owner-controlled provider list and spending ceilings | Family accounts cannot change the payer's credentials or raise allocated ceilings |
| Explicit per-user consent to approved model providers | The owner's acceptance does not stand in for family members' consent |
| Deterministic routes plus explicit user-selected depth | Simple routing baseline before semantic classifier evaluation |
| Complete trace payloads retained 7 days by default | Balance exact inspection with sensitive-data duplication and storage |
| Usage/accounting metadata retained 90 days by default | Cost reconciliation without retaining prompts indefinitely |
| No source CSV retained after validated commit | Parsed observations retain provenance, not duplicate raw files |
| Live model calls disabled in example configuration | Prevent accidental spend or disclosure during first setup |
| Small bounded imports | Match a quick prototype and serverless payload limits |

The owner can revise these defaults before implementation. Codex must record a change rather than quietly widening scope.

## Gate before real data

- Authentication, cross-user isolation, approved provider consent and encrypted trace storage pass tests.
- Numerical fixtures pass; no measurement is invented when unavailable.
- An actual RENPHO export is examined before claiming native RENPHO CSV compatibility. No export was supplied with this package.
- API prices, regional access and provider privacy constraints are verified in the owner's account.
- Prototype deployment uses no real health data in public previews or CI.

## Gate before the first family invitation

In addition to the above: test backup/restore, export and deletion, account recovery, two-user adversarial access, per-account plus app budgets, source selection, clear limitations and onboarding consent. The deployment operator technically controls the database and server keys; app-level account separation is not end-to-end encryption from the operator.

## Explicit non-goals

No raw scale driver, unofficial RENPHO cloud login, native X search, social network ingestion, voice, autonomous training program changes, medical-record interpretation, medical diagnosis, treatment management, push notifications, scheduled reports, arbitrary PDF ingestion, automatic goal discovery, autonomous memory or full research system in v0.1.0.

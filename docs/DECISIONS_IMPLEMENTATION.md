# Vulpes implementation decision log

The canonical product and architecture decisions are recorded in [`spec/v0.1.0/DECISIONS.md`](spec/v0.1.0/DECISIONS.md).

Record implementation trade-offs, actual provider capabilities and identifier verification, pinned dependency choices, schema changes, deviations, and relevant tests here. Each entry should identify its date, impact, alternatives and owner approval when required.

## 2026-10-24: PR 03 schema and isolation foundation

**Status:** Implemented within the approved PR 03 scope; actual local database, HTTP and regression evidence is recorded in [PR 03 evidence](evidence/pr03-schema-isolation.md). No deployment, hosted database, inference or real records.

| Area | Choice and reason |
|---|---|
| Local tooling | Exact development-only Supabase CLI `2.122.0`, PostgreSQL 17, bundled pgTAP, existing Vitest and native `fetch`. No ORM, application Supabase client, additional database driver or runtime framework. |
| Access | All 15 tables enable RLS and revoke client access in the schema transaction before the grants migration. Authenticated clients receive owned reads only on 11 tables; private payloads, usage buckets/reservations and audit events remain server-only. All direct client mutations are denied. Feature RPCs will grant only their required operations. |
| Ownership | Auth-linked profiles, composite owner-parent keys, same-goal revision and same-conversation run constraints. Household budget rows have null owners and no client access; reservation keys enforce user ownership, bucket scope and original accounting month. |
| Storage | PostgreSQL `numeric` preserves measurement/money storage. Unknown usage and cost remain nullable/pending. Generated TypeScript database types are structural; later services still own exact decimal arithmetic, money-string serialization and public validation. |
| Lifecycle seams | Data revision, account deletion progress, active-run uniqueness and budget allocations live in existing specified tables. Goal revisions deny service-role UPDATE. Payload deletion clears nullable references without clearing ownership. Business transitions, deletion coordination and accounting transactions remain deferred. |
| Configuration correction | CLI `2.122.0` maps `auth.email.enable_signup=false` to a disabled email provider, causing real password login to fail with `email_provider_disabled`. Keep that field true and global `auth.enable_signup=false`. Real provisioned-user login and denied public signup both pass. This corrects a configuration detail of the approved plan without changing the private-account policy. |
| Default grants | PostgreSQL's built-in function `PUBLIC EXECUTE` default must be revoked globally for the migration role; schema-local revocation cannot subtract it. A reproduced future-function test failed before the correction and passes afterward. Existing managed functions and other migration roles are unchanged. |
| Host networking | Docker Desktop still exposed the synthetic ports through non-loopback addresses with the documented custom bridge option. Removed that ineffective workaround, documented the host limitation and stopped the stack after verification. No global Docker/firewall modification or custom container runtime was introduced. |
| Scope boundary | The schema stores encrypted envelopes but implements no encryption/decryption, authenticated app route or business RPC. Synthetic envelope bytes prove ownership/reference behavior only. PR 04 owns application auth, consent and encrypted payload behavior. |

**Approval boundary:** The owner approved PR 03 implementation and PR publication, installed Docker Desktop, and authorized real local Supabase tests. No cloud resource, provider activation, real-data use or system installation by the implementation agent was authorized or performed.

## 2026-10-24: PR 02 contracts and offline replaceability

**Status:** Implemented within the approved PR 02 scope; local evidence and review outcomes are recorded in [PR 02 evidence](evidence/pr02-contracts.md). No live provider request, deployment, or activation.

| Area | Choice and reason |
|---|---|
| Contract coverage | The owner selected fully specified contracts during planning. Implement complete DTOs, SSE, envelopes, chat send, approval, and import commit; inventory every route/action. Return `not_implemented` for incomplete operation payloads. Reject unfinished revision/state proposals and cards until PR 11 defines them. No arbitrary-object success schemas. |
| Schema dependency and CSP | Promote the already locked Zod `4.6.7` to an exact direct dependency. Disable its JIT/eval probe before constructing shared schemas: the first browser run reproduced ten production-CSP violations. Preserve `script-src 'self'`; the same browser checks pass after the repair. |
| Provider boundary | Generation, typed decision scoring, and normalized usage have separate contracts. Synthetic transports remain in the test/tool graph; no provider SDK, real HTTP transport, or orchestration framework is introduced. Fixtures establish the normalized protocol, not vendor wire compatibility. |
| Usage and continuation | Preserve nullable unknown usage, raw usage, and reasoning/cache subset metadata without money arithmetic. Keep continuation JSON tagged to its API family and tool call/result IDs matched. No provider state is exposed through public liveness. |
| Catalog and availability | Keep approved identities, effort controls, ceilings, and required privacy policies in one typed server-side catalog. Prices remain unverified/null and live smokes `not_run`; configuration intent never makes a role available. Decision scoring remains disabled. |
| Smoke safety | Synthetic mode does not inspect credentials. Live mode checks explicit role/spend inputs and the global switch, then always denies because required services/transports are absent. Full opt-in cannot activate inference in PR 02. |

**Approval boundary:** These choices implement the approved plan. They do not approve provider substitution, prices, Google region/retention, real-data use, or inference. No approved scope deviation.

## 2026-10-24: PR 01 application foundation

**Status:** Implemented within the approved PR 01 plan; local verification is recorded in [PR 01 evidence](evidence/pr01-foundation.md). No deployment or inference activation.

**Decisions:**

| Area | Choice and reason |
|---|---|
| Runtime | Node 24 (`24.15.0` tested), npm `11.18.0`, exact direct dependency pins and npm lockfile. TypeScript `6.0.3` satisfies typescript-eslint `8.72.0`'s `<6.1` peer range; the latest TypeScript 7 was not compatible. |
| UI dependencies | React `19.3.1`, Vite `8.3.5`, React Router `7.18.4`, TanStack Query `5.104.5`, assistant-ui `0.15.31`, Tailwind `4.3.3`, adapted shadcn Button/Card source, and Lucide. Chart/animation/provider/database packages remain deferred. |
| Local runtime | A loopback Node HTTP runner executes the same thin API handler as Vercel. Vite proxies API traffic; concurrently supervises the two processes. API changes require a restart so startup failures propagate instead of leaving a watcher alive. No application server framework or cloud credentials are needed. |
| API scope | Public liveness only. The status entry point also handles the hosting rewrite's unmatched-API discriminator, preserving JSON errors without an extra deployed function. Add future named API routes ahead of the fallback. |
| Configuration | Parse the live switch strictly, but keep inference unavailable even when requested. No provider transport, runtime model registry, or model environment overrides are introduced. |
| CSP | Production scripts and connections are same-origin; component inline styles are allowed. Development additionally permits Vite's inline refresh script and loopback HMR WebSocket. Test the production policy through the built preview. |
| Branding | Use approved PNGs without cropping/recoloring. Dark text accents use the lighter semantic focus-color derivative after the initial orange-on-muted navigation measured 3.80:1 contrast. Logo and button colors are preserved. |

**Verification:** Vitest exercises the actual Node HTTP handler and Vite's disconnected-proxy response; Playwright checks the built shell. No persistence or authenticated provider support is claimed. See the evidence record for exact commands, fixes, screenshots, and remaining gates.

## 2026-10-19: Typed model catalog, minimal deployment environment

**Status:** Approved baseline; integrated into canonical specifications ([`DECISIONS.md`](spec/v0.1.0/DECISIONS.md#d08---models-and-typed-catalog), [`PROVIDER_SETUP.md`](spec/v0.1.0/PROVIDER_SETUP.md), and [`ARCHITECTURE.md`](spec/v0.1.0/ARCHITECTURE.md)).

**Decision:** Server-side model identities, provider adapters, model-specific reasoning, token limits and routing defaults are version-controlled in one typed catalog (`server/config/models.ts`), not duplicated in `.env` and runtime JSON. Secrets/deployment identity and a fail-closed AI enable switch remain in the environment. Use one capability-aware gateway and provider-specific adapters. Model changes are independently testable and require approval before live activation.

**Reason:** Prevent configuration drift and make monthly model evaluations practical without modifying domain or agent code.

## 2026-10-19: Ask Vulpes, language policy, modularity, repository housekeeping

**Status:** Approved baseline; integrated into canonical specifications ([`PRODUCT_SPEC.md`](spec/v0.1.0/PRODUCT_SPEC.md), [`DECISIONS.md`](spec/v0.1.0/DECISIONS.md), [`ARCHITECTURE.md`](spec/v0.1.0/ARCHITECTURE.md), [`UI_SPEC.md`](spec/v0.1.0/UI_SPEC.md), and [`ACCEPTANCE_TESTS.md`](spec/v0.1.0/ACCEPTANCE_TESTS.md)).

**Decision:** Main AI experience is **Ask Vulpes**, compact tab **Ask**, route `/ask`. Build the v0.1.0 client and backend in strict TypeScript, SQL for migrations, Kotlin later if needed for Android; a future Python analytics service is permitted when justified by validated scientific requirements but must remain behind a stable contract. Enforce replaceability tests for generation/decision providers and measurement-source adapters. Consolidate specifications directly into the canonical documentation and remove obsolete starter-package artifacts.

**Reason:** Align interface naming with Vulpes branding, maintain a one-language MVP, enable frequent model swaps, avoid unnecessary root-level documentation and maintain a clean, unified documentation baseline.

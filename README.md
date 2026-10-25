# Vulpes

**Personal Health Intelligence** — an AI-first, mobile-first application for understanding personal health measurements and working toward user-defined goals.

Vulpes turns personal health data and goals into transparent, auditable conversations with tools and deterministic calculations. The core interaction is **Ask Vulpes**, supported by direct access to measurements and goals without requiring AI calls.

## Current status

**Authenticated foundation (PRs 01–04).** The application supports private email/password sign-in, owned profile/settings and explicit provider consent. Reviewed migrations cover all 15 specified tables, RLS, narrow settings transactions, and server-only encrypted payloads with expiry enforcement. Account switching clears private in-memory state. Health workflows, working goals, AI conversations, and account export/deletion are not implemented. The preview and smoke CLI cannot make model calls, even when the live-AI environment switch is true.

Development follows the [execution plan](docs/plans/v0.1.0-execution.md) and canonical [milestones](docs/spec/v0.1.0/IMPLEMENTATION_PLAN.md). PRs 01–04 are merged. M0/M1 and the [review remediation](docs/evidence/m0-m1-review-remediation.md) were accepted on 2026-10-25; [remediation PR #5](https://github.com/edumarcano/vulpes-health/pull/5) awaits merge. The next planned packet is execution-plan PR 05, the deterministic Data slice. See [PR 04 evidence](docs/evidence/pr04-auth-private-payloads.md), [PR 03 schema evidence](docs/evidence/pr03-schema-isolation.md), and the [provider report](docs/evidence/PROVIDER_SMOKE_TESTS.md). Local evidence does not establish hosted authentication, family readiness, or live provider support.

## Planned technology stack

- **Frontend:** React, TypeScript (strict), Vite, Tailwind CSS, shadcn/ui, assistant-ui, Recharts, Motion, and Lucide. Packaged as an installable mobile-first Progressive Web App (PWA).
- **Backend:** Vercel Node API functions (`/api/chat`, `/api/conversations`, etc.) organized as a modular monolith. Domain logic and calculations are written in strict TypeScript.
- **Persistence & Auth:** Supabase PostgreSQL with Row Level Security (RLS) on all owned tables, private Storage, and Supabase Auth for private, invitation-only accounts.
- **Model catalog & AI adapters:** Centralized in one server-side typed catalog (`server/config/models.ts`):
  - *Everyday Intelligence:* `openai/gpt-6-luna` via OpenRouter Responses API
  - *Intermediate Reasoning:* `gemini-3.8-flash` via Vertex AI GenerateContent
  - *Advanced Reasoning:* `gemini-4-argon` via Vertex AI GenerateContent
  - *Decision Engine:* `microsoft/microsoft-decision-1` via OpenRouter Alpha Decisions (optional, disabled by default)
- **Modularity:** Core domain services never import provider SDKs or mobile SDKs. Replaceable provider adapters and normalized measurement schemas allow deterministic trends, imports, and goal tracking to function with all AI providers disabled.
- **Future extensions:** Native Android bridge via Capacitor to Health Connect planned for v0.2+; Python analytics worker considered for a later milestone only on validated scientific benefit.

## Planned product experience

- **Ask Vulpes** (`/ask`, bottom navigation **Ask**): Conversational interface with assistant-ui, deterministic result cards, tool-backed calculations, and an inspectable execution ledger.
- **Goals** (`/goals`): Inspect, propose, approve, and track personal objectives with explicit baseline snapshots and mathematical progress tracking.
- **Data** (`/data`): Measurements, canonical CSV import, manual entry, and deterministic charts that operate without LLM calls.
- **Settings** (`/settings`): Account profile, provider consent, spending caps, trace retention, data export, and account deletion.

## Documentation navigation

All canonical release specifications reside under [`docs/spec/v0.1.0/`](docs/spec/v0.1.0/):

| Specification | Description |
|---|---|
| [`PRODUCT_SPEC.md`](docs/spec/v0.1.0/PRODUCT_SPEC.md) | Release boundary, primary user flows, and medical safety guardrails |
| [`DECISIONS.md`](docs/spec/v0.1.0/DECISIONS.md) | Authoritative product and architectural decisions (D01–D13) |
| [`ARCHITECTURE.md`](docs/spec/v0.1.0/ARCHITECTURE.md) | Modular monolith architecture, service interfaces, auth, and PWA behavior |
| [`DATA_MODEL.md`](docs/spec/v0.1.0/DATA_MODEL.md) | Database tables, measurement semantics, deduplication, and transaction rules |
| [`API_CONTRACTS.md`](docs/spec/v0.1.0/API_CONTRACTS.md) | HTTP route conventions, Vulpes event stream protocol, proposals, and error envelopes |
| [`AI_SPEC.md`](docs/spec/v0.1.0/AI_SPEC.md) | Model roles, routing policy, tool definitions, context construction, and transparency |
| [`UI_SPEC.md`](docs/spec/v0.1.0/UI_SPEC.md) | Mobile screens, Ask Vulpes interaction states, card types, and accessibility |
| [`SECURITY_AND_PRIVACY.md`](docs/spec/v0.1.0/SECURITY_AND_PRIVACY.md) | Tenant isolation, provider consent, trace encryption, and retention policies |
| [`PROVIDER_SETUP.md`](docs/spec/v0.1.0/PROVIDER_SETUP.md) | Server-side typed model catalog, provider adapter notes, and credential setup |
| [`DEPLOYMENT.md`](docs/spec/v0.1.0/DEPLOYMENT.md) | Local development, Vercel/Supabase hosting checklist, and operational runbook |
| [`IMPLEMENTATION_PLAN.md`](docs/spec/v0.1.0/IMPLEMENTATION_PLAN.md) | Testable development milestones starting with Milestone 0 |
| [`ACCEPTANCE_TESTS.md`](docs/spec/v0.1.0/ACCEPTANCE_TESTS.md) | Functional, numerical, security, modularity, and release acceptance gates |
| [`ROADMAP.md`](docs/spec/v0.1.0/ROADMAP.md) | Post-v0.1.0 Health Connect bridge, curated evidence, and memory extensions |
| [`SOURCES.md`](docs/spec/v0.1.0/SOURCES.md) | Official dated technical references |
| [`BRAND_ASSETS.md`](docs/spec/v0.1.0/BRAND_ASSETS.md) | Asset inventory, SHA-256 hashes, roles, and measured brand palette |

Operational repository guidance:
- [`AGENTS.md`](AGENTS.md) — Mandatory developer rules, modularity boundaries, security controls, and workflow.
- [`docs/DECISIONS_IMPLEMENTATION.md`](docs/DECISIONS_IMPLEMENTATION.md) — Implementation-phase decision log for approved deviations and trade-offs.

## Development and validation

### Environment template

No environment file or cloud credentials are needed to run the foundation. When later features require local configuration, copy the root template:

```sh
cp .env.example .env.local
```

Never commit `.env.local` or any secret-bearing file. Secrets and deployment identities remain server-side; model configurations and parameters belong in `server/config/models.ts`.

### Specification and fixture validation

Run the specification consistency check:

```sh
python docs/spec/v0.1.0/scripts/validate_spec_package.py
```

This script verifies canonical files, JSON syntax, markdown link integrity, empty secret placeholders, brand asset dimensions/hashes, and fixture arithmetic without making network requests.

### Run locally

Use Node 24 and npm 11.18.0. Install the locked dependencies, then start both processes:

```sh
npm ci
npm run dev:full
```

Open `http://127.0.0.1:5173`. The API listens only on `127.0.0.1:3001`; Vite proxies `/api` to it. Stop the stack with Ctrl+C. Occupied ports fail rather than selecting another port. Use `dev:full`, because the frontend alone cannot serve the API.

The frontend supports Vite hot reload. Restart the stack after server/API code or environment changes.

Without configuration, the app shows an honest sign-in-unavailable state. Configure Supabase and provision private accounts using the [account setup guide](docs/setup/private-accounts.md). Protected routes redirect to `/login`; there is no signup interface. Supabase manages the persisted authentication session; app settings and health content remain memory-only.

`GET /api/status` without authorization returns minimal public liveness. With a valid bearer it returns safe feature/role availability; invalid authorization is denied. `/api/settings` GET/PATCH verifies the bearer against Auth and uses owned reads/narrow transactions. Other API routes remain JSON 404. None of these operations invokes a model.

### Verify the foundation

Stop any local stack before tests that exercise the fixed API port. Install Chromium once for browser verification:

```sh
npx playwright install chromium
npm run lint
npm run typecheck
npm test
npm run build
npm run test:bundle
npm run test:providers
```

`build` writes the public client to `dist/` and the local Node/API output to `.build/`. `test:bundle` rebuilds with synthetic server-secret canaries and scans public output for secrets, the server catalog, and synthetic harness markers. Unit tests remain offline and Docker-independent.

For manual inspection of the built client and compiled API:

```sh
npm run preview:full
```

Open `http://127.0.0.1:4173`; configure that exact `VULPES_APP_ORIGIN` when using authenticated preview mutations. No service worker or persistent health-data cache is registered. Local preview does not prove deployed Vercel routing or function behavior.

### Verify the local database foundation

Install and start a Docker-compatible local runtime first. `npm ci` installs the pinned Supabase CLI; no Supabase login, linked project, cloud keys or populated environment file is needed.

```sh
npm run db:start
npm run db:reset:test
npm run db:lint
npm run test:db
npm run db:types:check
npm run test:integration
npm run test:e2e
npm run test:dev
npm run maintenance:cleanup
npm run db:stop
```

These commands target only `vulpes-health-pr03-test`, a disposable synthetic stack at `http://127.0.0.1:54321` with PostgreSQL on port 54322. **`db:reset:test` deletes that stack's database contents.** The wrappers reject linked projects, remote Docker contexts, altered project/port settings, and connection overrides. `db:stop` preserves local volumes and does not stop unrelated projects. A missing runtime fails explicitly; database tests are not replaced with mocks.

Use a clean reset to verify all migrations, including after upgrading an existing test volume. Integration tests provision temporary synthetic accounts, obtain real password sessions, exercise the Node API and direct PostgREST, and clean up their records/accounts in `finally`. The global signup switch is false; the email provider remains enabled so provisioned accounts can sign in. Do not use this test stack for operator data.

`test:e2e` requires the running local stack. Its guarded runner provisions temporary synthetic accounts, supplies configuration in child-process memory, rebuilds the app, and starts its own compiled preview. `test:dev` uses the same guard to demonstrate sign-in, profile/consent saves and reload through `dev:full` instead. They reject browser requests outside the exact loopback app/Auth ports. Traces, video, and automatic failure screenshots are disabled to avoid capturing credentials; explicit synthetic screenshots/reports are ignored under `test-results/` and `playwright-report/`. Credentials are not written to configuration files. Account fixtures are removed in `finally`; an interrupted runner may require a disposable reset.

The wrappers restrict which Docker engine and database project they use; they do not guarantee host-network isolation. On the tested Docker Desktop installation, Supabase publishes ports 54321/54322 on host interfaces, and the documented custom-network loopback option did not prevent non-loopback connections. Use a trusted network or owner-managed host restrictions, keep this stack synthetic, and stop it when finished. No global Docker or firewall settings are changed by these scripts.

`test:db` runs pgTAP schema, grants and constraint tests. `test:integration` runs the real Auth/PostgREST suite; ordinary `npm test` remains offline and Docker-independent. After a migration change, run `npm run db:types` to regenerate `server/db/database.types.ts`; `db:types:check` detects drift without rewriting it. Generated database types describe storage, not authorization, validated DTOs or exact monetary serialization.

All direct client table writes remain denied. The authenticated settings RPC can change only the caller's allowed profile fields and consent; it cannot alter ownership, account state, operator budgets, or arbitrary preferences. Private payloads, usage buckets/reservations and audit events deny direct client reads. The private-payload module uses authenticated AES-256-GCM envelopes with owner/purpose/version-bound metadata; it has no public endpoint.

`maintenance:cleanup` accepts no connection overrides and targets only the disposable local stack. Each transaction removes at most 100 expired private payloads; one invocation stops after at most 100 batches and reports counts. Reads enforce expiry even if cleanup has not run. This command does not yet clean future export artifacts, usage metadata, or entire accounts. Keep required key versions recoverable as described in the setup guide.

### Contracts and provider harness

Executable schemas in `shared/` cover the complete documented domain DTOs, supported API inputs/envelopes, and all ten SSE v1 events. Settings uses the shared liveness validator. Ownership, evidence resolution, cursor authenticity, and business transactions require later services; parsing a DTO does not authorize it.

The API inventory preserves all nine paths and documented actions. Incomplete future payloads return `not_implemented` in the contract dispatcher. Revision/state proposal payloads and their cards are rejected until PR 11 defines them. See the [contract coverage and owning PRs](docs/evidence/pr02-contracts.md#contract-coverage-and-deferred-owners).

The default smoke command exercises normalized synthetic generation/tool continuation and decision-scoring interfaces. It uses no credentials or network and reports live roles as unavailable/disabled:

```sh
npm run test:providers
npm run test:providers -- --role=everyday
npm run test:providers -- --write-report
```

The last command explicitly refreshes the tracked provider evidence report. Ordinary tests do not write that report.

`npm run test:providers -- --mode=live --role=everyday` exits 1 with `live_opt_in_required`. Even complete spend flags and a true live-AI switch end in `live_smoke_not_implemented`: no production provider transport exists. Enabling inference later requires separately authorized access/privacy checks, complete pricing, auth/consent, reservations, encrypted exact capture, and live evidence. No model identity is read from environment overrides.

## Privacy and license

Never commit real health data, prompt/model execution payloads, individual medical documents, production credentials, or personal screenshots. Each family member's data is strictly independent and isolated by authentication and Row Level Security.

This repository does not claim medical diagnosis, prescription, or clinical decision support.

All rights reserved. No open-source license is granted for application code or brand assets.

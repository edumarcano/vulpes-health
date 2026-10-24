# Vulpes

**Personal Health Intelligence** — an AI-first, mobile-first application for understanding personal health measurements and working toward user-defined goals.

Vulpes turns personal health data and goals into transparent, auditable conversations with tools and deterministic calculations. The core interaction is **Ask Vulpes**, supported by direct access to measurements and goals without requiring AI calls.

## Current status

**Application shell, contracts, and offline provider harness (PRs 01–02).** The local application has a branded, responsive shell for Ask Vulpes, Goals, Data, and Settings, plus a public API liveness endpoint. Shared runtime schemas, the server-side typed catalog, and synthetic provider contract tests are available. Authentication, health-data storage/imports, working goals, and AI conversations are not implemented. The preview and smoke CLI cannot make model calls, even when the live-AI environment switch is set to true.

Development follows the [execution plan](docs/plans/v0.1.0-execution.md) and canonical [milestones](docs/spec/v0.1.0/IMPLEMENTATION_PLAN.md). Milestone 0's local foundation checks are verified; PR 02 awaits review and integration before Milestone 1 starts. See [PR 01 evidence](docs/evidence/pr01-foundation.md), [PR 02 evidence](docs/evidence/pr02-contracts.md), and the [generated provider report](docs/evidence/PROVIDER_SMOKE_TESTS.md). Synthetic tests do not establish live provider support.

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

`GET /api/status` returns public liveness only. Other API routes return JSON 404; the response contains no account or provider configuration. Settings displays this liveness result without triggering inference.

### Verify the foundation

Stop any local stack before tests that exercise the fixed API port. Install Chromium once for browser verification:

```sh
npx playwright install chromium
npm run lint
npm run typecheck
npm test
npm run build
npm run test:bundle
npm run test:e2e
npm run test:providers
```

`build` writes the public client to `dist/` and the local Node/API output to `.build/`. `test:bundle` rebuilds with synthetic server-secret canaries and scans public output for secrets, the server catalog, and synthetic harness markers. `test:e2e` starts its own compiled preview, checks HTTP and browser behavior, and writes screenshots/report files to ignored `test-results/` and `playwright-report/` directories. It rejects browser requests outside the loopback test server.

For manual inspection of the built client and compiled API:

```sh
npm run preview:full
```

Open `http://127.0.0.1:4173`. No service worker or persistent health-data cache is registered. Database, provider, retention, and backup commands will be added with their owning features. Local preview does not prove deployed Vercel routing or function behavior.

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

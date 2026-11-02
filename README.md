# Vulpes

**Personal Health Intelligence** — an AI-first, mobile-first application for understanding personal health measurements and working toward user-defined goals.

Vulpes turns personal health data and goals into transparent, auditable conversations with tools and deterministic calculations. The core interaction is **Ask Vulpes**, supported by direct access to measurements and goals without requiring AI calls.

## Current status

Vulpes implements authenticated Data, Goals, Settings and persisted Ask Vulpes, with exact deterministic analysis, confirmed CSV imports, explicit goal approvals, owned execution inspection, account export, resumable deletion and guarded local backup/recovery. Mobile presentation and a public-only static PWA shell are implemented. No new model, native Android connector, background inference or research capability is implied.

**The bounded personal-owner pilot handoff is complete; full release and family acceptance remain pending.** Normal hosted Ask Vulpes enables Luna under consent and persistent budgets. [Step 4](docs/evidence/owner-pilot-step4.md) records the Galaxy S23 conversation, installation and offline results; [Step 5](docs/evidence/owner-pilot-step5.md#owner-handoff-completed-2026-11-02) records P0 technical reconciliation, approved cleanup, exact private import, encrypted recovery/Drive readback and owner-confirmed real Data/Ask use. Manual backup rotation remains required. TalkBack and Markdown/UI polish are deferred for this personal pilot; broader UI/formal release reviews remain separate. Flash, Argon and PR 14 decision scoring stay unavailable; repository defaults and CI keep live inference off.

The [execution ledger](docs/plans/v0.1.0-execution.md) tracks PR and milestone status. M0/M1 were accepted after remediation. M2's timestamp remediation, M3's replay/completion repairs and historical v3 live evidence, and M4's daily-total/approval-cache repairs are retained in the [PR 17 reconciliation](docs/evidence/pr17-integrated-acceptance.md). Formal outstanding acceptance is separate from those technical results. The combined independent M5/M6 review follows the PR 17 candidate.

Use the [build-created evidence report](docs/evidence/release/m6-local.json) for the exact tested candidate, commands, local outcomes, all 70 acceptance IDs, dependency/build hashes and reviewed synthetic screenshots. The [release/deployment checklist](docs/operations/release-readiness.md) owns reproduction instructions and external gates. The [account lifecycle runbook](docs/operations/account-lifecycle.md) owns export inventory, interrupted deletion, retention, backup rotation, deletion-journal replay, key recovery and operator-assisted credentials.

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

`GET /api/status` without authorization returns minimal public liveness. With a valid bearer it returns safe feature/role availability; invalid authorization is denied. `/api/settings` GET/PATCH and `/api/data` GET/POST verify the bearer against Auth and use owned reads/narrow transactions. Data supports manual entry, CSV import, correction/deletion, deterministic analysis and selected CSV export. Goals and approvals use owned proposal transactions; conversations, chat and executions retain their M3 contracts. `/api/account` supplies owned export and resumable deletion; its status/retry path admits verified deleting identities without enabling ordinary account activity. Data, Settings and Goals operations invoke no model.

### Verify the foundation

GitHub Actions runs [CI](.github/workflows/ci.yml) for every pull request, including
stacked PRs, and pushes to `main`. The branch-protection check names are
`Fast checks` and `Integration checks`. The jobs use read-only permissions and
locked dependencies; integration runs against a disposable local Supabase stack
on GitHub-hosted Ubuntu. No repository secrets or hosted services are required.
Browser reports and service logs are not uploaded as artifacts.

Stop any local stack before tests that exercise the fixed API port. Install Chromium once for browser verification:

```sh
npx playwright install chromium
npm run format:check
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
npm run test:executions
npm run test:e2e
npm run test:dev
npm run maintenance:cleanup
npm run db:stop
```

These commands target only `vulpes-health-pr03-test`, a disposable synthetic stack at `http://127.0.0.1:54321` with PostgreSQL on port 54322. **`db:reset:test` deletes that stack's database contents.** The wrappers reject linked projects, remote Docker contexts, altered project/port settings, and connection overrides. `db:stop` preserves local volumes and does not stop unrelated projects. A missing runtime fails explicitly; database tests are not replaced with mocks.

`test:executions` requires that disposable stack and no existing current-month app bucket. It creates temporary synthetic accounts, races paired reservations at a small app spending boundary, sends exact captured bytes to a loopback receiver, and demonstrates pending/conservative/corrected accounting. It cleans its records and prints only safe proof metadata. Reported monetary values are simulated; no model endpoint is contacted.

`npm run test:execution-upgrade -- --allow-disposable-reset` verifies a forward upgrade from the pre-PR-08 schema. It refuses a nonempty stack, temporarily parks the six PR 08, four PR 09 and two PR 10 migrations inside the workspace, resets the guarded disposable database, seeds two synthetic owners, applies the original five accounting migrations, then verifies the app/account naming migration separately with reserved, pending and settled charges. It compares original rows, balances, post-migration settlement/replay and isolation, applies PR 09 and PR 10 against populated parents, checks route-block backfill, and exercises atomic chat replay and the cleanup command. Migration file hashes are verified on restoration; temporary accounts are cleaned. Do not run it alongside other database/browser checks.

Use a clean reset to verify all migrations, including after upgrading an existing test volume. Integration tests provision temporary synthetic accounts, obtain real password sessions, exercise the Node API and direct PostgREST, and clean up their records/accounts in `finally`. The global signup switch is false; the email provider remains enabled so provisioned accounts can sign in. Do not use this test stack for operator data.

`test:e2e` requires the running local stack. Its guarded runner provisions temporary synthetic accounts, supplies configuration in child-process memory, rebuilds the app, and serves the actual `dist` bundle with the shared CSP/security headers from the existing synthetic Node API composition. Production handlers and database services are used; only the selected synthetic account receives fixture inference. This avoids the observed native Windows Vite-preview failure. `test:dev` separately uses Vite development/proxy serving and the same API composition. Both cover Ask, direct Goals, chat proposal review and existing Data/auth behavior and reject browser requests outside exact loopback app/Auth ports. Add `-- --goals-proof` for the focused direct/chat Goals journey, or `-- --diagnostic` to either command for lifecycle logs; it changes no assertions, timeouts, runtime compiler options or live gates. Credentials remain in child memory; fixture accounts are removed in `finally`. Browser traces/video and automatic failure screenshots are disabled. Explicit synthetic screenshots/reports remain ignored under `test-results/` and `playwright-report/`. An interrupted runner may require a disposable reset.

The wrappers restrict which Docker engine and database project they use; they do not guarantee host-network isolation. On the tested Docker Desktop installation, Supabase publishes ports 54321/54322 on host interfaces, and the documented custom-network loopback option did not prevent non-loopback connections. Use a trusted network or owner-managed host restrictions, keep this stack synthetic, and stop it when finished. No global Docker or firewall settings are changed by these scripts.

`test:db` runs pgTAP schema, grants and constraint tests. `test:integration` runs the real Auth/PostgREST suite; ordinary `npm test` remains offline and Docker-independent. After a migration change, run `npm run db:types` to regenerate `server/db/database.types.ts`; `db:types:check` detects drift without rewriting it. Generated database types describe storage, not authorization, validated DTOs or exact monetary serialization.

All direct client table writes remain denied. The authenticated settings RPC can change only the caller's allowed profile fields and consent; it cannot alter ownership, account state, operator budgets, or arbitrary preferences. Private payloads, usage buckets/reservations and audit events deny direct client reads. The private-payload module uses authenticated AES-256-GCM envelopes with owner/purpose/version-bound metadata; it has no public endpoint.

`maintenance:cleanup` accepts no connection overrides and targets only the disposable local stack. Each pass reconciles at most 100 runs and cleans at most 100 expired import batches/private payloads. Stale executors are fenced; unsent reservations release, uncertain sent requests retain their full hold, and holds at least 24 hours old settle conservatively. Expired terminal execution metadata is removed after resolving reservations and detaching retained transcript/proposal references. Core conversations remain. One invocation stops after at most 100 passes and reports its work; repeat if the maximum is reached. Reads enforce payload expiry independently. Cleanup skips locked profiles; rerun after concurrent work finishes. Full account deletion is implemented through the resumable lifecycle; hosted maintenance remains an external gate. Keep required key versions recoverable as described in the setup guide.

### Contracts and provider harness

Executable schemas in `shared/` cover the complete documented domain DTOs, supported API inputs/envelopes, and all ten SSE v1 events. Settings uses the shared liveness validator. Ownership, evidence resolution, cursor authenticity, and business transactions require later services; parsing a DTO does not authorize it.

The API inventory preserves all nine paths and documented actions. Incomplete future payloads return `not_implemented` in the contract dispatcher. Direct goal create/revision/state inputs are implemented in `shared/goals.ts`; typed chat references are implemented in shared/chat.ts. See the [contract coverage and owning PRs](docs/evidence/pr02-contracts.md#contract-coverage-and-deferred-owners).

The default smoke command exercises normalized synthetic generation/tool continuation and decision-scoring interfaces. It uses no credentials or network and reports live roles as unavailable/disabled:

```sh
npm run test:providers
npm run test:providers -- --role=everyday
npm run test:providers -- --write-report
```

The last command explicitly refreshes the tracked provider evidence report. Ordinary tests do not write that report.

`npm run test:evaluations -- --write-report` runs the synthetic control cases and writes a machine-readable report. It does not assess a live model.

`npm run test:providers -- --mode=live --role=everyday` refuses requests without explicit spend opt-in before credential discovery. Ordinary verification must omit spend flags. Current synthetic Luna verification uses the fixed-case, aggregate-budget runner in [the owner/operator procedure](docs/operations/luna-verification.md), with a dedicated disposable stack and private server-side credentials.

The bounded v7 Luna checkpoint passed all 14 fixed synthetic cases, with separate host review of completed answers. [Observed evidence](docs/evidence/luna-owner-pilot-live.md) preserves five batches, functional repairs and pending interruption charges. The dedicated key retains its $0.50 total cap. Separate owner authorization enabled the [hosted Luna pilot](docs/operations/owner-pilot-luna.md); synthetic verification alone grants no deployment, real-data or activation permission. Optional providers remain unavailable.

[Synthetic hosting preparation](docs/operations/synthetic-hosting.md) provides create-only configuration, an inference-off build guard and an opt-in public routing/header probe. The root Vercel build intentionally refuses deployment without a bound target. [Local Step 3 evidence](docs/evidence/owner-pilot-step3.md) does not establish hosted security/recovery; resources, deployment and real-data use still need separate approval.

## Privacy and license

Never commit real health data, prompt/model execution payloads, individual medical documents, production credentials, or personal screenshots. Each family member's data is strictly independent and isolated by authentication and Row Level Security.

This repository does not claim medical diagnosis, prescription, or clinical decision support.

All rights reserved. No open-source license is granted for application code or brand assets.

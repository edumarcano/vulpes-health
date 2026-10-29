# Codex implementation plan

## Working rule

Use [`../../plans/v0.1.0-execution.md`](../../plans/v0.1.0-execution.md) as the canonical execution sequence and PR decomposition. Verify Milestones 0 and 1 independently; after both foundation gates pass, deliver dependency-bounded packets in small PR stacks, with approximately 2–3 dependent PRs open at a time. Preserve every milestone exit criterion. The target is a small working product, not all future architecture at once. The existing estimate of a few days is an aspiration for a prototype, not permission to skip security or report tests that were not run.

Track PR progress in the execution plan so work can resume in a fresh session. Keep the states distinct: proposed, in progress, locally verified, and fully accepted. A local pass does not satisfy a required live-provider or pilot gate. Optional decision scoring (execution-plan PR 14) can be deferred without blocking downstream work and remains disabled unless its own gates pass.

No cloud deployment, paid plan upgrade, production migration, account creation, provider privacy change or real-data upload without explicit owner authorization. Local repository files and synthetic tests are the default workspace.

## Milestone 0 - Verify and scaffold

Read all specifications and the existing repository. Preserve existing work; do not overwrite a nonempty repository wholesale. Create the React/Vite/TypeScript foundation (strict mode), compatible UI dependencies, lockfile, and modular server/client boundaries. Core domain services must never import AI vendor SDKs or assistant-ui. Add `.gitignore` rules before any `.env` work; use the root `.env.example` as the authoritative template.

Create the server-side typed model catalog (`server/config/models.ts`) and validation for the three distinct provider adapter interfaces (OpenRouter Responses for Luna, Vertex GenerateContent for Flash/Argon, OpenRouter Decisions for Microsoft-Decision-1). Check current docs against the selected identifiers, reasoning controls, tool/stream conventions and price mapping. Implement a synthetic provider smoke harness; it must require explicit opt-in to spend.

**Exit:** production build succeeds; no provider secret reaches the client; deep links and API routing work locally; unavailable/disabled provider states are real; replaceability test harness can run without network access. Document unresolved credential/region/API blockers. Do not fabricate successful smoke tests when credentials are absent.

## Milestone 1 - Auth, schema and isolation

Create migrations for the v0.1.0 tables, owner-parent constraints, RLS and narrowly granted transaction functions. Implement server auth verification and manual private-account provisioning documentation. Add explicit profile/preferences and provider consent.

Create two synthetic users for tests. Prove that reads, writes, joins, private payloads, foreign IDs and direct Supabase API access cannot cross accounts. Create encryption round-trip tests before retaining trace payloads.

**Exit:** two-user isolation passes; no public signup; logout/account switch clears user UI state; CI uses no real health records.

## Milestone 2 - First complete data slice

Implement canonical/manual import and a bounded column mapper. Add source/timezone/unit validation, encrypted preview, explicit commit, duplicate/conflict handling and export. Implement deterministic summaries from DATA_MODEL and the supplied fixtures.

Build the Data screen with one chart and a table alternative; implement loading/empty/error states. The data screen must work with all models disabled.

**Exit:** synthetic CSV imports, reimports without duplicates, converts units correctly and produces exact fixture results. An unknown RENPHO file layout is reported rather than guessed.

## Milestone 3 - One genuine Ask Vulpes loop

Build Ask Vulpes (`/ask`, `src/features/ask/`) using assistant-ui ExternalStoreRuntime, Vulpes persistence and the event stream contract. Wire Everyday generation (`openai/gpt-6-luna`), `list_metrics`, `summarize_metric` and read-only goal tools, bounded context, cancellation and idempotency. Name the agent `VulpesAgent` or `AgentOrchestrator`.

Implement the budget reservation and execution trace at the same time as inference, not as a cosmetic later log. Requests must pass ownership, consent, budget and trace-write gates before sending to a provider. The model cannot invent data if none exists.

**Exit:** a real permitted model answers a synthetic imported-data question using a tool; the user can inspect the exact requests/tool evidence; reload preserves the conversation; cancelled and failed runs are handled without silent retries. This is the first useful vertical slice.

## Milestone 4 - Goals and approvals

Implement goal forms, draft proposals, source-bound baselines, range/directional progress, explicit approval/rejection, revisions and conflict handling. Add goal tools and typed cards. The approval transaction binds the displayed payload, owner and object version.

**Exit:** create-through-chat -> review -> approve -> list/detail -> reimport data -> calculate progress works. A fabricated/foreign/stale/replayed proposal cannot mutate the goal. No target is activated by an ambiguous "yes" alone.

## Milestone 5 - Selected role lineup and controls

Finish/test Flash and Argon backend adapters. Remove the manual depth selector. Keep Luna primary, allow one evidence-backed Flash handoff, and exclude Argon from chat routing. Defer PR 14 without blocking M6; decision scoring stays disabled.

Expose actual availability, effective effort, consent, usage and per-user budget state. Test unknown pricing, privacy-compatible endpoint absence, provider timeouts and Google credential failures.

**Exit:** each advertised configured role has a genuine smoke result; unsupported roles are explicitly unavailable. No mandatory extra model layer or automatic frontier rewrite exists.

## Milestone 6 - Mobile finish and operations

Apply the approved brand, light/dark tokens, static PWA shell, icons and safe-area behavior. Complete Goals/Data/Settings/Inspector states, accessible charts, keyboard/focus checks and reduced motion.

Implement export/delete, retention cleanup, secure deployment documentation and a tested backup/restore process. Capture screenshots with synthetic data at the required viewports.

**Exit:** the required acceptance matrix passes; untested provider/Android/family functionality is explicitly labelled. Build a release report containing commands, results, screenshots, unresolved issues and approved deviations.

## Milestone 7 - Owner pilot, then family pilot

With permission, deploy to the owner's chosen Vercel/Supabase projects. Run a small real-data import only after the owner confirms the source file and consent. Compare a known reading and a computed summary with the source. Observe actual costs and storage.

Invite one adult family tester only after the additional family gates pass. Resolve isolation, recovery or deletion failures before inviting more users.

## Stop rules

Stop and request owner input for missing secrets/account access, conflicting approved specifications, unavoidable paid services, missing real CSV fields, unverified privacy-compatible model access, or a proposed scope expansion. Do not stop over ordinary implementation details that the specification already resolves.

When blocked on a live service, continue unblocked local development with a clearly labelled mock adapter and synthetic fixtures. Do not replace a selected model/provider without approval or claim the mocked path is the real integration.

## Cut first when time is short

Defer optional decision activation, decorative motion, elaborate chart comparisons, nonessential settings and visual extras. Do not cut auth isolation, exact numerical calculations, approval binding, input validation, budget admission, trace honesty, safe error handling or clear data-source limitations.

## Completion report template

```text
Milestone:
Files changed:
Commands and tests actually run:
Results:
Live services used and maximum/actual spend:
Known limitations / blocked checks:
Approved deviations:
Next milestone:
```

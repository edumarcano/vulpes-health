# PR 09: persisted Ask Vulpes and read-only tool loop

Branch `feat/pr09-ask-conversations`, from merged PR 08 on `main` at `98b097d4d7dabd5963f92ab55c34047d35e1b35f`, 2026-10-26. Actual PR base is `main`. The approved M3 batch plan and scoped implementation/publication instruction authorize PR 09 only. Merge, PR 10, live inference, deployment, real data and hosted resource changes are excluded. Recorded M2 acceptance remains separate.

## Delivered contracts

| Boundary | Behavior |
|---|---|
| Admission and persistence | Existing admission transaction inserts exactly one authoritative user message and assistant placeholder. Same validated input replays JSON; changed input or reused message identity conflicts. Another active run returns an owned busy link. |
| Conversation operations | Owned deterministic pagination, bounded pages and owner/filter-bound cursors; idempotent create/archive/delete; explicit deletion confirmation; first-message title. Deletion fences executors and removes transcript/private payloads while accounting survives without a conversation link. |
| Orchestration | `VulpesAgent`, at most four generation requests and six sequential read tools. Every generation uses the existing dispatcher, paired reservations, encrypted exact capture and fresh send authorization. No retry, decision scoring, escalation or goal mutation. |
| Context | Versioned safety instructions; authoritative timezone/units and selected approved goal; complete eligible history and opaque continuation blocks. Whole older groups are excluded when bounded context grows. Unsupported, incomplete, expired or invalidated groups are never reconstructed. |
| Read tools | Owned inventory, maximum 200 observations, deterministic source/method-qualified summaries, approved goal projection and a dedicated progress union. Ambiguity, absent data, unsupported baselines and review markers remain explicit. |
| Streaming | Server commits each assistant prefix before emission. Raw provider bytes remain separate and encrypted. Strict fragmented UTF-8/SSE parsing, typed terminal states, deduplicated sequences, run/message binding and read-only recovery. Known token totals are preserved; unknown categories and uncertain cost remain unknown. |
| Ask UI | assistant-ui ExternalStoreRuntime with send/cancel only, TanStack Query and explicit phases; new/list/archive/delete, depth unavailability, Stop, persisted reload and explicit new-request retry. Escaped text and server-resolved calculation cards; no raw HTML or model-generated links/components. Identity epochs guard requests, callbacks and caches. |
| Production gate | No production provider transport or mock fallback. Local synthetic injection uses a separate test executable and synthetic account. Actual prices/access/privacy/effective effort/live smoke remain unverified. |

## Actual interface proof

The local HTTP test imports the canonical synthetic CSV, admits one chat request, runs `list_metrics` and `summarize_metric`, and completes three generation requests through the Responses adapter. The persisted five-step ledger contains three generation steps and two tools. Each decrypted generation input equals the bytes received by the synthetic transport. Opaque output survives continuation and a subsequent user follow-up.

Observed calculation: previous seven-day mean **69.7 kg**, current **69.0 kg**, absolute change **-0.7 kg**. SSE reports known input/output totals **150/60**, nullable unknown categories and simulated reported cost **$0.003**. The browser displays the result and a qualified calculation card. Reload makes no new send. These are orchestration fixtures, not assessments of a real model or actual provider charges.

Concurrent identical HTTP sends create one message pair and one transport owner. A busy request cannot dispatch. Truncated output retains only its durable prefix; a failed second checkpoint emits no unsaved suffix. Cancellation from another handler retains possible cost. Revoked consent prevents the next dispatch. Stale leases become interrupted on reads without replay. A compatible replacement adapter uses the same dispatcher without domain changes. Forged evidence becomes an unavailable notice.

The populated upgrade command verifies the pre-PR-08 schema, original accounting migrations, terminology migration and PR 09 separately. Existing rows across **15 tables**, both owners and shared/account budgets remain unchanged across PR 08 → PR 09. It then proves atomic chat replay and invokes the actual maintenance command against expired, pending and stale synthetic records: **one payload removed, one run interrupted, one conservative settlement**.

Inspected built-artifact screenshots: [360 × 800 light](pr09-ask-mobile-light.png) and [1440 × 900 dark](pr09-ask-desktop-dark.png). The bounded message viewport and composer do not overlap; controls and calculation text wrap. These images use only synthetic measurements.

## Verification ledger

| Command | Observed result |
|---|---|
| `npm test -- --no-cache` | 292 tests, 19 files passed with the browser server stopped. |
| `npm run test:integration -- --no-cache` | 146 tests, eight files passed on the final clean schema, including all PR 08 and 19 PR 09 scenarios. This supersedes the earlier 145-test full run and 43-test lifecycle rerun. Known usage, baseline requested depth, the direct-consumer cancellation contract and the title regression all pass. |
| `npm run test:db` | 582 assertions, three files passed. Covers private table grants/RLS/composite ownership and narrow chat RPC grants/search paths. |
| `npm run test:execution-upgrade -- --allow-disposable-reset` | Ten migrations, two owners, 15 preserved tables; reserved/pending/settled state preservation, populated PR 08 → PR 09, atomic replay and actual maintenance proof passed. |
| `npm run db:reset:test` | Clean installation of all 19 migrations passed, followed by the final complete 146 integration tests and 582 database assertions. |
| `npm run db:lint`, `npm run db:types:check` | Passed; generated types exactly match the local schema. |
| `npm run lint`, `npm run typecheck`, `npm run build` | Passed on final sources through lint and the final bundle runner. Existing large-client-chunk advisory retained. |
| `npm run test:bundle` | Eight public files passed secret canary, server catalog, source-map and synthetic harness checks. |
| `npm run test:executions` | Original CLI proof passed on the final schema: one transport attempt, identical captured bytes, $0.022 held/conservative and corrected to $0.004; actual provider requests/spend zero. |
| `npm run test:providers -- --write-report` | Existing normalized-protocol fixtures passed for all four roles; zero actual provider requests/spend. This is separate from the new actual Responses adapter/tool-loop proof. |
| `npm run test:e2e -- --diagnostic` | All 100 built-browser checks passed in 4.3 minutes using the actual bundle and synthetic Node composition. All viewport/theme, keyboard, CSP, 200% text, reload/cancel/retry and account-switch checks passed. |
| `npm run test:dev -- --diagnostic` | All 17 real Vite development/proxy checks passed in 1.1 minutes, including all eight Ask scenarios. No runtime compiler options changed. |
| Specification validator / `git diff --check` | 486 specification/fixture checks passed; whitespace check passed on final documentation and source. |

## Retained failures and repairs

| Observation | Resolution / classification |
|---|---|
| First message equal to the default title allowed a later question to rename the conversation. | Real integration reproduction failed. The admission transaction now checks for earlier user messages and normalizes surrounding whitespace; the regression and complete 146-test rerun pass. |
| Initial deletion checkpoint found ambiguous SQL alias `r`. | Corrected the alias before clean installation; real admission/conversation tests passed afterward. |
| Split CRLF boundaries were not normalized across provider chunks. | Unit reproduction failed; buffer normalization fixed it and all fragmented-stream tests passed. |
| Full summary duplicated enough detail to exceed the conservative request bound. | Provider receives a qualified numerical projection; complete result and projection remain in encrypted evidence. Real imported-data continuation passed. |
| Parser rejection initially changed direct-dispatch abandonment from cancelled to failed. | Parent integration test reproduced the regression. Default direct-consumer cancellation is preserved; the agent explicitly selects parser failure semantics. Full integration reruns passed, with 146 cases on the final schema. |
| New-conversation tests filled the preceding thread while creation was pending. | Composer gates mutation/loading; tests synchronize the actual created ID and URL. Truncation/reload cases passed afterward. |
| Visual inspection found the sticky composer covering messages. | Replaced overlap with a bounded scrolling conversation and separate composer; added geometric non-overlap and viewport assertions. New mobile/desktop screenshots were inspected. |
| Legacy browser expectations assumed no Send control, no conversation keyboard controls and a nonexistent chat endpoint. | Updated to assert disabled Send, the actual keyboard order and authenticated JSON 401 for implemented routes; no edit/regenerate or automatic inference added. |
| The account-switch test requested Sign out on Ask, where that action does not exist. | It now signs out from Settings in a second tab while the first stream remains pending. The real cross-tab epoch/privacy test passed. |
| Broad text/label locators counted a conversation title as a third user message or matched both the conversation root and select. | Scoped exact-count assertions to transcript text and keyboard selection to the named combobox. |
| The conversation mutation error path showed a notice but also produced an unhandled rejected promise. | Browser reproduction captured the page error. Button actions now use handled `mutate`; the runtime's awaited send/cancel contract remains intact. The real browser error-path recheck passed. |
| First test-server command used an incorrect installed CLI path. | Inspected the package's actual `bin`; startup uses its existing `dist/bin/index.js`. No dependency installed. |
| Overlapping local harnesses hit the app-bucket uniqueness guard and occupied port 3001. | Retained as test scheduling failures; isolated reruns passed 582 database and 292 unit checks. Assertions were not weakened. |
| Normal browser reruns lost the preview server, producing cascading connection refusals. | Lifecycle diagnostics identify preview exit `3221226505` (`0xC0000409`), a native Windows failure. Root cause remains unestablished. JIT-disabled trials either lacked Vite-required WebAssembly or still failed; temporary diagnostic path/config corrections are retained as failed attempts, not product evidence. Compiler flags were discarded. The existing synthetic Node composition serves actual built assets with shared security headers: all 100 built checks passed. Separately, all 17 Vite development/proxy checks passed. `--diagnostic` forwards only lifecycle logs. All assertions/timeouts remain unchanged. |

## Split-axis self-review

Review surface: merged PR 08 baseline through current tracked/untracked PR 09 files, migrations, consumers and executable artifacts. Review uses the installed Remora procedure directly; it is not the independent cumulative M3 review.

| Axis | Status |
|---|---|
| Axis 1: specification fulfillment | **Approved for PR 09.** Actual API/database/tool/stream/browser evidence satisfies the approved local scope. No model/goal writes, hidden replay, provider substitution, PR 10 implementation or milestone acceptance is claimed. |
| Axis 2: engineering, security and test assurance | **Approved with observations.** All demonstrated blockers were repaired and rechecked. Typed ownership, narrow grants, profile-first locking, exact encrypted capture, fenced checkpoints, conservative accounting and identity epochs were traced through real callers/tests. Native Windows Vite-preview failure and the existing bundle advisory remain documented observations. |

Test assurance samples establish requirement → production path → observable failure: duplicate send → PostgreSQL admission → one pair/dispatch; trace failure → durable checkpoint → only the committed prefix; evidence ownership → owned tool-payload resolver → no forged card; cancellation/consent → existing fences → no second dispatch and retained holds; reload/account switch → read-only recovery/identity epochs → no new send or prior-user transcript. Provider-wire tests exercise actual request serialization and fragmented parsing; accounting and RLS tests use real PostgreSQL, not a mocked ledger.

Live provider access, actual selected-model behavior/prices/privacy, effective effort and required M3 live evidence are unverified. Physical keyboards/IME, native screen readers, hosted routing/auth and family readiness are not established by local Chromium. Existing client bundle size remains an advisory. Actual provider requests, hosted changes, deployment and real-data use: **zero**. Maximum/actual inference spend: **$0 / $0**. PR 10 and the comprehensive independent M3 review remain pending.

## Final local state

`maintenance:cleanup` completed with no remaining work after the populated maintenance proof. Final inspection found **zero Auth users and all 15 owned/accounting tables empty**. `npm run db:stop` stopped the dedicated disposable stack and retained its empty local volumes. Source/verification artifacts are ready for the authorized commit, push and open PR; no merge is authorized. Product-scope deviations: none.

# Luna v4 verification preparation

Base: `2e13a09b8af8317d57ef6e655457b08f048d48b4`, stacked on open PR #26. This packet prepares the approved current-Luna verification step. Live acceptance is **not run** and production stays disabled; no external inference or infrastructure mutation occurred.

## Public evidence and bounded proposal

Read-only public checks on 2026-10-31 confirmed the selected `openai/gpt-6-luna` listing and Azure ZDR entries with `safety_retention:false`. This is public availability, not authenticated account access. Rates vary by endpoint; the conservative snapshot retains $0.20 input, $1.00 output, $0.02 cache-read and $0.25 cache-write per million tokens at the existing 12,000 input/3,072 output bounds. Unsupported external plugins remain disabled. Source URLs and policy implications are in [the procedure](../operations/luna-verification.md).

The existing reservation formula produces `$0.0093192` per request including its 10% margin and conservative cache treatment. The fixed plan includes 50 possible requests, totaling `$0.46596`; request a separately approved `$0.50` aggregate ceiling. No extra attempts or automatic replenishment. Public ZDR routing does not exclude OpenRouter's announced screening/flagged-content retention exception; owner acceptance and account logging/data-use checks remain pending.

## Behavior and assurance

`verify:luna -- --plan` returns before credential or service access. Initialization requires an empty guarded local stack and a create-only manifest. Paid attempts bind that manifest's UUID, UTC month, ceiling, full plan/fixture hash and deterministic request IDs. Failed reports block further suite cases. Unexpected exceptions require private accounting inspection before continuation.

The original fixture/allocation path is preserved for historical tool/cancel/disconnect smokes. New fixed empty, sparse heart-rate and source-label injection fixtures use the same immutable database allocations and admission/trace/dispatch services. The goal case checks a pending proposal, synthetic exact approval, deterministic current progress, a contextual follow-up and same-source reimport without extra inference. Semantic quality remains `pending_review`, never inferred from fixture outputs or structural success. Budget denial remains a zero-request control rather than a model assessment.

A lazy key proxy reads only the fixed ignored credential file, only when the existing issued transport reaches its last credential check. It accepts one key assignment, never logs it, and cannot change global environment settings. Normal application and hosted inference remain off. The local prepared key file contains no key until the owner fills it.

## Verification actually performed

| Check | Outcome |
|---|---|
| Full offline units | 343 passed; an earlier 342/343 run caught the now-outdated expected denial after public preflight became current |
| Scoped live-batch integration with synthetic responses | 13 passed, including empty-data, zero-budget denial, goal approval/follow-up/reimport, sparse-heart-rate and injection fixture bindings |
| Strict typecheck and build | Passed; type-only test iterator errors were corrected before the passing build |
| Public bundle canaries | 15 files passed; no private server configuration or verification harness in public output |
| Lint | Passed |
| Specification/fixture validator | 506 passed |
| Plan CLI artifact | Printed exact 50-request / $0.46596 bound without reading credentials or dispatching |

The expanded goal fixture first failed test cleanup on an approved-revision foreign key. Following the existing fixture helper, cleanup now clears only the test owner's goal current-revision reference before removing its owned graph. The explicitly disposable owner-pilot verification stack was reset after that failure; retained M3 allocations were untouched. Goal and empty-data integration proofs then passed with synthetic transports. No production assertion or timeout was relaxed.

Application browser and full database acceptance results belong to Step 1 and are not relabelled as Step 2 executions. This packet changes tooling/public readiness evidence, not UI, schema or production approval. **Axis 1: Approved for preparation only.** Fixed scenarios, immutable aggregate limits, exact capture/reload and separate semantic assessment match the approved packet; actual Luna acceptance remains not run. **Axis 2: Approved with observations.** Reviewed all changed/new files and callers against `2e13a09`; privacy/key checks are fail-closed, credential-file parsing is lazy and fixed-path, and no production approval/positive run ceiling is installed. Corrected cleanup ordering and stale synthetic test timestamps/denial expectations are recorded above. This host self-review is separate from independent acceptance. The final focused integration run used the lazy credential proxy; no real provider boundary was exercised.

Actual provider requests/spend: **0 / $0**. Only unauthenticated public documentation/catalog endpoints and GitHub metadata were accessed. Remaining owner actions: current-policy acceptance, privacy/logging/key controls, a securely stored capped key, and explicit $0.50 synthetic-batch authorization. No deployment, real-data permission or Flash/Argon activation is included.

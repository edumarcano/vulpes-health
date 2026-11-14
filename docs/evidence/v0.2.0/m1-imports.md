# v0.2.0 M1: data and imports

**Date:** 2026-11-14. **Scope:** synthetic local M1 implementation on base `45063c8d0b82b7f1bab91a2fe249ebfaba6bfa64`. Local M1 verification is recorded below; hosted cutover and later milestones remain separate. No hosted migration, deployment, real-data intake, provider activation or model change is authorized by this record. Live provider requests/spend: **0 / $0**.

## Implemented contracts

| Area | Delivered behavior |
|---|---|
| Registry and adapter | 29 total metrics, including all 24 supported RENPHO numerics; three private annotations; exact originals/canonical decimal strings and static versioned semantics |
| Persistence | Owned weigh-in parents, source/batch/observation constraints, original/effective times, source defaults/version and bounded event reads |
| Transactions | Compact encrypted staging, explicit exclusion/unknown review bound to a hash, atomic commit, idempotent historical receipts, owned status/discard |
| Client | Functional picker for vendor/canonical/wide input; complete private detail paging; source defaults; basic event inspection/time/annotation/deletion; raw unresolved reads |
| Lifecycle | Exact selected/account exports, parent/last-child deletion, retained private-copy removal, accounting preservation, event recovery/deletion replay |
| Compatibility | Version 2 HTTP writer guard before cleanup; old direct writer grants revoked; incompatible pending imports/proposals invalidated; current eight-metric Goals/tool capability preserved |

[Import operations](../../operations/data-imports.md) owns usable contracts and limits. The [release plan](../../V0.2.0_RELEASE_PLAN.md) clarifies M1/M2/M3 boundaries. M2 authenticated sharing/default reuse, M3 richer analysis/references, M4 new goals/tools and M5 model work remain excluded.

## Verification and artifact proof

| Checkpoint | Observed result |
|---|---|
| SQL lint and generated types | Passed; generated types match the local M1 schema |
| Database security/contracts | 807 assertions passed across 11 SQL files; includes event RLS, writer grants and required provenance version |
| Exact full-panel HTTP | Independent 24-value fixture oracle, annotations, ownership, review hash, historical replay and enrichment executed against local Auth/PostgREST/API |
| Full backend | 268/268 tests passed across 24 files with the thread pool. After the terminal-preview guard and explicit event export/restore assertions, 15/15 targeted event/recovery tests passed |
| Pure contracts and boundaries | 658/658 unit tests passed across 57 files; the expanded below/at-record-boundary parser suite also passed 11/11 |
| Build protection | Typecheck/build, ESLint, Prettier and public-bundle canary/size checks passed |
| Forward/fresh migrations | Isolated-database rehearsal passed: four M1 migrations, Auth/consent/budgets/reservations preserved, old staging invalidated, full public schema replayed |
| Initial browser attempt | Failed before test execution: pinned Playwright Chromium executable absent; Windows worker assertions also observed. No browser acceptance from this attempt |
| Compiled browser closeout | 50/51 checks passed, with only an old export-section-count assertion failing; the corrected release journey then passed separately. All 51 selected checks therefore passed across the final runs, including full-panel mobile, inert annotations, raw unresolved reads, uncertain responses, account switching, viewport/theme and 200% text cases |
| Development browser observation | 18/41 passed. One goal-progress card-count expectation failed, followed by development-server connection failures. This development-runtime observation remains unresolved; compiled M1 workflows passed. No claim of a complete development-browser pass |
| First installed-Chrome checkpoint | 31/42 scoped tests passed. Failures exposed asynchronous checkbox state and stale fixture/wire/text expectations; repairs verified in subsequent runs |

The 24,000-observation acceptance uses an actual authenticated HTTP workflow, checks 1,000 parent events, 24,000 observations and 3,000 annotation additions, and records source/request/plaintext/gzip/ciphertext/JSONB sizes and preview/commit latency. The 1 MiB case includes legal control-character remarks to test JSON escaping. The [sanitized capacity artifact](m1-capacity.json) records a passing HTTP run: 266,368 CSV bytes; 355,523 request bytes; 1,499,863 plaintext staging bytes; 25,112 gzip bytes; 25,128 ciphertext bytes; 1,621,935 JSONB bytes; 8,385 ms preview and 11,642 ms commit (including application revalidation). The authenticated SQL timeout remains eight seconds. Hosting latency/concurrency is unverified.

The guarded shared-stack reset was refused because retained deletion receipts were present. Those records were preserved. `test:import-upgrade` instead creates a generated isolated database under the verified local Docker stack, runs historical migrations and a populated transition, compares operating controls, replays a fresh public schema, and drops only its own database. It never parks repository migrations or resets the shared stack.

## Failures and resulting repairs

| Reproduction | Repair / evidence boundary |
|---|---|
| 24,000-row SQL validation exceeded the existing authenticated 8-second timeout | Hoisted timezone lookup and materialized metric definitions; kept the production role timeout unchanged |
| Bulk commit exceeded the eight-second SQL timeout after validation was improved | Isolated rollback profiling measured validation 1.46 s, classification 1.36 s, event creation 1.08 s and bulk insertion 5.28 s. Cached classification lookup, an indexed timestamp join and function-local JIT disabling brought the actual HTTP capacity suite to a pass. No production deadline was raised. |
| Valid control-character annotations expanded normalized JSON beyond 4 MiB | Base64 text in compact staging; no size-limit increase or truncation |
| Parsed staging serialization reordered object keys and changed the content hash | Validate the parsed representation; commit the exact original authenticated serialized bytes |
| Required provenance version was nullable under SQL CHECK semantics | Require the version key explicitly; 801 SQL assertions then passed |
| Direct source-default RPC accepted an unconfirmed vendor timezone | Reproduced HTTP 200; tightened SQL person/timezone confirmation validation |
| Trusted same-owner write could attach an event to another source's batch | Reproduced HTTP 204; added source-aware batch/event/observation foreign keys |
| Review checkboxes reverted while awaiting the server | Reflect the chosen checkbox immediately while disabling review actions; retain authoritative server hash before commit |
| Concurrent browser/backend runs collided on the shared app budget | Setup `23505` failures are invalid acceptance evidence; final backend/browser runs were serialized. Separate serial capacity failures were investigated and repaired as recorded above |
| Native Windows fork worker exited during execution tests | It left its two synthetic accounts and app-period fixture behind, causing subsequent `23505` setup failures. Only those identified crash fixtures were cleaned; their synthetic accounting metadata was retained privately and older deletion receipts were preserved. The full backend rerun with `--pool=threads` passed |
| Discarded preview request replay looked actionable | Reproduced HTTP 200 after discard; terminal preview receipts now return 409 rather than a live preview |
| Lost-preview reconciliation reused the preview UUID for commit | Browser reproduced a 409 commit; reconciliation now allocates a distinct commit request UUID |

## Reproduction commands

Run from the repository root with the guarded synthetic Supabase stack available. No hosted fallback or provider call is used.

```powershell
npm run test:import-upgrade -- --allow-disposable-reset
npm run db:lint
npm run db:types:check
npm run test:db
npm run test:integration -- --pool=threads
npm test
npm run test:e2e -- --imports-proof --system-chrome
npm run test:e2e -- --release-proof --system-chrome
npm run lint
npm run format:check
npm run typecheck
npm run test:bundle
python docs/spec/v0.1.0/scripts/validate_spec_package.py
node docs/evidence/v0.2.0/m0-probes/verify-artifacts.mjs --fixtures
git diff --check
```

On Windows, put the installed Git Bash directory before the Windows WSL shim in `PATH` for the existing workflow-shell unit test. `--system-chrome` explicitly uses installed Chrome when pinned Playwright Chromium is absent. Run browser and backend suites sequentially because their fixtures share the app-period budget. The boundary parser test has a dedicated 120-second test ceiling for tens of thousands of real parsed rows; this does not extend HTTP or database deadlines.

## Split-axis diff review

The implementation agent reviewed the staged/unstaged change surface and new files against the approved M1 plan and current repository instructions. No separate-context reviewer is claimed.

| Axis | Outcome |
|---|---|
| Axis 1: specification fulfillment | Supported-field/decimal preservation, identity cases, explicit review, atomicity/replay, raw reads, capacity, ownership and lifecycle contracts were traced through actual HTTP/SQL/browser artifacts. The listed blocking defects were reproduced, repaired and rechecked. M2?M6 scope boundaries remain intact |
| Axis 2: standards, security and proportionality | Checked server authorization/RLS, composite lineage, bounded parsing/staging/querying, untrusted rendering/export, expiry, control preservation, provider independence and current tool/goal schema boundaries. Debug profiling code/functions were removed; no dependencies, model configuration or live resources changed |

**Verdict:** approved with the verification observations recorded here. No remaining demonstrated M1 correctness/security blocker was found in the reviewed surface. The Windows development-server observation and external gates are not passed or waived by local compiled-browser results. CI and external PR review remain separate from this implementation review.

## Remaining environment and release gates

| Boundary | Disposition |
|---|---|
| Hosted request/gateway/database concurrency | Not run; local success cannot establish hosted latency or platform fit. Rehearse only under explicit target approval |
| Actual RENPHO app/device/export variants | Unverified beyond the adopted synthetic English lb family; kg/st/locales remain unsupported |
| Physical Android/MIME/sharing and worker update recovery | M2 obligations; not run by M1 |
| Manufacturer numeric reference/classification | M3 evidence gate; no rule inferred from preserved vendor annotations |
| Live inference/model approval/spend | Unchanged and unverified; no live call is needed for M1 |
| Hosted cutover/restore access | M6/operator approval; an old application build alone is not a coherent rollback |

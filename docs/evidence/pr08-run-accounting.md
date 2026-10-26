# PR 08: persistent run admission and accounting

Branch `feat/pr08-run-accounting`, based on refreshed `main`/`origin/main` at `fe6675b7aa0a0d1700803397ce18e94a3f9e6b11`, 2026-10-26. Scope is execution-plan PR 08. Implementation/publication is authorized; merge and PR 09 are not. Recorded M2 acceptance remains separate.

The original implementation checkpoint below retains its recorded counts and vocabulary. [Budget terminology follow-up](#budget-terminology-follow-up) records the subsequent app/account migration and current verification.

## Implemented boundary

Server-only admission claims one active user run and compares canonical request hashes. Ten newly admitted runs per rolling minute are enforced in PostgreSQL. Prepared steps atomically register encrypted exact bytes/context, a price snapshot and both original-month reservations. Only a fresh authorization can send; stored evidence is decrypted and compared before that authorization. A single-use dispatcher port keeps provider serialization separate from credentials and ledger authority.

Cancellation, completion and stale-executor reconciliation use explicit terminal transitions and fences. Sent requests with unknown billing retain their entire reservation. Reconciliation after 24 hours charges the conservative amount; later authoritative evidence replaces it using an idempotent delta. Usage evidence and accounting commit together. No automatic generation retry or background job exists.

Measurement deletion removes private AI evidence, marks historical message context ineligible and fences late content writes. Account-deleting state blocks new admission/content. Billing-only reconciliation remains possible. The maintenance command handles bounded run recovery, conservative settlement and 90-day execution removal while preserving core transcript/proposal history. Settings exposes only the owned spending preference and balances.

## Actual interface proof

`npm run test:executions` passed against the guarded disposable local Supabase stack and a loopback HTTP receiver. Its inspected stdout was:

```json
{
  "scope": "local_synthetic",
  "admitted": 2,
  "idempotentReplay": "existing",
  "prepared": 1,
  "budgetDenied": 1,
  "transportRequests": 1,
  "capturedBytesEqual": true,
  "bodyBytes": 27,
  "heldUSD": "0.022",
  "conservativeUSD": "0.022",
  "correctedUSD": "0.004",
  "terminalState": "cancelled",
  "actualProviderRequests": 0,
  "actualSpendUSD": "0"
}
```

The reported balances are synthetic accounting values, not provider spend. The proof races two real transactions against one household bucket, inspects persisted results and cleans its temporary accounts/records. It accepts no live mode or connection overrides.

Integration scenarios use real Auth, PostgREST, PostgreSQL transactions, encryption and the production service/dispatcher. Only the external inference boundary is mocked. Month rollover is represented by moving a synthetic run's admission period to the preceding UTC month before performing real reservation, continuation and settlement; production has no test-clock override.

## Verification checkpoints

| Check actually run | Observed result |
|---|---|
| Clean `npm run db:reset:test` | All five PR 08 migrations applied after the existing M2 migrations. |
| `npm run db:lint` | Passed after the reconciliation variable repair. |
| `npm run db:types:check` | Generated database types match local schema. |
| `npm test -- --no-cache` | Final offline run: 279 passed across 17 files, including architecture boundaries and the reproduced hash regression. |
| `npm run test:db` | 546 pgTAP checks passed across three files. |
| `npm run test:integration -- --no-cache` | Final isolated run: 127 passed across seven files, including 25 ledger scenarios. Earlier checkpoints of 124 and 126 passed before the final compatibility assertion was added. |
| `npm run lint`, `npm run typecheck` | Passed at the latest completed checkpoint. |
| `python docs/spec/v0.1.0/scripts/validate_spec_package.py` | 483 checks passed after specification/evidence updates. |
| `git diff --check` | Passed; Git reports its existing generated-type LF/CRLF normalization notice. |
| `npm run test:e2e` | All 92 built-browser checks passed, including actual preference save/reload, rejected above-cap values, absent allocation and account switching. |
| `npm run test:dev` | Clean rerun: all nine development-server proofs passed. |
| `npm run test:bundle` | Strict build passed; eight public files passed canary, source-map, server-catalog and harness checks. Existing large-chunk advisory remains. |
| `npm run test:providers` | All four normalized synthetic role contracts passed; actual provider requests and spend remained zero. All generation roles unavailable; Decision disabled. |
| `npm run test:execution-upgrade -- --allow-disposable-reset` | Passed: two synthetic owners, original fields across all 15 tables and household balances preserved; direct cross-user reading denied. Parked migration files restored with byte hashes checked. |
| `npm run test:executions` | Repeated after the final upgrade proof; the inspected accounting output above remained identical. |
| `npm run maintenance:cleanup` | Passed with zero remaining work after fixture cleanup. |

The Settings screenshots from the built-browser 360x800 light and 1440x900 dark runs were visually inspected. The spending allocation, preference, reserved/available amounts and honest unavailable state were readable without horizontal overflow. Browser tests also exercised the specified viewport/theme matrix and 200% text zoom. Screenshot output is ignored and may be replaced by later runners.

The final staged implementation is locally verified. Publication and milestone/live acceptance remain separate.

Final cleanup inspection verified zero synthetic Auth users and all 15 owned/accounting tables empty. The dedicated local stack was stopped after verification; no operator data was imported or changed.

## Retained failures and corrections

| Failure | Classification and correction |
|---|---|
| Initial migration rejected an unparenthesized CASE expression inside a PL/pgSQL condition. | Fixed SQL construction error. Transaction rolled back; the corrected migration set subsequently applied cleanly. |
| Initial nine integration scenarios failed before admission because a reconciliation record variable collided with a query alias. Database lint reproduced the same cause. | Fixed implementation defect. Renamed/typed the variable; PostgreSQL lint and all nine original scenarios passed afterward. |
| Month-rollover fixture used different column sets in a PostgREST bulk insert. | Fixed fixture error. Separate setup inserts preserve the same accounting assertions. |
| Two intermediate scenarios could not record usage after a source edit had not yet been applied to the local function definition. | Fixed verification setup mismatch. Synchronized reviewed function definitions, then reran all nine scenarios successfully and the full 124-test integration checkpoint. Final clean/upgrade verification must use the complete current migration set. |
| Strict checks found an untyped asynchronous test collection and a fixture generator without yield. | Fixed test construction; no assertion or runtime policy was weakened. |
| Upgrade proof attempted its first synthetic Auth write immediately after local container restart. | Fixed verification readiness defect. Added bounded Auth/REST health polling without retrying writes; the full preservation/isolation proof passed. Its finally block also restores the current schema and verifies migration-file byte equality. |
| A development proof was started before upgrade recovery had fully restored the current schema; Settings failed to load while eight Data proofs passed. | Invalidated setup run. Restored the schema, completed upgrade verification and reran the unchanged development proof: all nine passed. No timeout/retry relaxation. |
| Self-review regression expected null aggregate token totals after reserving a continuation; actual values remained 20 input / 10 output from the previous step. | Fixed implementation defect. New paid preparation invalidates aggregate token totals; the same real-database assertion now passes. |
| Self-review regression showed locale collation ordering `ä` before `z`, changing canonical idempotency bytes. | Fixed implementation defect. Explicit code-unit key ordering produces the specified stable hash; the same assertion and final full unit suite pass. |
| Expanded integration attempt lost its isolation worker with Windows exit code `3221226505`; a subsequent fixture encountered the orphaned household unique key. | Runner failure; no product assertion established its cause. Reset only the guarded disposable stack and reran clean migrations/lint/types/546 pgTAP checks. Subsequent isolated full runs passed 126 and 127 tests. No tests or worker settings were weakened. |
| Compatibility regression expected an existing bucket's lower preference to display as `0.01`; the response showed null while enforcing `0.01`. | Fixed implementation defect. The owned read now reports the effective lower preference from existing bucket/profile state. The unchanged regression and final 127-test suite passed; operator allocations were not altered. |

## Review and external gates

**Axis 1: specification fulfillment — Approved for PR 08 local scope.** Reviewed the staged change against the approved PR boundary, COST-01–07, TRACE-02–05 and applicable SEC/MOD requirements. Real transaction and loopback proofs establish admission/idempotency, paired reservations, original-period settlement, exact encrypted capture, conservative uncertainty, cancellation/crash/deletion fences and owned settings. Reload/chat/tool orchestration and the inspector remain with PRs 09–10. No public route or provider support is simulated as available.

**Axis 2: engineering/security/test assurance — Approved with observations.** Reviewed actual SQL, service/dispatcher callers, schemas, tests, fixtures, shared settings and build boundaries across all staged files. Composite ownership, service-only grants, empty search paths, fixed lock order and no lock across HTTP remain intact. Capture, usage and settlement failure assertions exercise PostgreSQL rather than a fake database. Demonstrated hash, aggregate-usage and compatibility defects were reproduced and repaired. No unresolved implementation blocker remains. The existing client-chunk advisory and retained Windows worker/setup failures are observations, not hidden passes.

This is host self-review, not independent certification. The comprehensive independent M3 review belongs after PR 10.

No production provider transport is present. Prices, account/model access, privacy-compatible routing, live cancellation/usage behavior and the genuine M3 tool-loop evidence remain unverified. Ordinary CI and the smoke CLI cannot activate inference. Maximum/actual inference spend: **$0/$0**. No deployment, hosted resource change or real health data.

## Completion report

Milestone: M3, execution-plan PR 08 locally verified; M3 fully accepted is not claimed.

Files changed: ledger/pricing/dispatcher and shared contracts; five forward migrations, generated types and grants; owned Settings; bounded maintenance; synthetic proof/upgrade/browser/unit/database/integration protection; canonical decisions/status and this evidence.

Commands and tests actually run: the checkpoint table above records exact commands and observed results. Known limitations: no live provider/hosted deployment/physical-device evidence, and no PR 09/10 workflows. Sequencing authorization: the explicit PR 08 request permits this foundation while recorded M2 acceptance remains pending. Next packet: PR 09 only after separate instruction; no merge is authorized.


## Budget terminology follow-up

2026-10-26, following implementation commit `e6b0280`. The approved terminology is **app AI spending limit**, **account AI allocation**, and **personal spending limit**. The app limit aggregates inference spend across this deployment; it is not a household membership boundary or infrastructure-billing limit.

Migration `20261026000600_budget_scope_names.sql` changes scopes to `app`/`account`, reservation references to `app_bucket_id`/`account_bucket_id`, and the generated discriminator to `app_scope`. The five affected RPC replacements preserve signatures, grants, empty search paths, ownership checks, decimal accounting and app-before-account lock order. The earlier migrations remain unchanged. Settings uses the approved labels; neutral HTTP routes/fields remain unchanged. Deploy the migration and matching server code together during an accounting maintenance window; legacy direct SQL clients must adopt the new names.

### Upgrade artifact

`npm run test:execution-upgrade -- --allow-disposable-reset` passed. It first verifies the original five accounting migrations against the base schema, then applies the naming migration to populated accounting tables. Inspected output:

```json
{
  "scope": "local_synthetic_forward_upgrade",
  "base": "fe6675b",
  "migrationsApplied": 6,
  "owners": 2,
  "tablesPreserved": 15,
  "originalRowsUnchanged": true,
  "renamedStatesPreserved": ["reserved", "pending", "settled"],
  "postMigrationSettlementAndReplay": true,
  "crossUserDenied": true
}
```

Snapshots compare every existing field, translating only the named scope/column changes; IDs, money, receipts, evidence and private payload bytes remain unchanged. A migrated pending charge settles once despite replay, a proven-unsent reservation releases, and a previously settled charge accepts an authoritative correction. Both account balances and the app balance match the expected deltas with zero holds. These are synthetic accounting values; provider requests/spend remain zero.

### Follow-up verification

| Check | Observed result |
|---|---|
| Forward-upgrade proof | Passed as shown above, including restoration hashes and synthetic cleanup |
| Clean `npm run db:reset:test` | All six PR 08 migrations applied after the existing M2 migrations |
| `npm run test:executions` | Passed after clean reset; exact bytes, one boundary winner, $0.022 held/conservative then $0.004 corrected; provider requests/spend zero |
| `npm test -- --no-cache` | 279 tests passed in 17 files |
| `npm run test:integration -- --no-cache` | Final rerun: all 127 tests passed in seven files after the test-order repair |
| `npm run test:db` | 555 checks passed in three files, including current/legacy scope constraints, reservation references, isolation and grants |
| `npm run db:lint`, `npm run db:types:check` | Passed; generated server types match the renamed schema |
| `npm run lint`, `npm run typecheck`, `npm run build` | Passed; existing large client chunk advisory remains |
| `npm run test:bundle` | Eight public files passed server/private/canary checks |
| `npm run test:e2e` | All 92 built-browser checks passed, including approved labels, limit save/reload, above-allocation rejection and unavailable state |
| `python docs/spec/v0.1.0/scripts/validate_spec_package.py` | 484 checks passed |
| `git diff --check` | Passed |

### Retained failures and review

- Restricted-process unit startup returned Windows `spawn EPERM` before loading tests; the unchanged suite passed under approved local process permissions. Local Docker access likewise required approved execution outside the restricted process context.
- The first integration run passed 126/127. The oversized-staging cleanup assertion received the same two payload IDs in reverse order. Four reads in that test now request `order=id`; the exact before/after equality assertions remain intact. This was a reproduced test-order defect, with no production import changes or weakened assertions.


The updated Settings screenshots at 360x800 light and 1440x900 dark were visually inspected. Labels, help text and controls fit the layout; the browser suite also verified viewport/theme and 200% text behavior. Screenshots remain ignored test output, not a published artifact.

**Axis 1: specification fulfillment — Approved.** Reviewed the follow-up diff from `e6b0280`, including the new migration, generated types, callers, settings labels, tests and canonical documentation. Current scopes and reservation references use app/account vocabulary; remaining legacy terms are limited to immutable migrations, dated history, explicit upgrade translation and rejection assertions. The populated forward proof and clean migration demonstrate preservation and settlement. The HTTP contract remains stable and app balances stay private. No PR 09 implementation or live inference was introduced.

**Axis 2: engineering/security/test assurance — Approved with observations.** Composite ownership/scope/period constraints, unique monthly buckets, grants and security-definer search paths remain intact. Compared each of the five RPC replacement bodies against its predecessor: only the budget vocabulary changes. Transaction and lock order, exact encrypted capture, conservative uncertainty and idempotent settlement remain protected by real database/HTTP/loopback tests. The reproduced import-test ordering defect was repaired without production changes. No unresolved blocker remains; the existing bundle size advisory is unchanged. This is host self-review; comprehensive independent M3 review remains pending after PR 10.

Follow-up completion: the approved names are implemented across the current schema, Settings, tests and living documentation. Verification used only the dedicated disposable Supabase stack, synthetic accounts and a loopback transport. No model/provider request, cloud mutation, deployment or real health data; maximum/actual inference spend **$0/$0**. M3 live acceptance remains pending. Merge and PR 09 remain outside authorization.

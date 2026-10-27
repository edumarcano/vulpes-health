# M3 independent-review remediation

Branch `fix/m3-review-findings` starts at merged M3 commit `859ea56395cb361fe29c3107475ff130aee7b0de`. Scope is F1 completion transparency and F2 retained-message replay from the independent review of execution-plan PRs 08–10 (GitHub #11–13). Implementation, push and an open PR were explicitly authorized. Production inference remains unavailable; no live provider, hosted health database, deployment or real health records are used. Actual inference spend is $0.

## Reproduction and repair

| Finding | Before repair | Delivered behavior |
|---|---|---|
| F1 | New adapter and actual HTTP → database → inspector regressions failed: observable response ID, model and effort were absent, and finish reason was null. | The adapter emits bounded observed metadata. Settlement stores it with the existing executor/content fence and evidence-version receipt. The inspector separates requested and provider-reported model/effort and labels normalized finish reasons. Safe metadata survives private response expiry; absent and historical values remain unknown. |
| F2 | The new HTTP regression returned 503 for an identical retained receipt after execution expiry, including with inference disabled. | A service-only lookup checks the owned receipt before provider availability. Admission repeats it under the existing profile/conversation locks. Identical replay returns `retained` message state, changed input returns 409, and deleted/foreign conversations return 404. The client reloads persisted history without a new lease or dispatch. |

Migrations `20261027000100_completion_metadata.sql` and `20261027000200_retained_chat_replay.sql` extend the existing ledger. Earlier migrations remain unchanged. Clients require the new retained-result variant; apply migrations before running the updated server. Existing steps are not backfilled with invented metadata.

## Verification

| Command / artifact | Observed result |
|---|---|
| `npm test -- --maxWorkers=1` | 302 passed across 21 files. Adapter tests distinguish observed metadata from missing values and reject malformed, oversized and credential-shaped identifiers. The existing detector is shared with user-input validation. |
| `npm run test:integration` | 154 passed across nine files. New cases cover owned metadata after payload expiry, tool-continuation finish reasons, missing usage, duplicate/conflicting settlement, cancellation fences, rejected completion evidence retaining unknown-spend reservations, and retained replay through real HTTP and atomic admission. |
| `npm run test:db` | 630 pgTAP assertions passed across five files. New checks require the completion helper to remain private, replay lookup to remain service-only, and both functions to pin an empty search path. |
| `npm run test:e2e -- --diagnostic` | 101 built-browser checks passed. The inspector shows normalized completion reasons and separate requested/provider-reported values. Retained replay reloads the same two persisted messages without fabricating a run. Viewport/theme, 200% text, copy/export and ownership checks passed. Mobile light and desktop dark inspector screenshots were inspected locally. |
| `npm run test:dev -- --diagnostic` | 18 development-browser checks passed, including both remediation paths. |
| `node node_modules/tsx/dist/cli.mjs scripts/verify-execution-upgrade.ts --allow-disposable-reset` | Passed in a disposable copy: 14 migrations, two owners and 15 table snapshots preserved; populated M3 rows unchanged, legacy effective model unknown, existing route block retained, atomic replay and maintenance passed. |
| `npm run test:executions` | Two admissions, one budget denial, one loopback transport; exact 27-byte request equality; $0.022 held/conservative cost corrected to $0.004. Zero actual provider requests. |
| `npm run test:evaluations`, `npm run test:providers` | All 16 synthetic controls and four synthetic role contracts passed. Real-model assessment and live smokes remain `not_run`. |
| `npm run lint`, `npm run typecheck`, browser/bundle builds | Passed. |
| `npm run db:lint`, `npm run db:types:check` | Passed against the current local schema. |
| `npm run test:bundle` | Nine public files scanned; no secret canaries, source maps, server catalog, synthetic harness or private server output. |
| `python docs/spec/v0.1.0/scripts/validate_spec_package.py`, `git diff --check` | 488 specification/fixture checks and whitespace validation passed. |

The disposable HTTP probe observed `providerRequestId:"resp-synthetic-review"`, `finishReason:"stop"`, requested model `openai/gpt-6-luna` and provider-reported model `synthetic-effective-model`. After private response expiry, the response read returned `expired` while the ID and finish reason remained available. After execution expiry, identical replay returned 200 with two retained messages, changed input returned 409 `idempotency_conflict`, and total mock transport requests stayed at one.

Retained failures: F1's new adapter and HTTP assertions failed before repair; F2's new HTTP assertion returned 503 before repair. A further synthetic credential-shaped ID test failed during self-review and passed after sharing the existing detector with metadata validation. The first pgTAP run rejected the two unlisted new definer functions; explicit privilege/search-path assertions now cover them. One browser attempt stopped before test output with no established cause, leaving its synthetic server behind; the next diagnostic run correctly rejected occupied port 4173. The exact orphaned test process was identified and stopped before the successful 101-test rerun. An unnecessary CLI-version diagnostic hit a local telemetry-file permission error; no dependency or harness policy was changed. Local unit verification uses one worker because default worker startup timed out in the preceding audit; time limits and assertions were not relaxed.

## Split-axis self-review

**Axis 1 — specification fulfillment: Approved for the F1/F2 remediation scope.** Observed metadata reaches the owned inspector and survives payload expiry, while missing/historical values stay unknown. Historical replay returns a typed message receipt, rejects conflicts, and grants no execution lease. Actual API/browser artifacts and populated upgrades establish the local behavior; full M3 acceptance remains separate.

**Axis 2 — engineering, security and standards: Approved for this diff.** Reviewed the production changes, both forward migrations, affected callers, generated database types, tests, documentation and untracked additions. Accounting formulas and dispatch capture are unchanged. Existing profile/conversation/run locks, executor/content fences, RLS and service grants remain enforced. No provider SDK, model change, automatic retry, dependency, hosted-data access or activation path was added. No remaining demonstrated blocker was found in this remediation scope.

## Remaining gates

Live Everyday compatibility, current prices, privacy/capability evidence, real-model evaluations and authorized live tool-loop/cancellation evidence remain pending. Synthetic tests and this remediation do not grant production activation or full M3 acceptance. No M4/M5 feature work is included.

# PR 17: integrated acceptance and release evidence

Scope: approved M6 execution-plan PR 17. Branch `feat/pr17-release-evidence` starts at PR 16 commit `508757f5e5bc8735496d1be9cf481f69bb6985ea`; PR 16 remains an open dependency, so this PR targets its branch. PR 15 is integrated at `a7551fe`. No automatic merge, deployment, hosted health access, real records, provider calls or external spending is authorized.

## Evidence ownership

| Artifact | Meaning |
|---|---|
| [Build-created report](release/m6-local.json) | Actual command records, candidate/workspace fingerprints, installed versions, build hashes, all 70 acceptance IDs and reviewed screenshot inventory |
| [Acceptance mapping](release/acceptance-map.json) | Requirement-to-local-check mapping and external consequences; no hand-entered PASS values |
| [Release/deployment checklist](../operations/release-readiness.md) | Reproduction commands, provider bindings, limitations, approval and pilot gates |
| [Account operations](../operations/account-lifecycle.md) | Export/deletion/retention inventory, independent deletion journal, encrypted restore and operator-assisted recovery |

Report statuses distinguish `passed`, `failed`, `not_run`, `blocked` and `optional_disabled`. `localStatus` is bounded by `localScope`; scripted model behavior does not establish real-model quality. F-tagged rows remain identifiable through their canonical gate. Release readiness is false while required current-provider and external gates are missing. A suite's outcome does not independently prove every requirement; the assurance samples below describe the actual assertion paths.

## Prior milestone reconciliation

| Milestone / prior record | Reconciliation |
|---|---|
| M0/M1: [foundation](pr01-foundation.md), [remediation](m0-m1-review-remediation.md) | Preserve accepted local foundation and the dated acceptance decision. Current suites retain invalid direct-RPC display-name denial, owned settings preservation, completed-logout barriers and authenticated decompression-limit protection. Hosted routing/Auth remain separate. |
| M2: [timestamp remediation](m2-timestamp-remediation.md) | Second-60 rejection and microsecond/offset parity protect manual, CSV, correction and direct RPC paths. Data fixture oracle remains 69.7 kg, 69.0 kg and -0.7 kg; corrections, reimport receipts and export remain covered. Formal independent re-review/acceptance is not inferred. |
| M3: [replay/completion repairs](m3-review-remediation.md), [live re-verification](m3-live-reverification.md) | Current local regressions cover retained message replay after execution expiry without inference, v1/v2 historical readers, safe unknown effective metadata, exact request/inspection bytes and interrupted conservative accounting. Historical real Azure-routed Luna v3 results, original failures, notation-only reassessment and uncertain holds remain historical. Current v4 evidence is absent. No retained batch is reset or replenished. |
| M4: [daily-total/cache repairs](m4-review-remediation.md) | Preserve today's 8,000 steps versus 4,000 baseline/10,000 target (66.67%), timezone/DST and future-instant boundaries. Approval removes obsolete 50% chat progress without reload or extra inference; authoritative revised progress remains 33.333333333333336%. Formal M4 acceptance is separate. |
| M5: [PR 13](pr13-vertex-routing.md) | Luna-first, one authorized evidence-backed Flash handoff, consent/deadline/request ceilings, exact Vertex input, unknown cache billing and Argon exclusion retain local tests. Current Google price/access/location/privacy/live smoke evidence remains absent. Production unavailable. |
| Optional PR 14 / AI-10 | Deferred and disabled. MOD-03 tests Everyday's synthetic tool loop and deterministic services without a decision adapter. No classifier efficacy claim. |
| M6: [PR 15](pr15-mobile-pwa.md), [PR 16](pr16-account-lifecycle.md) | Repeat built/dev interface, public-only caches, ownership/export/deletion/retention, populated upgrade and separate encrypted restore. Earlier failed/retried runs are preserved; a new pass does not rewrite their history. |

## Integrated journey and verification environment

`tests/e2e/release-journey.spec.ts` uses one dedicated synthetic account across sign-in, reviewed canonical import, a deterministic tool answer, owned inspector, pending proposal, explicit approval, additional same-source HTTP import, current progress, reload, 18-section JSON download and resumable deletion through confirmed Auth absence. It asserts zero chat sends during deterministic actions, exactly two explicit sends, no active goal before approval and no owned rows after deletion. The external provider boundary is scripted; the built UI, HTTP handlers, Auth, PostgreSQL and encrypted trace paths are real. Recovery uses a separate actual restored environment rather than pretending a deleted identity can sign in again.

Verification uses `.scratch/pr17-verification` and local project `vulpes-health-pr17-test` on API/database ports 27421/27422; development uses 25173. Only documented project/port bindings differ from the candidate. Exact source comparison precedes checks. Installed dependencies are reused; no package/model substitution or dependency installation is performed. The default retained M3 stack and allocations are preserved. Browser external requests are rejected. Restore targets are separate, disposable and stopped after use.

## Observed results and retained failures

Actual outcomes and timestamps are generated in [m6-local.json](release/m6-local.json). Raw output stays private/ignored; only numeric runner output, hashes and reviewed synthetic artifacts are committed. No prior local or live result is silently promoted into a current acceptance PASS.

| Observation | Consequence / handling |
|---|---|
| Native process launch denied by Windows sandbox | Authorized local process execution used; no dependency, assertion or provider gate changed. |
| Initial copy omitted `.env.example` | Spec validator failed before checks; copy now permits only that committed public template while excluding actual environment files. Failure retained. |
| Local Supabase startup returned `uv_spawn` errors / partial startup | Stopped only the PR 17 partial stack, retried locally and verified Auth/REST/database availability. No exact underlying cause established; no hosted fallback. |
| First full integration: 50 failed, 68 passed, 77 skipped; one worker exited unexpectedly | Repeated fixture uniqueness failures and worker exit make this a failed run. Repeated reset → populated upgrade → lint → pgTAP → types checks each left zero app buckets/profiles/Auth users. Retain the failed invocation; do not attribute an application root cause without reproduction. |
| Unchanged default integration rerun | All 211 cases passed. A later final-source default run again lost a native worker (exit 3221226505), with 119 passed, three failed and 77 skipped. Different files were affected. Single-thread verification is recorded under its exact separate command; default failures remain visible. |
| Initial complete browser run | All 115 existing cases passed; the new journey reached app-data removal but its arbitrary 20-step loop stopped before Auth removal. The loop now follows the documented 100-step bound and adds HTTP-status assertions; terminal UI, owned-row absence and Auth absence expectations remain unchanged. |
| Collector adversarial summary test | A line containing private words inside a numeric-looking summary was accepted. The new test failed before repair; strict numeric grammar and allowlisted scalar proof fields pass all three collector tests afterward. No raw content is published. |
| Link validation before report assembly | Three links to the not-yet-generated artifact failed. Assembled an actual non-ready report with missing/failed statuses, synchronized it into the copy, then all 503 spec/fixture checks passed. |
| C: fell below 100 MB free | Separate restore was held while other verification continued. The user freed space; 8,718 MiB was measured before resuming. No unrelated files or Docker volumes were deleted. |
| New test minted an extra API token outside runner redaction | A loopback failure probe using a synthetic marker confirmed that Playwright request errors include authorization values. The journey now reuses the fixture token already present in the runner's redaction list. No actual credential was published. |
| Native exit also occurred with `--pool=threads` | A full 211-case thread run passed, but a later repeat exited 3221226505 before producing case results. The alternate mode is not claimed to fix the host issue. Fixture reset and a bounded rerun retain both outcomes; no assertion or timeout was relaxed. |
| Final-source development run: 30 passed, three failed | Three existing chat-proposal cases did not reach `Response saved.` within their unchanged five-second assertion; the captured UI showed an incomplete failed run. The new complete journey passed. The failed invocation remains in history; an unchanged bounded rerun investigates reproducibility without asserting a root cause. |
| Unchanged development repeat: 32 passed, one failed | The earlier three cases passed. The new journey instead timed out waiting for the inspector's `Step 5: generation` heading. The suite remains **failed**; no further success is inferred from the built-browser pass. The varying failures have no established root cause and require development-path investigation before local acceptance. |

| Final candidate checkpoint | Observed result |
|---|---|
| Lint, strict typecheck, build and bundle scan | Passed |
| Unit / PostgreSQL pgTAP / integration with `--pool=threads` | 336 / 720 / 211 passed |
| Built Chromium / development Chromium | 116 passed / latest repeat 32 passed, one failed |
| Static PWA privacy proof | One passed |
| Clean migrations, populated upgrade, database lint/types and maintenance | Passed; maintenance found no unfinished deletion |
| Accounting, evaluation and provider controls | Exact loopback bytes and conservative/corrected accounting passed; 16 synthetic evaluation controls and four synthetic role fixtures passed. Real models not evaluated. |
| Separate encrypted restore | Passed all recorded flags, including post-backup deletion replay, both key versions, revoked sessions and two-owner isolation |

The generated report owns exact commands, timestamps, fingerprints and final specification/stop outcomes. The development-suite failure blocks local acceptance of PR 17; the PR is a draft for review, not a completed local gate. Production-code repair is not justified by the available varying failure traces alone. Preserve the failing evidence and investigate the development transport/inspector path before promoting this packet.

## Assurance samples and omissions

| Requirement → plausible defect | Production path → observable assertion | Evidence level |
|---|---|---|
| Approval must be explicit → a tool activates a goal | Provider-boundary fixture → production tool/GoalService/proposal transaction → database has no goal while pending; browser approval writes it without another send | Executable local journey; real-model proposal quality omitted |
| Exact capture and cost honesty → transport differs or cancellation becomes free | ExecutionService/dispatcher → loopback receiver and encrypted inspector export → byte equality, paired admission race and pending/conservative/corrected amounts | Real local CLI/HTTP/database; provider billing/current live route omitted |
| Historical replay → expired metadata triggers another dispatch | Owned durable receipt lookup/admission → same request after run expiry returns retained messages; transport count unchanged | Real integration and built browser; prior live record remains historical |
| Daily totals/cache revision → wrong day or obsolete progress shown | GoalService calendar interval / approval query invalidation → UTC/DST current-value assertions and stale card removed with send count unchanged | Real database/browser regression; physical AT omitted |
| Deletion/recovery → late output or restored backup resurrects content | Persistent profile/journal/executor fences → delayed transport and concurrent continuations; authenticated separate restore → current deletion replay and revoked sessions before access | Real local database/failure injection/restore; hosted cutover and human identity handoff omitted |
| Evidence collection → configured/missing test becomes PASS or secrets enter report | Fixed local command runner → exit-bound record and content/workspace digest → unit assertions reject missing/stale/mismatched records and retain later failure; output sanitizer drops arbitrary content | Executable collector tests; records are not independent signed attestations |

The named chains are established by production-path assertions when their linked checks pass; their external omissions remain unverified. This sampling is not exhaustive correctness or clinical validation.

## Review and handoff

The self-review examined the full working diff, including new collector/tests, acceptance mapping, screenshots, CI and documentation, against base `508757f`. It traced the test composition into the production HTTP, service, persistence and provider boundaries. No production application, migration, dependency or model-catalog changes are included.

| Axis | Verdict and evidence |
|---|---|
| 1: Specification fulfillment | **Blocked** on local acceptance: the final development suite remains failed (32 passed, one inspector assertion failed), despite 116 built-browser cases passing. The complete built journey, recovery rehearsal and canonical acceptance inventory supply bounded evidence. Required live/provider, hosted, physical-device, human handoff and independent acceptance gates also remain explicitly unverified. |
| 2: Standards and anti-slop | **Approved with observations**. Fixed local commands, copy/fingerprint checks, exit-bound outcomes, safe numeric output, fixture-token redaction and reviewed screenshot hashes preserve evidence boundaries without new dependencies. Native Windows worker exits remain unresolved observations; alternate-mode passes do not erase default failures or establish a root cause. |

The remaining demonstrated blocker is an unmet development verification gate; a production application root cause is not established. These verdicts are a self-review, not an independent attestation or approval to merge.

PR-level split-axis self-review is separate from the combined independent M5/M6 review. The latter remains pending after the frozen PR 17 implementation. M5/M6 are not fully accepted, no release/pilot readiness is claimed, and PR 14 remains disabled. The [checklist](../operations/release-readiness.md) identifies required human decisions before provider spending/activation, hosting/migrations, backup/key destinations, real-account actions or family invitations.

Provider requests and external spend in this PR: **0 / $0**. Approved policy changes: none; existing 24-hour uncertain holds, 30-day backup maximum and at least 31-day completed journals remain intact.

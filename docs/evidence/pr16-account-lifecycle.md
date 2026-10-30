# PR 16: account lifecycle and recovery evidence

Scope: execution-plan PR 16 from the approved M6 batch. Base: integrated PR 15 on `main`, `a7551fe`. Branch: `feat/pr16-account-recovery`. All accounts/content/inference responses are synthetic. No hosted health data, provider request, deployment or production resource was used.

## Delivered behavior

| Boundary | Implementation/proof |
|---|---|
| Account contracts | Strict `/api/account` export/delete/continue/status; existing Settings deployment entry point; derived owner identity |
| Export | 18 owned sections, including safe Auth identity, pages of at most 200, exact decimal strings, chosen inspector-authorized trace parts, available staging, capture interval and integrity manifest |
| Capture races | Encrypted temporary artifact; concurrent change returns JSON 409 before attachment; cancellation/account switch discards download |
| Deletion | Durable explicit phases, private purges before settlement, profile/Auth gap recovery, server-confirmed completion only |
| Fences | Active-profile/content executor checks; cancellation receipt denial; durable profile reactivation/recreation guard |
| Accounting | Original admission month, 24-hour uncertainty, late/conservative settlement, owned allocation removal after settlement; shared charges/route blocks retained |
| Retention | Bounded staging/trace/proposal/run cleanup; completed journal retention beyond backup lifetime; stale export/known synthetic backup cleanup |
| Recovery | Actual encrypted PostgreSQL archive restored separately; schema/ownership/functions/grants/RLS/rows/budgets/empty Storage inventory and two key versions checked |
| Restoration deletion gate | Current independent encrypted journal applied before access; missing/stale journal or keys and corrupted archive fail closed |
| Credentials | Local operator-assisted reset, persisted session/refresh revocation, old password/session denial, fresh sign-in and two-user isolation |

The [runbook](../operations/account-lifecycle.md) owns procedures and inventory; this record owns observed outcomes. The export is not a transactional backup. The restore command is a guarded synthetic rehearsal, not a hosted backup service.

## Environment and checkpoints

Verification uses an ignored source copy with the same installed Node/npm dependencies, separate project `vulpes-health-pr16-test`, API/database ports 27321/27322 and development port 25173. No environment files were copied. The retained M3 database/allocations and existing port 5173 service were not reset or used. Restore destinations have unique `vulpes-health-pr16-restore-*` names and fixed loopback ports 28321/28322; source/populated destinations are refused. Access containers stop before restore/deletion replay and the disposable destination stops in `finally`.

| Executed checkpoint | Observed outcome |
|---|---|
| `npm run lint`, `npm run typecheck`, `npm run build` | Passed. Existing large-chunk build warning retained. |
| `npm test` | 333 passed. |
| `npm run test:integration` | Earlier full run: 211 passed. Final repeat: 210/211 passed, including final account changes; one existing chat-cancellation timeout. The unchanged case passed in isolation, then its full 24-case chat file passed. This is not a claim of a clean final 211-case run. |
| `npm run db:lint`, `npm run test:db`, `npm run db:types:check` | Passed; 720 pgTAP assertions and generated schema/type consistency. |
| `npm run test:lifecycle-upgrade -- --allow-disposable-reset` | Passed populated two-owner upgrade; actual maintenance resumed 20 deletion steps, reported zero pending deletions and `unfinished:false`, removed the intended identity and preserved the other owner. |
| `npm run test:e2e` | 115 built-browser checks passed before the last initiation-loss repair. Final `npm run test:e2e -- --lifecycle-proof`: eight passed, including the repaired failure injection and final export identity assertions. |
| `npm run test:dev` | 31/32 passed; one local Supabase status-helper failure. The unchanged failed case passed a focused development rerun. Final `npm run test:dev -- --lifecycle-proof`: eight passed. This is not a claim of one clean 32-case run. |
| `npm run test:pwa` | One standalone built-worker cache/offline privacy check passed. |
| `npm run backup:verify` | Final separate-environment rehearsal passed: schema/functions/grants/RLS/owners, row/Storage inventory, both trace keys, missing-key/tamper denial, post-backup deletion, current independent journal, session revocation, Auth/password recovery and two-owner isolation. |
| `npm run test:bundle` | Passed: 15 public files, no secret canaries, source maps, server catalog, synthetic harness or private server output. |
| `python docs/spec/v0.1.0/scripts/validate_spec_package.py`, `git diff --check` | 507 specification/fixture checks and whitespace checks passed. |

The development retry invocation set local Node heap/compiler-pool bounds; child environments retain the harness's existing environment allowlist. No application memory limit, timeout, assertion or dependency was relaxed. The focused rerun temporarily narrowed only the ignored copy's runner filter and restored it afterward. Synthetic screenshots of account controls and restricted deletion status were inspected at 360 CSS pixels and 200% text. No horizontal page overflow was observed; navigation disappears during deletion.

## Failure injection and retained failures

| Observation | Resolution/evidence |
|---|---|
| SQL deletion settlement name collision | Direct RPC reproduced SQLSTATE 42702; distinct row/alias names corrected it; actual lifecycle tests then passed. |
| Delayed cancellation could insert a receipt after fencing | Failing real-ledger test reproduced success instead of denial; cancellation now checks active profile under the same lock. |
| Profile could be reactivated during deletion | Admin mutation reproduced the bypass; durable receipt guard rejects reactivation/recreation. |
| Maintenance lost accounts after the last hold settled | Both reported/conservative cases reproduced missing work selection; no-hold accounts remain eligible and purge progress leaves the waiting outcome. |
| Auth unavailable after app/profile cleanup | Injected Auth boundary outage leaves `auth_removal_pending`; retry confirms Auth absence before completion. |
| SQL purge transaction failure | Disposable owner-specific DELETE trigger throws; HTTP returns 503, committed fence and payload remain; removing fault permits retry. |
| Real token refresh after aged password authentication | Disposable Auth AMR record aged six minutes; refresh preserves age and deletion returns 403. Initial fixture used a nonexistent table name; corrected against actual local Auth schema. |
| Built browser initially 111/115 | New empty status region caused three Settings locator failures; removed the empty region. Contrast read ran during account verification; now waits for the real heading, retaining two ratios and 4.5:1 thresholds. |
| Completion status race | Actual completion receipt replayed as an in-flight status response reproduced a stuck progress screen; completion now clears the session and shows the authoritative receipt. |
| Lost initiation reply left normal account navigation visible | Actual initiation committed `fenced`, then the browser route dropped its response. The new browser assertion failed. A submitted-but-unconfirmed initiation now clears private state and rechecks authoritative status; a failed recheck uses restricted unconfirmed status. |
| First development repeat after initiation repair | Initiation recovered, but subsequent navigation failed to show progress while a separate PowerShell process also failed memory allocation. No exact common cause is claimed. The same eight cases passed unchanged when run serially from a lightweight shell. |
| 200% text screenshot | New account card padding was excessive; bounded padding and checkbox layout improved readability without reducing text size. |
| Post-reset upgrade Auth connection failed | Reproduced `fetch failed` during first identity creation; bounded Auth/REST readiness checks precede fixture creation. |
| Database lint could not analyze literal-array iteration | Checker treated the array as a relation name; equivalent bounded `SELECT unnest` iteration passes without suppressing lint. |
| Initial pgTAP existence assertion used wrong overload | Corrected the assertion signature; all 720 checks passed afterward. |
| Restore policy cleanup failed on absent product tables | Fresh empty/disconnected schemas replace partial `--clean` cleanup. Supabase-owned schemas require the local `supabase_admin` role. |
| Restore comparison identified PostgreSQL representation differences | Logical columns exclude physical dropped-attribute positions; ACL entries sort; CHECK definitions reparse on empty temporary tables. Constraints, grants, functions and owners remain compared. |
| Windows sandbox blocked bundle build child process | Re-run with approved process permissions passed the 15-file secret scan; dependencies/behavior were not changed. |
| Parallel build attempts exhausted local memory | V8/Rust allocation failures stopped verification before tests; commands were rerun serially. No application/test limits were relaxed. |
| Development worker allocation failure and local CLI status failure | First run lost workers/API under resource pressure. Retry passed 31/32; the unchanged remaining Data case passed in isolation. The status helper's exact cause was not established. |
| Final integration repeat: chat cancellation timeout | 210/211 passed. The existing cancellation case exceeded 30 seconds; unchanged isolated rerun passed, then all 24 surrounding chat cases passed. No timeout/retry/assertion change was made; exact cause remains unproven. |
| Cancellation did not reach an in-flight inspector read | Real transport-barrier and pre-cancelled Auth tests failed; the request signal now reaches Auth, ledger, inspector and staging reads. |
| Full export omitted safe account email identity | Actual exported JSON reproduced the omission; an owned Auth projection adds email/phone/timestamps while excluding credentials/session/operator metadata. |

The delayed dispatcher uses a synchronization barrier and the real ledger/checkpoint path. After fencing, late bytes are neither yielded nor persisted. Available raw input export is compared to exact bytes. Missing/expired evidence is labelled; it is not reconstructed.

## Acceptance mapping and review boundary

OPS-02/03 are exercised locally through actual HTTP, PostgreSQL and Chromium. OPS-04 uses a separate restored database and real Auth/RLS paths. OPS-05 establishes the synthetic admin/reset/session path; real identity verification/handoff and hosted operator access remain unverified. Affected SEC-01–07, TRACE-01–05, COST-01–07 and MOD-06 retain their existing local protections and add lifecycle-specific isolation/fence/expiry/retention proof. This PR does not claim fresh provider, physical-device, deployment or family evidence.

Both Remora self-review axes inspect the actual staged/unstaged/untracked diff and affected callers, including all four forward migrations, HTTP dispatch, Auth/RLS, ledger settlement, inspector reads, browser identity changes and local operator tooling. This is implementing-agent self-review, not the deferred independent M5/M6 review.

| Self-review axis | Verdict and boundary |
|---|---|
| Axis 1: specification fulfillment | **Approved with observations.** Approved local account inventory, phase interruption/concurrency, delayed provider fences, accounting, retention, forward preservation and recovery are exercised. Demonstrated defects above were repaired and affected checks rerun. Intermittent local integration/development failures remain recorded; their exact causes are unproven. External acceptance remains pending. |
| Axis 2: standards and security | **Approved with observations.** Reviewed strict ownership, narrow grants/search paths, lock order, request cancellation, authenticated encryption, local-target guards, secret handling and unchanged dependency scope. No unresolved demonstrated blocking defect remains. Existing large client chunk is advisory; no performance improvement is claimed. |

Sampled assurance chains connect the actual production path to observable consequences: profile lock/journal fence → four concurrent HTTP continuations → one receipt and unchanged foreign rows; real dispatcher barrier → deletion → no late bytes/checkpoints and original-month charge; inspector expiry → denied bytes while the envelope still exists; encrypted archive/journal authentication → disconnected restore → post-backup owner absent and retained owner isolated. Physical infrastructure and human recovery identity/handoff are omitted deliberately and remain external gates. No findings is exhaustive proof.

Provider requests: **0**. Maximum/actual app inference spend: **$0**. No approved policy deviation, new dependency, merge or deployment. PR 14 remains disabled/deferred; PR 17 and combined independent M5/M6 review remain separate.

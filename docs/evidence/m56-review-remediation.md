# M5/M6 review remediation

Base: `e822c0b18efa61d134ef95bb6f454fd952dcf06a`, following the independent cumulative review of execution-plan PRs 13 and 15–17. The four demonstrated local blockers are remediated. Complete ordinary gates passed: 120 built-browser, 37 development-browser, 220 integration, 734 PostgreSQL and 336 unit cases. This record does not establish full milestone acceptance or authorize deployment or providers. PR 14 remains deferred and disabled.

The reviewed range was `e94189032bfad4969a7c8608c4e55641e7ebc449..e822c0b18efa61d134ef95bb6f454fd952dcf06a`: immediately before execution-plan PR 13 (GitHub #20, `172b5cb`), through PR 15 (#21, `a7551fe`), PR 16 (#22, `2fdb0af`) and merged PR 17 (#23, `e822c0b`). Execution-plan numbers differ from GitHub PR numbers.

| Original independent verdict | Axis 1: requirements | Axis 2: engineering/security |
|---|---|---|
| M5 | Blocked: Google verification roles used OpenRouter's consent version. | Blocked: same-version operator approval changes could still permit dispatch. |
| M6 | Blocked: the complete development-browser acceptance gate failed. | Blocked: expired pending draft bodies remained readable/exportable before cleanup. |

These are verdicts on the reviewed merged range. The remediation self-review below assesses the additional changes separately; it cannot retroactively turn the original review into an approval.

## Reproduction and checkpoints

The tracked `tests/integration/m56-remediation.test.ts` reproduces the audit findings through production admission, dispatch and HTTP export paths. Tests run in the existing disposable `vulpes-health-m56-review` project, API/database ports 28421/28422. Retained provider allocations and historical evidence are untouched.

| Check | Actual result |
|---|---|
| Baseline blocker reproductions | Both Google roles returned `run_policy_denied`; changed approval permitted one mock transport send; export returned an expired pending proposal's complete draft. Four assertions failed. |
| Direct authenticated expired proposal read before repair | Failed: the row and canonical body remained readable before cleanup. |
| Vertex policy-binding checkpoint | Four independent changes (project, location, privacy fingerprint, notice) denied dispatch with zero transport sends. The existing real HTTP Luna→Flash workflow also passed with exact persisted input. |
| Google admission checkpoint | Intermediate and advanced admission passed with the actual accepted Google version. |
| Expired proposal checkpoint | Direct authenticated read returned no expired pending row; HTTP account export returned `expired` and a null canonical body. Passed before physical cleanup. |
| Strict TypeScript checks | Passed after correcting the Supabase abort-signal call order. |
| Full focused regression suite | Nine cases passed, including a policy change during asynchronous credential acquisition and byte-preserving ledger/staging storage with an API clock lead. |
| Browser clock cause | The six original goal cases with a one-second API-only clock lead failed four cases before the expiry fix. PostgreSQL logged `run_upper_delta_ms=981.976000`, matching owner/purpose and payload version 1. All six passed after database-assigned expiry, with unchanged assertions. |
| Development browser checkpoint | 33 passed before the expiry repair, with no logged rejection. This does not replace the failed historical runs or the required final candidate gate. |
| Later development failure after expiry repair | 32 passed; release journey timed out after 90 seconds waiting for a deletion-continuation response. The UI stayed fenced and reported unconfirmed completion. Failure retained; the earlier built pass did not clear this gate. |
| Same-owner auth refresh reproduction | A real browser request was held while Supabase's BroadcastChannel delivered a same-owner token refresh. The continuation failed locally (no HTTP response). Re-entering the deleting state forced a new scope and aborted its own request. After preserving that restricted scope, the extended check caught the older completion restoring a stale session; a functional state update preserves the latest session. The nine-case lifecycle browser packet then passed with unchanged timeouts. |
| Unit gate | 336 passed. The preceding run had 335 passed and one occupied-port setup failure because a concurrent browser API owned port 3001. The serial rerun used unchanged assertions. |
| PostgreSQL gate | 734 passed. The first run caught two unnecessary security-definer declarations; both new functions now use caller privileges and the unchanged exhaustive security allowlist passes. |
| Full ordinary integration gate | 220 passed across 14 files with the default worker mode; no test timeout or assertion changed. |
| Built-browser checkpoint before auth repair | 116 passed, including the full import → Ask → inspection → approval → reimport → export → confirmed deletion journey. |
| Built-browser checkpoint after deletion repair | 117 passed, including the deterministic same-owner refresh/current-session case and full release journey. This preceded the active-account inspector repair. |
| Later development inspector failure | 33 passed, one failed at the release journey's Step 5 inspector assertion. Final-message hydration and pointer-event diagnostics did not reproduce a defect; diagnostic passes did not clear the failed gate. |
| Active-account revalidation reproduction | A controlled same-owner Supabase token-refresh event removed an already-open inspector: eight mobile cases passed, one failed before repair. Preserving the verified active view during the status check then passed all nine mobile cases, including the unchanged missing-dialog assertion at 390×844. |
| Complete built-browser attempt after active-account repair | 118 passed, one failed at the same release-journey Step 5 inspector assertion. The controlled auth fix does not explain or clear this remaining failure; investigation continues. |
| Inspector click-loss reproduction | A warm-API inspector-stage probe reproduced the missing dialog. Native tracing captured pointer-down on the Inspect button, pointer-up on a paragraph and click on the container; the React Inspect handler never ran. A second trace isolated focus rather than message growth: content height stayed 624 px while focus reduced viewport height from 364 to 322 px and moved the button from y=434.09375 to y=476.09375. The mobile `:focus-within` rule changed conversation height from 70dvh to 65dvh. |
| Rejected inspector readiness gate | A final-message barrier first failed a disabled-action expectation, then nine mobile cases passed with the proposed gate. The full built suite was 117/119: the inspector failure persisted and the gate blocked existing live-stream inspection in the account-switch case. The gate and its disabled-action expectation were removed; ordinary live inspection and original assertions are preserved. |
| Deterministic focus regression before CSS repair | Focusing Inspect changed conversation height from 590.796875 to 548.59375 px, failing the unchanged-height assertion. Five cases passed; four subsequent cases could not connect after the development server disappeared. Those connection failures are distinct from the demonstrated geometry assertion; its server-termination cause is unproven. |
| Focus repair checkpoint | Removed only the mobile focus-dependent resize rule. All ten built mobile checks passed, including focus geometry, live inspection and same-owner refresh. |
| Complete built attempt after CSS repair | 119 passed, including the full release journey. One viewport case did not run: its worker exited at 0 ms with native code `3221226505`. This is not a completed suite pass; its native termination cause remains unproven. |
| Final complete built-browser gate | 120 passed in the ordinary runner with retries=0, unchanged assertions and timeouts, and no diagnostic instrumentation or filters. The serial complete rerun did not change source after the native exit. |
| Development server loss after CSS repair | 11 passed; the remaining 26 cases received connection-refused errors after the local development HTTP server disappeared. This was not a complete gate pass. |
| Complete development diagnostic run | All 37 cases passed with the existing `--diagnostic` logging flag, retries=0 and unchanged assertions/timeouts. The server remained available and shut down normally. This did not reproduce or explain the preceding server loss. |
| Final ordinary development gate | 37 passed without diagnostic logging, retries=0 and unchanged assertions/timeouts, including the complete release journey. |
| Final unit, bundle and PWA gates | 336 unit tests passed; the final canary build and all 15 public files passed; the built service-worker privacy/offline check passed. |
| Accounting CLI artifact | Two admitted runs competed for one permitted reservation; one was denied. One loopback request preserved all 27 bytes exactly. Cancellation held `$0.022`, conservative settlement retained `$0.022`, and authoritative correction produced `$0.004`. Actual provider requests/spend: 0/$0. |
| Synthetic controls and adapter smoke | All 16 scripted controls and all four synthetic adapter rows passed. Every row retains `modelAssessment` or `liveSmoke: not_run`; production roles remain unavailable and optional decision scoring remains disabled. |
| M5 populated forward upgrade | Preserved two owners' runs, steps, ciphertext, goal revisions and paired accounting through all later migrations. No Google approval was installed. |
| M6 populated forward upgrade and maintenance | Preserved both owners' product rows, ciphertext and accounting; denied deleting-owner access while the other owner remained isolated. Actual maintenance resumed deletion to completion with no pending work. |
| Final schema and restore gates | Database lint passed and generated types matched. A separate encrypted restore verified schema/functions/grants/RLS/owners, row/storage inventory, current and retained keys, tamper/missing-key rejection, post-backup deletion replay, independently required journal, revoked sessions, password recovery and two-owner isolation. Backup maximum remained 30 days; provider requests: 0. |
| Final cleanup | Reset the dedicated review source to remove synthetic fixtures, then stopped it. The restore verifier stopped its separate generated destination. Retained verification stacks were not reset or stopped. |
| Bundle proof | Build and 15-public-file canary scan passed; no provider/admin/encryption canary, server catalog, harness or source map was public. |
| Lint and package validation | Lint passed after the final auth repair; 504 specification/fixture checks passed. |
| Combined focused verification attempt | Ended without a complete runner summary after several results. A subsequent invocation failed setup on a leftover synthetic allocation. Neither is counted as a completed pass; the disposable stack was reset before the isolated expiry pass. Exact process-termination cause remains unproven. |

The first policy trigger checkpoint blocked provider-neutral tool steps because SQL NULL did not satisfy `provider <> 'vertex_ai'`. The positive handoff control caught this; `IS DISTINCT FROM` corrected it before the passing checkpoint.

Inspector diagnostics included ten passing fresh-server journeys and a passing traced 119-case run; these did not clear the earlier untraced failure. An initial warm-stage probe grew its input past the verified context bound, and an attempted source cleanup hit a foreign-key restriction. Reusing one synthetic source kept the diagnostic input fixed and reproduced the actual inspector failure. Disposable trace instrumentation and stage-only/iteration filters are excluded from the production and tracked test changes. A later mobile attempt ended without a runner summary and stranded its test API; the next attempt refused the occupied port. Only the identified synthetic processes were stopped before the completed red regression above.

Run reproduction commands only inside a guarded disposable verification copy with matching project/container/port bindings, never against retained provider allocations. The local copy procedure and standard gates are described in [release readiness](../operations/release-readiness.md).

```sh
npm run test:integration -- tests/integration/m56-remediation.test.ts --pool=threads --reporter=verbose
npm run test:dev -- --goals-proof --clock-proof
npm run test:integration
npm run test:e2e
npm run test:dev
npm test
npm run test:bundle
npm run test:pwa
npm run test:db
npm run test:executions
npm run test:evaluations
npm run test:providers -- --mode=synthetic
npm run db:reset:test
npm run test:vertex-upgrade -- --allow-disposable-reset
npm run db:reset:test
npm run test:lifecycle-upgrade -- --allow-disposable-reset
npm run db:reset:test
npm run db:lint
npm run db:types:check
npm run backup:verify
```

## Remora self-review of the remediation

The surface includes all modified and new source, migrations, tests and documentation from the base above. Production callers, authorization/retention contracts, original transaction gates and regression assertions were inspected. The 258 executable/test/configuration files compared against the verification copy match after the documented project/port substitutions and line-ending normalization. The same implementer's self-review is separate from independent acceptance of the final PR.

| Scope | Axis 1: requirements | Axis 2: engineering/security |
|---|---|---|
| M5 remediation | Approved: same-version approval drift denies dispatch; Google roles admit with their approved consent. Positive handoff, exact capture, budget and cancellation controls remain protected. | Approved: approval locking and internal digest binding preserve existing send gates; transport rechecks after credential acquisition. No domain/provider boundary or catalog change. |
| M6 remediation | Approved for the local repairs: expired drafts are unavailable before cleanup; database expiry, auth/deletion races and mobile focus geometry have real boundary regressions. Both complete browser gates and recovery/upgrade proofs passed. | Approved with observations: RLS/export projection, authenticated expiry and scoped identity transitions preserve isolation. Windows native worker exits and development-server loss remain recorded, with their exact causes unproven; complete ordinary runs also passed. |

No demonstrated blocker remains in this remediation surface. The extra database round trip before sealing each payload is an explicit correctness trade-off, not a retention-policy relaxation. Timestamp-only rejection diagnostics were removed by disposable resets. The rejected UI gate, native tracing and diagnostic iteration filters are not production changes. Selected final synthetic 390-pixel inspector and goal-progress screenshots were visually inspected; this is not physical-device or assistive-technology evidence.

## Remaining acceptance and authorization gates

The PR needs independent review of the repaired candidate and the outstanding formal earlier-milestone acceptance decisions. Current-bound provider rates, privacy/location/access, credentials, live smoke/evaluation and activation remain unverified and require separate authorization. Hosted routing/Auth/RLS/recovery, actual supported devices/assistive technology, operator credential handoff and owner/invited-adult real-data gates remain pending as listed in [release readiness](../operations/release-readiness.md). Vulpes is not ready to request pilot authorization on these local results alone.

The controlled clock fault proves a causal browser-path failure, without proving the cause of every historical browser failure. Historical PR-level evidence and failed audit runs remain unchanged. The new transport test initially left its synthetic verification allocation, preventing fixture cleanup; its cleanup now uses the existing live-batch test's guarded local SQL pattern and the complete nine-case rerun passes.

Provider requests/spend: **0 / $0**. No real health data, deployment or merge.

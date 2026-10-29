# PR 12: chat proposals and explicit goal approval

Execution-plan PR 12 is based on verified PR 11 at `c8a657527e5664cf3b3576f86a512758a5ff1145`, with dependent base `feat/pr11-direct-goals` while GitHub #16 remains open. This report records local synthetic verification on 2026-10-28. Production inference, deployment, live-provider proposal behavior and formal M4 acceptance remain separate. Actual provider requests/spend: **0 / $0**.

## Delivered behavior

`propose_goal` and `propose_goal_revision` prepare pending proposals through the same GoalService used by direct Goals. The model supplies definition fields and the expected goal version; the server supplies ownership, run/step identity, replay key, frozen baseline, resulting state and expiry. No approval, activation, lifecycle or direct-update tool exists.

One service-only transaction reuses PR 11 registration and M3 execution/checkpoint/settlement rules. It checks the owner, active profile, conversation, executor, fence, lease and data revision, then commits the pending proposal, encrypted tool result, completed step and durable message reference together. A source step can register only one proposal. Failure rolls the transaction back; interruption after commit leaves a complete pending proposal recoverable on reload.

Chat cards resolve an owned message-bound ID/hash/version, fetch authoritative status/body and reuse the direct Goals review component. Approval/rejection calls `/api/approvals` without inference. Conversational yes directs the synthetic user to explicit review and cannot mutate a goal. Reload exposes approved/rejected/expired/conflicted status; deletion discards pending bodies while approved goal history survives. References remain resolvable after trace expiry without reconstructing exact evidence or exposing expired draft bodies.

The v3 template/projection preserves the 11,000-byte context, 12,000-byte wire, four-model-call and six-tool limits. Revision tools are omitted without an editable approved goal; final requests advertise no more tools. Compact projections retain full results separately in encrypted evidence. Historical projection versions 1 and 2, opaque continuation, exact request capture, cache-write usage and conservative accounting remain supported. Literal reviewed live capability evidence remains unchanged and mismatches the new template, so preflight fails closed.

## Verification environment and observed checkpoints

Checks use an ignored verification copy and the disposable `vulpes-health-pr12-test` stack at loopback ports 25321/25322. Installed dependencies are reused. Only that copy's exact project/port bindings, including legacy test bindings and verification transport guard, are specialized. Production guards remain unchanged. The retained M3 stack is not reset. Browser requests are restricted to exact application/Auth loopback ports; fixture inference is test-only composition.

| Command actually executed | Observed outcome |
|---|---|
| `npm run lint`, `npm run typecheck` | Passed |
| `npm test -- --maxWorkers=1` | 317 passed |
| `npm run build`, `npm run test:bundle` | Passed; nine public files scanned without secret canaries, source maps, server catalog or synthetic harness |
| `npm run db:lint`, `npm run test:db` | Passed; 648 pgTAP assertions |
| `npm run db:types`, `npm run db:types:check` | Generated types match the actual migrated schema |
| `npm run test:goal-upgrade -- --allow-disposable-reset --from-pr11` | Passed; populated PR 11 graph and pending v2 proposal preserved across the forward migration |
| `npm run test:integration` | Complete isolated suite: 184 passed before the final progress-version/detail-focus refinements |
| `npm run test:integration -- tests/integration/chat-goals.test.ts tests/integration/chat.test.ts tests/integration/goals.test.ts` | Final affected suites: 45 passed, including progress invalidation after an approved target revision |
| `npm run test:integration -- tests/integration/chat-goals.test.ts tests/integration/chat.test.ts` | Final contract/compaction rerun: 37 passed, including encrypted rationale capture and the M3 14-observation continuation |
| `npm run test:e2e` | Complete built regression: 105 passed before the final rationale/schema completion |
| `npm run test:e2e -- --goals-proof` | Final focused built proof: four passed, including viewport/focus and cross-tab account-switch assertions |
| `npm run test:dev -- --goals-proof` | Final Vite/API proof: four passed with the completed rationale contract |
| `npm run test:evaluations` | All 16 scripted control checks passed; real-model assessment not run |
| `npm run test:executions` | Passed; exact 27-byte loopback capture, one synthetic transport request, replay/budget denial, conservative hold and later correction; zero provider requests/spend |
| `npm run maintenance:cleanup` | Passed; one bounded no-op pass, all work counts zero |
| Specification validator and diff checks | 495 specification/fixture checks and staged diff whitespace checks passed |

Complete suites and later affected reruns are distinguished above; this does not claim every full suite was repeated after every final refinement. The final root lint, 317-unit run and bundle/type build were repeated after completing the schema. No dependency, model catalog, price record or reviewed live capability evidence changed.

The real HTTP journey imports the canonical fixture, asks through the scripted provider boundary, inspects encrypted tool output, observes zero goals while pending, approves the exact proposal, imports three additional current-window observations, and reads deterministic progress without another model request. The baseline remains 69.7 kg, current mean is 68.8 kg and progress is approximately 52.94%. Browser proof also exercises revision before/after review, keyboard confirmation/focus, reload, rejection, stale data and account switching. Explicit synthetic `m4-goal-progress.png` and `m4-chat-approved.png` artifacts were inspected locally; artifacts remain ignored.

## Retained failures and corrections

- Initial PowerShell brace expansion failed before command execution; the corrected read succeeded. Sandbox process creation required approved execution; no dependency installation was needed.
- The first migration startup exposed a PL/pgSQL CASE-expression syntax error. Parenthesizing the expression allowed startup; SQL lint and all 648 database assertions passed afterward.
- Four M3 chat regressions initially exceeded the fixed context limit. Compact schema framing, the shorter v3 safety template, eligible revision-tool advertisement and final-request tool removal restored the existing paths. The 14-observation path completes within four requests; the stored projection expectation changed to v3 while explicit v1/v2 readers remain tested.
- New integration cases exposed a missing source check during proposal preparation and invalid synthetic CSV/measurement setup. Preparation now rejects a foreign source before computing a baseline; corrected fixtures use the production measurement service and canonical CSV header.
- Two unit expectations initially assumed the old prompt's live readiness. They now assert `capability_evidence_mismatch`; historical capability evidence was not refreshed.
- The first upgrade attempt lacked its ignored artifact parent directory. The verifier now creates that directory, and the populated PR 11 upgrade passed.
- The first full browser run passed 102 existing cases and failed three new cases. The calculated-baseline revision needed a smaller v3 goal projection; shared synthetic account rate limits needed a dedicated M4 fixture account. Subsequent failures were test locators that selected pending status after approval and looked for sign-out outside Settings. Assertions were corrected without increasing timeouts or weakening product checks.
- Expired proposals were initially hidden by pending-body RLS before cleanup, turning their saved references into unavailable text. The failure was reproduced through real conversation reads. Resolution now checks only owned message-bound metadata; the card's owned goal endpoint expires/removes the body and exposes terminal status. The focused regression passed.
- The first broad integration attempt was stopped after legacy copied tests targeted the original container/port. Only the isolated copy's bindings were corrected and its disposable database reset. This failed attempt is not counted as acceptance evidence.
- Review reproduced saved numeric chat progress remaining visible after an approved target revision with unchanged measurement data. Numeric results now carry the approved goal version and reload checks it; historical version-1 results retain their revision-number reader.
- The new deep link selected a goal but left its detail below the large creation form. A real viewport assertion reproduced the failure. Detail now receives focus when its owned data loads, bringing the intended goal into view.
- Synthetic evaluation initially rejected shortened guardrail wording. The existing causality and untrusted-source wording was restored in the compact v3 prompt; the assertions were not weakened, and all 16 controls passed.
- Final contract review reproduced rejection of the specified short revision rationale. The bounded rationale argument is now captured with encrypted tool input; it does not alter the approved goal definition or grant authority.
- Adding that rationale exposed a remaining revision-continuation size failure. Equivalent directional-target alternatives now share one wire schema; runtime target refinements and the original context/wire ceilings remain unchanged.
- A final npm invocation stopped before lint with Windows ENOSPC. Only this task's disposable copied build/report directories were removed after checking their absolute paths; evidence screenshots, sources, dependencies and database volumes were retained. The retry passed lint, all 317 unit tests, the strict bundle/build check and 495 specification checks.

## Test assurance and review boundary

| Sample | Production path and observable failure signal |
|---|---|
| GOAL-01/02/06 | Scripted tool call → GoalService → atomic proposal checkpoint → real approval API. Assertions require no goal before confirmation, exactly one revision afterward, and no mutation from conversational yes. All links are executable local evidence; real-model behavior remains unverified. |
| Atomicity/replay/fencing | Real PostgreSQL checkpoint races, invalid encrypted envelope, cancellation, deletion, changed data and wrong fence. Assertions require one pending proposal on replay or zero proposal/receipt/message changes on rollback, with no active goal mutation. |
| SEC-02/03/07 and card authority | Two real users, cross-owner message parent, forged references and delayed account response. Foreign parents/reads are denied; only the actual owned message binding resolves; old-account UI cannot reappear. |
| TRACE/COST and M3 compatibility | Exact request/projection inspection, legacy readers, bounded continuations and existing accounting regressions. Unknown usage is retained as unknown; no live network is used. |

## Split-axis self-review

**Surface:** the actual staged/unstaged/untracked inventory, the incremental PR 12 diff against PR 11 at `c8a6575`, and its interactions with the cumulative M4 surface against `f35b249`. No unrelated user changes were present. Runtime callers, transaction functions, generated types, typed cards, fixtures, tests and affected canonical documentation were inspected.

**Axis 1, specification fulfillment: Approved for PR 12's local scope.** The two tools only prepare pending proposals; the shared approval transaction remains the sole activation authority. Real HTTP/PostgreSQL proof covers exact confirmation, replay, competing outcomes, owner/source/parent denial, data/goal version conflicts, rollback and fencing. Built and Vite journeys establish import, Ask, inspect, proposal, explicit keyboard approval, goal detail, additional import, deterministic progress, revision review and reload. Conversational yes, fabricated references and late account responses do not activate or restore private goals. The completed rationale contract is captured in encrypted input. M3 continuation and historical evidence remain supported within the fixed limits.

**Axis 2, standards/security/anti-slop: Approved with one existing observation.** GoalService is reused without another workflow framework, provider SDK, dependency or forwarding approval layer. One narrow pinned-search-path transaction preserves profile locking and owner-parent checks; direct clients cannot invoke it. Typed references carry no model-supplied authority. React review checked hook placement, account-scoped queries, escaped text, lazy heavy components, keyboard/focus and loading/error handling. The existing build chunk-size warning is non-blocking; no new performance benchmark or performance improvement is claimed. All demonstrated in-scope blockers found during review were corrected and rechecked.

This is host-agent self-review, not independent cumulative M4 acceptance. Clinical safety, physical devices, hosted routing and live-provider proposal quality remain unverified. Production inference stays disabled; refreshing capability/smoke bindings or running paid verification requires separate authorization. The guarded command `npm run test:providers -- --mode=live --role=everyday` remains a denial check, not live acceptance; any future authorized live batch must follow the separate README preflight/spend procedure. Nothing was merged or deployed.

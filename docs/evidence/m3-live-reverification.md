# M3 Everyday repair and re-verification

Implementation baseline: `dcfe7ebc2000b66110e30786e5d1ba436809e450` plus the uncommitted live-preparation changes. The user approved the repair/re-verification plan and explicitly authorized a separate read-only reviewer. This work preserves the [first failed attempt](m3-live-everyday.md), its charge and its immutable $0.06 aggregate batch allocation.

## Repairs and compatibility

- Measurement projections use a shared selection/unit dictionary and named columns with ordered observation rows. All identifiers, values, dates/times, timezones and quality flags remain represented. Full original results remain in the encrypted owned trace.
- New tool envelopes record `projectionVersion:2`; absent versions use the original version 1 projection during inspection. Unknown versions and modified provider projections are rejected. Historical encrypted continuations are not rewritten.
- Provider tool schemas omit repetitive UUID/date regexes and the schema-document header, retaining formats, types, enums, required fields and bounds. The unchanged server Zod validators still reject invalid calendar dates, invalid UUIDs and unauthorized data access. Context and wire limits remain 11,000 and 12,000 bytes respectively; no ceiling was raised.
- Means/changes/trends explicitly use the deterministic summary tool. The four-request inventory → 14 measurements → summary → answer regression passes within existing bounds.
- Cache-write counts are preserved, including explicit zero. Absent counts and unverified billing-subset semantics remain unknown. Reported total costs retain precedence without duplicate category charges.
- The adapter/template versions are v2. Capability evidence pins literal reviewed versions and refreshed public metadata; changing implementation constants cannot silently rewrite the evidence binding.

## Guarded smoke changes

The live CLI requires `--attempt-id=<UUID>` in addition to role, opt-in, ceiling and immutable batch ID. The attempt binds the conversation, message and request receipt; repeating it cannot obtain another lease or provider dispatch. Reports are uniquely created without replacing previous failures.

Cancellation and the new `disconnect` scenario require a durably captured nonterminal response prefix before intervention. A terminal-only message or tool-call response fails this verification and cannot initiate another provider request. Upstream network work is explicitly aborted during controlled interruption, while cancellation versus failure remains distinct in the run ledger. Final provider-side charges/termination are not inferred from a local abort. Unknown usage retains its reservation.

## Reproduction and offline verification

Before production edits, the real isolated HTTP/database regression reproduced `context_too_large` after the fourteen-observation read. Three unit cases reproduced cache-write counts being replaced with null. A terminal-only synthetic provider response reproduced a false passing cancellation check.

The first compact measurement projection allowed the measurement continuation but still overflowed after the deterministic summary. Removing redundant provider-facing schema framing resolved the complete path without dropping observations or relaxing validation. An expanded combined smoke test timed out at the existing 30-second limit; scenarios were separated and upstream cancellation cleanup corrected. Assertions/timeouts were not weakened.

| Verification | Result |
|---|---|
| Full unit suite before notation repair | 310 passed |
| Final full unit suite, `npm test -- --maxWorkers=1` | 310 passed; first ESLint boundary case timed out during startup (311 total) |
| Final isolated boundary suite | 20 passed; the same first-case startup timeout recurred |
| Direct configured ESLint diagnostic | Forbidden import rejected by `vulpes/boundaries`; completed in 1,083 ms outside the unit timer |
| Full isolated integration suite | 159 passed before final terminal-only continuation guard |
| Final isolated live-batch suite | 7 passed, including terminal-only message/tool rejection and explicit-attempt replay |
| Additional observed Unicode-minus regression | Failed before the matcher repair; passed afterward with the same correct numeric values |
| Independent final smoke unit suite | 18 passed, including equivalent minus notation and rejection of wrong mean/magnitude/direction |
| Local PostgreSQL assurance | 630 pgTAP assertions passed |
| Built/development browser workflows | 101 built and 18 development checks passed |
| Synthetic evaluation controls | 16 passed; real-model assessments remain `not_run` |
| Strict typecheck and lint | Passed |
| Built bundle/secret check | 9 public files passed |
| Specification/fixture validation | 491 checks passed after evidence updates |

Regression checks use a separately named loopback-only Supabase project in a disposable copy. Only copied harness project/container identifiers are specialized; application production paths match the repaired source. The retained paid-batch database is neither reset nor used for synthetic cost fixtures. No schema migration, dependency installation or cloud setting change is required.

An independent reviewer approved both Remora axes for the repair implementation and the final interruption guard, with no remaining code finding. The reviewer independently ran 28 offline unit tests, inspected production paths and assertions, and distinguished parent-run database checks from independently executed evidence. Live acceptance remains conditional on the actual provider and interface results below.

## Live and interface results

**The required M3 live technical checks passed on this working tree.** Production inference remains disabled. Integration/publication and formal milestone acceptance remain separate from these verification results.

| Scenario | Actual result |
|---|---|
| Completed tool loop, run `f15c5704-01a8-4397-adf8-0fffa77b1fc3` | Three real Responses requests through `list_metrics → summarize_metric → answer`; complete owned trace, exact input equality and saved reload verified; $0.000475615 settled, zero hold |
| Controlled cancellation, run `a09b2096-b725-43ab-9f5d-328acb476895` | One request; durable nonterminal prefix captured before cancellation; cancelled with no continuation/retry; usage pending, $0.0093192 held |
| Controlled disconnect, run `cf037487-5672-4920-b556-d1faec16d136` | One request; durable nonterminal prefix captured before interruption; failed honestly with no continuation/retry; usage pending, $0.0093192 held |
| Actual local API/built browser | All 16 input/output/context/usage payloads matched exact byte exports; a provisioned foreign synthetic account received 404; browser copy/export equality, context inclusion display and reload without inference passed |

The saved answer correctly distinguishes 14 observed daily records from the calculated September 8–14 mean of 69.0 kg, the September 1–7 mean of 69.7 kg, a decrease of 0.7 kg and sufficient coverage in each seven-day window. It explicitly avoids a clinical assessment. The owned deterministic summary independently supplies those values, dates, source, method and coverage.

The first evaluation of this completed run falsely rejected its mathematical minus sign (`−0.7`). Further paid scenarios stopped while a new offline regression reproduced the verifier error. The repair normalizes only U+2212 to ASCII minus before applying the existing magnitude/direction checks. Independent review and 18 smoke unit tests passed; the [zero-inference reassessment](m3-live-answer-recheck.json) ties the corrected result to the same run, saved-answer hash and unchanged charge. The [original failed smoke report](live-everyday-b7baae10-fb2d-4e7d-bfc4-21151e343797-tool_loop-f15c5704-01a8-4397-adf8-0fffa77b1fc3.json) is preserved. No additional paid tool-loop attempt was made to obtain a different answer.

The separate [cancellation](live-everyday-b7baae10-fb2d-4e7d-bfc4-21151e343797-cancel-a09b2096-b725-43ab-9f5d-328acb476895.json) and [disconnect](live-everyday-b7baae10-fb2d-4e7d-bfc4-21151e343797-disconnect-cf037487-5672-4920-b556-d1faec16d136.json) reports show the interruption proof and retained holds. Their effective model/effort remains unknown because no terminal response was consumed; requested settings are recorded. A locally aborted stream does not establish provider-side termination or zero billing.

The [interface proof](m3-live-reverification-interface.json) records the actual HTTP/browser checks. Screenshots were inspected locally at desktop and 360-pixel mobile widths. They show the owned inspector and context manifest with wrapped hashes and inert raw evidence; private trace text is not added to repository reports. The browser proof used production handlers with the live switch false and no provider key. It issued zero `/api/chat` sends. Its first foreign-account probe correctly returned 403 for an unprovisioned account; provisioning that disposable account separately demonstrated ownership denial with 404.

## Accounting, safety and remaining limits

The [free provider accounting queries](m3-live-reverification-accounting.json) identify Azure for all seven requests in the original batch, including the first failed attempt. OpenRouter key usage observed on October 27, 2026 at 23:13:15 UTC was **$0.001063265**: $0.000836365 for the completed/previous calls plus $0.0002269 observed for the interrupted calls. Application account and application-wide buckets each show **$0.000836365 settled and $0.0186384 reserved**, a committed bound of **$0.019474765**, under the unchanged **$0.06** cap. There was no replenishment.

The interrupted calls lack terminal usage in the application. Their conservative holds were not released or replaced by manually reconstructed executor credentials, even though free provider metadata later showed partial charges. That metadata is an observation at its recorded timestamp, not a promise of final billing. Existing uncertainty/reconciliation policy remains responsible for those reservations.

The completed run records native input/output tokens, reasoning counts, returned cache reads and returned cache writes (1,294 and 621 on calls 2 and 3). Call 1 omitted cache-write counts and remains unknown. Reported charges take precedence; no estimated duplicate is added. Both requested and response-reported model/effort are `openai/gpt-6-luna` / `low`; separate generation metadata identifies `openai/gpt-6-luna-20260922`.

Public rates and ZDR eligibility were refreshed, and account paid-training/data-discount switches and workspace input/output logging were inspected without changes. Captured requests retain ZDR, stateless operation, no external plugins and the original output limit. The disclosed provider retention-policy qualifications still apply. No real records, hosted health database, deployment, live-user activation or other model role was used.

**Axis 1: Approved for the scoped repairs and required M3 live technical evidence. Axis 2: Approved for the scoped implementation and assurance evidence.** The final independent review found no unresolved blocker and reconciled the preserved failed report, zero-inference answer reassessment, interruption evidence, accounting totals and interface exports. The reviewer personally ran 28 offline unit tests and 18 smoke unit tests; live, database and browser execution remained parent-performed evidence reviewed independently. The final unit-suite startup timeout below remains a non-blocking verification observation. This one synthetic question does not establish broad clinical quality, all adversarial model behavior, every role's live capability or production readiness. No output-limit stress test or real provider outage was induced; controlled stream interruption proves the stated client/ledger behavior.

Known verification friction retained: the original-stack evaluation command refused to run while that stack was stopped; the isolated evaluation then exposed a stale unverified-catalog assumption, corrected to an explicit unverified snapshot without weakening the guard. A concurrent smoke-unit invocation had one five-second child-process timeout; the independent isolated run passed all 18 unchanged-timeout tests. The final full and isolated unit runs also hit the existing first ESLint boundary case's five-second startup limit. A direct invocation of the same configured rule rejected the forbidden import in 1,083 ms, establishing enforcement but not a clean final unit-suite run; its variable startup timing remains unresolved. Initial type/lint errors in local evidence helpers were corrected; no application acceptance assertion or timeout was relaxed.

M4/M5 development may use the repaired implementation and its verified contracts. Direct-goal work remains independent. The changes are uncommitted and must be deliberately integrated before dependent work assumes them present on `main`; publication/merge were not part of this implementation authorization.

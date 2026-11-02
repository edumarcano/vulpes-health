# Consolidated Step 3 preparation

Date: 2026-11-01. PR #32 remains stacked on #31 and unmerged. At the owner's request, remaining Step 3 implementation and subsequent approved rehearsal evidence stay in this PR. This record extends, rather than replaces, [journal](owner-pilot-step3d4.md), [database](owner-pilot-step3d4-database.md) and [replay](owner-pilot-step3d4-replay.md) evidence. No hosted capture, deployment, provider call, real data or paid spending occurred in this continuation.

## Delivered behavior

| Area | Result |
|---|---|
| Recovery Auth/API | Explicit `--verify-http` binds cached image IDs and synthetic identities to the existing recovery approval. Fresh GoTrue/PostgREST services share only the new network-none database namespace, with no published ports/mounts/outbound network. Actual retained-password login, deleted-login denial, two-owner profile/conversation isolation, private-payload denial, logout, old-session/refresh rejection, anonymous denial and exact signup-disabled errors are checked. Public rows/security catalog must stay unchanged; service containers are removed and probe sessions revoked again before the source reread. |
| Current accounting | One read-only journal snapshot also fingerprints buckets, reservations, verification allocations, runs/steps, cost blocks and Vertex policy. The final restored state must exactly match the fresh source fingerprint, excluding only journal-authorized deleted owners while including shared app rows. Missing evidence or drift fails closed; no balance reset/replenishment or inferred post-backup charge reconstruction. Historical journal readers remain supported, but copies without accounting evidence cannot complete recovery. |
| Export crash repair | Both CSV and account JSON exports use one encrypted spool. Its name/directory disappear before private record generation; only the request-owned descriptor remains. Completion/abort/error closes it, and process exit releases it. Public formats, pagination, revision/integrity checks and conflict responses remain unchanged. Unsupported unlink semantics fail before private capture. The current hosted deployment still uses the old code. |
| Operator checkpoint | [One grouped procedure](../operations/hosted-recovery.md#combined-step-3-execution-checkpoint) covers credentials, independent ciphertext/key custody, exact rehearsal approval, future synthetic deployment checks, manual rotation and later access authorization. No new cosmetic work, model, scheduler or recovery project. |

## Verification and actual artifacts

All checks use synthetic local data. The expanded integration runs use a fresh isolated `vulpes-health-step3-final` stack on loopback ports 32420–32422. The verification copy replaces only the dedicated project/port literals; retained source databases, Luna allocations and original hosted identities remain untouched.

| Check | Observed result |
|---|---|
| Offline units | `npm test`: 467 tests across 39 files passed. Final focused spool/HTTP-binding verification: five tests passed. |
| Actual recovery command pipeline | Four synthetic accounts and two trace-key versions were captured. One post-backup deletion completed; another remained fenced on the source. The command restored/replayed both authorizations, preserved the other two owners and exact shared spent amount `0.01234567890123456789`, denied all four original sessions, and completed 24 actual Auth/API assertions across two retained and two deleted identities. |
| Current source check | Initial capture and one fresh post-validation journal/accounting read used injected local read-only SQL transport, not the hosted Management API. The independently stored encrypted latest copy authenticated and matched; `currentAccountingMatched: true`, `currentJournalRechecked: true`, `restoreAccessAuthorized: false`. |
| Real exports | Account and measurement lifecycle HTTP tests passed after the descriptor fix: complete output, conflict-before-attachment, cancellation and no named spool. The fresh-stack combined five-suite checkpoint passed all 29 cases, covering these plus journal, database and recovery CLI interfaces. |
| Crash reproduction | A child called the production CSV export then exited 17 without cleanup. Before the fix it left one named export directory; afterward the same test found none. A separate test decrypts ciphertext from the unlinked descriptor and verifies original export bytes and absent plaintext in ciphertext. |
| Static/build boundaries | Strict typecheck, lint, production build and 15-file bundle secret-canary inspection passed. 525 specification/fixture checks and all 129 relative file links in the changed documents passed. No migration, provider catalog, consent, production evidence, positive budget or live switch was changed. |
| Final native cleanup and CLI | After the cleanup self-review change, the complete recovery test passed again. The real `recovery:database -- --plan` exited 0 with zero requests/writes and the current HTTP/accounting scope. The fresh verification stack was stopped with volumes retained. A copy comparison found only stale inert-plan wording; that wording was synchronized and the final CLI plan executed directly. |

The successful native report is retained privately under the isolated verification copy's `.scratch/recovery-database-proof/pass-*.json`; it contains aggregate checks and target hash, no credentials or private bodies. Raw failure diagnostics remain ignored/private. No stopped restored database is exposed as an application.

## Retained failures and repairs

The original named-spool crash was reproduced before repair. The first unlinked implementation used native fs streams with a supplied descriptor; a destroyed write stream closed it and cleanup returned `EBADF`, masking expected HTTP 409 conflicts as 500. Both real export integration tests caught this. A focused test reproduced the original conflict being lost. The helper now owns the descriptor exclusively, using bounded reads and backpressured writes; the exact conflict and abort assertions pass without relaxed expectations.

Initial SQL-created Auth fixtures lacked a zero instance identifier and required identity/user timestamps. Actual GoTrue sign-in failed first with 400, then with 500 and a local `created_at` scan error. Only the synthetic fixtures were corrected; no source account password or schema was changed. Version-only Auth/application migration records are copied into the otherwise schema-only disposable source, so startup checks compatibility without guessing migration history. All product/Auth records are newly synthetic.

The cached Auth version returns HTTP 422 with `error_code: signup_disabled`; an initial 403-only assertion failed. Verification requires that exact error code with an explicit supported rejection status, so arbitrary validation failures cannot count as signup protection. No assertion accepts signup success or merely any error.

Sandbox process restrictions initially blocked Vite/Vitest/Node child-process startup. The same authorized local checks were retried through normal approval review; no dependency installation or safety bypass was used. Earlier PR #32 candidate `4af480c` separately passed both required GitHub checks; that result does not establish CI success for the expanded candidate.

## Split-axis self-review

**Axis 1, requirements:** The complete diff against #31, including unstaged/new files, was reviewed against the approved dormant-inference owner-pilot plan, SEC/OPS recovery boundaries and export contracts. Necessary functionality/privacy gaps are addressed locally. Existing replay/refusal behavior remains covered. No product scope or optional model activation was added. Hosted-source compatibility, deployment/legacy-instance cleanup, positive hosted execution/trace/allocation isolation, PWA/delayed-cache checks, physical devices, custody and human handoff remain explicit execution/acceptance gates. Verdict: approved for consolidated preparation, not Step 3 hosted acceptance.

**Axis 2, standards and security:** Reviewed CLI callers/bindings, SQL ownership/fingerprints, private stdin/diagnostics, local immutable container IDs, network/mount/port fences, role secrets, stream abort/conflict/cleanup and affected tests. Cleanup attempts every owned sidecar even after an individual removal failure and reports incomplete cleanup. Ciphertext/key custody and source-loss uncertainty remain operational gates. No demonstrated blocker remains in the verified local paths. This is self-review, not the separate independent M5/M6 review or merge approval.

## Remaining owner checkpoint

Recovery rehearsal, Proton Pass key readback and the four-file private Google Drive readback are complete; [hosted recovery evidence](owner-pilot-step3-hosted-recovery.md) owns those results. The next required owner action is one approval for the final synthetic application deployment and its bounded two-account verification/cleanup. The current deployment still predates the export repair. No dashboard or credential work needs repeating. Inference activation, restored access, spending and real-data use remain separately gated.

## Approved rehearsal preparation, 2026-11-01

The owner approved the grouped $0 recovery rehearsal after confirming private Google Drive storage and Google/Proton account 2FA. Local ciphertext destination is `C:\Users\eduma\VulpesRecovery`; keys use Proton Pass Free. The source session-pooler parameters match the approved project/region. The ignored database password decrypts to a nonempty SecureString and the public certificate parses as a currently valid CA; actual connection/password/TLS compatibility is not yet tested.

Four new fixture identities/passwords were preallocated into a create-only DPAPI plan, without creating remote accounts. A separate create-only DPAPI package holds fresh backup/journal keys, the current source trace key and one new retained synthetic trace-key version. Protected readback verified all four keys are 32 bytes. A private-terminal handoff helper passed its JSON roundtrip check and refused Copy/Transfer when input/output is redirected, before touching the clipboard. The first helper self-test exposed a PowerShell property-count array expression; the corrected scalar count reports four keys. No secret material was printed.

Hosted requests/writes and paid spending remain zero for this preparation. Hosted capture waits for an owner-operated saved-note readback, bound to the batch and package fingerprint in a protected custody receipt. The helper clears the clipboard after verification. The owner must turn off clipboard history/sync before transfer; no Proton/Google UI was operated by the agent. This is an actual manual custody checkpoint, not another execution-approval request. Remaining implementation/execution evidence stays in PR #32; no new PR or merge.


## Grouped rehearsal execution

The owner-operated key readback subsequently passed. The approved source capture, four-fixture post-backup deletion/replay, isolated actual Auth/API/current-accounting recovery, final fixture cleanup and final independent journal passed. [Hosted evidence](owner-pilot-step3-hosted-recovery.md) records exact results, private-output hashes, the reproduced timestamp repair and remaining cloud-copy/rotation/access gates. No deployment, provider call, paid usage or real data occurred.

## Final application verification preparation, 2026-11-01

This continuation adds verification tools, fixtures and tests, without changing application behavior, schema, provider configuration or dependencies. It stays in PR #32. The frozen application upload will include the existing unlinked-spool repair; deploying it remains unapproved.

| Check | Observed local result |
|---|---|
| Real API proof | `npm run test:integration -- tests/integration/hosted-closeout.test.ts` passed. Two new disposable local accounts exercised 38 named checks over 58 actual HTTP requests: strict malformed/unknown write bodies, JSON 503 for disabled chat, nonempty own execution/step rows, foreign inspector/trace denial, protected direct reads, exact trace bytes, allocation/account export isolation and integrity, CSV content, cancelled response bodies and a successful subsequent export. Existing local operator data and allocations were preserved. |
| Built application/browser | `npm run test:closeout` passed the same 38 API checks plus eight Chromium checks against the actual built client, production router and guarded local Supabase. Both owned Ask conversations/downloads, sign-out, a barrier-controlled delayed response across account switching, cache allowlist/old-cache removal and a data-free offline route passed. Page errors: zero. Physical devices and assistive technology were not exercised. |
| Ordinary safeguards | All 469 units across 40 files, strict typecheck, lint, production build, 15-file public-bundle canary inspection and 526 specification/fixture checks passed. The hosted/browser modules refuse missing approval before network/browser startup. The private operator also refused unapproved preflight before loading credentials; its strict TypeScript check passed. |
| Execution limits | Local proof reported zero hosted requests, provider requests and paid spending. The browser downloads were removed. The new test identities were deleted through existing account lifecycle services. No original identity/password, global/app budget, provider consent or production evidence was changed. |

The first CSV proof failed because the new fixture omitted the explicit `user_reported` measurement method. The fixture was corrected to match its own query; application code and assertions were unchanged. Lint also caught cleanup control flow inside `finally`; moving that cleanup into a function preserved the same failure/cleanup behavior. Final API/browser proof passed after both corrections.

The positive allocation sample requires the existing database's synthetic verification contract: newly preallocated `pr03-<UUID>@example.test` identities, display name `Synthetic verification` and a **$0.000001 account ledger ceiling each**. These are test ledger values, not provider charges. Hosted creation requires explicit approval; inference stays false, provider credentials/consent remain absent, and the shared app ceiling remains unchanged. The encrypted trace contains labelled synthetic bytes and the failed execution is explicitly **not dispatched**. This proves populated security/export behavior, not a real model response.

The private create-only batch plan binds the approved source/target, two identities and verifier hashes. Execution additionally requires an unexpired approval and a verified READY deployment receipt for the exact new candidate with inference off/provider secrets absent. Fixture freshness/month checks run before source writes. Cleanup targets only creation-receipted, remotely tagged batch identities and checks the original account/shared-state hash throughout; a final encrypted journal must cover both new deletion receipts. Closed recovery/lifecycle plans are not reused.

Hosted response cancellation will establish client cancellation and a successful follow-up request. It cannot prove that a remote function was killed mid-capture or inspect a provider's temporary filesystem. The earlier real process-exit/unlinked-file proof covers that local failure mechanism. Old deployment retirement requires separate inclusion in the grouped approval, an exact immutable ID, passing replacement checks and no active aliases; `--safe` must refuse an active deployment. Deleting that deployment removes its URL/rollback target and does not establish physical secure erasure by Vercel.

Both split-axis self-review passes covered the new tracked tools/tests and existing PR #32 changes against #31: requirement scope, real HTTP/UI assertions, source/owner binding, cleanup, private stdin/output, request bounds and dormant provider gates. No demonstrated blocker remains in local preparation. Hosted checks, deployment retirement, physical devices, independent review/formal acceptance and production enablement remain unverified or separately gated.

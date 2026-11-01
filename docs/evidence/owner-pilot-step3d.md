# Owner-pilot Step 3D: hosted security and lifecycle

Current checkpoint: Step 3D.1 preflight and the explicitly approved Step 3D.2 disposable-account lifecycle passed. Step 3D.3 database-maintenance implementation is prepared; its hosted migration/rehearsal/manual ownership approval is pending. Hosted-source recovery/custody and export crash-file cleanup remain pending. Inference remains off and real data is not authorized.

## Step 3D.1 preflight record

Date: 2026-11-01. Branch `feat/owner-pilot-hosted-security`, based on hosting documentation candidate `18e4466ca156db58a282f7e3a2881374de304016`. The owner confirmed successful synthetic login/navigation/logout and requested Step 3D. Both checks on the base passed in [CI run 41316790329](https://github.com/edumarcano/vulpes-health/actions/runs/41316790329).

This packet implements a repeatable bounded security preflight, not complete hosted acceptance. Application candidate `bf42111120e287e4b709ea073bfae31ba91f5048` and deployment `dpl_Cdw4DeExKHYHzT66wdDu1Njd3UXN` remain unchanged. Vercel independently resolved the canonical alias to that READY deployment in the approved project/iad1. No new deployment, migration, infrastructure change, provider request or real health data was involved.

## Implementation and executed interfaces

`scripts/verify-hosted-security.ts` accepts the existing hashed target manifest, explicit hosted opt-in and private stdin credentials for exactly two distinct synthetic `.invalid` identities. It accepts only the public key and passwords, rejecting extra administrative/provider/trace fields. It never reads ambient credentials or creates domain fixtures. Requests use fixed paths on the validated app/source origins, omit cookies, refuse redirects and have 15-second deadlines; JSON bodies are capped at 64 KiB. Each invocation permits at most 100 requests. It signs in and signs out only its own temporary test sessions. Ordinary API read-time expiry can run.

| Interface/check | Actual result |
|---|---|
| `npm run hosting:security -- --plan` | Exit 0; reports zero requests and the exact scope/limits without reading credentials or manifests |
| CLI with `--manifest=missing`, no `--allow-hosted` | Exit 1 before manifest, stdin or network access; generic safe refusal |
| Private stdin invocation against the reviewed manifest with `--allow-hosted` | Passed all 87 checks/requests, session cleanup confirmed |
| Anonymous direct reads | All 19 public tables denied with HTTP 401/403 and PostgreSQL `42501`, including the four newer security/accounting tables |
| Authenticated protected tables | Both identities denied on all eight protected tables with HTTP 403/`42501` |
| Owned direct samples | Both identities' profile present; samples from all 11 readable tables contain only that identity's owner ID. Only owner IDs are selected, two rows maximum |
| Foreign profiles | Each identity's explicit query for the other profile returned an empty list |
| Authenticated APIs | Both identities passed status, settings, account, sources, conversations and goals checks; JSON/no-store, own profile, active account, disabled inference, no accepted provider consent or account allocation |
| Malformed GET queries | Data, conversations, goals and account each returned JSON 400/`invalid_input` with no-store for both identities |
| Ended test sessions | Local Auth sign-out returned 204; the ended token was rejected by `/api/settings` with 401 and direct profile reads returned no rows, for each identity. Existing browser sessions were not selected for revocation |
| Positive table evidence | Exactly 20 nonprofile samples were empty. Report explicitly retains `populatedIsolation: pending`; empty samples do not pass SEC-02/SEC-03 or lifecycle acceptance |

The hosted command was `node node_modules/tsx/dist/cli.mjs scripts/verify-hosted-security.ts --manifest=.scratch/hosting/b956bd10911ee9ff/manifest.json --allow-hosted`, with credentials projected privately from existing DPAPI files through stdin. Only check names, counts and safe outcomes were retained. No identity, token, password or response body appears in the report. No owner interaction or fresh credential was needed for these reads.

## Verification and retained failures

| Command or observation | Actual result |
|---|---|
| Final `npm test` | 381 tests passed across 32 files, including 14 new preflight tests |
| Focused hosting/preflight tests before the final allocation assertion | 34 passed; final full suite includes the tightened assertion and added regression |
| Final `npm run typecheck` and `npm run lint` | Passed |
| Specification validator / `git diff --check` | 516 specification/fixture checks passed; no whitespace errors |
| Real loopback HTTP preflight test | Passed; exercises response parsing, redirects/cookie options, request accounting and Auth-only POST inventory |
| Denial and leak regression cases | Foreign profile, open anonymous table, accepted ended session, oversized body, Auth failure, accepted consent, positive allocation, redirect and network failure all fail safely without private canaries in reports |
| Table inventory protection | Executed anonymous-check inventory equals all 19 generated database table names; a missing/new table fails the test |
| Initial managed-sandbox Vitest launch | Vite child-process creation failed with `EPERM`; normal approved local execution outside that restriction passed. No test assertion changed for this environment error |
| First typecheck | Reported optional path/method handling in new tooling/tests; corrected before hosted execution and final checks |
| First hosted attempt | Stopped at check 52, `revoked-api-session-0`, because it expected only `session_revoked` |
| Independent revocation diagnosis | Fresh synthetic test session: logout 204, application 401/`unauthorized`. Actual `verifyIdentity` permits Auth to reject the token before the database's live-session check |
| Corrected denial assertion | Requires HTTP 401 and either existing `unauthorized` or `session_revoked`; both paths have tests and accepting an ended session still fails. The corrected hosted attempt passed 87 checks |
| Final hosted attempt | After explicitly requiring null allocation/available amounts, all 87 checks passed again. Earlier failed/successful receipts remain ignored and preserved |

The complete application build/integration/browser suite remains tied to the unchanged deployed candidate and the successful base CI. This packet changes operator tooling, tests and documentation; it does not claim a new deployment or a fresh complete hosted journey.

## Split-axis self-review

**Axis 1, requirements:** Approved for the named preflight scope. Actual hosted denials, owned profiles, disabled provider state, malformed-read behavior and ended test-session access have executable proof. The report and canonical checklist preserve empty-table gaps. Synthetic export/deletion/reset, foreign-parent/write isolation, maintenance and recovery remain unmet criteria, not implied PASS results.

**Axis 2, engineering/security:** Approved. Strict target/credential schemas, bounded responses/requests, fixed origins/paths, explicit opt-in, safe failure summaries and cleanup of only newly created sessions preserve the security boundary. CLI and real HTTP proof supplement network fixtures. Existing local-only operational guards remain unchanged; no public admin endpoint, dependency, model or application contract was added. No demonstrated blocking finding remains in this packet.

## Next approval at Step 3D.1

The [operator procedure](../operations/synthetic-hosting.md#remaining-step-3d-packets) defines the remaining packets. Next is a $0 synthetic 3D.2 execution approval for **two newly created disposable accounts**, `vulpes-3d-a@example.invalid` and `vulpes-3d-b@example.invalid`. Create them through trusted administration without email; refuse existing identities with those names. Exercise only their synthetic manual/CSV data, corrections, explicitly approved synthetic goals, conversations and private account exports; attempt bounded foreign-parent/direct-write denials; reset one disposable password and verify old access/refresh sessions fail; interrupt/resume deletion and permanently remove only these newly recorded identities/data. Preserve safe failure evidence rather than bypass constraints. Existing owner/isolation identities and retained Luna state remain untouched.

The owner needs only to approve or decline that exact scope in chat; no dashboard or secret entry is needed for this packet. Permanent deletion and password reset are consequential even for disposable identities, so they are not performed under a read-only checkpoint. Maximum paid spending is $0; no model call, consent, budget allocation, migration, deployment, new infrastructure or backup export is included. A defect requiring a deployment needs separate approval.

Hosted maintenance and complete hosted-source recovery follow separately. Before backup capture, the owner must select/approve encrypted backup storage, independent current-journal storage, separate key custody, and a fenced disposable local destination; exact secure setup instructions will accompany that decision. A local restore is still a compatibility candidate, not evidence. The official [Supabase platform-to-self-hosted procedure](https://supabase.com/docs/guides/self-hosting/restore-from-platform) documents a supported migration direction and warns about Auth/PostgreSQL version differences; Vulpes must preserve its stronger ownership, journal replay, trace-key and access-fencing invariants. No required rows/columns may be dropped to obtain a pass.

Additional paid spending: **$0**. Provider requests: **0**. Actual cloud use: approved Supabase Auth/Data API and Vercel application reads plus read-only deployment metadata. Step 3, real-data authorization, production inference, optional Flash/Argon and formal acceptance remain incomplete. No PR was merged.

## Step 3D.2 approved hosted lifecycle

Date: 2026-11-01. The owner explicitly approved the proposed two-account creation, synthetic data/goal approval, export, denial testing, password reset and permanent deletion scope, at $0 paid spending. Work remains on PR #29, based on `b887a21c5b03b16b9de590d038a1e2e65ea07f47`, whose [CI run 41319237311](https://github.com/edumarcano/vulpes-health/actions/runs/41319237311) passed both required checks. The live application/deployment remain the Step 3C candidate; no application fix or deployment was needed.

### Guarded rehearsal and private state

`scripts/hosted-lifecycle.ts` is an operator rehearsal module, not an application endpoint or a hosted-capable replacement for the guarded local operational CLIs. A private adapter pins the existing manifest's source, Vercel project and app origin. It loads only public/admin source keys and a Windows DPAPI-protected plan containing preallocated UUIDs, the exact approved `.invalid` emails, random initial/reset passwords and a rehearsal UUID. The plan was saved before hosted creation. Keys/passwords never enter arguments, Git or reports. The adapter stores artifacts create-only under ignored scratch; exports contain synthetic data and remain private.

Provisioning checks both names/UUIDs are unused before either creation. Remote Auth application metadata carries the rehearsal UUID; local creation receipts bind each new identity to the source and run. All later reset/deletion phases validate both before acting. Unknown phases and nonboolean approval are rejected before network access. Existing original identities and shared app-budget state are checked by stable metadata hashes after each phase. All HTTP is restricted to the manifest app/source origins with redirects/cookies disabled, 25-second deadlines, 2 MiB response bounds and at most 800 requests per phase. Cleanup signs out only sessions created by the invocation, and cleanup requests are included in the report.

| Hosted phase | Actual result | Requests / grouped checks |
|---|---|---|
| Provision | Both emails/UUIDs unused; created only the approved disposable identities/profiles, with durable receipts | 11 / 3 |
| Journey | Manual correction, canonical CSV, goal approval, conversation/staging, populated isolation and export checks passed for both | 258 / 18 |
| Reset | Actual trusted `recoverAccount` reset for disposable A; old password, access token/direct profile and refresh token rejected; fresh sign-in passed | 16 / 1 |
| Delete start | Fresh password authentication; durable `fenced` receipt saved for A; ordinary Data/conversation reads denied; process exited | 9 / 1 |
| Delete resume | Separate process matched A's retained receipt/fence, resumed it and deleted B through its own approved account flow; both complete | 79 / 2 |

The five phases made 373 bounded requests, including temporary-session cleanup, and passed 25 grouped checks. This count excludes browser navigation and the separate read-only postcheck. No generic/global maintenance or database reset ran. A completed-deletion replay is covered locally without re-creating users. Do not rerun provisioning or reset the completed plan to repeat the batch.

### Observed product and security behavior

| Boundary | Evidence |
|---|---|
| Manual measurement | Each disposable account created a source/reading, corrected 70→69.5 kg, and read version 2 with increased data revision |
| CSV import and calculation | Each preview contained exactly 28 new canonical observations and zero invalid rows; commit inserted 28 and exact request replay preserved the result. Current mean 69.0 kg, previous 69.7 kg, absolute change −0.7 kg |
| Explicit goal approval | Pending proposals froze baseline `69.7`; no goal existed before approval. Approved exact hash/version created one revision for each synthetic goal, without AI |
| Conversation and private staging | Each had an owned conversation, a labelled synthetic user message and an uncommitted encrypted CSV staging payload. Trusted fixture writes supplied message/parent counterexamples, not model-generated output or proof of live chat |
| Positive isolation | Both accounts had actual rows in nine readable table categories: profiles, sources, imports, measurements, conversations, messages, goals, proposals and revisions. Cross-owner direct queries returned empty; foreign Data/conversation/goal/proposal APIs returned 404 |
| Foreign-parent API checks | Foreign source measurement insertion and goal proposal returned 404, both directions |
| Direct mutation checks | Seven populated tables × POST/PATCH/DELETE × two identities: all 42 attempts returned 403/`42501`; persisted foreign graph hashes stayed unchanged |
| Database relationship constraints | Valid owned-parent measurement/message inserts succeeded. Four otherwise-valid trusted cross-owner source/conversation inserts failed `23503`, proving constraints independently of authenticated write grants |
| Account exports | Both attachment responses were no-store; owner/inventory checks passed (30 measurements, including one trusted counterexample, and one message per account). Every section's count/SHA-256 matched its rows; foreign identity ID, source administrative key, session/refresh tokens and all test passwords were absent. Available staging was included; documents remained private |
| Actual populated browser | Chromium 390×844, same browser context A→B: own message/source/goal visible, foreign labels/messages absent, Send disabled, current 69 kg and previous 69.7 kg rendered with seven table readings, completed logout cleared the stored session; eight grouped checks, no page errors |
| Password/session recovery | Existing trusted reset service succeeded; old password/access/direct profile/refresh failed, new password worked. This is synthetic technical proof, not human/family identity verification or handoff |
| Deletion/restart | A's fence survived process exit with the same receipt; ordinary data access denied during deletion. Both workflows completed; 16 owned table categories were empty, Auth lookup independently returned `user_not_found`, and authoritative completion receipts remained |
| Original accounts/shared budgets | Metadata hashes of the two original profiles and shared app budgets matched before/after every phase; operations never selected them for reset/deletion |

A separate scoped Management API read returned: Auth users **2**, profiles **2**, measurements/private payloads/goals/conversations **0**, completed deletion receipts **2**, unfinished deletion receipts **0**, Storage objects **0**. This confirms hosted fixture removal independently of the application's completion response. Initial/changed synthetic passwords, IDs, raw exports, phase receipts and browser evidence remain ignored/private. No screenshot, trace or recording was published.

### Local verification, failures and self-review

| Check | Observed result |
|---|---|
| Final `npm test` | 390 units across 33 files, including nine new lifecycle guard cases, passed |
| `vitest run --config vitest.integration.config.ts tests/integration/hosted-lifecycle.test.ts` | One complete real local HTTP/Auth/PostgreSQL rehearsal passed, covering all five phases plus completed-deletion replay; no stack reset or hosted fallback |
| `npm run typecheck`, `npm run lint` | Passed |
| Specification validator | 516 specification/fixture checks passed |
| Early local helper failures | Export helper initially expected an ordinary `{data: ...}` response, although account export is a raw attachment document. Corrected the helper to the existing contract while retaining attachment/no-store, ownership, inventory and hash assertions. No production code changed |
| Initial guard-test fixture | One test supplied account A's local receipt for both parallel lookups, reaching receipt mismatch before the intended remote-metadata assertion. Corrected the two-account fixture; exact receipt and metadata refusal tests both pass |
| Type/lint corrections | Corrected optional Auth error-code typing, test mock typing and graph-schema runtime use before hosted execution. No application assertion was relaxed |

**Axis 1:** Approved for the completed 3D.2 scope. Actual hosted and browser proof establishes synthetic deterministic workflows, populated isolation in the named categories, trusted reset and interrupted/resumed deletion. Server/model identities, catalog, budgets and activation bindings remain unchanged. Hosted positive execution/step/trace/allocation isolation, uncertain-accounting retention, expiry/maintenance, PWA/delayed cache races, physical devices, family handoff and recovery remain unverified gates.

**Axis 2:** Approved. Phase/purpose/source/identity/receipt guards precede consequential actions; create-only private artifacts preserve operator state; request/response bounds and safe error summaries limit exposure. Real local production-path rehearsal and direct hosted evidence supplement unit guard tests. No new dependency, infrastructure setting, public admin route or application feature was introduced. No blocking defect remains in the approved batch.

Step 3D.2 is complete. Next is 3D.3 maintenance preparation, followed by separately approved hosted execution/ownership and 3D.4 encrypted backup/current-journal/key custody and a fenced separate recovery destination. No backup or restore occurred. Additional paid spending **$0**, provider requests **0**, migrations/deployments **0**; no real data, optional-model activation or PR merge. Step 3 and formal pilot authorization remain incomplete.

## Step 3D.3 hosted maintenance preparation

Date: 2026-11-01. The owner requested maintenance preparation after 3D.2. This packet stays on PR #29 and does not authorize hosted migration, cleanup, fixture creation/deletion or a scheduler. No hosted maintenance, application deployment, provider request, real data or paid spending occurred during preparation.

### Implementation boundary

The existing local cleanup remains local-only. New `maintenance:hosted` supplies a separate explicit opt-in, target-manifest/account-bound path. Inspection is the default. Private stdin contains only source public/admin keys, bounded limits and an inspect/execute authorization for up to ten explicit UUIDs, expiring within 24 hours. The entire allowlist is checked before an execute RPC: live identities must be synthetic; absent Auth identities require a valid authoritative owned deletion journal. Wrong target/mode, missing approval, real email, missing journal or unavailable RPC fails closed. No provider/trace key or ambient hosted environment is used.

The additive 39th migration, `20261101000100_owned_maintenance.sql`, adds one service-only function, `maintain_account_v1`. A null owner/execute mode or invalid batch size is rejected. Default inspection only reads counts using database time. Execute preserves profile-first lock ordering, existing owner-scoped payload/run reconciliation, bounded pending-proposal expiry and the completed-receipt age floor of more than 31 days. Locked owners remain unfinished. Global legacy functions/grants and all tables remain unchanged.

`maintainAccounts` never discovers accounts or starts deletion. It resumes only an existing request via the existing deletion implementation, passing an explicit trusted client. Default application calls keep their original administrative client and behavior. Limits are five passes per owner, 100 selected rows/category/pass, 20 deletion continuations total, at most one Auth-removal attempt per owner/invocation, and 400 source requests with 25-second deadlines. Selected runs can contain multiple steps/reservations; this is not a 100-total-SQL-row claim. Reports contain indexes/counts, pending holds and retry times, never IDs, content or credentials. Future uncertainty is retained, not reset or shortened.

This is database maintenance preparation. Normal exports remove their own temporary artifacts on completion/error, but remote stale crash-file cleanup cannot be proved by this operator command. Backup/current-journal/key storage and rotation, a scheduler and full operational acceptance remain separate gates.

### Executed verification and retained failures

| Check | Observed result |
|---|---|
| Inert CLI plan | `npm run maintenance:hosted -- --plan`, exit 0, zero requests/credentials; exposes migration and scope/limits |
| Missing hosted opt-in | Real CLI with `--execute --manifest=missing`, exit 1 before manifest/stdin/network access |
| New unit guards | Target/approval expiry/mode, synthetic identities, whole-allowlist validation before writes, absent identity/journal refusal, inspect execution flag, pass/deletion ceilings, busy owners, future accounting and Auth retry bounds |
| Final offline/static checks | 407 units across 34 files passed, including 17 new maintenance cases; strict typecheck/lint, generated database types and 517 specification/fixture checks passed |
| Real local SQL/API checks | Mandatory owner/service-only grants, no-write inspection, expired read-time denial, bounded cleanup, foreign payload/proposal preservation, 31-day receipt boundaries, operator deletion resumption, stale authorized-run reconciliation and uncertainty preservation, actual CLI Auth/RPC over injected loopback transport |
| Missing-Auth recovery reproduction | Before repair, an explicitly requested deletion with Auth already removed and journal still `auth_removal_pending` was rejected by the CLI's completed-only gate. The regression failed with `Missing synthetic identity/completion receipt` |
| Missing-Auth recovery repair | Require a valid owned journal phase, including unfinished deletion, for an absent identity. Same real Auth/PostgreSQL regression passed; absent identity without a journal still fails before cleanup |
| Accounting evidence | Stale authorized local synthetic run interrupted; original $0.022 hold remained reserved. Aging only that local fixture's uncertainty past the existing 24-hour boundary yielded conservative $0.022 settlement with unchanged allocation; zero provider transport |
| Initial fixture corrections | Split a bulk budget insert whose app/account row shapes differed (`PGRST102`); added the Auth API-version header to a mock so the SDK preserves `user_not_found`. Product assertions were retained |
| Initial plan launch | Managed sandbox blocked the local TypeScript transform child process (`EPERM`); normal approved local execution passed, without weakening the command guard |
| Root broad integration attempt | Failed on the retained nonempty local stack: 154 passed, 5 failed, 77 skipped; four setup-suite failures plus fixture uniqueness/global-count conflicts. This is not clean integration proof. No stack reset or allocation replenishment was used to force a pass |
| Isolated verification | Created fresh `.scratch/maintenance-verification`, project `vulpes-health-maintenance-test`, ports 31421/31422; copied the candidate without credentials/linked state and specialized only project/port literals. Source/copy hashes and final guard sync are retained privately. Preflight confirmed zero profiles/Auth users/buckets and all 39 migrations; full ordinary integration result recorded below |
| Fresh full ordinary integration | All 237 cases across 16 files passed using the unchanged ordinary command/assertions. The final executable/migration/type/integration/security-test files matched the specialized copy; newly added offline-only unit cases were measured in the root unit run |
| Database lint/security | Isolated database lint passed. Initial pgTAP run failed only because the new function was absent from the reviewed security-definer allowlist. Added its exact name plus explicit service-only and pinned-search-path assertions; all 738 tests across ten files then passed |
| Isolated cleanup | Generated types matched the fresh schema. Only the new maintenance verification stack was stopped after checks; its volume/evidence were retained. The original stack was not reset |

The local additive migration was applied without resetting data. Its uncommitted function was refreshed locally while adding pending-hold/retry reporting, without migration-history repair; the fresh verification stack installs the final migration from scratch. Original retained workspaces and hosted resources were not reset or repurposed. Raw runner output, copy hashes and safe receipts remain ignored under `.scratch/hosting-owner-pilot/`.

### Review and next approval

**Axis 1:** Approved for database-maintenance preparation. Actual SQL/Auth/CLI and full isolated integration evidence covers the named local scope, including the reproduced missing-Auth recovery edge. Hosted migration/execution, manual ownership, remote export crash-file cleanup and custody/recovery remain explicitly unverified. No product feature, inference activation or application deployment was added.

**Axis 2:** Approved. Mandatory owner and service-only grants, pinned search path, explicit target/account/mode/expiry binding, whole-allowlist validation, lock ordering, request/pass/deletion caps and conservative hold handling preserve the boundary. The local-only CLI remains unchanged. Security-definer inventory remains exact and has stronger assertions for the new function. No demonstrated blocking defect remains in the prepared packet; historical failed attempts are retained rather than relabeled as passes.

The [operator procedure](../operations/synthetic-hosting.md#hosted-maintenance-operator-procedure) defines the concrete next approval: apply only the reviewed 39th migration, create new `vulpes-maintenance-a@example.invalid` and `vulpes-maintenance-b@example.invalid` fixtures, inspect/clean in bounded passes with a foreign control, resume only their requested deletions, and age/prune only A's completed synthetic receipt while preserving B's fresh and earlier 3D.2 receipts. Preallocate credentials/UUIDs privately and refuse existing names. Maximum paid spending is $0, with no model consent/allocations/calls, app deployment, scheduler, backups or restore. The two original accounts remain outside the mutation scope. No dashboard or secret entry is needed for this approval; manual operator ownership/cadence must be agreed before hosted use. No PR merge is authorized.

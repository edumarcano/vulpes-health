# Owner-pilot Step 3D.1: hosted security preflight

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

## Required next approval and owner actions

The [operator procedure](../operations/synthetic-hosting.md#remaining-step-3d-packets) defines the remaining packets. Next is a $0 synthetic 3D.2 execution approval for **two newly created disposable accounts**, `vulpes-3d-a@example.invalid` and `vulpes-3d-b@example.invalid`. Create them through trusted administration without email; refuse existing identities with those names. Exercise only their synthetic manual/CSV data, corrections, explicitly approved synthetic goals, conversations and private account exports; attempt bounded foreign-parent/direct-write denials; reset one disposable password and verify old access/refresh sessions fail; interrupt/resume deletion and permanently remove only these newly recorded identities/data. Preserve safe failure evidence rather than bypass constraints. Existing owner/isolation identities and retained Luna state remain untouched.

The owner needs only to approve or decline that exact scope in chat; no dashboard or secret entry is needed for this packet. Permanent deletion and password reset are consequential even for disposable identities, so they are not performed under a read-only checkpoint. Maximum paid spending is $0; no model call, consent, budget allocation, migration, deployment, new infrastructure or backup export is included. A defect requiring a deployment needs separate approval.

Hosted maintenance and complete hosted-source recovery follow separately. Before backup capture, the owner must select/approve encrypted backup storage, independent current-journal storage, separate key custody, and a fenced disposable local destination; exact secure setup instructions will accompany that decision. A local restore is still a compatibility candidate, not evidence. The official [Supabase platform-to-self-hosted procedure](https://supabase.com/docs/guides/self-hosting/restore-from-platform) documents a supported migration direction and warns about Auth/PostgreSQL version differences; Vulpes must preserve its stronger ownership, journal replay, trace-key and access-fencing invariants. No required rows/columns may be dropped to obtain a pass.

Additional paid spending: **$0**. Provider requests: **0**. Actual cloud use: approved Supabase Auth/Data API and Vercel application reads plus read-only deployment metadata. Step 3, real-data authorization, production inference, optional Flash/Argon and formal acceptance remain incomplete. No PR was merged.

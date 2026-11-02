# Owner-pilot Step 3D.4C: journal replay and restored-session revocation

Date: 2026-11-01. Branch `feat/owner-pilot-recovery-replay`, based on PR #31 at `3aad8aac09dac9246f8ad3ece4f50866737c52a5`. The owner requested continuation under the approved incremental workflow. This packet implements only operator recovery logic and synthetic local verification. No hosted capture, source account change, deployment, provider call, real data or paid spending occurred.

## Delivered interface

`recovery:database --recover` authenticates the backup and independently retained journal before creating a fresh fenced destination. It reuses the existing deletion functions for completed/unfinished authorization, checks exact unaffected data and shared charges, revokes restored refresh/session state, validates SQL RLS/live-session behavior, then obtains and stores a separately authorized fresh journal. The current source capture must match the initial records. Outer approval binds backup/image/initial journal/latest path; the nested existing capture schema binds the source/path/expiry/custody. Wrong/missing approvals fail closed. Ordinary capture/restore modes retain their behavior and do not acquire a hosted read implicitly.

The command always denies access activation. Its remaining report identifies actual Auth/API compatibility, source-loss/cutover completeness and current accounting reconciliation. Fresh unchanged metadata is not treated as proof that no future source deletion or charge can occur. [Runbook](../operations/hosted-recovery.md#fenced-journal-replay-and-recovery-validation).

## Observed verification

| Check | Actual result |
|---|---|
| Full `npm test` | 461 tests across 37 files passed, including 14 new replay/refusal/precision cases |
| Targeted real integration | All three journal, database capture/restore and replay command tests passed together. Existing complete capture/actual private-stdin restore CLI coverage remains intact |
| Four-account rehearsal | Four new synthetic Auth/profile/conversation/encrypted-payload graphs and sessions/tokens were backed up under two trace-key versions. After backup, one source account completed actual deletion and a second remained `fenced`; two accounts remained active. The authenticated independent journal contained both requests |
| Recover command pipeline | Actual command parser/native PostgreSQL pipeline restored the older archive, replayed both source authorizations, independently checked owned-data/Auth absence, preserved unaffected hashes/shared charges, removed the two remaining sessions/tokens, and passed two-owner SQL-policy checks. Initial capture plus one post-validation source refresh used only the injected local SQL transport; no hosted request occurred |
| Stored current copy | Fresh encrypted latest file authenticated to the same two journal records, including the source's still-unfinished request. The destination completed its local replay without mutating that source request. No plaintext journal/key was written |
| Session proof | Zero persisted sessions/refresh tokens; all four original sessions denied by `owned_session_valid_v1`. Two rollback-only probe sessions verified own profile access, foreign profile/conversation denial and absent direct private-payload privilege; no probe persisted |
| Accounting precision | A local synthetic app bucket's allocation and `0.01234567890123456789` spent amount survived unchanged. Unit evidence rejects a one-unit loss beyond double precision without issuing a bucket reset |
| Failure coverage | Expired/foreign/corrupt/wrong-key initial copy, source accounting wait, excess replay records, omitted restored unfinished request, changed/failed latest read, replay/revocation/validation failures and missing hosted-read opt-in all refused. Owned destinations stop on failure; no path authorizes access |
| Actual CLI plan/refusal | Plan exited 0 without credentials/network. Recover without hosted journal-read opt-in exited 1 before manifest/stdin/Docker access, with a generic safe refusal |
| Final static checks | Typecheck, lint, 524 specification/link checks and `git diff --check` passed |

## Retained failures and scope limits

The first local fixture used historical bucket scope `household`; the current `app`/`account` constraint rejected it. Correcting only the synthetic fixture to `app` preserved all product assertions. Initial typecheck caught an extracted fixture's trace-key reference and mock literal types; lint caught a throw inside finally. These were corrected before final checks; cleanup validates the generated absolute temporary path.

The first complete replay pass tested only the two sessions remaining after deletion. Adding `oldSessionsTested: 4` reproduced the coverage gap: the actual result was two. Replay now captures session identities before deletion and merges the remaining inventory before revocation. The same four-session regression passed in the final integration run. This improves executable evidence rather than weakening denial assertions.

The complete local schema fixture was extracted for reuse across the database/replay tests. The generated databases and test-owned containers/files were removed only after their ownership/name checks; root product data and retained verification allocations were untouched. Source rereads in the new test were injected local read-only SQL responses, not live Management API acceptance. Real HTTP journal transport and the existing actual restore CLI remain covered separately.

A final Docker inventory showed no running recovery targets. One stopped synthetic failure target remains alongside the earlier stopped empty probe and is preserved for inspection. The successful-command test now records its owned destination name before assertions so later assertion failures can clean that exact target; assertions and product behavior are unchanged.

## Split-axis self-review

**Axis 1, requirements:** Approved for the named local replay/revocation/validation packet. Completed and unfinished post-backup authorizations, unchanged source journal, receipt/data/Auth completion, protected peers/shared charges, four old-session denials, two-owner SQL isolation and current-copy matching have executable proof. Hosted operation, durable custody, cutover/source-loss completeness, current source accounting and actual GoTrue/PostgREST/browser compatibility remain pending. No result grants restored access or real-data use.

**Axis 2, engineering/security:** Approved. Authenticated source/time/target/operation bindings precede restore; replay limits and existing deletion/hold semantics preserve the boundary. Only journal-listed identities are removed, shared costs use exact decimals, current evidence is independently encrypted/create-only, and immutable owned-container cleanup remains in finally. Temporary validation sessions roll back. Generic CLI failures/reports exclude credentials, IDs and private content. No new dependency, schema, public administration endpoint or model setting was added; no demonstrated blocking defect remains in this packet.

Next is isolated Auth/API recovery validation, followed by one concrete grouped custody/credential/source-read/fenced-rehearsal approval. No owner dashboard or credential action is necessary merely to complete this PR. Step 3D, formal pilot gates and PR integration remain incomplete; no automatic merge.

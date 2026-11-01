# Vulpes implementation decision log

The canonical product and architecture decisions are recorded in [`spec/v0.1.0/DECISIONS.md`](spec/v0.1.0/DECISIONS.md).

Record implementation trade-offs, actual provider capabilities and identifier verification, pinned dependency choices, schema changes, deviations, and relevant tests here. Each entry should identify its date, impact, alternatives and required approvals.

## 2026-10-31: Single-project synthetic hosting

The owner reports that the source Supabase project is Free/us-east-1 with account MFA enabled; an unrelated project occupies the second Free slot. A second hosted project is not a prerequisite for initial synthetic hosting. Allow an explicit null recovery reference while retaining source/recovery inequality whenever a reference is supplied. Manifests identify deferred/unverified recovery and never authorize real data. The original CLI rejected null before repair; actual local preparation now succeeds with 38 migrations, deferred recovery and zero network/deployment activity. No unrelated project access, quota workaround, paid upgrade, migration or deployment is authorized.

Before real-data use, demonstrate complete hosted-source recovery into a separate environment. A disposable local Supabase destination is the preferred zero-cost candidate to investigate; the existing local-source rehearsal does not prove its compatibility. This changes initial resource sequencing, not the recovery acceptance gate.

## 2026-10-31: Controlled synthetic hosting preparation

Initial hosting has no provider credentials and inference remains false with null production evidence/zero ceiling. Generate an exact-origin CSP and target-bound build for one approved Vercel project, source Supabase reference and production hostname. Use the Vercel Production channel for the isolated synthetic site; preview builds refuse server-secret configuration. Disable Git automatic deployments, exclude private local material from CLI uploads and preserve explicit API JSON routing. No infrastructure, public API, model or data schema change is authorized by preparation.

A static CSP reproduction showed hosted Supabase was blocked by `connect-src 'self'`; local preview already allowed its validated origin. Shared header construction now supplies the same exact origin to generated hosting configuration. The public probe has an explicit opt-in, 14 credential-free GET maximum, no redirect following and bounded safe response handling; it cannot attest Auth/RLS, candidate identity, inference state or recovery. Its first real local HTTP run exposed a missing request-ID field in the probe's expected envelope; the existing handler contract was retained and the probe corrected.

The resource proposal uses Vercel Hobby and separate source/recovery Supabase Free projects with explicit North Virginia or Frankfurt placement and $0 paid allowance. Resource/region, deployment and recovery custody approvals remain absent. Local operational scripts keep their hosted-target refusals; a supported fenced restore and hosted maintenance procedure must be implemented/verified before real-data use. Flash/Argon stay optional without a Google billing prerequisite. [Procedure](operations/synthetic-hosting.md), [evidence](evidence/owner-pilot-step3.md).

## 2026-10-31: Current Luna verification and final-answer context

Standing owner authorization covers necessary synthetic Luna batches under the existing $0.50 nonrecurring key cap, retaining confirmed privacy controls and the accepted screening exception. It does not grant production, deployment, real-data or optional-model activation. All 14 fixed v7 cases passed with separate host answer review; prior failed batches and uncertainty holds remain retained. [Current evidence](evidence/luna-owner-pilot-live.md).

Actual goal follow-up context exceeded the 11,000-byte internal allowance by 34 bytes after complete owned results. The orchestrator now removes removable history before omitting domain tool schemas for a final answer (or the existing eligible Flash escalation when supplied). Safety text and complete current results remain; evidence that still cannot fit fails before another request. Reproduction-first integration checks cover both outcomes. No context/token/call ceiling was raised.

The final instructions explicitly state account isolation, absent family-sharing/connection features and bounded conversation memory after a live answer implied unavailable capabilities. The E05 fixture clarifies source/direction/latest-value baseline while retaining the immediate-activation challenge and exact user-approval requirement. Template v7 invalidates earlier partial evidence. No infrastructure, model identity, provider effort, schema or production approval changes.

## 2026-10-31: Stopped Luna batch and comparable-method guidance

The owner approved one synthetic-only $0.50 batch, the screening/flagged-retention exception and account privacy controls. A dedicated nonrecurring capped key replaced an unsuitable recurring-limit key before dispatch. The v4 batch stopped at E05 after 14 requests, $0.001251535 settled usage and zero held reservations; provider key metadata matched the ledger. Luna combined a seven-day-average baseline with latest-value current tracking. The server rejected it without saving a proposal/goal. No subsequent case or paid retry was sent.

The shared model instruction now exposes the existing comparable-method rule for both proposals and revisions. Duplicating lengthy guidance in both tool descriptions overflowed the bounded goal follow-up during local testing; the compact shared instruction passes that unchanged workflow without raising limits. Server validation/approval authority, model, effort and token limits remain unchanged. Advance the template to v5 so incomplete v4 results cannot count as current acceptance. The repair is verified offline, not live. Preserve the failed allocation and private evidence; a new full v5 batch needs fresh approval, proposed at $0.47 additional maximum. Production evidence remains null, run ceiling zero and optional models disabled. [Observed evidence and review](evidence/luna-v4-live.md).

## 2026-10-31: Current Luna verification preparation

Refresh the public conservative rate snapshot without changing model identity, effort or token limits. Bind public capability evidence to v4. Add fixed empty, sparse heart-rate and source-injection fixtures behind the existing immutable verification allocations; original scale fixture identity remains valid. A fixed-case operator runner uses one aggregate app ceiling, deterministic attempt identities, create-only plan bindings and no automatic model retries. Structural checks leave semantic model assessment pending. Owner consent, key/privacy checks and separate capped spending approval remain required; production approval is not installed. [Procedure](operations/luna-verification.md).

## 2026-10-31: Disabled owner-pilot Luna composition

Normal chat now has a separately issued Luna production transport through the existing dispatcher and execution ledger. Status, conversation availability and Settings share configuration readiness without reading provider credentials. Current smoke and explicit owner approval bind the privacy notice/version, price and adapter/template; no production evidence or positive run ceiling is installed. The transport rechecks enablement before its single fixed-endpoint request.

OpenRouter consent v2 prepares disclosure of announced screening and possible flagged-content retention. A forward settings-function migration requires explicit acceptance of v2 while retaining historical consent. Current synthetic fixtures use v2; historical migrations and evidence remain unchanged. The service-only budget transaction creates missing UTC-month buckets and refuses ceiling drift; matching repeats preserve balances. The interactive CLI remains local-only until hosted operations are separately approved.

No provider call, real data, hosting change, policy acceptance or inference activation is authorized by this implementation.

## 2026-10-31: M5/M6 review remediation

Vertex step preparation records a digest of the complete approved policy in internal request metadata; final authorization checks that digest under an approval-row lock. The issued verification transport also rechecks its original binding after credential acquisition. Policy/version changes do not install consent or enable a provider. Google verification admission and context manifests use the approved/admitted Google version.

Expired pending proposals are hidden from direct authenticated reads until cleanup removes the draft. Account export projects an expired receipt with a null body without depending on cleanup timing. Approved historical decisions remain retained.

Entering account deletion invalidates the private scope once for that owner. Same-owner auth refresh/status reads preserve the verified active or deleting view while rechecking account status; completion of an older deletion request preserves the latest session. Initial restoration and new identities still wait for verification, and a failed status check shows unavailable. Account changes, sign-out and confirmed deletion invalidate the scope. Controlled browser regressions demonstrated an aborted deletion continuation, stale-session rollback and an inspector lost during active-account revalidation before their respective repairs.

The mobile conversation no longer changes height when an Ask control receives focus. The existing dynamic viewport height still responds to available screen space. Native pointer/focus tracing demonstrated a 42-pixel control movement between press and release, and a deterministic browser check reproduced the 70dvh-to-65dvh resize. Live-stream inspection remains available. Physical keyboard/device behavior still requires the separate device gate.

Payload creation obtains an expiry from PostgreSQL before encryption, preserving the authenticated expiry field and existing 24-hour/seven-day ceilings. This adds a local database round trip per new envelope. Adding a clock tolerance or changing expiry after encryption would weaken retention or break authenticated decryption. A controlled browser API clock lead reproduced the rejection; the same six original browser cases pass after the fix. This demonstrates the clock failure mode without attributing every historical failure to it. [Remediation evidence](evidence/m56-review-remediation.md) preserves actual outcomes and remaining gates. No model, budget, approval, deletion or retention policy deviation is authorized.

## 2026-10-30: PR 17 integrated evidence and handoff

PR 17 uses the existing test/browser/database harnesses and a small fixed-command evidence collector. It records actual exits, safe numeric output, candidate/workspace fingerprints, installed versions and build hashes. A separate disposable local copy preserves retained M3 verification allocations. Missing/stale records remain unverified; earlier failures remain in history. No dependency, application architecture, model catalog or safety/retention policy changes.

The [release checklist](operations/release-readiness.md) owns external gates and reproducible procedures. The [acceptance report](evidence/release/m6-local.json) separates local test scope from current-template model quality, hosted infrastructure, physical-device and family/human recovery evidence. Historical v3 Everyday evidence cannot validate v4. PR 14 remains deferred and disabled. Combined independent M5/M6 review follows the PR 17 candidate; self-review and a focused open PR do not grant full acceptance, merge, deployment or pilot authorization.

## 2026-10-29: PR 16 account lifecycle and recovery

The approved M6 batch adds `/api/account` through the existing Settings deployment entry point. Strict requests derive ownership from verified Auth identity. Ordinary operations require an active profile/live owned session; only account status and deletion continuation accept a verified deleting identity. Password AMR freshness is five minutes; token refresh does not reauthenticate.

Deletion uses explicit durable phases and a small service-only receipt journal without profile/Auth foreign keys. It removes private content through bounded steps, preserves the approved 24-hour uncertain-charge policy, then removes owned accounting/allocation rows, profile and Auth identity. Shared app charges and durable route-cost blocks survive. Completed journal entries remain at least 31 days, covering the approved 30-day encrypted backup maximum. Cancellation receipts and profile reactivation cannot bypass the fence. Maintenance selects remaining work after both late and conservative settlement.

Account export uses owned pages, existing inspector checks, encrypted temporary capture and section/revision fingerprints. Its integrity inventory describes a capture interval, not a transactional backup. Opaque continuation state and executor authority are excluded. The restore rehearsal uses existing Supabase/PostgreSQL tooling and Node cryptography with a separate disconnected destination, retained key versions and a current independent deletion journal. Operator-assisted reset uses protected input and persisted session revocation; no SMTP or new runtime dependency is added.

The operating procedure is [account lifecycle and recovery](operations/account-lifecycle.md). Local evidence and both self-review axes belong to [PR 16 evidence](evidence/pr16-account-lifecycle.md). Hosted infrastructure, real-account recovery/deletion, human identity/handoff, physical devices and family use remain separately gated. PR 14 stays deferred. The combined independent M5/M6 review remains after PR 17; this implementation does not claim milestone acceptance.

## 2026-10-29: PR 15 static PWA and mobile presentation

PR 15 uses a build-generated public-asset allowlist and a separate data-free
offline page. No PWA framework, offline health store or background synchronization
is added. The worker never caches application/API/auth responses; new workers wait
for open tabs to close. The cache version binds compiled asset names and public
asset content. Tailwind scans `src/` explicitly so verification copies produce the
same stylesheet as the checkout.

The header uses the supplied horizontal logo in both themes, with a light backing
in dark mode to preserve contrast without a tiny descriptor or recoloring the
wordmark. PWA runtime icons are resized from the approved color master. Existing
GoalService, approvals, analytics, provider availability and accounting remain
unchanged. Local verification and retained failures belong to [PR 15 evidence](evidence/pr15-mobile-pwa.md).
Physical-device, real assistive-technology, hosted and live-provider evidence are
separate gates. This records no new activation, deployment or retention policy.

## 2026-10-29: M5 routing and provider controls

The approved M5 plan removes manual model/depth/effort selection from v0.1.0. Luna remains primary. One server-authorized Flash handoff requires current-run deterministic evidence for goal-progress review or comparison of two metrics. Argon remains a backend capability and is excluded from chat routing; its eventual automatic/explicit product policy is deferred beyond v0.1.0. PR 14 is deferred without blocking M6.

Implementation and an open PR are authorized. Provider calls, spending, production activation and merging are not authorized. Google policy, project/location, credentials, prices and live evidence remain unapproved. Historical live bindings remain historical and the changed v4 instruction template invalidates them. [PR 13 evidence and self-review](evidence/pr13-vertex-routing.md) distinguish local verification from pending live gates.

## 2026-10-28: Chat proposal workflow (execution-plan PR 12)

The approved M4 batch extends the verified PR 11 branch with two pending-proposal tools and typed chat references. GoalService prepares direct and chat payloads using the same ownership, policy, baseline and lifecycle rules. A narrow service-only transaction reuses PR 11 registration and M3 checkpoint/settlement functions; it commits proposal, encrypted tool evidence, tool completion and message reference together under the existing profile/executor fence. One source step creates at most one proposal. No approval or direct goal-mutation tool is exposed.

Cards resolve only owned message-bound references, then fetch authoritative status/body for the shared review component. Confirmation sends the existing exact approval envelope directly, without inference. Reference resolution remains possible after trace expiry and before draft-expiry cleanup; it exposes no expired body. Saved numeric progress also binds to the approved goal version, so a later target change cannot leave an apparently current calculation. Conversation deletion invalidates pending drafts through the message binding and leaves approved revisions intact.

Template v3 and projection v3 preserve the fixed context/wire/call limits. Revision tools have no advertised target until an editable approved goal exists; final requests advertise no more tools. Compact goal projections omit duplicated identity fields and null definition fields while full tool evidence remains encrypted. Version-1/version-2 projections remain readable. Existing literal live capability evidence is preserved and now mismatches the changed template, so live preflight fails closed. No catalog identity, price, spend, provider activation or production transport was changed. [Verification and self-review](evidence/pr12-chat-goals.md).

## 2026-10-28: Direct goal approval workflow (execution-plan PR 11)

The approved M4 batch choices are implemented for direct Goals only: fixed current methods, explicit second review after missing baselines become available, retain-or-replace baseline review, reopening paused/completed goals, terminal archive, 24-hour proposals and discarded unapproved draft bodies. Existing wellness boundaries apply without new clinical numerical thresholds. PR 12 and production inference remain unavailable.

One provider-independent GoalService owns proposal construction and approval coordination; a forwarding approval-service wrapper is unnecessary. Narrow service-only PostgreSQL functions serialize through the active profile lock, hash server-built JSONB, bind expected goal/data revisions and store replay outcomes with existing audit receipts. Forward migrations preserve existing rows. Frozen calculations retain exact decimal values before DTO/display conversion. Version-1 M3 evidence remains readable; the read-only goal tool delegates version-2 progress to the shared service.

Unapproved bodies are removed atomically on data-revision changes and on rejection/conflict/expiry. Direct owned proposal reads enforce expiry. Approved revisions remain immutable history; the existing measurement lifecycle retains conservative baseline-review markers. No AI write/approval tool, provider activation, model change, deployment or real-data operation is included. [Evidence and split-axis self-review](evidence/pr11-direct-goals.md).

## 2026-10-27: M3 continuation repair and live re-verification

The approved repair keeps the existing input/output and spending ceilings. Versioned measurement projections and compact provider schema framing fit the genuine read path while full results remain encrypted and historical projection validation remains available. Cache-write counts are preserved without inventing billing-subset semantics. Guarded smoke attempts now have explicit idempotent attempt IDs and require a durable nonterminal prefix for cancellation/disconnect proof.

The completed real-model answer used a mathematical minus sign; a notation-only verifier repair was reproduced offline and independently reviewed before reassessing the same saved run with zero further inference. The completed loop, controlled cancellation/disconnect and actual API/browser evidence passed. All seven requests in the original $0.06 batch currently show $0.001063265 in provider billing; the ledger has $0.000836365 settled and $0.0186384 conservatively held. Production remains disabled. [Evidence, retained failures and remaining limits](evidence/m3-live-reverification.md). Changes remain uncommitted; integration and formal milestone acceptance are separate.

## 2026-10-27: Bounded Everyday live-verification attempt

The user authorized a $0.06 aggregate synthetic-only batch after reviewing current model/pricing/ZDR evidence. Everyday now has a conservative typed price snapshot and matching public capability fingerprint; model identity, ceilings and production composition are unchanged. The first attempt made two Azure-routed Responses requests, settled $0.000360750 and stopped with `context_too_large` after a genuine measurement read. No further paid scenario or retry was run. Production remains unavailable, and full M3 acceptance is blocked. [Live evidence](evidence/m3-live-everyday.md) records the continuation-size reproduction, exact request/usage/accounting evidence and remaining checks. No budget, model, retention or live-user activation deviation was approved.

## 2026-10-27: M3 independent-review remediation

**Scope:** Implement F1 and the bounded F2 fix from the independent review of merged PRs #11–13. Implementation, branch publication and an open PR are authorized; merge and live-provider activation remain separate.

- Persist bounded provider-reported identifiers/model/effort and adapter-normalized finish reasons within the existing settlement transaction. Reuse executor/content fences; retain requested values separately. Historical unknown metadata is not reconstructed from expired traces.
- Resolve retained message receipts under the same profile/conversation locks as admission. Return an explicit `retained` response after execution expiry, with no lease or fabricated run. Check conflicts before provider availability and repeat the receipt check inside admission.
- Add two forward migrations without editing merged migrations or changing accounting formulas, reservation ceilings, model identities, encrypted request capture, or provider activation gates.

[Remediation evidence](evidence/m3-review-remediation.md) records reproduction failures, verification and split-axis review. This remediation does not record full M3 acceptance or resolve the pending live-integration gate.

## 2026-10-26: PR 10 execution inspection and verification

**Scope:** Execution-plan PR 10 on the PR 09 parent. Local synthetic verification and publication of an open dependent PR are authorized. Merge, deployment, live provider calls, price approval and production activation remain separate decisions.

- Resolve each inspected payload through the authenticated owner, run, step and permitted purpose. Return exact bytes separately from formatted JSON; reject malformed tool identities and projections. Clear private inspector cache on close and mark historical data revisions.
- Keep the Everyday verification transport fixed to the Responses endpoint and behind the same dispatcher, consent checks, encrypted capture and paired reservations. A persistent synthetic batch binds one fixture revision and account bucket to the approved aggregate ceiling. A changed fixture, new month or unresolved hold cannot replenish that ceiling.
- Preserve violated provider/model cost-bound blocks in a separate non-sensitive durable table. A reproduced inherited defect showed that 90-day execution cleanup otherwise removed the only block. Settlement records it atomically; reservation and send authorization enforce it, and the migration backfills existing violations. Clearing a block requires separately reviewed operator action.
- Keep prices and capability/privacy evidence unverified. The explicit opt-in CLI stops before credential discovery until those gates are separately approved. Production composition stays unavailable; a successful single smoke would not by itself accept M3.
- Evaluate deterministic controls and synthetic orchestration separately from real-model behavior. The machine-readable report records `not_run` for every real-model assessment.

[PR 10 evidence](evidence/pr10-execution-inspector.md) records local checkpoints, failures and review; live evidence and the independent cumulative M3 review remain pending.

## 2026-10-26: PR 09 persisted Ask Vulpes

**Scope:** Execution-plan PR 09 and the approved M3 batch plan, based on merged PR 08 (`98b097d`). Implementation, local synthetic verification, commit/push and an open PR are authorized; merge, PR 10 and live inference are not.

- Extend admission through one service-only transaction that inserts the authoritative user message and assistant placeholder. Conversation/cancellation receipts reuse the existing audit store; no new queue, ORM or persistence service is introduced.
- Keep raw provider response capture separate from durable message prefixes. Every emitted text delta follows a committed prefix. Parser rejection is a failed run; the original direct-dispatch consumer cancellation contract remains unchanged.
- Preserve complete tool groups and opaque Responses output in encrypted continuation state. Conservative byte bounds prune whole older groups; qualified numerical projections avoid duplicate point arrays while full tool evidence remains exact.
- Define a narrow approved-goal read projection and dedicated progress union. Drafts, unsupported frozen snapshots and review-required baselines remain unavailable. PR 11 must consume or re-review this contract.
- Keep synthetic injection in a separate local test executable, bound to a synthetic account. Production has no mock fallback or credential-bearing provider transport. The typed model catalog and live gates are unchanged.

[PR 09 evidence](evidence/pr09-ask-conversations.md) owns actual commands, failures, empirical artifacts and split-axis review. This local PR does not accept M3 or resolve recorded M2 acceptance.

## 2026-10-26: App and account AI spending terminology

**Authorization:** Rename the PR 08 budgeting terminology, verify/review it and update the existing PR before merge. Spending behavior and authorization gates do not change.

| Term | Scope and implementation |
|---|---|
| App AI spending limit | One aggregate inference cap per deployment/UTC month; database scope `app` |
| Account AI allocation | Operator-assigned monthly ceiling for one account; database scope `account` |
| Personal spending limit | Account holder's lower monthly preference within that allocation |

The former `household` name implied membership that the schema does not model. Migration `20261026000600_budget_scope_names.sql` translates existing scopes, renames reservation references, and replaces the affected functions in one locked transaction. Existing migration files remain immutable.

IDs, balances, uncertainty/evidence, ownership, periods and lock order remain intact. Deploy the schema and matching server code together; old direct database clients using the former scope/column names need updating. HTTP routes and neutral settings fields stay unchanged; app balances remain server-only.

Historical evidence retains the vocabulary used when recorded. [PR 08 evidence](evidence/pr08-run-accounting.md#budget-terminology-follow-up) records the new proof and review.

## 2026-10-26: PR 08 run admission and accounting

**Scope:** Execution-plan PR 08 only, from verified `main` at `fe6675b`. The explicit implementation/publication instruction authorizes this foundation while the ledger still records M2 acceptance as pending; it does not accept M2 or M3. [Verification evidence](evidence/pr08-run-accounting.md) owns commands, results and review status.

| Area | Decision and reason |
|---|---|
| Transactions | One execution facade coordinates ledger and budget RPCs so a reservation cannot exist independently of its encrypted step capture. Pricing remains a pure decimal module. Household then user locking protects both scopes across processes; no database lock spans transport. |
| Dispatch | Capture once, decrypt/verify stored bytes, then compare-and-set send authorization. A single-use run-bound dispatcher lets an adapter serialize its final body without receiving execution credentials. The actual transport remains mock-only. Ambiguous authorization never permits a retry. |
| Unknown cost | Keep the full hold for 24 hours, then settle conservatively when reconciled. Late authoritative cost replaces the previous charge through an idempotent versioned delta; expiry/cancellation never implies zero. This implements the confirmed M3 planning choice. |
| Lifecycle | Persist executor hash, fence, lease, UTC admission period, data revision, explicit dispatch state and terminal outcome. Source deletion and account-deleting state fence content writes. A late usage correction can affect accounting without restoring private content. |
| Limits and prices | Retain four model calls, six tools and 210 seconds; use ten starts/minute, five-second heartbeats, 30-second leases and 60-second request timeouts bounded by the run deadline. Reserve verified category maxima with a 10% margin, rounding upward to 12 decimal places. Production prices remain unverified and the positive run ceiling unconfigured. |
| Settings | Expose only the owned allocation/preference/spend/holds. The user may choose a preference within the operator allocation; clearing it does not replenish spend. Reuse the existing optimistic settings receipt and transaction. No operator-budget editing UI. |
| Retention | Existing seven-day encrypted payload retention and 90-day run metadata cleanup accompany this store. Core transcript receipts are separate from execution metadata. Full conversation/account workflows remain deferred. |

**Boundaries:** Synthetic local Supabase, mock transports and a loopback HTTP receiver only. No provider transport, live inference, model replacement, deployment, hosted mutation or real health data. PR 09 has not started. Live M3 acceptance remains pending its required evidence.

## 2026-10-25: M2 timestamp review remediation

**Scope:** Independent cumulative M2 review blocker F1, from merged PR 07 at `0e59d8c`. [Reproduction and verification](evidence/m2-timestamp-remediation.md) record the focused remediation and split-axis self-review.

**Decision:** Reject unsupported second-60 observation timestamps before Temporal or PostgreSQL parses them. Temporal constrains them to second 59 while PostgreSQL can roll them into the next day. The normalizer, correction service and a forward migration for the two direct mutation RPCs enforce seconds 00–59. Preserve ordinary offsets, microseconds, naive-time/DST handling, decimal values, ownership, transaction locks and grants. Existing rows and historical receipts are not rewritten; their intended timestamp cannot be recovered from the stored instant alone.

**Authorization:** Focused repair, local synthetic verification, commit and one remediation PR were requested. This closes the demonstrated validation defect without introducing a clinical threshold or changing analytical semantics. M2 acceptance and integration remain separate decisions.

## 2026-10-25: PR 07 measurement lifecycle

**Scope:** The final approved M2 implementation packet, on `feat/pr07-measurement-lifecycle` from refreshed `main` at `aacc489`, after verifying CSV PR #7 merged. [Evidence and split-axis self-review](evidence/pr07-measurement-lifecycle.md) distinguish local acceptance from the pending independent cumulative M2 review.

| Area | Decision and reason |
|---|---|
| Versioned edits | One narrow owner-derived RPC serializes correction/deletion with existing add/import transactions through the active profile lock. SQL checks expected version, permitted fields, exact numeric conversion and identity conflicts before writes. Database-computed request hashes and existing safe receipts preserve historical retries after later deletion. |
| Provenance | Correction edits value/unit and observation time/date/timezone only. Preserve source, metric, external identity, method, granularity and import lineage. Add a correction marker without retaining old measurement values in receipts. A new series requires explicit deletion and entry. |
| Baselines | M2 does not define authoritative baseline window/reference dependency metadata. Conservatively mark all owned matching source/metric baselines `needs_review`, increasing goal version only when that status changes. Preserve approved snapshots, targets, states and revision payloads. Goal creation, proposals and approval remain PR 11. |
| Physical deletion | Remove the measurement, invalidate pending owned previews and remove all owned import staging. Conservatively purge retained AI request/response/tool/provider-state envelopes; record `trace_content_removed_at` on owned runs and retain safe accounting. Frozen goal decisions remain labelled history. A fresh import can recreate a reading; replay of a committed batch cannot. |
| Export | Read owned pages of 200 into an encrypted temporary file with an ephemeral random AES-GCM key, then stream only after revision validation. Remove the file and zero the key on completion/failure; cancellation aborts page reads. A crash leaves unreadable ciphertext, not a retained plaintext CSV. Include canonical/original decimal text, source/provenance identifiers and available session times. Escape formula-sensitive text while keeping numeric negative strings unchanged. No public storage artifact or dependency is introduced. |
| Client invalidation | Refetch Data queries after historical mutation acknowledgements. Disable a pending preview when the known revision changes. Mutation/CSV-download replies use existing identity epochs; downloads use authenticated fetch, no-store and a revoked object URL. |
| Cleanup | Service-only bounded maintenance uses profile → batch → envelope lock order. Expire pending batches and remove staging atomically; handle orphan expired envelopes too. Data requests attempt owned cleanup, and the guarded local CLI handles inactivity without a scheduler. Read-time expiry does not depend on cleanup success. |

**Authorization:** PR 07 implementation, synthetic local verification, blocker repairs, commit, push and PR creation were requested. No M3, hosted modification, real health data, live provider, merge or goal activation is included. No product-specification deviation was required.

## 2026-10-25: PR 06 CSV preview and transactional import

**Scope:** The approved M2 batch's second packet, from current `main` at `5b00a68`, after verifying PR 05 merged as GitHub #6. [Evidence](evidence/pr06-csv-import.md) distinguishes local synthetic proof from hosted or native-device acceptance. PR 07 and the independent M2 review remain separate.

| Area | Decision and reason |
|---|---|
| Parsing/mapping | Pinned `csv-parse` 7.0.3 supplies bounded parsing, BOM/quoted fields and line endings. Canonical source labels and one optional profile-column value are explicit filters. Wide mappings declare each metric/unit/method. Bounded source warnings remain text; manual entry retains its explicit review flag. Unknown columns are ignored visibly; no vendor-format compatibility is inferred. |
| Limits | Retain 1 MiB CSV, 5,000 observations and 2 MiB public JSON. Bound records to 64 KiB, headers to 100, data rows to 10,000 and normalized staging to the existing 4 MiB private-envelope limit. Reject excess rather than truncate. Preview/error displays are bounded with explicit omitted-error counts. |
| Preview | Existing AES-GCM storage encrypts the normalized bundle, including mapping, classifications, counts and revision. Raw CSV and ignored cell contents are not retained. Authenticated registration verifies the database hash of the exact staged bytes and creates a source namespace when needed. Labels do not identify sources. |
| Commit/replay | Lock the active profile before batch/envelope; bind source metadata, hash, expiry and revision, and reclassify before inserts. One transaction inserts only approved new observations, increments revision once, records the historical acknowledgement and deletes staging. Committed file/source/mapping identities never restore later removed rows. Receipts contain hashes, IDs and outcomes only. |
| Failure lifecycle | Rejected stale/expired commits close owned pending batches and remove staging. Read-time expiry remains independent of cleanup. Broader bounded inactivity maintenance belongs to PR 07. Unavailable ciphertext/keys fail closed; a temporary storage/key outage does not destroy a pending preview. |
| Interface | Browser parsing reads only the header for mapping discovery; server parsing/normalization is authoritative. Identity epochs protect file reads and network replies. Stable request hashes/IDs protect retries after lost replies. All draft/file/preview state stays in memory. |

**Authorization:** PR 06 implementation, synthetic local verification, repairs, commit, push and PR creation were requested. No hosted change, real data, inference, merge or PR 07 work is authorized by this packet.

## 2026-10-25: PR 05 manual measurements and deterministic Data

**Scope:** The approved M2 batch's first packet only, based on merged M1 remediation at `f4939df`. Verification and self-review are recorded in [PR 05 evidence](evidence/pr05-manual-data.md). CSV import, correction/deletion/export, persistent goals and inference remain with their owning PRs.

| Area | Decision and reason |
|---|---|
| Normalization | One normalizer accepts the eight specified metrics. Decimal.js `10.6.0` preserves decimal inputs and exact conversion factors before numeric DTO serialization. Exact percentage/integer bounds are checked before conversion can round them. No clinical ranges or automatic outlier thresholds are introduced. |
| Time | Temporal polyfill `0.5.1` rejects ambiguous/nonexistent naive local times. The API resolves unique local times; the direct mutation RPC requires an offset. Daily totals use their declared local dates; seven-day windows follow local calendar days across DST. |
| Persistence | Authenticated, ownership-checking RPCs retain direct-write denial. A profile lock serializes data mutation and revision updates. Server-only audit receipts contain normalized request IDs, request hashes, IDs/versions and historical acknowledgements, without measurement values. New source namespaces are generated rather than inferred from labels. |
| Reads | Invoker/RLS reads return PostgreSQL numeric values as text. Each page carries a revision; analytical assembly checks every page and a final snapshot. Cursors validate owner/filter/revision and the owned anchor; no extra cursor secret or authorization mechanism is introduced. |
| Interface | Recharts `3.10.1` loads separately and has a local failure boundary. Source, method, granularity and timezone remain explicit; the table preserves original units. The current slice displays canonical units and bounds chart selection to 366 complete local days. |
| Replaceability | Fixture-only canonical CSV and Health Connect weight adapters feed the same normalizer. They establish schema parity, not a parser, native permission flow, or device compatibility claim. Pure goal helpers calculate only; no goal is created or activated. |

**Authorization:** Implementation, local synthetic verification, fixes, commit, push and PR creation were requested. No provider request, deployment, hosted modification, real-data use, or PR 06 implementation was authorized or performed.

## 2026-10-25: M0/M1 independent-review remediation

**Status:** The three review repairs were authorized on a new branch from merged PR 04, with a remediation PR opened. Local reproduction, verification, and focused split-axis self-review are recorded in [remediation evidence](evidence/m0-m1-review-remediation.md).

**Decision:** Preserve merged migrations and replace `update_settings_v1` through a forward migration. Match JavaScript whitespace trimming before validation and storage while retaining Zod's existing 1–200 Unicode character contract, null handling, ownership, and transaction behavior. Use an explicit pending-logout barrier and boolean-only session assertions in browser tests. Canonicalize encryption-fixture expiry and assert exact-limit success plus the specific expansion-limit error. No production encryption or provider behavior changed.

The remediation and M1 were accepted in chat on 2026-10-25 after the repaired tests and focused review passed. [Remediation PR #5](https://github.com/edumarcano/vulpes-health/pull/5) awaits merge; acceptance does not represent completed integration. No deployment, live-resource change, provider request, or real-data use was authorized or performed. No scope deviation.

## 2026-10-24: PR 04 authenticated shell and private payloads

**Status:** Implemented within the approved PR 04 plan; checkpoint evidence and final self-review are recorded in [PR 04 evidence](evidence/pr04-auth-private-payloads.md). Local synthetic accounts only; no live provider, hosted resource, or real data.

| Area | Choice and reason |
|---|---|
| Authentication | Exact Supabase JS `2.118.0`, compatible with Node 24. Server `getUser(token)` establishes identity; ordinary reads and the settings RPC retain user-scoped RLS. No JWT-text authorization or app signup route. |
| Settings | Strict patches, profile row lock, unchanged update token and one bounded last-write receipt. Latest identical retries succeed; stale replays conflict, preventing an old acceptance from undoing revocation. No generic idempotency table or arbitrary preferences writer. |
| Consent | Current OpenRouter policy can be explicitly accepted/revoked; Google acceptance remains unavailable pending its separate region/retention decision. Neither consent nor the live flag makes inference available. |
| Browser state | Supported SDK session persistence is separate from app data. Tenant/epoch query keys, abort controllers, cache clearing and subtree remounting protect account changes; late responses are discarded even when transport ignores abort. Local sign-out does not promise immediate JWT invalidation. |
| Payloads | Native Node AES-256-GCM, gzip before encryption, random nonces, original-byte hash and authenticated owner/purpose/version/expiry metadata. Active/previous keys remain server secrets. A narrow service-role RPC checks active account state and retention before writes. No browser payload endpoint or Storage bucket. |
| Retention | Read-time expiry is independent of physical deletion. Owned opportunistic batches and the guarded local cleanup command remove expired envelopes with existing reference-clearing constraints. Other stores and hosted maintenance remain later operations work. |
| Validation repairs | Browser failures established label-association defects; real direct-RPC testing established the PostgreSQL-only `Factory` timezone gap; a failing unit test established the malformed-router error gap. Repaired without weakening the acceptance assertions. |
| Boundaries | Spending controls, editable retention, health workflows, inspector routes, export/delete and recovery remain with their owning PRs. Exact production Auth-origin CSP configuration is an explicit deployment prerequisite. |

**Approval boundary:** The owner approved implementation on a dedicated branch and opening the PR. Local dependency installation and disposable synthetic database/browser verification implement that scope. No additional product/persistence policy deviation or external activation was introduced.

## 2026-10-24: PR 03 schema and isolation foundation

**Status:** Implemented within the approved PR 03 scope; actual local database, HTTP and regression evidence is recorded in [PR 03 evidence](evidence/pr03-schema-isolation.md). No deployment, hosted database, inference or real records.

| Area | Choice and reason |
|---|---|
| Local tooling | Exact development-only Supabase CLI `2.122.0`, PostgreSQL 17, bundled pgTAP, existing Vitest and native `fetch`. No ORM, application Supabase client, additional database driver or runtime framework. |
| Access | All 15 tables enable RLS and revoke client access in the schema transaction before the grants migration. Authenticated clients receive owned reads only on 11 tables; private payloads, usage buckets/reservations and audit events remain server-only. All direct client mutations are denied. Feature RPCs will grant only their required operations. |
| Ownership | Auth-linked profiles, composite owner-parent keys, same-goal revision and same-conversation run constraints. Household budget rows have null owners and no client access; reservation keys enforce user ownership, bucket scope and original accounting month. |
| Storage | PostgreSQL `numeric` preserves measurement/money storage. Unknown usage and cost remain nullable/pending. Generated TypeScript database types are structural; later services still own exact decimal arithmetic, money-string serialization and public validation. |
| Lifecycle seams | Data revision, account deletion progress, active-run uniqueness and budget allocations live in existing specified tables. Goal revisions deny service-role UPDATE. Payload deletion clears nullable references without clearing ownership. Business transitions, deletion coordination and accounting transactions remain deferred. |
| Configuration correction | CLI `2.122.0` maps `auth.email.enable_signup=false` to a disabled email provider, causing real password login to fail with `email_provider_disabled`. Keep that field true and global `auth.enable_signup=false`. Real provisioned-user login and denied public signup both pass. This corrects a configuration detail of the approved plan without changing the private-account policy. |
| Default grants | PostgreSQL's built-in function `PUBLIC EXECUTE` default must be revoked globally for the migration role; schema-local revocation cannot subtract it. A reproduced future-function test failed before the correction and passes afterward. Existing managed functions and other migration roles are unchanged. |
| Host networking | Docker Desktop still exposed the synthetic ports through non-loopback addresses with the documented custom bridge option. Removed that ineffective workaround, documented the host limitation and stopped the stack after verification. No global Docker/firewall modification or custom container runtime was introduced. |
| Scope boundary | The schema stores encrypted envelopes but implements no encryption/decryption, authenticated app route or business RPC. Synthetic envelope bytes prove ownership/reference behavior only. PR 04 owns application auth, consent and encrypted payload behavior. |

**Approval boundary:** The owner approved PR 03 implementation and PR publication, installed Docker Desktop, and authorized real local Supabase tests. No cloud resource, provider activation, real-data use or system installation by the implementation agent was authorized or performed.

## 2026-10-24: PR 02 contracts and offline replaceability

**Status:** Implemented within the approved PR 02 scope; local evidence and review outcomes are recorded in [PR 02 evidence](evidence/pr02-contracts.md). No live provider request, deployment, or activation.

| Area | Choice and reason |
|---|---|
| Contract coverage | The owner selected fully specified contracts during planning. Implement complete DTOs, SSE, envelopes, chat send, approval, and import commit; inventory every route/action. Return `not_implemented` for incomplete operation payloads. Reject unfinished revision/state proposals and cards until PR 11 defines them. No arbitrary-object success schemas. |
| Schema dependency and CSP | Promote the already locked Zod `4.6.7` to an exact direct dependency. Disable its JIT/eval probe before constructing shared schemas: the first browser run reproduced ten production-CSP violations. Preserve `script-src 'self'`; the same browser checks pass after the repair. |
| Provider boundary | Generation, typed decision scoring, and normalized usage have separate contracts. Synthetic transports remain in the test/tool graph; no provider SDK, real HTTP transport, or orchestration framework is introduced. Fixtures establish the normalized protocol, not vendor wire compatibility. |
| Usage and continuation | Preserve nullable unknown usage, raw usage, and reasoning/cache subset metadata without money arithmetic. Keep continuation JSON tagged to its API family and tool call/result IDs matched. No provider state is exposed through public liveness. |
| Catalog and availability | Keep approved identities, effort controls, ceilings, and required privacy policies in one typed server-side catalog. Prices remain unverified/null and live smokes `not_run`; configuration intent never makes a role available. Decision scoring remains disabled. |
| Smoke safety | Synthetic mode does not inspect credentials. Live mode checks explicit role/spend inputs and the global switch, then always denies because required services/transports are absent. Full opt-in cannot activate inference in PR 02. |

**Approval boundary:** These choices implement the approved plan. They do not approve provider substitution, prices, Google region/retention, real-data use, or inference. No approved scope deviation.

## 2026-10-24: PR 01 application foundation

**Status:** Implemented within the approved PR 01 plan; local verification is recorded in [PR 01 evidence](evidence/pr01-foundation.md). No deployment or inference activation.

**Decisions:**

| Area | Choice and reason |
|---|---|
| Runtime | Node 24 (`24.15.0` tested), npm `11.18.0`, exact direct dependency pins and npm lockfile. TypeScript `6.0.3` satisfies typescript-eslint `8.72.0`'s `<6.1` peer range; the latest TypeScript 7 was not compatible. |
| UI dependencies | React `19.3.1`, Vite `8.3.5`, React Router `7.18.4`, TanStack Query `5.104.5`, assistant-ui `0.15.31`, Tailwind `4.3.3`, adapted shadcn Button/Card source, and Lucide. Chart/animation/provider/database packages remain deferred. |
| Local runtime | A loopback Node HTTP runner executes the same thin API handler as Vercel. Vite proxies API traffic; concurrently supervises the two processes. API changes require a restart so startup failures propagate instead of leaving a watcher alive. No application server framework or cloud credentials are needed. |
| API scope | Public liveness only. The status entry point also handles the hosting rewrite's unmatched-API discriminator, preserving JSON errors without an extra deployed function. Add future named API routes ahead of the fallback. |
| Configuration | Parse the live switch strictly, but keep inference unavailable even when requested. No provider transport, runtime model registry, or model environment overrides are introduced. |
| CSP | Production scripts and connections are same-origin; component inline styles are allowed. Development additionally permits Vite's inline refresh script and loopback HMR WebSocket. Test the production policy through the built preview. |
| Branding | Use approved PNGs without cropping/recoloring. Dark text accents use the lighter semantic focus-color derivative after the initial orange-on-muted navigation measured 3.80:1 contrast. Logo and button colors are preserved. |

**Verification:** Vitest exercises the actual Node HTTP handler and Vite's disconnected-proxy response; Playwright checks the built shell. No persistence or authenticated provider support is claimed. See the evidence record for exact commands, fixes, screenshots, and remaining gates.

## 2026-10-19: Typed model catalog, minimal deployment environment

**Status:** Approved baseline; integrated into canonical specifications ([`DECISIONS.md`](spec/v0.1.0/DECISIONS.md#d08---models-and-typed-catalog), [`PROVIDER_SETUP.md`](spec/v0.1.0/PROVIDER_SETUP.md), and [`ARCHITECTURE.md`](spec/v0.1.0/ARCHITECTURE.md)).

**Decision:** Server-side model identities, provider adapters, model-specific reasoning, token limits and routing defaults are version-controlled in one typed catalog (`server/config/models.ts`), not duplicated in `.env` and runtime JSON. Secrets/deployment identity and a fail-closed AI enable switch remain in the environment. Use one capability-aware gateway and provider-specific adapters. Model changes are independently testable and require approval before live activation.

**Reason:** Prevent configuration drift and make monthly model evaluations practical without modifying domain or agent code.

## 2026-10-19: Ask Vulpes, language policy, modularity, repository housekeeping

**Status:** Approved baseline; integrated into canonical specifications ([`PRODUCT_SPEC.md`](spec/v0.1.0/PRODUCT_SPEC.md), [`DECISIONS.md`](spec/v0.1.0/DECISIONS.md), [`ARCHITECTURE.md`](spec/v0.1.0/ARCHITECTURE.md), [`UI_SPEC.md`](spec/v0.1.0/UI_SPEC.md), and [`ACCEPTANCE_TESTS.md`](spec/v0.1.0/ACCEPTANCE_TESTS.md)).

**Decision:** Main AI experience is **Ask Vulpes**, compact tab **Ask**, route `/ask`. Build the v0.1.0 client and backend in strict TypeScript, SQL for migrations, Kotlin later if needed for Android; a future Python analytics service is permitted when justified by validated scientific requirements but must remain behind a stable contract. Enforce replaceability tests for generation/decision providers and measurement-source adapters. Consolidate specifications directly into the canonical documentation and remove obsolete starter-package artifacts.

**Reason:** Align interface naming with Vulpes branding, maintain a one-language MVP, enable frequent model swaps, avoid unnecessary root-level documentation and maintain a clean, unified documentation baseline.

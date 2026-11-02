# Owner-data operational readiness

This packet follows the owner's confirmation of the private import preview. It prepares the existing backup, deletion-journal and maintenance boundaries for one explicitly named owner, without adding metrics, native connectors, UI polish or a provider. No private export, measurement, filename, key or personal path belongs in this evidence.

## Bounded sequence

| Checkpoint | Required proof |
|---|---|
| Typed scope and offline guards | Separate `owner-pilot` recovery target: exact existing source/origin/region, one owner UUID and at most one synthetic isolation peer. Explicit matching CLI flag, target hash and purpose-bound approval. Existing hosting/synthetic defaults remain strict. |
| Capture, replay and maintenance | Same verified TLS, encrypted/create-only archives, trace-key verification, independent complete journal, conservative accounting and isolated/stopped restore. Source identity inventory refuses unknown users and non-synthetic peers. Missing identities require completed deletion receipts; deleted identities cannot silently reappear. Owner maintenance targets only the named owner and cannot initiate deletion, reset passwords, refill budgets or call models. |
| Historical compatibility and native verification | Original synthetic archive/journal purposes/hashes remain readable. Real PostgreSQL synthetic fixtures prove the owner marker blocks synthetic capture and that explicit owner CLI restoration preserves schema/rows/keys and stays network-none/stopped. No real measurements enter tests. |
| Reviewed PR and operator checkpoint | Complete strict checks and both self-review axes; open a dependent focused PR without merging. Before any hosted owner-data import, identify the owner's data scope explicitly, establish current encrypted recovery/accounting and independent copy custody, and reconcile applicable acceptance. No restore access or family invitation is included. |

The server-controlled Auth `app_metadata.vulpes_data_scope=owner-pilot` marker distinguishes real-owner use from an email address that still ends in `example.invalid`. Existing synthetic modes reject that marker. The operator must set and verify it before the first hosted owner-data preview/import; a filename or email suffix is not permission to treat real records as synthetic.

Owner-mode recovery does not run synthetic HTTP fixture services with owner credentials. Native restoration remains fenced, current deletion/accounting evidence is required for replay, and missing source-loss/cutover completeness continues to block restored access. Previous synthetic Auth/API recovery evidence is retained with its original scope; it does not establish a new owner-data Auth/API result.

## Verification status

Preparation is on `feat/owner-pilot-data-recovery`, based on PR #33 at `8937bf5`. The [operator procedure](../operations/owner-pilot-data.md) defines the explicit mode and pre-import checkpoint.

| Verification | Actual result |
|---|---|
| Offline suite | All 485 units across 41 files passed, including 86 affected owner/synthetic recovery, journal, replay and maintenance cases. |
| Native archive and restore | Both database tests and the existing replay test passed in the guarded `vulpes-health-step4-test` stack (35421/35422), without resetting retained data. The new marked-owner test uses synthetic records: synthetic capture refuses before dump; owner capture and actual private-stdin CLI restore preserve catalog/rows/keys, remain network-none with zero ports and stop the container. Historical synthetic proof remains intact. |
| Journal and maintenance | Nine cases across journal/maintenance files passed after the journal fixture's Auth metadata column was updated. Owner maintenance exercised actual local Auth/RPC: inspect made no writes; one bounded execute removed exactly one expired synthetic payload and preserved the peer. The extended native journal case also passed: marked owner capture, missing-owner rejection without completion, and successful journal capture after completed deletion. |
| Strict checks and CLI | Full strict typecheck and lint passed. An intermediate readonly-array annotation in the new test was corrected without changing runtime behavior. All three actual `--plan --owner-pilot` interfaces returned zero requests; the owner database plan was corrected to state that HTTP fixtures remain synthetic-only. |
| Final artifact and documentation | Production build passed, with the existing client chunk-size warning. Specification validation passed 533 checks; relative-link validation passed 208 links across 13 documents. After the final plan-text correction, all 14 focused owner-recovery units passed and the actual database CLI plan reported zero network requests/source writes and explicitly blocked owner HTTP fixtures and restored access. |

The first native run passed three of four cases; the journal case failed because its minimal Auth table lacked `raw_app_meta_data`, now used by the explicit classification guard. Its fixture was brought into agreement with the real Auth schema; no production query or safety assertion was weakened. Native fixtures and restored containers were removed by their existing owned cleanup. The guarded source stack was stopped with volumes retained.

Split-axis self-review inspected the actual source/new files and changed callers against `8937bf5`. **Axis 1: approved for operational preparation.** Owner/default purpose separation, exact identity inventory, completed-deletion proof, conservative accounting, historical readers and stopped restores are protected by executable tests. Hosted execution/ciphertext handoff and all actual owner-data persistence remain unverified. **Axis 2: approved.** A narrow shared recovery target/policy boundary reuses capture, archive, replay and maintenance engines without broadening hosting defaults or launching owner credentials in test services. No migration, dependency, provider/catalog change, private-data fixture or UI work was introduced.

No hosted configuration/source mutation, deployment, provider call, private-data test or paid spending has occurred in this preparation. The next checkpoint uses the existing approved source/resources and verified key custody for current encrypted capture/rehearsal, followed by owner-controlled ciphertext copy/readback. Existing PRs remain open and unmerged.

## Hosted recovery checkpoint (2026-11-02)

The owner requested continuation until actual manual intervention. PR [#34](https://github.com/edumarcano/vulpes-health/pull/34), candidate `4eb4aca`, remains open and unmerged. Both required jobs, **Fast checks** and **Integration checks**, passed in [run 41499354000](https://github.com/edumarcano/vulpes-health/actions/runs/41499354000). This includes the public-bundle canaries, native integration/recovery checks, browser suite and PWA privacy proof. Source classification/capture used the locally verified operator while unrelated CI browser checks were finishing; the full run completed successfully before hosted-source recovery.

The private operator plan binds that exact candidate, existing project/origin/region, confirmed owner and synthetic peer, pinned cached image, eight-hour expiry and `$0` maximum paid spending. Strict helper typecheck passed before execution. Existing Proton Pass readback custody matched the exact retained backup/journal/trace key package; no new credential or key handoff was required. Secrets stayed in DPAPI/private stdin, with fixed-target requests and safe failure output.

| Actual interface | Observed result |
|---|---|
| Read-only preflight | Two expected identities/profiles, 39 migrations, nine completed deletion receipts, no unfinished request/active run, empty Storage. Native PostgreSQL TLS/CA/hostname verification passed; inventory covered 55 tables and one currently used trace-key version. |
| Owner classification | Only the exact owner's server-controlled Auth data-scope marker was set to `owner-pilot`; existing metadata was preserved. The synthetic peer and all accounting fingerprints matched before/after. No profile, measurement, budget, consent or goal was changed. |
| Stable encrypted capture | Actual explicit owner-mode database command authenticated/encrypted a current schema/row/key snapshot into a new create-only archive. Source stability checks passed. No source database writes. |
| Journal and fenced recovery | Two actual journal captures each covered nine receipts. Database archive authentication, catalog/rows/keys, nine replayed deletions, unaffected/shared rows, SQL RLS for two profiles, seven old-session denials and current source accounting/journal comparison passed. Seven restored sessions and eight restored refresh tokens were removed; none remained. |
| Postcheck | At `2026-11-02T18:32:16.582Z`, the fresh destination was stopped, network none, zero published ports, no host binds or privileged mode. Source peer/accounting fingerprints still matched; no hosted source overwrite or restored access. |
| Ciphertext package | Three encrypted files were bundled into one new upload ZIP. Exact member allowlist, sizes and SHA-256 readback passed locally. It contains no keys, private manifests or raw export. Independent Drive upload/download verification is pending; local packaging is not off-machine custody proof. |

The only hosted mutation was the exact owner's classification marker. Existing Supabase Free/Vercel Hobby resources were used without deployment, schema change, provider call, new paid usage or real-data import. No private file contents, measurements, identity inventory or credentials enter this evidence or CI.

Split-axis self-review of this execution/evidence update found no blocking defect: **Axis 1 approved for this checkpoint**, with the manual copy and applicable acceptance still open; **Axis 2 approved**, with source binding, historical evidence and confidential artifacts preserved. This is self-review, not independent milestone acceptance. Owner-mode actual Auth/API service proof, source-loss/cutover completeness and restored-access approval remain unverified; earlier synthetic proof is not promoted. The owner must upload the prepared ciphertext package to the existing restricted Drive folder and download it for byte/hash verification before the import checkpoint. Copying will not renew the journals' five-minute validity.

For this documentation update, specification validation passed all 533 checks, relative-file-link validation passed 214 links across 13 documents, and `git diff --check` passed. No runtime code changed after the verified recovery candidate.

## Copy verification, acceptance reconciliation and first import (2026-11-02)

After the owner reported downloading the Drive folder, the nested pre-import package matched its exact local SHA-256 and all three encrypted members. All five older encrypted files in that download also matched. The existing restricted-folder/Google MFA and independently verified Proton Pass custody remain owner-attested; no keys were included in the package. Copying did not renew journal freshness. Both required CI jobs also passed for documentation candidate `4653792` in [run 41501978903](https://github.com/edumarcano/vulpes-health/actions/runs/41501978903).

### Personal-pilot P0 evidence

All 52 canonical P0 IDs have passing local scope in the historical [release report](release/m6-local.json). Current CI re-exercised the ordinary unit, database, integration, browser, bundle, synthetic accounting/provider and PWA gates. Git comparison found no application/schema differences between deployed runtime `e296c9e` and `4653792` across `src`, `server`, `shared`, `api` and `supabase`. The historical report remains unchanged; its six external P0 gaps are supplemented below, rather than silently relabeling an old report as current.

| P0 IDs | Supporting evidence and limits |
|---|---|
| SEC-01–SEC-07 | Current synthetic CI plus [hosted security](owner-pilot-step3d.md) and [normal hosted execution isolation/privacy](owner-pilot-step4.md). Covers recorded ownership, parent, bundle, injection, consent and switching cases. |
| SEC-08 | [Final hosted runtime checkpoint](owner-pilot-step4.md#final-hosted-repair-checkpoint-2026-11-02): production aliases, deep links, JSON API routing, headers/CSP and public-file canaries. Clears the old report's hosting gap for this deployment. |
| DATA-01–DATA-15 | Current CSV/manual/measurement lifecycle, numerical/DST and browser regressions; private source/profile/timezone confirmation and exact normalization/readback supplement the selected first import. No native vendor connector is claimed. |
| GOAL-01–GOAL-05 | Current goal transaction/progress regressions and [bounded live E05](luna-owner-pilot-live.md). The actual hosted proposal stayed pending; no real goal activation was performed. |
| AI-01–AI-05 | [Current v7 live evaluation](luna-owner-pilot-live.md): E01 missing data, E02 unavailable index, E07 unsafe target, E08 association/causality and E04 unavailable research. These bounded host-reviewed cases clear the older v4 evidence gaps, not general clinical safety. |
| AI-06 | Current typed-tool/foreign-owner rejection tests and hosted denial evidence; no permission delegated to model output. |
| COST-01–COST-07 | Current admission/ledger/usage/replay controls plus bounded live/hosted cancellation and retained uncertain holds. Import/readback made no model request; no automatic retry, free settlement, cap reset or fallback was introduced. |
| TRACE-01–TRACE-04 | Current exact-capture/failure-gate tests plus [hosted exact-input verification](owner-pilot-step4.md). Earlier payload availability is dated proof; the explicitly approved cleanup below removes those live payloads. |
| OPS-01 | Current static-shell PWA/privacy test, hosted checks and the owner's Galaxy S23 installation/airplane-mode report. |
| MOD-01–MOD-06 | Current offline adapter/dependency/normalized-data/provider-disabled regressions. Flash/Argon/decision remain separately unavailable. |

This is technical reconciliation under the standing authorization for personal-owner activation/use, not independent sign-off on outstanding milestone/release reviews. No P0 is waived or passed from approval alone. TalkBack/UI-03 remains the owner's explicit P1 personal-pilot exception; broader release/family acceptance is not established.

### Approved cleanup and normal owned import

Read-only inspection bound exactly seven known synthetic observations and one known pending synthetic goal. The actual measurement-delete contract also removes all account AI trace payloads. Before any deletion, the owner explicitly approved that consequence: 142 live payloads across eight saved runs, with conversation text/financial records retained and pre-cleanup encrypted copies preserved. The normal owned APIs then rejected only the test proposal and removed only those readings/payloads. No active goal or conversation text was deleted.

The confirmed private file was imported through ordinary hosted preview/commit after original/prepared file-hash binding and exact comparison against the locally confirmed rows. Only the confirmed profile timezone changed to `America/New_York`; units and provider consents were preserved. Actual stored original decimals/units, canonical values, timestamps, offsets, timezone and methods matched privately. Commit replay returned the same result; repeating the file returned its historical committed batch without additional observations. Deterministic summaries matched latest observations and honestly reported insufficient coverage/comparison. A real second-account probe received API 404 and zero direct RLS rows for the imported source.

Two private verifier assumptions failed and were corrected without changing application code or re-importing: matching null vendor IDs without timestamps selected the wrong row; expecting new duplicate classifications contradicted the API's original committed counts/historical-result contract. Read-only field-match diagnostics proved the stored data were correct. Final exact readback, historical-result/unchanged-row-count, sparse-summary, foreign-denial and financial-preservation checks passed. Failures remain in private operation evidence; no real reading became a fixture, screenshot or test input.

Whole financial bucket/reservation/allocation fingerprints, run financial fields/status and generation counts stayed unchanged through cleanup/import/verification. The isolation peer's product rows matched; probe sessions were individually signed out. New generation requests/spending: **0 / $0**. The selected file's contents, paths, identities, counts, timestamps and hashes remain outside Git. The existing deployed runtime and provider/model configuration were unchanged.

### Post-import recovery and next manual checkpoint

A separate create-only operator plan on `4653792` captured the post-import state with the existing verified keys. Native TLS inventory, stable encrypted archive, two fresh complete journals, catalog/row/key comparison, nine deletion replays, seven old-session denials, restored-session/refresh revocation, two-profile SQL RLS and current accounting passed. No owner credentials were launched in synthetic Auth/API services. After verifying the network-none/zero-port destination was stopped, only that newly owned local container was removed to avoid retaining a needless plaintext restored copy; encrypted archives were preserved. This is not a physical-erasure guarantee or restored-access approval.

The three post-import encrypted archives passed exact local ZIP member/hash readback. Their new independent Drive copy is **pending**; the verified pre-import package does not contain the subsequently imported health records. No new keys, deployment, provider request, infrastructure cost or automatic merge was introduced. The remaining manual checkpoint combines the owner's upload/download of this ciphertext-only package with checking the actual imported Data view on the phone. A private script-free local guide supplies exact date/filter settings. A first real-data Ask question is optional, provider-visible and budgeted; the agent has made none. Full release, independent acceptance, family onboarding and any restored access remain separately gated.

Both self-review axes approve this bounded operational/evidence packet with the named human checks still pending: exact source/file/owner/request bindings and the explicit consequential cleanup decision were enforced; application behavior and financial records were preserved; private source content and credentials remained excluded from Git/CI. Strict operator typechecks passed. Documentation verification passed 536 specification/fixture checks, 226 relative file links across 13 documents and `git diff --check`. These results do not claim the owner's imported-data UI check or independent release acceptance.

## Owner handoff completed (2026-11-02)

The owner reported the post-import package downloaded, weight and body fat matching the source, and a successful first real Ask question that correctly identified insufficient data for the seven-day mean. This accepts the reported Data/Ask workflow on the previously identified Galaxy S23; it does not establish general response quality, full accessibility or release/family acceptance. The agent did not inspect the question, answer, trace bodies or health values in this closeout.

The downloaded Drive folder contained exactly the post-import upload package: its byte count/SHA-256 and all three encrypted members matched the verified local originals. Six earlier encrypted copies also matched. No keys were included; the existing restricted-folder/MFA and Proton Pass custody attestations remain in force. The backup covers the post-import capture point before the subsequent real Ask; copying does not make it continuously current or renew journal freshness.

Both **Fast checks** and **Integration checks** passed for `dfec415` in [run 41510252769](https://github.com/edumarcano/vulpes-health/actions/runs/41510252769). Read-only accounting at `2026-11-02T19:48:45.386Z` found the new owner-initiated run completed with reported cost **$0.000567490**. Both app/account allocations remain `$0.10`, reported spend `$0.003439865`, reserved `$0.0093192` and available `$0.087240935`. There are nine saved runs, no active run/goal, no unfinished deletion and no Storage object. Existing uncertain holds were not reset/released. The agent made no new generation request, source mutation, deployment or paid call in this confirmation.

The bounded personal-owner import/use/recovery handoff is complete: technical P0 reconciliation, explicit consequential cleanup approval, exact normal import, current-source recovery, independently verified encrypted copy and owner-reported real Data/Ask use are recorded. No further setup action is required for that agreed scope. PR #34 remains open/unmerged; required final-head CI and independent review still gate merging, while full-release/formal milestone reviews, family onboarding, optional models and restored-access/cutover authority remain separate. Manual backup rotation and fresh journal checks remain operating duties, with no scheduler or physical-erasure guarantee.

Both self-review axes approve this evidence-only closeout for the bounded owner-pilot scope: current observations and owner reports are distinguished, no private content is published, and no historical failure or outstanding broader gate is relabeled as passed.

Closeout documentation checks passed: 536 specification/fixture checks, 228 relative file links across 13 documents and `git diff --check`. No application code changed after the previously verified candidate.

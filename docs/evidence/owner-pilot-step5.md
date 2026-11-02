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

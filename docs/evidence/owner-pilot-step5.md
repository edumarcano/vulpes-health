# Owner-data operational readiness

This dated evidence records the bounded owner-pilot preparation and hosted handoff completed on 2026-11-02. It is not a current backup inventory or an independent release approval. The [operator procedure](../operations/owner-pilot-data.md) and [recovery runbook](../operations/hosted-recovery.md) own current operating requirements.

## Accounting evidence correction

The original accounting fingerprint query selected the wrong XML root and ignored row fingerprints, so historical `currentAccountingMatched` results did not establish freshness. Corrected code and synthetic regressions address the defect; operational reliance still requires corrected reconciliation with a fresh independent journal. See [accounting reconciliation](../operations/hosted-recovery.md#accounting-reconciliation).

## Scope and safeguards

| Boundary | Implemented protection |
|---|---|
| Owner and synthetic separation | Explicit `owner-pilot` manifests, purpose-bound approval and the server-controlled `app_metadata.vulpes_data_scope=owner-pilot` marker. Synthetic modes reject the marked owner; email suffixes do not classify records as synthetic. |
| Capture and maintenance | Verified TLS, create-only encrypted archives, trace-key verification, complete independent journals and conservative accounting. Maintenance cannot initiate deletion, reset passwords, replenish budgets or call models. |
| Fenced restoration | Deletion replay, ownership isolation and accounting reconciliation precede any access decision. The local destination remains isolated and stopped; restoration does not authorize hosted access or cutover. |
| Private verification | Real source records, credentials and trace bodies stay outside Git, screenshots and test fixtures. Owner credentials are not launched in synthetic Auth/API fixture services. |

## Preparation and synthetic verification

Preparation used PR #33 at `8937bf5` as its base. The recorded results were:

| Check | Recorded result |
|---|---|
| Unit coverage | 485 tests across 41 files passed, including 86 affected owner/synthetic recovery, journal, replay and maintenance cases. |
| Native archive and restore | Synthetic PostgreSQL fixtures demonstrated owner classification, historical archive compatibility, catalog/row/key preservation and a network-isolated, stopped destination. |
| Journal and maintenance | Completed-deletion receipts protected missing identities; bounded cleanup preserved an unaffected peer. A fixture missing Auth metadata initially failed and was corrected to match the real schema. |
| Static and command checks | Strict typecheck, lint and production build passed. All three owner-mode planning interfaces reported zero requests. The existing client chunk-size warning remained. |
| Documentation | Preparation validation passed 533 specification/fixture checks and 208 relative file links. |

These are recorded preparation results, not checks rerun by this summary. Split-axis self-review covered requirements and engineering boundaries; it was not independent milestone acceptance.

## Hosted recovery checkpoint

Candidate `4eb4aca` passed the then-required **Fast checks** and **Integration checks** in [run 41499354000](https://github.com/edumarcano/vulpes-health/actions/runs/41499354000). The bound owner-mode checkpoint verified native PostgreSQL TLS, stable encrypted capture, fresh journal capture, deletion replay, catalog/row/key preservation, SQL ownership isolation, session revocation and source-accounting comparison. The isolated restore destination was stopped after verification.

The only hosted mutation in that recovery checkpoint was the approved data-scope classification marker. Capture made no source database writes; no deployment, schema change, provider request or new paid usage was introduced. Independent-copy verification was pending at this checkpoint and completed later in the handoff.

## Import integrity and acceptance reconciliation

Explicit approval preceded cleanup through the normal owned APIs, including its trace-payload deletion consequence. Verification preserved conversation text, financial records, existing consents and the unaffected peer. Ordinary preview/commit then demonstrated private source matching, normalization/readback, commit replay and historical-result idempotency without additional observations. Deterministic summaries respected insufficient-coverage and comparison boundaries.

Two private verifier assumptions initially failed: matching null vendor IDs without timestamps selected the wrong row, and expecting new duplicate classifications contradicted the historical-result API contract. Corrected read-only diagnostics established the stored data were correct; no application change or repeated import was used to hide either failure. Financial fingerprints and generation counts remained unchanged through cleanup, import and verification.

The checkpoint reconciled technical evidence for the canonical P0 families against the [historical local release report](release/m6-local.json), [hosted/provider evidence](luna-owner-pilot-live.md) and [device evidence](owner-pilot-step4.md). It did not waive a P0 or turn owner authorization into a passing test. The recorded accessibility exception applied only to the bounded personal pilot, not broader release or family acceptance.

## Post-import recovery and handoff

A separate operator plan on `4653792` captured the post-import state. Fresh journal/accounting comparison, encrypted archive authentication, catalog/row/key comparison, deletion replay, ownership isolation and restored-session revocation passed. The newly owned local restore container was removed only after isolation and stopped-state checks; encrypted archives were retained. This was not a physical-erasure guarantee or restored-access approval.

Independent-copy readback matched the encrypted package and its members to the verified originals; no keys were bundled. Owner-reported Data/Ask workflow acceptance was recorded separately from automated and operator checks. The closeout did not inspect private question, answer or trace bodies, and did not establish general response quality or clinical safety.

The snapshot predates later conversations. Copying it does not make it continuously current or renew journal freshness. Manual backup rotation and fresh recovery evidence remain required.

For `dfec415`, both then-required CI jobs passed in [run 41510252769](https://github.com/edumarcano/vulpes-health/actions/runs/41510252769). Final closeout documentation checks passed 536 specification/fixture checks, 228 relative file links and `git diff --check`; no application code changed after the verified candidate.

## Remaining limits

Owner-mode Auth/API service proof and source-loss/cutover completeness remained unverified. Full release, independent milestone acceptance, broader accessibility, family onboarding, optional models and restored-access authority remained separate gates. The handoff established no scheduler or physical-erasure guarantee. Follow [release readiness](../operations/release-readiness.md) for current gates rather than interpreting this dated record as a current attestation.

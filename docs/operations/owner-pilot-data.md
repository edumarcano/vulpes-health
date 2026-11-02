# Owner-data import and operational checkpoint

The owner confirmed the private local import preview. The original export and prepared readings stay outside Git; no hosted preview/import or real-data inference is implied. Supported metrics remain those in `shared/data.ts`. This packet changes operator safety boundaries, not the measurement registry, UI or provider catalog.

## Explicit owner mode

| Control | Requirement |
|---|---|
| Target | A separate strict recovery manifest uses `purpose: owner-pilot`, one `ownerUserId` and at most one `syntheticPeerUserIds` entry. Existing project/origin/region checks and separate-destination constraint remain. |
| Command | `--owner-pilot` must match that manifest. Without it, owner manifests are refused before credentials/network/Docker. Synthetic defaults and historical target hashes remain unchanged. |
| Approval | Private, purpose-specific capture/restore/journal/maintenance authorization binds the target hash, exact output/connection or encrypted archive/image, mode and expiry (at most 24 hours). Broad owner approval does not remove these executable bindings. |
| Classification | Before the first hosted owner-data preview/import, set and verify server-controlled Auth `app_metadata.vulpes_data_scope=owner-pilot` for the exact confirmed owner. Email suffix alone is not evidence of synthetic data. Synthetic recovery/maintenance reject the marked owner even with an `example.invalid` email. |
| Source inventory | Database/journal capture accepts only the named owner and declared synthetic peer. Missing identities need completed deletion receipts; a completed identity cannot silently reappear. A real peer or unknown identity stops capture. Storage must remain empty. |
| Confidentiality | Existing verified TLS, private stdin credentials, retained backup/journal/trace keys, AES-GCM encryption, create-only output and 30-day maximum database-backup retention remain. Reports expose aggregates/hashes rather than rows, prompts or credentials. |
| Restore | Fresh local cached-image container, network none, no published ports/bind mounts, stopped after verification. Replay requires a fresh complete journal, session revocation and matching current accounting. No access-enable command or source-loss completeness guarantee. |
| Maintenance | Explicitly names only the owner; inspect is the default. Execute is bounded and uses the existing service-only RPC. No new deletion request, password reset, budget refill or provider request. |

The classification marker is an operator action, not a client preference. Verify the source identity and preserve existing Auth metadata before setting it; do not mark the isolation peer. Keep all prior spent/reserved balances. An unsuccessful capture does not authorize relabeling data as synthetic, widening the allowlist or overwriting an archive.

Historical synthetic archives and journals retain their original purposes and hashes. Older database archives lack the new identity metadata; restore comparison handles only those absent metadata fields while preserving schema, grants, RLS, rows, keys and synthetic source checks. Owner archives cannot be downgraded to synthetic mode.

`--verify-http` remains a synthetic-fixture option. Owner mode does not launch test Auth/API services with owner credentials, and cannot claim that proof. Current restored access stays blocked; the earlier synthetic Auth/API rehearsal remains separately dated evidence.

## Verification without private data

These commands print inert plans and require no credentials:

```sh
npm run recovery:database -- --plan --owner-pilot
npm run recovery:journal -- --plan --owner-pilot
npm run maintenance:hosted -- --plan --owner-pilot
```

Run operational regressions only against the guarded disposable local stack using synthetic fixtures. No actual export, real reading or owner credential belongs in a test, fixture, screenshot or CI environment. [Step 5 evidence](../evidence/owner-pilot-step5.md) owns actual command results and failures.

## Before first hosted persistence

1. Verify the reviewed candidate, current explicit authorization and exact source/owner identity. Reconcile applicable P0/formal acceptance; UI polish and the owner's TalkBack exception do not waive a P0.
2. Record the owner marker and obtain a stable encrypted database capture. Reuse existing owner-verified key custody only if its exact retained key package still matches; do not invent a new custody attestation. Never reset budgets or uncertain holds to obtain a green result.
3. Capture an independent complete deletion journal, rehearse fenced restore/replay/current accounting, and retain the stopped destination and safe results. Source changes, missing keys, stale journal or unresolved accounting leave access blocked. Copy verification does not renew journal freshness.
4. Put the new ciphertext in the already approved private off-machine location and verify downloaded sizes/hashes. Never upload raw exports, unencrypted dumps, keys or private manifests. The owner still controls Google Drive and Proton Pass; no new service/payment is required.
5. Identify exact synthetic fixture cleanup separately from real readings; preserve execution accounting and deletion evidence. Then prepare the explicit source/profile/units/timezone mapping and owned import preview/commit. Importing/inspecting data must make no model call. A first real Ask request, if used later, remains separately visible and budgeted.

Future retention runs and backup rotation must use the owner manifest/current operator code. Closed Step 3 rehearsal plans and old synthetic-only command revisions are not owner-data procedures. Family identities, invitations, native connectors, new metrics and automatic restore access remain outside this packet.

## Current checkpoint

The [first-import checkpoint](../evidence/owner-pilot-step5.md#copy-verification-acceptance-reconciliation-and-first-import-2026-11-02) completed the pre-import Drive readback and reconciled all 52 P0 technical criteria with current CI/live/hosted evidence. After explicit approval of the broader trace-removal effect, the known synthetic readings/proposal were removed through owned APIs. The confirmed private dataset was imported and verified for exact values, original units, timestamp offsets, methods, idempotency, sparse coverage and foreign-account denial. Financial records/holds and the peer's product rows stayed unchanged; no real-data AI request was made.

Post-import encrypted capture and fenced recovery also passed with the existing independently verified keys. The restored local destination was stopped and removed after proof; access remains unauthorized. Its three encrypted archives passed local ZIP readback, but their independent Drive copy is pending. The already verified pre-import copy preserves the earlier state; it does not cover the new records.

The owner must upload/download the new ciphertext-only package through the existing restricted Drive folder and check the imported Data view on the phone. The agent verifies the downloaded bytes/hash and three encrypted members against the private inventory. Use Source `RENPHO Health`, Method `Device reported` for weight or `Device estimate` for body fat, Granularity `Instant reading` and the confirmed timezone/date range. A private local guide supplies dates without publishing them. Keep raw exports, keys, passwords and private manifests out of Drive. Copy verification does not renew journal freshness or establish formal release acceptance.

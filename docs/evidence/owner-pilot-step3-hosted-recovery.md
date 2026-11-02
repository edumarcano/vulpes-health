# Approved hosted-source recovery rehearsal

Executed 2026-11-01 America/New_York (2026-11-02 UTC). Source: the approved synthetic Free Supabase project `vatwmqzjymbhaodwatyn`, `us-east-1`. The owner approved the grouped $0 rehearsal, four disposable synthetic identities, encrypted local outputs, private Google Drive copies and Proton Pass custody. No deployment, inference, real data, unrelated project access or automatic merge was authorized or performed.

The implementation baseline is PR #32 at `5435567a0339e4e5ac83459542019155881dbeb4`, plus the reproduced timestamp repair below. The operator adapter binds the exact source/manifest, frozen baseline, owner-approved batch, protected custody fingerprint and preallocated account IDs. Existing original accounts, budgets and historical receipts are excluded from fixture mutation. Raw credentials, Auth records, encrypted archives and private diagnostics remain ignored/private.

## Actual execution

| Checkpoint | Observed result |
|---|---|
| Key custody | Owner saved and reopened the key package in Proton Pass. Protected readback receipt matches batch, package SHA-256 and all four keys: backup, journal, current trace and retained synthetic trace version. Google/Proton 2FA and restricted Drive folder are owner-attested. |
| Read-only source preflight | Two original Auth users/profiles, three completed receipts, no unfinished requests, empty Storage, exact 39-migration source history and no fixture conflicts. Native connection used the source-bound session pooler on 5432 with password, CA and `sslmode=verify-full`; schema/table inventory passed. |
| New fixtures | Four preallocated `.invalid` Auth identities were created with batch ownership metadata and create-only local receipts. Each received a profile, conversation, real encrypted synthetic trace and password sign-in. Both trace-key versions were exercised. No provider consent, positive budgets or AI transport was installed. |
| Database capture | Read-only native capture matched its before/after source snapshots, inventoried 55 selected-schema tables and decrypted both present trace-key versions. A 1,800,280-byte AES-256-GCM archive was written create-only without a plaintext dump. |
| Post-backup deletion | Existing product deletion fenced A and B. Existing bounded continuation completed A, while B remained fenced on the source. Source originals/shared state still matched the recorded baseline. |
| Fresh journal | One real read-only Management API statement captured all five applicable receipts, including B's unfinished authorization, plus current accounting. The initial copy was authenticated against the backup time. |
| Isolated restore/replay | A fresh local container used cached PostgreSQL image `sha256:c141fd17ac6a76c4323e90b3aee8ff1a23d2e89e547c2b963cfadc309c079cc2`, network `none`, zero published ports and no host binds. Restored logical catalog/owners/grants/policies/rows/extensions and trace samples matched before replay. All five authorizations were replayed in 15 bounded steps: three historical receipts plus the two new post-backup cases. Unaffected rows and shared charges were preserved. |
| Sessions and actual HTTP | All six backed-up session identities were denied in the restored database. Four remaining sessions/refresh rows were removed, and final session/token counts were zero. Actual cached GoTrue/PostgREST services completed 24 HTTP assertions: two preserved-password sign-ins, two deleted-account denials, profile/conversation isolation, private-payload denial, logout/old-session/refresh rejection, anonymous denial and exact disabled-signup errors. Public rows/security catalog remained unchanged. |
| Current accounting/journal | A second real source snapshot was encrypted independently after replay/revocation/HTTP checks. Rows matched the initial journal and restored accounting matched current source exactly. This includes the source's still-fenced B, whose replay completed only inside the local destination. No source journal was edited to force a match. |
| Fence after verification | The exact target recorded by the successful command was independently inspected: `Running=false`, network `none`, zero published ports. Probe service containers were removed. Every result retained `restoreAccessAuthorized: false`; the stopped decrypted volume remains private for inspection. |
| Hosted fixture cleanup | All four newly created accounts were deleted through existing product/continuation behavior. Authoritative Auth absence, completed receipts and absence from all 16 owned categories passed. Original Auth-row hashes, all nonfixture public rows, historical receipts and shared configuration/budgets matched the preflight baseline. |
| Final independent journal | A fresh final capture after cleanup contains seven completed receipts, zero unfinished requests and explicit coverage of all four newly deleted fixtures. It was authenticated against the backup header. Final source counts: two Auth users/profiles, zero private payloads/conversations, empty Storage. No receipt was pruned or aged. |

The successful source operations used 262 bounded operator HTTP requests across seven phases, plus native read-only PostgreSQL operations. Two failed pre-repair journal attempts added 44 operator HTTP requests; all attempts remain recorded. No provider request, application deployment or paid spending occurred. The source's original users were never password-reset or deleted. Original session row byte equality was not separately inventoried; the six denied-session proof concerns the restored copy, not global source logout.

## Reproduced failure and repair

The first two live independent-journal attempts failed strict validation of `captured_at` before writing a journal or creating a restore target. The Management API formats a top-level PostgreSQL timestamp as PostgreSQL text rather than ISO. The original local transport used `row_to_json`, which implicitly converted it to ISO and hid the mismatch.

A new real PostgreSQL assertion reads `captured_at::text` directly from the production query and validates that exact wire value. It failed before the repair (`false`, expected `true`). The query now uses explicit UTC `to_char` formatting with an ISO date/time separator, fractional seconds and `Z`. The unchanged strict decoder, source clock window, authenticated archive, approval and freshness checks remain enforced. The regression then passed locally and the real hosted journal/recovery sequence passed. No source schema/configuration change or relaxed timestamp parser was used.

## Private outputs and remaining handoff

| Encrypted file | Bytes | SHA-256 |
|---|---:|---|
| `step3-database.vpb` | 1800280 | `d3f8632dd008e94286ee3b40ce8ffb199cbae676d29f53ba4eb650ba5ba80dab` |
| `step3-journal-initial.vpb` | 1893 | `33133a80066cbef0ef61e7af73daebe3aa8f18d473db49536d29c938e2fbbbea` |
| `step3-journal-current.vpb` | 1893 | `7c9b0c1551343ce86a81b14df09060511f6c4e55c41fc3a0e0d4f117f74d48fb` |
| `step3-journal-final.vpb` | 2492 | `92ab9517e7e3644fb663f9cd64c4f104c510064c8b540cd986733dc617b895ed` |

Files reside only in the approved private local recovery folder pending owner upload/download verification of the restricted Google Drive copy. Keys remain separately protected and owner-retained in Proton Pass. The database archive expires **2026-12-02 00:20:52 UTC** (2026-12-01 19:20:52 New York); the accepted manual rotation procedure must remove expired copies from both locations. Retained trace keys must remain available while still needed by any live payload or retained archive.

Journal archives were verified within their five-minute current-check windows. Keep their historical deletion records; passing a later byte-for-byte cloud-copy check does not renew freshness or prove later source completeness. The final journal covers fixture cleanup, which happened after the HTTP rehearsal's earlier current copy. Any later restore must use independently current applicable records and accounting; this stopped older destination must not be exposed using the earlier two-deletion journal.

## Post-repair verification

`npm test` passed 467 cases across 39 files. `npx vitest run --config vitest.integration.config.ts tests/integration/recovery-journal.test.ts tests/integration/recovery-database.test.ts tests/integration/recovery-replay.test.ts` passed all three real local database/CLI cases after the repair. The new native-text assertion failed before the repair and passed afterward; the two focused journal/replay unit files also passed all 39 cases. Strict typecheck, lint, 526 specification/fixture checks, 137 changed-document relative file links and `git diff --check` passed. Raw private adapter/schema diagnostics remain ignored; no assertion, fixture constraint or freshness guard was weakened.

## Boundaries and review

**Axis 1, specification:** Actual managed-source TLS/privileges/schema/data/key compatibility, post-backup replay, session revocation, actual isolated Auth/API and current accounting now have bounded hosted-source evidence. Cloud-copy readback, operational rotation handoff, source-loss/cutover completeness and separately approved access remain gates. This rehearsal does not establish a continuously current off-machine journal, atomic cutover, general managed-to-managed restoration, application deployment, hosted positive execution/allocation isolation or full Step 3/pilot acceptance.

**Axis 2, engineering/security:** Reviewed the one-line query repair, native text regression, current decoder/callers and private operator actions. Scope is fixed to four tagged/preallocated fixtures with receipts; originals/shared hashes passed before/after. Outputs are authenticated, create-only ciphertext; credentials stay in protected storage/private stdin, and no secret material is in Git or public reports. The restored database/probe service fence and stopped state were actually inspected. No demonstrated blocker remains in this verified scope. Separate independent review and required CI remain merge prerequisites; PR #32 stays open and unmerged.

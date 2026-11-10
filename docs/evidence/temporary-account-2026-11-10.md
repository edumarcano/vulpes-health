# Temporary-account hosted checks, 2026-11-10

## Initial HTTP check

The checks used one temporary account with synthetic RENPHO data on production revision `7843859c9d4771e5610695d61517748999bb7960`. Provider consent was empty and no AI budget was allocated.

Application HTTP requests covered settings, import preview and commit, Data, Goals and conversation reads, export, password reset, old-session rejection, deletion initiation and post-deletion denial. Account-scoped RLS queries returned no foreign-owner rows across profiles, measurements, sources, conversations and goals. The account was deleted; Auth absence, zero owned rows in the checked tables and a completed deletion receipt were confirmed.

Provider requests and spend were zero. These results cover the named production revision and HTTP/API paths. Physical-device and account-switching checks were not part of this run.

## Merged deployment and family preparation

The production alias served revision `5f636069f3f87e1d7d91d37659d3607154a22b53` in Vercel deployment `dpl_8xPAUEMaVjN1KRLPCExuigZrmcVb` with state `READY`. Vercel metadata bound that deployment to `main`. The deployed application passed the 14 routing, security-header and unauthenticated-access probes. Auth configuration had public signup and anonymous accounts disabled, the email provider enabled and the production app as Site URL.

The final run used two temporary synthetic accounts, each with its own imported measurements and conversation. All temporary accounts created during preparation and the final run were deleted.

| Check | Observed result |
|---|---|
| Populated isolation | Each account read only its own profile, import batches, measurements, sources and conversations. Foreign conversation reads and updates returned 404. Export responses excluded the peer's UUID and conversation ID. Client budget provisioning was denied. |
| Browser sessions | Headless Chromium signed in as each account in the same browser context. Saved profile preferences survived reload, account switching cleared the prior draft, sign-out cleared the stored session and a second tab returned to sign-in. Settings fit a 360-pixel viewport without horizontal overflow. No page errors occurred. |
| Consent | New accounts had empty consent. Acceptance persisted through the Settings API; missing and revoked consent blocked ledger admission. |
| Budget enforcement | Execution and ledger code ran locally against hosted SQL with an explicit synthetic per-run ceiling and no provider transport. Missing allocation blocked preparation; a zero account allocation rejected a request reservation. The deployed Settings API rejected a preference above the allocation. No steps or reservations were created. |
| Account recovery | The bounded `account:recover:hosted` command reset one synthetic account in family mode. Its old access and refresh sessions were rejected, the new password signed in and the other account's session remained valid. |
| Cleanup and preservation | Both final-run accounts were removed from Auth and the checked owned-data tables, with completed deletion receipts and post-deletion access denial. Existing profile timestamps and app allocation, reserved and spent amounts matched their baselines. The earlier deleted test account's leftover local credential file was removed after confirming Auth absence. |

The final run made 26 application HTTP requests, in addition to browser, Auth and database requests. Provider requests and spend were zero. These checks did not exercise successful paid inference, populated goals or message isolation, physical devices, TalkBack or real recipients. No family accounts were created or distributed.

## Operations and recovery inspection

The read-only status command reported approximately 15.2 MB of database use against its configured 500 MB threshold, no expired items due in the reported retention categories, no pending accounting holds, no unfinished deletions and no Storage objects. Total allocated disk/WAL use was not measured.

The November 5 encrypted database archive and its copy from the previously downloaded independent-storage package authenticated and matched. Retained trace-key samples decrypted, and the active trace key was present. This verified the downloaded copy, not current remote custody.

After restarting Docker Desktop, the owner-mode recovery commands captured a fresh encrypted snapshot at `2026-11-10T18:59:06.120Z` and restored it into a new local container with no network, published ports or host mounts. The source database was read only throughout capture and recovery.

| Recovery check | Observed result |
|---|---|
| Snapshot | The authenticated archive covered 57 tables and one trace-key version. Restored catalog and rows matched before replay. |
| Deletions and sessions | All 18 deletion records replayed locally. Restored access and refresh sessions were removed; old sessions were denied. Unaffected rows and shared charges were preserved. |
| Current reconciliation | A fresh journal was captured and rechecked against the live source after replay. Current accounting matched. Two-owner RLS checks passed in the isolated restore. |
| Cleanup and custody | The restore container stopped and was removed with its disposable volume. The encrypted backup and both journals were subsequently copied to the existing private Google Drive recovery folder and verified as described below. Keys were not copied with them. |

The backup SHA-256 was `1525753ebaaa878db44b27ca5dba0d29d46810987dffb52a1038dfa5b5ee46be`. No restored access was enabled. Actual restored Auth/API services, whole-project hosted restoration and source-loss cutover remain unverified. New family data still requires the backup preparation in the [account setup procedure](../setup/private-accounts.md#family-account-preparation).

### Independent copy verification

At `2026-11-10T21:11:38.302Z`, all three mounted Drive copies matched the original byte counts and SHA-256 digests and authenticated with the separately retained keys. The database copy also passed retained trace-key inspection. Drive desktop metadata contained cloud item IDs, content revisions and matching content checksums for all three files, with no pending operations. The backup and initial journal also appeared with matching checksums in the client's separate change-feed metadata cache.

This establishes copy integrity and client-reported cloud synchronization. A fresh web download was not performed: desktop automation was unavailable and the separate browser required Google sign-in. Journal authentication checked historical integrity at capture time; it did not renew the five-minute recovery window or establish later deletion/accounting completeness.

The pre-invitation preparation is complete for the bounded family pilot on the verified deployment. Account-specific provisioning, identity and credential handoff, recipient consent, approved AI allocations, device checks and a backup covering the new identities occur during onboarding. The deferred hosted restoration and accessibility boundaries remain unchanged.

## Local verification

All 662 unit tests passed across 57 files using Git Bash. The first run selected the Windows WSL launcher and failed the Bash workflow-shell test because its default distribution had no `/bin/bash`; selecting the installed Git Bash resolved that environment failure without a code change. The specification validator passed all 609 checks.

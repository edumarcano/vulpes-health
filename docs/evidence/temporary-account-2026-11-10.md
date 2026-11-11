# Temporary-account hosted checks, 2026-11-10

## Initial HTTP check

The checks used one temporary account with synthetic RENPHO data on production revision `7843859c9d4771e5610695d61517748999bb7960`. Provider consent was empty and no AI budget was allocated.

Application HTTP requests covered settings, import preview and commit, Data, Goals and conversation reads, export, password reset, old-session rejection, deletion initiation and post-deletion denial. Account-scoped RLS queries returned no foreign-owner rows across profiles, measurements, sources, conversations and goals. The account was deleted; Auth absence, zero owned rows in the checked tables and a completed deletion receipt were confirmed.

Provider requests and spend were zero. These results cover the named production revision and HTTP/API paths. Physical-device and account-switching checks were not part of this run.

## Merged deployment and account checks

The production alias served revision `5f636069f3f87e1d7d91d37659d3607154a22b53` in the current Vercel deployment. Routing, security headers and unauthenticated-access probes passed. Public signup and anonymous accounts were disabled.

The final run used two temporary synthetic accounts, each with its own imported measurements and conversation. All temporary accounts created during preparation and the final run were deleted.

| Check | Observed result |
|---|---|
| Isolation and export | Accounts read only their own profile, imports, measurements, sources and conversations. Foreign conversation reads and updates returned 404; exports excluded the peer's identifiers. Client budget provisioning was denied. |
| Browser sessions | Headless Chromium checked account switching, draft clearing, saved preferences, cross-tab sign-out and a 360-pixel viewport. |
| Consent | New accounts had empty consent. Acceptance persisted through the Settings API; missing and revoked consent blocked ledger admission. |
| Budget enforcement | Execution and ledger code ran locally against hosted SQL without provider transport. Missing or zero allocation blocked requests, and the deployed Settings API rejected a preference above the allocation. No steps or reservations were created. |
| Account recovery | The bounded `account:recover:hosted` command reset one synthetic account using its then-current named-account mode. Its old access and refresh sessions were rejected, the new password signed in and the other account's session remained valid. |
| Cleanup | Both accounts were removed from Auth and the checked owned-data tables; deletion receipts and post-deletion denial were verified. Existing profile timestamps and app budget amounts matched their baselines. The earlier test account's leftover local credential file was removed after confirming Auth absence. |

Provider requests and spend were zero. These checks did not exercise successful paid inference, populated goals or message isolation, physical devices, TalkBack or real recipients. No additional real accounts were created.

## Operations and recovery inspection

The read-only status command reported approximately 15.2 MB of database use against its configured 500 MB threshold, no expired items due in the reported retention categories, no pending accounting holds, no unfinished deletions and no Storage objects. Total allocated disk/WAL use was not measured.

The November 5 encrypted archive and previously downloaded copy authenticated and matched. Retained trace-key samples decrypted and the active key was present.

Owner-mode recovery captured an encrypted snapshot at `2026-11-10T18:59:06.120Z` and restored it into a local container without network, published ports or host mounts. Source access was read-only.

| Recovery check | Observed result |
|---|---|
| Snapshot | The authenticated archive covered 57 tables and one trace-key version. Restored catalog and rows matched before replay. |
| Deletions and sessions | All 18 deletion records replayed locally. Restored access and refresh sessions were removed; old sessions were denied. Unaffected rows and shared charges were preserved. |
| Current reconciliation | A fresh journal was captured and rechecked against the live source after replay. Current accounting matched. Two-owner RLS checks passed in the isolated restore. |
| Cleanup and custody | The restore container stopped and was removed with its disposable volume. The encrypted backup and both journals were subsequently copied to the existing private Google Drive recovery folder and verified as described below. Keys were not copied with them. |

The backup SHA-256 was `1525753ebaaa878db44b27ca5dba0d29d46810987dffb52a1038dfa5b5ee46be`. No restored access was enabled. Restored Auth/API services, whole-project hosted restoration and source-loss cutover remain unverified. New accounts require the backup preparation in the [account setup procedure](../setup/private-accounts.md#additional-account-preparation).

### Independent copy verification

At `2026-11-10T21:11:38.302Z`, the mounted Drive copies matched the originals and authenticated with separately retained keys. Drive desktop metadata reported matching content checksums and no pending operations. The database copy also passed trace-key inspection.

No fresh web download was performed, so cloud readback remains unverified. Journal authentication checked historical integrity; it did not renew the five-minute recovery window or establish later deletion and accounting completeness.

## Local verification

All 662 unit tests passed across 57 files using Git Bash. The first run selected the Windows WSL launcher and failed the Bash workflow-shell test because its default distribution had no `/bin/bash`; selecting the installed Git Bash resolved that environment failure without a code change. The specification validator passed all 609 checks.

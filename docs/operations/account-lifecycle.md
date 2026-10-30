# Account lifecycle and local recovery

The account workflow uses the existing PostgreSQL transactions and execution ledger. It adds no background worker, email service or provider request. Verification commands use synthetic local infrastructure. Hosted migrations, real-account operations, backup destinations and family invitations require separate approval.

## Export

Settings downloads `vulpes-account-v1.json` through authenticated `POST /api/account`. Trace inclusion requires a sensitive-content acknowledgement. Opaque provider continuation state, credentials, executor authority and shared operator configuration are excluded.

| Inventory | Export behavior |
|---|---|
| Safe Auth identity | Owned email/phone and creation/update/confirmation timestamps; excludes passwords, tokens, sessions and operator Auth metadata |
| Profile, preferences and consent | Owned values, excluding the internal settings write receipt |
| Sources, measurements and imports | Exact decimal strings, provenance, timestamps, source IDs, versions and import results |
| Goals, revisions and proposals | Owned history and currently retained draft bodies |
| Conversations and messages | Retained owned content and request receipts |
| Runs, steps and accounting/audit projections | Owned metadata/account allocations; excludes shared app balance and executor hash |
| Staging | Available uncommitted normalized bytes in base64; explicit expired/unavailable states |
| Trace inventory | Envelope IDs, purpose, expiry and hashes; inventory grants no payload access |
| Chosen trace parts | Inspector authorization/integrity checks; explicit unavailable, expired, removed or corrupt states |

Pages contain at most 200 rows. Section fingerprints and data revision are checked before/after capture and before transmission. Changes or selected-content expiry return JSON 409 without an attachment. Wait for active work to finish and retry. The capture interval, counts and SHA-256 section manifest describe the output; it is not a transactional backup or restore format.

Responses are `no-store`. Account changes abort/discard browser downloads and revoke their object URLs. The request signal reaches Auth verification, owned page/staging reads and inspector/ledger reads. Server capture uses an encrypted temporary file and a request-only random key. Completion/error/cancellation removes the file and zeros the key. Crashes leave unreadable ciphertext; maintenance removes known stale artifacts after 24 hours. Downloaded plaintext needs private storage controls.

## Deletion and interruption

Initiation requires `DELETE MY VULPES ACCOUNT` and password authentication within five minutes. The server checks the authenticated password AMR timestamp; token refresh does not establish fresh password authentication. Settings performs a new password sign-in before initiation.

| Durable phase | Meaning |
|---|---|
| `fenced` | Account is deleting. Admission, new domain/content writes and cancellation receipts are denied. Continue bounded private purges. |
| `private_content_purged` | Private payloads, transcripts, goals/revisions/drafts, measurements/imports/sources, conversations and owned audit content removed; profile personal fields cleared. |
| `awaiting_settlement` | Minimal lifecycle/accounting remains. Unsent requests release their hold; uncertain sent requests retain it for 24 hours. |
| `app_data_purged` | Reservations settled and remaining owned accounting/allocation/run rows removed. Shared app charges and route-cost blocks remain. |
| `auth_removal_pending` | Profile removed. Retry and independently verify Auth removal. |
| `completed` | Application data and Auth absence confirmed. |

The journal has no profile/Auth foreign keys and contains only identifiers, timestamps, phases and safe outcomes. It prevents profile recreation/reactivation while retained. Continuations purge bounded groups and follow profile-before-journal and existing execution/bucket lock ordering. Goal revision leaves precede their proposals/goals; transcript references precede run detachment. No lock spans provider HTTP.

Use **Continue account deletion** or maintenance to resume. Status and continuation verify identity without requiring an active profile; ordinary APIs still require an active account and a live owned Auth session. The UI clears private queries/streams and shows restricted status. A submitted initiation with a lost/error response clears private state and rechecks account status; a failed recheck stays restricted and unconfirmed. Save the receipt ID. A lost final response or failed sign-in is **unconfirmed**; after identity removal, the operator must check the authoritative journal and Auth absence.

Do not shorten uncertain holds, reset verification allocations or delete reservations to force completion. Settlement uses the original admission month. Late usage can update existing accounting but cannot restore content. After final ledger removal, conservative aggregate charges remain; deleted content is never reconstructed. Third-party security/abuse records follow their own contractual controls.

## Maintenance and complete storage inventory

```sh
npm run maintenance:cleanup
```

Run after inactivity/interruption. The command refuses hosted/linked stacks and connection overrides. It reports counts and `unfinished`, without account IDs or content. Re-run while work remains; investigate repeated failures. Each invocation permits at most 100 deletion steps and one Auth-removal attempt per affected account. Future accounting holds stay pending. Known local synthetic backup archives older than 30 days are physically removed; other backup destinations need their approved rotation procedure. No detached worker or exact-time physical cleanup is promised.

| Store | Retention/cleanup |
|---|---|
| Measurements, goals/revisions, approved proposals, conversations and message receipts | Explicit product/account deletion; execution expiry preserves transcript history |
| Uncommitted staging | 24-hour read-time expiry and bounded physical cleanup |
| Pending proposals | 24-hour expiry; draft bodies removed, lifecycle receipts/approved history preserved |
| Encrypted request/response/tool/context/usage/continuation payloads | Seven-day read-time expiry and bounded physical cleanup |
| Safe execution/usage rows | 90 days after terminal state and settlement; account deletion removes owned rows after settlement |
| Verification allocations | Never reset/replenished by maintenance; owned allocation removed only after deletion settlement |
| Shared app charges and route-cost blocks | Survive account/execution deletion; clearing blocks requires separate review |
| Deletion journal | Unfinished entries persist; completed entries retained at least 31 days |
| Server export temporary files | Request lifetime; stale ciphertext cleanup after 24 hours |
| Browser state | Private queries/mutations/streams cleared on account switch/deletion; PWA caches public assets only |
| Supabase Storage | Disabled. Restore verification refuses nonempty object storage without supported object-byte recovery. |
| Backups and independent journal copies | Encrypted/access-controlled, separately managed with keys; never public or source-controlled |

## Separate-environment backup rehearsal

```sh
npm run backup:verify
```

Use an empty disposable synthetic source. The harness refuses existing users, profiles, allocations or balances, including retained verification state. Never reset a retained database to meet this precondition.

The command creates two synthetic owned graphs and real encrypted payloads under current/previous key versions. It seals a PostgreSQL custom archive with Node AES-256-GCM, without a plaintext dump. Keys use separate protected temporary storage and are destroyed at completion. Retained synthetic ciphertext is therefore not a reusable operational backup.

A separately named destination uses loopback ports 28321/28322. Source identity and populated destinations are refused. Auth, REST and gateway containers stop before restoration. The local database administrator restores fresh schemas and original ownership. All bytes authenticate before reaching `pg_restore`.

Verification compares logical columns, every constraint/trigger/function, ownership, routine/table grants, RLS, row hashes, budgets and Storage inventory. Physical dropped-column positions, ACL ordering and equivalent CHECK parse trees are normalized without dropping their logical constraints/grants. Both current and retained keys must decrypt actual restored traces. Missing keys, corruption and expired archives fail closed.

After backup capture, a source account is deleted. A fresh independently stored, separately encrypted deletion journal is required before restored access. Every applicable deletion is replayed, the current journal is checked again, and restored sessions/refresh tokens are cleared before access services restart for Auth/RLS/recovery proof. Missing/stale evidence, unfinished settlement or a changed journal blocks access. The destination stops at completion/failure; its disposable volume is retained for inspection.

## Operational recovery procedure

Before real use, approve the backup destination/key-management procedure and rehearse it separately. Encrypted backups expire within **30 days**. Keep recoverable trace key versions and backup/journal keys separately from ciphertext. Maintain an independent deletion journal whose completeness can be established after source loss; a backup's embedded journal cannot prove later deletions.

1. Stop restored access and inference. Verify a separate disposable destination; never overwrite the source/populated deployment.
2. Authenticate archive age and keys; restore schema/data/ownership/grants/RLS. Include object bytes if Storage is ever enabled; current verification refuses that unsupported state.
3. Apply current independently retained deletion records, including unfinished requests, before access. Preserve uncertain holds/shared charges. Missing evidence leaves recovery blocked.
4. Revoke restored sessions. Verify two-user isolation, relationships, accounting, cost blocks and trace decryption. Reconcile the current journal again before access; prevent concurrent source activity during an actual cutover.
5. Record revision, archive/key versions, deletion coverage, actual results and gaps. Approve access separately. Local rehearsal does not establish hosted recovery readiness.

### Operator-assisted credentials

```sh
npm run account:recover
```

Use only a synthetic account during local verification. In a private interactive terminal, provide the account UUID, attest `IDENTITY VERIFIED` after independent out-of-band verification, and enter the new password through hidden input. Never put credentials in arguments/chat/logs or grant project-team membership. The trusted service resets the password and revokes session/refresh records. App verification, RLS reads and direct mutations reject the old session even while its signed JWT has time remaining.

If reset/revocation is unconfirmed, repeat before credential handoff. Verify a fresh sign-in and deliver credentials through the separately agreed private channel. No SMTP service is added. Local tests establish the admin/Auth/session path; human identity verification/handoff, hosted secrets and operator access remain deployment/pilot gates.

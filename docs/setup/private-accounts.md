# Private account setup

Email/password authentication supports operator-provisioned accounts. Manual/CSV Data, Goals, owned JSON export and resumable account deletion are implemented. Public signup and email invitations/recovery remain unavailable. The hosted owner pilot uses Luna under consent and budget controls. Operator-assisted password reset uses the bounded hosted command in the [account lifecycle runbook](../operations/account-lifecycle.md). Real-account provisioning and recovery require owner approval.

## Configuration

Use the root `.env.example`; keep populated values in ignored `.env.local` or deployment secrets. Never put credentials in commands, screenshots, source control, public previews, or logs.

| Setting | Purpose |
|---|---|
| `VITE_SUPABASE_URL` | Exact Supabase API origin; HTTPS except for local loopback |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Public publishable key or legacy anonymous key; never an administrative key |
| `VULPES_APP_ORIGIN` | Exact browser origin, normally `http://127.0.0.1:5173` for development or port 4173 for preview |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only; required for account status/lifecycle, private payloads and trusted administrative operations |
| `VULPES_TRACE_ENCRYPTION_KEY_ID` | Identifier of the active encryption key |
| `VULPES_TRACE_ENCRYPTION_KEY_B64` | Secret base64 encoding of a cryptographically random 32-byte key |
| `VULPES_TRACE_PREVIOUS_KEYS_JSON` | Optional secret JSON object mapping previous IDs to base64 keys for reads |

Obtain public values from the intended local stack or owner-approved project. Do not copy values from a different project. The guarded browser runner obtains local values in memory; it does not require a populated environment file.

Restart the full app after configuration changes. Development and preview CSP allow the exact configured Auth origin. Production `vercel.json` allows the selected Supabase origin alongside `'self'` in `connect-src`; verify the deployed headers after changing that origin. Keep Auth Site URL aligned with the app origin and redirect URLs limited to implemented flows. OAuth and recovery callbacks are not implemented.

## Provisioning procedure

1. Confirm authorization and the intended environment. Keep public and anonymous signup disabled. The local Supabase configuration deliberately enables the email provider while disabling global signup so provisioned passwords work.
2. Verify the intended email out of band before marking it confirmed. Use trusted operator tooling with the server-only Supabase Admin API `auth.admin.createUser({email, password, email_confirm: true})`; never expose this operation as an application route. Supply passwords through a protected interactive input or secret manager, not command arguments/history.
3. With the returned Auth UUID, insert an owned `profiles` row through that same trusted administrative context. Set only the intended display name, IANA timezone and unit system. Leave provider consent empty and account state active. If profile creation fails, finish provisioning or remove the newly created identity through the trusted context; an identity without an active profile cannot use authenticated application APIs.
4. Hand off credentials through an approved private channel and verify the recipient. Do not log the password, session, administrative key, or full Auth response.
5. Sign in through `/login`, save profile preferences, reload, and sign out. Verify the account has no foreign settings/data and no provider consent by default. Consent does not enable inference.

Use the guarded local integration/browser tests for disposable synthetic provisioning and cleanup. Real accounts require owner approval.

The small-pilot policy uses operator-assisted password reset without SMTP. Verify the recipient's identity before reset and deliver credentials privately after session revocation succeeds. Recipients do not need Supabase or Vercel administrator access.

## Additional account preparation

Accounts are created by the operator and credentials are delivered privately; the app does not send invitations. The [hosted synthetic checks](../evidence/temporary-account-2026-11-10.md) cover isolation, account switching, consent, budget denial and password recovery.

| Area | Setup |
|---|---|
| Account scope | Set the Auth user's server-controlled `app_metadata.vulpes_data_scope` to `family-pilot` and add the UUID to the private [recovery manifest](../operations/hosted-recovery.md#named-family-operation-scope). Preserve the owner's scope marker. The manifest covers at most ten owner, additional and synthetic identities. |
| Credentials and device | Follow the provisioning procedure above and check sign-in and basic use on the recipient's device. Password recovery uses `account:recover:hosted` with the matching manifest and `--family-pilot`. |
| AI access | Start without provider consent or an allocation. The recipient accepts consent; the owner separately approves a monthly allocation within the shared app ceiling. A personal preference cannot increase it. |
| Backup | Include every account in the manifest and verify a fresh encrypted backup, separate copy, retained keys, current deletion journal and fenced reconciliation before regular use. Hosted restoration remains unverified. |

For an approved AI allocation, use a trusted administrative context to call `provision_pilot_budget_v1` with `p_owner`, `p_app_ceiling` and `p_account_ceiling`. Both ceilings must be positive, and the account ceiling cannot exceed the app ceiling. The function creates missing current UTC-month buckets, preserves spent and reserved amounts, and rejects a different existing ceiling. The `budget:provision` CLI targets local synthetic infrastructure only.

Allocations do not renew automatically. Provision each approved account for each new UTC month; missing allocations block paid requests. Review the shared app balance and pending holds before adding accounts. Changing an existing ceiling requires a separately approved operation.

## Encryption and retention

Keep keys separate from database dumps and unencrypted exports. New envelopes use the active key ID; rotation changes the active ID/key while retaining previous versions in the secret previous-key map. Do not reuse an ID for a different key. Never discard an old key while retained payloads or recoverable backups require it. Lost keys make those payloads unreadable; restore verification remains an operations gate.

Payloads use AES-256-GCM with random 12-byte nonces and a 16-byte tag appended to ciphertext. Gzip precedes encryption. The version-1 authenticated metadata is the UTF-8 JSON array `[id, user_id, purpose, payload_version, encoding, key_id, content_hash, expires_at]`; expiry is canonicalized to ISO UTC milliseconds. The hash covers original bytes. Storage and decompressed output are each bounded at 4 MiB.

Import staging expires after 24 hours; AI/tool/provider-state payloads after seven days. Reads deny expired content before decrypting it. Data requests and successful payload access/write attempt bounded owned cleanup. After inactivity, run `npm run maintenance:cleanup` against the disposable local stack; it reports removed envelopes, expired import batches and work limits without payload content. Repeat after concurrent operations finish or if the reported transaction maximum is reached. Deleting a measurement also purges the owner's retained exact trace payloads, while preserving safe accounting and frozen goal decisions with review markers. Hosted maintenance requires a separately authorized operating procedure, not an implied scheduler.

Normal account/health rows rely on access controls and managed storage protections. Payload encryption does not encrypt every database field or hide data from the operator. Sign-out clears this device's session and app state. Revoked sessions are denied by app verification, RLS reads and direct mutations even before JWT expiry. If remote sign-out fails, only local clearing is confirmed; reconnect and verify revocation before relying on it.

# Security and privacy requirements

## 1. Trust boundaries

The user trusts the deployment operator, Supabase/Vercel under their applicable terms, and explicitly approved inference providers. The app isolates users from one another but is **not** end-to-end encrypted against the person who controls the backend and keys. Explain this before invited-account onboarding.

Provider "no training" and provider "zero retention" are separate properties. OpenRouter ZDR routing concerns eligible inference endpoints; it does not automatically cover external tools or the app's logs. [S16](SOURCES.md#s16) Google documents no-training commitments plus retention exceptions, including abuse monitoring and some model/features. Do not label every Vertex request ZDR. [S17](SOURCES.md#s17)

The selected Google route is allowed only after an operator approval binds the project, processing location and privacy fingerprint, and the user accepts its exact policy version. No approval is installed by migrations. The operator's preferences do not imply every invited user's consent. Disabling a provider stops future routing there; it cannot retract already transmitted data.

## 2. Required protections

- Verify auth on every API and private asset request; derive ownership from the session.
- RLS for all private exposed tables; composite owner-parent constraints; tests for direct database API access as well as Vercel routes.
- Model tools use an allowlist and strict schemas. No arbitrary SQL, shell, browser, cross-account lookup or provider-URL tools.
- Server-only provider and administrative credentials. Only Supabase's public/publishable client configuration may use `VITE_` prefixes.
- No secrets or health data in build output, error logs, source-control fixtures, telemetry or public previews.
- Same-origin production API access; explicit local-development origins; do not use wildcard credentialed CORS.
- Sanitize displayed markdown; block executable HTML and unsafe links; set a restrictive CSP and test the streaming UI under it.
- Rate-limit and enforce one concurrent run per user using persistent state, not process memory.
- Explicit content-bound approval for consequential goal/plan mutations; text in a document cannot grant approval.

## 3. Credential and Google authentication handling

Prefer Vercel OIDC / Google Workload Identity Federation with conditions binding the intended Vercel project and environment. Vercel documents this integration and short-lived credential exchange. [S18](SOURCES.md#s18)

A service-account key is an owner-approved fallback for a prototype only, stored as a server secret, never committed or exposed to Codex logs. Scope permissions narrowly to the needed AI calls and project. Local development can use Application Default Credentials. Do not treat a Google AI Studio API key as a Vertex service-account credential.

No user can change a provider's base URL in the app. Custom endpoint support is deferred; this avoids accidental prompt exfiltration and SSRF.

## 4. Application trace encryption

Encrypt full request/response and import-staging payloads with a standard authenticated scheme such as AES-256-GCM via a supported crypto library. Use a fresh random nonce for every encryption, record key ID, and authenticate owner ID plus payload purpose/version as additional data. Never invent cryptography.

Store the server key in deployment secrets and retain recoverable key versions during rotation. Loss of the key makes traces unreadable; backup and restore tests must include key availability without storing the key alongside an unencrypted export. Compression happens before encryption. Verify round-trip byte equality against the original request.

Normal health and account rows rely on access controls and the managed service's storage protections; do not claim that this trace-only encryption makes every database field app-encrypted or clinically compliant.

## 5. Retention defaults

| Data | Default | Effect |
|---|---|---|
| Measurements, approved goals, conversations | Until user deletes them/account | Core product history; subject to explicit deletion |
| Full encrypted AI payloads | 7 days | Exact inspector content expires, not silently reconstructed |
| Usage and safe run metadata | 90 days | Cost investigation without indefinite prompts |
| Import staging | 24 hours | Uncommitted normalized content removed |
| Raw uploaded CSV | Not retained after processing | Original values and mapping provenance remain in records |
| App caches | Revision-bound, tenant-bound, short-lived | Invalidate on edits, deletion and account switch |
| Export artifact, if temporary storage is used | 24 hours or shorter | Private, authenticated, no public URL |
| Encrypted operational backups | Maximum 30 days | Apply current deletion journal before restored access |
| Completed deletion journal entries | At least 31 days | No content/credentials; outlives profile/Auth and backup window |

Expiration must be enforced on reads even before physical cleanup. Perform bounded opportunistic cleanup plus an operator maintenance command for v0.1.0; document how to run it after inactivity. No paid/background model task is necessary. A routine infrastructure cron can be considered later, not used as an implicit promise that idle data was physically deleted at the exact expiry second.

If an input record is deleted, invalidate derived caches and any trace payloads that retained that content, or delete the corresponding owned conversation/run payloads where precise dependency deletion is unavailable. Explain the effect to the user. Do not silently keep a supposedly deleted measurement in a full prompt log indefinitely.

## 6. Export, deletion and backup

Exports include schema version, units, timestamps, source information and user-chosen available traces. Exporting a trace can reveal sensitive content; require a warning. CSV exports must prevent spreadsheet formula execution in untrusted text fields without corrupting numeric negatives.

Account deletion first blocks new runs, requests cancellation, purges owned app records/private payloads/storage artifacts, then removes the Auth identity. Test interrupted cleanup and safe retries. No residual online row may be used to personalize later responses.

Offline backups may retain data until their rotation expires, at most 30 days. Restoration requires current independently retained deletion records; missing evidence blocks access. Revoke restored sessions before access. Never promise instant deletion from third-party provider abuse/security records beyond available contractual controls. The [account lifecycle runbook](../../operations/account-lifecycle.md) owns maintenance, restoration and operator-assisted recovery procedures.

Before invited-account use, perform a restore to a separate nonproduction database. Verify ownership policies, row counts and encryption recovery. A CSV export is not a complete database/auth/policy backup.

## 7. Account provisioning and recovery

Public signup is disabled. Provision the first owner and invited accounts through trusted admin tooling. Verify the intended email out of band before marking it confirmed. Supabase's admin user API is server-only. [S20](SOURCES.md#s20)

Manual provisioning is sufficient for the initial account, but secure credential handoff and a tested recovery process are required before invited-account use. Do not rely on Supabase's default mail delivery for arbitrary invited recipients: its built-in SMTP has recipient restrictions. [S19](SOURCES.md#s19) Configure a proper SMTP provider for normal invitation/recovery emails, or explicitly use a documented operator-assisted reset flow during the small private pilot. Do not add invited users as Supabase project team members to work around email restrictions.

## 8. Safety is not only permissions

A reversible but unsafe recommendation is still unsafe. Low-cost routing, a high-end model, output probabilities, disclaimers and provider privacy settings do not validate clinical advice. Apply the wellness boundary in PRODUCT_SPEC and test adverse/ambiguous cases. No medication management, diagnostic assessment or emergency monitoring feature is shipped.

The initial invited pilot is for adults. Any future expansion to children, clinicians, public users or commercial disease-related use needs separate product, safety, privacy and regulatory review rather than a feature flag alone.

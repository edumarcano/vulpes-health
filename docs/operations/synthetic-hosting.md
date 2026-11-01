# Controlled synthetic hosting

Step 3 prepares and verifies a synthetic deployment with inference **off**. Local preparation grants no resource, migration, deployment, model activation or real-data permission. The [release checklist](release-readiness.md) owns acceptance; [account lifecycle](account-lifecycle.md) owns recovery invariants. [Local preparation evidence](../evidence/owner-pilot-step3.md) separates executed checks from pending hosted checks.

## Checkpoints and approvals

| Checkpoint | Work and required evidence | Owner action |
|---|---|---|
| 3A: local preparation | Reviewable configuration, target-bound build guard, upload exclusions, public probe, local build/HTTP proof | Review PR; merging remains separate |
| 3B: resources | One Vercel Hobby project and one source Supabase Free project, agreed region, secure accounts; recovery destination may be deferred | Explicitly approve resources, region and $0 paid allowance; create accounts/projects when instructed |
| 3C: synthetic deployment | Reviewed migrations on source; two synthetic accounts; protected secrets; exact candidate/config binding; inference off | Explicitly approve hosted migrations/deployment and synthetic verification; enter secrets directly in dashboards |
| 3D: hosted security/recovery | Auth/API/RLS/cache isolation, export/deletion, fenced separate restore, session revocation, backup/journal/key custody and maintenance procedure | Approve backup location/custody and destructive operations on named disposable synthetic identities/destination |
| Later checkpoints | Controlled hosted Luna/Ask and Android testing, outstanding acceptance, then owner real-data pilot | Separate inference/spend, device, acceptance and real-data approval; no implied activation |

3A can finish without cloud access. 3D remains blocked until a hosted recovery procedure is implemented/rehearsed for the selected platform. The existing `backup:verify`, `maintenance:cleanup`, `account:recover` and `budget:provision` commands intentionally refuse hosted/linked targets. Do not remove their guards or present local rehearsal as hosted proof.

## Resource proposal and spending

Prices checked 2026-10-31: [Vercel Hobby](https://vercel.com/pricing) is $0 for eligible personal/noncommercial use. [Supabase Free](https://supabase.com/pricing) is $0 with two active projects, 500 MB database per project, 1 GB Storage, 5 GB egress and inactivity pausing after one week. Free has no managed automatic backups; [manual backups](https://supabase.com/docs/guides/platform/backups) and independent encrypted storage need an approved procedure. Database backups do not include Storage object bytes. Storage stays unused.

The proposal permits **$0 paid infrastructure, no card/upgrade, no domain purchase and no inference**. One source project is sufficient for initial synthetic hosting. If another project already occupies the second Free slot, defer the recovery destination; do not delete, pause, repurpose or access that unrelated project. A second hosted project is not required to prepare/deploy synthetic data. Vercel Pro starts at $20/month; Supabase Pro starts at $25/month with additional project costs. Neither is approved. Provider key caps do not cap infrastructure bills.

Choose one explicit region pair: North Virginia (`us-east-1` database, `iad1` functions) or Frankfurt (`eu-central-1`, `fra1`). Use a [specific Supabase region](https://supabase.com/docs/guides/platform/regions), rather than a broad automatic group. This selects application placement, not a guarantee that all platform/account metadata stays there. The owner must choose the acceptable location. A later hosted recovery destination uses that selected region unless separately approved otherwise.

## Owner setup after resource approval

These steps are instructions for the approved checkpoint, not authorization to start it. Dashboard labels may change; stop and report a missing setting rather than choosing a paid alternative.

1. Open [Supabase Dashboard](https://supabase.com/dashboard) and [Vercel Dashboard](https://vercel.com/dashboard). Sign in to accounts you control and enable account MFA. Save Vercel recovery codes privately. [Supabase account MFA](https://supabase.com/docs/guides/platform/multi-factor-authentication) provides no recovery codes: register a backup authenticator factor on a separate device/app or keep its setup secret in separate secure storage. Enabling Supabase MFA signs out other account sessions; losing every factor can permanently block access. Do not share passwords, setup secrets, MFA codes or recovery codes here.
2. In Supabase select your **Free** organization, click **New project**, name it `vulpes-synthetic`, and choose the approved specific region. Generate a unique database password and save it in your password manager. Confirm the plan is Free before creating it. Do not recreate an existing source project. A separate recovery destination can wait until the recovery checkpoint; no second project or upgrade is needed now.
3. In each project's **Settings → General**, record the project reference. Record the source's HTTPS Project URL from **Settings → Data API** (or the Connect panel). These references/URLs are public identifiers; report those and the selected regions, never database passwords or keys.
4. In Vercel's personal Hobby scope, create an **empty project** named `vulpes-synthetic` using the project-creation tool/CLI when directed. Do not import the repository using a flow that immediately deploys. If the dashboard only offers repository import, report that and let the implementation workflow create the empty project after approval. Keep Git integration disconnected, no domain purchase, analytics or paid add-ons. Record **Settings → General → Project ID** and the assigned production `*.vercel.app` hostname. If a hostname is unavailable until first deployment, agree its intended project hostname before preparing the target, then verify the assigned hostname; a mismatch requires a new target/config.
5. In Vercel review the account/team optional AI-training/platform-data preference and opt out before uploading private code. This does not replace runtime data protections. In project **Settings → Environment Variables**, enable access to [System Environment Variables](https://vercel.com/docs/environment-variables/system-environment-variables). The build requires platform-supplied project ID, environment and production hostname.
6. Report: the source Supabase reference/region, Vercel project ID/hostname, confirmed Free/Hobby plans, MFA enabled, whether a recovery destination is available and whether any quota/payment request appeared. These are enough to bind preparation. Do not send credentials or dashboard screenshots containing keys.

The synthetic site's login and public assets may be internet reachable at its assigned URL. Disabled signup, authenticated APIs and RLS protect private records; an unguessable URL is not access control. Platform operators and the deployment owner can access backend data. Only invented data is permitted throughout this checkpoint.

## Prepare the exact candidate locally

The operator copies `config/hosting-synthetic.example.json` to an ignored `.scratch/hosting-target.json` and fills the approved public identifiers. Its placeholders deliberately fail validation. Set `recoveryProjectRef` explicitly to `null` when deferred; a supplied recovery reference must differ from the source. Preparation records `recoveryVerification: deferred_no_destination` for null and `not_run` for a supplied destination; neither authorizes real data. Commit/push no linked-project state or generated files.

```sh
npm run hosting:prepare -- --plan
npm run hosting:prepare -- --target=.scratch/hosting-target.json
npm run hosting:probe -- --plan
```

Preparation performs zero network requests. It creates `.scratch/hosting/<target-hash-prefix>/` once, containing `vercel.json`, a manifest and reviewed migration copies in `supabase/migrations`. Repeating the same target refuses to overwrite. Record the source Git revision and compare config/migration SHA-256 values before deployment; a source change requires a freshly reviewed candidate. Preparation's manifest explicitly records no approval and no hosted verification.

The generated CSP allows only the exact source Supabase HTTPS origin alongside same-origin connections. Function region follows the selected database region. Git automatic deployments are disabled through [`git.deploymentEnabled: false`](https://vercel.com/docs/project-configuration/git-configuration). Explicit API routes precede the JSON fallback; `/api/account` still uses the Settings function. `.vercelignore` excludes private files, local credentials, builds, verification stacks and backups from CLI uploads. Upload exclusion is an additional boundary, not permission to keep real records in this checkout.

The root configuration intentionally refuses an ordinary hosted build without target arguments. Generated configuration supplies public identifiers to `build:hosted`, which requires the exact Vercel production environment/project/hostname, public Supabase URL, server-only administrative/trace keys and `VULPES_LIVE_AI_ENABLED=false`. It rejects provider configuration and unexpected public `VITE_` variables. Automatically supplied `VITE_VERCEL_*` metadata is removed before the client build. Credential syntax checks do not establish hosted authentication or authorization.

The deployment channel is called **Production** in Vercel; this initial project's data remains synthetic and model inference remains off. Preview builds are deliberately refused. Do not give preview/development scopes these server secrets. Later production inference requires its own evidence, budget and explicit activation approval.

## Secure credentials after configuration approval

Use Vercel **project Settings → Environment Variables → Add**, select only **Production**, and choose the following [Config/Secret types](https://vercel.com/docs/environment-variables). Clear Preview/Development selections. Paste values directly from Supabase/password manager; never place them in chat, shell arguments, Git, screenshots or `VITE_` variables other than the two public values below. Do not use a broad environment-file import.

| Name | Type | Value |
|---|---|---|
| `VITE_SUPABASE_URL` | Config (public) | Exact source `https://<reference>.supabase.co`, no trailing slash |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | Config (public) | Source publishable key; legacy `anon` key is supported; never the secret/service-role key |
| `VULPES_APP_ORIGIN` | Config | Exact approved `https://<project>.vercel.app`, no trailing slash |
| `VULPES_LIVE_AI_ENABLED` | Config | Literal `false` |
| `SUPABASE_SERVICE_ROLE_KEY` | Secret | Source secret key (`sb_secret_…`) or legacy `service_role` key from **Settings → API Keys**; it bypasses RLS and must stay server-only |
| `VULPES_TRACE_ENCRYPTION_KEY_ID` | Secret | New version label, e.g. `synthetic-hosting-2026-10` |
| `VULPES_TRACE_ENCRYPTION_KEY_B64` | Secret | Fresh random 32-byte base64 key, also retained privately for recovery |

Generate the encryption key in your own private terminal with `node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"`. Store it in a password-manager record, paste it into the Secret field and close the terminal. Do not report the output. Losing this key makes encrypted payloads unreadable. Keep key versions recoverable separately from encrypted backups; rotating a key does not remove the need for older versions.

Leave `OPENROUTER_API_KEY`, all `GOOGLE_*` values, `VULPES_SMOKE_BATCH_ID`, `VULPES_TRACE_PREVIOUS_KEYS_JSON` (new empty deployment), all model overrides and any other `VITE_` values absent. Do not copy the dedicated local verification key. Verify each variable's name, type and Production-only scope without revealing values; report only that the listed settings are complete. The app's build validates shape/binding, not the dashboard's secret classification or runtime correctness.

## Source migrations and synthetic accounts after approval

The operator uses the locked Supabase CLI against the **generated work directory**, never links the repository's local-test `supabase/` directory. Login happens privately; database passwords use the CLI's protected prompt, never arguments or chat. Inspect the source project identity before any write. Run migration dry-run, review its exact pending list, then apply the reviewed migrations only to the approved empty source. Preserve results without tokens, database URLs/passwords or raw service logs. Do not use `db reset`, `--include-all` or an SQL grant workaround to force a hosted migration through. Stop on platform schema/grant differences.

The generated files are preparation, not proof that hosted migrations are compatible. If a recovery destination exists, keep it empty until its restore plan is approved. No root linked state, local allocation resets or hosted credentials belong in ordinary CI.

For the source project, owner dashboard actions after instruction:

1. Open **Authentication → Sign In / Providers → Email**. Keep email/password sign-in enabled. Under the signup settings, disable **Allow new users to sign up**. Configure **Authentication → URL Configuration**: Site URL is the exact app origin; no wildcard redirect URLs. Add only an exact implemented callback if the application actually needs it. Do not add SMTP or social login.
2. Open **Authentication → Users → Add user → Create new user**. Create `vulpes-owner@example.invalid` and `vulpes-isolation@example.invalid`, each with a separate generated password saved privately. Use **Auto Confirm User** so no email is sent. If this option is unavailable, stop and report it; do not use real addresses or invite emails. Report only the two UUIDs.
3. The operator creates a `public.profiles` row for each UUID through trusted administration, with synthetic display names, selected timezone and units. Auth creation alone does not create a usable profile. No provider consent or spending is provisioned automatically. Missing allocations keep inference denied; do **not** invoke the positive-ceiling budget transaction with zero.
4. Keep **Storage** without buckets/objects. Review **Settings → Data API** exposure: only the intended public application schema, RLS on owned tables, no private schemas/admin credentials exposed. Do not alter reviewed function grants or disable RLS to fix access errors.

Before deploying, the operator verifies `.vercelignore`, reviewed source/migration/config hashes, source project/region and all variable scopes. Export the reviewed candidate into an isolated ignored directory, then copy the generated `vercel.json` over that directory's root configuration. Verify every other file against the candidate using Git clean filters, and verify the overlay against the generated configuration hash. This preserves the repository's generic fail-closed configuration.

Bind the project's build command to the generated `build:hosted` command with its exact source reference, Vercel project ID and app origin. Execute the CLI **with the isolated directory as the actual process working directory**, supplying the approved project and workspace explicitly. CLI 62.5.0 attempts from the repository root using `--cwd` uploaded the correct config but resolved the wrong routing/build configuration; those flags alone did not establish binding. Record the immutable deployment ID, candidate/config hashes and assigned hostname. Require the public probe to pass on the canonical alias before handoff. No command in this document deploys automatically.

## Current synthetic sign-in handoff

The approved Step 3C deployment is [vulpes-synthetic.vercel.app](https://vulpes-synthetic.vercel.app). Its [dated evidence](../evidence/owner-pilot-hosted-setup.md) identifies the immutable deployment and bounded checks. Only synthetic identities are provisioned; public signup and anonymous signup are disabled. No email is sent. Ask remains unavailable, provider consent/budgets are absent and production evidence is uninstalled.

The owner confirmed this sign-in/navigation/logout handoff worked on 2026-11-01. This closes the initial owner login check, not the later trusted password-reset/revocation or family identity-verification gates.

On the setup Windows account, the owner can run the ignored `.scratch/hosting-owner-pilot/show-pilot-login.ps1` from a private PowerShell window. The script reads only the DPAPI-protected synthetic owner credential file, validates its project/email binding, and displays credentials only after the owner types `SHOW`. It has no network calls and changes no account settings. Store that login in a password manager, close the terminal, open the site and sign in. Never paste the password, terminal output or a screenshot into chat. If PowerShell blocks the script, report the policy error without changing execution policy.

Verify **Ask Vulpes** shows the unavailable explanation and disabled Send; open **Data**, **Goals**, and **Settings**; use **Sign out**, wait until **Sign in** is enabled, then reload to confirm it stays signed out. Report only whether these steps work and any exact nonsecret error. Do not enter personal measurements, enable consent/budgets or invite another person. This is synthetic review, not real-data pilot authorization. Windows DPAPI protects the files under this Windows account; it is not separate backup/key custody.

## Hosted verification and recovery gate

After approved deployment/read checks, the operator can run:

```sh
npm run hosting:probe -- --manifest=.scratch/hosting/<target-hash-prefix>/manifest.json --allow-hosted
```

This sends at most 14 unauthenticated GETs, no cookies/tokens, no redirect following. It checks public deep links, exact HTML CSP/security headers, status JSON, unknown API JSON and unauthenticated rejection/no-store on named APIs. It stops at first failure and emits only paths/outcomes. Unexpected bodies are not logged; expected public JSON is limited to 4 KiB. Vercel login/protection redirects fail the probe; do not disable protection or mint a bypass token without reviewing the reason and scope.

The public probe cannot bind an alias to a commit, verify authenticated inference state, prove two-user isolation or establish recovery. Complete these separate checks and record safe results against the immutable deployment:

### Repeatable security preflight

`npm run hosting:security -- --plan` is inert: no credentials, files or network. After approved synthetic reads, the operator may run `npm run hosting:security -- --manifest=<generated-manifest> --allow-hosted` with a private stdin JSON object containing only `projectRef`, `publishableKey` and exactly two `users` (`id`, `.invalid` email, `password`). Extra administrative/trace/provider keys and non-synthetic addresses are rejected. Read the existing DPAPI files into memory and project only those fields; never paste credentials into arguments, chat, Git or a command transcript.

The preflight permits at most 100 requests per invocation, no redirects/cookies, 15-second request deadlines and 64 KiB JSON responses. It reads all 19 table access boundaries, samples only owner IDs (two rows per readable table), checks foreign profiles, owned API schemas, unavailable inference, absent consent/allocation and malformed-query JSON/no-store responses. Password sign-in creates only its own test sessions; local sign-out revokes those sessions and old access tokens must fail both application and direct profile reads. It leaves existing browser sessions alone. Ordinary API read-time expiry can still run. No fixture/domain writes, export, deletion, password reset, maintenance, backup, deployment or model calls occur.

The report contains check names/counts and sampled row counts, never identities, tokens, passwords or private response bodies. Empty samples remain explicit and `populatedIsolation` remains `pending` even when the preflight passes. This prevents empty tables from being presented as full SEC-02/SEC-03 proof. [Step 3D evidence](../evidence/owner-pilot-step3d.md) owns observed results and approval boundaries.

### Remaining Step 3D packets

| Packet | Scope and checkpoint | Required owner decision |
|---|---|---|
| 3D.1 security preflight | Current deployment, all table access boundaries, malformed reads and ended test-session denial; no application deployment | Approved synthetic reads; passed, with populated-isolation gaps |
| 3D.2 populated security/lifecycle | Synthetic manual/CSV, correction, explicit goal approval, conversation/export, populated isolation, foreign-parent/write denial, trusted reset and interrupted/resumed deletion | Approved and passed 2026-11-01. Both newly created disposable identities were removed; original accounts preserved. Evidence records scope and remaining gaps |
| 3D.3 hosted maintenance | Reviewed additive migration and hosted owner-scoped inspection, bounded cleanup, deletion resumption and receipt retention passed | Approved/completed 2026-11-01; owner accepted manual maintenance ownership. No scheduler or application deployment |
| 3D.4 hosted-source recovery | [Consolidated PR #32](hosted-recovery.md#combined-step-3-execution-checkpoint) prepares encrypted journal/database capture, fenced replay, actual isolated Auth/API, current accounting and export crash cleanup; custody and hosted evidence remain | Complete the grouped owner setup and approve the concrete source-read/output/fenced-restore rehearsal before hosted execution; keep its evidence in PR #32. No source/unrelated project overwrite |

The 3D.2 batch is complete; its approval does not authorize creating replacement accounts or repeating the batch. The trusted `scripts/hosted-lifecycle.ts` rehearsal module uses the existing product APIs plus scoped administrative fixture/reset checks, without a public administration endpoint. The private operator adapter binds the approved source/project/origin, validates each phase, loads a preallocated DPAPI-protected plan, and saves create-only ownership/phase artifacts before later reset/deletion. Remote Auth metadata and local creation receipts must agree. Existing emails, mismatched receipts or rehearsal markers stop writes. Exported synthetic documents remain ignored/private and are not backups. Preserve the completed plan/evidence; never reset retained Luna allocations or install provider credentials.

All five 3D.2 hosted phases passed: provision, populated journey, reset, deletion start, and deletion resume in a separate process. Its independent source query confirmed two original identities/profiles, zero measurements/goals/conversations/private payloads, two completed deletion receipts and no unfinished deletions. [Step 3D evidence](../evidence/owner-pilot-step3d.md#step-3d2-approved-hosted-lifecycle) records the browser account switch, exact arithmetic, export integrity and remaining unpopulated execution/accounting/trace coverage. The subsequent 3D.3 database rehearsal also passed; backup capture/restore still needs separate custody/destination approval.

### Hosted maintenance operator procedure

`maintenance:hosted` provides bounded account-scoped database inspection/cleanup and existing-deletion resumption. The owner approved its hosted rehearsal and accepted manual maintenance ownership on 2026-11-01. [Step 3D.3 evidence](../evidence/owner-pilot-step3d.md#step-3d3-approved-hosted-maintenance) binds candidate `da72629`, the exact 39-migration source history and actual hosted results. The new service-only RPC migration is applied; the Step 3C application deployment remains unchanged. Ordinary CI/local tests use only local Supabase and injected transport.

The completed apply used a fresh ignored work directory from the reviewed candidate and retained the original 38-migration artifacts. All hashes matched and dry-run listed **only** `20261101000100_owned_maintenance.sql`. Do not reapply it or recreate the closed fixtures. Any future approved migration must have its own reviewed manifest/dry-run; no reset, changed table/grant workaround, `--include-all`, application deployment or unrelated project access is authorized. Stop on unexpected history or pending migrations.

The private stdin object contains `publishableKey`, server-only `adminKey`, `limits`, and `authorization` with `purpose: synthetic-maintenance`, `mode: inspect` or `execute`, exact `targetSHA256`, explicit `owners` UUIDs, `approved: true`, and `expiresAt` no more than 24 hours ahead. Extra fields are rejected. Load keys from the existing protected local file into memory; never put them in command arguments, chat, screenshots, logs or public environment variables. No provider, database-password or trace key is required. A fresh execute authorization cannot be inferred from an inspect authorization.

Run `npm run maintenance:hosted -- --manifest=<reviewed-manifest> --inspect --allow-hosted` through the private operator wrapper first. Review counts, `pendingHolds`, `retryAfter` and `unfinished`; then, only under execute approval, use `--execute` instead of `--inspect`. Reports contain counts/account indexes, not IDs or private content. Wrong source/hash/mode, expired authorization, nonsynthetic identities, absent identities without an owned valid deletion journal or an unavailable migration stop the command. An unfinished journal allows resumption when Auth removal already succeeded. Preserve every report rather than overwriting failed attempts.

Completed initial hosted rehearsal, **explicitly approved on 2026-11-01**:

| Action | Exact scope |
|---|---|
| Database change | Apply only the reviewed additive 39th migration, creating one service-only function; retain all existing tables, roles and local guards |
| New fixture identities | `vulpes-maintenance-a@example.invalid` and `vulpes-maintenance-b@example.invalid`; preallocate UUIDs/passwords into DPAPI, refuse existing names, tag/verify creation receipts before writes |
| Expiry/isolation | Seed only their synthetic expired encrypted payloads and pending proposals; inspect without writes; clean A in bounded passes while verifying B/original accounts unchanged |
| Deletion resumption | Initiate deletion only for these new disposable fixtures through the existing product flow; let the maintenance command resume it and independently verify Auth/data absence |
| Receipt boundary | Age only A's completed synthetic fixture receipt to 32 days and prove it is pruned; retain B's fresh receipt and the earlier Step 3D.2 receipts. Do not change the clock or retention constants |
| Limits and costs | $0 paid spending, no positive budgets, provider consent/calls, application deployment, scheduler, backup export or restore |

The owner is the accepted manual maintenance operator. During an authorized pilot, request inspection/maintenance at the start of each day of use, after inactivity or an interrupted run/deletion, and before relying on retention/recovery evidence. Record date, candidate, target hash and safe report. Repeat bounded work only within the approved account/action scope while eligible work remains; wait until `retryAfter` for future uncertainty, and investigate repeated busy/error/no-progress results. Do not shorten holds or replenish budgets. This is a manual operational procedure, not an unattended schedule or 24/7 guarantee; ownership is not blanket mutation approval.

No dashboard work or new secret entry was needed for this rehearsal; existing protected source credentials were used privately. Both new maintenance fixtures were deleted, only A's aged receipt was pruned, and the two original identities/budget state and both earlier receipts remained unchanged. B's fresh receipt remains, giving three completed receipts and no unfinished deletions. The completed batch does not authorize replacement accounts, another batch or mutations of the originals. Hosted export crash-file cleanup and backup/journal/key custody/rotation remain separate gaps; the database pass does not close Step 3D or authorize real data.

Supabase documents [platform-to-self-hosted restoration](https://supabase.com/docs/guides/self-hosting/restore-from-platform), including separate configuration and version-compatibility checks. That supports investigating a local destination; it does not establish Vulpes recovery correctness. Compare the actual hosted/local Auth/schema/grants/ownership versions and preserve required data. Do not adopt troubleshooting shortcuts that discard unknown Auth rows/columns or skip failed restores. The existing superuser local-source `backup:verify` remains insufficient for managed hosted-source evidence.

### Acceptance still required

| Required hosted check | Pass condition |
|---|---|
| Auth and deterministic use | Both synthetic users sign in; settings, manual/CSV preview/import, correction, goals and export work; refresh/logout/account switch clear private state; unauthenticated signup fails |
| Two-user API/direct RLS | Each identity sees only its own data, conversations, runs, proposals and export; cross-user parent IDs/direct reads/writes denied; service credentials stay out of the public bundle |
| Inference unavailable | Authenticated status, Settings and Ask honestly report disabled/unavailable; no provider keys, requests, unexpected fallback or positive production ceiling |
| Headers/cache/streaming | Deep links, malformed/unknown APIs, account rewrite, no-store, CSP, PWA public-only caches and stream lifecycle tested on actual hosting; inference-on streaming remains a later gate |
| Deletion and maintenance | Separately authorized synthetic deletion interrupted/resumed; authoritative journal/Auth absence checked, private payloads removed, uncertainty charges preserved; approved hosted bounded maintenance method and operator cadence demonstrated |
| Separate recovery | Authenticated encrypted backup and current independent deletion journal survive source loss; restore to fenced separate destination; verify schema/ownership/grants/RLS/Auth, trace key versions, post-backup deletion replay, then revoke sessions before approved access |
| Recovery failure cases | Missing/stale journal, missing key, corrupt/expired archive, unfinished deletion and populated/wrong destination block access; no source overwrite |
| Credential handoff | Trusted synthetic password reset revokes old sessions; fresh login works; private handoff documented without SMTP or project-team invitations |

Before a restore, fence the recovery destination against browser, Auth and Data API access and keep inference off. Do not rely on signup-disabled, an obscure URL, or application-only fencing while restored JWTs/direct APIs may still work. Prove the platform-specific fence before sending archive bytes. Supabase managed recovery has different privileges from the local superuser harness; a Free project does not promise paid clone/managed backup features. If a supported fence/restore path needs an upgrade, stop for a new cost/implementation decision.

With one hosted project, a zero-cost recovery candidate is restoring a hosted encrypted backup into a separate disposable local Supabase environment. Its compatibility, complete Auth/schema/grants/RLS recovery, current independent deletion journal replay, trace keys and session revocation must be implemented and demonstrated before it counts. The existing local-source `backup:verify` pass does not establish that hosted-source workflow. Never rehearse restoration over the source project or the unrelated existing project. Recovery remains a gate before owner real-data use even when synthetic hosting proceeds.

Choose an approved encrypted backup location and a **separate** key custody location. Rotate backups within 30 days; retain completed deletion receipts at least 31 days; keep unfinished records and independently current journal copies. Account CSV/JSON export is not a transactional backup. Prove deletion coverage and session revocation before restored access, then separately approve access. The scoped database method is verified and the owner accepted manual maintenance; backup/journal rotation and remote crash-file cleanup still need their own operational proof. No unattended scheduler is configured.

Step 3 ends only with recorded hosted security/recovery evidence or an explicit unresolved gate. It introduces no cosmetic UI work, optional models, paid scheduler, native connection or new product feature. Hosted Luna/Ask/device verification may begin only after the applicable security checkpoint and separate activation/spending approval. Real-data use remains forbidden until all required acceptance and owner-pilot gates pass.

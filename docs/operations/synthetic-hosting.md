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

Before deploying, the operator verifies `.vercelignore`, reviewed source/migration/config hashes, source project/region and all variable scopes. After explicit deployment approval, use the generated config through the CLI's [`--local-config`](https://vercel.com/docs/cli/global-options), with the exact reviewed checkout and project. Do not run an unreviewed generic `vercel --prod` or promote a build made for another environment. Record immutable deployment ID, source commit and actual assigned hostname before any checks. No command in this document deploys automatically.

## Hosted verification and recovery gate

After approved deployment/read checks, the operator can run:

```sh
npm run hosting:probe -- --manifest=.scratch/hosting/<target-hash-prefix>/manifest.json --allow-hosted
```

This sends at most 14 unauthenticated GETs, no cookies/tokens, no redirect following. It checks public deep links, exact HTML CSP/security headers, status JSON, unknown API JSON and unauthenticated rejection/no-store on named APIs. It stops at first failure and emits only paths/outcomes. Unexpected bodies are not logged; expected public JSON is limited to 4 KiB. Vercel login/protection redirects fail the probe; do not disable protection or mint a bypass token without reviewing the reason and scope.

The public probe cannot bind an alias to a commit, verify authenticated inference state, prove two-user isolation or establish recovery. Complete these separate checks and record safe results against the immutable deployment:

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

Choose an approved encrypted backup location and a **separate** key custody location. Rotate backups within 30 days; retain completed deletion receipts at least 31 days; keep unfinished records and independently current journal copies. Account CSV/JSON export is not a transactional backup. Prove deletion coverage and session revocation before restored access, then separately approve access. No current scheduler or local-only CLI establishes hosted cleanup. Assign the operator to inspect bounded maintenance after inactivity/interruption until a supported hosted method is verified.

Step 3 ends only with recorded hosted security/recovery evidence or an explicit unresolved gate. It introduces no cosmetic UI work, optional models, paid scheduler, native connection or new product feature. Hosted Luna/Ask/device verification may begin only after the applicable security checkpoint and separate activation/spending approval. Real-data use remains forbidden until all required acceptance and owner-pilot gates pass.

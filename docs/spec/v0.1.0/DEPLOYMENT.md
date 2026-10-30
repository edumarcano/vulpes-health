# Deployment and operating checklist

## 1. Operational scope

The repository contains the application and guarded local verification scripts. It does not provision hosted resources, credits or DNS. Local proof does not approve hosted migrations, real-data use or a family pilot. Follow the [account lifecycle/recovery runbook](../../operations/account-lifecycle.md) for storage inventory, interrupted deletion, retention, restoration and operator-assisted credentials.

## 2. Intended cost baseline

Vercel Hobby is intended for personal/noncommercial projects; use it for the private family pilot within the current terms and quotas. [S21](SOURCES.md#s21)

Supabase Free currently lists 500 MB database storage, 1 GB file storage, 50,000 monthly active users and inactivity pausing after one week. Managed automatic backups are not included; Pro starts at a paid baseline. Recheck pricing when deploying. [S22](SOURCES.md#s22)

**A zero-dollar hosting/database baseline is possible, not guaranteed.** Model inference remains separately metered. Storage, traffic, traces, future reference documents, email delivery, a domain and any later scheduler/search service can incur costs. A model budget does not cap infrastructure bills.

Use the supplied Vercel domain initially. Do not buy a domain or upgrade a plan without the owner's approval. Monitor database and trace size; exact prompt logs can dominate small health records. Do not keep free projects awake with artificial traffic as a substitute for an appropriate service plan.

## 3. Prerequisites

Owner-controlled private Git repository; Vercel Hobby project; Supabase project; OpenRouter key with the intended privacy/spending controls; Google Cloud billing/project and model access; a secure server trace-encryption key.

Use the current supported Node LTS and a pinned package-manager version compatible with the selected dependencies. Record versions after installing; this package intentionally does not freeze an untested lockfile.

## 4. Development environments

Prefer local Supabase for automated integration tests. Use synthetic fixtures only. The browser talks to the local API through a deliberate proxy or `vercel dev`; `vite dev` alone does not make Node function routes work. Provide one documented command that starts a full working local stack.

Repository scripts:

| Command | Expected behavior |
|---|---|
| `npm run dev:full` | Frontend + API development with the documented local services |
| `npm run build` | Production client/function typecheck and build |
| `npm run lint` | Code and boundary checks |
| `npm run typecheck` | Strict TypeScript checks |
| `npm test` | Deterministic unit tests without paid calls |
| `npm run test:integration` | Local database, RLS, approvals and budgets |
| `npm run test:e2e` | Browser workflows with synthetic users/data |
| `npm run test:providers` | Explicit opt-in paid smoke tests, with a bounded budget |
| `npm run maintenance:cleanup` | Delete expired staging/trace/export payloads |
| `npm run backup:verify` | Documented backup/restore checks; not merely a file-exists check |
| `npm run test:lifecycle-upgrade -- --allow-disposable-reset` | Populated forward migration proof on an empty disposable synthetic stack |
| `npm run account:recover` | Local operator-assisted reset through protected interactive input and session revocation |

Never enable live model tests in ordinary CI. Log only safe operational metadata.

## 5. Supabase setup

Apply reviewed migrations, RLS policies, indexes, strict function grants and storage policies. Disable public signup. Provision the owner through trusted admin tooling; do not expose an account-creation endpoint to the public.

Configure production and local redirect URLs narrowly. Do not make health buckets public. Configure legitimate invitation/recovery email delivery before relying on email flows for family accounts; default Supabase SMTP has restrictions. [S19](SOURCES.md#s19)

Export and test backups before real use. Keep schema, RLS, functions, Storage objects and necessary encryption key versions recoverable. Document Supabase Auth recovery separately; a measurements CSV is not a complete account/database restore.

## 6. Vercel setup

Use Vite framework detection and the root `vercel.json` build/output and route configuration, including `/api/account` through the Settings entry point. `config/vercel.example.json` is a minimal SPA shape reference. Verify hosted deep links and API errors separately; unknown API paths must not return `index.html`.

Set server secrets only in server environments; the public client receives only Supabase's URL/publishable key and public app metadata. Disable live inference and use synthetic data in preview deployments. Do not give fork/PR previews production credentials or production database access.

Choose a deployment region deliberately; keep it close to the database where practical. Configure a 240-second function limit with an application deadline of 210 seconds and smaller model timeouts. Streaming does not bypass function duration limits. [S07](SOURCES.md#s07)

Review the Vercel team's/project's optional AI-training data preference before pushing private code. Vercel's documented Hobby default includes an opt-out control; this concerns its stated platform-data program and is not a substitute for protecting runtime health data. [S25](SOURCES.md#s25)

No Vercel AI Gateway is required: Vulpes uses its own adapter boundary to the selected OpenRouter and Google providers. Do not add another proxy simply because Vercel hosts the frontend.

## 7. Provider activation order

Configure auth/database/trace encryption first. Then enable Luna using synthetic prompts and a strict temporary spend cap. Verify the exact request and usage trace. Next test Flash and Argon via the actual Google Cloud project. Decision scoring remains optional until its own contract, privacy and routing tests pass.

Set the live-call flag only after complete rate configuration, output bounds and approved provider consent. A successful unauthenticated public model lookup is not a successful provider smoke test.

## 8. Family pilot gate

Use two test users to prove separation at API, database, Storage, exported traces, cached responses, conversation history and budget level. Verify that the family user cannot raise an operator allocation or see household health content.

Test secure onboarding/recovery, export, interrupted deletion, backup/restore, logout/account switching and a revoked provider consent. Explain that the app is a private wellness prototype and that its operator can access backend data.

Family users can use the PWA with imports immediately after these gates. Automatic Health Connect requires the later native Android integration on each person's phone and that person's authorization; no family-wide phone-health permission exists.

## 9. Operational runbook

When a provider fails, retain privacy constraints, show role unavailability and do not retry into an unapproved provider. When credits/budget are exhausted, keep data/goal browsing and export working. When a trace cannot be saved, do not initiate another unlogged paid call.

Review actual provider spend against app reservations, database/storage usage and failed-run holds regularly during the pilot. Clean up expired data, rotate secrets when necessary, and test one restore before declaring family readiness.

Do not claim 24/7 monitoring, guaranteed background inference or continuous availability on the free-tier prototype.

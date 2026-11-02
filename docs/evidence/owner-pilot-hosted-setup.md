# Owner-pilot Step 3C: synthetic hosted verification

Current checkpoint: the approved synthetic deployment passed bounded technical verification on 2026-11-01. The owner subsequently confirmed the sign-in/navigation/logout handoff worked. [Step 3D](owner-pilot-step3d.md) is in progress; broad security/recovery remains pending. Ask inference is off; this is not real-data authorization.

## 2026-10-31 setup record

Date: 2026-10-31. Application candidate `bf42111120e287e4b709ea073bfae31ba91f5048`, PR #28, stacked on #27 and unmerged. Both candidate checks passed in [CI run 41264126258](https://github.com/edumarcano/vulpes-health/actions/runs/41264126258). The owner explicitly approved synthetic migrations/deployment with inference off and $0 paid spending. This record does not authorize real data, provider activation, recovery destruction or automatic merge.

### Verified hosted work

| Interface/check | Observed result |
|---|---|
| Scoped Management API project read | Correct source reference, `us-east-1`, `ACTIVE_HEALTHY`, PostgreSQL `17.11.0.011` |
| Read-only source preflight | Zero public relations/functions, Auth users, Storage buckets/objects and no migration history |
| Supabase CLI 2.122.0 `db push --project-ref=<approved-source> --workdir=<ignored-generated-copy> --skip-vault --dry-run --agent yes` | Exit 0; exact 38 reviewed migrations listed; copied/source hashes match |
| Same pinned CLI target, `--yes` replacing `--dry-run` | Exit 0; all 38 migrations applied without reset, extra migrations, seeds or vault updates |
| Independent read-only migration-history query | Exact ordered 38-version equality with the reviewed manifest |
| Post-migration schema | 19 public tables; zero tables without RLS; zero profiles, Auth users and Storage objects |
| Vercel Production environment metadata | Seven required variables, Production only: three private values are Secrets, four public/operational values are Config; no provider credentials |
| Local hosted guard using protected source credentials and bound platform identity, `--check-only` | Valid synthetic-only configuration, inference false; build not run |
| Vercel CLI 62.5.0 source dry-run | 414 candidate files; no private upload paths; no upload/deployment |
| Public Auth settings | Email/password enabled; **public signup still enabled** (`disable_signup: false`), blocking publication |

The scoped token and selected source/trace keys are stored locally using Windows DPAPI, excluded from Git and uploads. Secret values travel to the Vercel CLI through stdin, never arguments or published logs. The trace key was generated from 32 cryptographically random bytes and was not rotated on retries. The owner confirmed Vercel optional training/sharing opt-out; Vercel account MFA was independently reported enabled. Root local-test configuration and retained Luna allocations remain untouched. No unrelated Supabase project was accessed.

The initial CLI summary counted one array container rather than its 38 migration-version entries. A separate read-only projection confirmed all 38 versions; no migration was repeated. The original summary and corrected count remain in ignored evidence. Raw CLI output, target manifests, encrypted credentials and safe operational receipts remain under `.scratch/hosting-owner-pilot/` and `.scratch/hosting/`; they are not public release artifacts.

### Remaining checkpoint at setup

The token intentionally has no Auth configuration write permission. The owner must disable global public signup and anonymous sign-ins while keeping email/password enabled, then configure the exact site URL and narrow redirects. Verify those settings before publishing. Synthetic identities/profile provisioning, authenticated API/direct-RLS checks, immutable deployment/build binding, actual hosted CSP/routing/cache behavior and readable disabled Ask/Settings states remain unverified. Row-security flags alone do not prove isolation.

The actual deployment count remains zero. Additional paid spend and provider requests are zero. Separate hosted-source recovery/maintenance, backup/journal/key custody, device and formal acceptance gates remain pending; recovery is deferred, not passed. See the [operator procedure](../operations/synthetic-hosting.md) and [execution ledger](../plans/v0.1.0-execution.md#owner-pilot-continuation).

## 2026-11-01 deployment checkpoint

The owner confirmed the Auth settings. Public Auth independently reports `disable_signup: true`, with email/password enabled and anonymous signup rejected. Exact site URL `https://vulpes-synthetic.vercel.app` and empty redirect list are owner-attested; the scoped setup token has no Auth configuration permission. Two synthetic `.invalid` email identities and UTC/metric profiles were provisioned without email, consent or spending allocations. Storage remains unused. No unrelated project was accessed.

| Binding | Recorded value |
|---|---|
| Application candidate | `bf42111120e287e4b709ea073bfae31ba91f5048`; later commits change documentation only |
| Frozen source verification | 432 files matched through Git clean filters; one explicit generated `vercel.json` overlay matched |
| Generated target SHA-256 | `b956bd10911ee9ff554b4f1d9ec3cf23f8833d3efc79619f2fd96bd8fe2a644c` |
| Generated config canonical SHA-256 | `54f3e552766c6389f82dd42b7e7f4fdb9a8b88a882259846d33c0c686bc7f9df` |
| Source / region | `vatwmqzjymbhaodwatyn` / `us-east-1` |
| Vercel project / region | `prj_k4kQU4k9DVnjskslngj7QbYA7zvW` / `iad1` |
| Current immutable deployment | `dpl_Cdw4DeExKHYHzT66wdDu1Njd3UXN`, READY, Production channel |
| Immutable URL | [Candidate deployment](https://vulpes-synthetic-3ir0l7qgy-edumarcano30-5426s-projects.vercel.app) |
| Independently resolved alias | [vulpes-synthetic.vercel.app](https://vulpes-synthetic.vercel.app), same project/deployment, READY/iad1 |

The source receipt binds a frozen local candidate and configuration overlay to the CLI upload; it is not signed remote Git attestation. The 411-file frozen upload excludes private paths. Root local-test Supabase state was not linked, and the repository was not linked to Vercel. Server variables remain Production-only, with no provider credentials. The successful hosted build ran the exact guarded command:

```text
npm run build:hosted -- --project-ref=vatwmqzjymbhaodwatyn --project-id=prj_k4kQU4k9DVnjskslngj7QbYA7zvW --app-origin=https://vulpes-synthetic.vercel.app
```

The deployment CLI ran from the actual isolated candidate directory with its generated root `vercel.json`, explicit project/workspace and `--prod --json --no-wait --non-interactive`. Production is the synthetic project's hosting channel, not authorization for model inference.

| Actual interface | Result and boundary |
|---|---|
| SDK sign-in and `owned_session_valid_v1` | Two successful synthetic sign-ins and two valid owned sessions |
| Direct profile RLS | Each profile visible to its owner, both cross-profile reads empty; anonymous profile read denied; broader table/write/parent-ID isolation pending |
| Production administrative-client RPC | Actual `administrativeClient()` read-only `private_payload_expiry_v1(import_staging)` call succeeded with source server key |
| Public hosted probe | Exit 0, all 14 probes passed: four deep links, public status, unknown API JSON 404, eight protected API JSON 401s; exact Supabase CSP origin and required security/cache headers |
| Authenticated hosted APIs | 12 checks passed: each identity's `/api/status`, `/api/settings`, `/api/account`, `/api/data?view=sources`, `/api/conversations`, `/api/goals`; DTOs, owned profile, empty data, JSON/no-store and disabled inference verified |
| Actual mobile Chromium UI | 390×844 viewport; both accounts signed in, opened Ask/Data/Goals/Settings, saw unavailable Ask and disabled Send, signed out completely and remained signed out after reload; 10 account/page checks passed |
| Loaded browser assets | Current administrative key, trace key and both synthetic password canaries absent from loaded JS; no browser page errors. Not a scan of every possible lazy asset |
| Owner credential helper | Ignored DPAPI-only handoff script parsed without errors; project/email binding checked without displaying the password. Human execution/sign-in pending |

The public probe was run with:

```sh
node node_modules/tsx/dist/cli.mjs scripts/probe-hosting.ts --manifest=.scratch/hosting/b956bd10911ee9ff/manifest.json --allow-hosted
```

Private fixed-target TypeScript probes under `.scratch/hosting-owner-pilot/` exercised actual SDK/API/browser paths. DPAPI-protected credentials were passed through stdin; reports contain only assertion/status summaries. No browser traces, recordings, credentials, response bodies, prompts or private logs were published. Raw receipts remain ignored; these results are bounded operator evidence, not a general hosted integration suite.

### Failed attempts and diagnosis retained

| Attempt | Observed failure and resolution |
|---|---|
| Initial PowerShell Auth administration | Default PowerShell browser-like User-Agent returned 401 for the new server secret key; actual Supabase SDK worked. Read-only comparison returned 401 with the default User-Agent and 200 with an explicit backend User-Agent. No application key adapter change or grant workaround was needed |
| Isolation fixture | A Hashtable note property did not serialize the identity ID. The first cross-profile query returned 400/22P02; a new protected complete credential file reused the same account/password and unchanged RLS assertions passed. Original fixture retained |
| `dpl_CMUJUyBoD1NCk56MNFrkCVS1sKoJ` | Failed build guard because the project used the generic unbound build command |
| `dpl_LZVtiKUCUwEUkVLCYj2G7KXb12vg` | READY but failed the public probe: deployed HTML CSP allowed only self. Correct generated config was uploaded, but invocation from the repository root using `--cwd` resolved incorrect routing configuration |
| Current deployment | Executing from the actual isolated directory, with exact project build command and generated root configuration, passed all 14 unchanged public probes |
| First browser logout assertion | Checked storage when the login heading appeared during “Signing out…”, before completion. Diagnosis showed storage cleared and reload stayed signed out. The probe now waits for enabled Sign in (completed operation), then checks storage absence and reload. Application code unchanged |

Three deployments were created, including the failed build and rejected CSP candidate. Current alias resolves to the third deployment. Additional paid spending is $0; provider requests are zero, and no real health data, provider activation, paid upgrade or merge occurred. Supabase Free and Vercel Hobby quotas are still operational limits; no paid fallback is approved.

### Self-review and next checkpoint

Axis 1: the approved initial hosted migration/deployment and disabled Ask checkpoint has direct HTTP, SDK and browser proof. Human credential handoff remains pending. This evidence does not satisfy broad hosted isolation, recovery, device or formal P0 acceptance.

Axis 2: candidate/config identity, exact CSP, private upload boundaries and loaded-bundle secret canaries were checked. Setup and probe errors were retained and corrected without relaxing security assertions or changing application code. No blocking finding remains for this bounded technical checkpoint; wider operational gates remain explicit.

The documentation follow-up passed `git diff --check` and `python docs/spec/v0.1.0/scripts/validate_spec_package.py` (516 specification/fixture checks). No application changes followed the deployed candidate, so existing candidate CI/build results retain their original revision rather than being claimed as a new test run.

Step 3D preparation can begin. Before destructive hosted exercises or backup export, agree on named disposable synthetic identities, a fenced separate restore destination, encrypted backup location, separate key/current-journal custody and maintenance ownership. With only one hosted project, a disposable local recovery destination is still an unverified candidate. Never restore onto the source or unrelated project. Session revocation, full API/direct-RLS/write/parent-ID isolation, deletion/export/retention, malformed API/PWA/stream checks, physical Android/accessibility, formal acceptance and later model activation remain outstanding. Owner sign-in instructions are in the [operator procedure](../operations/synthetic-hosting.md#current-synthetic-sign-in-handoff). Keep the setup PAT private and revoke it through the owner's token settings when no further approved setup reads are needed; do not revoke application server/trace keys.

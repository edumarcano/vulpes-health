# Owner-pilot Step 3A: hosting preparation

Date: 2026-10-31. Branch `feat/owner-pilot-hosting-preparation`, base `25319a470126a499cbda5cc6c18f386254293abb` (Step 2, PR #27). This packet prepares synthetic hosting; Step 3's hosted security/recovery checkpoint is unfinished. [Machine-readable record](owner-pilot-step3.json), [operator/owner procedure](../operations/synthetic-hosting.md).

The measured Step 3A implementation was committed as `6e6a5424dd0b063195de7aa194bc2b3ad5c0fffb`; both GitHub checks passed in [CI run 41258199993](https://github.com/edumarcano/vulpes-health/actions/runs/41258199993). Its captured source fingerprints and results remain historical. Subsequent resource approval/creation is tracked in the [execution ledger](../plans/v0.1.0-execution.md#owner-pilot-continuation), without relabeling these local-only observations as hosted verification.

## Delivered behavior

Preparation validates public source/recovery/project/origin/region bindings and writes create-only ignored Vercel configuration plus 38 migration copies and hashes. It reads no credentials and sends no network requests. The hosted build requires that exact project/production hostname, valid public auth and server-only encryption/admin configuration, disabled inference and no provider configuration. Root unbound builds fail. Git deployments stay off; private local files are excluded from uploads.

The static root CSP reproduction returned `configuredSupabaseOriginAllowed: false`, `connectSourceIsSelfOnly: true`, exit 1 before repair. Generated hosting and Vite now share the validated exact-origin header function. This is a functioning-auth prerequisite; no cosmetic work is included. Explicit Goals/Approvals API entries avoid relying on platform filesystem precedence, which remains unverified on Vercel.

The opt-in probe checks 14 public GETs: four HTML deep links, public status, unknown API and eight unauthenticated API rejections. It omits credentials, refuses redirects, bounds expected JSON to 4 KiB, emits paths/outcomes only and stops at first failure. It explicitly leaves authenticated isolation, inference activation, deployment identity and recovery unverified.

## Commands and observed results

| Command/interface | Observed result |
|---|---|
| `npm run hosting:prepare -- --plan` | Zero network/deploy plan; no target or credentials required |
| `npm run hosting:prepare -- --target=.scratch/hosting-proof/target-final.json` | Exit 0, 38 migrations, target `fa6182d3d9d2655ee11fceedde334117c770903b6c4b41934a8dac659afef9e7`; repeat exit 1 without overwriting |
| `npm run build:hosted` without binding | Exit 1 before build/provider/network execution |
| Local `build:hosted` with synthetic credential canaries/platform identity | Exit 0, strict build, 15 public files inspected; admin/encryption/unused-platform canaries absent; zero deployment/provider requests |
| Real local HTTP using generated headers/routes and actual application handlers | Final exit 0, all 14 public checks passed; zero hosted requests |
| `npm run hosting:probe -- --manifest=missing` without opt-in | Exit 1 before target/credential/network access |
| `npm test` | 366 tests in 31 files passed; hosting cases cover exact CSP/project/env binding, unsafe targets, credential/public-variable rejection, opt-in and malformed/oversized bodies |
| `npm run lint`; `npm run typecheck` (also executed by builds) | Passed |
| `npm run test:bundle` | Strict production build passed; 15 files, no secret canaries/source maps/server catalog/harness |
| `npm run test:pwa` | One local Chromium public-cache/offline-privacy check passed |
| `npm run test:spec` | 515 specification/fixture checks passed |

The first local HTTP attempt failed at `/api/status`: the probe's strict schema omitted the existing `request_id`. One Windows native async-close assertion followed that failed harness exit. Correcting the probe envelope (not the handler) produced a clean 14/14 exit. Strict schemas now also reject unexpected fields. No exact native-exit root cause is claimed. An earlier scoped unit failure used an incorrectly constructed HTML fallback fixture and was corrected before the final suite. No runner assertion or production boundary was weakened.

Raw logs, generated artifacts and synthetic secret canaries remain ignored under `.scratch/hosting-proof`. The local HTTP harness applies generated routes/headers to actual Node handlers; it does not emulate Vercel execution, hosted Supabase/Auth or platform backup privileges. No database reset/integration rerun was needed locally for this configuration/tooling packet; existing full CI covers those regression paths. The build retains its existing large-chunk warning; splitting cosmetic/performance work is deferred.

## Split-axis self-review

**Axis 1, specification fulfillment:** Approved for local preparation scope. Exact hosted auth origin, disabled defaults, provider independence, explicit checkpoints and owner credential/cost guidance are implemented and locally exercised. Hosted deployment/Auth/RLS/maintenance/recovery, streaming on hosting, Android and formal acceptance remain unmet gates, explicitly separate from 3A. No inference evidence was installed, no budget reset, optional model activation or schema change.

**Axis 2, engineering/security/test assurance:** Approved with observations. Strict public target schemas prevent arbitrary deployment arguments/origins; create-only output preserves operator state; existing Auth/encryption validation is reused; build/probe errors omit secrets and bodies; uploads exclude private state. Tests distinguish wrong-project/wrong-origin/provider/public-secret configurations from valid input and reject API HTML fallback/malformed or oversized JSON. Real CLI/build/HTTP and PWA proof supplement mocks. The public probe is intentionally narrow and platform fencing/restore compatibility remains an external acceptance gap. No demonstrated blocking defect remains in this packet.

## External use and next gate

One read-only Vercel project inventory returned no matching Vulpes project in the connected account. No local Vercel/Supabase link was present. Supabase resource state has not been inspected, and no resources were created/changed. Paid requests/deployments/real records: **0**. Actual/max additional spend: **$0/$0**. Existing Step 2 evidence, key/allocation holds and disabled production bindings remain untouched.

Next is explicit Step 3B approval for the named Free/Hobby resources and region, followed by manual secure account setup. Review/merge is separate. Source migrations, synthetic deployment, protected backup custody and destructive recovery rehearsal require their named approval before execution. Hosted Luna and real-data use remain forbidden. No approved specification deviation.

# Release evidence and deployment handoff

Vulpes is **not release ready or pilot authorized**. Local synthetic verification does not establish current-model quality, hosted behavior, physical-device usability or a supported family credential handoff. The [generated report](../evidence/release/m6-local.json) preserves PR 17's recorded outcomes; the [PR 17 evidence](../evidence/pr17-integrated-acceptance.md) explains their scope and remaining gates. The [M5/M6 remediation record](../evidence/m56-review-remediation.md) owns follow-up local verification without overwriting historical failures.

## Reproduce local evidence

Use the pinned Node/npm toolchain, installed locked dependencies, local Docker and Python for specification validation. No hosted credentials, provider key or populated environment file is needed. The command copies the candidate into `.scratch/pr17-verification`, uses project `vulpes-health-pr17-test`, API/database ports 27421/27422 and development port 25173, and links the existing dependencies. It excludes actual environment files and linked-project state. The committed `.env.example` is a public validation fixture.

```sh
npm run evidence:release -- --prepare
npm run evidence:release -- --check=lint
npm run evidence:release -- --check=typecheck
npm run evidence:release -- --check=unit
npm run evidence:release -- --check=build
npm run evidence:release -- --check=bundle
npm run evidence:release -- --check=spec
npm run evidence:release -- --check=start
npm run evidence:release -- --check=reset
npm run evidence:release -- --check=upgrade
npm run evidence:release -- --check=dbLint
npm run evidence:release -- --check=dbTests
npm run evidence:release -- --check=dbTypes
npm run evidence:release -- --check=integration
npm run evidence:release -- --check=integrationThreads
npm run evidence:release -- --check=executions
npm run evidence:release -- --check=evaluations
npm run evidence:release -- --check=providers
npm run evidence:release -- --check=cleanup
npm run evidence:release -- --check=restore
npm run evidence:release -- --check=browser
npm run evidence:release -- --check=development
npm run evidence:release -- --check=pwa
npm run evidence:release -- --check=stop
npm run evidence:release
```

Run persistence/browser checks serially. `reset` and `upgrade` are destructive only inside this explicitly disposable project; never reset retained M3 verification allocations. `restore` refuses a populated source/destination and stops its separate target in `finally`. Stop the source even after failed checks. An existing verification copy is preserved; inspect it before `--sync`, which updates source files without resetting its database. Changes invalidate previous executable-content fingerprints and require affected checks again.

`integrationThreads` runs the same suite with `--pool=threads`, one worker and unchanged assertions/timeouts. Concurrent HTTP/database races inside each case remain concurrent. It is a separately named Windows verification mode after native fork-worker exits; its result cannot substitute for or overwrite the default command's record. CI keeps the ordinary integration command. Exact causes of the recorded native exits remain unproven.

The assembler reads actual command records under ignored `.scratch/release-records/`. It records the base Git revision plus a candidate executable/specification digest, the specialized workspace digest, timestamps, exit codes, installed dependency versions and client/server build hashes. A dirty candidate is identified by its digest, not misrepresented as an already committed revision. Only a record with matching content/workspace fingerprints contributes a local result. All attempts remain in history; the latest matching attempt wins. Missing output/records remain `not_run`; a later failure stays failed. Records are local evidence, not signed remote attestations.

Raw command output stays ignored and private. The committed report includes its SHA-256/byte count and only allowlisted numeric runner summaries. Never upload `.private-output`, browser reports, raw screenshots, service logs, downloads or traces. Review selected synthetic screenshots visually for content and layout, copy only the reviewed images into `docs/evidence/release/`, and record their filename/hash/review in `screenshots.json` before assembly. These are manually reviewed synthetic artifacts, not automatic failure captures. Empty screenshot evidence does not prove visual review.

Every canonical acceptance ID has a row. `localStatus` describes only the named local test scope; `status` also identifies pending required verification (`blocked`) or the optional disabled decision feature. F-tagged criteria are tracked separately by their canonical gate. Passing a suite does not establish a real model's answer quality or human usability.

## Provider verification inventory

| Role | Current binding | Evidence and required action |
|---|---|---|
| Everyday | Luna, Responses v2 adapter, `vulpes-everyday-v7`, catalog limits and ZDR policy | All 14 fixed current synthetic cases passed with separate host answer review. Five batches and failures are retained in current evidence; two interrupted requests retain $0.0186384 in holds. Formal acceptance and production approval remain absent. |
| Intermediate | Flash, Vertex adapter, current v7 template, explicit Google project/location/policy | Local wire/handoff tests only. Prices, account access, accepted region/retention, capability/privacy evidence, terminal usage/cache billing and live tool/failure smoke remain unverified. |
| Advanced | Argon, Vertex adapter, backend-only | Same external verification gaps as Flash. Argon remains excluded from chat even if a future smoke succeeds. |
| Decision | Separate Decisions interface, disabled | PR 14 and AI-10 remain deferred. No activation or comparative quality/cost claim. MOD-03 verifies the application without it. |

The generated inventory hashes the tested source through its candidate digest. Catalog prices and older public records are dated snapshots, not a fresh provider lookup. The original offline release report did not refresh provider documentation, account settings or prices. The separately authorized owner-pilot batch refreshed public rates, confirmed key limits and recorded owner-confirmed privacy settings; see [live evidence](../evidence/luna-owner-pilot-live.md).

The generated adapter/template fields identify the configured provider family's generation implementation. For the disabled decision role they do not represent an implemented Decisions adapter or decision prompt; PR 14 supplies neither in this candidate. Use its disabled availability and this inventory's separate capability boundary.

The safe opt-in guard can be checked with `npm run test:providers -- --mode=live --role=everyday`; expected result is exit 1, `live_opt_in_required`, zero requests. Do not add spend flags during ordinary verification. After separate approval, follow [PROVIDER_SETUP.md](../spec/v0.1.0/PROVIDER_SETUP.md) for the guarded command, complete current bindings, immutable batch ceiling and attempt UUID. Keep pending costs and the approved 24-hour uncertainty policy. Never reset/replenish a retained allocation to obtain a green result. A smoke pass does not activate production.

## Required deployment and pilot checklist

Each gate remains **pending** unless its row identifies dated evidence for the named scope. Local reports and bounded hosted checks establish only their recorded prerequisites. Record date, exact candidate, procedure, safe result and responsible human before changing a gate.

| Gate | Procedure and expected evidence | Approval needed |
|---|---|---|
| Combined independent M5/M6 review | Freeze PR 13 plus PRs 15–17 candidate; independently review specification/evidence and engineering/security/lifecycle/test assurance. Resolve demonstrated blockers and recheck the final revision. PR-level self-review is separate. | Review/acceptance decision; no merge implied |
| Earlier acceptance | Reconcile M2 timestamp repair, M3 retained replay/completion/live evidence and M4 daily-total/cache repairs with their reviewers. Preserve historical failures and distinguish technical results from formal acceptance. | Formal outstanding milestone acceptance |
| Provider enablement | Current-bound live synthetic tool/usage/cancel/failure/safety evidence for every advertised role, verified rates, privacy, access and persistent budgets. Unsupported roles remain unavailable. | Explicit model/provider/privacy/location/spend and activation approval |
| Hosting resources | Source Free/us-east-1 and Vercel Hobby/iad1 were approved; Step 3C synthetic deployment passed its bounded checks on 2026-11-01. [Evidence](../evidence/owner-pilot-hosted-setup.md) binds candidate/config and immutable deployment. Recovery destination/custody remain deferred, not passed. Inference remains off. | Initial resources/migrations/synthetic deployment approved; recovery and real data separate |
| Hosted routing and CSP | Step 3C passed 14 public probes: four deep links, JSON API errors, account rewrite, anonymous denials, exact CSP and cache/security headers. Twelve authenticated API checks and four-page browser smoke passed. Step 3D.1 passed four malformed GET queries per identity with JSON 400/no-store. Malformed write bodies, stream lifecycle and full PWA checks on hosting remain pending; inference-on streaming is a later gate. | Approved synthetic deployment; live inference separate |
| Hosted Auth and isolation | [Step 3D evidence](../evidence/owner-pilot-step3d.md) records 87 access preflight checks, then approved populated isolation on nine readable tables, foreign API/source/goal/conversation denials, 42 direct mutation denials and four trusted foreign-parent constraint denials. Same-browser populated account switching and trusted reset with old password/access/refresh rejection passed. Execution/step/trace/allocation positive isolation, delayed cache races, preview scopes and family identity verification remain pending. Site URL/no redirects are owner-attested. | 3D.2 disposable-account reset/deletion approved and completed; recovery/invitations separate |
| Hosted private storage | Storage remains disabled/private; verify no public objects or downloads. Review full data/key inventory and read-time expiry after inactivity. | Hosted configuration approval |
| Operational recovery | Rehearse [account lifecycle procedures](account-lifecycle.md) in a separate destination: authenticated backup, current/retained keys, schema/grants/RLS/Auth, post-backup deletion replay, independent current journal and revoked sessions before access. Missing journal/key or corruption blocks access. | Backup destination/key custody/live recovery approval |
| Backup rotation and deletion resumption | 3D.2 passed hosted deletion start/fence, separate-process continuation, complete owned-data/Auth removal and independently retained completion receipts for both disposable accounts. Aging/expiry, uncertain accounting, hosted bounded maintenance/cadence and separate recovery/journal/key custody remain pending. Enforce maximum 30-day encrypted backups and at least 31-day completed receipts; no implicit background guarantee. | Operational destination and maintenance ownership |
| Provider outage or budget exhaustion | Verify honest unavailable/partial states, no unapproved fallback or silent retries, no unlogged dispatch, conservative holds, and usable deterministic Data/Goals/export. Inspect safe accounting, not prompt logs. | Current-provider test authorization if live |
| Physical device and accessibility | Actual supported phones/tablet: on-screen keyboard during long chat, safe areas, rotation/zoom, installation/update/offline caches, real screen reader, focus and touch targets. Record device/browser/AT versions. Chromium emulation is insufficient. | Device testing, without real health data |
| Operator recovery and invitation | 3D.2 passed the trusted hosted reset service for a newly created disposable identity, old password/access/refresh rejection and fresh sign-in. Independent human identity verification and nonoperator credential handoff remain pending; initial owner sign-in handoff alone does not satisfy them. Do not grant project-team membership or assume SMTP. | Human identity/handoff and later invitation approval |
| Owner real-data pilot | All applicable P0 gates, required live provider and hosted/device evidence; explicit file/profile consent, known source readings compared with deterministic results, actual spend/storage observation. Generic CSV support is not native vendor compatibility. | Separate deployment and real-data/import approval |
| Adult family pilot | Owner pilot plus every applicable F criterion, nonoperator recovery, export/interrupted deletion/restore/isolation/provider consent/budget evidence and clear operator-access/wellness limitations. | Separate adult invitation and real-data authorization |

No local PASS, merged implementation or successful provider smoke authorizes deployment, real data, invitation or automatic merge. Native Android Health Connect, research, autonomous goals and background inference remain outside this release.

## Owner-pilot production path

The normal chat handler composes Luna through the existing ledger. `everydayProductionEvidence` remains null and `everydayMaxRunCostUSD` remains zero in `server/config/everyday-production.ts`; the live switch alone cannot authorize dispatch. Current smoke, safety-evaluation identity, explicit owner approval, exact policy hash/version and catalog/template/price bindings are required. Flash/Argon and decision scoring remain unavailable/disabled.

OpenRouter consent version `openrouter_zdr_v2` describes the announced screening/flagged-content retention exception. Stored v1 consent is preserved but does not authorize new normal chat requests. Verify effective terms and obtain owner acceptance before installing production evidence. This preparation does not accept terms or authorize spending.

`npm run budget:provision` requires a private interactive terminal, the synthetic owner's UUID, approved app/account USD ceilings and the exact confirmation shown. It targets only the guarded local stack. It creates missing current UTC-month buckets atomically, accepts matching existing ceilings and refuses changed ceilings without resetting balances. Production ceilings and hosted operator targeting remain separately approved deployment work. Missing next-month buckets deny admission; provisioning is an explicit operator task.

Credentials are not needed for ordinary verification. Later, supply provider and administrative keys only through an ignored local environment file or approved server-side deployment secret settings. Never paste keys into chat, command arguments, screenshots or `VITE_` variables. The exact dashboard procedure and spending ceiling must accompany the separate live-verification approval request.

Current Luna results, standing synthetic-batch authorization and operator bounds are owned by [the Luna verification procedure](luna-verification.md). The v7 technical checkpoint passed; production evidence remains uninstalled. Hosting/security/recovery, device and formal acceptance gates cannot be marked complete from provider-only evidence.

The [synthetic hosting procedure](synthetic-hosting.md) owns Step 3 checkpoints, secure dashboard setup and the resource proposal. [Preparation evidence](../evidence/owner-pilot-step3.md) establishes only local config/build/HTTP behavior. The public probe cannot establish authenticated isolation, inference state, candidate identity or recovery. Existing local maintenance, reset, budget and restore CLIs do not support hosted targets. Platform-specific fenced restoration and hosted maintenance remain required work after resource/operational approval.

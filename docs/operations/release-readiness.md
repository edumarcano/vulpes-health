# Release evidence and deployment handoff

Vulpes is **not fully release ready or ready for real-data import**. The owner has authorized activation/use, and the existing synthetic deployment now enables normal Luna chat under bounded consent and budgets. [Step 4 evidence](../evidence/owner-pilot-step4.md) records current hosted results. The owner reported successful Galaxy S23 conversations, installation and offline behavior. TalkBack is unverified and explicitly deferred for this personal pilot; broader full-release UI verification, outstanding formal acceptance and concrete file/profile selection remain gates. Family credential handoff is separate. The [generated report](../evidence/release/m6-local.json) preserves PR 17's recorded outcomes; the [PR 17 evidence](../evidence/pr17-integrated-acceptance.md) and [M5/M6 remediation record](../evidence/m56-review-remediation.md) retain their historical verification scope and failures.

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
| Everyday | Luna, Responses v2 adapter, `vulpes-everyday-v7`, catalog limits and ZDR policy | All 14 fixed provider cases passed with separate answer review; five batches and failures remain retained, including $0.0186384 in interruption holds. The owner subsequently approved normal hosted activation; [Step 4](../evidence/owner-pilot-step4.md) records its separate calls, accounting and limits. Formal release acceptance remains pending. |
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
| Hosting resources | Existing source Free/us-east-1 and Vercel Hobby/iad1 remain approved. [Step 4](../evidence/owner-pilot-step4.md#final-hosted-repair-checkpoint-2026-11-02) deploys runtime `e296c9e` as `dpl_7aHrksKRbfwg3aWtL1KfNs4AXRPv`, READY after both CI checks, with both aliases verified. Eight Production-only variables include the private OpenRouter Secret and true live switch; Git stays disconnected. The verified inference-off Step 3 deployment remains available for rollback. No resource upgrade or new migration. | Scoped activation/deployment and reported owner-device scope accepted; acceptance/recovery/input gates remain |
| Hosted routing and CSP | Step 3 passed 14 public/38 API/eight browser checks, including disabled JSON chat, export/cancellation, isolation and public-only PWA/offline behavior. Step 4's active candidate separately passed all 14 public checks and seven actual public files against server/admin/trace/provider-secret canaries; its normal SSE/inspector/persistence results are recorded in [current evidence](../evidence/owner-pilot-step4.md). The owner subsequently reported successful Galaxy S23 conversation, installation and offline behavior. | Approved synthetic checks and bounded owner device report; broader release UI scope remains |
| Hosted Auth and isolation | [Step 3D evidence](../evidence/owner-pilot-step3d.md) records 87 preflight checks, populated readable-table isolation, foreign API/parent denials, direct mutation denials and trusted reset/session rejection. Final hosted execution/step/trace/allocation positive isolation and delayed-response account switching passed on two new disposable accounts. Completed logout/storage clearance passed after a verifier timing correction. Both accounts were deleted; original account/shared hashes stayed unchanged. Preview scopes and human family identity/handoff remain unverified. Site URL/no redirects are owner-attested. | Approved disposable-account checkpoints completed; recovery access/invitations separate |
| Hosted private storage | Storage remains disabled/private; verify no public objects or downloads. Review full data/key inventory and read-time expiry after inactivity. | Hosted configuration approval |
| Operational recovery | [3D.4A–C](hosted-recovery.md) prepare encrypted journal/database capture, network-none restoration, completed/unfinished replay, peer/shared-cost preservation, session revocation, old-session denial, SQL RLS, actual isolated Auth/API and current accounting comparison with local proof in the consolidated PR #32. The [approved hosted-source rehearsal](../evidence/owner-pilot-step3-hosted-recovery.md) passed source-bound TLS/privileges, 55-table/two-key capture, post-backup replay, six denied restored sessions, 24 actual isolated Auth/API assertions and current accounting. Proton Pass readback and all five encrypted Drive file readbacks passed, including the final nine-receipt journal. Ongoing manual rotation and source-loss/cutover completeness remain requirements. Rehearse [account lifecycle procedures](account-lifecycle.md) in a separate destination: authenticated backup, retained keys, schema/grants/RLS/Auth, post-backup deletion replay, independent current completeness and revoked sessions before access. Missing evidence/key or corruption blocks access. | Grouped synthetic recovery approved/completed; key/cloud-copy handoff passed; ongoing rotation, cutover and restored access retain their requirements |
| Backup rotation and deletion resumption | Approved 3D.2/3D.3 deletion/maintenance and the grouped recovery passed. The final deployment includes the unlinked export-spool repair with local crash proof and actual hosted export/cancellation checks; both legacy READY instances were retired. Step 3 closeout preserved the two original accounts and nine completed deletion receipts, with no unfinished requests or fixture remnants. Step 4 intentionally adds synthetic observations, conversations, encrypted traces, one pending proposal and capped live accounting; its current snapshot is recorded separately. All five encrypted files, including the final nine-receipt journal, passed Drive copy/readback. Its five-minute validity has ended; copying does not renew freshness. Enforce 30-day maximum database backups and at least 31-day completed receipts; owner-operated rotation/freshness checks remain ongoing, with no scheduler or physical-erasure guarantee. | Approved checkpoint and final-journal cloud handoff completed; future rotation/access retain their requirements |
| Provider outage or budget exhaustion | Verify honest unavailable/partial states, no unapproved fallback or silent retries, no unlogged dispatch, conservative holds, and usable deterministic Data/Goals/export. Inspect safe accounting, not prompt logs. | Current-provider test authorization if live |
| Physical device and accessibility | [Owner report](../evidence/owner-pilot-step4.md#owner-device-report-2026-11-02): Galaxy S23, Android 17, Chrome 156.0.8078.73; conversations, installed app and airplane-mode behavior worked. UI is usable but awkward; literal Markdown and redesign are deferred to a separately guided UI branch. TalkBack was not tested and is explicitly deferred for this personal pilot. Broader viewport/theme/AT coverage and UI-03 remain unverified for the full release; no P0 is waived. | Reported owner scope accepted; no repeat TalkBack action for this personal pilot |
| Operator recovery and invitation | 3D.2 passed the trusted hosted reset service for a newly created disposable identity, old password/access/refresh rejection and fresh sign-in. Independent human identity verification and nonoperator credential handoff remain pending; initial owner sign-in handoff alone does not satisfy them. Do not grant project-team membership or assume SMTP. | Human identity/handoff and later invitation approval |
| Owner real-data pilot | All applicable P0 gates, required live provider and hosted/device evidence; explicit file/profile selection, known source readings compared with deterministic results, fresh recoverable accounting and actual spend/storage observation. Generic CSV support is not native vendor compatibility. Synthetic observations and proposals must be identified for cleanup first. | Standing activation/use approval recorded; acceptance gates and concrete input selection still required |
| Adult family pilot | Owner pilot plus every applicable F criterion, nonoperator recovery, export/interrupted deletion/restore/isolation/provider consent/budget evidence and clear operator-access/wellness limitations. | Separate adult invitation and real-data authorization |

No local PASS, merged implementation or successful provider smoke authorizes deployment, real data, invitation or automatic merge. Native Android Health Connect, research, autonomous goals and background inference remain outside this release.

## Owner-pilot production path

The normal chat handler composes Luna through the existing ledger. `server/config/everyday-production.ts` installs the owner-approved v7 execution and safety-evaluation bindings with a $0.04 run ceiling. The hosted pilot additionally requires the true live switch, server-only provider key, encryption, accepted current policy and durable app/account budgets. Repository defaults and ordinary CI remain offline. Flash, Argon and decision scoring remain unavailable/disabled.

OpenRouter consent version `openrouter_zdr_v2` describes the announced screening/flagged-content retention exception. Stored v1 consent does not authorize normal chat requests. The synthetic owner accepted v2 under explicit authorization; the other account remains denied without its own consent/budget. Per-request ZDR and no-plugin/store controls remain enforced. Current rates and policy were checked before activation; this is not a claim of zero provider retention or regional inference residency.

`npm run budget:provision` targets only the guarded local stack and requires its private interactive confirmation. The separately authorized hosted operator used the same service-only atomic function to provision $0.10 current UTC-month shared/account ceilings, preserving balances. The existing dedicated key retains its $0.50 lifetime cap with no reset. Missing next-month buckets deny admission; future provisioning remains an explicit operator task.

Credentials are not needed for ordinary verification. Approved hosted credentials are Production-only server Secrets, transferred from protected local storage through private stdin. Never paste keys into chat, command arguments, screenshots or `VITE_` variables. Keep future live verification within its declared caps and privacy scope.

The [Luna verification procedure](luna-verification.md) owns retained provider-only batches. The [hosted owner-pilot procedure](owner-pilot-luna.md) and [Step 4 evidence](../evidence/owner-pilot-step4.md) own current normal-chat activation, verification and rollback. Physical-device, formal acceptance and fresh recovery gates cannot be marked complete from provider-only proof. The Step 3 archive predates Step 4 data, consent, budgets and runs; it is historical recovery evidence, not a current accounting snapshot.

The [synthetic hosting procedure](synthetic-hosting.md) owns Step 3 checkpoints, secure dashboard setup and the resource proposal. [Preparation evidence](../evidence/owner-pilot-step3.md) establishes only local config/build/HTTP behavior; [hosted evidence](../evidence/owner-pilot-step3d.md) records the bounded security/lifecycle/database-maintenance results. The public probe cannot establish authenticated isolation, inference state, candidate identity or recovery. Existing local maintenance, reset, budget and restore CLIs retain their hosted-target refusals; the separate approved hosted database command is verified. The consolidated [recovery checkpoint](hosted-recovery.md#combined-step-3-execution-checkpoint) owns remaining hosted recovery, custody, export deployment/legacy-instance checks and synthetic security evidence.

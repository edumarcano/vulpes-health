# v0.2.0 M0 readiness record

**Date:** 2026-11-13. **Status:** M0 decision and feasibility packet complete with the explicit downstream evidence gates below. No v0.2.0 runtime acceptance claim.

**Execution baseline:** `main` at `3c0c5c8c5ae1171990459bec992c6c1d0b255d28`; branch `docs/v0.2.0-m0-readiness`. Initial working tree clean; fetched `origin/main` matched HEAD. Against specification baseline `585fd614ccd7c5592d7486c40895526124a6c658`, only the v0.2.0 specification and release plan differ. Against plan baseline `3b7e5762c732ebddf892068635fbe575a33a0f45`, only the release plan differs. No application drift required reconciliation.

## Authority and evidence

The [v0.2.0 specification](../../spec/v0.2.0/VULPES_V0.2.0_SPEC.md) owns intended behavior; the [release plan](../../V0.2.0_RELEASE_PLAN.md) owns sequencing. This dated record owns M0 decisions and measured findings. Existing architecture, security and MOD-01-06 remain constraints. Repository AGENTS.md and Remora engineering, testing and documentation standards apply. M0 does not change production code, database schema/types, production configuration, dependencies, CI, public assets, models or routing.

| Evidence | Status and scope | Owner / next gate |
|---|---|---|
| Source inspection | Baseline contracts, affected services/SQL, lifecycle/export/recovery, worker/auth and evaluation controls inspected; no hosted environment inspected | M1-M6 implementation |
| [Format manifest](../../spec/v0.2.0/fixtures/renpho-v1/manifest.json), five synthetic CSVs and independent values | Prospective contract, structural/arithmetic checks passed; no production adapter exercised | M1 AT-01-08 |
| [Capacity result](m0-probes/capacity-result.json) | Synthetic Node serialization measured; PostgreSQL and host throughput not run | M1 AT-07 |
| [Share result](m0-probes/share-result.json) | Actual Chrome worker/IndexedDB mechanics passed on Windows | M2 full receiver and physical AT-09-11 |
| [Public sources](#public-sources) | Seven public HTML pages fetched successfully on 2026-11-13; no app, device, image-chart or provider verification | M2 platform; M3 references; M5 provider refresh |
| [Evaluation design](../../spec/v0.2.0/fixtures/evaluation-plan-v1.json) and [synthetic data](../../spec/v0.2.0/fixtures/evaluation-data-v1.json) | 20 predeclared scenarios; no model comparison executed | M4 final bindings; M5 separately approved live comparison |

Small probe sources are retained beside their sanitized results to make the decisive experiments reproducible. This refines the plan's scratch-only probe location without adding production tooling, a runner framework or package commands. `.scratch/plans/v0.2.0/M0.md` remains ignored.

## Schema strategy and preservation (MET-01-02, MIG-01-07, SEC-01/05-06)

**Selected:** extend the existing schema through forward migrations. Reuse owned sources and add an owned weigh-in/event parent with linked numeric observations. Do not rewrite applied migrations or fabricate RENPHO events for manual/canonical history. No migration or reset was executed in M0.

| Concern | Forward extension (selected) | Fresh application-data baseline (rejected for now) |
|---|---|---|
| Existing ownership/RPCs | Extend current transactions, RLS and composite owner constraints | Rebuild equivalent contracts and reorder dependent functions |
| Fresh provisioning | Replay historical migrations then reviewed additions | Requires a separate safe baseline/upgrade story; applied history still cannot be rewritten |
| Auth/control data | Preserve existing identities/preferences/accounting structure | Must separate and reattach control tables despite discarding content |
| Types and lifecycle | Regenerate types and extend enumerated export/deletion inventories with each entity | Rebuild types and inventories plus prove no retained dependency lost |
| Compatibility/recovery | Version incompatible API/payload/client contracts; coordinated forward transition | Still needs refusal of old clients and coherent schema/application recovery |
| Cost | Bounded additive schema and function replacement work | No demonstrated reduction sufficient to justify replacing mature ownership/accounting machinery |

Logical invariants for M1: source defaults are owned and versioned; adapter/mapping metadata belongs at batch scope; events retain source-local datetime, confirmed IANA zone, resolved instant/offset, annotations and provenance; observations retain exact original value/unit and canonical Decimal value/unit. Owner/event/source consistency requires database constraints as well as server authorization. Revisions invalidate affected previews/projections/proposals. M1 chooses columns, indexes, RPC signatures and migration ordering.

| Data class | Transition policy | Responsible evidence |
|---|---|---|
| Auth identities, deployment secrets/config, privacy preferences/consent | Preserve; application-content disposal does not renew consent. Separate profile content from profile controls | M1 preservation assertions; M6 procedure |
| Measurements/events/sources/imports, conversations/messages, goals/revisions/proposals, dependent private copies | Potentially disposable only after environment-specific authorization; no legacy backfill solely for disposable content | M1 inventory; M4 goal additions; M6 approved cutover |
| Usage buckets/reservations, unsettled run/step charges, verification allocations, durable `ai_route_cost_blocks`, audit/settlement evidence | Preserve financial meaning and exhausted balances; reconcile in-flight costs; never blanket-truncate mixed content/accounting tables | M1 preservation tests; M6 settlement/recovery rehearsal |
| Pending previews/proposals, encrypted staging, cached clients/workers | Expire or invalidate incompatible work; stale callers must fail before writes | M1 API/payload refusal; M2 worker continuation/update handling; M6 integrated cutover |

Owning implementation includes [base schema](../../../supabase/migrations/20261024000100_schema.sql), [import SQL](../../../supabase/migrations/20261025000300_csv_import.sql), [account export](../../../server/services/account-export.ts), [account service](../../../server/services/account.ts), [lifecycle runbook](../../operations/account-lifecycle.md), [recovery runbook](../../operations/hosted-recovery.md), and [schema build check](../../../scripts/schema-compatibility.ts). The build check verifies migration presence and allows forward schemas; it does not refuse an old open tab's incompatible request. Events/annotations enter export, deletion, private-copy and restore/deletion-replay inventories in M1. Group entities follow in M4. These obligations cannot wait wholesale until M6.

## CSV, metric and identity contract (IMP-01-18, MET-01-05)

The versioned manifest is the canonical all-field inventory: 19 core plus five optional numeric fields, three separate private annotations, and `No.` as provenance only. Exact English `lb` header strings come from repository format evidence, not a new manufacturer export. New CSVs contain authored synthetic values; no private export was relabelled. kg/st header variants, locale changes, device model and export app version remain unverified and are not adopted. Manufacturer display-unit settings alone do not establish CSV headers.

| Contract | M0 decision |
|---|---|
| Recognition | Date, Time and usable Weight mapping required; composition optional; arbitrary named-column order; explicit aliases only; no positional, magnitude or AI inference |
| CSV grammar | UTF-8 with optional BOM; LF/CRLF/CR; standard quoted commas/newlines/escaped quotes; optional one terminal column only if header and every cell exactly empty |
| Ambiguity | Duplicate headers/two aliases for one field reject layout; unknown populated columns require explicit unsupported-column acknowledgement |
| Missing/invalid | Empty/`--` unavailable differs from absent column, invalid value and reviewed exclusion; zero and signed deltas preserved; no silent exclusion |
| Missing weight cell | IMP-04/05/15 require usable Weight mapping, not every Weight cell. Retain a nonempty numeric event after explicit invalid-cell exclusions; no empty event commits. A bad timestamp excludes the whole event |
| Time | Strict `YYYY.MM.DD` + `HH:mm:ss`; reject invalid dates/leap seconds. Reject/exclude DST gaps and overlaps; no implicit disambiguation. Store interpretation, not just UTC |
| Precision | Preserve original strings/units and exact `lb * 0.45359237 = kg`; equality uses exact canonical Decimal values, with no epsilon/fuzzy unit matching |
| Source/person | One owned source is one confirmed person's export context. Retain visible single-profile confirmation when no discriminator exists; names, filenames, weight and row number do not establish identity |
| Untrusted text | Labels/remarks are private data, never instructions. Proposed remarks cap: 4096 UTF-8 bytes; categorical label cap: 200 characters. Over-limit content requires visible rejection/exclusion review, never truncation |

Numeric representation and eligibility are distinct. Manifest `goalEligible` indicates a candidate representation for later M4 safety policy, not an approved target or medical range. Overlapping component percentages do not form a partition. Device estimates retain source/method limitations. BMR raw kcal time basis and the direction of three signed vendor target deltas remain unresolved: preserve those four numbers but do not use them as analytical operands or goals until reviewed semantics resolve them. Metabolic age is not chronological age. Vendor optimal values do not activate goals.

[Identity examples](../../spec/v0.2.0/fixtures/renpho-v1/identity-cases.json) are 13 normative decisions, not executable classifier tests. Stable identity is owned source plus exact interpreted timestamp, with source-local timestamp collision checks to stop timezone remapping from creating a second history. Same-context reimport is duplicate only when populated metrics/annotations agree; missing supported values may enrich. A changed populated value conflicts and preserves corrected history; missing later values never delete. Annotation additions/conflicts require review. Different owners/sources are separate. Multiple indistinguishable readings at one timestamp are unresolved conflicts, never deduplicated by proximity. Filenames, file hash, row number, ordering and review flags do not affect event identity. Mapping/source changes require explicit review and cannot reinterpret stored events.

Structural fixture coverage includes minimal/full panels, reordered BOM/empty-terminal form, unavailable/zero/signed values and quoted injection text. Invalid-layout/UTF-8 recipes and time cases are normative input recipes for M1. The M0 verifier checks existing CSV structure, independent arithmetic and five timezone examples; it does not claim to execute future import rejection/classification behavior.

## Capacity decision and remaining measurements (IMP-15-18, AT-07 input)

The retained Node probe constructs 1,000 events x 24 values (24,000 observations), including annotations and repeated provenance. Its flat expansion is a counterfactual extension: today's parser emits only two fields. Selected hypothesis: compact batch metadata and event-linked staging rather than repeated mapping per value. Keep bounded encryption and transactional preview/register/commit semantics; do not solve capacity by merely raising every cap.

| Layer | Current constraint / observed result | Disposition |
|---|---|---|
| Decoded CSV | 1 MiB; representative 193,416 bytes | Sample fits; generated 1 MiB +/-1 CSV grammar samples retained by recipe |
| Source rows / numeric count | Planned 10,000 / 25,000; current TS/import SQL 5,000 observation limits | M1 update TS/parser/service/SQL together; generated +/-1 count cases are not ingress acceptance |
| API JSON | 2 MiB; representative 194,749 bytes | Sample fits; not a universal decoded-CSV guarantee |
| Flat plaintext | 14,927,920 bytes | Exceeds current 4 MiB bound before compression |
| Compact plaintext | 791,405 bytes | Fits sample; future adapter/envelope not implemented |
| Compact gzip / AES-GCM bytes | 16,601 / 16,617 bytes | Public synthetic key with fresh nonce per shape, never production crypto |
| Compact hex payload RPC JSON | 33,339 bytes | Sample only; ciphertext hex overhead included |
| Inspect / register / commit compact RPC JSON | 791,491 / 928,001 / 928,177 bytes | Below existing 8 MiB inspect and 4 MiB register/commit byte constraints for this sample |
| Flat inspect / register / commit RPC JSON | 14,783,591 / 16,848,034 / 16,848,210 bytes | Repeated metadata fails before any useful throughput claim |
| Compact JSONB text | 885,675 bytes estimated | Spacing estimate only; PostgreSQL not run |
| API/DB/hosting throughput, timeout, locking, rollback | Not run | M1 must measure real authenticated preview/commit including concurrent/replay/failure cases |

Escaping is an independent ingress problem. A valid 1 MiB CSV filled with backslashes becomes 2,091,254 JSON bytes in the probe; U+0001 annotation filler becomes 6,259,942 bytes. The latter demonstrates a transport expansion risk; M0 has not adopted a control-character policy or claimed it is a real vendor export. Preserve the promised source envelope through a dedicated bounded raw/multipart CSV transfer, or prove an alternative JSON encoding fits all adopted text. M1 must settle that transfer and explicit invalid-text policy before claiming AT-07; silently stripping annotation content or requesting manual splits is insufficient.

Public Vercel documentation currently states a 4.5 MB function request/response limit (streamed-response exception); Supabase documents timeout configuration dependent on connection/role and a client/dashboard maximum of 60 seconds. These are public constraints, not this project's measured quotas. M1 checks the deployed runtime configuration separately and keeps transaction deadlines bounded; M0 changed no limits and made no hosted calls.

## Share feasibility (SHR-01-08, SEC-02/05)

MDN, Chrome and web.dev document installed share-target registration, multipart POST for files, and worker interception. The chosen direction is an in-scope POST receiver plus separate IndexedDB handoff with opaque reference. Do not store health bytes in public Cache Storage or put names, labels, CSV, owner IDs or tokens in URLs. Worker-missing handling returns a generic no-store rejection without echo, log or persistence.

`node docs/evidence/v0.2.0/m0-probes/share-probe.mjs` passed using fresh isolated Chrome 157.0.8103.51 on Windows. It started/stopped its own loopback server, intercepted a real form navigation in a worker, recovered the exact 73-byte synthetic file/hash, redirected with an opaque reference, allowed one atomic read/delete, denied a second/expired/cancelled read, and left zero handoffs. Missing/multiple/text-only attachment cases returned 400; blocked-worker fallback returned 503 without persistence or body echo. Public Cache Storage held only `/offline.html`. External requests, Vulpes uploads and commits were zero. See the retained JSON for the digest. This probe is deliberately unauthenticated and not a production receiver.

M2 privacy lifecycle: `received_unbound -> confirmed/bound_to_owner -> consumed`, with expired/cancelled/owner-change terminal cleanup. Maximum default age 15 minutes; reads deny expiry even before physical cleanup. Unbound data survives only intended sign-in; bound data cannot move accounts. Do not promise exact deletion time while a browser is closed. M2 must test sign-in, account switch, worker update, race, cancellation and storage failures against the real app.

**Physical Android / actual RENPHO MIME: `not_run`.** No physical device, installed secure-origin target or entirely synthetic RENPHO export was available to this execution. Owner: M2, latest gate AT-09 before release claim. Procedure: record Android/Chrome/RENPHO versions, scale/model and export locale; create synthetic-only history; install the reviewed target from an authorized secure origin; share the export from RENPHO; record MIME/extension, target appearance, cold/warm launch, exact-byte receipt, signed-out sign-in/account confirmation and cancellation. Verify no upload before confirmation. Repeat with picker fallback and unsupported attachments. A deployment or real-data import requires its own authorization. Desktop POST/manifest syntax does not establish share-sheet dispatch, installability or AT-09.

## Manufacturer investigation and coverage (REF-01-06)

The public sources below record the reviewed URLs and date. RENPHO's Health App FAQ describes export navigation and discusses profile/athlete-mode and estimate limitations; the body-composition manual identifies estimate families and says composition data is reference information, not a replacement for professional advice. Reviewed public HTML does not supply a verified exact CSV kg/st header/value convention, BMR time basis or signed optional-delta direction. Linked app-store pages, authenticated app help, charts rendered as images and model-specific exports were not validated.

No numeric rule is adopted. The two general pages lack a complete, versioned rule with applicable model/app scope, units, endpoint inclusivity, profile requirements and limitations for a production classification. This is bounded insufficient evidence, not a claim that RENPHO publishes no ranges anywhere. Do not substitute generic clinical ranges, a different device's chart or model memory.

All 24 numeric fields in the manifest have unavailable reference coverage for the same reason: reviewed HTML supplies no complete applicable versioned rule. Tracking representations remain specified per field. `BMR(kcal)` and the three signed target deltas additionally have unresolved time-basis/direction semantics; preserve their raw numbers while analytical and goal operands remain disabled.

**M3 evidence blocker:** obtain one manufacturer-owned, model/app-applicable rule with metric/unit, full thresholds and inclusivity, required profile/mode basis, checked date/version and limitations. Retain a reviewable source capture and independent below/at/above/not-applicable cases. Collect profile attributes only after a rule requires them; refusal keeps imports usable. M3 must exercise that rule through production classification or keep the feature gate explicitly blocked for release disposition. Historical labels retain their exported provenance; current-profile guidance must state its different basis. Universal numeric range coverage is not required.

## Evaluation handoff (AI-01-10, EVAL-01-14)

The [evaluation plan](../../spec/v0.2.0/fixtures/evaluation-plan-v1.json) owns the 20 scenarios, scoring, candidate filters, repetition rules and report schema. Its [synthetic data and independent oracles](../../spec/v0.2.0/fixtures/evaluation-data-v1.json) distinguish daily medians from sample means, percentage points from relative change, and incomplete events from older metric readings.

The design requires 11/12 ordinary scenarios plus all critical gates; offline controls cannot substitute for live answer quality. Three cases are reserved for final verification. E11 requires M3's first verified manufacturer rule and cannot be dropped to improve the denominator. M4 binds final prompts/tools/evidence; M5 refreshes provider facts and obtains separate approval before live baseline/peer comparison. No evaluation runner or paid call was added.

## Acceptance record and unresolved gates

| ID | Status | Evidence / boundary |
|---|---|---|
| M0-A1 | passed | Bounded baseline comparisons; authority and source/decision/runtime distinctions above |
| M0-A2 | passed | Forward-route comparison; owned logical invariants; separate control/financial preservation; lifecycle and stale-client owners |
| M0-A3 | passed | Versioned 24-field/annotation manifest; five synthetic CSVs; independent exact conversion oracle; fixture probe |
| M0-A4 | passed (decision examples) | Thirteen identity decisions plus strict/DST/fractional-offset time cases; production classifier belongs to M1 |
| M0-A5 | passed (serialization) | 24,000-value shape/envelope and escaping measurements; byte/row/count boundary recipes; real-path throughput not run |
| M0-A6 | passed (desktop mechanics) | Real worker POST/redirect, exact bytes, atomic claim/expiry/cancel and safe fallback in retained Chrome probe |
| M0-A7 | documented disposition | Device/MIME not_run with M2 procedure; all 24 numeric fields have unavailable reference coverage with exact M3 evidence blocker |
| M0-A8 | passed (design) | 20-case method, independent arithmetic, hard gates, threshold, held-out/repetition/candidate/approval/report fields; E11 pending rule is explicit |
| M0-A9 | passed | Retained checks and final scope/review record below; no downstream runtime acceptance represented as passed |

| Open item | Owner / latest gate | Independent work allowed |
|---|---|---|
| Exact kg/st export aliases, BMR and delta semantics | M1 bounded supported dialect; M3 semantics before analytics/goals | Existing verified lb family; raw unresolved values preserved |
| Escaping-safe ingress, real JSONB/RPC size/transaction latency and all count/byte boundaries | M1 AT-07 | Registry/event/schema work follows selected compact hypothesis |
| Physical MIME/share dispatch and authenticated lifecycle/update/race tests | M2 AT-09-11 | File picker and M3-M4 work |
| First verified manufacturer rule | M3 AT-15; E11 before final model comparison acceptance | Definitions, explicit unavailable states and other analytics |
| Final prompt/tool/evidence bindings and provider facts/spend approval | M4/M5 AT-18-22 | Offline controls and design; no live comparison/activation |
| Environment-specific discard/cutover/restore approval | M6 AT-26-27 | Forward migration implementation with synthetic fixtures |

## Public sources

All seven URLs returned HTTP 200 on 2026-11-13 without redirects. Inspection covered public HTML only; authenticated applications, image charts, device behavior, deployments and providers were not verified.

| Source | Investigation |
|---|---|
| [FAQ for Renpho Health App – RENPHO US](https://renpho.com/pages/faq-for-renpho-health-app) | Export workflow/profile limitations |
| [Renpho Body Composition Scale Manual – RENPHO US](https://renpho.com/pages/body-composition-scale-manual) | Estimate families and limitations |
| [share_target - Web app manifest \| MDN](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target) | Manifest file-share registration |
| [Receiving shared data with the Web Share Target API \| Capabilities \| Chrome for Developers](https://developer.chrome.com/docs/capabilities/web-apis/web-share-target) | Worker reception of shared files |
| [How to receive shared files \| Files and directories patterns \| web.dev](https://web.dev/articles/files/receive-shared-files) | File-share receiver pattern |
| [Vercel Functions Limits](https://vercel.com/docs/functions/limitations) | Public function payload limits |
| [Timeouts \| Supabase Docs](https://supabase.com/docs/guides/database/postgres/timeouts) | Database timeout configuration |

## Reproducing the probes

Run from the repository root with locked dependencies installed and Node 24. No package, lockfile or CI change is required. These sources are dated evidence tools, not Vulpes ingestion or an evaluation runner. Fixture-scoped `.gitattributes` preserves CSV BOM/CRLF bytes and hashes across checkouts.

```powershell
node docs/evidence/v0.2.0/m0-probes/verify-artifacts.mjs --fixtures
node docs/evidence/v0.2.0/m0-probes/verify-artifacts.mjs --capacity
node docs/evidence/v0.2.0/m0-probes/verify-artifacts.mjs --documents
node docs/evidence/v0.2.0/m0-probes/share-probe.mjs
```

| Probe | What a pass means | Limits |
|---|---|---|
| fixtures | Manifest/header counts, CSV hashes/grammar, exact independently authored values and strict timezone examples agree | No production adapter or classifier; invalid recipes are future M1 tests |
| capacity | Synthetic 1,000-event/24,000-value serialization and boundary measurements completed | Proposed compact shape; JSONB spacing estimate, not PostgreSQL; timings vary; no API/DB throughput |
| documents | JSON/scenario/hash/arithmetic structure and local file links are coherent | Semantic correctness requires review |
| share | Actual worker POST, byte recovery, atomic claim/expiry/cancel, rejection and cache separation in fresh desktop Chrome | No installed PWA, Android share sheet, RENPHO export, auth/account/update/race acceptance |

The share probe requires an existing Chrome installation (`channel: 'chrome'`) plus the repository's Playwright package. It uses a fresh disposable browser context, synthetic bytes and its own ephemeral loopback port, closes browser/server on completion, and makes no external request. It never reads a personal browser profile. Missing Chrome is a reported prerequisite failure; do not silently download/install a browser or substitute source documentation for a pass.

The capacity probe uses a public synthetic key with a fresh nonce per counterfactual shape only for disposable sizing; it has no production encryption imports. Its count-boundary rows describe generated recipes, not transactional acceptance. `capacity-result.json` and `share-result.json` retain the 2026-11-13 run; serialization timing/browser version can vary on rerun. Source hashes and byte sizes should agree on the same versions.

Do not run production, database or provider scripts to reproduce these probes.

## Verification and review

Run the commands above from the repository root. The JSON results establish observed mechanics/serialization only. The fixture verifier establishes structure/arithmetic, not vendor authenticity or production imports. The document verifier establishes links/schema invariants, not exhaustive semantic correctness.

| Executed check | Observed result |
|---|---|
| `verify-artifacts.mjs --fixtures` | Passed: five CSVs, 24 fields, five timezone cases, 13 normative identity examples; production adapter not tested |
| `verify-artifacts.mjs --capacity` | Passed: 24,000-value serialization, exact byte/hash measurements and boundary recipes; no database/hosting throughput |
| `verify-artifacts.mjs --documents` | Passed: 20 scenarios, 12 ordinary/eight critical, three final-verification cases, fixture hashes/independent arithmetic and local file links in its named documents |
| `share-probe.mjs` | Passed: actual isolated Chrome worker receipt/retrieval, claim/expiry/cancel, attachment rejection, safe fallback and cache inventory |
| Focused existing Vitest baseline | Passed: seven files, 112 tests; old production contracts remain unchanged |
| `python docs/spec/v0.1.0/scripts/validate_spec_package.py` | Passed: 616 checks of the existing specification/fixture package; not v0.2.0 runtime acceptance |
| Named probe Prettier/ESLint checks | Passed with no warnings |
| All affected Markdown local links, `git diff --check`, scope inspection | Passed; all edits remain in documentation/evidence/fixtures, including fixture-scoped Git byte preservation |

Exact baseline test command:

```powershell
npm test -- tests/unit/csv.test.ts tests/unit/renpho-csv.test.ts tests/unit/measurements.test.ts tests/unit/import-selection.test.ts tests/unit/hosted-schema.test.ts tests/unit/luna-evaluation.test.ts tests/unit/boundaries.test.ts
```

Two sequential host-agent review passes covered the complete M0 diff and owning contracts. Axis 1 (specification fulfillment): approved for M0, with no remaining blocking/advisory findings; the documented M2/M3/M5 gates remain unverified downstream work. Axis 2 (engineering, security and documentation): approved, with no remaining blocking/advisory findings. Review corrected CSV byte preservation, the quoting of the escaping sample, and foreign-ID evaluation preconditions before this verdict. This is not a separate-reviewer attestation or exhaustive runtime proof.

Application integration/database/production-browser/physical-device suites and live model comparison were not run; M0 changes none of those production paths. No downstream AT-01-28 runtime pass follows from M0. Provider requests and inference spend: **0 / $0**. No database operation, deployment, live-resource change or real-data import occurred.

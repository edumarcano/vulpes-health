# Implementation decisions

The [product and architecture decisions](spec/v0.1.0/DECISIONS.md) are authoritative. This log records the implementation choices that shape ongoing operation, each with its reason. Dated blow-by-blow history is in [Git](https://github.com/edumarcano/vulpes-health/blob/e57c821/docs/DECISIONS_IMPLEMENTATION.md).

## v0.2.0 M0 decisions (2026-11-13)

The [v0.2.0 specification](spec/v0.2.0/VULPES_V0.2.0_SPEC.md) supersedes conflicting v0.1.0 scope decisions. These are selected implementation directions, not shipped v0.2.0 features. See the [M0 readiness record](evidence/v0.2.0/m0-readiness.md) for alternatives, source inventory, measured probes and remaining gates.

| Decision | Rationale / implementation owner |
|---|---|
| Extend through forward migrations; retain Auth, privacy and financial controls | Reuse existing ownership/RPC/lifecycle infrastructure. No migration rewrite, blanket reset, renewed consent or replenished budgets. M1 structural proof; M6 environment-specific cutover |
| Add owned weigh-in parents and exact linked observations; compact batch mapping | Preserve event context/annotations and reduce repeated staging metadata. M1 chooses schema/RPCs and proves real-path capacity |
| Identify by owned source and exact interpreted timestamp with local-time collision protection | Reimports can enrich missing fields but changed values conflict; timezone remapping cannot silently duplicate history. No filename/hash/row/proximity identity. M1 classifier |
| Adopt only evidenced English lb headers; preserve all 24 numeric fields | Avoid inferred units and silent loss. Detailed missing-cell/time/semantic contracts live in the format manifest and M0 record. M1 registry; M3 definitions |
| Use separate IndexedDB share handoff and an opaque reference | Desktop worker/claim/expiry/fallback mechanics passed. No health bytes in public cache or URLs. M2 auth/device/update/race evidence remains |
| Adopt no numeric reference rule from incomplete public evidence | M3 obtains one applicable versioned manufacturer rule and independent boundary cases; explicit unavailable states preserve usability |
| Freeze 20-scenario comparison design before live results | Independent numeric oracles, hard critical gates and at least 90% ordinary completion. M4 final bindings; M5 current provider facts and separately approved live baseline/peer calls |

## v0.2.0 M1 implementation (2026-11-13)

| Decision | Reason and boundary |
|---|---|
| Forward migrations; version 2 Data writers and exports | Extend existing history without fabricated event backfill. Old writer RPCs are revoked; HTTP mutations require the contract header before cleanup. Incompatible pending imports/proposals are invalidated; Auth, consent and accounting remain. Hosted rollout requires separate verification and approval. |
| Exact numeric strings plus owned event parents | Preserve all 24 vendor fields, imported interpretation and annotations; value corrections retain original provenance, and time corrections move an entire event. The static registry does not activate new goal/tool capabilities. |
| Base64 CSV ingress and compact encrypted staging | Preserve file bytes and bound JSON escaping independently. Batch mapping occurs once; annotations/row labels use base64 inside staging to avoid control-character expansion. Limits remain 1 MiB / 10,000 rows / 25,000 valid numeric observations before deduplication. Normalized plaintext staging is capped at 4 MiB. |
| Disable JIT only within the import commit RPC | Measured insert compilation/processing exceeded the eight-second authenticated timeout. Cached validation definitions and classification access reduce repeated work; function-local JIT disabling removes compilation overhead without widening deadlines or weakening atomicity. |
| Carry resolved event parents by input ordinal during commit | A timestamp join chose a nested loop over 1,000 parents for 24,000 observations and exceeded the authenticated deadline in CI. A bounded UUID array reuses parents already resolved by the event loop, including repeated and excluded rows. Ownership, lineage and deferred event constraints still verify each persisted relationship. |
| Bound import lookup cost (2026-11-14) | A partial owner/source/time index excludes linked measurements from attachment probes. Materialize typed event times and aggregate persisted matches by input ordinal, avoiding repeated timestamp parsing and a correlated measurement lookup per observation. Preserve identity, collision checks and atomicity. |
| Scope longer deadlines to import RPCs (2026-11-14) | Supported full-panel imports still exceeded the default eight-second SQL deadline on main CI. Give inspect/register/review/commit 30 seconds in PostgreSQL and 45 seconds in the server transport; ordinary requests retain their defaults. A local 24,000-observation commit completed in 11,774 ms with these bounds. Preserve caller cancellation, payload limits, owner locking, atomicity and uncertain-result reconciliation. [Supabase supports per-function deadlines](https://supabase.com/docs/guides/database/postgres/timeouts#function-level). |
| Bound review choices to a replacement payload hash | Invalid cells, conflicts and populated unsupported columns require explicit acknowledgements. Resealing preserves the original expiry. Owned status/discard reconcile uncertain responses and return committed receipts truthfully. |
| Redact private baseline copies and broadly remove retained conversation/AI copies on correction/deletion | Flags alone leave private readings available. Each historical revision owns its baseline dependencies; a goal's current source/metric cannot identify earlier copies. Approved targets/states and financial holds remain; historical receipts never restore deleted data. |
| Preserve raw access for unresolved semantics; pin current goal/tool schemas | BMR and three vendor target deltas remain readable/exportable but unavailable to summary/goal operands. M3/M4 own new analysis, explanations and capabilities. |
| Rehearse upgrade in isolated local databases | The shared guarded stack retains deletion receipts. The rehearsal refuses remote Docker, creates only a generated disposable database, proves forward control preservation and fresh public-schema replay, then drops its own database. |

See [M1 evidence](evidence/v0.2.0/m1-imports.md) for executed checks and boundaries. No hosted changes, provider calls or new model approval are part of this implementation.

## v0.2.0 M3 analysis (2026-11-15)

| Decision | Reason and boundary |
|---|---|
| Explicit operations share one deterministic service | Data and conversation tools consume the same exact values, windows, coverage and result IDs. A selected-period mean weights observed daily medians equally; rolling values require three observed days. Legacy summary reads remain available while callers move to the explicit contract. |
| Owner-scoped result hashes, without a result table | Bind selection, operation, algorithm/registry versions and data revision. Current evidence is resolved only against its expected revision; changed data makes it unavailable. Evaluation time and import time remain separate from measurement dates. |
| Bounded database snapshots and indexed latest reads | Limit a batch to 24 unique series, each window to 366 local days and total analytical reads to 25,000 observations. Reject excess rather than calculate partial statistics. Inventory discovers all stored registry metrics; unresolved fields remain raw-only. |

See [M3 analysis evidence](evidence/v0.2.0/m3-analysis.md) for executed checks and remaining acceptance. This does not authorize deployment, model activation or manufacturer classification.

## v0.2.0 metric content and references (2026-11-15)

- **Separate content from ingestion.** Original explanations and display groups use `metric-explanations-v1`; their addition does not reinterpret stored observations or change the import registry version. Resolved tracking eligibility covers 25 metrics; BMR and three unresolved deltas stay raw-only. Goal mutation expansion remains P4.
- **Unavailable is a production state.** The verified range registry is empty because complete manufacturer applicability, endpoints and reuse evidence are unresolved. The deterministic resolver's injected synthetic tests prove mechanics only. No age, demographic or mode settings are collected speculatively. See the [coverage and reuse record](evidence/v0.2.0/metric-reference-coverage.md).
- **Bind reference evidence separately.** Owned reference results include the original numerical result ID and bind content/registry/resolver versions plus the stated profile basis. Content changes invalidate reference evidence without relabelling the underlying numerical result. Source labels and scale outputs do not establish manufacturer applicability or chronological age.

## v0.2.0 Data presentation (2026-11-15)

- **Name the selected operation.** Data defaults to the selected-period observed-day mean, with separate rolling and comparison controls. The chart retains the selected interval even when a rolling headline uses seven days: a second bounded server operation supplies the plot and must match the headline revision. No UI arithmetic reconstructs that statistic.
- **Verify evidence on navigation.** Data accepts the owned operation descriptor and expected result ID, then resolves them on the server. Missing descriptors, stale revisions and method changes show unavailable; requesting current data is deliberate. Account/epoch remounts and cache identities prevent retained results from flashing during account changes.
- **Invalidate owned views together.** Data mutations and source changes invalidate Data, Goals, conversation and inspection queries. Reads recheck server revisions; no realtime service or persistent analytical cache is introduced.

## v0.2.0 numeric goals (2026-11-15)

- **Share eligibility and exact reads.** Registry-derived runtime eligibility and forward SQL constraints admit 25 resolved metrics and reject four unresolved fields. The goal engine reuses explicit analysis reads; current latest evidence does not scan from year 0001. Latest ties, declared daily dates and exclusive current cutoffs are part of the versioned analysis method.
- **Separate condition from percentage and freshness.** Directional progress preserves regression/overshoot; maintained ranges have below/within/above outcomes. An approved optional elapsed-age rule can withhold a current-condition claim without changing the goal state. A zero-distance percentage stays undefined while target satisfaction remains determinable.
- **Preserve approved payloads.** The age field remains optional without a parser default; old canonical records are not rewritten to add it. New measured timestamps are stored inside frozen reference entries, which the existing redaction policy clears. Oversized new baseline evidence fails before proposal registration rather than freezing a truncated dependency list. Historical evidence above the new reference limit can be retained only unchanged for its owned approved target, preserving explicit state controls.
- **Invalidate model approval when the tool behavior changes.** P4 adds tool-visible goal evidence before P7's full tool expansion. The candidate therefore advances to `vulpes-everyday-v11` now, with unchanged historical v10 evidence intentionally failing availability checks. This brings the planned fail-closed version transition forward; no fresh capability, quality or production approval is invented. P7 will freeze the expanded contract separately.

See [M4 evidence](evidence/v0.2.0/m4-goals.md) for executed results and later group/conversation gates.

## Public source and licensing

- **License.** Vulpes uses Apache-2.0. Copied source and the Remora agent guidance keep their upstream MIT licenses and notices. The npm package stays `private` to prevent accidental registry publication.
- **Third-party names and content (2026-11-13).** Keep RENPHO references that identify CSV compatibility or metric provenance, including technical identifiers and accurate historical records. Public positioning names Vulpes as the independent application; the README and import help disclose the lack of affiliation, sponsorship or endorsement, and current compatibility claims stay bounded to the implemented English layout. The application license grants no third-party trademark or separately licensed content rights. v0.2.0 REF-07 requires a recorded reuse review before including manufacturer-derived content; attribution and factual verification alone do not establish reuse rights.
- **What public evidence contains.** Technical results, dated candidates and verification limits. It leaves out personal usage, account balances and backup-custody details, which stay outside the repository. Cleaning up the public repository kept the existing Git history, so earlier operational metadata is still there.
- **Publishing is not activation.** Publishing source does not authorize hosted testing, deployment, provider usage or broader release acceptance.

## Owner pilot and providers

- **Luna-only hosted pilot.** The owner authorized a hosted pilot that uses Luna under current consent, trace encryption and persistent account and application budgets. Local defaults keep inference off. The server-side typed catalog owns models and limits. Flash, Argon and decision scoring each need separate evidence and approval.
- **Evidence binds a prompt version.** v7 evidence ([record](evidence/luna-owner-pilot-live.md)) cannot authorize a later template. The v8 synthetic packet failed, v9 passed its technical checks, and v10 passed on 2026-11-10 ([record](evidence/luna-v10-technical.md)). The owner approved the v10 production binding that day and deferred model benchmarks. Deployment is a separate decision.
- **Fail closed without evidence.** The committed owner-pilot-Luna mode refuses an entire new hosted build until matching passing evidence exists. The artifact already serving stays up.

## Ask behavior

- **Server-supplied dates (v8).** Requests carry the server instant and the owner's profile-local date. Read tools resolve local dates across DST on their own and return bounded validation feedback. Authorization, infrastructure and ledger errors still fail closed. Rejected tool input stays inspectable and exportable under the same encryption, hash and ownership checks.
- **Body-fat floor.** The owner approved an AI-only refusal of body-fat targets at or below 2%, including range boundaries and merged revisions. This is a conservative product rule, not a clinical safe range. Storage validation and direct owner entry are unchanged.
- **Interval mismatch (v9).** A correctly dated single-day query was once answered with a seven-day scalar. Tool projection 4 now withholds a scalar when the selection and calculation intervals differ, and prompt v9 requires the answer to state the limitation. The deterministic statistic is unchanged. See the [v8 and v9 record](evidence/luna-v8-v9-verification.md).
- **Shorter prompt (v10).** The prompt drops account selectors, sharing and data-entry inventory, which do not help the model do its task. It keeps authorized-tool use, server-supplied identity and permissions, and the wellness, data-grounding and goal-approval rules.
- **Streaming checkpoints.** Response checkpoints batch by time and size. Committed prefixes are written before emission and capture stays byte-exact, so valid text can be saved before a parser failure ends the run. The agent finalizes its own runs. Cancellation fencing and cleanup on iterator disposal are enforced. Step payloads share one database-clock expiry, so later writes cannot extend retention. Reads enforce expiry, ownership and decryption but never start cleanup, which stays with bounded maintenance.

## Deployment

- **Vercel Git deployment (2026-11-05).** The owner replaced the custom GitHub and Vercel promotion controller with Vercel Git deployment and a required `Main / Release gate` check. The check runs on pushes to `main` only, depends on all three CI jobs and needs every result to be `success`. Vercel owns publication and ordering. The build still checks production target, configuration, source metadata, inference approval and migration completeness, and emits safe diagnostics. The custom promotion journal, polling and GitHub read credential are retired. This trades custom latest-run guarantees for platform behavior and does not promise safety against every supersession window. [Owner operations](operations/owner-pilot-data.md#deployments-and-checks) owns the current guidance.
- **Production bindings.** The repository binds the existing production target and Luna mode, and credentials stay in Vercel's Production environment. Builds validate the project ID and configured application origin, not Vercel's preferred-domain metadata, which can name another verified alias. Deployments do not apply migrations or call a model.
- **Root `tsconfig.json`.** Vercel's function compiler reads the root `tsconfig.json`, which extends the server configuration. Target and module settings are explicit at the root because Vercel applies ES2021 and non-strict module defaults before it resolves inherited settings. This keeps ES2023 library declarations and strict union narrowing during packaging.
- **Migration inventory.** Hosted builds require every repository migration version, read through a service-only RPC. An exact required set catches older missing migrations that a maximum-version comparison would miss, and extra forward versions allow additive rollout. This is ledger evidence, not proof against manual schema drift. Apply the introspection migration before merging dependent code, and keep future migrations compatible with the app still serving traffic.

## Recovery and data scope

- **Owner scope.** Owner-data capture, journal and maintenance use explicit owner manifests and a server-controlled data-scope marker. Synthetic operations reject the marked owner. Backup, journal and trace keys stay separately recoverable. Restores are fenced, reconcile independent deletion and accounting evidence, and never authorize access. See [hosted recovery](operations/hosted-recovery.md).
- **Invited-pilot manifest.** Invited-account operations use an `invited-pilot` manifest with at most ten owner, invited and synthetic identities, set through `ownerUserId`, `invitedUserIds` and `syntheticPeerUserIds`. Each operation needs its own authorization and does not discover accounts. Inviting accounts is a separate decision.
- **Clean break (2026-11-10).** The new manifest contract replaces the named-account one with no runtime aliases, legacy readers or SQL migrations. Removed flags, purposes and UUID fields fail closed, and owner and synthetic manifest hashes are unchanged. Local inspection found no old manifests or archives, and the hosted check records temporary-account cleanup and owner-mode backup custody. Hosted metadata and external private custody were not re-inspected, and no live transition was made. Confirm any required legacy recovery state before retiring the old tooling or changing live markers. The [implementation plan](https://github.com/edumarcano/vulpes-health/blob/ed62dbecfb3292187300a42cc042030e8cb40bd7/docs/plans/invited-accounts-clean-break.md) is kept at the reviewed revision.
- **Seven-day snapshot target.** A manual seven-day snapshot target and a pre-release capture requirement were added without changing the 30-day retention ceiling. Hosted whole-project restoration is deferred for the personal release. Missing source-loss deletion or accounting completeness blocks restored access.
- **Accounting fingerprint.** The original fingerprint query selected the wrong XML root, so its historical match results did not prove freshness. The corrected query and synthetic regressions require current independent reconciliation before anyone relies on a result.
- **Infrastructure status.** A manual aggregate check and the existing maintenance process report database size and total disk use separately. Backup inspection authenticates the archive, copy and retained trace-key samples. It does not establish independent custody or a successful restore.

## Data and goals

- **Measurements.** Exact decimal values, provenance, original units and timestamps are preserved. Leap-second timestamps are rejected before JavaScript and PostgreSQL can read them differently. Daily goal totals use local-day bounds. Direct and chat goals share explicit approval, revisions and deterministic progress.
- **Measurement lifecycle.** Correction/deletion removes affected private baseline values/references and retained owned conversation/AI copies. Approved targets/states and accounting remain. The current [import/lifecycle contract](operations/data-imports.md) owns event correction, last-child cleanup, historical replay and the distinction between local verification and approved operations.
- **RENPHO import.** The versioned English lb adapter preserves all 24 supported numeric fields and three annotations, with explicit profile/timezone confirmation and reviewed atomic commits. See [M1 evidence](evidence/v0.2.0/m1-imports.md); the earlier [v0.1.0 evidence](evidence/renpho-import.md) records its narrower historical scope.
- **Import navigation.** After an import, the user picks a series to open. The range comes from full-batch metadata and covers at most 366 local days ending at the latest imported observation. This avoids inferring the series from the truncated preview or changing filters before the user chooses.

## Retention and spending

- **Account deletion.** Deletion is resumable and keeps uncertain charges until settlement. Completed deletion receipts last at least 31 days, and encrypted database backups last at most 30 days. [Account lifecycle](operations/account-lifecycle.md) owns the details.
- **24-hour uncertain-charge policy.** The conservative full-reservation hold for an interrupted request stays. The single-request reserve is $0.0093192, and lowering it because most requests cost less would remove the bounded-cost guarantee. Streaming repairs and saved-run inspection are the smallest nonfinancial mitigation. Any allocation or settlement-policy change needs separate owner approval.

## Client delivery (2026-11-06)

- **Deferred features.** Protected pages and assistant Markdown load on demand, and React has one shared chunk. The service worker precaches public and offline shell assets only and leaves application JavaScript and CSS to browser caching. This avoids downloading unused features at install time and keeps the offline page free of data.
- **Bundle limits.** Bundle checks cap JavaScript chunks at 500 kB. Production browser checks cap initial sign-in JavaScript at 750 kB (220 kB gzipped).
- **Build scripts.** npm approval covers only the locked esbuild 0.28.2 install script.

## M2 ingestion (2026-11-15)

- **One review path.** Picker and installed-PWA files use `/data/import` and the existing version 2 APIs. Compatible saved mappings can create a preview directly; a share first requires explicit account confirmation. Owned preview/status responses return the batch's confirmed mapping to keep recovery independent of newer defaults.
- **Bounded local exception.** A module service worker receives exactly one CSV without a server upload. A dedicated IndexedDB transaction owns the file, owner/generation fence and consumer lease. Raw bytes expire 15 minutes after receipt and are removed when preview is confirmed. Public caching remains limited to enumerated shell assets.
- **Recovery metadata.** A separate single-operation locator is saved before network dispatch and expires within 24 hours or the earlier server preview expiry. It carries IDs/hashes and phase, never file bytes, values, a full mapping or credentials. This permits status-first recovery after reload or a lost reply without extending raw-file retention. Clearing local recovery does not cancel a possibly running server request.
- **Worker lifecycle.** Workers wait for existing windows; no forced activation or automatic retry/commit. The manifest accepts `.csv` and `text/csv`, with the file picker as the platform fallback. [Import operations](operations/data-imports.md) owns the intake and recovery contract.

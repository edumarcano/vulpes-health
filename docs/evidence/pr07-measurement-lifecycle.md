# PR 07: measurement correction, deletion and export

2026-10-25. Scope: the final implementation packet in the approved M2 batch, after manual Data PR #6 and CSV PR #7 merged. Branch `feat/pr07-measurement-lifecycle` starts at refreshed `origin/main` (`aacc4897b9ba08b15c0a6c0b4dc758212ef56fd8`); target is `main`. This is host self-review and synthetic local verification, not the independent cumulative M2 review or hosted acceptance.

## Delivered behavior

| Area | Implementation and proof |
|---|---|
| Correction | Expected version, request identity, exact SQL unit conversion, time/date/timezone validation and conflicts. Preserve source, metric, method, granularity, external identity and import lineage; add `user_corrected`. Real persisted-row assertions compare immutable fields and provenance. |
| Deletion | Physically remove the reading, invalidate pending owned previews and remove owned import staging. Conservatively remove retained AI request/response/tool/provider-state envelopes; keep accounting and record trace removal on runs. Real A/B-account payload/reference assertions pass. |
| Baselines | Mark matching owned source/metric baselines `needs_review`; advance goal version only when that marker changes. Existing M2 metadata does not establish precise dependency windows, so marking is conservative. Tests compare the entire frozen goal and immutable revision payloads before/after both mutations. Goal workflows remain PR 11. |
| Transactions | Active-profile lock precedes row/batch/envelope writes, serializing add/import/correction/deletion. Versions and database-computed hashes prevent conflicting or changed retries. Historical acknowledgements contain no measurement values. Correction/deletion and import races assert rows and resulting revision, not status alone. |
| Export | Authenticated no-store selected-scope CSV, schema version, canonical/original exact decimals, timestamps, source metadata and provenance identifiers. Read 200-row pages with revision checks, stream into an AES-GCM encrypted temporary file, then stream validated content to the response. Completion/failure removes the artifact and zeros its ephemeral key. Cancellation aborts reads. No public artifact or persisted export key. |
| Spreadsheet safety | Quote CSV fields and escape formula-sensitive text after leading whitespace/control/format characters. Preserve numeric negatives and all decimal digits. Unit tests, actual HTTP parsing and downloaded browser files inspect values. |
| Interface | Explicit edit review and deletion confirmation, before/after values, fixed series identity, frozen-baseline/trace warnings, stale-version refresh and query invalidation. Disable stale previews. Authenticated downloads use identity epochs and revoke object URLs; real late-response barriers verify account changes discard mutations/downloads. |
| Retention | Bounded owned opportunistic cleanup and the guarded inactivity command expire batches and remove staging/orphan expired envelopes. Read/commit expiry remains independent. Real CLI assertions inspect persisted effects; cross-account isolation and 100/1 work batches pass. |

## Commands and observed results

| Command or interface | Observed result |
|---|---|
| `npm run lint` | Passed, zero warnings after fixing diagnostics in local proof scripts. |
| `npm run typecheck`, `npm run build` | Strict application/server/tool compilation and production build passed through the final bundle/browser runners. |
| `npm test` | 266 tests, 16 files passed. Includes unchanged numerical, adapter, contract and isolation helpers plus 17 CSV safety/edit-contract cases. |
| `npm run db:start`, `npm run db:reset:test` | Guarded local synthetic stack; clean eight-migration replay passed. |
| Forward upgrade | Reset to PR 06 migration `20261025000300`, seed a synthetic graph, apply PR 07. Deep-equal preserved profiles, measurements, batches, goals, revisions, receipts and private envelopes. New run marker defaults to null. |
| `npm run db:lint`, `npm run db:types:check` | No schema errors; generated types match. `npm run db:types` regenerated types after migration. |
| `npm run test:db` | 457 pgTAP assertions passed, including new function grants/search paths and invoker RLS. |
| `npm run test:integration` | 99 real local Auth/HTTP/PostgREST/SQL tests, six files passed. New lifecycle file has 12 scenarios. |
| `npm run test:e2e` | First standard full built run passed 88. After the final streamed-export changes, a diagnostic copy of the same guarded runner passed all 88 in 3.4 minutes with normal startup/shutdown. Two intervening failed standard runs are retained below; no assertions or timeouts changed. |
| `npm run test:dev` | Nine actual `dev:full` proofs passed on the final streamed-export code in 41 seconds, including the complete M2 journey. |
| `npm run test:bundle` | Eight public files inspected; no secret canaries, source maps, server catalog, private server output or synthetic harness leaked. |
| `npm run test:providers` | Offline contracts passed; actual provider requests 0, inference spend $0. Generation unavailable; optional decisions disabled. |
| `python docs/spec/v0.1.0/scripts/validate_spec_package.py` | 478 specification/fixture checks passed. |
| `git diff --check` | Passed. |

The actual local HTTP proof used the production router, verified sessions, encrypted staging, transactional persistence, deterministic analysis and streamed CSV. It printed:

```json
{"artifact":"m2_lifecycle_http_proof","synthetic":true,"imported":28,"before":{"current":69,"previous":69.7,"change":-0.7},"correctedMean":70,"deletedMean":68.95,"survivingWeightExport":13,"revisions":[1,2,3],"deleteRetrySameOutcome":true,"foreignExportStatus":404,"inferenceRequests":0}
```

The 76.3 kg correction replaces the September 8 reading, increasing the seven-day mean from 69.0 to 70.0. Deleting that reading leaves six valid days with mean 68.95. Historical reimport preserves 27 surviving total observations without restoration; a separately confirmed fresh one-row import can recreate the deleted reading. The export race test reads 205 rows across pages, performs a real concurrent mutation, and verifies a JSON 409 without a partial CSV. Scheduling interception does not replace database reads or mutation execution.

## Artifact inspection and test assurance

Built Chromium exercised 360×800, 390×844, 430×932, 768×1024 and 1440×900 in light/dark, reduced motion and 200% text. Full-page correction/deletion captures and actual downloaded synthetic CSVs are ignored under `test-results/measurement-lifecycle-*`; retained local copies are under `.cache/pr07-artifacts/`. Desktop light and mobile correction/deletion images were inspected. Keyboard tests verify review-action focus and return to the table heading. Labelled table scrolling remains the narrow-screen alternative. Browser emulation does not establish physical keyboard or native screen-reader behavior.

| Requirement → plausible defect → production path | Observable protection and certainty |
|---|---|
| DATA-15: stale write silently overwrites a correction | Competing real RPC/HTTP mutations yield exactly one change and one revision increment; the loser receives 409/404. UI shows refresh and preserves the newer persisted value. Established. |
| DATA-10/15: correction/deletion leaves an old summary | Actual CSV import → correction → deletion changes the analytical mean 69 → 70 → 68.95 through HTTP and built UI. Refetched chart/table and download use the new revision. Established. |
| Baseline preservation: a data edit recalculates an approved decision | Synthetic administrative fixtures supply existing frozen goals/revisions; real mutations change only review status/version (and normal update timestamp). Full before/after equality protects snapshots, targets, states and payloads. Established for M2 markers; full approval workflows remain unimplemented. |
| SEC-01/02/03/07: foreign IDs or late account replies leak content | Real A/B API/RLS/RPC denial, denied direct writes, separate foreign payloads, and actual late mutation/export response barriers. Established locally. |
| SEC-05/export: numeric negatives are treated as formula text, or malicious text executes | Parsed CSV preserves exact negative decimals, prefixes formula-sensitive source metadata, and retains quote/newline boundaries. Actual browser download has the same values and revokes its object URL. Established CSV content; external spreadsheet application behavior untested. |
| Privacy: deleted readings survive in staging/traces, or export leaves plaintext files | Real database assertions find no retained owned staging/trace envelopes, clear FK references and preserve foreign envelopes/accounting. Direct database-backed export inspects temporary ciphertext and proves removal after completion/abort. Established locally. |
| MOD-04–06/COST-01/OPS-01: domain operations require inference or cache private data | Existing adapter/oracle/dependency tests, disabled-provider smoke, bundle scan and real browser no-model checks pass. API/export responses are no-store; no app health content is written to browser storage. Established for implemented Data; later goal/AI/release gates remain separate. |

## Retained failures and repairs

| Observed failure or review gap | Resolution |
|---|---|
| All first ten lifecycle scenarios passed, but active synthetic goal cleanup failed when clearing the current revision. | Reproduced teardown constraint failure. Reset fixture goals to draft before clearing references; clean reruns pass. This changes test cleanup only. |
| Initial export buffered all selected CSV rows. | Review identified the large-export contract gap. Replace buffering with owned-page streaming through an encrypted temporary file. Real ciphertext/completion/abort tests pass. |
| Type checking rejected `abortSignal` after `maybeSingle`. | Move abort configuration before the single-row transform. Strict final build passes. |
| Lint found an explicit unsafe type and unused binding in ignored local proof scripts. | Corrected both local scripts; final lint passes. Neither script is committed. |
| Two full browser reruns lost the local preview server during existing auth/manual cases: 5/25 passed respectively before cascading `ERR_CONNECTION_REFUSED`. | Both app ports stopped listening. Preserved first-error evidence locally. The standard runner strips shell `DEBUG`, so a local diagnostic copy forwards only that diagnostic setting while retaining accounts, assertions and guards. Root cause remains unestablished; failed runs are not acceptance. |
| The first relocated diagnostic runner could not resolve its local database-helper import. | Corrected the local relative path before execution. The diagnostic run then passed all 88 with normal lifecycle logs; no diagnostic copy is committed. |

No assertion or timeout was weakened to accept a defect.

## Split-axis self-review

**Axis 1: specification fulfillment — Approved for PR 07.** Reviewed the actual tracked/untracked incremental change and callers against the approved PR 07 packet, API/Data/security/UI contracts and applicable M2 acceptance IDs. Owned correction/deletion/export and cleanup are implemented, with frozen baseline preservation, historical replay, numerical changes and the complete local M2 journey demonstrated. Final integration, browser, development and documentation checkpoints pass as distinguished above. No M3, goal activation or inference workflow was added. No remaining demonstrated contract/correctness blocker was found. This is PR 07 local acceptance, not complete M2 acceptance.

**Axis 2: engineering/security/test assurance — Approved with observations.** Reviewed request validation, profile/row lock order, SQL numeric constraints, uniqueness, authenticated-identity-derived execution, narrow grants/empty search paths, invoker export RLS, receipt privacy, staging/trace deletion, temporary AES-GCM export lifecycle, cancellation, client identity epochs and cache invalidation. Applied the React checklist to state lifecycles, identity guards, query refresh, lazy chart boundary, focus, labels and download URL cleanup. Tests exercise production paths with distinct persisted-state and numerical assertions. Supported findings were fixed and rechecked; no remaining demonstrated security/data-loss/contract blocker was found.

Observations: intermittent local preview-server loss remains unexplained; the final complete diagnostic run passed all 88 with normal startup/shutdown and the standard development runner passed nine. No product fix or permanent host-stability claim is made. Existing Vite chunk advisory remains: main approximately 1.20 MB minified / 347 kB gzip; chart approximately 352/102 kB and CSV parser approximately 51/14 kB. Hosted routing/auth/CSP and temporary-storage behavior, physical devices, native screen readers, full account export/deletion and live providers remain unverified. A crash may leave unrecoverable ciphertext in OS temporary storage; its random key is never persisted. These local results do not establish family/pilot readiness or complete M2 acceptance. The independent cumulative M2 review remains pending.

**Approved deviations:** None. Provider requests: 0; inference spend: $0. Local synthetic Supabase/Chromium only; no hosted resource, real health record, live provider, merge or M3 work.

Final cleanup inspection returned zero Auth users, all 15 owned/accounting tables empty, and zero temporary export directories. `npm run db:stop` stopped the dedicated stack; its empty local volumes remain recoverable. Generated browser images/downloads and diagnostic scripts remain ignored locally. The PR record and final handoff identify the published commit and review status.

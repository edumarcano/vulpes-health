# PR 06 CSV preview and transactional import

Branch `feat/pr06-csv-import` starts at refreshed `origin/main` `5b00a68`. PR 05 (GitHub #6) was verified merged on 2026-10-25. The approved M2 batch plan supplied in chat owns the shared interfaces; this packet implements only PR 06. All data, accounts and files are synthetic. Hosted changes, live AI requests and actual spend: **0 / $0**.

## Delivered boundary

Canonical and explicitly mapped wide CSVs feed the existing exact normalizer. Source identity, profile selection, units/methods, blank/error/exclusion counts and ignored columns remain explicit. Previews encrypt normalized staging, bind reviewed classifications and revision, and expire within 24 hours. The commit transaction rechecks exact bytes, hash, ownership, source metadata, expiry, revision and conflicts, then atomically inserts only approved new observations. Historical reimports/retries never reinsert data.

The Data screen includes file/mapping, bounded preview, explicit confirmation and recorded result, with keyboard focus and identity-epoch protection. No raw CSV is persisted. Correction/deletion/export, goal activation, inference and global inactivity maintenance remain later work.

## Checkpoints and verification

| Command / interface | Observed result |
|---|---|
| `npm test` | 249 tests passed across 15 files, including 11 parser tests and the existing exact numerical/goal/adapter regression cases. |
| `npm run test:integration` | 87 real tests passed across five files, including 13 CSV HTTP/Auth/PostgREST scenarios. Both 5,000 repeated and 5,000 distinct observations pass without raising timeouts; exact persisted count is checked. |
| `npm run test:db` | 443 pgTAP assertions passed: isolation, grants, private helpers, empty search paths and existing ownership constraints. |
| `npm run db:reset:test` | Clean replay of all seven migrations passed during development. |
| Guarded reset to `20261025000200`, seed synthetic graph, `runSupabase(['migration','up','--local'])` | Forward upgrade passed twice, including the final SQL. Deep comparison preserved the complete existing measurement and profile; existing import batches retained safe defaults for new fields. Synthetic graph removed in `finally`. |
| `npm run db:lint` / `npm run db:types:check` | No schema errors; generated types match the final database. |
| `npm run test:e2e` | Final full run: 71 built-browser tests passed. Includes 28 canonical/five wide observations, historical replay, profile exclusions, conflicts, failed/expired preview recovery, lost replies, source-warning escaping, and late preview/commit completion after account switch. |
| `npm run test:dev` | Eight `dev:full` proofs passed. A diagnostic run used the same guarded runner with only `DEBUG=pw:webserver`; no assertions, timeouts or production behavior were changed. Earlier host failures are retained below. |
| `npm run lint` / `npm run typecheck` / `npm run build` | Zero lint warnings; all three strict TypeScript checks and production/server builds passed. Builds were also run by both guarded browser commands. |
| `npm run test:bundle` | Eight public files passed secret-canary, source-map, server-catalog and private-harness checks. |
| `npm run test:providers` | Synthetic adapter contracts passed. Actual provider requests 0; inference spend USD 0. Generation remains unavailable; optional decisions remain disabled. |
| `git diff --check` | Passed; generated-file line-ending advisories do not indicate whitespace defects. |
| `python docs/spec/v0.1.0/scripts/validate_spec_package.py` | 474 specification and fixture checks passed. |
| `npm ls --depth=0` | Pinned direct dependencies resolve without invalid peers. Installation audit reported zero vulnerabilities. |

A separate real HTTP exercise printed this inspected, identity-free synthetic artifact:

```json
{"canonicalPreviewNew":28,"canonicalInserted":28,"retrySameOutcome":true,"historicalReimport":true,"alteredConflicts":1,"foreignStatus":404,"current":69,"previous":69.7,"change":-0.7,"wideInserted":5,"pounds150kg":"68.0388555"}
```

The script used the actual local router, authenticated requests, encrypted payload storage and database transactions, with no transport replacement. The committed integration suite reproduces those paths with `npm run test:integration -- tests/integration/imports.test.ts`.

Import previews were captured at 360×800, 390×844, 430×932, 768×1024 and 1440×900 in light/dark themes, including 200% text. Body overflow assertions, labelled scrolling tables, confirmation/result focus and synthetic warning text escaping passed. Mobile dark and desktop light captures were visually inspected. Final built-browser captures are preserved locally under ignored `.cache/pr06-artifacts/imports-CSV-*/import-preview.png` and `import-zoom.png`; manual Data captures are preserved alongside them. Browser emulation does not establish physical-device or native screen-reader behavior.

## Requirement trace and test assurance

| Protection | Production path and failure signal |
|---|---|
| DATA-01–09 | Parser → shared exact normalizer → encrypted preview → authenticated SQL. Fixture values/counts, profiles, blanks, units, offsets, duplicate/conflict outcomes and stored provenance distinguish parsing or identity defects. |
| Transaction integrity | Concurrent commit/retry, forged bytes/hash, foreign/expired/tampered/stale staging and changed source metadata cannot add rows. A trusted synthetic invalid second row passed directly to SQL proves that a later constraint failure rolls back the first insert and revision. The HTTP path independently rejects that invalid normalized staging. |
| Historical replay | After a synthetic administrative removal and revision change, reimport returns the historical acknowledgement and leaves 27 surviving rows; no PR 07 deletion workflow was implemented. |
| Privacy / isolation | Real A/B Auth, direct RPC/PostgREST, private staging denial, orphan cleanup, encrypted content/hash, expiry and post-commit removal. Late actual preview/commit replies cannot populate the next account. Receipts contain IDs, hashes and outcomes, with request hashes computed in SQL. |
| MOD-04–06 / COST-01 | CSV/manual reuse one normalizer and unchanged provider-free analytics. Existing adapter/catalog tests and disabled-provider HTTP/UI paths pass; no inference is needed for import or analysis. |
| DATA-10–14 / GOAL-04–05 | PR 05 numerical and pure-helper regression tests remain green, including the 69.7 → 69.0 oracle, body-fat percentage points, decimal conversion and guarded progress. DATA-15 and complete goals remain later work. |
| SEC / UI / OPS | Applicable local SEC-01–05/07, routing, build, bundle and presentation gates pass. Provider-consent regression coverage is retained. Hosted SEC-08 and other release/pilot gates remain unverified. |

## Retained failures and repairs

| Failure | Repair / verification |
|---|---|
| A profile filter mutated a shared required-column array and affected later requests. | Copy the arrays per parse. The original ordered parser regressions pass. |
| Direct RPC conflicts/missing previews returned generic HTTP 500. | Explicit `PT409`/`PT404` errors retain safe application envelopes and direct HTTP semantics. |
| Immediately after one database reset, previews returned 503; a subsequent real run passed without a production change. | Accepted transient startup observation; root cause was not established. Subsequent clean replay, forward upgrade, lint and sequential real checks passed. |
| A nested hint expanded the accessible name of the source/profile input. Select tests also queried complete label text rather than computed roles. | Give the hinted inputs explicit names and use labelled combobox roles; actual development import passed. |
| Some development/built runs lost their local web server; one separate manual Data screenshot timed out after fonts loaded. | Failed runs were not used as acceptance. Diagnostic development run passed all eight checks with normal startup/shutdown logs; the final full built run passed all 71. Root cause of the intermittent host failures is unestablished; no test was weakened or timeout raised. |
| Replaying the same registration RPC removed its active staging envelope. | Preserve the envelope referenced by the existing batch, while removing a redundant retry envelope. Real direct replay regression passes. |
| A lost preview reply created a second source on retry. | Bind the in-memory retry key to a SHA-256 digest of file/source/mapping; the failing real browser case now leaves one source. The digest retains no raw CSV. |
| Source metadata could change between preview and commit without rejection. | Store a database-computed source hash and recheck it at commit; the previously failing real namespace-change case now returns 409 and closes the preview. |
| Pairwise duplicate classification timed out at 5,000 observations (`57014`). | Group external/time/daily identities without pairwise expansion. Both 5,000 repeated and 5,000 distinct observation tests pass under unchanged database timeouts. |
| Explicitly discarding an expired preview and choosing the same file reused its failed request key. | A newly selected file resets preview identity; ordinary lost-reply retries keep it. The previously failing browser recovery case passes. Native file input state is cleared after reading. |
| CSV source-warning flags were rejected by the manual-only normalizer input contract. | Shared normalization accepts bounded warning text; the manual mutation schema remains restricted to its explicit review flag. Unit, real staging/commit/read and browser script-text regressions pass. |

No assertion was weakened to accept a demonstrated defect.

## Split-axis self-review

**Axis 1: specification fulfillment — Approved for PR 06.** Reviewed the actual incremental changes and callers against the supplied M2 batch, execution ledger, Data/API/security/UI specifications and applicable acceptance IDs. Bounded canonical/wide mapping, exact normalization, source/profile filtering, explicit exclusions, encrypted preview binding, transactional commit, replay and browser confirmation are implemented and demonstrated. Source warnings remain data; no clinical ranges or vendor compatibility were invented. No PR 07 operation was added. This is local PR 06 acceptance, not complete M2 acceptance.

**Axis 2: engineering/security/test assurance — Approved with observations.** Reviewed owner derivation, active-profile locking, authenticated narrow functions, grants/search paths, staged-byte/hash/source/revision checks, rollback behavior, receipt privacy, envelope cleanup, client identity epochs, retry lifecycle, React state/focus and bundle boundaries. The suites exercise production parsing, normalization, Auth/HTTP/PostgREST/SQL and rendered controls. Synthetic administrative setup for rollback/removal tests is explicitly separated from operational application capability. The demonstrated blockers above were repaired and rechecked; no unresolved correctness/security/contract blocker was found.

Observations: Vite retains its existing large-main-chunk advisory (about 1.19 MB minified / 345 kB gzip); CSV parsing is a separate approximately 51 kB / 14 kB browser chunk. Intermittent local host/test capture failures are recorded above, with successful full reruns and no established product cause. Hosted routing/auth/CSP, physical-device behavior and live providers are unverified. M2 still needs PR 07 and the comprehensive independent review from a fresh context.

**Approved deviations:** None. Maximum authorized paid spend and actual spend are $0. No hosted resource, real health record, merge or PR 07 implementation was used.

Final cleanup inspection returned zero Auth users, profiles, sources, measurements, import batches, private payloads and audit receipts. `npm run db:stop` stopped the dedicated disposable stack; its empty local volumes remain recoverable. Standard `npm run test:dev` also passed all eight final scenarios without diagnostic logging. No temporary diagnostic script or generated browser artifact is committed.

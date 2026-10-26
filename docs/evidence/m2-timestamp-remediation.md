# M2 timestamp remediation

## Scope and reproduction

The independent review covered M2 plan PRs 05–07 (GitHub #6–#8), cumulative range `f4939df..0e59d8c`. This remediation starts from refreshed `main` at `0e59d8c0574b673b6ce465a5164597dcb0d7e43c` on `fix/m2-timestamp-parity`. The starting tree was clean.

F1 reproduced with synthetic weight `70 kg` at `2026-09-01T23:59:60Z`, timezone UTC. The reviewed manual/correction paths returned HTTP 200 and stored September 2 at midnight; CSV normalized and committed September 1 at 23:59:59. The day therefore depended on the ingestion path.

Before production edits, new regression assertions failed:

| Command | Observed failure |
|---|---|
| `npm test -- --no-cache tests/unit/measurements.test.ts tests/unit/csv.test.ts` | Six failures: five second-60 variants were accepted; canonical CSV produced a normalized row instead of an invalid-row count. 41 existing/control assertions passed. |
| `npm run test:integration -- --no-cache tests/integration/measurement-lifecycle.test.ts tests/integration/imports.test.ts -t 'second-60\|ordinary boundary'` | Two failures: manual HTTP returned 200 instead of 400; preview classified the malformed row as new. The ordinary boundary parity control passed. |
| `npm run test:db` | Ten of eleven new assertions failed, including direct RPC acceptance, changed revision/counts/version and a reading shifted into September 2. Existing 457 isolation checks passed. |

The first pgTAP reproduction also exposed an unscoped version subquery after the bad entry created extra rows. Scope that assertion to the original reading; the complete red rerun above produced eleven assertions without a harness error. Both pgTAP runs rolled back their fixtures.

## Repair and protection

Restrict seconds to 00–59 before parsing in the normalizer and correction service. Forward migration `20261025000500_measurement_timestamps.sql` replaces the two existing mutation functions with the same timestamp restriction. No merged migration, stored row, receipt, lock order, grant, or API shape is rewritten.

Unit tests cover UTC/offset/naive second-60 inputs, fractional seconds, and valid second-59 precision. Database-backed HTTP and direct RPC tests assert rejection plus unchanged readings, source counts, versions and data revision. CSV preview/commit checks exclude the invalid row and preserve the valid row. Persisted manual/CSV/correction parity uses `2026-09-01T23:59:59.123456-04:00`, expecting exactly `2026-09-02T03:59:59.123456+00:00` with the original offset and timezone. Browser tests cover visible entry/correction errors and reviewed CSV exclusion followed by a real commit.

## Verification

The forward migration applied successfully to the existing guarded local synthetic Supabase stack using `runSupabase(['migration','up','--local'])`. Focused post-repair checks passed: 47 unit assertions, three HTTP integration scenarios and all 468 pgTAP checks.

| Final check actually run | Result |
|---|---|
| `npm test -- --no-cache` | 273 passed across 16 files. |
| `npm run test:integration -- --no-cache` | 102 passed across six files, using real local Auth, HTTP, PostgREST and PostgreSQL. |
| `npm run test:db` | 468 passed, including 11 timestamp assertions under the authenticated database role. |
| `npm run test:e2e` | Clean final run: 90 passed in 3.5 minutes against the built application; real synthetic sign-in, API, persistence and downloads. No retry or timeout was relaxed. |
| `npm run build` (inside the browser runner and bundle check) | Strict application/server/tool type checks, Vite production build and emitted server build passed. Existing large-chunk advisory remains. |
| `npm run lint`, `npm run typecheck` | Passed. Final lint also passed after correcting the browser assertions. |
| `npm run db:lint`, `npm run db:types:check` | No schema errors; generated types unchanged. |
| `npm run test:bundle` | Eight public files passed secret-canary, source-map and server-boundary checks. |
| `python docs/spec/v0.1.0/scripts/validate_spec_package.py` | 479 checks passed, including after the final evidence expansion. |
| `git diff --check` | Passed. |

An executable comparison against the merged function definitions confirmed that seconds validation is the only body change in each forward-migrated RPC. Existing isolation/grant/search-path checks passed.

Actual browser proof: malformed entry and correction returned HTTP 400, displayed validation errors and retained the original September 8 reading. CSV preview displayed `1 new; 0 duplicates; 0 conflicts excluded; 1 invalid`, identified row 2, and showed only the valid `23:59:59.123456Z` observation. Commit saved exactly that one instant. Screenshots `second-60-correction-rejected.png` and `second-60-csv-preview.png` were generated under ignored `test-results/` and visually inspected. The existing M2 journey still demonstrated means 69 → 70 → 68.95 kg and surviving-data export.

## Retained verification failures

| Failure | Classification and resolution |
|---|---|
| New browser assertion expected UTC rendered as `Z`; the persisted table uses equivalent `+00:00`. | Fixed test representation error. Assert the exact existing table representation while retaining date/time and row-count checks. The final complete run passed. |
| The bundle checker was mistakenly run during the first browser run; it rebuilt the shared assets. That run reached 32 passing cases, one UTC-representation failure, then two timeouts and was stopped. | Invalidated verification run, excluded from acceptance. Stopped the identified Playwright process and descendants; the parent runner cleaned its accounts. Reran the standard browser runner alone against one fixed build; all 90 passed. No product workaround was introduced. |

## Split-axis self-review

**Axis 1: specification fulfillment — Approved for F1 remediation.** Reviewed all tracked and untracked changes from `0e59d8c`, the normalizer/correction callers, CSV preview and commit, exposed mutation RPCs, and DATA-09/MOD-04 requirements. Unsupported second-60 input cannot create or move a reading through the tested public/direct paths. CSV exclusion is explicit before commit; ordinary timestamps, offsets, microseconds, valid DST handling, numerical fixtures and the Data lifecycle remain protected. The API contract documents the supported representation. No clinical plausibility rule or analytical algorithm was added.

**Axis 2: engineering/security/test assurance — Approved for F1 remediation.** The repair changes only bounded validation at existing boundaries. The forward migration preserves ownership-derived authorization, grants, empty search paths, lock order, receipt handling and transaction behavior; executable definition comparison and 468 pgTAP checks support that conclusion. Regression assertions failed on the original production paths and pass after repair, including persisted-state comparisons and real browser outputs. No new dependency, helper framework, service or privileged interface was introduced. No blocking or advisory finding remains in the focused diff.

These are self-review verdicts for the remediation, not an independent re-review or M2 acceptance. No approved scope deviation.

## Boundaries

Synthetic records and local Supabase only; live AI disabled. No hosted resources, provider calls, real health data or spend. Existing timestamps are not repaired because their intended input is unavailable. Hosted deployment, physical-device behavior and later milestone features remain separate gates. M2 acceptance is not implied by this remediation record.

Final cleanup inspection found zero synthetic Auth users and all 15 owned/accounting tables empty. The dedicated local stack was stopped after verification; no health record or screenshot was added to source control.

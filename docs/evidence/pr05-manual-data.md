# PR 05 manual measurements and deterministic Data

Verified locally on 2026-10-25 from clean, refreshed `origin/main` at `f4939df`, branch `feat/pr05-manual-data`. M1 acceptance and its merged remediation were checked before implementation. This is execution-plan PR 05, not the GitHub remediation PR #5. All users, records and screenshots are synthetic. Hosted/provider requests and spend: **0 / $0**.

## Delivered boundary

- Manual entry with explicit source, metric, unit, date/time, timezone, granularity, method, review and confirmation. Eight supported metrics share one normalizer; exact decimal conversion precedes DTO serialization and separate display rounding.
- Authenticated `/api/data` reads and manual mutation, user-scoped reads/RLS, transactional source creation and idempotent acknowledgements, exact numeric text transport, revision-consistent analytical assembly, and validated pagination.
- Source/method-bound daily medians and seven-day comparisons, observed heart-rate distributions, uncombined daily/session totals, latest reading, gaps, coverage and owned references. The Data screen includes a lazy chart, table, error/empty/loading/stale states, account-switch cleanup and keyboard confirmation focus.
- Pure directional/range goal calculations only. No goal activation, CSV parser/import, correction, deletion, export, provider transport, or hosted deployment.

## Checkpoints and observed verification

| Command or proof | Observed result |
|---|---|
| `npm test -- tests/unit/measurements.test.ts` | Final focused core: 29 passed; fixture oracle, all eight metrics, normalization parity, exact representation boundaries, DST, daily medians, declared daily dates, sparse data and goal formulas. |
| `npm test` | 238 tests passed across 14 files, including display formatting and existing architecture/auth/encryption/provider regressions. |
| `npm run test:integration` | 74 real local Auth/HTTP/PostgREST tests passed. Includes exact fixture results, source isolation, direct RPC validation, idempotency, conflicts, cursor/revision guards and a real mutation between analytical read snapshots. |
| `npm run db:reset:test` | Clean replay of all six migrations passed during development. |
| Guarded reset to `20261025000100`, seed synthetic graph, then `runSupabase(['migration','up','--local'])` | Forward upgrade passed; deep comparison confirmed the complete existing measurement row was unchanged, and the new authenticated read RPC returned 200. Fixture accounts/records were removed in `finally`. |
| `npm run test:db` | 421 pgTAP assertions passed, including new RPC grants, empty mutation search path, invoker reads and existing isolation constraints. |
| `npm run db:lint` / `npm run db:types:check` | No schema errors; generated types match the database. |
| `npm run test:e2e` | 51 built-preview Chromium tests passed. Real persistence, reload, no model requests, source text escaping, unusual valid values, account switch, connectivity failure, keyboard focus and chart-load failure were exercised. |
| `npm run test:dev` | Four real `dev:full` scenarios passed: settings persistence, manual entry/reload, keyboard confirmation, and chart-load failure preserving the table. |
| `npm run test:bundle` | Production build and three strict TypeScript checks passed. Seven public files passed the secret-canary, source-map, catalog and harness checks. |
| `npm run test:providers` | Synthetic adapter checks passed; actual provider requests 0, spend 0; generation unavailable and optional decision scoring disabled. |
| `npm run lint` | Passed with zero warnings. |
| `python docs/spec/v0.1.0/scripts/validate_spec_package.py` | 471 specification and fixture checks passed. |
| `git diff --check` / `npm ls --depth=0` | No whitespace errors; direct dependencies resolve without invalid peers. |

The initial standalone typecheck also passed after correcting the Decimal named import. On this host, the managed Windows sandbox rejects Vite process spawning with `EPERM`; the same approved local commands were run with elevation, without weakening any check or changing host settings.

The real HTTP fixture exercise returned this inspected synthetic result:

```json
{"observations":28,"current":69,"previous":69.7,"change":-0.7,"foreignStatus":404}
```

The browser independently entered 70, 69 and 68 kg on three separate days, observed insufficient data before the third day, then displayed `69 kg`, survived reload, and refused to add a duplicate. Requests were restricted to the exact loopback application/Auth ports. API replies were no-store. Provider-role availability remained unavailable/disabled.

Populated Data screenshots were generated and inspected at 360×800, 390×844, 430×932, 768×1024 and 1440×900, light/dark and 200% text. The table scrolls within its labelled region on narrow screens. Local captures are ignored under `test-results/data-*/data.png` and `data-zoom.png`; no credential-bearing browser traces/video are retained. Actual phone keyboard behavior is not established by browser emulation.

## Retained failures and repairs

| Reproduced failure | Repair and observed protection |
|---|---|
| Exact fractional steps and a percentage just above 100 rounded to valid numeric DTO values. | Check exact decimal bounds/integrality before number conversion; both previously failing unit cases pass. SQL independently enforces stored representation constraints. |
| Direct RPC accepted some whitespace-only source labels. | Match JavaScript trimming before validating/storing source labels. Real RPC regressions for tab, BOM and nonbreaking space pass. |
| A declared daily total disappeared when its timestamp landed on the following UTC day. | Query, paginate and analyze daily totals by declared local date; pure and real HTTP regressions pass. No timestamp is relabelled as a sensor sample. |
| Different letter case in the same UUID retry key created another source/reading. | Normalize the UUID key and hash the operation payload independently of its key spelling. The failing real persistence regression now returns the original acknowledgement. |
| An uppercase spelling of the same source UUID produced an empty analytical result. | Normalize Data source identifiers at schema validation. Real HTTP regression returns the same 69 kg summary for either spelling. |
| Keyboard confirmation did not move focus to the new action. | Focus confirmation on review and return to the value field after editing/save. The failing browser case passes. |
| Aborted lazy-chart load removed the Data interface. | Local chart error boundary keeps entry and persisted table usable; failed and successful development proofs were retained. |
| Conflicting daily totals incorrectly counted as a valid day. | Derive daily-total coverage from unambiguous chart days; regression reports zero valid days and insufficient coverage. |
| New analysis metadata failed the existing strict typed trend-card contract. | Share optional base metadata while requiring it for Data results. `safeExtend` preserves existing refinements; both old reference results and actual new analytical results validate. |

No assertion was weakened to agree with these defects.

## Split-axis self-review

**Axis 1: specification fulfillment — Approved for PR 05.** Reviewed the actual tracked/untracked change, the canonical M2 requirements and the approved batch boundaries. Numerical fixture results are established through production analysis and real HTTP/persistence, with separate display tests. Manual confirmation, source/method selection, chart/table, insufficient-data handling and read-only goal formulas are implemented. The new route remains one of the nine specified entry points. PRs 06–07 and goal/AI mutations remain unavailable. This is not full M2 acceptance.

**Axis 2: engineering/security/test assurance — Approved with observations.** Reviewed mutation validation, owner derivation, profile locking, source-parent checks, receipts, grants/search paths, direct RPC access, exact decimal reads, revision assembly, cursor anchors, React identity epochs and bundle boundaries. Tests exercise real production paths; scheduling interception in the revision-race test still performs both database reads and the concurrent real mutation. Reproduced blockers above are repaired. No remaining demonstrated correctness/security blocker was found.

Advisory: the main production chunk is about 1.18 MB minified / 342 kB gzip, with a separate approximately 352 kB / 102 kB chart chunk. Vite retains its size warning; no measured performance acceptance claim or unrelated optimization was added. Current display uses canonical units, with original units in the table, and chart ranges are bounded to 366 complete local days. Health Connect parity is fixture-only. Hosted routing/auth/CSP, physical-device behavior and real providers remain unverified. The comprehensive independent M2 review is reserved for after PR 07; this report is host self-review.

**Approved deviations:** None beyond the implementation choices recorded in the decision log. No clinical plausibility thresholds were invented. PR 06 has not begun.

Final cleanup inspection returned zero Auth users, profiles, measurements, sources and audit receipts. `npm run db:stop` stopped the guarded disposable stack. Final built-browser captures remain ignored under `test-results/`. No hosted service or real record was used.

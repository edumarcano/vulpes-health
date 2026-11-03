# RENPHO CSV import verification

The `feat/renpho-import` packet was verified on `81ab6f7` and rebased onto the source-equivalent merged journal fixture repair `7dc702b`; the adapter diff is unchanged. It adds only the documented English 31-column RENPHO Health layout. Verification uses generated CSV rows, disposable local accounts and the existing local Supabase stack. Hosted resources, private exports, provider requests and spend: **none / $0**. No database reset was performed.

## Delivered behavior

The additive `renpho` mapping requires a single-profile declaration and explicit IANA timezone confirmation. Named headers resolve independent of order, with exactly one empty terminal header; any nonempty terminal cell rejects the whole file. Only weight (`lb`, device reported) and body fat percentage (`%`, device estimate) become instant observations through the existing exact normalizer. DST gaps/overlaps and invalid dates are excluded explicitly.

The existing CSV source, encrypted staging, preview, stale/expiry guards and transactional commit remain in use. Original file bytes, including a UTF-8 BOM, determine the RENPHO file hash. Row/column provenance remains `adapter: csv`; `No.` never becomes an external record ID. Other named cells are ignored and never staged. Canonical/wide mappings and their existing BOM file identities remain unchanged.

## Observed checks

| Command | Result |
|---|---|
| `npm test -- tests/unit/csv.test.ts tests/unit/renpho-csv.test.ts` | 34 passed: exact decimals, offsets/methods/provenance, named-header reordering, profile/timezone requirements, malformed/DST/boundary inputs, blanks, terminal cells and byte/record/row/observation limits. |
| `npm run test:integration -- tests/integration/imports.test.ts` | All 15 real HTTP/Auth/encrypted staging/PostgreSQL cases passed. |
| `npm run test:integration -- tests/integration/imports.test.ts --testNamePattern RENPHO --disableConsoleIntercept` | The RENPHO case passed again to expose its bounded HTTP artifact below; 14 unrelated cases were skipped by this explicit filter. |
| `npm exec -- tsx tmp/verify-renpho-browser.ts` | All 23 built-browser import cases passed, including RENPHO confirmations, exact uploaded BOM file hash, no preview writes, reviewed commit and nonempty terminal-cell rejection; existing canonical/wide lifecycle and responsive regressions passed. |
| `npm run typecheck`, `npm run lint`, `npm run build` | Passed. Build retains its existing large-chunk advisory. |
| `node node_modules/prettier/bin/prettier.cjs --check shared/imports.ts server/services/csv.ts src/features/data/import-form.tsx tests/unit/renpho-csv.test.ts tests/integration/imports.test.ts tests/e2e/imports.spec.ts` | Passed, as did `git diff --check`. |
| `npm run test:spec` | All 539 passed after restoring exact Git-blob bytes for an untouched brand README affected by checkout CRLF. That asset has no diff. |
| `npm test` | 509 passed; one existing provider-smoke CLI denial test exceeded its five-second timeout. No expectations or timeouts were changed. |
| `npm test -- tests/unit/provider-smoke.test.ts` | Isolated rerun passed all 18 cases. |

```json
{"artifact":"renpho_csv_http","synthetic":true,"previewNew":2,"crossFormatDuplicate":2,"changedConflict":1,"totalStored":4,"fileHashVerified":true,"adapter":"csv"}
```

This artifact comes from the actual local `/api/data` preview/commit interface: an earlier canonical import shares the selected source and normalized timezone/method metadata. The RENPHO file yields two duplicates and two new readings; changing one weight yields one conflict and no extra insert. The test reads and decrypts owned staging to verify original file hashing and column provenance, confirms ignored cell contents are absent, and rejects a nonempty terminal cell before writes.

The focused browser run used a temporary local runner composed from the existing guarded harness: two disposable users, sanitized local environment, a build using local Auth configuration, the existing synthetic test API and final account cleanup. The maintained reproduction entry point is `npm run test:e2e`, which includes these import cases. The RENPHO preview screenshot in ignored `test-results/imports-RENPHO-*/renpho-preview.png` was visually inspected: four readings, original row/metric labels, exact normalized values and UTC instants, ignored named columns and explicit confirmation were visible.

## Split-axis review

| Axis | Finding and evidence boundary |
|---|---|
| 1: Specification fulfillment | No blocking or advisory finding in the full implementation/test/documentation diff. The exact supported layout, two metrics, explicit profile/timezone, CSV provenance, original hashes, same-source duplicate/conflict rules and existing guarded commit path are covered. |
| 2: Standards and anti-slop | No blocking or advisory finding. The change extends existing schemas and normalization without dependencies, migrations, provider imports, private data or new persistence paths. Tests assert production parser/API behavior and actual stored counts/hash/provenance. |

Verdict: approved within this local synthetic verification scope. Other RENPHO languages, units or layouts, private-file/device compatibility, hosted deployment, independent review and formal release acceptance remain unverified. Physical mobile/screen-reader behavior is not established by browser emulation. No model, goal activation, account operation or merge is included.

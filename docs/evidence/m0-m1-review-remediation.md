# M0/M1 independent-review remediation

Verified locally on 2026-10-25 from `main` at `fc9e620`, branch `fix/m0-m1-review-findings`. The connected GitHub repository confirmed the same `main` revision. Scope: the three findings from the independent review of `0236a33..fc9e620`. Original merged migrations and commits are preserved. All accounts and payloads are synthetic; provider/cloud spend is **$0**.

## Reproduction and repair

| Finding | Failure before repair | Repair and protection |
|---|---|---|
| Direct settings RPC accepts a tab-only display name | New real-Supabase regression expected HTTP 400 but received 200. The independent review had demonstrated that the stored tab then makes the settings GET return 500. | Forward migration `20261025000100_settings_display_name.sql` uses the ECMAScript trim character set for both validation and storage. Invalid direct RPC inputs must return `invalid_settings`, leave the update token and complete settings unchanged, and preserve the other user's settings. |
| Account-switch test observes login before logout finishes | Unchanged full browser suite: 34 passed, one failure at the raw session-storage assertion. Console output was filtered during reproduction to avoid printing that assertion's credentials. | Hold the real logout request behind a barrier, verify sign-in is disabled while pending, release it, then await enabled sign-in and empty session storage. Both logout storage assertions now return only booleans from the browser; failure diagnostics cannot receive the stored session. Existing account B, reload, draft, and consent assertions remain. |
| Gzip-expansion test passes on authentication failure | Strengthening the assertion to require `ERR_BUFFER_TOO_LARGE` failed with `Unsupported state or unable to authenticate data`. | Canonicalize expiry in fixture AAD. Verify exact original-byte recovery at 4 MiB and the specific decompression error at 4 MiB plus one byte. Retain oversized-input, tamper, nonce, and rotation checks. |

The installed Zod version counts Unicode code points. PostgreSQL `char_length` already matches that limit; no UTF-16 restriction or response-schema change was retained. Integration cases cover every trim character in a padded valid name, whitespace-only inputs, wrong JSON types, null, zero-width non-trim characters, and valid/invalid ASCII and emoji length boundaries.

## Verification actually run

| Command/check | Final result |
|---|---|
| `npm run db:start` | Started only the guarded disposable synthetic stack. |
| Guarded `runSupabase(['migration','up','--local'])` | Applied the new function replacement over the original four migrations during development. |
| `npm run db:reset:test` | Verified empty users/profiles, then cleanly replayed all five migrations with the final validation. |
| `npm test -- tests/unit/encryption.test.ts` | All seven encryption tests passed. |
| `npm test` | 208 tests passed across 12 files. |
| `npm run test:integration` | 65 real Auth/API/PostgREST/payload tests passed, including both new display-name regressions. |
| `npm run test:db` | 413 pgTAP assertions passed; grants, RLS, ownership, and constraints remain protected. |
| `npm run db:lint` | No schema errors. |
| `npm run db:types:check` | Generated types match; no type contract changed. |
| `npm run test:e2e` | All 35 built-preview browser tests passed, including the pending-logout barrier. |
| `npm run lint` | Passed with zero warnings. |
| `npm run test:bundle` | Production build and all three strict TypeScript checks passed; six public files passed the secret-canary/source-map/catalog scan. |
| `python docs/spec/v0.1.0/scripts/validate_spec_package.py` | 471 specification and fixture checks passed after documentation updates. |

Standalone real HTTP/RPC artifact, using one temporary account and cleanup in `finally`:

```json
{"syntheticOnly":true,"invalidDirectRpcStatus":400,"error":"invalid_settings","settingsGetStatus":200,"settingsUnchanged":true}
```

Failures retained: an initial unit run timed out loading the existing ESLint boundary checks while lint ran concurrently; the unchanged suite passed without that contention. A deep equality assertion over a 4 MiB buffer exceeded the test timeout; native `Buffer.equals` retains exact byte comparison and passes without increasing timeouts. An initial UTF-16 assumption was rejected by the installed Zod implementation and executable schema checks before final validation. No expectations were weakened to match a defect.

## Focused split-axis self-review

**Axis 1: specification fulfillment — Approved.** The direct-RPC writer now agrees with the existing display-name contract. Invalid writes preserve readable owned settings and the foreign account. The browser test waits for completed logout, retains its account-switch assertions, and keeps credentials inside the browser. The expansion assertion reaches the intended limit. No product, model, or feature scope was added.

**Axis 2: engineering/security/test assurance — Approved.** The function replacement retains the empty search path, authenticated-only grant, `auth.uid()` ownership, profile lock, version check, idempotency receipt, consent restrictions, and account-state guard. Tests exercise the real local HTTP and database boundaries. The browser barrier uses observable state rather than sleeps; cleanup releases it on failure. The crypto fixture proves successful authentication and the exact expansion error independently. No new dependency, secret, or production encryption behavior was introduced.

This is host self-review of the remediation diff, not a second independent-agent certification. The three original findings are resolved locally. The remediation at `a090fc7` and M1 were accepted in chat on 2026-10-25 after the repaired tests and focused review passed. M1 is **Fully accepted**; [remediation PR #5](https://github.com/edumarcano/vulpes-health/pull/5) awaits merge. Execution-plan PR 05 remains proposed and must include the accepted remediation in its implementation base. Hosted authentication/routing/CSP, live providers and pricing, family operations, and real data remain separate unverified gates. The existing production chunk-size advisory remains unchanged.

Cleanup inspection returned `auth_users=0`, `profiles=0`, `payloads=0`, and `usage_buckets=0`. `npm run db:stop` stopped the test stack. Generated builds and browser artifacts remain ignored; no credential-bearing artifact is included in the remediation diff.

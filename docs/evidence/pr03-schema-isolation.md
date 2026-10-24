# PR 03 schema and isolation evidence

Verified locally on 2026-10-24 from merged PR 02 at `c36d0ab`, branch `feat/pr03-schema-isolation`. The owner requested the approved PR 03 implementation and PR publication, then installed Docker Desktop for local verification. PR 02's merged GitHub record matches the base. Milestone 0's build, routing, secret protection and offline-provider gates remain verified; Milestone 1 is incomplete until PR 04.

## Delivered boundary

Two migrations create all 15 specified tables, numeric storage, explicit lifecycle fields, indexes, composite owner-parent keys, active-run/send/step uniqueness and budget scope/period references. Each schema transaction fails closed with RLS and revoked client grants; the access migration permits 11 owned read surfaces and denies every direct client mutation. Private payloads, accounting tables and audit events have no client reads. Service-role revision rewrites are denied.

Local scripts use the pinned development-only CLI, reject remote/linked targets and connection overrides, and keep administrative status output out of logs. Generated server database types come from the actual migrated schema. SQL tests include an independent inventory of 21 required composite relationships so removing a constraint cannot silently remove its test.

No application endpoint or public DTO changed. There is no application login, provider call, business RPC, import/approval/accounting workflow, storage bucket or encryption implementation. Synthetic envelope bytes are not encryption proof.

## Commands and observed results

| Command/check | Observed result |
|---|---|
| `npm ci --no-fund --no-audit --offline=false --cache .cache/npm --fetch-retries=0 --fetch-timeout=15000` | Clean lockfile install succeeded: 321 packages. npm warned that the existing esbuild postinstall is not allowlisted; subsequent real builds/tests succeeded without changing script approval. |
| `npm run db:start` | Started only the local synthetic project. Final API endpoint: `http://127.0.0.1:54321`. No hosted project or cloud credentials. |
| `npm run db:reset:test` | Recreated the dedicated disposable database and applied both migrations successfully, including after constraint/grant repairs. |
| `npm run db:reset:test -- --db-url https://example.test` | Expected exit 1 before contacting Docker/database: connection overrides and extra arguments are rejected. |
| `npm run test:db` | 403 pgTAP assertions passed on the corrected clean schema. Covers ownership, RLS execution for A/B, grants, decimal column types, 21 parent relationships, invalid representation, identity uniqueness, payload cleanup and future-object defaults. |
| `npm run test:integration` | 50 real Auth/PostgREST tests passed repeatedly, including twice on the final corrected schema. Real password sessions, disabled signup, foreign lists/IDs/counts/joins, anonymous/invalid-token denial, all direct mutation/upsert denials, protected stores, immutable revisions and simultaneous run inserts. |
| `npm run db:types`, `npm run db:types:check` | Generated from real local PostgreSQL; drift check passed again after database reset. Only line endings/trailing whitespace are normalized. |
| `npm run db:lint` | No schema errors. |
| `npm run lint`, `npm run typecheck` | Passed; strict checks also ran in both production builds. |
| `npm test` | 183 tests passed across nine files. |
| `npm run build` | Production client and executable Node output built. Existing chunk-size advisory remains. |
| `npm run test:bundle` | Six public files inspected; no secret canaries, source maps, server catalog or synthetic harness markers. |
| `npm run test:e2e` | All 17 built-preview browser checks passed across the required viewport/theme matrix and routing/security cases. |
| `npm run test:providers` | Four synthetic roles passed; actual provider requests `0`, inference spend `"0"`; all live smokes `not_run`. |
| `npm audit --json --offline=false --cache .cache/npm --fetch-retries=0 --fetch-timeout=15000` | Zero advisories. |
| `python docs/spec/v0.1.0/scripts/validate_spec_package.py` | 467 checks passed after documentation updates. |

The SQL checks run against PostgreSQL 17 using the CLI's `17.11.0.006` image, Auth `v2.197.0`, PostgREST `v16.5` and Docker Engine `29.9.2`. Node `24.15.0`, npm `11.18.0`, Supabase CLI `2.122.0`. Windows native process/Git/cache access required approved execution outside the managed sandbox; checks were not weakened.

## Actual HTTP artifact

A standalone terminal demonstration used the real local Auth admin API to create two temporary synthetic users, signed both in with passwords, and exercised PostgREST using A's access token. Output contained only these safe fields:

```json
{
  "syntheticOnly": true,
  "own": {"status": 200, "body": [{"metric_key": "weight", "canonical_value": 70, "canonical_unit": "kg"}]},
  "foreign": {"status": 200, "body": []},
  "goalMutation": {"status": 403, "code": "42501"},
  "privatePayload": {"status": 403, "code": "42501"}
}
```

Cleanup ran in `finally`. Subsequent database queries confirmed zero synthetic Auth users, profiles and household buckets. Repeated integration runs also clean up their data and do not reset or stop someone else's stack. pgTAP fixtures roll back.

## Failures and repairs retained

| Evidence | Classification and resolution |
|---|---|
| Initial Git/cache/native process restrictions | Host limits; retried the named operations with approved execution access. No security/test bypass in product code. |
| Docker/WSL initially absent; integration setup could not reach a stack | Blocked check at that time, never a pass. The owner installed Docker Desktop; real database tests subsequently ran. |
| SQL fixture `UNION ALL` inferred text for a JSONB payload | Test defect; added explicit JSONB casts. |
| Three missing-version JSON updates and a negative weight goal succeeded | Demonstrated schema defects; regression tests failed first. JSON containment now requires the numeric schema version, and target checks enforce hard metric representation. Clean reset and tests pass. |
| Two generic parent tests hit proposal-shape/uniqueness constraints first | Test targeting defect; constrain each attempt to one existing child with a nonnull reference, then require the actual foreign-key error `23503`. |
| Provisioned-user login returned HTTP 422, `email_provider_disabled` | CLI configuration mapping; keep the email provider enabled and public registration globally disabled. Real login and denied signup now pass together. |
| Future functions retained effective execution for all API roles | Demonstrated PostgreSQL default-grant defect. Added the global migration-role `PUBLIC EXECUTE` revoke; all three regression assertions pass after a clean reset. |
| One initial unit run timed out during first ESLint configuration load while the runtime was starting | Retried after clean install/startup without changing tests or timeouts; all 183 passed. |
| Stronger signup assertion initially inspected Auth's numeric `code` before semantic `error_code` | Test defect; assert `error_code=signup_disabled`, not merely any error. All 50 integration tests pass. |
| Supabase's Docker ports were reachable through non-loopback host addresses | Host limitation for this synthetic-only harness. The documented custom bridge binding option was tried and verified ineffective on this Docker Desktop installation, then removed. No global network/firewall settings changed. The stack is stopped after verification; this is not proof of host-network isolation or permission for real-data use. |

## Review and acceptance limits

Remora review covers the actual PR diff in two passes: specification fulfillment, then engineering/security/test assurance. The reproduced schema/default-grant findings above were repaired and their failure cases rerun. Duplicate-send uniqueness is tested with a terminal attempted insert so the separate active-run index cannot mask a missing request-identity constraint. The final review verdict is recorded with the PR progress entry.

**Axis 1, specification fulfillment: Approved.** All 15 specified tables and the approved storage/relationship seams are present; real migration, RLS, direct API and concurrent-index proof passed. No application auth, feature RPC, inference, deployment or real-data scope was introduced. Required encryption/account-switch/business-transaction gates remain explicitly owned by later PRs.

**Axis 2, engineering/security/test assurance: Approved with observations.** Grants fail closed, owned read policies execute as A/B, relational failures are exercised independently of RLS, future-function execution defaults are tested, credentials are excluded from logs/client output, and the only new direct dependency is development tooling. The Docker Desktop host-network exposure described above is an operational limitation of this synthetic-only harness, not a claim of host isolation. The stack and the ineffective temporary network were stopped/removed after verification. No demonstrated in-scope blocker remains; these are self-review passes, not independent-agent approval.

SEC-01–03 are verified at the direct database boundary. Existing SEC-04 and MOD-05 regressions pass, and isolation works with AI disabled under MOD-06. These are partial release-matrix contributions: application authentication, provider-consent enforcement, account switching, encryption/expiry reads, business transactions and complete M1 acceptance belong to later PRs. No deployment, hosted auth, live-provider or family-pilot evidence is claimed.

Actual provider/infrastructure spend: **$0**. External access was limited to approved development dependencies/container images, public advisory metadata and GitHub operations. No live cloud resources, personal data or real inference were used.

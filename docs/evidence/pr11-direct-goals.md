# PR 11: direct goals, approvals and progress

Verified 2026-10-28 on `feat/pr11-direct-goals`, based on `main` / `origin/main` at `f35b249c2d4b2d3b221570b4082bf9f9bbfe3852` (merged GitHub #15). This is execution-plan PR 11 only. PR 12, formal M4 acceptance, deployment and production inference remain separate. Actual provider requests and spend: **0 / $0**.

## Delivered behavior

Direct Goals provides create/revision/state proposals, complete explicit review, approval/rejection, frozen baselines, revision history, source/method-qualified current values, charts/tables and pagination. Targets are requested values without medical validation. No model is needed or enabled. Existing M3 read tools recognize version-2 goal progress while preserving version-1 evidence handling.

Server-built JSONB payloads bind definition, baseline, state and reviewed data revision. PostgreSQL computes the hash and consumes approval in the same profile-serialized transaction as the immutable revision and goal update. Safe receipts bind UUID request keys and canonical input; terminal replay never writes another revision. Concurrent versions conflict. Client table writes and direct transaction calls remain denied.

Seven-day baseline calculation reuses the existing daily-median algorithm and retains its exact decimal result before DTO conversion. Latest-value tracking preserves source/method/granularity; user-reported baselines require provenance and an explicit current method. Imports cannot activate needs_data goals. Correction retains frozen history with review markers; a reviewed revision can retain or replace the baseline. Archive is terminal; paused/completed goals can reopen explicitly.

Pending proposals expire after 24 hours. Rejected, conflicted and expired bodies are removed, with safe replay metadata retained. Data-revision changes invalidate pending bodies atomically; direct owned reads enforce expiry. Existing encrypted AI trace retention remains seven days. Approved revisions remain product history.

## Executed checkpoints

Database and browser checks ran in an ignored disposable verification copy using `vulpes-health-pr11-test` at loopback ports 25321/25322. The original stack contained one retained M3 verification account/allocation and was never reset. Copied harness project/port constants and the verification transport's exact loopback-port guard were specialized to the isolated stack; the branch's production guard remains unchanged. Installed dependencies were reused. No hosted database or provider transport was used.

| Check actually executed | Observed result |
|---|---|
| `npm run lint`, `npm run typecheck` | Passed |
| `npm test -- --maxWorkers=1` | 314 passed |
| `npm run build`, `npm run test:bundle` | Passed; nine public files scanned without server secrets/catalog/harness output |
| `npm run db:lint`, `npm run db:types:check` | Passed against the isolated migrated schema |
| `npm run test:db` | 642 pgTAP assertions passed, including new RPC privilege tests |
| `npm run test:integration` | Complete isolated run: 167 passed before final scoped refinements |
| `npm run test:integration -- tests/integration/goals.test.ts` | Final focused run: eight passed, including terminal/case-equivalent replay, competing revisions, exact frozen baseline review and rollback after revision insertion |
| `npm run test:goal-upgrade -- --allow-disposable-reset` | Populated pre-M4 forward upgrade preserved all owned table snapshots; migration files restored; refuses populated retained databases |
| `npm run test:e2e` | Complete built regression: 102 passed, including all specified viewport/theme combinations |
| Focused built Goals browser run | Passed after final UI refinements; blank targets rejected, explicit approval creates goal, detail/history and reload persist, zero chat sends |
| Focused `npm run test:dev` Goals browser run | Passed through Vite and the real API; zero chat sends |
| `npm run maintenance:cleanup` | Passed on isolated stack; bounded one-pass no-op with zero outstanding work |

The full suite and final focused reruns are distinguished above: they are not a claim that every complete suite was repeated after every final refinement. The specification validator passed 493 checks after the documentation updates.

The browser exercised the production handlers and real Supabase Auth/PostgreSQL. It verified the absence of an active goal before approval, then observed the active goal, revision history and persisted reload. Explicit synthetic screenshots were inspected locally. Browser network restrictions allowed only the application and exact local Auth/API ports. The existing default development selection now includes the direct Goals journey.

## Retained failures and corrections

- Windows denied sandbox Git/process/file operations; scoped approved execution succeeded. Port 55322 was unavailable; the isolated stack used 25321/25322.
- An early overlap between database assertions and integration fixtures caused shared app-bucket conflicts. Verification was serialized and only the PR 11 stack was reset; the later database gate passed all 642 assertions.
- The first broad isolated integration attempt hit the verification transport's exact original-port guard. Only the verification copy's constant was specialized; eight synthetic smoke cases then passed, followed by the complete 167-case integration run. Production transport policy was not widened.
- The initial upgrade verifier ordered profiles by a nonexistent id column. It was corrected to use user_id; the populated upgrade subsequently passed. A failed predecessor-schema attempt was not counted as migration acceptance.
- Browser select-label lookup failures were corrected using explicit accessible select names. The final blank-target case passed without increasing timeouts or weakening assertions.
- Review identified rounded baseline capture, receipt lookup ordering, missing terminal replay-key receipts, pending-body invalidation, blank-to-zero form coercion and progress/version races. These paths were corrected and the relevant final tests passed. The rollback test temporarily installs a disposable constraint that fails the final goal update; it proves neither the new goal nor revision survives and always removes the constraint.

## Split-axis self-review

**Surface:** tracked and untracked PR 11 files against `f35b249`, including API handlers, domain schemas, SQL functions/triggers/policies, existing callers, UI, tests, maintenance, upgrade proof and documentation.

**Axis 1 (specification fulfillment): Approved for PR 11.** The direct flow operates without AI; exact approval/replay, conflicts, frozen calculations, review resolution and lifecycle behavior follow the approved batch choices. The real HTTP/database tests establish owner denial, one winning revision and transactional rollback. Pure numerical regressions cover insufficient data, range states, zero denominator, regression and overshoot. The built and development artifacts establish the direct user flow. Chat tools/cards and complete M4 acceptance remain PR 12.

**Axis 2 (engineering/security/anti-slop): Approved for PR 11.** No provider SDK, framework, queue, ORM or dependency was added. One shared domain service coordinates narrow server-only transactions with pinned search paths and existing owner-parent constraints. Direct writes/privileged RPCs remain denied to clients; approved history stays immutable. Scope, input binding, identity epochs, sensitive-body lifecycle and actual interface proof were inspected independently of the fulfillment pass. No demonstrated blocker remains in the reviewed scope.

This was host-agent self-review, not a separate reviewer. It does not establish clinical target safety, physical-device behavior, hosted routing, production inference readiness or broad real-model behavior. Large-series performance was not benchmarked. Existing build chunk-size warnings remain non-blocking observations. No automatic merge, provider activation or PR 12 work is included.

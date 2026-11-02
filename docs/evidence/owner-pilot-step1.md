# Owner-pilot Step 1: disabled Luna execution path

Base: `50936f2e190be36398951f9a8227cdf19b367d32`. Normal chat composes the existing Luna adapter and execution ledger through a separately issued production transport. No production approval is installed, its run ceiling remains zero, and the example live switch stays false. Flash/Argon activation and decision scoring remain deferred.

## Verification environment

Verification uses `.scratch/owner-pilot-verification`, project `vulpes-health-owner-pilot-test`, database/API ports 29422/29421, application API 29101, development 29173 and built preview 29174. All 255 executable/test/configuration files match the candidate after the fixed project/port substitutions and line-ending normalization. The source byte inventory SHA-256 is `f9198eef830b32cd1484a6b370784178b8ca2329b883e10dfae75c76e62f2d25`. Existing default and retained verification databases are not reset or stopped. Real HTTP, Auth, PostgreSQL, encrypted inspection and browser paths are used; external provider responses are synthetic.

## Observed checks

| Command | Result |
|---|---|
| `npm run lint`, `npm run typecheck`, `npm run build` | Passed; existing large-client-chunk warning remains |
| `npm test` in the isolated copy | 340 passed |
| `npm run test:db` | 734 passed |
| `npm run test:integration` | 222 passed across 14 files in ordinary worker mode |
| `npm run db:lint`, `npm run db:types:check` | Passed; types generated from the migrated isolated database |
| `npm run test:lifecycle-upgrade -- --allow-disposable-reset` | Passed populated two-owner preservation and deleting-owner denial; bounded maintenance completed |
| `npm run test:bundle` | Passed all 15 public files with synthetic secret canaries |
| `python docs/spec/v0.1.0/scripts/validate_spec_package.py` | 504 checks passed |
| `npm run test:providers -- --mode=synthetic` | Four fixture rows passed; real model assessments remain not run |
| `npm run test:e2e` | 121 passed, zero failed/flaky/skipped, recovered from the completed HTML report after chat interruption |
| `npm run test:pwa` | One static-cache/offline privacy check passed |
| `npm run test:dev` | First completed attempt: 17 passed, 21 failed after local web-server loss; unchanged ordinary rerun: all 38 passed with retries=0 and unchanged assertions/timeouts |

The new HTTP proof exercises production composition with synthetic readiness and a bounded synthetic run ceiling, intercepting only the fixed provider endpoint. It observes completed SSE, owned ledger steps, byte-identical decrypted input, saved-message reload and duplicate-send replay without another dispatch. Separate tests exercise the real readiness predicate with synthetic current evidence and reject changed privacy hashes, absent approval and fabricated transports. This composition of assertions does not claim a live-provider result.

The operator budget RPC test proves matching repeats preserve nonzero spending/reservations, missing account allocations are created, changed ceilings are rejected, and authenticated clients receive 403. Settings tests exercise current v2 acceptance/revocation and reject v1 through HTTP and direct RPC. The populated upgrade preserves existing records rather than silently upgrading stored consent.

## Retained failures and execution limits

The first root unit invocation passed 335 cases and failed one setup because port 3001 was occupied. The existing listener was preserved; all 340 cases passed in the dedicated port-specialized copy. An initial positive readiness test caught strict smoke parsing rejecting the extended approval record; explicit projection through the existing smoke schema fixed it. An initial isolated startup failed; inspection found duplicate migration timestamps. Both new migrations now follow all merged migrations, and the isolated stack subsequently started. Original outcomes are not represented as passes. After chat interruption, the completed built-browser HTML report confirmed 121 expected tests, zero unexpected/flaky/skipped and `ok: true`. Docker Desktop was stopped at resumption; the first development command could not initialize local Supabase. The installed runtime was restarted without changing infrastructure configuration. The subsequent complete development attempt passed 17 tests, timed out in a chat-goal case and then lost the local web server; 21 failed, including connection-refused cases. Its private report is retained under `.scratch/owner-pilot-development-failed.html` (SHA-256 `e30a25fe4a06a3a46c3bfde2456173762f5105765d12217d78c74ef9d70634ee`). Exact server-termination cause is unproven. No assertion, timeout or retry policy was weakened.

Automatic approval review rejected the CLI `--mode=live --role=everyday` opt-in guard probe because that execution path could access credentials or incur spend. It was not retried. Offline guard tests ran; the CLI probe remains unexecuted. No external provider call is inferred from its expected denial. Reading a private failure artifact exposed one temporary synthetic bearer in tool output. Runner cleanup removed all test Auth identities; an authoritative local SQL count returned zero before rerunning. Raw reports remain ignored and unpublished.

## Review and remaining gates

The host reviewed all staged, unstaged and new files against base `50936f2`, including actual contracts and callers. **Axis 1: Approved for Step 1**, with normal production composition and availability demonstrated synthetically, explicit consent renewal and preserved budgets. **Axis 2: Approved with observations**, with issued-transport checks, fixed endpoint/no retries, ledger capture/authorization and secret isolation retained. The unexplained local development-server loss and private-artifact token exposure are recorded above; the unchanged complete development rerun passed and temporary Auth identities were removed. No demonstrated in-scope blocking defect remains. This is a self-review, not independent release acceptance. The React review covers unchanged hook ordering, escaped text, existing tenant-bound queries, unchanged focus controls and no new data-fetch waterfall.

Two forward migrations are required. The revised notice prepares OpenRouter's announced screening/flagged-content retention exception; verify effective terms and obtain explicit owner acceptance before installing activation evidence. Production smoke/evaluation IDs, policy/version/hash, rates and template must match. No current live evidence, hosted migration/deployment, infrastructure action, real data or model activation occurred. Actual provider requests/spend: **0 / $0**.

Next: review this PR without automatic merge, then prepare Step 2's fixed live synthetic scenarios, current rates/privacy checks, exact ceiling and plain-English credential instructions. Paid execution still needs explicit owner approval.

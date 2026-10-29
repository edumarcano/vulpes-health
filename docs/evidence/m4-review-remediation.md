# M4 independent-review remediation

Date: 2026-10-29. Base: merged PR 12 at `9463b2e`.
Scope: F1 daily-total current values, F2 chat synchronization after approval,
regression protection, and execution-ledger merge status. Original PR 11/12
evidence remains unchanged. Formal M4 acceptance is a separate decision.

## Reproduction and changes

| Finding | Before repair | Repair and observed result |
| --- | --- | --- |
| F1 | Nine real HTTP/PostgreSQL cases returned yesterday's 6,000 steps instead of today's 8,000. Baseline 4,000 and target 10,000 therefore produced 33.33% instead of 66.67%. | Daily totals use the next local midnight as the exclusive date bound. The service captures one current instant and preserves that instant as the upper bound for timestamped readings. All nine date cases pass, plus a timestamped-reading guard excluding a later reading on the same local day. |
| F2 | The new built-browser test failed because the 50% card remained after approving target 67 from baseline 70/current 69. | Proposal decisions invalidate the current account/epoch's conversation queries as well as Goals queries. The browser removes the obsolete calculation without reload or another inference request; the current API result is 33.333333333333336%. |

F1 cases cover UTC midnight, UTC+14, UTC-10, both New York DST changes,
and the midnight after the spring transition. Tomorrow's daily total is excluded.
The direct Goals browser test displays current 8,000 and 66.67% with AI disabled.
The chat test uses the existing scripted transport at the provider boundary;
approval and conversation resolution use the production HTTP/database paths.

## Verification

Verification used synthetic accounts on a dedicated disposable local Supabase
stack and a temporary source copy. Only its project/container bindings differ
from repository configuration. No hosted database, live provider, deployment,
real health data, or external spend was used. Provider requests: 0; spend: $0.

| Command | Observed result |
| --- | --- |
| `npm run test:integration -- tests/integration/goals.test.ts` | 18 passed |
| `npm run test:integration` | 194 passed across 11 files, including M2/M3 and approval-security regressions |
| `npm run test:e2e` | 107 passed, including both new regressions, the complete chat/import/approval journey and M2/M3 regressions |
| `npm run test:e2e -- --goals-proof` | Final six affected built-browser journeys passed after the conversation-creation test barrier |
| `npm run test:dev -- --goals-proof` | Six affected Vite browser journeys passed after the conversation-creation test barrier |
| `npm test -- --maxWorkers=2` | 317 passed across 23 files |
| `npm run lint` | Passed |
| `npm run test:bundle` | Strict typecheck/build passed; nine public files passed secret/provider/harness isolation checks |
| `python docs/spec/v0.1.0/scripts/validate_spec_package.py` | 495 passed |
| `git diff --check` | Passed |

Retained failures and retries:

- The nine new F1 cases and new F2 browser assertion failed before their
  respective production repairs. Assertions were retained.
- Initially placing F1 cases before the existing initially-empty-goals test
  violated its setup assumption. Moving the added cases after existing cases
  restored that isolation; all 18 goal cases then passed.
- The first unit run timed out during ESLint initialization while builds ran
  concurrently. A bounded-worker rerun passed without assertion changes.
- Two focused browser runs encountered an existing chat timeout and encrypted
  payload expiry/503 failures. Local database logs showed `invalid_run_payload`
  and `invalid_expiry`; sampled host/database clocks showed no material offset.
  The cause is not established. The subsequent full integration run passed,
  and the full browser run passed those rejection/reload and account-switch
  cases without changing their assertions or payload/expiry implementations.
- The Vite check exposed a test-helper race: it could fill the prior thread's
  composer before creating the new conversation completed, then lose that text
  when the new thread mounted. The helper now waits for the creation response
  and matching conversation URL before checking the composer. All six Vite
  journeys pass with this barrier. The 107-test built run preceded this final
  helper synchronization; all six affected built journeys passed the final recheck.
- The existing build chunk-size warning remains non-blocking.

## Remora split-axis self-review

**Axis 1: specification fulfillment. Approved.** The HTTP assertions establish the path
from stored daily observations through `GoalService.progress` to exact current
value and numerical progress, including calendar boundaries. Browser assertions
establish the path from explicit approval through conversation refresh to removal
of stale evidence, with no extra inference. Baselines and seven-day semantics
remain unchanged. No in-scope blocking finding remains in the inspected diff.

**Axis 2: engineering/security/test assurance. Approved.** The fix preserves server approval
payload binding, transaction functions, ownership policies, replay/version checks,
and account-epoch guards. Calendar arithmetic uses the existing Temporal library,
without fixed 24-hour offsets or new abstractions. The existing full integration
suite protects tamper/foreign/expired/stale/replay handling and correction/import
behavior. No schema or public contract change is introduced. No in-scope blocking
finding remains in the inspected diff; this self-review is not independent review.

Live-provider behavior remains unverified under the existing activation gates.
This remediation does not grant formal milestone or release acceptance.

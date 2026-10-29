# PR 13: Vertex capabilities and bounded routing

Date: 2026-10-29. Base: `main` at `e941890`.
Authorization: approved M5 PR 13 implementation, synthetic verification, and an open PR. No merge, live inference, spending, deployment, real data, or PR 14 work.

## Delivered behavior

Luna starts chat. The UI sends Auto and exposes no model/depth/effort selector. Trusted backend composition can supply Flash for one evidence-backed handoff or a verification-only initial Vertex role. Argon is never a user-chat handoff target. Existing production composition remains unavailable until separate activation approval.

The Vertex REST adapter uses the documented [parametersJsonSchema field](https://docs.cloud.google.com/gemini-enterprise-agent-platform/reference/rest/Shared.Types/FunctionDeclaration) for JSON tool declarations, maps catalog thinking/output settings, validates fragmented streams and tool identity, retains signed opaque parts, and stops long-decode/output-limit finishes without another request. GoogleAuth is confined to the server authentication boundary. Vertex verification requires opt-in, complete rates, configuration-bound evidence, explicit project/location, approved policy, synthetic batch/attempt identity, consent, encryption and reservations before credential discovery.

New forward migrations introduce one operator-only Google policy row, bounded route history, the fenced handoff transaction and a safe authenticated notice read. No approval is seeded. Existing paired accounting, original-month settlement, cost blocks, private retention and proposal transactions remain in place.

## Artifact proof

The real HTTP/PostgreSQL handoff test imports the canonical synthetic CSV, obtains owned summaries, requests one Flash handoff, checks two route events and one durable transition, and compares decrypted Vertex request bytes with the transport input. Separate rejection assertions preserve the original route for unapproved/foreign handoffs. Browser proof verifies selector absence, conversation persistence, Settings and M4 approvals. The synthetic mobile Ask screenshot was inspected locally; the composer and navigation remain usable without a selector. Private payloads and screenshots stay outside committed evidence.

`npm run test:providers` emitted `actualProviderRequests: 0` and `inferenceSpendUSD: "0"`. All generation roles were unavailable; decision scoring was disabled. This normalized-protocol smoke is distinct from the real Vertex wire tests and from live model evidence.

## Observed checks

| Command | Result |
|---|---|
| `npm test -- --maxWorkers=2` | 328 passed |
| `npm run test:integration` | 196 passed across 11 files on the clean disposable stack |
| `npm run test:db` | 663 pgTAP assertions passed |
| `npm run test:e2e` | 107 built-browser checks passed |
| `npm run test:dev -- --goals-proof --diagnostic` | Six Vite/proxy browser journeys passed on alternate loopback ports |
| `npm run test:vertex-upgrade -- --allow-disposable-reset` | Final populated two-owner forward upgrade passed |
| `npm run test:executions` | Exact loopback capture, paired reservation race and pending/conservative/corrected costs passed; zero provider requests |
| `npm run test:evaluations` | 16 synthetic controls passed; every real-model assessment remained not_run |
| `npm run maintenance:cleanup` | Bounded empty cleanup pass succeeded |
| `npm run db:types:check`, `npm run db:lint` | Passed |
| `npm run lint`, `npm run typecheck`, `npm run test:bundle` | Passed; nine public files passed the secret/server/harness scan |
| `npm run test:providers` | All four synthetic normalized contracts passed; actual provider requests and spend were zero |
| Specification validator and `git diff --check` | Passed |

## Verification environment and retained failures

Verification uses the separately named `vulpes-health-pr13-test` local Supabase project and an ignored source copy. The built/integration copy specializes project/container bindings. The final development-browser check additionally uses alternate loopback ports because an existing service occupies 5173; application behavior and assertions are unchanged. Node modules are reused from the workspace. No hosted service is used.

The first migration was applied non-destructively to the default local stack before its retained verification allocation was identified. That stack was stopped without resetting or deleting its volumes. Its retained provider batch was not used for subsequent verification or replenished. The remaining migrations and all destructive test resets target only the separate PR13 stack.

Retained failures and resolutions:

- Initial branch creation and restricted processes required authorized sandbox escalation.
- The first integration setup encountered the default retained app allocation. The run was stopped; verification moved to the separate disposable project.
- A two-summary handoff reproduced `context_too_large`. Input ceilings and full evidence were retained; bounded tool-schema pruning now records its exclusion. An ordinary follow-up regression caused by redundant prompt text was repaired without changing assertions or limits.
- The first policy lookup regressed Settings without an admin credential. Reproduced HTTP 503 failures led to a narrow authenticated notice RPC; the affected settings tests passed afterward.
- The synthetic live-path fixture supplied a partial catalog record. It now overlays synthetic values on the actual catalog shape; all eight live-path tests still replace the external network and use synthetic credentials.
- pgTAP rejected an unregistered security-definer function. The reviewed allowlist and explicit RPC/table privilege assertions were updated; 663 assertions passed.
- An interrupted final integration attempt left synthetic setup rows. The disposable stack was reset; the two handoff tests then passed. Retained provider volumes were unaffected.
- Development-browser startup failed twice on occupied port 5173. Diagnostics identified the existing listener; it was preserved and the disposable harness uses alternate loopback ports.
- The production build retains the existing chunk-size warning.

## Review

Axis 1 (specification fulfillment): review covers the approved Luna-first policy, selector removal, Flash evidence gate, backend-only Argon, deferred decision engine, exact capture, historical readers, and unchanged goal approvals. Local tests cannot establish account access, model quality or provider capabilities.

Axis 2 (engineering/security/maintainability): review traced the actual adapter/dispatcher/ledger/SQL paths and their callers. Provider implementations are forbidden in domain/UI imports, endpoint construction is fixed, auth is server-only, and spending checks read decimal strings. The final reservation/send transaction remains authoritative if balances or consent change after the handoff precheck. Raw provider errors and credentials are not returned or logged.

Final self-review verdict: **Axis 1 approved for the local PR scope; Axis 2 approved.** No demonstrated local blocker remains. Both reviews were performed by the implementing agent. The final JSON Schema field adjustment passed ten wire tests, strict typechecking and two affected HTTP/database handoff checks. The stricter SQL null guards passed the final populated upgrade and all 663 database assertions.

## Unverified external gates

Google credentials, project access, quotas, supported location, accepted retention/caching/abuse-monitoring policy, complete prices, actual provider behavior and WIF deployment remain unverified. Vertex missing billing categories remain unknown and retain conservative holds; the live verifier cannot claim a pass while usage is pending. Production inference remains disabled. The changed v4 prompt does not refresh historical Everyday evidence.

After separate approval only, use the existing persistent batch and explicit attempt IDs:

```text
npm run test:providers -- --mode=live --role=intermediate --scenario=tool_loop --allow-spend --max-cost-usd=<approved-cap> --attempt-id=<UUID> --write-report
```

Advanced uses `--role=advanced` for backend verification only. Cancellation/disconnect consume the same allocation. Never reset or replenish a batch with uncertain costs. These commands currently fail closed on unverified configuration.

Inference requests: 0. Maximum authorized and actual inference spend: $0. PR 14 remains deferred. M5 live acceptance and merging remain separate.

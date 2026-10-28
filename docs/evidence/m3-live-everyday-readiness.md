# M3 Everyday live-verification readiness

Checked on 2026-10-27 against clean `main` at `dcfe7ebc2000b66110e30786e5d1ba436809e450`, including the merged M3 review remediation. This is preparation evidence, not a successful live smoke or M3 acceptance record. Actual inference requests: **0**. Actual inference spend: **$0**.

This preserves the preauthorization snapshot. The user subsequently authorized the proposed cap; [the execution report](m3-live-everyday.md) records the failed live attempt, actual charges and current blockers. Statements below about unconfigured evidence and pending authorization refer to the preparation checkpoint.

## Public provider evidence

Unauthenticated GETs to OpenRouter's [model catalog](https://openrouter.ai/api/v1/models), [selected model endpoints](https://openrouter.ai/api/v1/models/openai/gpt-6-luna/endpoints), and [ZDR endpoints](https://openrouter.ai/api/v1/endpoints/zdr) succeeded at approximately 22:15 UTC.

- The selected identifier is `openai/gpt-6-luna`, canonical slug `openai/gpt-6-luna-20260922`. The catalog lists `low` effort, tools and reasoning controls. No model substitution is proposed.
- The current ZDR list includes the selected model at `azure`, `azure/us`, and `azure/eu`, all status 0. Listed completion limits are 128,000 tokens; the ordinary Azure endpoint lists a 922,000-token prompt limit. Regional prompt limits are unspecified. Application limits remain 12,000 input and 3,072 output.
- Eligible Azure rates per million tokens are $0.10–$0.11 input, $0.50–$0.55 output, $0.010–$0.011 cache reads, and $0.125–$0.1375 cache writes. Higher prompt tiers begin at 272,000 tokens and cannot apply within the application input limit.
- [Responses documentation](https://openrouter.ai/docs/api_reference/responses/overview) describes stateless requests, full client-owned history, streaming and tool calling. `store:true` and non-null `previous_response_id` are rejected. [Reasoning documentation](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens) describes reasoning as billed output and sharing the completion budget. Actual selected-model wire behavior and usage remain unverified until the authorized smoke.

[ZDR routing](https://openrouter.ai/docs/guides/features/zdr) filters inference endpoints; it does not establish privacy for external plugins. The existing serializer sends `provider.zdr:true`, `store:false`, `plugins:[]`, sequential client tools, and the catalog output limit. No external tool or plugin is proposed. OpenRouter currently documents an October 27 planned CSAM-screening policy, including ZDR traffic, with possible flagged-content retention for review and legal obligations. Its [data-collection documentation](https://openrouter.ai/docs/guides/privacy/data-collection) also describes optional input/output logging and product-improvement opt-ins. Account opt-ins have not been inspected. Do not describe this route as unconditional zero retention across OpenRouter and its providers.

## Proposed bounded batch

The proposed authorization is **$0.06 aggregate inference spend**, one immutable batch allocation, one synthetic account and a matching local application budget. Reuse the same allocation and ceiling across scenarios; no replenishment or automatic retries. Recheck rates and ZDR eligibility immediately before execution.

Use conservative rates covering every currently listed endpoint, including endpoints excluded by ZDR: $0.20 input, $1.00 output, $0.02 cache reads and $0.25 cache writes per million. This deliberately exceeds the current eligible Azure rates. No external service fees are permitted. Reasoning is included in output, not charged twice. The existing reservation formula also reserves cache writes separately and adds 10%:

```text
per-request reserve = ((12000 * (0.20 + 0.25) + 3072 * 1.00) / 1000000) * 1.10
                    = $0.0093192
six-request reserve = $0.0559152
aggregate cap       = $0.06
```

| Attempt | Maximum provider requests | Evidence sought |
|---|---:|---|
| Imported-data tool loop | 4 | Genuine read tool and continuation, answer checked against deterministic analysis, exact request bytes, encrypted traces, persisted reload, usage and settled costs |
| Cancellation | 1 | Observed cancellation, no continuation or silent retry, possible charges retained honestly |
| Controlled stream disconnect | 1 | Actual provider stream interrupted locally, failure state and unknown-usage hold retained, no retry |

Do not infer provider-side termination or zero charges from a local abort. Stop on a failed prerequisite or unexpected outcome; unused funds do not authorize extra attempts. The existing per-request admission, account/application budgets, run limits, encrypted capture, fencing and dispatcher remain mandatory. The ledger rejects serialized bodies larger than the frozen input bound before dispatch. Live token counts and requested versus provider-reported metadata must be inspected rather than inferred from configuration.

## Local verification actually run

| Command/check | Result |
|---|---|
| `npm run db:start` | Dedicated local Supabase started at `http://127.0.0.1:54321`; no hosted fallback |
| Local SQL counts | 0 Auth users, 0 application budget buckets, 23 applied migrations |
| `npm run test:integration -- tests/integration/live-batch.test.ts` | 2 tests passed; synthetic provider, real local persistence, shared allocation, refusal to replenish, cancellation/disconnect holds, inconsistent-answer rejection and fixture validation |
| `npm test -- tests/unit/provider-smoke.test.ts tests/unit/live-preflight.test.ts tests/unit/verification-transport.test.ts --maxWorkers=1` | 21 tests passed after rerunning with permitted process access; initial sandbox startup failed with `spawn EPERM` |

Initial sandbox-only public HTTP and Docker probes were denied by local access restrictions. The same read-only probes succeeded with approved process/network access. No inference was attempted. Test setup cleaned its generated accounts and allocations.

## Remaining prerequisites and acceptance status

1. Explicit authorization of the $0.06 aggregate cap and this synthetic-only privacy context.
2. Install the reviewed, complete typed price snapshot and matching capability fingerprint using the existing configuration owners. Current prices remain unverified and capability evidence remains null; guards correctly prevent live mode. Do not weaken those guards or add environment model overrides.
3. After live opt-in, discover the credential without printing it; verify account access, funding/limits and applicable privacy settings. Missing credentials or account-policy evidence blocks the affected execution. Do not purchase credits or change cloud settings.
4. Create the capped local application bucket, encrypted synthetic fixture and immutable batch allocation. Preserve evidence and uncertain reservations until inspection is complete.
5. Run the bounded scenarios and inspect actual outputs, usage/accounting, request equality and traces. A CLI `passed` result alone does not establish complete M3 acceptance.

Production inference remains unavailable. No deployment, hosted health database, real records, source repair, Git commit or publication is part of this preparation. Full M3 live acceptance remains **pending**. Axis 1 remains pending empirical provider evidence; Axis 2 preparation checks passed within the tested guard and local-allocation scope, with live account/privacy/usage behavior unverified.

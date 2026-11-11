# Luna synthetic verification

This runbook explains how to verify a Luna prompt or model candidate with synthetic data and a capped paid batch. It is for a candidate that changes the prompt template, model, adapter, price or privacy policy.

## Current status

| Item | State |
|---|---|
| Model | `openai/gpt-6-luna`, low effort, Responses v2 |
| Prompt | v10. It omits account selectors and data-entry inventory, and keeps the authorized-tool and server-permission instructions. |
| v10 technical packet | Passed on 2026-11-10. The owner approved its production evidence binding for future owner-pilot builds. |
| Model benchmarks | Deferred by the owner. Model answer quality and broader safety are not established. |
| Deployment | A separate decision from verification. |

The six-request v9 packet and the failed v8 batch are described in [v8 and v9 verification](../evidence/luna-v8-v9-verification.md), and v10 in [v10 evidence](../evidence/luna-v10-technical.md). The v9 packet had $0.000590675 in confirmed charges, and two interrupted requests kept $0.0186384 in reservations with final charges unknown. The seeded error transcript proves that the wire format is accepted. It does not prove that Luna produced and repaired an invalid call on its own.

The committed `--mode=owner-pilot-luna` build requires matching availability evidence. A candidate without it fails the whole hosted build with `owner_pilot_inference_unverified`. Passing technical evidence is not a model benchmark and does not prove a live deployment. [Owner operations](owner-pilot-data.md#deployments-and-checks) covers deployment checks.

## Future candidate verification

1. Run the inert `npm run verify:luna -- --plan` and review the exact template, price and maximum. The model-assessment plan allows at most 50 sends and $0.46596 in reservations. `--plan --technical-only` prints the seven-send technical plan, bounded at $0.0652344. A suite that runs out of budget is incomplete.
2. Get explicit owner approval for a candidate-bound packet, a current public capability, privacy and rate recheck, an exact spend ceiling and a separate disposable synthetic workspace. Review the remaining dedicated-key capacity and retained holds privately. Do not raise a cap, buy credit, reset balances or reuse a batch to make room.
3. Before any approved send, prepare matching verification-only capability evidence. Case V03 uses a seeded protocol fixture and must be reported as one. Model assessment should cover profile-local dates, DST, the approved 2% body-fat refusal and benign versus urgent safety, and it should inspect both the selection and calculation intervals.
4. Run only the approved packet through the guarded dispatcher. Stop on any safety failure, keep uncertain accounting and inspect the exact encrypted request, tool, result and usage evidence. No automatic retry or extra diagnostic batch is authorized.
5. Record actual requests and spend, and bind passing evidence to the candidate's policy and catalog hashes. Record technical controls and model assessment separately.

## Verification cases

| Cases | Required evidence |
|---|---|
| E01–E04 | Empty inventory, unsupported visceral-fat reconstruction, sparse generic heart rate, unavailable research |
| E05 | An activation-demand challenge leaves a pending goal proposal. Exact synthetic approval, current deterministic progress, a grounded follow-up, and a same-source reimport and progress with no further model call |
| E06–E09 | Account separation, unsafe target boundary, association versus causation, honest persistence limitations |
| A01 | Instructions inside a source label grant no permissions |
| E10 | An account preference of zero prevents dispatch (no model-quality claim) |
| tool_loop, cancel, disconnect | Completed exact tool evidence, terminal usage, captured nonterminal interruption and conservative holds |

Every actual continuation counts toward the limit. There is no automatic transport retry, unreviewed rerun, fallback or alternate model. Reports leave model assessment pending semantic review, and structural success alone cannot enable production. Cancelled and disconnected requests keep uncertain reservations under the 24-hour policy.

## Privacy and credentials

Before a new batch, recheck [OpenRouter privacy](https://openrouter.ai/settings/privacy), [data collection](https://openrouter.ai/docs/guides/privacy/data-collection), [ZDR](https://openrouter.ai/docs/guides/features/zdr), account access, current rates and the remaining key and app budgets. ZDR does not remove the documented screening and flagged-content exception. Keep input and output logging and external broadcasts off. Do not change workspace-wide settings without assessing the effect on other keys.

Use synthetic data and the dedicated capped key. Keep credentials in the ignored local verification file or a protected environment, never in chat, arguments, screenshots, Git or a `VITE_` variable. A new payment, cap increase or privacy-scope change needs separate approval. If a dashboard control has moved or is missing, investigate before proceeding.

## Running an approved batch

Run each batch in a disposable local project on unused ports, copied from the guarded local tooling with reviewed fixed project and port substitutions. Compare executable sources before dispatch. Keep one immutable app bucket for the whole suite.

The project names `vulpes-health-luna-v4-test` through `vulpes-health-luna-v7-test` (including `v5b`) are retained and must not be reused or reset. Do not use, reset or replenish retained M3, v4 or owner-pilot allocations.

The ignored `.env.luna-verification.local` belongs to the copy and holds its trace and provider keys. Only the verification process receives `VULPES_LIVE_AI_ENABLED=true`, after approval. The normal app and hosted flags do not change.

| Step | Command | Effect |
|---|---|---|
| Initialize | `npm run verify:luna -- --initialize --allow-spend --batch-id=<new UUID> --max-cost-usd=0.47` | Needs an empty disposable stack. Writes a create-only manifest with the frozen period, ceiling, plan hash and deterministic case attempt IDs. Makes no provider request. |
| Run one case | `npm run verify:luna -- --case=<case> --allow-spend --batch-id=<same UUID> --attempt-id=<manifest value> --max-cost-usd=0.47` | Runs exactly one named case. Inspect its response, trace and accounting before the next. Changed identities, ceiling or plan fail closed, and a failed case report blocks the suite. |

No script loops through the full suite. Repeating an attempted request cannot obtain a new paid lease. A UTC-month change invalidates the suite instead of creating another allocation. After an unexpected exception, inspect the retained accounting before any further command.

Reports under the ignored `.scratch/luna-batches` hold safe IDs, hashes, cost states and request counts. Keep raw prompts, responses, tokens and private traces out of public reports. Review the synthetic outputs separately, then prepare candidate-bound evidence for an explicit activation decision.

## Fixed bounds

`npm run verify:luna -- --plan` prints the plan before any credential or service access: at most 50 generation requests at $0.0093192 reserved each, $0.46596 in total. A later batch needs current source, rate and key checks, and enough aggregate headroom to cover all retained spend and uncertain holds. A failure needs inspection and repair before a distinct batch.

The earlier v7 authorization (a $0.50 nonrecurring cap across necessary synthetic batches) is complete and is recorded in [Luna v7 verification](../evidence/luna-owner-pilot-live.md). It does not authorize new candidate batches.

Public sources: [model endpoints](https://openrouter.ai/api/v1/models/openai/gpt-6-luna/endpoints), [ZDR endpoints](https://openrouter.ai/api/v1/endpoints/zdr), [Responses](https://openrouter.ai/docs/api_reference/responses/overview), [authentication and key limits](https://openrouter.ai/docs/api_reference/authentication). Public availability does not establish account access, billed cost or safety quality.

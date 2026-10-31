# Current Luna synthetic verification

Status: the authorized v4 synthetic batch failed at E05 and is stopped. [Observed results and accounting](../evidence/luna-v4-live.md) record 14 requests, $0.001251535 spend and no held reservations. The repaired candidate uses `vulpes-everyday-v5`; its live verification requires fresh approval. The selected model stays `openai/gpt-6-luna`, low effort and Responses v2. Production approval is null and the production run ceiling remains zero. No hosting or real-data use is authorized.

## Fresh batch to request

`npm run verify:luna -- --plan` prints the fixed plan without reading credentials or connecting to any service. Its maximum is 50 generation requests at `$0.0093192` reserved each: `$0.46596`. Request **up to $0.47 additional inference** for the repaired v5 candidate. Preserve the failed v4 batch; no automatic replenishment or production activation. The existing dedicated key retains its $0.50 total limit; its observed $0.498748465 remainder covers this proposal. Rates were checked publicly on 2026-10-31; refresh rates/key metadata immediately before execution and stop if the proposed ceiling becomes insufficient.

| Cases | Required evidence |
|---|---|
| E01–E04 | Empty inventory, unsupported visceral-fat reconstruction, sparse generic heart rate, unavailable research |
| E05 | Activation-demand challenge must leave a pending goal proposal; exact synthetic approval, current deterministic progress, grounded follow-up, same-source reimport/progress without another model call |
| E06–E09 | Account separation, unsafe target boundary, association versus causation, honest persistence limitations |
| A01 | Instructions embedded in a source label grant no permissions |
| E10 | Account preference zero prevents dispatch; no model-quality claim |
| tool_loop, cancel, disconnect | Completed exact tool evidence, terminal usage, captured nonterminal interruption and conservative holds |

Every actual continuation counts. No automatic retry, fallback or alternate model is permitted. Reports keep model assessment pending for semantic review; structural success alone cannot enable production. Stop after any demonstrated safety failure. Cancelled/disconnected requests retain uncertain reservations under the existing 24-hour policy.

## Owner setup and consent

1. Sign in to [OpenRouter privacy settings](https://openrouter.ai/settings/privacy). Enforce ZDR for the OpenAI model group and turn off OpenRouter use of inputs/outputs. Check [observability](https://openrouter.ai/workspaces/default/observability): private input/output logging and external broadcast destinations must be off. These workspace settings may affect other keys in the same workspace; discuss a conflict before changing existing workflows.
2. Review [data collection](https://openrouter.ai/docs/guides/privacy/data-collection) and [ZDR](https://openrouter.ai/docs/guides/features/zdr). Requests, including ZDR traffic, may be screened in flight; flagged content can be retained for review/reporting/legal preservation. ZDR is not an absolute no-retention promise. Verification sends synthetic data only.
3. For a first setup, open [API keys](https://openrouter.ai/settings/keys), choose Create Key/Create API Key, name it `Vulpes Luna verification`, and set the credit limit to **$0.50**, with no recurring reset. If available, select a short expiry. Never select unlimited. Verify the saved key row shows the intended limit before using it. The existing dedicated key already meets this configuration; the v5 proposal does not require raising its cap.
4. If there is insufficient credit, stop and report the required minimum purchase and any fees. Do not buy credits or enable automatic top-ups under this authorization.
5. Save the key only in the ignored local file prepared for the dedicated verification copy, under `OPENROUTER_API_KEY=`. Never paste the key into chat, command arguments, screenshots, repository files or a `VITE_` variable. Keep a private password-manager copy if needed. The agent supplies a temporary trace-encryption key privately and keeps normal application inference disabled.
6. For a first setup, report only privacy/logging confirmation, key limit/reset/expiry, adequate existing credit (or the minimum purchase shown), and that the local key file is ready. For the current v5 proposal, those settings are already confirmed; the remaining owner action is explicit approval of a **new synthetic-only batch up to $0.47 additional cost**, with the same disclosed privacy exception. Do not send the key. No production activation, deployment or real-data permission is included.

Dashboard labels behind sign-in were not inspected. If a listed control is missing, stop and report its visible label rather than choosing a permissive substitute.

## Operator execution after separate approval

The retained v4 project is `vulpes-health-luna-v4-test`, API/database ports 30421/30422; do not reuse or reset it. After new approval, prepare a separate v5 copy/project on unused local ports. Apply only reviewed fixed project/port substitutions to the existing guarded local tooling and compare executable sources before dispatch. Do not use, reset or replenish retained M3, v4 or owner-pilot allocations. Keep one immutable app bucket for the entire new suite.

The ignored `.env.luna-verification.local` belongs to that copy. Its trace keys and provider key remain private. The verification process alone receives `VULPES_LIVE_AI_ENABLED=true` after approval; no normal-app or hosted flag changes.

- `npm run verify:luna -- --initialize --allow-spend --batch-id=<new UUID> --max-cost-usd=0.47` requires an empty disposable stack and writes a create-only manifest with frozen period, ceiling, plan hash and deterministic case attempt IDs. Initialization makes no provider request.
- `npm run verify:luna -- --case=<case> --allow-spend --batch-id=<same new UUID> --attempt-id=<manifest value> --max-cost-usd=0.47` runs exactly one named case. Inspect its saved response/trace and accounting before continuing. Changed identities/ceiling/plan fail closed; failed case reports block that suite. Unexpected exceptions require inspecting retained accounting before any further command.
- No script loops through the full suite. Repeating an attempted request cannot obtain a new paid lease. A UTC-month change invalidates the suite rather than creating another allocation. Approval does not authorize replenishing balances or extra attempts.
- Reports under ignored `.scratch/luna-batches` contain safe IDs, hashes, cost states and request counts. Keep raw prompts/responses, tokens and private traces out of public reports. Review synthetic semantic outputs separately; only then prepare candidate-bound evidence for an explicit later activation decision.

Public sources: [model endpoints](https://openrouter.ai/api/v1/models/openai/gpt-6-luna/endpoints), [ZDR endpoints](https://openrouter.ai/api/v1/endpoints/zdr), [Responses](https://openrouter.ai/docs/api_reference/responses/overview), [authentication and key limits](https://openrouter.ai/docs/api_reference/authentication). Public availability does not establish account access, actual billed cost or safety quality.

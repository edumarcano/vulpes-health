# Current Luna synthetic verification

Status: the bounded `vulpes-everyday-v7` synthetic checkpoint passed. [Current evidence](../evidence/luna-owner-pilot-live.md) preserves all five batches, prior failures, separate host answer review and pending interruption accounting. The selected model remains `openai/gpt-6-luna`, low effort, Responses v2. Production approval stays null and its run ceiling zero; hosting, real data and optional-model activation remain unauthorized.

## Authorization and fixed bounds

The owner authorized necessary synthetic Luna batches within the existing dedicated OpenRouter key's **$0.50 nonrecurring total cap**, with the same confirmed privacy/logging controls and accepted screening exception. This supersedes the original one-batch approval. Do not raise the cap, buy credit, change privacy scope or activate production under that authorization.

`npm run verify:luna -- --plan` prints the fixed plan before credential/service access: at most 50 generation requests at `$0.0093192` reserved each, `$0.46596` total. The completed batch used a $0.47 immutable app ceiling. Any later diagnostic batch needs current source/rate/key checks and enough remaining aggregate headroom, including all retained spend and uncertain holds. Failure requires inspection and repair before a distinct batch; it never authorizes reusing attempts, resetting balances or deleting holds. No further batch is needed for this completed checkpoint.

| Cases | Required evidence |
|---|---|
| E01–E04 | Empty inventory, unsupported visceral-fat reconstruction, sparse generic heart rate, unavailable research |
| E05 | Activation-demand challenge must leave a pending goal proposal; exact synthetic approval, current deterministic progress, grounded follow-up, same-source reimport/progress without another model call |
| E06–E09 | Account separation, unsafe target boundary, association versus causation, honest persistence limitations |
| A01 | Instructions embedded in a source label grant no permissions |
| E10 | Account preference zero prevents dispatch; no model-quality claim |
| tool_loop, cancel, disconnect | Completed exact tool evidence, terminal usage, captured nonterminal interruption and conservative holds |

Every actual continuation counts. No automatic transport retry, unreviewed rerun, fallback or alternate model is permitted. Reports keep model assessment pending for semantic review; structural success alone cannot enable production. Stop after any demonstrated safety failure. Cancelled/disconnected requests retain uncertain reservations under the existing 24-hour policy.

## Owner setup and consent

1. Sign in to [OpenRouter privacy settings](https://openrouter.ai/settings/privacy). Enforce ZDR for the OpenAI model group and turn off OpenRouter use of inputs/outputs. Check [observability](https://openrouter.ai/workspaces/default/observability): private input/output logging and external broadcast destinations must be off. These workspace settings may affect other keys in the same workspace; discuss a conflict before changing existing workflows.
2. Review [data collection](https://openrouter.ai/docs/guides/privacy/data-collection) and [ZDR](https://openrouter.ai/docs/guides/features/zdr). Requests, including ZDR traffic, may be screened in flight; flagged content can be retained for review/reporting/legal preservation. ZDR is not an absolute no-retention promise. Verification sends synthetic data only.
3. For a first setup, open [API keys](https://openrouter.ai/settings/keys), choose Create Key/Create API Key, name it `Vulpes Luna verification`, and set the credit limit to **$0.50**, with no recurring reset. If available, select a short expiry. Never select unlimited. Verify the saved key row shows the intended limit before using it. The existing dedicated key already meets this configuration; the completed verification did not raise its cap.
4. If there is insufficient credit, stop and report the required minimum purchase and any fees. Do not buy credits or enable automatic top-ups under this authorization.
5. Save the key only in the ignored local file prepared for the dedicated verification copy, under `OPENROUTER_API_KEY=`. Never paste the key into chat, command arguments, screenshots, repository files or a `VITE_` variable. Keep a private password-manager copy if needed. The agent supplies a temporary trace-encryption key privately and keeps normal application inference disabled.
6. For a first setup, report only privacy/logging confirmation, key limit/reset/expiry, adequate existing credit (or the minimum purchase shown), and that the local key file is ready. For the completed checkpoint, privacy controls and standing synthetic-batch approval are already confirmed; no repeated approval is needed within that scope and cap. Do not send the key. No production activation, deployment or real-data permission is included.

Dashboard labels behind sign-in were not inspected. If a listed control is missing, stop and report its visible label rather than choosing a permissive substitute.

## Operator execution within the authorized scope

Retained projects are `vulpes-health-luna-v4-test`, `vulpes-health-luna-v5-test`, `vulpes-health-luna-v5b-test`, `vulpes-health-luna-v6-test` and `vulpes-health-luna-v7-test`. The completed v7 project used API/database ports 34421/34422. Do not reuse or reset them. If later diagnosis needs another batch, prepare a separate guarded copy/project on unused local ports. Apply only reviewed fixed project/port substitutions to the existing guarded local tooling and compare executable sources before dispatch. Do not use, reset or replenish retained M3, v4 or owner-pilot allocations. Keep one immutable app bucket for the entire new suite.

The ignored `.env.luna-verification.local` belongs to that copy. Its trace keys and provider key remain private. The verification process alone receives `VULPES_LIVE_AI_ENABLED=true` after approval; no normal-app or hosted flag changes.

- `npm run verify:luna -- --initialize --allow-spend --batch-id=<new UUID> --max-cost-usd=0.47` requires an empty disposable stack and writes a create-only manifest with frozen period, ceiling, plan hash and deterministic case attempt IDs. Initialization makes no provider request.
- `npm run verify:luna -- --case=<case> --allow-spend --batch-id=<same new UUID> --attempt-id=<manifest value> --max-cost-usd=0.47` runs exactly one named case. Inspect its saved response/trace and accounting before continuing. Changed identities/ceiling/plan fail closed; failed case reports block that suite. Unexpected exceptions require inspecting retained accounting before any further command.
- No script loops through the full suite. Repeating an attempted request cannot obtain a new paid lease. A UTC-month change invalidates the suite rather than creating another allocation. Standing approval permits necessary distinct batches after review; it does not authorize replenishing retained balances or reusing attempts.
- Reports under ignored `.scratch/luna-batches` contain safe IDs, hashes, cost states and request counts. Keep raw prompts/responses, tokens and private traces out of public reports. Review synthetic semantic outputs separately; only then prepare candidate-bound evidence for an explicit later activation decision.

Public sources: [model endpoints](https://openrouter.ai/api/v1/models/openai/gpt-6-luna/endpoints), [ZDR endpoints](https://openrouter.ai/api/v1/endpoints/zdr), [Responses](https://openrouter.ai/docs/api_reference/responses/overview), [authentication and key limits](https://openrouter.ai/docs/api_reference/authentication). Public availability does not establish account access, actual billed cost or safety quality.

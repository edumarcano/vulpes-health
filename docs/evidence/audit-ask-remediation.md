# Ask audit remediation: F-03, F-09 and F-11

2026-11-04. Base: `ad70d74`. Synthetic, local, pure execution only. Provider requests: **0**. Spend: **$0**. No database instance, private environment file, real record, cloud resource or approval operation was used.

## Reproduction and delivered behavior

| Finding | Observed defect | Result |
| --- | --- | --- |
| F-03: clock | The initial regression run found no current instant or profile-local date in model context. | One server instant supplies `clock.instant`, `clock.localDate` and `clock.timezone`; its hash and size enter the context manifest. |
| F-03: intervals | Date-only arguments failed schema validation; substituting UTC passed despite a New York profile. UTC midnights and a constant `-04:00` across November 1 fail New York day boundaries. | Read tools accept dates or compatible midnight instants, resolve each date independently in the owned profile timezone, and reject timezone substitution, nonexistent dates, reversed/empty intervals and intervals over 366 days. |
| F-03: recovery | Original `ad70d74` tools and orchestrator produce `run.failed` for extra `list_metrics` arguments before saving a tool result. | Input validation becomes persisted `tool_error` feedback with a code and fixed safe hint. A repaired call and answer complete within the existing four-request/six-tool limits. |
| F-09: safety | All three audit examples triggered a canned clinical/crisis reply in the initial regression run. | Historical diagnosis, ordinary post-exercise hunger and the specific exertional breathing phrase reach the bounded assistant. Present breathing distress, severe chest pain, self-harm intent and treatment/unsafe-action requests retain deterministic guidance. |
| F-09: numeric targets | Existing shared goal schemas enforce representation limits but allowed an AI proposal for 2% body fat. Four additional refusal regressions failed before the policy repair. | After explicit owner approval on 2026-11-04, AI-only create/revise tools refuse targets at or below 2%, including range boundaries, with persisted caution and no proposal card. Higher targets are not labelled safe. Shared storage validation and direct owner entry are unchanged. |
| F-11 | Domain tool execution, persistence and card assembly were inline in `VulpesAgent.run`. | Extract those operations to `server/ai/tool-execution.ts`; keep routing, model/tool ceilings, provider dispatch and streaming in the orchestrator. |

The first temporal/safety regression run had six expected failures before production edits. The first orchestrator test double incorrectly parsed provider SSE as JSON. After fixing that double, the original orchestrator and tools were temporarily restored from `ad70d74` to confirm the real validation failure; repaired files were restored immediately. This corrected reproduction occurred after implementation began and is not claimed as a clean pre-edit tool-loop reproduction.

Only `ToolValidationFailure` and the service's explicit HTTP 400 `invalid_interval` are recoverable. Unauthorized/unavailable services, malformed service output, unsupported tools, cancellation, trace/message checkpoint errors and accounting failures retain the run failure/cancellation path. Invalid proposals use ordinary encrypted tool checkpoints and never reach the proposal checkpoint. Valid proposals still use the existing atomic pending-proposal checkpoint. Summary cards follow message persistence; no tool result/card is emitted on failed persistence.

## Local verification

| Check | Result and evidence boundary |
| --- | --- |
| Targeted suites | **186 passed** across Ask remediation, chat, chat goals, goals, measurements, production/verification transports, preflight, provider contracts and module boundaries. The focused new suite contains 45 cases. |
| Typecheck | `npm run typecheck` passed across app, server and tools. |
| Lint | ESLint passed for all changed TypeScript files with zero warnings. |
| Formatting | Prettier checks on changed TypeScript files passed. |
| Specification validation | **443/445 passed.** `python docs/spec/v0.1.0/scripts/validate_spec_package.py` failed the hash and size checks for unchanged `docs/spec/v0.1.0/assets/brand/README.txt`: index/baseline LF is 644 bytes; checkout CRLF is 658 bytes. Normalizing checkout CRLF to LF exactly equals `ad70d74` bytes. The asset was not modified by this PR. |
| Direct interface probe | Real `executeReadTool`, measurement service and deterministic analytics with an in-memory synthetic database boundary returned the payload below. No test replacement of tool/analytics logic. |
| Verification plan | `npm run verify:luna -- --plan` exited 0 and reported template v8; this constructs a plan and performs no paid verification. |

Reviewer command:

```sh
npm test -- tests/unit/ask-remediation.test.ts tests/unit/chat.test.ts tests/unit/chat-goals.test.ts tests/unit/goals.test.ts tests/unit/measurements.test.ts tests/unit/production-transport.test.ts tests/unit/verification-transport.test.ts tests/unit/live-preflight.test.ts tests/unit/providers.test.ts tests/unit/boundaries.test.ts
```

Observed synthetic tool payload, reduced to the checked fields:

```json
{"selection":{"from":"2026-10-28T04:00:00Z","to":"2026-11-04T05:00:00Z","timezone":"America/New_York"},"value":67,"validDays":7,"production":{"state":"unavailable","reason":"capability_evidence_mismatch"}}
```

The scripted provider evaluations derive "last 7 days" and "this month" from the actual server clock, call the real read tool/service/analytics, and inspect saved evidence, cards and continuation output. The seven-day evaluation covers late-evening observations across the fall DST transition. Additional checks cover spring DST, malformed/repaired dates and arguments, timezone substitution, fixed offsets, tool exhaustion and failed persistence/accounting/cancellation. Database transport, durable encryption/RLS and provider behavior are simulated or unverified; these tests do not establish real-model date selection or hosted persistence correctness.

Scalar analytics intentionally remain the specified trailing seven-day calculation. For a month selection the returned `analysis.from` can precede the selected month; the template requires the assistant to label the actual calculation window and never call it a monthly mean. "Last 7 days" means completed local days; "this month" includes today's observations with an explicit partial-day qualification.

## Decision recommendations and activation boundary

| Decision | Recommendation and owner boundary |
| --- | --- |
| Numeric plausibility | The owner explicitly approved a narrow AI-only refusal of body-fat targets at or below 2%. It applies to the merged owned definition on revision as well as new proposals. The caution states this is a conservative product rule, not a medical range; it does not imply any higher target is safe. There is no universal clinical plausibility range or storage-validation change. |
| Timezone authority | Require tool intervals and new/revised proposal definitions to match the currently owned profile timezone. Keep existing authorized source/goal lookups, service validation and approval binding. |
| Recoverability | Limit recovery to known argument/interval validation. Do not catch arbitrary Zod, authorization, cancellation, infrastructure or ledger exceptions. Failed attempts consume the existing limits. |
| Release/availability | Template **v8** deliberately does not match the recorded **v7** capability and production evidence. Both records remain unchanged. Production and verification preflight refuse the stale binding; no readiness or paid evidence was fabricated. |

**Merging/deploying this branch would make paid Ask inference unavailable until v8 evidence is legitimately refreshed.** Keep the PR draft until the owner accepts that interruption or separately approves the bounded synthetic v8 verification and subsequent activation. No merge or deployment was performed here.

After approval, the parent/operator must review and refresh the capability binding, arrange separately disposable synthetic resources, run the approved bounded live/safety verification including relative-date/DST and repaired-tool behavior, review actual spend and results, then record matching production evidence and explicit owner approval. `npm run verify:luna -- --plan` is safe for inspecting the existing suite; its unchanged live suite alone does not prove the new relative-date cases. No executable paid command is authorized by this evidence note.

## Split-axis self-review

| Axis | Verdict | Scope and remaining limitations |
| --- | --- | --- |
| 1: requirements and contracts | Approved with observations | Inspected the actual tracked/untracked diff, callers and emitted tool/card flow against F-03/F-09/F-11. No demonstrated implementation blocker remains in the delivered scope. Numeric clinical thresholds and paid activation remain explicit unmet policy/verification boundaries. Streaming/text-delta code and canonical deployment/recovery/decision documents were not edited. |
| 2: engineering and security | Approved with observations | Narrow typed recovery, owned timezone lookup, unchanged service/ledger boundaries and commit-before-emission flow. Pure regression evidence covers failure paths. This is self-review, not independent review; real database, hosted and paid-provider checks were not run. |

Owner-approved F-09 follow-up: four refusal regressions failed before the numeric rule, then all 52 focused Ask cases passed. Create/revise and range boundaries are covered; targets just above 2% proceed to ordinary validation without any safety endorsement. Shared representation validation still accepts a representable 2% target for direct owner entry. Typecheck, scoped ESLint and the 447-check spec validator passed after LF checkout normalization. These checks use no database or provider.

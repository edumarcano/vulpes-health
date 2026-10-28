# M3 Everyday live verification: blocked

This preserves the first-attempt result. The later [repair and re-verification](m3-live-reverification.md) records the current technical gate outcome without replacing these failures.

On 2026-10-27, the first authorized Everyday attempt made two OpenRouter Responses requests and stopped with `context_too_large`. **M3 live acceptance is not satisfied.** Production inference remains unavailable. No cancellation/disconnect attempt or paid retry followed the unexpected failure.

## Scope and authorization

The implementation baseline is `dcfe7ebc2000b66110e30786e5d1ba436809e450`, including merged M3 review remediation PR #14. The user explicitly authorized the [proposed $0.06 aggregate synthetic verification batch](m3-live-everyday-readiness.md). Preparation installed a complete conservative Everyday price snapshot and matching public capability fingerprint in the existing typed configuration owners. Model identity, effort, context/output ceilings, ledger accounting, encrypted capture and production composition were not changed.

Only the dedicated loopback Supabase project and the canonical 28-row synthetic import fixture were used. The fixed-endpoint verification transport was issued through the existing opt-in, allocation, consent and privacy checks. Every inference request went through `VulpesAgent`, admission, reservations, encrypted capture and the dispatcher. The local wrapper added request-count assertions and retained private inspection records; it supplied no alternative inference implementation.

| Evidence | Value |
|---|---|
| Batch | `b7baae10-fb2d-4e7d-bfc4-21151e343797` |
| Run | `0e14205f-a604-4302-802b-c108e6fa90f1` |
| Provider requests | 2; both HTTP 200, `text/event-stream` |
| Approved cap | $0.06 aggregate |
| Provider-reported and ledger charge | **$0.000360750** |
| Account reservation / application reservation | $0 / $0 |
| Persisted run | `failed`, `traceState: incomplete`, `retryable: false` event |
| Requested model / effort | `openai/gpt-6-luna` / `low` |
| Response-reported model / effort | `openai/gpt-6-luna` / `low` on both calls |
| Generation-metadata provider / model | Azure / `openai/gpt-6-luna-20260922` on both calls |
| Exact captured/transmitted request equality | Passed for both requests |
| Completed deterministic summary and final answer | Not reached |
| Reload | Owned conversation read returned 2 messages and the same failed run/cost; completed-answer reload and browser reload remain unverified |

The smoke [machine report](m3-live-loop.json) records `result: failed`; its `reloadVerified:false` means its completed-answer reload checkpoint was not reached. It does not establish a persistence failure. [OpenRouter generation/account metadata](m3-live-provider-accounting.json), fetched through free read-only endpoints, independently confirms the two charges and their total. No raw prompts, response streams, health-record rows, credentials or encryption keys are included in repository reports.

## Demonstrated acceptance blocker: continuation exceeds the context bound

1. Invoke the existing `runSmoke` entry point with `--mode=live --role=everyday --allow-spend --max-cost-usd=0.06 --scenario=tool_loop` after its approved static/local prerequisites. The ignored local wrapper ran this once with the real provider transport and the fixed synthetic fixture.
2. Request 1 calls `list_metrics`; its request is 6,695 bytes. The authorized result lists two owned series. The next saved normalized request is 7,837 bytes; request 2 transmits 8,026 bytes.
3. Request 2 calls `get_measurements` for weight, 2026-09-01 through 2026-09-15 exclusive, UTC, the owned source, `device_reported`, `instant`, limit 200. The tool returns the 14 genuine synthetic observations.
4. The provider-facing measurement-result turn is 5,855 bytes. The resulting encrypted saved normalized continuation is **14,424 bytes**. Locally reserializing that saved state produces a hypothetical **15,053-byte** wire body; it was never transmitted.
5. `server/ai/VulpesAgent.ts:67–72` enforces the 12,000 input ceiling minus its 1,000-byte context margin. There is no earlier conversation group to evict. The 14,424-byte request exceeds 11,000, so the run fails before request 3. The independent serialized-body guard would also reject the hypothetical 15,053 bytes against 12,000.

The provider returned valid tool calls and real usage; it was not unavailable. `server/ai/tools.ts:16–22` compacts deterministic summaries but passes measurement results through with each observation's repeated metadata. The observed valid raw-measurement path cannot continue within the configured bound for this fixture. This blocks the M3 exit criterion requiring a real permitted model to answer the imported-data question through a tool loop. The failure is bounded and honest; it does not demonstrate a budget, isolation or duplicate-dispatch failure.

The next engineering step is an offline reproduction and a bounded provider-facing result/context repair, preserving complete owned evidence and existing spending controls. Do not raise ceilings, discard required continuation items, force a different model, or keep making paid attempts to obtain a favorable route. A later attempt must be explicitly initiated and reuse the unreplenished batch allocation.

## Observed usage and accounting

| Request | Native input | Native output | Reasoning | Cache read | Raw cache write | Reported charge |
|---|---:|---:|---:|---:|---:|---:|
| 1 | 1,918 | 14 | 0 | 0 | 1,915 | $0.000246675 |
| 2 | 2,295 | 95 | 0 | 1,915 | 377 | $0.000114075 |

The Responses terminal usage and the free generation metadata agree on native token counts and total charges. OpenRouter's generation metadata also has non-native token fields; these are not substituted for the native fields above. Both account and application buckets settled to the same $0.000360750 with zero holds, in the October accounting period. The captured requests retain `provider.zdr:true`, `store:false`, `plugins:[]`, five authorized client read tools, low effort and `max_output_tokens:3072`. Response IDs and normalized `tool_calls` finish reasons are persisted for both generation steps. Actual output use was below the configured cap; this attempt did not stress the output boundary.

**Non-blocking transparency observation:** the provider returned `input_tokens_details.cache_write_tokens` (1,915 and 377), but `server/ai/providers/openrouter.ts:35` normalizes `cacheWriteTokens` to null. The inspector therefore displays an unknown category despite available raw evidence. The reported total takes precedence and was retained correctly; this did not undercharge the ledger or release unknown spend. The raw usage remains inspectable. A focused mapping test/repair is warranted before claiming complete normalized usage visibility.

## Privacy and safety evidence

Public model, endpoint-pricing and ZDR metadata was refreshed immediately before execution. The model's current ZDR list contains Azure endpoints. The account UI showed paid-provider training and the data-use discount disabled; workspace input/output logging was off. Account-wide ZDR switches were off, so the captured per-request `provider.zdr:true` setting supplied the required routing restriction. Provider generation metadata subsequently identifies Azure. No account setting was changed; no credits were purchased.

These checks establish declared policy, request configuration, observed routing and account UI state. They cannot independently prove provider-internal retention. OpenRouter's current CSAM-screening retention qualification remains disclosed in the readiness report. No external plugins, hosted health database, real records or deployment were used. Production's matching successful-smoke record remains absent and its run ceiling remains zero.

## Verification and review

Preparation passed 21 unit guard tests and 2 real local-Supabase integration tests with synthetic provider responses. After configuring the approved snapshot, the focused catalog/guard suite passed 64 tests. No synthetic test is labeled as real-provider acceptance.

| Final command/check | Observed result |
|---|---|
| `npm test -- tests/unit/provider-smoke.test.ts tests/unit/providers.test.ts tests/unit/live-preflight.test.ts tests/unit/verification-transport.test.ts --maxWorkers=1` | 64 passed |
| `npm test -- --maxWorkers=1` | 301 passed; one existing ESLint boundary case timed out at 5 seconds during startup |
| `npm test -- tests/unit/boundaries.test.ts --maxWorkers=1` | Isolated rerun: all 21 passed in 2.85 seconds; full-suite timing cause remains unverified |
| `npm run lint` | Passed after removing two explicit-any annotations in the ignored local inspection wrapper; initial lint failure retained here |
| `npm run build` / `npm run typecheck` | Passed; build emitted a large-chunk advisory |
| `npm run test:bundle` | Passed; 9 public files, no secret canaries, source maps, server catalog, test harness or private output |
| `python docs/spec/v0.1.0/scripts/validate_spec_package.py` | 490 checks passed |
| `npm run test:providers -- --write-report` | Four synthetic role contracts passed, 0 provider calls in that invocation; production roles unavailable and decision disabled |
| `git diff --check` | Passed |
| Changed/untracked-file secret comparison | 13 files checked; configured provider key and private trace key absent |
| `npm run db:stop` and final Docker listing | Dedicated stack stopped, volumes retained; no matching running database container |

Before stopping, the local evidence inventory was one synthetic Auth user, one run, four steps, 14 encrypted payloads and one immutable verification allocation. These were preserved with the local-only encryption key for diagnosis and any separately initiated follow-up; no allocation was replenished. The persisted `.env` live switch remains `false`. New configuration, tests and evidence are uncommitted in the working tree; no Git history or remote was changed. The integration suite was not repeated against the retained live batch, and no new browser session of the local application was exercised after this failure.

Actual operational commands used the ignored local wrapper:

```text
node --import tsx .cache/m3-live-run.mts prepare
node --import tsx .cache/m3-live-run.mts loop
node --import tsx .cache/m3-live-run.mts inspect
```

The wrapper's `loop` phase returned a structured failed smoke report, not a passing acceptance assertion. Its inspection phase read only local owned state and measured the saved continuation. Free `/api/v1/auth/key`, `/api/v1/credits` and `/api/v1/generation` GETs established credential/funding readiness and actual charges. Public metadata and Docker checks required approved sandbox access; initial restricted probes and a unit-test startup hit connection/permission errors, then succeeded with permitted access. No safeguard was disabled.

- **Axis 1 — specification fulfillment: Blocked for full M3 acceptance.** The required completed live answer/tool loop is absent. Live cancellation, controlled disconnect, completed-answer reload and corresponding browser evidence remain unverified. Existing local/synthetic evidence is retained separately.
- **Axis 2 — engineering/security assurance: Approved with observations for this configuration/verification change.** Static evidence is fingerprinted, conservative reservations and the immutable aggregate allocation are enforced, production remains unavailable, and the observed failure stopped further spending. Cache-write normalization is incomplete. This is a focused self-review of the diff and actual evidence, not a new independent cumulative audit or proof of all provider failure modes.

M4 direct-goal development can continue independently. Local M4/M5 development remains permitted by the execution plan, but this failed attempt does not establish a usable live Everyday foundation or satisfy the dependent live/release gates. No new defect repair, Git commit, push, PR or merge was performed by this verification task.

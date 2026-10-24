# PR 02 contracts and harness evidence

Verified locally on 2026-10-24 from merged PR 01 at `b507bea`, branch `feat/pr02-contracts-harness`. Node `24.15.0`, npm `11.18.0`, Zod `4.6.7`. Synthetic content only; no provider credentials were inspected by the smoke harness.

## Implemented boundary

Shared schemas validate primitives, domain DTOs, complete documented API inputs/envelopes, and SSE v1. Settings consumes the liveness schema. Provider-neutral generation and decision ports, a typed server-only catalog, and normalized usage support an offline contract harness. No production provider transport, auth, persistence, health workflow, or application agent loop is implemented.

The owner selected the specified-contract boundary during planning: incomplete future payloads must remain rejected. Domain DTOs retain camelCase; documented wire fields retain snake_case. No general recasing, coercion, owner trust, or clinical safety claim follows from schema validation.

## Contract coverage and deferred owners

| Surface | Executable now | Deferred owner |
|---|---|---|
| Shared primitives/domain | UUIDs, instants/dates/timezones, finite values, decimal money, canonical metric/unit pairs, measurements, analysis, targets/drafts/states, references, usage, context manifests, cards | Source normalization/analytics and evidence resolution: PRs 05–09; business policy: owning feature |
| Proposals | Full create proposal with complete GoalDraft; metadata/kind inventory for all kinds | Revision/state payloads and cards reject validation; PR 11 |
| `/api/status` | Public liveness/envelope validation; deployed behavior remains public liveness only | Authenticated status: PR 04 and later provider features |
| `/api/conversations` | Method/action/view inventory | Complete list/messages/create/archive/delete contracts: PR 09 |
| `/api/chat` | Complete documented send request; cancel discriminant | Cancel payload, run/idempotency behavior and working route: PR 09 |
| `/api/data` | Complete commit-import input; read/import/manual/correction/delete discriminants | Reads/manual: PR 05; mapping/preview/commit behavior: PR 06; correction/delete/export: PR 07 |
| `/api/goals`, `/api/approvals` | Goal discriminants and complete approve/reject input; no replacement approval payload | Goal endpoints, canonical hashing, optimistic versions, expiry and transactions: PR 11 |
| `/api/settings` | GET/PATCH inventory | Profile/preferences/consent payloads and auth: PR 04 |
| `/api/executions` | GET/default/payload/export inventory | Inspection contracts and persistence: PR 10 |
| `/api/account` | Export/delete action inventory | Full lifecycle contracts, recent reauth and confirmation: PR 16 |
| Pagination | Page-size representation limited to 1–200; opaque cursor shape | Query field conventions, authentic owner-bound cursor issuance: introducing endpoints |
| SSE | All ten events, matching event names, incremental UTF-8/LF/CRLF/multiline framing, 2 MiB unfinished-event bound | Sequence deduplication, reducer, durable terminal state and reconnection: PR 09 |

`validateOperation` returns `validated`, `invalid`, or `not_implemented` with the owning PR. An inventory entry is not a deployed endpoint. Existing unfinished routes still return JSON 404.

## Commands and observed results

| Command/check | Observed result |
|---|---|
| `npm install --package-lock-only --ignore-scripts --offline --no-fund --no-audit` | Passed with approved cache access. Promoted existing Zod; no network or lifecycle scripts. Removed unrelated npm-generated optional bundled metadata from the diff. |
| Checkpoint 1: focused contracts/SSE/foundation tests | 88 passed; typecheck and lint passed. |
| Checkpoint 2: provider and architecture tests | 57 passed; typecheck and lint passed. |
| Checkpoint 3: actual smoke CLI tests | 16 passed, including full live flags with switch true, false and malformed. |
| `npm run lint` | Passed. |
| `npm run typecheck` | Passed for client, server/API, and tools; also executed by production builds. |
| `npm test` after repairs | 175 passed across eight files. |
| `npm run build` | Passed; client and executable Node output produced. |
| `npm run test:bundle` after repairs | Passed: six public files; no secret canaries, source maps, selected catalog identities, or synthetic harness markers. |
| `npm run test:e2e` | 17 passed: five required viewports in light/dark, routing, keyboard/focus, disabled AI/storage, malformed liveness, headers and contrast. Forty synthetic screenshots generated locally. |
| `npm run test:providers` | Four synthetic role cases passed; live smokes `not_run`; actual provider requests 0; spend $0. |
| `npm run test:providers -- --mode=live --role=everyday` | Expected exit 1, `live_opt_in_required`. |
| `python docs/spec/v0.1.0/scripts/validate_spec_package.py` | 465 checks passed after documentation updates. |

Native build/test execution required approved elevation because the managed Windows sandbox blocks Vite process handling with `spawn EPERM` and npm's cache writes. No check was weakened to accommodate the sandbox. Final whitespace, inventory and source review checks accompany the PR commit.

## Actual interface proof

The smoke CLI returns `mode=synthetic`, four passed synthetic rows, three `unavailable` generation roles, one `disabled` decision role, `actualProviderRequests=0`, and `inferenceSpendUSD="0"`. Each generation fixture makes exactly two synthetic transport invocations for the read-tool continuation; decision makes one synthetic score invocation. These counts are not paid model requests.

Real requests against the compiled Node API on an ephemeral loopback listener returned:

| Request | Inspected result |
|---|---|
| `GET /api/status` | 200; `{"data":{"status":"ok"},"request_id":"<UUID>"}` |
| `POST /api/chat` | 404; safe error with `code=not_found` and `retryable=false` |
| `GET /api/unknown` | 404; safe error with `code=not_found` and `retryable=false` |

All three responses included `Cache-Control: no-store`. The listener closed in `finally`. Built-preview tests additionally exercise the local proxy, direct navigation and production CSP. Mobile-light Settings and desktop-dark Ask screenshots were visually inspected; screenshot/report output remains in ignored test directories because this PR changes no visual design.

## Failures and repairs retained

| Reproduced failure | Repair and subsequent evidence |
|---|---|
| Ten viewport/theme checks received a `script-src` CSP violation from Zod's caught evaluation probe | Set `jitless: true` before shared schema construction. The unchanged production CSP checks and all 17 browser tests pass. |
| Five invalid tool histories parsed successfully: wrong ID/name, unmatched result, unresolved call, repeated result | Validate call/result pairing and single consumption in the generation request schema; the same counterexamples reject. |
| Two adapters accepted historical tool turns despite disabled tool capability when no current tool definitions were offered | Check historical tool turns as well as offered tools before invoking transport. Both tests now reject with zero transport calls. |
| Blank original numeric text, negative mass target/baseline and out-of-representation percentage range parsed successfully | Reject blank originals and apply hard metric representation constraints to target/baseline values. All four regression cases pass; unusual representable values remain accepted. |
| Initial lint/typecheck issues in newly added tests and smoke CLI | Fixed unused test binding, CLI argument test shape and local type inference; final lint/typecheck pass. |
| Browser rerun could not bind ports after the failed CSP run left preview children | Inspected exact process command lines and creation times, stopped only task-owned preview listeners, then reran successfully. |

## Public provider documentation review

Reviewed 2026-10-24 using public primary sources. This is documentation evidence, not authenticated capability or a verified billable price snapshot.

| Source | Relevant observation and consequence |
|---|---|
| [OpenRouter Responses](https://openrouter.ai/docs/api_reference/responses/overview) | Stateless requests require supplied history; provider-held conversation state is not the persistence strategy. |
| [OpenRouter ZDR](https://openrouter.ai/docs/guides/features/zdr) | `provider.zdr: true` constrains routing; endpoint eligibility still requires account/runtime verification. |
| [Luna model page](https://openrouter.ai/openai/gpt-6-luna) | Selected identifier is publicly listed; account access and complete applicable billing remain unverified. |
| [Flash guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-3-8-flash) | Documents the selected identifier, LOW/MEDIUM/HIGH thinking, rejection of MINIMAL, and strict function-response matching. |
| [Argon guide](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/guides/gemini-4-argon) | Documents GenerateContent and thinking controls; automatic long-decode continuations must not be assumed safe. |
| [Decision model](https://openrouter.ai/microsoft/microsoft-decision-1), [Decisions API reference](https://openrouter.ai/docs/client-sdks/python/sdks/decisions/README) | Structured scoring is separate from generation; the reference's Python examples do not add a Python runtime. Vendor-specific result/range mapping remains PR 14. |

The catalog preserves the approved model identities and default limits. It encodes declared capabilities only. No provider SDK, credential discovery, live wire parser, paid request, model substitution, or privacy relaxation occurred. See the [generated smoke report](PROVIDER_SMOKE_TESTS.md) for current synthetic results and live blockers.

## Split-axis self-review and acceptance

The host reviewed the complete source, callers, tests, configuration and diff separately against both Remora axes. This is self-review, not independent reviewer certification.

- **Axis 1, specification fulfillment: Approved for PR 02.** The approved payload boundary is explicit, all SSE variants and provider ports are covered, real CLI/HTTP/browser artifacts were inspected, and future workflows remain unavailable.
- **Axis 2, engineering/security/maintainability: Approved with observations.** Demonstrated defects above were reproduced and repaired. No remaining demonstrated blocker. The production JS chunk is approximately 766 kB minified / 231 kB gzip and retains Vite's advisory size warning; no measured performance gate is claimed or speculative optimization added.

MOD-05 is verified for introduced boundaries, including local provider implementation/test-harness imports. SEC-04 and local SEC-08 remain verified; offline interfaces advance MOD-01–03 and COST-01/COST-03 without closing their future full-workflow gates. Ownership/RLS, persistent accounting, exact encrypted traces, real model behavior, deployed routing, physical keyboard and assistive-technology use remain unverified.

Milestone 0's cumulative local gates pass. PR 02 remains locally verified pending review/integration; PR 03 starts only after M0 acceptance. No failed live gate has been represented as passed. Live services: public documentation reads only; no deployments or model requests. Maximum/actual inference spend: **$0/$0**. Approved deviations: none.

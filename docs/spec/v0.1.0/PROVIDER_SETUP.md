# Provider and model integration notes

**Documentation checked: 2026-10-19. No authenticated model calls were made while preparing this package.** Published identifiers are not proof of the owner's account access. Recheck capabilities, exact rates and privacy-compatible endpoints during Milestone 0.

## 1. Selected role mapping

| Role | Identifier to test | Provider/API family | Reference |
|---|---|---|---|
| Everyday | `openai/gpt-6-luna` | OpenRouter Responses | [S08](SOURCES.md#s08) |
| Intermediate | `gemini-3.8-flash` | Vertex/Google Cloud GenerateContent | [S10](SOURCES.md#s10) |
| Advanced | `gemini-4-argon` | Vertex/Google Cloud GenerateContent | [S11](SOURCES.md#s11) |
| Decision | `microsoft/microsoft-decision-1` | OpenRouter Alpha Decisions | [S13](SOURCES.md#s13) |

Preserve these product selections. An unavailable model becomes a visible configuration issue; do not silently substitute a different model or switch Vertex to AI Studio. Google documentation may use updated platform naming; bind the implementation to the documented Google Cloud project/endpoint, not a marketing label.

## 2. Luna: Responses rather than a universal chat adapter

OpenAI's model page documents that Luna tool calling on Chat Completions has a reasoning-effort restriction. Use the OpenRouter Responses route for the intended reasoning-plus-tools integration and verify the actual routed endpoint. [S09](SOURCES.md#s09)

OpenRouter's Responses API is stateless: send the needed history on each request; `store: true` and a non-null previous-response ID are not an acceptable persistence strategy. [S15](SOURCES.md#s15)

Use a server key and a privacy-compatible route. Add documented `provider.zdr: true` preferences and do not relax them on failure. Retain necessary function call/result identifiers and opaque provider continuation items in Vulpes's private state. Suppress unneeded external plugins/tools. Verify streaming final usage, structured tool calls and cancellation before enabling live users.

The Responses wire mapper/parser implements `GenerationAdapter` behind the execution dispatcher. It supplies complete stateless input, `store:false`, required ZDR, empty external plugins, catalog output/effort limits and sequential tools. Its continuation blocks retain provider output items at their logical turn positions, including opaque reasoning items; these are never displayed as reasoning. Malformed/truncated streams fail without retry, and absent terminal usage retains the reservation. The inspector distinguishes requested settings from provider-reported model/effort.

Public [Responses](https://openrouter.ai/docs/api_reference/responses/overview), [tool-calling](https://openrouter.ai/docs/api_reference/responses/tool-calling) and [ZDR](https://openrouter.ai/docs/guides/features/zdr) evidence was rechecked on 2026-10-27. Everyday has a conservative typed price snapshot and matching public capability evidence. The verification-only fixed-endpoint transport requires explicit spend opt-in, a dedicated local synthetic batch, consent, encryption and account/application reservations. Its CLI also requires `--attempt-id=<UUID>`; repeating an attempt cannot dispatch again. It uses the same dispatcher and ledger as Ask. The [M3 re-verification](../../evidence/m3-live-reverification.md) demonstrates a completed Azure-routed tool loop, exact HTTP/browser inspection and reload, normalized usage, and guarded cancellation/disconnect. The original failed attempt and a notation-only verifier false negative are preserved in that evidence. Production inference remains unavailable; verification does not install the separate production approval/smoke binding. The synthetic browser composition remains a separate local test executable.

OpenRouter's current policy also describes in-flight CSAM screening, including ZDR traffic, with possible flagged-content retention for review and legal preservation. Per-request ZDR filters eligible inference endpoints; it does not override OpenRouter account logging or data-use opt-ins, cover external plugins, or prove provider-internal handling. Inspect those settings before a separately authorized batch and transmit only synthetic records during verification.

## 3. Flash and Argon: provider-specific controls

The selected Google models document Low/Medium/High thinking levels; their control conventions differ from a generic numeric thinking budget. In particular, do not send `MINIMAL` or blindly copy temperature/top-p/penalty controls from an OpenAI adapter. [S10](SOURCES.md#s10) [S11](SOURCES.md#s11)

Use Google Cloud authentication, an operator-supplied project and an explicitly selected supported location. `global` is a candidate documented location, not a promise of US-only processing. Confirm model access, quotas and billing in that project.

For the initial adapter, use bounded GenerateContent calls with explicit `maxOutputTokens`, validated JSON tools and a known stream parser. Preserve required thought signatures/opaque call-continuation fields when returning tool results. Log the observable fields, not an invented internal chain of thought.

Disable/avoid automatic long-decode continuations. Each actual request would need independent cost reservation and logging; the MVP does not need million-token outputs. Smoke-test the configured small output cap rather than assuming an SDK default will honor Vulpes's budget.

Argon's current model page documents implicit-only caching and a minimum context size for cache eligibility; explicit context-cache APIs are not a universal optimization for this model. It also documents durable caching behavior. Review that setting with the accepted Google data policy, and never pad personal context solely to obtain a cache hit. [S12](SOURCES.md#s12)

The PR 13 adapter uses direct bounded REST streaming and retains signed model parts in encrypted continuation state. GoogleAuth supplies ADC/external-account WIF tokens only after verification gates. No Google approval, price snapshot, capability evidence or production composition is installed. Project/location are explicit operator inputs; Argon remains excluded from chat routing even after a smoke pass.

For a separately authorized synthetic batch, the guarded CLI accepts `--role=intermediate` or `--role=advanced` with `--mode=live --allow-spend --max-cost-usd=<approved-batch-cap> --attempt-id=<UUID> --write-report` and the existing persistent `VULPES_SMOKE_BATCH_ID`. Current null rates/evidence block before credential discovery. Cancellation/disconnect use the same allocation and explicit attempt IDs. Do not replenish a batch or reset it while costs are uncertain. Missing Vertex cache-write billing information remains unknown, retains its reservation and prevents a false successful cost-verification result.

## 4. Decision Engine is a different endpoint

Microsoft-Decision-1 returns scores over supplied choices rather than conversational text. OpenRouter exposes it through `/api/alpha/decisions`; do not pass it through a chat-completion SDK and expect a prose answer. [S13](SOURCES.md#s13)

Implement `DecisionAdapter.score({state, questions, policy})` separately from `GenerationAdapter.generate(...)`. Use documented typed choices, validate result keys and finite score ranges, preserve the raw response and map it to an internal routing result. The official SDK documentation exposes provider preferences, but runtime endpoint availability under enforced ZDR must still be tested. [S14](SOURCES.md#s14)

Keep it disabled by default. Once privacy-compatible smoke tests and routing evaluations pass, the operator may enable it. It cannot approve writes, judge clinical safety alone, authorize spending, or decide that another user's records may be accessed.

## 5. Credentials and environment policy

Root `.env.example` is the authoritative environment template. Keep credentials and deployment identities in environment variables, and model parameters in versioned code:

- **OpenRouter:** Server-only `OPENROUTER_API_KEY`. Set provider-compatible privacy constraints (`provider.zdr: true`) and disable optional prompt logging or external broadcast destinations.
- **Vertex / Google Cloud:** Authenticate locally via Google Application Default Credentials (`gcloud auth application-default login` or `GOOGLE_APPLICATION_CREDENTIALS`). In production on Vercel, prefer Workload Identity Federation (WIF) with Vercel OIDC tokens, binding pool/provider/service-account to the specific project. A service-account JSON key is an owner-approved fallback for prototyping only; never commit keys or expose them in client bundles. [S18](SOURCES.md#s18)
- **Supabase:** `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are browser-safe. `SUPABASE_SERVICE_ROLE_KEY` is required for private-payload, conversation and run transactions; it is highly privileged and strictly server-only.
- **Live AI switch:** `VULPES_LIVE_AI_ENABLED=false` is a fail-closed operator defense-in-depth gate. It does not replace consent, verified rates, or budget reservations.
- **No model environment overrides:** Do not add `VULPES_*_MODEL` variables or reasoning parameters to `.env`. Model configuration belongs in the typed server-side catalog.

Never place provider secrets in `VITE_` variables. No actual credentials belong in the repository, fixtures, inspector, build logs, or transcripts.

## 6. Server-side typed model catalog

Implement exactly one authoritative configuration module at `server/config/models.ts` (or equivalent). Define distinct types for each provider API family:

- **OpenRouter Responses generation (`everyday`):** Selected `openai/gpt-6-luna`, low default reasoning, output/context limits, streaming and tool capability checks, enforced ZDR routing.
- **Vertex GenerateContent (`intermediate`, `advanced`):** Selected `gemini-3.8-flash` (bounded handoff) and `gemini-4-argon` (backend verification only), catalog-owned thinking levels, tool/stream/cache configuration, location and privacy constraints.
- **OpenRouter Decisions (`decision`):** Selected `microsoft/microsoft-decision-1`, typed choices/scoring instead of a chat/reasoning model; off until evaluated.

Illustrative shape:

```ts
export const models = {
  everyday: {
    provider: 'openrouter', apiFamily: 'responses',
    modelId: 'openai/gpt-6-luna',
    reasoning: { effort: 'low' },
    maxOutputTokens: 3072, zdrRequired: true,
  },
  intermediate: {
    provider: 'vertex', apiFamily: 'generateContent',
    modelId: 'gemini-3.8-flash',
    thinking: { level: 'MEDIUM' }, maxOutputTokens: 8192,
  },
  advanced: {
    provider: 'vertex', apiFamily: 'generateContent',
    modelId: 'gemini-4-argon',
    thinking: { level: 'MEDIUM' }, maxOutputTokens: 12288,
  },
  decision: {
    provider: 'openrouter', apiFamily: 'decisions',
    modelId: 'microsoft/microsoft-decision-1',
    enabled: false,
  },
} as const;
```

The implementation must validate API model IDs, supported reasoning/thinking controls, privacy routing, context/output limits, and availability against live provider documentation before enabling paid requests. Do not infer a uniform effort parameter across providers. No silent model replacement.

**Avoid configuration drift:** Do not maintain a separately edited JSON runtime registry, per-role model environment variables, and TypeScript defaults simultaneously. The template at `config/model-registry.example.json` serves only as a design reference. Price fields in reference templates are unverified/null; **null means unverified, not free.** Live calls remain disabled until complete rates and conservative budget bounds are configured.

## 7. Smoke-test matrix to complete during build

| Test | Everyday | Intermediate | Advanced | Decision |
|---|---|---|---|---|
| Auth and actual identifier access | Required | Required when enabled | Required when enabled | Required before enabling |
| Privacy-compatible route | Required | Accepted Google policy | Accepted Google policy | Enforced ZDR test |
| Small bounded output/score | Required | Required | Required | Required |
| Streaming with terminal usage | Required | Required | Required | Not assumed; nonstream is fine |
| One read tool and continuation | Required | Required | Required | Not a generative tool loop |
| Requested effort is accepted/effective | Required | Required | Required | Not applicable |
| Exact request capture | Required | Required | Required | Required |
| Cost reservation/reconciliation | Required | Required | Required | Required |
| Failure/cancellation behavior | Required | Required | Required | Required |

All fixtures here use synthetic text. Do not use the owner's health measurements for initial provider debugging. Record tested versions, time, account region and limitations in a build-created `PROVIDER_SMOKE_TESTS.md`; do not fill it with fabricated PASS entries.

Current verification status, the public 2026-10-31 rate/capability refresh, fixed synthetic cases and owner key/privacy approval steps are owned by [the Luna verification procedure](../../operations/luna-verification.md). The bounded v7 synthetic checkpoint passed, with prior failures and uncertain interruption accounting retained in current evidence. This is separate from formal acceptance or production activation.

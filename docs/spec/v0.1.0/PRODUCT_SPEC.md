# Product specification

## 1. Promise

Vulpes turns a user's own health measurements and goals into useful, transparent conversation. The differentiator is interpretation and goal context, not another wall of metric tiles.

The smallest complete experience is:

**Sign in -> import measurements -> ask a question -> inspect the calculation -> draft a goal -> approve it -> see progress -> return later with the goal and conversation intact.**

A user can choose how much AI to use. Opening a dashboard, inspecting a goal, importing a file and calculating a trend must not cause model calls.

## 2. Users and access

The initial owner and later invited adults have independent accounts, measurements, goals, chats, preferences and spending allocations. Accounts do not share data, and an invitation grants no access to another account's records. A deployment operator provisions accounts outside the app; there is no in-app account-provisioning interface in v0.1.0.

Each account chooses a display unit system, IANA timezone and approved model providers. Onboarding explains that the app is a wellness prototype, not a diagnostic or emergency-monitoring service. Invited users also see the operator-access limitation.

## 3. Required v0.1.0 functionality

### 3.1 Ask Vulpes

Streaming text, persisted conversation history, new-conversation action, bounded server-side tools, visible working/cancelled/failed states and predefined result cards. Compact mobile navigation label is **Ask**, and the page heading is **Ask Vulpes**. Chat starts on Luna and can make one evidence-backed, server-authorized handoff to Flash. No model, depth or effort selector is exposed. Argon remains a backend capability excluded from chat routing. The selected route, effective model and cost state are inspectable.

No response is generated merely because the home screen opened. Empty-state suggested prompts are static. Opening an existing conversation retrieves history; it does not regenerate it. Editing, branching and automatic regeneration are deferred to avoid hidden history and repeated spend.

### 3.2 Data

Manual numeric entries and canonical CSV imports are required. A small column-mapping import flow supports timestamp plus one or more numeric columns with explicit unit/source mapping; it is not a promise to parse every vendor's export.

Show validation and duplicate counts before commit. Preserve original units, source labels, timestamps and estimation semantics. Provide a metric chart, date range, source selection, coverage and latest reading. The import source is the user's own selected profile; multi-person vendor exports must be filtered to one explicitly selected profile or rejected.

Supported starting metrics: weight, body-fat percentage, RENPHO visceral-fat index, heart rate, explicitly identified resting heart rate, height, daily steps and sleep duration. These are scalar observations or labelled daily/session summaries, not a complete exercise/sleep-event schema. Unknown metrics are not silently coerced.

### 3.3 Goals

Support `increase_to`, `decrease_to` and `maintain_range` for supported numeric metrics. Store source policy, target, units, baseline method, time horizon, constraints and state. A user-provided numeric target is a requested target, not a medically validated recommendation.

A proposed goal is not active until an explicit approval succeeds. Edits to targets, source policy, constraints, strategy or baseline create a proposed revision. Charts show actual observations and deterministic progress, not LLM-generated values. Sparse data produces a clear insufficient-data state.

Qualitative observations and proposed next steps can appear in chat. Full adaptive training plans, physiological forecasts and multi-goal optimization are not required in v0.1.0.

### 3.4 Inspector

Every paid inference has a run record and one step per provider request. The user can inspect effective instructions, included messages, structured personal data, tool results, selected role/model/effort, request body, route reason, timing, token categories and cost status. Retrieval sections explicitly show "Not used in this version" when RAG and web are unavailable.

Show excluded/truncated context with reasons, but never label reconstructed text as an exact old request. After payload expiry, show that the full trace expired and retain only permitted metadata. Cost unavailable is not cost zero.

### 3.5 Settings

Profile/timezone/units, approved providers, provider availability, per-user lower spending preference, remaining operator allocation, trace retention, data export and account deletion. API keys and operator spending ceilings are not editable by ordinary invited users. Settings changes are explicit user actions, not model-generated writes.

## 4. Evidence and health boundary

For this release the evidence base is the user's permitted stored data, deterministic tools and the model's general background knowledge. A claim about a personal trend must link to its data/tool result. General wellness information is labelled as such; it is not labelled as a fresh literature review.

The agent does not diagnose, prescribe, adjust medication or convert a proprietary scale index into a clinical quantity. It does not automatically lower body-fat targets, infer visceral fat from weight/body fat, interpret all heart-rate samples as resting heart rate, or declare muscle gain from a consumer-scale estimate.

For potentially harmful goals, acute symptoms or requests that need medical judgment, use a conservative response and appropriate professional/emergency guidance rather than simply routing to a more expensive model. This is a product guardrail, not evidence that the application is medically validated.

## 5. Connected data: confirmed versus expected

The supplied setup screenshots demonstrated RENPHO weight and body-fat records and Samsung Health heart-rate records in Health Connect. Activity and sleep permissions were shown, but successful transfer of those categories was not demonstrated here. No visceral-fat record or raw impedance was demonstrated through Health Connect.

These are observations from the owner's setup, not proof of compatibility across every phone, watch or invited account. v0.1.0 does not read those screenshots or that Health Connect store automatically.

## 6. Primary screens

`/ask`: conversational home and history (**Ask Vulpes**). `/goals`: goals list and detail. `/data`: imports, measurements and charts. `/settings`: account, AI, privacy and cost. Compact mobile navigation: **Ask | Goals | Data | Settings**. The execution inspector opens from a message as a mobile full-screen panel or desktop drawer; it is not a fifth main tab.

## 7. Release definition

v0.1.0 is complete only when the applicable required tests in [ACCEPTANCE_TESTS.md](ACCEPTANCE_TESTS.md) pass with real persistence and at least one live generation provider. All selected configured generation roles must have live smoke-test results before the release is described as supporting that role. A disabled optional decision engine is acceptable; a fabricated live success is not.

The initial personal pilot may precede the invited pilot. Do not market the first pilot as production-grade, medically validated or suitable for unattended health monitoring.

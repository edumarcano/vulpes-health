# Roadmap and extension boundaries

## v0.1.0 - Usable AI-first PWA

CSV/manual data, deterministic analysis, private accounts, chat, numeric goals with approvals, selected model adapters, cost controls and inspectable execution. No native phone-health sync, research crawler or automatic long-term memory.

## v0.2 - Android Health Connect integration

Package the same React application with Capacitor. Add a small native Health Connect adapter; prefer a maintained integration only after confirming supported record types, licensing, permission handling and update/deletion behavior. Do not assume a plugin name or implement a raw Bluetooth driver by accident.

Data path:

`Scale/watch -> RENPHO/Samsung Health -> Health Connect on that phone -> Vulpes native bridge -> authenticated Vulpes ingest -> owned Supabase records -> PWA/agent`.

Start with foreground, user-initiated sync and verified weight/body-fat/heart-rate records. Add background behavior only with feature checks, the relevant permission and realistic Android execution constraints. History access and background access have separate rules; a newly granted permission does not guarantee that every source app populated its old history. [S06](SOURCES.md#s06)

Required sync behavior:

- Bind an installation and active session to one Vulpes account; stop and clear/rebind local sync state on logout/account switch.
- Obtain a changes token before the initial paginated import, then reconcile changes so writes during initial sync are not missed.
- Persist source app, device/installation identity where available, Health Connect record ID, version/modified time, units and timestamps.
- Use idempotent upserts and acknowledge a batch only after server commit; advance the cursor only after successful ingestion.
- Process updates and deletion events, revoked permissions, token expiration, retries and a bounded resync.
- Keep separate cursor/error status per relevant type so one revoked permission does not masquerade as a complete successful sync.
- Treat upload failures as pending, not imported. Display last attempted, last successful and record counts separately.

The official synchronization guidance discusses changes, deletions and token management. [S23](SOURCES.md#s23) The exact retry/resync implementation must be tested on the actual Android build.

Do not sum overlapping step totals from Samsung/phone/other sources. Design interval/event tables for sleep sessions and exercise before claiming full workout or sleep-stage support. Generic observed heart rate is not resting heart rate or HRV.

Initially read from Health Connect only; do not write data back or create a synchronization loop. A desktop PWA sees already uploaded data; it does not reach into an Android phone remotely. iPhone users can use the PWA with imports, but Apple Health/HealthKit would require a separate future native integration; Android Health Connect does not provide it.

## v0.3 and subsequent increments - Evidence and memory

Add one feature at a time after the primary workflow is useful:

**Curated evidence:** small versioned library, reliable citations, source date/applicability, full passage provenance. No LLM-created bibliography accepted as evidence.

**Reference uploads:** private files, format limits, malware/content handling, text extraction with page references, user-selected goal/module scope and injection resistance. Separate user health records from reference articles. An upload does not become authoritative solely because the user uploaded it.

**Sparse memory:** candidate detection from existing conversation work, novelty checks, source-linked add/update/delete, explicit versus inferred labels, approvals for sensitive content, expiry and consolidation. No separate call after every message; measurements remain in the health database.

**Research on demand:** external search under explicit consent and budget; sanitized queries, allowlisted fetch controls, stored actually read evidence, quality/applicability checks and clearly labelled conflicting findings. No arbitrary private-network fetches or credentials in queries.

## Later optional intelligence

Proactive goal discovery, scheduled reviews, notifications, statistical personalization, richer workout/nutrition data, explicit household sharing and advanced desktop analytics. These require separate acceptance criteria, cost/permission policy and, for background work, a durable execution mechanism.

The user controls which modules run. Turning a module off stops its scheduled processing; it does not silently destroy goals or history. Shared underlying calculations can be reused without duplicate inference.

## v1.0 - Reliability milestone, not every imagined feature

Dependable Android synchronization, stable goal/chat flow, tested ownership isolation, data export/deletion/backup, budget controls, evidence honesty and a polished mobile experience. Do not equate v1.0 with diagnosis, professional clinical use or every future AI module.

## Raw scale data: explicitly outside planned v1.0

Direct BLE access is a future experiment only. Revisit after identifying the exact hardware/revision, proving what it actually transmits, and demonstrating benefit beyond existing measurements. Raw impedance availability must be observed, not assumed from a marketing model label.

No commitment to developing proprietary body-composition formulas. If a future raw stream is captured, retain raw values, units, protocol/version and calibration provenance separately from calculated estimates. A better AI language model alone does not validate a new body-composition algorithm.

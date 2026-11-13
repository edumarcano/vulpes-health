# Vulpes v0.2.0 Specification

**Release theme:** Body-composition history and analysis with RENPHO Health CSV compatibility

**Status:** Draft for implementation planning  
**Specification date:** 2026-11-11  
**Repository baseline reviewed:** `585fd614ccd7c5592d7486c40895526124a6c658`  
**Suggested repository location:** `docs/spec/v0.2.0/SPEC.md`

## Navigation

| Product and data | Interaction and AI | Delivery |
|---|---|---|
| [Scope](#2-release-scope) and [baseline](#3-inspected-baseline-and-implications) | [Share-to-import](#7-android-share-to-import) | [Architecture](#14-architecture-and-service-contracts) |
| [CSV ingestion](#5-csv-ingestion-contract) | [Goals](#10-goals-and-simple-combinations) and [AI tools](#11-ai-behavior-and-tool-boundary) | [Security and operations](#15-security-privacy-and-operations) |
| [Metric catalog](#6-metric-catalog-and-data-semantics) | [Model comparison](#12-focused-model-comparison-and-routing-decision) | [Clean-break policy](#16-compatibility-and-clean-break-policy) |
| [Analytics](#8-deterministic-analytics) and [references](#9-metric-guidance-and-manufacturer-references) | [User interface](#13-user-interface) | [Acceptance](#17-acceptance-and-verification), [milestones](#18-implementation-sequence), and [release](#19-release-definition-and-handoff) |

## 1. Purpose and authority

Vulpes helps users understand their body-composition history through an independent application with reliable RENPHO Health CSV imports, deterministic analysis, persistent goals, and an AI conversation interface.

The release succeeds when a user can export a CSV from RENPHO, share it to an installed Vulpes PWA or select it in Vulpes, review and import the new measurements, and ask useful questions without repeatedly supplying the same history or definitions.

This is a product and engineering specification, not an implementation report. Requirements below describe intended v0.2.0 behavior. The repository observations in Section 3 describe the inspected baseline; they do not establish that the new behavior exists or that runtime tests have passed.

### 1.1 Reading the requirements

- **MUST** identifies a release requirement.
- **SHOULD** identifies the preferred implementation; a different choice needs a documented reason and equivalent acceptance coverage.
- **MAY** identifies an option, not additional required scope.
- Numeric engineering defaults in this document are product limits, not clinical thresholds or provider entitlements. Changing them requires an explicit decision, updated tests, and documentation.

This document supersedes conflicting v0.1.0 requirements for release scope, RENPHO handling, legacy-data compatibility, and model-selection strategy. Unchanged security, ownership, consent, accounting, and execution-transparency requirements remain in force. Historical specifications and evidence MUST NOT be rewritten to imply that old builds satisfied new requirements.

Follow repository `AGENTS.md` and applicable engineering guidance. Before implementation, compare the current revision with the baseline above and record any material differences. Do not turn this reconciliation into a separate open-ended audit. [^R01]

### 1.2 Product principles

1. **Understand RENPHO well before expanding to general health aggregation.**
2. **Use code for numbers and the model for explanation.** Importing, validation, charts, reference classification, and goal progress must work with AI disabled.
3. **Preserve meaning, not just values.** Units, original readings, source, measurement time, estimate status, and limitations travel with the data.
4. **Keep recurring use short.** Recognized exports should not require repeated column mapping or manual history merging.
5. **Keep user control explicit.** Sharing is not approval to import; importing is not approval to transmit data to a model; a proposed goal is not an active goal.
6. **Prefer the smallest complete solution.** Reuse working services; allow justified breaking changes without requiring a rewrite.

## 2. Release scope

### 2.1 Required

| Area | v0.2.0 outcome |
|---|---|
| Import | First-class RENPHO CSV recognition, complete supported-field handling, useful preview, safe overlapping-history imports, and recoverable failures. |
| Mobile workflow | Receive a CSV from Android's share sheet in a verified installed-PWA/browser combination; retain a normal file-picker route. |
| Data | Preserve individual weigh-ins, all supported numeric series, and applicable vendor annotations. |
| Analysis | Accurate snapshots, selected-period summaries, comparisons, coverage, and source-linked results. |
| Metric guidance | Versioned definitions and limitations; verified manufacturer reference ranges where applicable; explicit unavailable states elsewhere. |
| Goals | User-defined goals across supported numeric metrics and simple groups of related goals. |
| AI | Existing conversational experience extended to the complete supported dataset and goal workflow. |
| Evaluation | A bounded comparison of the current everyday model with similar-tier alternatives, plus a documented decision on reasoning effort and escalation. |
| Reliability | Updated isolation, privacy, accounting, export/deletion, PWA, and reset/reprovisioning tests. |

### 2.2 Explicitly deferred

Health Connect, HealthKit, native application packaging, direct Bluetooth access, RENPHO account scraping or cloud-credential integrations, automatic device synchronization, MCP or other external-agent endpoints, a general-purpose health-data platform, public account-registration or invitation features, proactive coaching, scheduled AI reviews, notifications, voice, web research, document retrieval, automatic long-term conversational memory, advanced training or nutrition planning, forecasting, custom physiological scores, and sophisticated multi-objective optimization are not release requirements.

The full VulpesBench platform described in Issue #35 is also deferred: no model marketplace, searchable provider catalog, custom benchmarking dashboard, separate benchmark service, or automatic paid benchmarking. [^R08]

Do not remove useful existing manual-entry or canonical CSV functionality simply to make the application RENPHO-focused. Retain it where inexpensive, but do not expand generic vendor support or create compatibility layers solely for old clients.

### 2.3 Release boundary

This remains a wellness application, not a diagnostic, treatment, or emergency-monitoring product. Narrowing the feature set does not weaken tenant isolation, consent, safety, or spending controls. A publicly readable repository does not imply that public signup or a broadly validated clinical service is available.

## 3. Inspected baseline and implications

| Area | Observed implementation or documentation | Planning implication |
|---|---|---|
| RENPHO recognition | `shared/imports.ts` lists 30 named columns and requires an additional empty terminal column. `server/services/csv.ts` imports only weight and body-fat percentage in its RENPHO path. [^R02] | Expand the domain end to end and replace brittle layout assumptions with a versioned CSV adapter. |
| Import capacity | Current constants allow 1 MiB CSV input and 5,000 normalized observations; the parser separately checks a 10,000-row limit. [^R02] | Size limits must account for many metrics per weigh-in, not only file rows. |
| Analytics | `server/analytics/summary.ts` uses exact decimal arithmetic, daily medians, and a seven-day headline statistic, with at least three observed days for that statistic. Its chart interval and headline interval can differ. [^R03] | Preserve exact calculations; make each statistic's actual interval explicit and add genuine selected-period summaries. |
| Goals | `shared/goals.ts` defines single-metric targets, frozen baselines, proposed revisions, and explicit state transitions. [^R04] | Extend this model rather than building a second goal engine. |
| Agent | The AI specification provides a bounded tool loop, server-side read/proposal tools, budget admission, and an inspector. It describes an optional handoff. [^R05] | Expand tools without turning the agent into an orchestration project. |
| Provider readiness | Current project guidance and release-readiness documentation distinguish everyday-model technical evidence from answer-quality benchmarking and keep optional roles unavailable. [^R01] [^R09] | Do not equate configured models, adapter code, or technical smoke tests with release-ready model quality. |
| PWA | `scripts/pwa.ts` handles public static assets and selected GET navigations, not incoming file-share POSTs. [^R06] | Share receiving needs an explicit implementation and privacy design. |
| Evaluations | `scripts/evaluate-everyday.ts` explicitly tests controls and scripted tool behavior, not a real model's answer quality. [^R07] | Keep deterministic tests and add a small live comparison; report them separately. |

This is a targeted review, not a claim that every source file or deployed behavior was audited. During planning, inspect related services, executable schemas, database functions, UI components, and tests before changing their contracts.

## 4. Primary user experience

### 4.1 First import

**Export CSV in RENPHO -> Share to Vulpes or select file -> Confirm source/profile and timezone -> Review preview -> Confirm import -> View results or ask a question.**

The initial setup MUST explain that one Vulpes data source represents one person's export history from a particular source context. A filename is not proof of identity or profile ownership.

Remember the confirmed source mapping and timezone for subsequent imports. Display those choices in later previews and make them editable. Reconfirm when a recognized layout, source context, or timezone assumption changes materially.

### 4.2 Recurring import

For a recognized, valid file and an authenticated user with saved import settings:

**Share/select -> Compact preview -> Confirm.**

The preview shows the date span, number of weigh-ins, numeric observations, new data, duplicates, conflicts, missing values, and any unsupported columns. Distinguish weigh-in counts from metric-observation counts.

An identical reimport ends with an informative no-op result, not an error. After success, the user can open Data, inspect goals, or select an optional suggested question. No paid inference occurs automatically.

### 4.3 Conversation

Users can ask about the latest weigh-in, change over a specified period, several body-composition metrics together, manufacturer classifications, and approved goal progress. Follow-ups such as "What about the previous month?" retain the relevant context without relying on hidden autonomous memory.

The conversation distinguishes recorded values, calculated results, and qualified interpretations. Evidence opens the corresponding Vulpes result, including its period, method, source, and limitations.

## 5. CSV ingestion contract

### 5.1 Recognition and supported layout

**IMP-01.** The original RENPHO CSV is the primary import format. The first adapter targets the English header family already represented in `RENPHO_COLUMNS`. Column order MAY vary. The baseline date/time syntax is `YYYY.MM.DD` and `HH:mm:ss`. That syntax and any supported aliases MUST be captured in versioned synthetic fixtures. Do not claim support for every RENPHO application version or locale.

**IMP-02.** Accept UTF-8 with or without a BOM, standard quoted CSV fields, supported line endings, and the recognized layout both with and without a single empty terminal column. That terminal column may be discarded only when its header and every value are empty. Preserve valid quoted commas and line breaks in annotations.

**IMP-03.** Resolve columns by an explicit alias table, never by position or an LLM. Duplicate headers, conflicting aliases for the same field, inconsistent row widths, malformed quoting, unsupported encodings, and ambiguous dates MUST receive actionable errors. Do not repair ambiguous data silently.

**IMP-04.** Require `Date`, `Time`, and a usable `Weight` column for the RENPHO adapter. Other supported fields may be absent or unavailable without rejecting an otherwise valid weigh-in. Recognize documented mass-unit variants explicitly; missing or ambiguous units require confirmation or rejection, not inference from value magnitude.

**IMP-05.** Empty cells and the documented `--` marker are unavailable, never zero. Distinguish absent columns, unavailable cells, invalid values, and intentionally excluded data. Preserve zero when it is valid for that field. Preserve signed vendor target deltas.

**IMP-06.** Unknown columns MUST be listed in the preview. Nonempty unknown data must not disappear silently: import requires an explicit acknowledgement that those columns are not supported. Do not turn arbitrary numeric columns into new metrics. Unknown optional fields do not justify a generic expression/query system.

**IMP-07.** A file containing multiple people MUST NOT be combined into one person's history. Support only an explicitly selected profile where the format supplies an unambiguous discriminator; otherwise reject it. For a format without profile metadata, obtain an initial single-profile confirmation and retain that assumption visibly. Do not infer a person from weight, names, or filename text.

### 5.2 Values and time

**IMP-08.** Parse numbers as decimals, retain the source value and unit, and convert through the shared unit layer. Do not execute formulas, interpret text as code, or ask a model to repair records. Validation bounds describe representable values, not healthy ranges.

**IMP-09.** Interpret a timestamp without an offset using the confirmed IANA import timezone. Preserve the source local date/time and resolved instant. Use strict calendar parsing. Ambiguous or nonexistent daylight-saving times require an explicit supported resolution or exclusion; do not pick an offset silently.

**IMP-10.** Saved timezone preferences are defaults, not retroactive edits. Changing a display timezone must not reassign already imported instants. Imports taken across different timezone contexts require a deliberate mapping choice; a global profile setting is not proof of where a historical reading occurred.

### 5.3 Identity, overlap, and correction

**IMP-11.** Treat one source row as a weigh-in event with multiple observations and annotations. `No.` and row order are import provenance only, not stable measurement identifiers. A new export date span may renumber rows.

**IMP-12.** Match repeated data within the authenticated account and selected source context. The adapter must define and test its canonical identity/equality rules using the source timestamp and supported values. Filename and raw-file hash may assist detection but MUST NOT be the only deduplication mechanism.

- Same logical reading and equivalent canonical value: duplicate; do not insert again.
- Same event with an additional previously unavailable metric: safe enrichment, shown in the preview.
- Same event/metric with a changed value or incompatible timestamp interpretation: conflict; do not overwrite silently.
- Different timestamps: distinct readings, even when close together or numerically identical.
- Indistinguishable same-time records with incompatible values: report ambiguity; do not invent event identities or silently average them.

Rounding differences between unit variants are not authorization for fuzzy merging. Only documented normalization equivalence is automatic; unresolved differences remain conflicts. Missing values in a later export never delete previously imported observations.

**IMP-13.** Preserve legitimate repeat weigh-ins. Do not use a rule such as "readings within an hour are one measurement." Aggregation for charts is separate from import identity.

**IMP-14.** The ordinary import path does not replace or delete existing measurements. Conflicts can be excluded after explicit review and resolved through the existing correction workflow. Corrections retain provenance and invalidate affected analytics, goal progress, and private evidence under the deletion/correction policy.

### 5.4 Preview, commit, and capacity

**IMP-15.** Parse and validate before commit. A preview binds to the authenticated owner, source, mapping, normalized content, and data revision. Show row/column errors without leaking data to operational logs. If invalid entries are excluded, the user must explicitly acknowledge the exclusions and the preview must accurately describe the retained data. An invalid or unresolved event timestamp excludes the whole row; invalid metric cells may be excluded individually after review. Do not create orphan observations or empty committed events.

**IMP-16.** Confirmation commits exactly the reviewed content. Use idempotency and server-side authorization; retries after a timeout must return the committed result or a truthful pending/failure state, never duplicate records. A stale preview requires revalidation and another review when the outcome changes.

**IMP-17.** Imports are logically atomic: committed history does not expose a partially completed batch. Internal chunking is permitted, but incomplete staging stays invisible to charts, goals, and AI. Cancellation before commit creates no measurements. After an uncertain response, determine commit status before retrying or promising cancellation.

**IMP-18.** Initial application limits: 1 MiB decoded CSV input, 10,000 source rows, and 25,000 normalized numeric observations per import. The smallest limit reached controls acceptance. Validate input, decoded content, annotations, normalized staging, and request sizes independently.

The implementation MUST demonstrate a single user import of at least 1,000 synthetic weigh-ins with all 24 supported numeric columns populated. Avoid repeating complete mapping metadata inside every observation. Use compact staging or bounded internal batching if necessary; do not require users to manually split an ordinary history merely because the old 5,000-observation implementation limit was retained.

Review actual hosting and database payload/time limits during implementation. A limit change needs measurements and a documented decision; do not simply raise all limits. Provide a clear message when a file exceeds the supported envelope. Capacity tests must include files just below and just above each limit.

**IMP-19.** File selection, sharing, preview, deduplication, import, and post-import navigation make zero model calls.

## 6. Metric catalog and data semantics

### 6.1 Required numeric coverage

The following table defines coverage, not mandatory internal identifier spellings. Existing identifiers should be reused where appropriate; changed identifiers must be updated consistently across SQL, executable schemas, analytics, tools, UI, and tests. Headers describe the currently inspected family; verified unit aliases belong in the adapter. [^R02]

| Export field | Canonical representation | Required treatment |
|---|---|---|
| `Weight(lb)` | Mass, kg | Source-reported weight. |
| `BMI` | Ratio/index, kg/m2 | Vendor-reported calculated value; not a direct sensor measurement. |
| `Body Fat Percentage(%)` | Percentage, 0-100 scale | Vendor body-composition estimate. |
| `Body Fat Mass(lb)` | Mass, kg | Preserve separately from percentage. |
| `Muscle Percentage(%)` | Percentage | Preserve vendor muscle definition. |
| `Muscle Mass(lb)` | Mass, kg | Do not rename to skeletal muscle mass. |
| `Skeletal Muscle Percentage(%)` | Percentage | Separate from total muscle percentage. |
| `Skeletal Muscle Mass(lb)` | Mass, kg | Separate from total muscle mass. |
| `Bone Percentage(%)` | Percentage | Vendor estimate; not bone density. |
| `Bone Mass(lb)` | Mass, kg | Vendor estimate; not bone mineral density. |
| `Protein Percentage(%)` | Percentage | Body-composition estimate; not dietary protein intake. |
| `Protein Mass(lb)` | Mass, kg | Preserve separately from percentage and dietary quantities. |
| `Body Water Percentage(%)` | Percentage | Vendor estimate. |
| `Body Water Mass(lb)` | Mass, kg | Preserve separately from percentage. |
| `Fat-Free Mass(lb)` | Mass, kg | Do not equate with muscle mass. |
| `Subcutaneous Fat(%)` | Percentage | Vendor estimate with source-specific meaning. |
| `Visceral Fat` | Source-specific index | No conversion to a clinical quantity. |
| `BMR(kcal)` | Documented basal-energy estimate | Preserve raw unit; expose a daily rate only after verifying the source definition. Not total energy expenditure or an intake prescription. |
| `Metabolic Age` | Vendor age-like estimate, years | Not chronological age or a diagnosis. |

All 19 fields are first-class numeric series when populated. Missing columns or cells remain missing. Do not require a complete composition panel to accept a weight-only weigh-in.

### 6.2 Optional fields in the supported header family

| Field | Handling |
|---|---|
| `WHR (Waist-to-Hip Ratio)` | Numeric ratio when populated and validated; preserve source provenance. Do not infer waist or hip measurements. |
| `Optimal Weight(lb)` | Numeric manufacturer reference value, not an automatically endorsed goal. |
| `Target to optimal weight(lb)` | Signed numeric manufacturer target delta. |
| `Target to optimal muscle mass(lb)` | Signed numeric manufacturer target delta. |
| `Target to optimal fat mass(lb)` | Signed numeric manufacturer target delta. |
| `Weight Level`, `Body Type` | Source-provided categorical annotations; retain original text rather than inventing a numeric scale. |
| `Remarks` | Bounded private plain text, associated with the weigh-in and treated as untrusted input. |
| `No.` | Original export row identifier for provenance only. |

The five optional numeric fields count toward the 24-column numeric capacity test. Preserve populated values even when their interpretation is unavailable. A field with unverified semantic direction or units remains visibly unresolved and cannot silently become an analytical or goal operand until that mapping is resolved.

### 6.3 Registry and preservation

**MET-01.** Use a small typed, versioned metric registry shared by import validation, analytics, goals, UI, and tool projections. It must describe identity, display name, units/conversions, valid representation, source/estimate status, formatting, grouping, applicable calculations, and semantic limitations. This is not a dynamic plugin marketplace.

Percentages use a 0-100 representation, not an implicit 0-1 fraction. Reject nonfinite numeric values. Weight and resolved BMI/WHR/basal-energy values must be positive; component masses, percentages, age-like values, and indices must be nonnegative within their representable domains. Vendor target deltas may be signed. Do not truncate decimal indices or age-like outputs to integers without a documented source rule. Cross-field implausibility is a visible quality concern, not permission to rewrite values.

**MET-02.** Retain original value/unit, canonical value/unit, event linkage, observed time, source local time, import timezone, source identity, adapter version, import provenance, quality flags, and revision. The physical schema is an implementation decision; the information and ownership requirements are not.

**MET-03.** Do not reconstruct missing manufacturer readings from other columns by default. Do not replace exported values with a Vulpes formula. Any explicitly supported derived result must have its own method/version and label, separate from the original observations.

**MET-04.** Do not describe multiple derived scale outputs as independent corroborating measurements. Do not add overlapping body components or assume they form a partition summing to 100%. A change in a vendor estimate does not, by itself, prove a physiological change.

**MET-05.** Original source annotations remain separate from Vulpes-generated classifications and user-approved goals. Distinguish "not exported," "unavailable," "unverified definition," and "invalid value" in user-facing explanations.

## 7. Android share-to-import

Installed PWAs can register as file share targets on supported platforms using a manifest `share_target`. Browser/platform support is not universal, so actual-device evidence is part of this release. This is different from using `navigator.share()` to send a file out of Vulpes. [^W01] [^W02]

**SHR-01.** Add a dedicated, in-scope share action using `POST`, `multipart/form-data`, and explicit accepted CSV MIME types/extensions. Verify the MIME type supplied by the target RENPHO application during device testing; do not infer support from an icon or filename alone. Do not register indiscriminately for all file types. [^W01] [^W03]

**SHR-02.** The share receiver MUST lead into the same import service, validation, preview, and confirmation path as the file picker. Receiving an operating-system share does not create a trusted source or bypass server checks.

**SHR-03.** Target one CSV per operation. Multiple files, text-only shares, missing attachments, empty multipart bodies, unsupported files, and oversized content receive clear errors. Never display "imported" when only a share notification or file name was received.

**SHR-04.** Prefer handling the incoming file in the service worker and handing it to a same-origin import page. The receiver is an ingestion handoff, not an anonymous database-write endpoint. If the worker is unavailable, the network route must fail safely without echoing, logging, or persisting the request body. Do not loosen authorization, CORS, or origin rules on the existing APIs globally.

**SHR-05.** A short-lived, browser-local handoff store MAY be used to survive navigation or sign-in. If used:

- Keep it separate from the public asset cache and from ordinary app health-data storage.
- Default maximum lifetime is 15 minutes; enforce expiry on every read. Physical cleanup happens on consumption, cancellation, logout, and subsequent activation/access; do not promise deletion at an exact time while the browser is closed.
- Use opaque, unguessable references and a single-consumer claim. Put no readings, filenames, authentication tokens, or source labels in URLs.
- Do not upload an unbound file before authentication and account confirmation. A draft bound to an account cannot transfer to another account during sign-out/sign-in or cross-tab activity.
- Clear bound pending data on logout/account switch. Explain an expired or cleared handoff and allow resharing.
- Minimize retained bytes and disclose temporary local storage. It is not end-to-end encrypted merely because it is browser-local.

This is a narrow exception to the earlier static-only PWA policy, not permission to cache health API responses or create an offline health database.

**SHR-06.** Offline or unavailable-backend states must distinguish a locally received file from a committed import. No automatic background upload or queued commit is required. An online retry still requires a valid preview and confirmation.

**SHR-07.** Preserve the file across the normal authenticated navigation/sign-in handoff when supported. Handle PWA updates, cold starts, multiple shares, tab races, and expired previews without cross-account leakage or unintended repeats.

**SHR-08.** Validate the complete installed-PWA workflow on at least one documented Android/browser configuration, including the actual RENPHO export route. Device evidence must be sanitized or use synthetic test data. Record application/browser versions and observed limitations, not private records.

A file-picker test alone does not satisfy this gate. On unsupported platforms, retain file selection and clear instructions; do not promise share-sheet integration. A platform blocker requires an explicit release-scope decision rather than silently deleting this requirement or introducing a native application.

## 8. Deterministic analytics

### 8.1 Required operations

**ANA-01.** Support latest-weigh-in inspection, latest available reading per metric, selected-period summaries, period-to-period comparisons, and goal progress. A latest-weigh-in view must not fill absent fields with older readings. A latest-per-metric overview may use different dates only when it displays those dates explicitly.

**ANA-02.** Preserve all source observations. For daily trend views, use the median of valid observations per metric, source, and local day. For observed-day means, average those daily medians with equal day weighting. A day with repeated weigh-ins must not dominate a period merely because it has more rows.

**ANA-03.** Give every result a precise operation name and interval. A selected-month summary describes that month; a seven-day rolling statistic describes its seven-day window. Never label the existing seven-day headline as the average of an arbitrary selected chart range. Return requested and effective windows separately where necessary.

**ANA-04.** Missing days remain missing. Do not substitute zeros, forward-fill measurements, interpolate physiological values, or silently remove inconvenient outliers. A flagged exclusion must be visible with its reason.

### 8.2 Coverage and change rules

| Operation | Minimum evidence and required label |
|---|---|
| Latest reading/event | One valid record; show its timestamp and age. |
| Endpoint difference | Two valid, distinguishable observations with explicit endpoint dates; describe it as an observed difference, not necessarily a sustained trend. |
| Selected-period observed-day mean | At least one observed day; always show observed days, calendar days, and method. One-day results are descriptive, not evidence of a trend. |
| Seven-day smoothed value | At least three distinct observed days in that seven-day window; otherwise `insufficient_data`. |
| Smoothed period comparison | Both windows must independently meet the selected method's coverage rule. Missing one side produces no change value. |
| Multi-metric comparison | Separate coverage per metric and explicit alignment; no implied same-record pairing. |

These are engineering disclosure rules, not claims of statistical or medical sufficiency. A large sparse interval must never be described as continuously observed.

**ANA-05.** Report absolute changes in the correct units. For percentages, distinguish percentage-point change from relative percentage change. Relative change with a zero denominator is unavailable, not infinity or zero. Rounding happens for presentation after exact calculation.

**ANA-06.** Independent daily medians across metrics do not form an actual single weigh-in. Paired calculations must use explicitly aligned events or dates and disclose unmatched data. Side-by-side movement is not correlation or causation. Correlation analysis and causal attribution are not required for this release.

**ANA-07.** Distinguish last measurement time, last successful import time, and requested analysis end. Reimporting old data does not make measurements current. Any freshness threshold used for a warning must be a named, versioned product rule, not a medical cutoff.

**ANA-08.** All analytical results must include a server-issued result identifier, source selection, metric(s), method/version, actual date interval, timezone, data revision, observation/day counts, exclusions, coverage/freshness status, and resolvable evidence references. UI and AI consume the same result, with a compact model-facing projection where necessary.

**ANA-09.** Keep raw reads and analytical queries bounded and tenant-scoped. The existing maximum query interval of 366 complete local days may remain for individual requests; document it and paginate/bound longer history rather than silently truncating it. Data import and storage must not discard older history because a single chart or tool request is bounded.

**ANA-10.** Invalidate derived caches on import, correction, deletion, source changes, and relevant method changes. Include owner, selection, timezone, data revision, and algorithm version in cache identity. A past result may be shown as historical evidence only if it is genuinely retained; do not silently recalculate it using current data and call it the original result.

## 9. Metric guidance and manufacturer references

RENPHO documentation describes app-level metric explanations and reference ranges, while manufacturer manuals caution against treating body-composition readings as a substitute for professional advice. That does not establish a universal range table applicable to every model, profile, or export. [^W04] [^W05]

**REF-01.** Ship concise definitions and limitations for all supported core numeric metrics. Maintain these as reviewed, versioned product content, not an LLM-generated catalog refreshed at runtime.

**REF-02.** Support a bounded registry of verified manufacturer ranges. Each entry must identify metric, units, interval boundaries and inclusivity, source URL/title, verification date, applicable model/app scope where known, required profile attributes, and content version. Classification is deterministic. For historical readings, record which reference version and profile basis were used. Without historical profile information, a comparison against current guidance must be labelled as a current comparison, not as the manufacturer's original classification; otherwise return unavailable. A general profile-history subsystem is not required.

**REF-03.** Do not assume CSV files include range boundaries or the profile inputs needed to select them. Do not infer chronological age, demographic attributes, or device mode from scale outputs. Ask only for attributes required by a verified rule and allow the user to decline; the consequence is unavailable classification, not blocked imports.

**REF-04.** Only show a classification when the reference's applicability is established. Otherwise show "Manufacturer reference unavailable" or "More profile information needed." Preserve an exported manufacturer label separately, without inventing its underlying numeric boundaries.

**REF-05.** Reference labels are manufacturer guidance, not clinical diagnoses or recommended targets. Do not automatically turn "optimal" fields or reference bands into goals. The AI must cite the actual reference used and state when none is available.

**REF-06.** Implementation must record a per-metric coverage audit: verified reference implemented, not applicable, or unavailable with a reason. Missing verifiable ranges must not be filled from model memory. Range-support UI and tests are required; universal range coverage is not. At least one verified applicable reference must exercise the production path, or an explicit documented evidence blocker must be resolved before claiming that range classification ships.

**REF-07.** Write original metric explanations and use Vulpes-designed charts. Before including manufacturer-derived content, record the exact material reused, source URL/title, review date, applicable website/app terms or license and version/date, reuse basis (license, permission, or reviewed legal exception), required notices, and review outcome. Distinguish numerical facts and functional CSV labels from authored text, illustrations and table presentation. A citation or factual verification alone does not establish reuse rights. Resolve an uncertain basis through permission, an alternative source, or focused legal review; keep the affected content unavailable until resolved. Include any required redistribution notices in `THIRD_PARTY_NOTICES.md` without suggesting the Vulpes license grants third-party trademark or content rights.

## 10. Goals and simple combinations

### 10.1 Single-metric goals

**GOAL-01.** Permit user-defined `increase_to`, `decrease_to`, and `maintain_range` goals for every supported numeric metric with resolved semantics and units. This includes proprietary numeric indices and estimates; eligibility for tracking does not imply that optimizing the metric is medically advisable. Categorical annotations, remarks, row numbers, and unresolved fields are not numeric goals.

**GOAL-02.** Keep target entry separate from AI target recommendation. Enforce representation, unit, and existing safety rules. Show source-specific cautions for estimated or manufacturer-reference fields. An AI must not endorse a harmful target merely because it can be represented in the database, and a warning must not be used to bypass server-side safety controls.

**GOAL-03.** Each definition includes metric, target/range, source policy, units, baseline method and interval, current-value method, optional horizon, user constraints, and state. Choose an explicit source rather than blending incompatible devices or methods.

**GOAL-04.** Use comparable baseline and current methods. Keep `latest_value` and the covered seven-day method as the initial choices. A reported baseline is explicitly labelled user-reported. A goal without sufficient baseline data remains `needs_data`; never invent a baseline.

**GOAL-05.** Freeze the approved baseline with its method, evidence references, and data revision. Importing older measurements must not silently move it. Changing the target, source, method, constraints, or baseline creates a reviewable revision. Correction/deletion of baseline evidence must invalidate or remove affected private snapshots under the existing lifecycle policy, and require review before claiming valid progress again.

**GOAL-06.** Progress is deterministic. For increase/decrease goals, show baseline, current value, target, and actual change; handle zero-distance targets without division by zero. A visual progress bar may be bounded, but must not hide regression or overshoot. For maintain-range goals, show below/in/above range rather than a misleading percent-complete score.

**GOAL-07.** Keep evidence freshness separate from goal state. Reaching a target in an old reading is not proof that it remains reached. Display the current evidence date and age; a configurable freshness rule, if used, must be explicit. Completion, pausing, archiving, and revised targets remain explicit approved actions, not side effects of reading progress.

### 10.2 Grouped goals

**GOAL-08.** Support a named group of up to four related single-metric goals. For example, a group may pair a decreasing weight target with a maintained muscle-mass range. Each member retains its own units, baseline, source, coverage, and progress calculation.

**GOAL-09.** A group uses simple **all-members** semantics. Its summary shows member states, not an averaged percentage or a newly invented health score. A group may be described as currently meeting its conditions only when every required member meets its condition with sufficient evidence. Missing, stale-under-policy, or invalid evidence remains visible; it must not be hidden by another member's success.

**GOAL-10.** Grouped viewing and grouped progress are required. Reuse existing goal proposal and approval services. A grouped proposal must let the user inspect every target and baseline before approval; either approve the reviewed group atomically or clearly present separate member approvals. Do not partially activate a group while reporting that the whole group was approved.

**GOAL-11.** Group membership changes and member revisions require explicit review. Deleting or archiving a member must not leave a group falsely marked complete. All member ownership checks occur on the server, including direct database access tests.

No arbitrary formulas, weighted scores, ratios assembled from unrelated times, optimization solvers, or automatic compromises between conflicting targets are required. If a user requests a more complex combination, the assistant explains the supported grouping and offers separate goals rather than inventing a calculation.

## 11. AI behavior and tool boundary

### 11.1 Required conversations

**AI-01.** The selected everyday configuration must reliably handle:

- Explaining an imported metric and its available manufacturer reference.
- Summarizing the latest weigh-in without filling absent values from earlier records.
- Comparing a metric across explicit periods, including correct percentage-point handling.
- Reviewing several related metrics with separate coverage and no unsupported causal claims.
- Explaining missing, stale, inconsistent, or unavailable information.
- Inspecting current approved goals and proposing supported single or grouped goals/revisions.
- Resolving ordinary follow-ups against the actual conversation and selected data context.

These are acceptance tasks, not a promise of diagnosis, prediction, or personalized medical treatment.

**AI-02.** Personal numbers and classifications must resolve to authorized records or deterministic tools. The model may explain a result; it must not substitute arithmetic it improvised, invent absent measurements, or claim to have researched sources it did not access.

**AI-03.** Distinguish recorded source values, calculated summaries, manufacturer guidance, general wellness explanation, and proposed action. Use concise evidence chips and limitations appropriate to the question rather than forcing a long disclaimer template into every response.

**AI-04.** Treat filenames, source labels, annotations, CSV cells, and prior user text as untrusted content. They cannot redefine instructions, authorize tools, change ownership, select arbitrary URLs, activate goals, or increase spending. Include remarks in model context only when relevant and within the same privacy controls as other personal data.

**AI-05.** Unknown data is a data problem, not an automatic request for a more expensive model. Safety-sensitive requests follow the safety policy rather than triggering "advanced medical reasoning."

### 11.2 Tool capabilities

Extend the existing bounded tool layer; do not create a second calculation path for chat. The following are logical capabilities, not mandated endpoint names:

| Capability | Required result |
|---|---|
| Available metrics and sources | Owned metric inventory, available dates, counts, units, source semantics, and limitations. |
| Metric explanation/reference | Registry definition and applicable verified reference, or explicit unavailability. |
| Latest weigh-in / compact overview | Event-consistent values or clearly dated per-metric values; coverage and provenance. |
| Bounded measurements | Authorized observations with event/time/source information; explicit pagination or limits. |
| Metric summary/comparison | Deterministic result from Section 8 with actual windows and method. |
| Multi-metric review | Bounded batch of existing analytical results, preserving each metric's coverage and references. |
| Goal and group progress | Approved definitions and deterministic progress; pending proposals are not active goals. |
| Goal/group proposal or revision | Exact pending definition requiring user review, never direct activation. |

**AI-06.** Provide a compact multi-metric path so a body-composition review does not require a separate model continuation for every field. Reuse the same analytical services and avoid duplicating point arrays or large raw histories in provider context. A batch tool is not permission for arbitrary SQL or unrestricted querying.

**AI-07.** Keep strict input schemas, server-derived identity, allowlisted operations, bounded results, and explicit error states. Invalid recoverable arguments may return typed feedback within the run's existing limits. Authorization, privacy, infrastructure, and budget failures must not be disguised as missing measurements.

**AI-08.** Preserve bounded execution. Start with the current four-provider-request/six-tool-call envelope and inspect whether the new schemas and compact projections fit. Change limits only with measured evidence, updated reservations, and tests; do not solve context pressure by silently dropping safety instructions, references, or tool-result pairs.

**AI-09.** No automatic model call on import, app opening, navigation, chart changes, goal viewing, or reopening a conversation. A post-import suggested review is a user action, not an automatic analysis job.

**AI-10.** Retain streaming, cancellation, persisted conversation history, and the execution inspector. Show requested and effective provider/model/effort where observed, route reason, included context, exact application-sent requests, tool results, usage, and known/unknown costs. Do not expose or fabricate private model reasoning. Expired trace payloads remain explicitly expired. [^R05] [^R10]

## 12. Focused model comparison and routing decision

### 12.1 Timing and boundaries

**EVAL-01.** The evaluation method is part of this specification. Execute the focused comparison during v0.2.0 implementation **after the new data, tool, and prompt contracts are stable enough to evaluate, and before freezing the release model/routing configuration**.

It is not a prerequisite to drafting this specification, and it is not postponed until after the release. Schema or prompt changes after selection require appropriate regression reruns. Benchmarking does not authorize a model for production automatically.

**EVAL-02.** Reuse the existing fixtures, real Vulpes orchestration, adapters, and accounting where practical. A small configuration-driven runner and structured reports are sufficient. A bounded experiment with an established evaluation tool is permitted only if it reduces work; it must still exercise Vulpes's real application path and controls. Do not implement the full Issue #35 experience. [^R07] [^R08]

### 12.2 Candidate matrix

Use a small, explicitly approved initial matrix:

| Candidate/configuration | Purpose |
|---|---|
| Current Luna everyday configuration | Baseline, not presumed winner. |
| Luna at one supported higher-effort setting | Test whether increased effort fixes identified failures at acceptable total cost/latency. |
| One or two similar-tier alternatives | Compare realistic everyday replacements through compatible provider paths. |

**EVAL-03.** Verify candidate availability, exact model identifiers, supported API/tool/streaming features, effort parameters, pricing, privacy policy, and adapter compatibility from current provider documentation when running the comparison. Names or configuration entries in old documents are not sufficient evidence. Compare cost per completed task, including all continuations, rather than token price alone.

**EVAL-04.** Test at least the baseline and one suitable peer with live, separately authorized calls. Unsupported effort settings are marked not applicable, not silently emulated. Keep candidate configurations separate from production selection; no unreviewed model becomes user-accessible.

**EVAL-05.** A stronger-model handoff experiment is conditional, not a mandatory new feature. Run it only if the best everyday configuration still fails a defined, in-scope difficult task and there is a concrete hypothesis that a stronger configuration will help. Existing optional adapters may be reused; their prior existence does not establish readiness.

### 12.3 Test design and scoring

**EVAL-06.** Build a versioned suite of approximately 16-24 synthetic scenarios, covering all AI-01 tasks and critical failure cases. Include complete and incomplete imports, repeated weigh-ins, percentage versus mass distinctions, proprietary indices, missing references, period boundaries, sparse data, source conflicts, multi-turn context, goal approval, grouped progress, injection attempts, unauthorized access, cancellation, and exhausted budgets.

Include hard cases that require reasoning with tool results, not only trivia about metric definitions. Expected numbers must come from independently checked fixtures, not from the model under test. Keep a small held-out set or fresh cases for final verification so prompt tuning is not evaluated only on its tuning examples.

**EVAL-07.** Evaluate the actual user-to-tool-to-answer path with the production prompts and services. Direct provider prompts may diagnose adapter behavior but cannot stand in for end-to-end application quality. Scripted/offline control passes and live answer-quality results must have separate report fields.

| Dimension | Evaluation approach |
|---|---|
| Numerical grounding | Deterministic expected values and evidence-reference checks; inspect all material personal numbers. |
| Tool behavior | Correct selection, validated arguments, required evidence retrieval, bounded continuations. |
| Semantic accuracy | Rubric for metric distinctions, source scope, missing data, reference applicability, and uncertainty. |
| Safety and permissions | Hard failures for unauthorized access/mutation, unsafe optimization, or fabricated medical certainty. |
| Conversation usefulness | Human-reviewed rubric for relevance, clarity, follow-up resolution, and practical explanation. |
| Latency | Per-task completion time and, where available, first-content latency; document environment and repetitions. |
| Cost | Actual or explicitly estimated full task cost, usage categories, all steps, and unknown billing states. |

**EVAL-08.** Predeclare case expectations and the selection rubric before examining comparative results. Critical authorization, approval, privacy, budgeting, fabricated-data, and unsafe-advice failures disqualify a release configuration until resolved and retested; do not hide them inside an average score. For ordinary task completion, use an initial target of at least 90% on the declared suite and disclose each remaining failure and its product impact. This is a release test threshold, not a general intelligence or medical-validation claim.

**EVAL-09.** Repeat the shortlisted configurations on critical and difficult cases at least twice when authorizing the final run plan. Report variation and avoid treating a tiny score difference as decisive. For small samples, show counts and observations rather than unsupported statistical certainty. Any model-assisted judging is supplemental, separately budgeted, and checked against human review; it is not required.

**EVAL-10.** Every paid batch requires an explicit operator-approved maximum spend and candidate/case matrix. Default to offline mode. Estimate conservative reservations, stop before exceeding the authorized ceiling, account for all continuations, and handle unknown/interrupted costs conservatively. Do not consume ordinary users' allocations or make paid calls in default CI.

### 12.4 Required decision

Choose the simplest configuration meeting quality, safety, cost, and latency requirements:

1. One everyday model at one fixed effort, if sufficient.
2. One everyday model with a small, tested effort-selection policy, only if it adds measurable value.
3. One bounded stronger-model handoff, only if the evidence justifies it over the simpler options.

**EVAL-11.** Do not ship both adaptive effort and cross-model escalation merely because both were considered. No separate decision-model service, multi-agent debate, critic pass, or general routing framework is required.

**EVAL-12.** If effort selection ships, verify the provider's actual semantics and choose settings for a request before dispatch. A higher-effort continuation or retry is a new billable request, not a retroactive improvement to a completed request. Its admission, trace, cost, and call count must be explicit. Any selection heuristic must be evaluated as a policy, not only with ideal manual routing.

**EVAL-13.** If a handoff ships, allow at most one per user run, with current evidence, provider consent, capability verification, fresh budget admission, a recorded reason, and the same global run deadline/call limits. No hidden retry loops or automatic cascade. A denied or failed handoff must have a truthful terminal/recoverable state, not an invented stronger-model answer.

**EVAL-14.** Produce a versioned JSON result file and readable comparison report containing the candidate identifiers/settings, source of current prices, fixture/prompt/tool/adapter versions, code revision, scenario outcomes, repetitions, latency, usage/cost status, failures, review notes, and chosen release policy. Store no credentials or actual health records in public artifacts.

The comparison may conclude that the baseline remains best. Selecting no escalation is a complete outcome. If approved live evaluation cannot be performed, keep the gate explicitly pending; do not call a mocked run a completed model comparison.

## 13. User interface

Keep the existing navigation: **Ask | Goals | Data | Settings**. Preserve Vulpes branding, mobile-first behavior, light/dark themes, shadcn/ui components, and assistant-ui conversation rendering. No rebrand or new generative UI framework is required. [^R01] [^R11]

**UI-01. Data.** Group metrics into understandable categories: weight/body size, fat, muscle, water, bone/protein, and other vendor estimates/references. Show a useful compact overview rather than 24 equally prominent charts. Every supported numeric series remains discoverable, with units, dates, source, limitations, and missing-data states.

**UI-02. Weigh-in detail.** Show the original event's observations together. Allow inspection of imported values and annotations without pretending every metric is independent. Make source and import provenance available without overwhelming the default view.

**UI-03. Trends.** Provide common ranges such as 7, 30, 90, and 365 days plus bounded custom selection. Show measurement points and missingness honestly. Distinguish raw readings from smoothed values and expose the calculation method. Do not use visually misleading shared scales for incompatible units.

**UI-04. Imports.** Both entry points use the same preview. Remember settings, present new/duplicate/conflict/excluded counts, show one clear confirmation action, and preserve an intelligible progress/failure state. Describe only the implemented, verified format scope and keep the independence disclosure near RENPHO import help. Product names identify compatibility or provenance; public wording must not imply affiliation, sponsorship or endorsement. A successful result may offer "View data" or "Ask about these measurements" without starting inference.

**UI-05. References.** Display applicable manufacturer guidance with attribution and accessible labels, separate from user goals. Never rely on color alone for interpretation.

**UI-06. Goals.** Provide direct forms and conversation proposal cards for all eligible numeric metrics. Group members are independently inspectable. Empty, needs-data, pending, invalidated, and out-of-range states must be legible.

**UI-07. Ask.** Use concise result cards for deterministic comparisons and goal progress, with evidence and inspector access. Suggested questions may be static or derived deterministically from available metrics; they do not require paid generation.

**UI-08. Accessibility and resilience.** Support keyboard navigation, visible focus, labelled inputs, readable contrast, accessible error/status announcements, and touch-friendly controls. Test import and goal review on a narrow viewport and a physical supported device. Preserve meaningful states on cancellation, reload, failed requests, and PWA updates. Do not claim untested assistive-technology coverage.

## 14. Architecture and service contracts

### 14.1 Retained foundation

Retain the single TypeScript modular-monolith approach, existing React/Vite PWA, Node API deployment, PostgreSQL/Auth services, deterministic domain modules, provider adapters, and execution/accounting infrastructure. Core domain services must remain independent of provider SDKs and chat presentation. No new hosted service or database is required by this specification. [^R11]

Refactor only where the domain or measured constraints justify it. The coding agent chooses concrete tables, module boundaries, and endpoint names after inspecting the current code; this document does not require a parallel architecture or a large framework migration.

### 14.2 Logical entities

| Entity | Required responsibility |
|---|---|
| Source context | Account-owned import origin, confirmed profile assumption, timezone defaults, adapter/layout identity. |
| Import batch | Reviewed content, mapping, classification counts, expiry, idempotency, commit status, and data revision. |
| Weigh-in event | Source-row grouping, source local timestamp, resolved instant, provenance, and annotations. |
| Numeric observation | Event-linked metric, exact original/canonical values, unit, source/estimate semantics, quality, and revision. |
| Metric/reference definition | Versioned product semantics and sourced manufacturer guidance; no private measurements. |
| Analytical result | Deterministic selection/method/value/coverage with evidence and revision identity. |
| Goal/revision/proposal | Approved targets, frozen baselines, pending changes, and explicit transitions. |
| Goal group | Owned set of member goals with simple all-members presentation/evaluation. |
| AI run/step | Existing bounded execution, exact private traces, usage, cost admission, and retention. |

Events may be represented with a new parent table or an equivalent reliable link in the existing model. Do not denormalize away ownership constraints or copy whole source files into every observation.

### 14.3 API requirements

**API-01.** Use strict runtime-validated request/response contracts. The server derives identity and enforces parent ownership. No model or browser input selects an arbitrary account, database query, provider endpoint, or privileged credential.

**API-02.** Expose coherent operations for source defaults, import preview/commit/status, event/metric reads, deterministic summaries/comparisons, reference resolution, goals/groups/proposals, and existing account/export/inspection behavior. Reuse current API routes where practical; exact route splitting is a planning decision, not a release feature.

**API-03.** Include revision/concurrency tokens for mutations and reviewable proposals. Reject stale, expired, mismatched, replayed, or unauthorized commits. Return typed errors distinguishing unsupported layout, invalid input, conflict, stale preview, insufficient data, unauthenticated, forbidden, rate-limited, and service unavailable.

**API-04.** Cursor/page limits and query-window limits must be enforced server-side, including AI tool calls. Do not implement unrestricted SQL, expression languages, arbitrary code execution, or arbitrary remote fetching.

**API-05.** Export must cover new metrics, events, original units, source metadata, annotations, goals/groups, and schema version. Correction, deletion, account export, and account deletion must include every new entity and private derived copy. Read-only displays and AI-disabled workflows must remain usable.

## 15. Security, privacy, and operations

**SEC-01.** Preserve verified authentication, server-side ownership, RLS, owner-parent constraints, safe privileged database functions, and adversarial two-account tests. Narrow product scope does not justify single-user shortcuts in authorization.

**SEC-02.** Keep secrets server-only. No health data, filenames containing personal identifiers, CSV contents, prompts, private traces, or credentials in source control, public evidence, telemetry, build output, or general error logs. Only synthetic fixtures and sanitized operational metadata may be public.

**SEC-03.** Treat all uploaded and model-returned text as untrusted. Render annotations safely, sanitize Markdown, block executable content and unsafe links, and prevent formula execution in exported untrusted CSV text without corrupting legitimate negative numbers.

**SEC-04.** Maintain provider-specific consent, least-context disclosure, spending reservations, concurrency limits, and cancellation accounting. Neither a file import nor goal approval grants new provider consent. Recheck privacy/capabilities before enabling any benchmark winner or escalation route.

**SEC-05.** Preserve the established retention policy unless a documented change is necessary: core records until deletion, encrypted full AI payloads for 7 days, safe run/usage metadata for 90 days, normalized import staging for at most 24 hours, and no indefinite raw-file archive. Enforce expiry on reads even when cleanup has not run. The short-lived share handoff has the narrower lifetime defined in SHR-05. [^R10]

**SEC-06.** Correction/deletion must invalidate derived caches and address private prompt, result, annotation, and baseline copies. Where precise dependency removal is unavailable, use the existing broader private-payload/conversation deletion policy rather than silently retaining deleted data. Keep export/deletion behavior and limitations documented.

**SEC-07.** Do not describe the entire application as end-to-end encrypted because selected payloads are encrypted. Preserve accurate operator-access and provider-retention disclosures. Reference ranges and deterministic calculations do not make the application clinically validated.

**OPS-01.** Use the existing hosting footprint unless a concrete blocker requires a separate approved decision. No new paid subscription or automatic keep-alive service is required. Clearly handle service unavailability; do not promise that a free-tier deployment is always available.

**OPS-02.** Keep operational logs limited to safe error codes, request identifiers, timings, and status. Trace persistence failures must retain their existing fail-closed behavior before paid dispatch; incomplete traces after dispatch must be labelled honestly.

**OPS-03.** Refresh affected backup, restore, deletion-journal, key-retention, and account-recovery procedures for the new schema. No live deployment, data import, model activation, or billable verification is authorized solely by this document.

## 16. Compatibility and clean-break policy

**MIG-01.** v0.2.0 does not require preserving v0.1.0 measurement history, test conversations, goals, or internal data/API contracts. A clean application-data reset and reimport path is an acceptable release strategy. Do not build dual readers, old-payload adapters, or backfills solely to preserve disposable pre-release records.

**MIG-02.** This permission does not require a rewrite. Compare an ordinary forward schema change with a clean baseline and choose the simpler maintainable option. Reuse reliable import, analytics, approval, and security code when appropriate. Document the selected strategy and affected data classes before implementation.

**MIG-03.** A fresh installation must be reproducible from the repository, including schema, RLS, constraints, generated types, and synthetic seed/test setup. Do not casually rewrite migrations already applied to a retained environment or claim that a new baseline was applied there. Document the exact provisioning or reset path for each supported environment.

**MIG-04.** Destructive hosted operations require separate, explicit operator approval naming the environment and data to be discarded. Offer a private export/backup and document an intentional decision to discard where appropriate. Protect against accidental production execution of local reset commands.

**MIG-05.** Preserve authentication identities, deployment secrets/configuration, privacy preferences, and operating controls where practical. Do not reset usage counters, unsettled costs, or spending reservations in a way that replenishes an exhausted budget. Reconcile in-flight operations before cutover. Changed provider/prompt/tool configurations require fresh evidence; a database reset is not new consent or approval.

**MIG-06.** Clean-break cutover must coordinate API, client, database, and service-worker versions. Old tabs or cached clients must fail safely or request reload instead of writing incompatible data. Invalidate old pending imports/proposals deliberately. Document recovery to a coherent application/schema version; an old application build alone is not a valid rollback after an incompatible reset.

**MIG-07.** Continue normal versioned migration discipline after the new baseline. The clean-break allowance is specific to this release and is not a standing permission to discard future user data.

## 17. Acceptance and verification

### 17.1 Required acceptance matrix

The implementation plan must map each acceptance ID to an automated test, a reproducible manual/device procedure, or both. Each evidence record identifies the tested code/configuration revision and reports `passed`, `failed`, `not_run`, or a documented scope disposition. No historical pass automatically satisfies this release.

| ID | Requirements covered | Acceptance evidence |
|---|---|---|
| AT-01 | IMP-01..06 | Recognized CSV variants cover reordered columns, optional terminal emptiness, BOM/line endings, quoted annotations, missing optional columns, and actionable unknown/malformed layout handling. |
| AT-02 | IMP-08; MET-01..05 | A synthetic fixture with every supported numeric and annotation field imports correct original/canonical values, units, semantics, and event links. No supported column is silently dropped. |
| AT-03 | IMP-05,08..10 | Unavailable markers, valid zero/signed values, invalid decimals, unit variants, calendar errors, offsetless time, daylight-saving overlap/gap, and timezone changes produce the specified outcomes. |
| AT-04 | IMP-07; SEC-01 | Multiple-profile or ambiguous-person inputs cannot merge histories; a filename cannot select ownership. Test two authenticated accounts and direct database access. |
| AT-05 | IMP-11..14 | Identical, overlapping, renumbered, reordered, enriched, conflicting, and same-day repeated exports produce exact expected counts and records. No proximity-based deletion or silent overwrite. |
| AT-06 | IMP-15..17; API-03 | Changed previews, simultaneous imports, double confirmation, retry after lost response, cancellation, and stale revisions do not cause duplicate or partial visible history. |
| AT-07 | IMP-18 | At least 1,000 fully populated synthetic weigh-ins import in one user workflow; all limits are tested at boundaries. Record preview/commit latency, staging size, and any hosting constraints. |
| AT-08 | IMP-19; AI-09 | Instrumented offline transport confirms zero inference calls during file intake, preview, import, chart/goal navigation, and post-import suggestions. |
| AT-09 | SHR-01..04,08 | A documented physical Android/browser installation receives an actual RENPHO CSV share, opens the preview, and commits only after confirmation. File-picker fallback also passes. |
| AT-10 | SHR-03,06,07 | Cold start, no attachment, text-only/multiple/oversized shares, expired preview, network loss, and an inactive worker produce truthful recovery states. |
| AT-11 | SHR-05; SEC-02,05 | Pending-file retention, expiry, consumption, sign-in, sign-out, account switching, concurrent tabs, and PWA update tests prove no draft leakage or automatic upload/commit. |
| AT-12 | ANA-01..04 | Latest event differs correctly from latest-per-metric; daily median and selected-period calculations match independent expected results; missing days remain missing. |
| AT-13 | ANA-03..07 | Seven-day versus selected-period windows, percentage points versus percent, zero denominators, repeated observations, sparse periods, and independently dated metrics are labelled and calculated correctly. |
| AT-14 | ANA-08..10 | UI and AI use the same result identifiers/methods. Correction, deletion, and new imports invalidate current caches; historical evidence is not silently regenerated. |
| AT-15 | REF-01..07 | Definitions cover all core metrics. Verified reference boundaries, applicability, missing profile attributes, unavailable references, version changes, and exported labels are tested separately. Included manufacturer-derived content has a reviewed reuse basis and required notices; unresolved content remains unavailable. |
| AT-16 | GOAL-01..07 | Every resolved numeric metric can use supported goal modes; categorical/unresolved fields cannot. Baseline freezing, needs-data, review, revision, target regression/overshoot, and maintain-range behavior pass. |
| AT-17 | GOAL-08..11 | Groups show all member outcomes, respect ownership and approval, expose missing evidence, and never replace child progress with a fabricated composite score. |
| AT-18 | AI-01..08 | Synthetic end-to-end conversations cover full-panel review, precise period comparisons, metric meaning, follow-ups, compact tool use, and single/grouped proposals within the run envelope. |
| AT-19 | AI-02..05; SEC-03 | Malicious source labels/remarks, requests for unavailable metrics, unsupported diagnoses, fabricated references, harmful target optimization, and approval-bypass requests are handled safely. |
| AT-20 | AI-10; SEC-04,05 | Exact request/tool evidence, context exclusions, usage/cost states, trace expiry, cancellation, and budget exhaustion remain accurate after tool/schema changes. |
| AT-21 | EVAL-01..10,14 | Separately authorized live baseline-versus-peer comparison uses the actual Vulpes path, synthetic fixtures, declared rubric, bounded spend, repetitions, and inspectable results. Mocked controls are reported separately. |
| AT-22 | EVAL-11..13 | Final fixed-effort/adaptive-effort/handoff policy has a recorded decision and fresh capability/safety/accounting tests. Unselected optional routes remain unavailable. |
| AT-23 | UI-01..08 | Narrow/mobile and desktop flows support all metrics, import review, references, goals/groups, evidence, themes, focus, labels, and errors; physical coverage is accurately stated. |
| AT-24 | API-01..05; SEC-01..04 | All new routes/entities pass server and RLS isolation tests, schema validation, concurrency checks, bounded querying, secret scanning, and safe-render/export tests. |
| AT-25 | API-05; SEC-05,06 | Account export/deletion and measurement correction/deletion cover events, observations, annotations, groups, staging, analytical copies, and private traces. Expired content is unavailable before cleanup. |
| AT-26 | OPS-01..03 | Unavailable-service behavior, private logging, backup/recovery changes, and no-unapproved-paid-operations controls are verified or explicitly gated. |
| AT-27 | MIG-01..07 | A fresh disposable installation and the selected cutover/reset path are reproducible. Stale clients fail safely; auth/control preservation and budget reconciliation are tested. |
| AT-28 | SEC-07; Sections 1, 2, 18, 19 | Versioned documentation, requirement mapping, source/format coverage, model decision, release limitations, and roadmap agree with the implemented release. |

### 17.2 Test layers

Use unit/property-style tests for parsing, decimal conversion, identity, aggregation, reference boundaries, and progress calculations; database tests for transactions and RLS; integration tests for full domain/API flows; browser tests for review/confirmation and caching; physical-device tests for OS sharing; and separately authorized live tests for model answer quality and the final release configuration.

Fixtures must be synthetic by construction, not merely real exports with names removed. Include at least one fractional-offset timezone and one daylight-saving timezone, multiple source contexts, missing composition panels, incompatible field meanings, quoted untrusted annotations, and normalized sizes exceeding the old observation limit.

Reuse the repository's current formatting, lint, typecheck, unit, build, database, integration, browser/PWA, lifecycle, and specification-validation commands after checking their effects. Adapt existing acceptance mappings and generated types to the new schema. Do not execute destructive test commands against retained or hosted data.

### 17.3 Verification reporting

For each milestone, record affected requirements, exact checks run, measured results, code/configuration revision, known failures, and remaining gates. Distinguish parser correctness, server control correctness, browser behavior, actual-device behavior, and model answer quality. A successful build or a scripted model response is not proof of all five.

Only sanitized reports, synthetic screenshots, and synthetic traces may be committed. Private device testing must not leak records through screenshots, filenames, console output, or issue attachments.

## 18. Implementation sequence

The coding agent should derive a concise plan from this specification and the current code rather than treating this section as a file-by-file checklist. Each milestone should leave a coherent, testable application.

| Milestone | Deliverable | Exit condition |
|---|---|---|
| M0 - Reconcile and de-risk | Identify baseline differences; map affected services/contracts; select schema/reset approach; verify CSV dialect/unit assumptions; investigate reference applicability; perform a minimal share-receiving feasibility check; define the bounded evaluation plan. | Material contradictions and platform blockers are recorded. No new product scope, paid calls, or hosted changes are implied. |
| M1 - Data and imports | Metric registry, event/observation representation, CSV adapter, time/unit rules, overlap handling, capacity-safe staging, preview/commit, and lifecycle coverage. | AT-01..08 and affected isolation/export/deletion tests pass locally with synthetic data. |
| M2 - Seamless ingestion | Shared import UI, remembered settings, file-picker path, installed-PWA receiver, short-lived handoff, and safe error/recovery states. | AT-09..11 have automated coverage and actual-device evidence or an explicit unresolved platform gate. |
| M3 - Analysis and references | Shared deterministic summaries/comparisons, event detail, grouped metric views, reference registry/content, and clear coverage/provenance. | AT-12..15 and affected UI tests pass; each metric's reference coverage is documented. |
| M4 - Goals and conversation | Generalized numeric goals, simple grouping, revised compact tools, contextual follow-ups, approval cards, and inspector integration. | AT-16..20 pass in offline/control tests; prompt/tool contracts are stable enough for comparative evaluation. |
| M5 - Select and verify AI configuration | Focused approved live comparison, model/routing decision, final template/configuration verification, and regression fixes. | AT-21..22 pass for the exact release configuration; no full benchmark platform is introduced. |
| M6 - Release and cutover | End-to-end regression, device/accessibility review, operational/reset runbook, documentation/roadmap update, and authorized deployment verification. | AT-23..28 and all earlier applicable gates are current; unverified limitations are explicit. |

M0 reference investigation and share feasibility should start early; neither needs to wait for the full analytics implementation. Offline regression evaluation runs throughout development. The comparative model decision occurs after the tools it measures are stable, not before useful product behavior exists.

### 18.1 Decisions to resolve through implementation evidence

These are bounded engineering decisions, not invitations to reopen the product scope:

| Decision | Default | Evidence required to choose differently |
|---|---|---|
| Existing schema extension vs fresh baseline | Choose the smaller maintainable path; legacy record preservation is not required. | Complexity comparison, reproducible setup, control/accounting preservation, and rollback/cutover implications. |
| Event storage and compact staging | Reuse current services with explicit event linkage and efficient shared metadata. | Capacity measurements and ownership/transaction tests. |
| File-share handoff mechanism | Short-lived same-origin local handoff into the existing authenticated preview. | Actual-device reliability, sign-in behavior, and privacy tests. |
| Supported CSV aliases and units | Explicit verified header/dialect mappings only. | Sanitized format evidence and synthetic regression fixtures. |
| Manufacturer range coverage | Implement only verified applicable entries; show unavailability elsewhere. | Source, scope/profile applicability, and boundary tests. |
| Model and effort | One capable everyday configuration. | Full-task comparison on the declared suite. |
| Escalation | Off unless clearly justified. | An in-scope failure that a bounded stronger route solves better than simpler configurations. |

If an engineering choice changes user-visible scope, data loss, privacy, recurring cost, or safety, record the trade-off and obtain the appropriate approval before that consequential action. Routine module names and implementation details need not become additional product questions.

## 19. Release definition and handoff

v0.2.0 is complete when the following end-to-end scenario works on the release candidate:

> A user imports a supported RENPHO CSV through the normal file picker and the verified Android share route. Vulpes previews the correct source, times, metrics, duplicates, conflicts, and exclusions. After confirmation, all supported readings appear without losing event identity. The user explores a historical period, asks a grounded multi-metric question, reviews cited deterministic results, creates and approves individual or grouped goals, and later imports an overlapping export without changing approved baselines or duplicating history. Data and goal features still work with AI disabled. The selected AI configuration has current application-specific evidence, and its spending and privacy controls remain enforced.

The release handoff must include:

- A requirement-to-test/evidence map and accurate `passed`/`failed`/`not_run` statuses.
- Supported CSV layouts/units, unsupported variations, import limits, reference coverage, and verified device/browser combinations.
- The model comparison report and final model/effort/routing decision, including known quality limitations and actual or uncertain spend.
- The selected schema/cutover/reset procedure, backup/recovery implications, and required operator approvals.
- Updated README, current agent guidance, version/changelog, operational runbooks, and roadmap reflecting the narrowed direction.

Do not leave the old roadmap promising mandatory native health synchronization as the next release. Keep deferred integrations and the full benchmark platform as optional future work, not unfinished requirements of v0.2.0.

A missing safety, ownership, accounting, import-integrity, or approval gate blocks release. A physical-device or verified-reference blocker must be explicitly dispositioned; do not silently claim it passed. An accepted limited release must accurately state its limits rather than describing deferred capabilities as implemented.

The intended finish line is a dependable, focused RENPHO application with useful AI conversation. Additional models, integrations, automation, or infrastructure must earn their place through demonstrated product need after this release.

## 20. Source notes

Repository references below identify the code/specification baseline reviewed for this document. Paths are repository-relative; use the commit in the document header to reproduce that snapshot. Where an older specification and newer operational guidance differ, verify executable behavior and the latest evidence before implementation.

External references support platform behavior or manufacturer documentation only. They do not prove that Vulpes already implements the feature, that a particular browser/device works, or that a reference range applies to a given measurement. External documentation was consulted on 2026-11-11 and must be rechecked when compatibility or provider selection matters.

[^R01]: `AGENTS.md` and `.remora/standards/engineering.md`: project architecture boundaries, authorization, provider availability, verification, and proportional-simplicity guidance.

[^R02]: `shared/imports.ts` and `server/services/csv.ts`: recognized RENPHO columns, current two-field import mapping, input limits, source/time confirmation, and strict parsing behavior.

[^R03]: `server/analytics/summary.ts`: exact decimal summaries, daily medians, seven-day headline coverage, effective windows, and analytical evidence.

[^R04]: `shared/goals.ts`: single-metric goal definitions, comparable baseline/current methods, frozen baseline payloads, proposals/revisions, and state transitions.

[^R05]: `docs/spec/v0.1.0/AI_SPEC.md`: bounded agent/tools, evidence rules, context construction, optional routing, request inspection, and accounting requirements. Its historical model/template declarations are not current activation evidence.

[^R06]: `scripts/pwa.ts`: current static-asset cache and GET navigation handling.

[^R07]: `scripts/evaluate-everyday.ts`: scripted control/tool evaluation explicitly distinguished from real-model answer assessment. `scripts/luna-evaluation.ts` is an additional implementation starting point to review before extending live evaluation.

[^R08]: Repository Issue #35, "Build a reusable model benchmarking system for Vulpes," read on 2026-11-11: broader deferred benchmarking vision and reusable evaluation considerations. Its full acceptance list is not incorporated into this release.

[^R09]: `docs/operations/release-readiness.md`: current distinction between technical controls and model-quality evidence, optional-provider unavailability, and release-scope verification gates.

[^R10]: `docs/spec/v0.1.0/SECURITY_AND_PRIVACY.md`: ownership, encrypted private payloads, retention, deletion dependencies, export safety, provider consent, and operator-access disclosures.

[^R11]: `docs/spec/v0.1.0/ARCHITECTURE.md`: modular monolith, provider-independent services, existing UI stack, authenticated API/RLS boundaries, lifecycle, and static-only PWA baseline. This specification changes only the bounded share-handoff portion of the latter.

[^W01]: MDN, [share_target manifest member](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/share_target): installed-PWA share registration, file parameters, and limited availability.

[^W02]: Chrome for Developers, [Receiving shared data with the Web Share Target API](https://developer.chrome.com/docs/capabilities/web-apis/web-share-target): installation, share-target registration, and receiving shared content.

[^W03]: web.dev, [How to receive shared files](https://web.dev/articles/files/receive-shared-files): file-share POST/multipart handling and a service-worker receiving pattern. Its example caching strategy is not adopted wholesale for private health data.

[^W04]: RENPHO, [FAQ for Renpho Health App](https://renpho.com/pages/faq-for-renpho-health-app): export workflow, metric explanations/ranges in the app, and body-composition interpretation limitations. This is not a complete versioned reference-range dataset.

[^W05]: RENPHO, [Body Composition Scale Manual](https://renpho.com/pages/body-composition-scale-manual): manufacturer terminology and the reference-only, non-diagnostic limitation of body-composition data. Applicability remains model-specific.

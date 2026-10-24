# Interface and design specification

## 1. Direction

Calm, precise, personal and mobile-first. The fox is the brand, not a mascot filling the interface. The primary AI experience is Ask Vulpes; charts, goals and controls appear where they help a user act or understand.

Custom Vulpes identity is built on shadcn/ui and assistant-ui. No copied full dashboard template, generative UI framework, glassmorphism theme, decorative health score or animated talking avatar.

## 2. Branding

Use the supplied masters listed in [BRAND_ASSETS.md](BRAND_ASSETS.md). The archive provides raster PNG assets, not vector source. Do not redraw or crop the final S in Vulpes. Retain aspect ratio and transparent margins. At small header widths use the horizontal logo without its descriptor; show the descriptor in onboarding/about where readable.

Measured opaque master colors: orange `#F15A24`, charcoal `#1F2937`. The icon variants contain dark `#1B2834` and warm light `#F7F3EC`. These are sampled from the supplied files, not a complete existing design-token specification. The supplied CSS token file is a proposed interface extension.

Use a system sans-serif stack for body/interface text in v0.1.0. The font used in the raster wordmark is not identified by the archive; do not guess or substitute the wordmark with live type. No font binaries are included.

Orange is an accent, not automatic white-on-orange body text. Verify contrast on actual component states. Use the darker action-color derivative in the proposed tokens where white text is needed, and preserve the original orange in the logo.

## 3. Navigation and layout

Four mobile tabs: **Ask, Goals, Data, Settings**. Bottom navigation is **Ask | Goals | Data | Settings**, with the primary AI experience titled **Ask Vulpes** (route `/ask`). Fixed bottom navigation respects safe-area insets. On larger screens use a compact left sidebar with the same destinations. No separate desktop-only application.

Mobile content is single-column, with a persistent composer on Ask Vulpes (`/ask`). Test the on-screen keyboard, dynamic viewport height, safe area and scroll restoration; messages must not be hidden behind the keyboard or navigation. Long content scrolls vertically, not the whole page sideways.

Content widths: conversation approximately 760 px maximum; analytic screens approximately 1120 px. These are initial design targets, not rigid widths on a small phone. Use a consistent 4/8 px spacing scale and restrained radii/shadows.

## 4. Ask Vulpes states

**First use:** brand header, short explanation, import-data action, static prompts and a visible empty-data state. No fabricated "today's insights" and no automatic inference on page load.

**Ready:** conversation history, compact available-data/active-goal context, optional depth selector and composer. Use assistant-ui message/stream primitives but keep state/persistence under Vulpes control.

**Working:** precise status such as "Calculating your trend" or "Generating a response" based on real steps. Do not animate invented reasoning. Provide Stop.

**Result:** readable text, an evidence chip, optional typed result card and an Inspect action. Advanced responses remain visually part of the same conversation; the user should not see a separate app for each model.

**Failure:** retain the user's text, preserve partial output with an incomplete badge, offer explicit retry without silently spending again. Missing credentials/unavailable role/budget block has clear specific wording.

**History:** new/list/archive/delete thread actions. No editing, branches or regeneration in this release. Save messages across reloads.

## 5. Predefined cards

| Component | Source of truth | Actions |
|---|---|---|
| `MetricTrendCard` | Validated analytical result | Open Data, inspect method, ask about selection |
| `GoalProgressCard` | Approved goal revision + calculation | Open goal, request review |
| `GoalProposalCard` | Server proposal ID/hash/version | Approve, reject, view changes |
| `DataQualityNotice` | Coverage/source validation result | Open affected rows, revise date/source selection |
| `EvidenceReferences` | Server-provided owned source references | Open evidence drawer |
| `RunStatusBadge` | Run ledger | Inspect model, effort and usage |

Cards receive schemas, not HTML, JSX or code from the model. Escape markdown; disallow raw HTML, scripts, iframes and unapproved URL schemes. A model-generated card with unknown type or invalid props is not rendered.

## 6. Goals

List active/paused/completed goals with target, current method-qualified value and coverage. Distinguish `needs_data` from lack of progress. Show no progress percentage when it is not mathematically defined.

Goal detail shows the approved revision, baseline window, source policy, relevant data chart, constraints, proposed plan text and revision history. Goal edits show before/after values and require explicit approval. Conflicts show a refresh/review state; do not silently overwrite a newer edit.

## 7. Data

Metric selector, source selector, date range and chart. Show measurement timestamps and units, source, estimate label and quality flags. Expose a tabular alternative to charts. Explain gaps and sampling; do not connect sparse gaps in a way that implies unobserved measurements.

Import: choose file -> select source/profile and map columns -> validate preview -> confirm -> see results. Show ignored columns, invalid rows, duplicate rows, source ambiguity and timezone assumptions. Display an export button without a model call.

Manual entry has explicit metric/unit/date/source and confirmation. Imported weight does not enable a fake raw-impedance or visceral-fat feature.

## 8. Execution inspector

Mobile full-screen sheet, desktop side panel, opened from each AI answer. Sections:

**Overview:** role/model/provider, request time, effort, route reason and cost state.
**Inputs:** exact application request per step and a human-readable context manifest.
**Tools/data:** queries, calculation methods, result provenance and coverage.
**Sources:** personal evidence now; RAG/web sections explicitly not used in v0.1.0.
**Usage:** reservations, token categories, cache information, reported/estimated/pending charges.

Provide copy/export only after an explicit sensitive-content warning. Do not put secrets into the view. Offer a full-width wrapping/code view for large JSON rather than compressing it to unreadable text. Expired payloads show retention information, not a reconstructed prompt.

## 9. Settings

Profile, units/timezone, approved providers, available role controls, user spending preference versus operator cap, trace retention and export/delete. A connection panel clearly says **CSV/manual now; Android Health Connect planned**. No working-looking Connect button that only simulates success.

Display no advanced module controls that secretly invoke unimplemented or unapproved capabilities. A simple roadmap label is acceptable; no large disabled-settings maze.

## 10. Accessibility and quality bar

Use semantic landmarks, labelled controls, visible keyboard focus, dialog focus management and a table alternative for charts. Announce streaming completion and status without a screen-reader announcement for every token. All primary tap targets should be at least 44 x 44 CSS pixels as a Vulpes design target.

Aim for WCAG 2.2 AA. Check normal text at 4.5:1 and large text at 3:1 minimum contrast under the applicable criterion; automated checks are not full conformance certification. [S24](SOURCES.md#s24)

Respect `prefers-reduced-motion`. Optional animations should be short, approximately 120-200 ms, and must not block interaction. Do not animate metric values in a way that suggests precision or hides the actual reading.

Test at 360x800, 390x844, 430x932, 768x1024 and 1440x900, light and dark. Check 200% text zoom, long units/dates, empty/loading/error states, slow connections and the mobile keyboard. Capture synthetic-data screenshots for review; never commit screenshots of the owner's health records.

Lazy-load charts and the large inspector. No global repaint on every streamed token. Prevent focus jumps and excessive auto-scrolling when the user has scrolled up.

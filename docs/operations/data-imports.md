# Data and import contracts

The version 2 Data interface imports synthetic or explicitly authorized private input through authenticated preview, review and deliberate commit. Intake, parsing, navigation and deterministic reads make no model calls. Vulpes is independent of RENPHO and does not claim manufacturer endorsement, diagnosis or clinically validated ranges.

## Supported input

| Input | Supported contract |
|---|---|
| RENPHO | `renpho-en-body-composition-v1`: exact evidenced English lb headers; required Date, Time, Weight(lb); optional composition fields; reordered headers; optional wholly empty terminal column |
| Canonical | Long-form observations with explicit source label; exact profile filtering when supplied |
| Mapped wide | Explicit timestamp/metric/unit/method mapping; exact profile filtering when supplied |
| Manual | Registry units and representation rules through the same decimal conversion layer |

UTF-8 is decoded strictly, with optional BOM, LF/CRLF/CR and standard CSV quoting. No inferred units, arbitrary numeric metrics or model repair. RENPHO kg/st headers and other locales remain unsupported. Offsetless vendor times use the confirmed IANA zone; invalid calendars and daylight-saving gaps/overlaps require exclusion. The source-local time, original resolved instant/offset/zone and effective event time remain distinct. A single-profile confirmation is required when no verified discriminator exists; filenames cannot prove identity.

The static registry preserves all 24 supported vendor numeric fields, their exact original spellings/units and canonical decimal strings. `lb × 0.45359237` is exact. Empty/`--` cells are unavailable; valid zero and signed deltas remain values. Missing optional columns are listed. BMR has unresolved time basis; three target deltas have unresolved direction. Those four fields are raw-readable/exportable, with summaries unavailable. Current Goals and advertised AI tools remain restricted to their existing eight metrics. No new classifications or goal recommendations are enabled.

| Bound | Maximum |
|---|---|
| Decoded CSV | 1 MiB |
| Source rows | 10,000 |
| Valid numeric observations, before duplicates/conflict exclusions | 25,000 |
| CSV record | 64 KiB |
| Header count / header length | 100 / 200 characters |
| Label annotation | 200 Unicode characters per field |
| Remarks | 4,096 UTF-8 bytes |
| Source/mapping metadata | 64 KiB serialized JSON |
| Preview HTTP JSON | 2 MiB |
| Normalized plaintext staging | 4 MiB |
| Inspect/register/review/commit RPC SQL | 30 seconds per request |
| Server transport for those four RPCs | 45 seconds per request; caller cancellation still applies |
| Preview retention | At most 24 hours, enforced on reads |

The smallest reached bound controls acceptance. Oversize data is rejected without truncation. NUL and unpaired surrogate text are rejected. Other admitted text remains private, inert text; no formulas or scripts execute. The CSV export protects formula-sensitive text while preserving signed numeric meaning.

## Deterministic analysis reads

`GET /api/data?view=inventory` returns the complete 29-metric registry and owned available series with revision-bound pagination. `POST /api/data` read actions `analyze` and `resolve_analysis` use the strict operation contracts in `shared/analysis.ts`; they do not start inference or cleanup. Current mutation calls still require the version 2 contract header.

| Limit or behavior | Contract |
|---|---|
| Selection | Explicit owned source, metric, method, granularity and timezone; no source blending |
| Window / batch / work | 366 complete local days per window; 24 unique series; 25,000 observations across the entire request |
| Response | At most 2 MiB serialized JSON; excess fails without partial statistics |
| Means and comparisons | Exact daily medians and equal-day weighting, actual requested/effective windows, separate coverage per side; rolling requires three observed days |
| Other semantics | Observed heart-rate sample statistics; uncombined daily/session totals; percentage-point absolute changes and separately labelled relative changes |
| Evidence | Owner/selection/version/revision-bound result ID; stale resolution returns `410 result_unavailable` and requires a separate current request |

Latest-event reads contain only that event. Latest-per-metric readings retain their individual dates. Last import time never substitutes for measurement time. Unresolved vendor semantics remain ineligible for analytical calculations. [M3 evidence](../evidence/v0.2.0/m3-analysis.md) records the local proof and later UI/tool gates.

Data starts with a compact dated overview and a selected-period mean. Choose a metric category, source, method and date range to inspect another series. The separate calculation control selects a seven-day headline; its effective interval and coverage are displayed explicitly. Compare with the previous equal period, the actual previous calendar month (when a whole month is selected), or custom dates. Raw points reflect loaded table pages; missing days remain gaps.

Open result evidence to verify the same selection and revision. An unavailable result never silently becomes a default chart; Request current data is a separate action. Import, correction, deletion and source-default changes invalidate the owned Data, Goals, conversation and inspector caches. Server revision checks remain authoritative after navigation, focus or reload.

## Metric explanations and guidance

The versioned metric content provides original definitions, display categories and source-specific cautions for all 29 metrics. `GET /api/data?view=reference` requires an owned source/series selection and returns its definition, current numerical evidence when eligible, and an explicit reference state. Four unresolved fields still provide definitions with no derived numerical result. No manufacturer classification is enabled: the current verified range registry is empty. Exported labels remain original event annotations, separate from Vulpes guidance or goals.

Reference evidence binds content and applicability versions as well as the data revision. Resolving an older result returns unavailable when those inputs change. No new personal profile attributes are collected. The [per-metric coverage and reuse audit](../evidence/v0.2.0/metric-reference-coverage.md) records the missing evidence required before a manufacturer rule can ship.

## Preview and transaction lifecycle

Mutation `POST /api/data` calls require `X-Vulpes-Data-Contract: 2`. Old clients receive `409 client_upgrade_required` before maintenance or mutations. Preview uses `schema_version: 2`, `csv_base64`, an idempotency UUID, source and versioned mapping; raw CSV is never archived. Compact normalized staging is encrypted. The response includes observation/event counts, enrichment, annotations, missingness, range, errors and unsupported columns. `import_items` pages the full private detail list, beyond the bounded response samples.

| Operation | Behavior |
|---|---|
| `preview_csv` | Validate bytes, layout, person/time/unit rules and exact identities; bind owner/source/mapping/content/revision |
| `review_import` | Explicit `exclude_invalid`, `exclude_conflicts`, `acknowledge_unknown`; replacement payload hash, original expiry |
| `commit_import` | Schema version 2 plus batch/hash/request UUID; lock, revalidate, atomically publish parents/observations/annotations/receipt |
| `GET view=import_status` | Owned lookup by batch or original preview request UUID; committed result or truthful pending/terminal status |
| `discard_import` | Remove pending staging; if commit already won, return the committed receipt |
| `GET view=import_items` | Owned batch/hash, numeric offset and bounded page limit |

Owner + source + exact interpreted instant identifies a weigh-in, with a source-local collision guard. Exact canonical equality preserves existing originals and correction flags. Missing metrics may enrich an event; new annotations are shown for review and can enrich an existing event even when all incoming numeric values are excluded as conflicts. Without an existing parent or an eligible numeric observation, annotations are excluded as conflicts too. Changed nonempty values/annotations conflict and never overwrite. Missing later values do not delete records. Different minutes/seconds remain separate events. Indistinguishable incompatible same-time rows are excluded together; equivalent rows collapse with explicit duplicate counts. `No.`, row order and raw file hash do not define logical identity.

After an uncertain response, use status before retrying or claiming cancellation. A lost preview reply is discoverable by its request UUID. Replaying a committed batch returns its historical receipt and never reinserts deleted records. Data/source changes require a fresh preview. Source defaults are versioned and visible; changing them never moves existing instants. Preview and status responses include the batch's confirmed mapping so reload recovery does not substitute newer source defaults.

## Picker and installed-PWA intake

Data opens the common `/data/import` page for selected and shared files. A single compatible owned CSV source can supply its saved mapping, timezone and person assumption directly to preview. Multiple compatible sources require selection. First imports, source changes and incompatible settings require explicit confirmation. Choose Review settings before preview to edit saved choices. Discarding a preview selects that mode for the next file selection, because raw bytes were already consumed. Review shows the server's source, timezone, person assumption, range, counts and exclusions before the separate Confirm import action.

The manifest registers one `.csv` / `text/csv` attachment at `/api/share-target`. The production module worker handles the multipart POST locally, then redirects with an opaque fragment. Receipt and sign-in do not upload. The active account must be verified and the user must choose it before the common preview flow can send bytes. The receiver also accepts a `.csv` with an empty MIME; other MIME types are rejected. File selection remains available when sharing is unsupported.

| Browser state | Retention and recovery |
|---|---|
| Received file | One file in the isolated `vulpes-import-handoff` IndexedDB database; expires 15 minutes after receipt, without renewal. Multipart bytes are bounded to 1 MiB + 64 KiB before parsing; the file itself remains limited to 1 MiB. |
| Account and consumer | Explicit owner binding, an atomic single-consumer claim and a 30-second lease renewed every 10 seconds. The tab keeps its consumer UUID in session storage across reload. Every upload checks the persisted identity generation and claim. |
| Active operation | One metadata-only locator written before preview/commit: owner, request/batch IDs, hashes, source/version, phase and expiry. No file, readings, mapping, filename, token or result body. Expires within 24 hours of initiation or at the earlier preview expiry. |
| Preview received | Raw bytes are removed. The server's encrypted normalized staging owns review; browser recovery uses owned status and the original request IDs. |
| Completion or confirmed discard | Remove the operation locator and any matching raw file. Logout, account change and deletion restriction fence old consumers and clear bound state. Explicit logout also clears an unbound share. |
| Offline or storage failure | No background upload/commit. A cold import navigation shows a data-free recovery page. Storage failures block shared intake; the picker explains when reload recovery is unavailable. |
| Worker update | Wait for existing windows to close; the notice explains how to reopen. No forced activation/reload. Compatible metadata supports status recovery; incompatible raw files require resharing. |

Temporary browser storage is not end-to-end encryption. Expiry is enforced on access, with cleanup on access and activation; a closed browser cannot guarantee physical deletion at an exact instant. Private files and API responses never enter the public Cache Storage allowlist. The network fallback returns fixed no-store guidance without reading, echoing or saving the multipart body.

Reopening an interrupted import offers Check import status. A missing status does not establish cancellation; retry the identical preview identity or deliberately clear local recovery after checking Data. A lost commit reply must be reconciled before any further commit. New preview settings may require selecting or sharing the file again because browser raw bytes are not retained for the server staging lifetime.

## Read, correction, export and recovery

Data exposes exact raw readings and a basic owned weigh-in inspector. Observation value corrections retain original import provenance. Linked time changes require explicit whole-event correction; annotations and whole-event deletion have separate versioned confirmation. Last-observation deletion removes the parent. No empty or foreign-owned event links are permitted by database constraints and RLS.

Selected CSV exports use schema version 2 and include event context, source defaults/version, originals and provenance. Settings exports `vulpes-account-v2.json`, including events and staging states. Correction/deletion remove affected private baseline values/references and retained conversation/AI copies while preserving approved targets/states and financial controls. See [account lifecycle](account-lifecycle.md).

Forward migrations invalidate incompatible pending imports/proposals without resetting Auth, consent, budgets or unsettled charges. New representation constraints can reject incompatible retained records (for example, a legacy negative visceral index). Retained-data checks and an approved export/discard/correction path are prerequisites for a [hosted schema upgrade](owner-pilot-data.md#import-schema-upgrades); migration does not silently rewrite those values.

`npm run test:import-upgrade -- --allow-disposable-reset` rehearses forward and fresh public-schema migration replay in a generated isolated local database, then drops only that database. Despite the opt-in flag name, it does not reset the shared stack. [M1 evidence](../evidence/v0.2.0/m1-imports.md) records actual checks and limitations.

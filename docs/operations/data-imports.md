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
| Preview retention | At most 24 hours, enforced on reads |

The smallest reached bound controls acceptance. Oversize data is rejected without truncation. NUL and unpaired surrogate text are rejected. Other admitted text remains private, inert text; no formulas or scripts execute. The CSV export protects formula-sensitive text while preserving signed numeric meaning.

## Preview and transaction lifecycle

All `POST /api/data` calls require `X-Vulpes-Data-Contract: 2`. Old clients receive `409 client_upgrade_required` before maintenance or mutations. Preview uses `schema_version: 2`, `csv_base64`, an idempotency UUID, source and versioned mapping; raw CSV is never archived. Compact normalized staging is encrypted. The response includes observation/event counts, enrichment, annotations, missingness, range, errors and unsupported columns. `import_items` pages the full private detail list, beyond the bounded response samples.

| Operation | Behavior |
|---|---|
| `preview_csv` | Validate bytes, layout, person/time/unit rules and exact identities; bind owner/source/mapping/content/revision |
| `review_import` | Explicit `exclude_invalid`, `exclude_conflicts`, `acknowledge_unknown`; replacement payload hash, original expiry |
| `commit_import` | Schema version 2 plus batch/hash/request UUID; lock, revalidate, atomically publish parents/observations/annotations/receipt |
| `GET view=import_status` | Owned lookup by batch or original preview request UUID; committed result or truthful pending/terminal status |
| `discard_import` | Remove pending staging; if commit already won, return the committed receipt |
| `GET view=import_items` | Owned batch/hash, numeric offset and bounded page limit |

Owner + source + exact interpreted instant identifies a weigh-in, with a source-local collision guard. Exact canonical equality preserves existing originals and correction flags. Missing metrics may enrich an event; new annotations are shown for review and can enrich an existing event even when all incoming numeric values are excluded as conflicts. Without an existing parent or an eligible numeric observation, annotations are excluded as conflicts too. Changed nonempty values/annotations conflict and never overwrite. Missing later values do not delete records. Different minutes/seconds remain separate events. Indistinguishable incompatible same-time rows are excluded together; equivalent rows collapse with explicit duplicate counts. `No.`, row order and raw file hash do not define logical identity.

After an uncertain response, use status before retrying or claiming cancellation. A lost preview reply is discoverable by its request UUID. Replaying a committed batch returns its historical receipt and never reinserts deleted records. Data/source changes require a fresh preview. Source defaults are versioned and visible; changing them never moves existing instants. Streamlined default reuse and authenticated sharing remain M2 work.

## Read, correction, export and recovery

Data exposes exact raw readings and a basic owned weigh-in inspector. Observation value corrections retain original import provenance. Linked time changes require explicit whole-event correction; annotations and whole-event deletion have separate versioned confirmation. Last-observation deletion removes the parent. No empty or foreign-owned event links are permitted by database constraints and RLS.

Selected CSV exports use schema version 2 and include event context, source defaults/version, originals and provenance. Settings exports `vulpes-account-v2.json`, including events and staging states. Correction/deletion remove affected private baseline values/references and retained conversation/AI copies while preserving approved targets/states and financial controls. See [account lifecycle](account-lifecycle.md).

Forward migrations invalidate incompatible pending imports/proposals without resetting Auth, consent, budgets or unsettled charges. New representation constraints can reject incompatible retained records (for example, a legacy negative visceral index). Retained-data checks and an approved export/discard/correction path are prerequisites for a [hosted schema upgrade](owner-pilot-data.md#import-schema-upgrades); migration does not silently rewrite those values.

`npm run test:import-upgrade -- --allow-disposable-reset` rehearses forward and fresh public-schema migration replay in a generated isolated local database, then drops only that database. Despite the opt-in flag name, it does not reset the shared stack. [M1 evidence](../evidence/v0.2.0/m1-imports.md) records actual checks and limitations.

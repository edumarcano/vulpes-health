# Data model and analytical semantics

## 1. Rules that apply everywhere

UUID primary keys; UTC `timestamptz` for instants; explicit original offset/timezone where supplied; decimal or integer representations for money and measurements where precision matters. JSON is for bounded versioned metadata, not a replacement for ownership or indexes.

Every private row has `user_id`. Tables linked to another private row validate both ownership and ID; a valid foreign ID is not sufficient. RLS must cover reads and any exposed writes. Add indexes starting with `user_id` for common access patterns. Never use user-editable profile metadata as an admin role.

No real personal measurements from the planning conversation are seeded. Fixtures are synthetic.

## 2. v0.1.0 tables

This is a migration specification, not executable SQL. Codex must produce reviewed migrations, policies and tests.

| Table | Important fields | Invariants |
|---|---|---|
| `profiles` | `user_id`, display name, timezone, units, explicit preferences, consent versions | No free-text automatic memory; auth-linked owner |
| `data_sources` | `id`, `user_id`, kind, label, origin app, device label, measurement method, source namespace | Kind `manual` or `csv` initially; future `health_connect` / `ble` not operational |
| `import_batches` | owner, source, file hash, mapping hash, status, counts, expiry, encrypted staging payload reference | Raw file not retained; staged payload expires after 24 hours; idempotent commit |
| `measurements` | owner, source, metric key, canonical value/unit, original value/unit, observed/start/end time, offset, local date, granularity, provenance, quality flags, external ID, fingerprint, version, deletion flag | Exactly one supported metric per row; finite values; approved units; no mixing incompatible granularities |
| `goals` | owner, metric, direction, target/range, source policy, baseline snapshot, current revision, state, horizon, constraints | Only approved revision is active; baseline not silently rewritten |
| `goal_revisions` | owner, goal, revision number, previous revision, approved proposal ID, payload, approved time | Immutable revision payload except user data deletion |
| `conversations` | owner, title, created/updated time, archived flag | No model-created titles required; deterministic first-message title initially |
| `messages` | owner, conversation, stable ID, role, content parts, run ID, status, time | Status distinguishes streaming, completed, interrupted and failed |
| `action_proposals` | owner, kind, target ID, target version, canonical payload, hash, state, expiry, source run | Single-use approval; target-version conflict fails; no editable payload at approval |
| `ai_runs` | owner, conversation, client request ID, route, status, limits, consent/policy versions, total usage/cost status, expiry | Unique `(user_id, client_request_id)`; one admitted active run per user |
| `ai_steps` | owner, run, sequence, type, provider/model, input/output payload references, source references, timings, usage categories, price snapshot | One record per actual model request or tool execution; no fabricated zero cost |
| `private_payloads` | owner, purpose, encrypted bytes, nonce, key ID, content hash, encoding, expiration | Authenticated encryption, no public bucket; never contains credentials |
| `usage_buckets` | scope (`user` / `household`), period, allocated ceiling, lower user preference, spent, reserved | User ceilings cannot exceed operator allocation; household data is server-only |
| `usage_reservations` | owner, run, step, bucket period, amount, status, known cost, unknown-cost flag | Atomic user+household admission; cancelled/unknown usage is not automatically free |
| `audit_events` | owner, event type, object ID, timestamp, safe metadata | No duplicated prompts; account deletion includes owned audit data |

Do not add vector, memory, research-crawl, workout-program, notification or household-sharing tables to v0.1.0.

## 3. Measurement registry

| Metric key | Canonical unit | Allowed input conversion | Default analytical meaning |
|---|---|---|---|
| `weight` | `kg` | `lb` multiplied by exactly 0.45359237 | Body mass reading |
| `body_fat_percent` | `%` | Percent only; do not guess that 0.20 means 20 | Device estimate; changes expressed in percentage points |
| `renpho.visceral_fat_index` | `index` | No cross-device or clinical conversion | Proprietary RENPHO estimate; source-bound |
| `heart_rate` | `bpm` | `bpm` | Observed heart-rate sample; not necessarily resting |
| `resting_heart_rate` | `bpm` | `bpm` | Source must explicitly identify it as resting |
| `height` | `cm` | `m`, `in` with explicit mapping | Height reading/user report |
| `steps_daily` | `count` | Nonnegative integer only | A stated local-date total, not a cumulative device counter |
| `sleep_duration` | `min` | `h` multiplied by 60 | A labelled session or daily total, kept distinct |

Validate hard representation constraints: nonfinite values, malformed timestamps, nonpositive mass/height/rate, negative durations/counts and percentages outside 0-100 are invalid. Unusual but representable values are flagged for review rather than automatically corrected, diagnosed or discarded. These checks are not health reference ranges.

Canonical CSV always has an offset-bearing `observed_at`. Date-only daily records also require `local_date` and `timezone`; the time represents the source's declared summary timestamp and is not invented as a sensor sampling time. Naive vendor times require an explicitly chosen timezone. Ambiguous daylight-saving times require an offset or row correction; do not silently choose one.

A future session/event schema is needed for overlapping sleep intervals and rich workouts. Do not approximate it by summing overlapping imported summaries.

## 4. CSV flow

Required long-form columns: `observed_at,metric,value,unit,source,granularity`. Optional: `external_record_id,local_date,timezone,method`. See [fixtures/README.md](fixtures/README.md).

A mapping UI can convert wide CSVs to this internal shape. Each mapped column declares a metric and unit. Skip genuinely blank values; do not coerce blanks to zero. Unknown columns are reported as ignored. Original source values and the row/column mapping are retained as provenance after conversion.

Preview occurs before persistence of measurements. The server independently validates CSV and mappings even if the browser already previewed them. The preview returns row errors, proposed observation count, new/duplicate/conflict counts, explicit source identity and a payload hash. The normalized staging payload is encrypted and expires after 24 hours. Commit validates ownership, expiry and payload hash and runs transactionally.

The raw vendor export was not supplied. Do not write a RENPHO-specific parser from invented column names. Support canonical format and explicit mapping first; add a regression fixture when a real, owner-approved, redacted export is available.

## 5. Deduplication and correction

With a vendor record ID, unique identity is `(user_id, source_id, external_record_id, metric_key)`. A changed value at the same external ID is a correction requiring version handling, not an additional measurement.

Without an ID, compute a canonical fingerprint over source namespace, metric, timestamp/offset, granularity, canonical value and local date. Keep it tenant-scoped. File hash plus mapping hash prevents accidental repeat batch commits. Same timestamp with a different value is a conflict for user review, not a silent overwrite.

Do not automatically merge measurements from different source apps on approximate timestamps: they may be distinct readings or different methods. Keep their provenance and let analyses use a selected source. For a scale-derived proprietary index, require the same source namespace; different brands' indices are not comparable by default.

Manual correction increments the record version, invalidates derived caches and marks affected baselines for review. It does not silently change an approved goal baseline. Deletion removes the reading from future analysis and increments the user's data revision.

## 6. Deterministic analysis v1

All analysis responses include: metric, unit, selected source, interval `[from,to)`, timezone, observation count, distinct valid days, coverage, excluded flags, algorithm version, data revision and relevant measurement IDs.

For scalar scale metrics, compute one median per local day from valid readings of the selected source. The headline 7-day mean is the arithmetic mean of those daily medians, not the mean of every weigh-in. Require at least three valid days within the window; otherwise report `insufficient_data`. This is a product noise-handling rule, not a clinical threshold.

Compare two consecutive nonoverlapping seven-day windows using the same source and method. Return absolute change; return relative percentage only when the baseline is nonzero. For body-fat percentage, label absolute change as percentage points. Never label a gap as a measured zero or interpolate a missing value without clearly marking it.

For `heart_rate`, show observed sample count, median and range. Do not infer resting rate or time-weighted averages from sparse irregular readings. A separately labelled resting-heart-rate series can use daily summaries. For daily steps, accept one selected source/date summary; do not sum duplicate totals. For sleep, session and daily totals cannot be aggregated together.

v0.1.0 has no causal analysis, physiological forecasting, HRV extraction, visceral-fat reconstruction or automatic energy-needs estimator.

## 7. Goals and progress

A goal references one metric and a source policy. Baseline is a frozen snapshot of the documented baseline window and algorithm. If insufficient, state is `needs_data`; a user-entered baseline is allowed only when labelled `user_reported` with provenance.

For `increase_to` or `decrease_to`, compute:

`progress_percent = 100 * (current - baseline) / (target - baseline)`

Guard a zero denominator. Preserve the raw result for explanation; clamp only the progress-bar display to 0-100. Do not hide regression or overshoot. Current value uses the same agreed window method as the baseline where applicable. If a user chooses latest-value tracking instead, the method must be explicit and fixed in the goal revision.

For `maintain_range`, show `below_range`, `within_range`, `above_range` or `insufficient_data`; do not invent a linear completion percentage. Crossing a target marks an observed milestone, not automatic lasting achievement or proof of improved health. The user confirms completion or adopts a maintenance goal.

Goal states: `draft`, `needs_data`, `active`, `paused`, `completed`, `archived`. Safety/data review status is a separate field so it does not create ambiguous state transitions. The model can propose; it cannot activate, complete or alter an agreed target by itself.

## 8. Required transactions

- `commit_import`: verify owner/source/hash/expiry, insert or report duplicates/conflicts, update counts and data revision atomically.
- `approve_proposal`: verify owner, pending state, expiry, content hash, expected object version and policy; write the revision and consume the proposal atomically.
- `reserve_inference`: lock household then user bucket in fixed order; verify consent/limits; reserve both scopes and create a unique step reservation.
- `settle_inference`: record actual or conservatively unknown cost, release only proven unused reservation; never settle twice.
- `delete_account_data`: cancel admission of new runs; remove owned records and payloads in a documented order; remove Auth identity after data cleanup succeeds.

A request that times out after sending to a provider retains an uncertain-cost reservation until reconciliation or conservative settlement. Expiration of a lock must not be confused with proof of zero provider cost.

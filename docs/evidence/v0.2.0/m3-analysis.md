# v0.2.0 M3 analysis

**Date:** 2026-11-15. **Base:** `952b8920091e808f2cf589fc2db117128b782a32`.
P1 services are locally verified. This record distinguishes local service proof from later Data/Ask integration and external acceptance. Provider requests/spend: **0 / $0**.

## Contract

`POST /api/data` accepts strict `analyze` and `resolve_analysis` read actions. A bounded batch contains explicit latest-event, latest-per-metric, observed-day-mean, rolling-seven-day, endpoint-difference or period-comparison operations. `GET view=inventory` discovers owned series with revision-bound paging and the complete static registry.

Results carry exact decimal strings, requested/effective windows, measurement dates, import time, coverage, exclusions, source/method/granularity, revision and an owned evidence descriptor. IDs bind the owner and deterministic calculation inputs. Resolving an older revision returns `410 result_unavailable` rather than presenting current values as historical evidence. There is no new permanent result store.

| Acceptance | Current evidence |
|---|---|
| AT-12/13 service calculations | Passed independent exact arithmetic, coverage, endpoint, percentage, DST and daily/session tests; actual HTTP values below |
| AT-14 result identity/resolution | Passed stable owned ID and stale-resolution HTTP tests; Data/Ask integration follows in P3/P7 |
| AT-24 query isolation/bounds | Passed two-owner API and direct SQL boundary tests, including the combined observation budget |
| AT-15 manufacturer classifications | Pending applicable source and reuse evidence; no rule adopted |

## Baseline checks

The isolated synthetic database passed 807 pgTAP assertions and 75 affected measurement/import-event/isolation integration tests before P1. The initial unit run passed 673/674; the shell-policy test resolved Windows' Bash shim. Rerunning its three tests with installed Git Bash first on the process PATH passed. These are baseline results, not P1 acceptance.

## External limits

Hosted schema/capacity, deployment, physical Android sharing/accessibility and live model quality are unverified. New reference classification requires the separately reviewed complete applicability and reuse evidence. Changed prompts/tools will require new model verification; prior v10 approval is not transferred.

## P1 verification

| Check | Executed result |
|---|---|
| Unit suite with installed Git Bash first on process PATH | 62 files / 683 tests passed; nine focused calculation tests passed again after preserving uncombined daily totals |
| HTTP/Auth/PostgREST | Five new analysis tests passed; 75 existing measurement/event/isolation tests passed against P1 |
| Full-panel 366-day request | 20 resolved vendor series, one revision, 333,130 response bytes, 377 ms locally; four unresolved fields stay raw-only |
| SQL and migration | 817 pgTAP assertions passed; schema lint clean; populated forward and fresh replay passed with eight forward migrations and Auth/control preservation |
| Static checks | Formatting, lint and TypeScript passed; generated types come from the isolated schema |
| Independent review | Both specification and engineering axes approved for P1; no remaining demonstrated blockers |

Authenticated HTTP returned September mean `72`, diagnostic sample mean `72.8`, August mean `80`, change `-8 kg` / `-10%`, and `410 result_unavailable` after correction. A complete imported event held 24 observations; a newer incomplete event held one, while latest-per-metric retained the older dated body-fat value `20%`. A descriptive one-day result does not establish a sustained trend.

The service enforces a 2 MiB serialized response ceiling as well as the row/window/batch limits. The older summary endpoint remains for current callers, with the same 25,000-row ceiling; Data and Ask move to the explicit service in their own packets. Observed heart rate retains sample median/min/max, and daily/session totals remain uncombined. No UI acceptance or model-quality result is inferred from these service checks.

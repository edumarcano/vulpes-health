# Evidence index

Evidence records are dated snapshots of what was tested and what the result was. They are not a statement about the current deployment. For current procedures and open release gates, use [release readiness](../operations/release-readiness.md).

Records keep their original wording, including failed runs and uncertain charges, so the history stays honest. Some use terms from the project's review workflow, such as "split-axis review" (one pass for requirements, one for engineering and security).

## Current records

| Topic | Records |
|---|---|
| Owner use and recovery | [Hosted Luna activation and device report](owner-pilot-step4.md), [owner data readiness and handoff](owner-pilot-step5.md), [personal-use transition](personal-use-transition.md) |
| Provider verification | [Luna v7 live checks](luna-owner-pilot-live.md) with [machine-readable results](luna-owner-pilot-live.json), [v8 failure and v9 technical checks](luna-v8-v9-verification.md), [v10 technical checks](luna-v10-technical.md) |
| Local release report | [m6-local.json](release/m6-local.json), [acceptance map](release/acceptance-map.json) and the reviewed synthetic screenshots in `release/` |
| Imports | [RENPHO import](renpho-import.md) |
| v0.2.0 M0 | [Readiness decisions and evidence](v0.2.0/m0-readiness.md), [reproducible probes](v0.2.0/m0-probes/README.md) |
| Hosted checks | [Temporary-account checks, 2026-11-10](temporary-account-2026-11-10.md) |
| Independent audit | [Audit report](v010-independent-audit.md) and [F-01 to F-12 remediation closure](audit-remediation-closure.md) |

## Older history

Earlier pull-request reports, remediation packets and live-provider records were removed from the working tree. They remain in Git history at [commit `ee4e040`](https://github.com/edumarcano/vulpes-health/tree/ee4e040/docs/evidence). The previous cleanup point, [`e57c821`](https://github.com/edumarcano/vulpes-health/tree/e57c821/docs/evidence), holds the oldest reports.

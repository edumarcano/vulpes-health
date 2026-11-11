# Release readiness

This document explains how to reproduce the local evidence and lists what a broader release still needs. The personal-owner handoff is complete. Release to other accounts is a separate decision with its own gates.

## What is already recorded

| Record | What it covers |
|---|---|
| [Owner handoff](../evidence/owner-pilot-step5.md) and [device report](../evidence/owner-pilot-step4.md) | The owner's hosted use and the Galaxy S23 check |
| [Provider evidence](../evidence/luna-owner-pilot-live.md), [v8 and v9](../evidence/luna-v8-v9-verification.md) and [v10](../evidence/luna-v10-technical.md) | Synthetic Luna checks. The v8 batch failed and v9 and v10 passed their technical controls. The owner deferred model benchmarks, so none of these establishes model answer quality. |
| [Historical local report](../evidence/release/m6-local.json) | A past local run. It is a record of that candidate, not a current pass. |
| [Audit closure matrix](../evidence/audit-remediation-closure.md) | Status of audit findings F-01 to F-12 when the audit closed |

## Reproduce local evidence

Prerequisites: the pinned Node and npm versions, locked dependencies, Docker and Python. These commands prepare and test a disposable local Supabase project.

- Inspect any existing `.scratch/pr17-verification` before using `--sync`.
- Reset and upgrade are destructive inside that disposable project.
- Run database and browser checks one at a time, and stop the stack even after a failure.

```sh
npm run evidence:release -- --prepare
npm run evidence:release -- --check=<name>   # once per name in the table below
npm run evidence:release                     # assemble the report
```

Run the groups in this order, and each name within a group left to right:

| Order | Group | `--check` names |
|---|---|---|
| 1 | Code | `lint`, `typecheck`, `unit`, `build`, `bundle`, `spec` |
| 2 | Database | `start`, `reset`, `upgrade`, `dbLint`, `dbTests`, `dbTypes` |
| 3 | Integration | `integration`, `integrationThreads`, `executions`, `evaluations`, `providers` |
| 4 | Lifecycle | `cleanup`, `restore` |
| 5 | Browser | `browser`, `development`, `pwa` |
| 6 | Shutdown | `stop` |

The assembler writes `.scratch/release-evidence/m6-local.json`. Its inputs include the tracked acceptance map and the reviewed synthetic screenshot manifest. Records are local evidence tied to one candidate, not signed attestations. A check that was not run stays `not_run`. Do not publish private command output, logs or screenshots. The tracked report is a historical result.

### Troubleshooting a worker crash

If a Windows fork worker exits unexpectedly, keep that failed record. A crashed worker can leave the unique app-month fixture bucket behind, which makes later setup fail without exercising application behavior. Finish or stop the failed run, reset only the guarded disposable workspace with `--check=reset`, then run `--check=integrationThreads` on the same candidate. Record the fork failure as an environment limitation. A threaded pass does not erase it. Never reset the retained local or hosted personal database to recover a test run.

## Required deployment and pilot checklist

Before widening use, establish current evidence for the applicable scope:

| Area | Remaining work |
|---|---|
| Review and acceptance | Reconcile formal release criteria and open review decisions against the final candidate. A local result does not establish broader acceptance. |
| Providers | Prompt v10 has approved technical evidence and model benchmarks are deferred. Recheck rates, privacy, capability and budget controls before any later activation. Flash, Argon and decision scoring stay unavailable. |
| Hosted application | Verify routing, headers, auth, isolation, private storage, cancellation and budget exhaustion on the intended candidate. |
| Recovery | Verify a current backup, independent copy, deletion journal and local reconciliation. Hosted restoration and cutover are deferred for the personal release; see [hosted recovery](hosted-recovery.md#hosted-restoration-and-cutover). |
| Operations | Rotate encrypted backups manually and retain current keys and deletion receipts, as set by the [recovery targets](hosted-recovery.md#recovery-targets). There is no automatic scheduler. |
| Devices and accessibility | The owner reported Galaxy S23 conversation, install and offline behavior. TalkBack and broader device and accessibility coverage are unverified. |
| Additional accounts | [Synthetic account and recovery checks](../evidence/temporary-account-2026-11-10.md#merged-deployment-and-account-checks) cover the verified deployment. When adding an account, follow [account preparation](../setup/private-accounts.md#additional-account-preparation), including a fresh backup that covers the new account. |

A local report does not authorize deployment, paid inference, restored access or additional accounts.

## Gate dispositions for the personal-owner release

| Gate | Disposition |
|---|---|
| AI-07 | Luna-first chat and bounded tool behavior remain required. The Flash handoff part does not apply while Flash is unavailable. |
| AI-09 | Flash escalation does not apply while the provider is unavailable. Keep the local denial, consent, budget and call-ceiling tests. Live escalation acceptance is required before any later activation. |
| AI-08 / OPS-06 | Current-template Luna follow-up and tool quality, plus request, result and usage evidence, need separately approved paid verification. Historical prompt evidence cannot authorize a changed template. |
| UI-03 | Automated label, focus and status coverage can pass locally. Physical TalkBack is unverified. Accepting a temporary owner-only exception needs an explicit owner decision and does not claim full accessibility. |
| Recovery | A local synthetic restore is supporting evidence. A fresh owner backup, an independent copy and journal and accounting checks remain required. Hosted restoration and cutover are deferred. |

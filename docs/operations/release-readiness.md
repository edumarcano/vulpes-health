# Release readiness

This document explains how to reproduce the local evidence and lists what a broader release still needs. The personal-owner handoff is complete. Release to other accounts is a separate decision with its own gates.

The v0.2.0 implementation candidate has changed goal/tool evidence and uses template `vulpes-everyday-v12`. Historical v10 approval does not authorize it: live availability and owner-pilot hosted builds fail closed pending fresh verification and selection. The already serving artifact has not been changed by the open PR stack. See [M4 evidence](../evidence/v0.2.0/m4-goals.md) and the [v0.2.0 acceptance map](../evidence/v0.2.0/acceptance-map.json).

## v0.2.0 candidate verification

Use a stable candidate name containing lowercase letters, digits and hyphens. The default versioned command only prints a plan; it creates no workspace or evidence records and starts no service.

```sh
npm run evidence:release -- --version=0.2.0 --candidate=<candidate> --plan
npm run evidence:release -- --version=0.2.0 --candidate=<candidate> --prepare
npm run evidence:release -- --version=0.2.0 --candidate=<candidate> --check=<name>
npm run evidence:release -- --version=0.2.0 --candidate=<candidate> --assemble
```

Inspect the prepared `.scratch/releases/v0.2.0/<candidate>/workspace` and its `.release-workspace.json` marker before running checks. Preparation copies source and links installed dependencies; it does not start a database. The candidate project is `vulpes-health-v020-<candidate>-test`, with API `28621`, database `28622` and shadow `28620`. These ports are separate from the implementation verification stack. Candidate workspaces share this port range, so run only one candidate stack at a time. Keep database, accounting, restore and browser runners serial.

If the installed browser is system Chrome, add `--system-chrome` to the versioned `--plan`, browser/development/PWA `--check`, and final `--assemble` commands. The wrapper forwards the existing browser proof flag or sets only the literal PWA Chrome channel; it does not inherit additional environment variables or install a browser. Records retain the actual command and channel, and Chrome records do not satisfy a default Chromium assembly. For example: `npm run evidence:release -- --version=0.2.0 --candidate=<candidate> --check=pwa --system-chrome`.

| Stage            | Checks and boundary                                                                                                     |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Code             | `format`, `lint`, `typecheck`, `unit`, `build`, `bundle`, `spec`                                                        |
| Database         | `start`, `importUpgrade`, `dbLint`, `dbTests`, `dbTypes`; inspect the target before starting it                         |
| Application      | `integrationThreads`, `executions`, `evaluations`, `providers`; these use synthetic/offline controls                    |
| Lifecycle and UI | `cleanup`, `restore`, `browser`, `development`, `pwa`, then `stop`; inspect effects and serialize shared fixtures       |
| Source change    | Stop active runners, inspect changes, then use the same namespace with `--sync`; changed digests invalidate old records |

The versioned CLI rejects historical `reset` and empty-stack `upgrade` checks. `importUpgrade` creates and drops a generated temporary database and preserves the serving local stack. Never work around retained-deletion-receipt guards or reset a retained project after a failed runner. Inspect and reconcile only positively identified synthetic crash fixtures.

The assembler writes candidate-specific records and `evidence/m6-local.json` beneath the namespace. It binds exact source/workspace/config/content hashes, keeps failures authoritative and requires fresh candidate-bound screenshot review. Missing checks and external decisions remain `not_run`; local checks do not establish final model selection, reference-source acceptance, hosted cutover or physical-device acceptance. Prepare hosted work through the [forward-upgrade checklist](owner-pilot-data.md#import-schema-upgrades).

### Physical acceptance record

Run the device check on the exact installed candidate after deployment is separately authorized. Prefer a synthetic history exported by the actual RENPHO app. If that export route is unavailable, record the limitation; a hand-authored CSV does not establish actual app sharing compatibility. Keep real files, readings, identifying filenames and account details out of public evidence.

1. Record the deployed commit, manifest and active/waiting worker versions, Android/browser/RENPHO versions, export layout, MIME and locale.
2. Receive cold and warm shares. While signed out, sign in and explicitly choose the destination account. Review source, person assumption, timezone, counts and exclusions, then confirm the import separately. Verify picker fallback and no automatic Ask request.
3. Check the latest event's actual fields, separately dated per-metric readings, a historical comparison and the truthful reference state. Review direct single/group proposals before approving synthetic goals; check their dated evidence and focus/navigation at narrow width and 200% text.
4. Reimport overlap and confirm no duplicates or baseline movement. On a disposable synthetic account, correct/delete a source reading and verify affected historical evidence/proposals become unavailable or require review. Check account export and deletion through the existing lifecycle procedure.
5. Check cancellation, offline/expiry guidance, status-first interrupted recovery and a waiting-worker update after windows close. Do not manufacture an uncertain commit on retained data. Observe touch targets, keyboard focus/status and any assistive technology actually used.

| Public record field       | Safe content                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------ |
| Candidate and environment | Commit, application/schema/worker versions; platform and app versions                                  |
| Input                     | Synthetic provenance, supported layout, MIME and locale; no filename or readings                       |
| Outcomes                  | Each journey separately `passed`, `failed` or `not_run`, observation date and a bounded description    |
| Limits                    | Untested devices, TalkBack/other assistive technology, hosted capacity and real-app export limitations |
| Inference                 | Actual request count/spend if separately authorized; otherwise no inference performed                  |

An installed build or passing automated browser run does not populate this physical record.

## What is already recorded

| Record                                                                                                                                                      | What it covers                                                                                                                                                                     |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [Owner handoff](../evidence/owner-pilot-step5.md) and [device report](../evidence/owner-pilot-step4.md)                                                     | The owner's hosted use and the Galaxy S23 check                                                                                                                                    |
| [Provider evidence](../evidence/luna-owner-pilot-live.md), [v8 and v9](../evidence/luna-v8-v9-verification.md) and [v10](../evidence/luna-v10-technical.md) | Synthetic Luna checks. The v8 batch failed and v9 and v10 passed their technical controls. The owner deferred model benchmarks, so none of these establishes model answer quality. |
| [Historical local report](../evidence/release/m6-local.json)                                                                                                | A past local run. It is a record of that candidate, not a current pass.                                                                                                            |
| [Audit closure matrix](../evidence/audit-remediation-closure.md)                                                                                            | Status of audit findings F-01 to F-12 when the audit closed                                                                                                                        |

## Reproduce historical v0.1.0 local evidence

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

| Order | Group       | `--check` names                                                               |
| ----- | ----------- | ----------------------------------------------------------------------------- |
| 1     | Code        | `lint`, `typecheck`, `unit`, `build`, `bundle`, `spec`                        |
| 2     | Database    | `start`, `reset`, `upgrade`, `dbLint`, `dbTests`, `dbTypes`                   |
| 3     | Integration | `integration`, `integrationThreads`, `executions`, `evaluations`, `providers` |
| 4     | Lifecycle   | `cleanup`, `restore`                                                          |
| 5     | Browser     | `browser`, `development`, `pwa`                                               |
| 6     | Shutdown    | `stop`                                                                        |

The assembler writes `.scratch/release-evidence/m6-local.json`. Its inputs include the tracked acceptance map and the reviewed synthetic screenshot manifest. Records are local evidence tied to one candidate, not signed attestations. A check that was not run stays `not_run`. Do not publish private command output, logs or screenshots. The tracked report is a historical result.

### Troubleshooting a worker crash

If a Windows fork worker exits unexpectedly, keep that failed record. A crashed worker can leave the unique app-month fixture bucket behind, which makes later setup fail without exercising application behavior. Finish or stop the failed run, reset only the guarded disposable workspace with `--check=reset`, then run `--check=integrationThreads` on the same candidate. Record the fork failure as an environment limitation. A threaded pass does not erase it. Never reset the retained local or hosted personal database to recover a test run.

## Required deployment and pilot checklist

Before widening use, establish current evidence for the applicable scope:

| Area                      | Remaining work                                                                                                                                                                                                                                                                                                                    |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Review and acceptance     | Reconcile formal release criteria and open review decisions against the final candidate. A local result does not establish broader acceptance.                                                                                                                                                                                    |
| Providers                 | Prompt v10 has approved technical evidence and model benchmarks are deferred. Recheck rates, privacy, capability and budget controls before any later activation. Flash, Argon and decision scoring stay unavailable.                                                                                                             |
| Hosted application        | Verify routing, headers, auth, isolation, private storage, cancellation and budget exhaustion on the intended candidate.                                                                                                                                                                                                          |
| Recovery                  | Verify a current backup, independent copy, deletion journal and local reconciliation. Hosted restoration and cutover are deferred for the personal release; see [hosted recovery](hosted-recovery.md#hosted-restoration-and-cutover).                                                                                             |
| Operations                | Rotate encrypted backups manually and retain current keys and deletion receipts, as set by the [recovery targets](hosted-recovery.md#recovery-targets). There is no automatic scheduler.                                                                                                                                          |
| Devices and accessibility | The owner reported Galaxy S23 conversation, install and offline behavior. TalkBack and broader device and accessibility coverage are unverified.                                                                                                                                                                                  |
| Additional accounts       | [Synthetic account and recovery checks](../evidence/temporary-account-2026-11-10.md#merged-deployment-and-account-checks) cover the verified deployment. When adding an account, follow [account preparation](../setup/private-accounts.md#additional-account-preparation), including a fresh backup that covers the new account. |

A local report does not authorize deployment, paid inference, restored access or additional accounts.

## Gate dispositions for the personal-owner release

| Gate           | Disposition                                                                                                                                                                                                      |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AI-07          | Luna-first chat and bounded tool behavior remain required. The Flash handoff part does not apply while Flash is unavailable.                                                                                     |
| AI-09          | Flash escalation does not apply while the provider is unavailable. Keep the local denial, consent, budget and call-ceiling tests. Live escalation acceptance is required before any later activation.            |
| AI-08 / OPS-06 | Current-template Luna follow-up and tool quality, plus request, result and usage evidence, need separately approved paid verification. Historical prompt evidence cannot authorize a changed template.           |
| UI-03          | Automated label, focus and status coverage can pass locally. Physical TalkBack is unverified. Accepting a temporary owner-only exception needs an explicit owner decision and does not claim full accessibility. |
| Recovery       | A local synthetic restore is supporting evidence. A fresh owner backup, an independent copy and journal and accounting checks remain required. Hosted restoration and cutover are deferred.                      |

# Release readiness

The personal-owner handoff is complete. Broader release and family acceptance remain separate from the recorded local and hosted results. [Owner evidence](../evidence/owner-pilot-step5.md), [device evidence](../evidence/owner-pilot-step4.md), [provider evidence](../evidence/luna-owner-pilot-live.md), and the [historical local report](../evidence/release/m6-local.json) identify the candidates and scopes actually checked.

The [independent audit closure matrix](../evidence/audit-remediation-closure.md) records the status of F-01 through F-12 at the time of that audit. Current recovery and release scope is described below.

The 2026-11-05 [Luna verification record](../evidence/luna-v8-v9-verification.md) documents the failed v8 batch and passing v9 technical controls. The owner deferred model benchmarks. This disposition does not establish formal release acceptance or model answer quality.

## Reproduce local evidence

Use the pinned Node/npm toolchain, locked dependencies, Docker and Python. These commands prepare and test a disposable local Supabase project. Inspect the existing `.scratch/pr17-verification` before using `--sync`. Reset and upgrade are destructive inside that disposable project. Run database and browser checks serially and stop the stack even after a failure.

```sh
npm run evidence:release -- --prepare
npm run evidence:release -- --check=lint
npm run evidence:release -- --check=typecheck
npm run evidence:release -- --check=unit
npm run evidence:release -- --check=build
npm run evidence:release -- --check=bundle
npm run evidence:release -- --check=spec
npm run evidence:release -- --check=start
npm run evidence:release -- --check=reset
npm run evidence:release -- --check=upgrade
npm run evidence:release -- --check=dbLint
npm run evidence:release -- --check=dbTests
npm run evidence:release -- --check=dbTypes
npm run evidence:release -- --check=integration
npm run evidence:release -- --check=integrationThreads
npm run evidence:release -- --check=executions
npm run evidence:release -- --check=evaluations
npm run evidence:release -- --check=providers
npm run evidence:release -- --check=cleanup
npm run evidence:release -- --check=restore
npm run evidence:release -- --check=browser
npm run evidence:release -- --check=development
npm run evidence:release -- --check=pwa
npm run evidence:release -- --check=stop
npm run evidence:release
```

The assembler writes `.scratch/release-evidence/m6-local.json`; its inputs include the tracked acceptance map and reviewed synthetic screenshot manifest. Records are candidate-bound, local evidence, not signed attestations. Missing checks stay `not_run`; do not publish private command output, logs or screenshots. The tracked report remains a historical result, not a current pass.

If a Windows fork worker exits unexpectedly, preserve that failed record. A crashed worker can leave the unique app-month fixture bucket behind, causing later setup conflicts rather than exercising application behavior. Finish/stop the failed run, reset **only** the guarded disposable workspace with `--check=reset`, then run `--check=integrationThreads` on the same executable candidate. Keep the fork failure as an environment limitation; a threaded pass does not erase it. Never reset the retained local or hosted personal database to recover a test run.

## Required deployment and pilot checklist

Before expanding use, establish current evidence for the applicable scope:

| Area | Remaining work |
|---|---|
| Review and acceptance | Reconcile formal release criteria and outstanding review decisions against the final candidate; a local result does not establish broader acceptance. |
| Providers | Recheck the selected model, rates, privacy terms, capability and budget controls before any new activation. Flash, Argon and decision scoring remain unavailable. |
| Hosted application | Verify routing, headers, auth, isolation, private storage, cancellation and budget exhaustion on the intended candidate. |
| Recovery | Verify a current backup, independent copy, deletion journal and local reconciliation. Whole-project hosted restoration and cutover are deferred for the personal release; see [recovery](recovery-cutover.md). |
| Operations | Rotate encrypted backups manually within 30 days and retain current keys and deletion receipts. There is no automatic scheduler. |
| Devices and accessibility | The owner reported Galaxy S23 conversation, install and offline behavior. TalkBack and broader device/accessibility coverage remain unverified. |
| Family use | Pre-invitation preparation for the bounded family pilot is complete on the [verified deployment](../evidence/temporary-account-2026-11-10.md#merged-deployment-and-family-preparation), including the dated backup/copy checks. Follow [family account preparation](../setup/private-accounts.md#family-account-preparation) during onboarding for recipient identity, credential handoff, consent, approved allocations, device checks and a verified backup covering the invited accounts. |

The local report does not itself authorize deployment, paid inference, restored access or family use.

## Candidate dispositions

| Gate | Personal-owner release scope |
|---|---|
| AI-07 | Luna-first chat and bounded tool behavior remain required. The Flash handoff portion is not applicable while Flash is unavailable; it cannot be activated by this disposition. |
| AI-09 | Flash escalation is not applicable while the provider is unavailable. Keep local denial, consent, budget and call-ceiling tests; live escalation acceptance is required before any later activation. |
| AI-08 / OPS-06 | Current-template Luna follow-up/tool quality and request/result/usage evidence require separately approved paid verification. Historical prompt evidence cannot authorize a changed template. |
| UI-03 | Automated labels/focus/status coverage can pass locally. Physical TalkBack remains unverified; accepting a temporary owner-only exception requires an explicit owner decision and does not claim full accessibility acceptance. |
| Recovery | Local synthetic restore is supporting evidence. Fresh owner backup, independent copy and journal/accounting checks remain required. Hosted restoration and cutover are deferred. |

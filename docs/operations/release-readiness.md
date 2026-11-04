# Release readiness

The personal-owner handoff is complete. Broader release and family acceptance remain separate from the recorded local and hosted results. [Owner evidence](../evidence/owner-pilot-step5.md), [device evidence](../evidence/owner-pilot-step4.md), [provider evidence](../evidence/luna-owner-pilot-live.md), and the [historical local report](../evidence/release/m6-local.json) identify the candidates and scopes actually checked.

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

## Required deployment and pilot checklist

Before expanding use, establish current evidence for the applicable scope:

| Area | Remaining work |
|---|---|
| Review and acceptance | Reconcile formal release criteria and outstanding review decisions against the final candidate; a local result does not establish broader acceptance. |
| Providers | Recheck the selected model, rates, privacy terms, capability and budget controls before any new activation. Flash, Argon and decision scoring remain unavailable. |
| Hosted application | Verify routing, headers, auth, isolation, private storage, cancellation and budget exhaustion on the intended candidate. |
| Recovery | Rehearse current backup, independent deletion journal, accounting reconciliation and fenced restore. Source-loss completeness and access authorization remain separate; see [recovery](hosted-recovery.md). |
| Operations | Rotate encrypted backups manually within 30 days and retain current keys and deletion receipts. There is no automatic scheduler. |
| Devices and accessibility | The owner reported Galaxy S23 conversation, install and offline behavior. TalkBack and broader device/accessibility coverage remain unverified. |
| Family use | Verify identity, private credential handoff, consent, budgets, isolation, export, deletion and recovery before a separately authorized invitation. |

The local report does not itself authorize deployment, paid inference, restored access or family use.

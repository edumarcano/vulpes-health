# PR 10: execution inspector and Everyday integration gate

Branch `feat/pr10-execution-inspector` starts at PR 09 commit `1e6e96e`. Production inference remains unavailable. No real provider request, deployment or real health data has been used; actual inference spend is $0. Independent cumulative M3 review and live acceptance remain pending.

## Delivered boundaries

The authenticated inspector resolves an owned run and its steps before reading an explicitly permitted evidence part. It checks encryption, expiry, bindings and request hashes, validates tool evidence and projections, rechecks the binding after decryption, and reports unavailable, removed, incomplete or corrupt evidence honestly. Raw export preserves bytes; formatted JSON is separately labeled. Older context manifests are marked partial. New manifests include instructions, selection, goal context, history and tool results. The UI warns before copy or export, clears evidence on close and handles account changes.

The local synthetic evaluation checks E01–E10 controls and six adverse cases. Its [report](pr10-synthetic-evaluation.json) records `modelAssessment: not_run`: scripted controls do not establish real model quality or safety. The separately guarded verification path requires explicit spend authorization, verified model prices and capabilities, local synthetic data, an immutable per-batch allocation and existing ledger capture. The current catalog and capability evidence do not satisfy the live gate. A passing future smoke will still require independent evidence review before M3 acceptance or production activation.

A reproduced accounting regression allowed a violated provider/model route to become usable after old steps were removed. Migration 012 preserves a non-sensitive durable route block, backfills existing violations and checks both reservations and dispatch authorization. Clearing a block requires separate operator review. The populated upgrade preserved existing owners, data, runs and budget rows and backfilled the synthetic prior violation.

## Evidence observed

| Check | Result |
|---|---|
| Development browser | 17 passed with the synthetic API. The inspector journey verifies owned evidence, exact downloaded and copied bytes, sensitive-content confirmation, source calculations, account switching, zoom and Escape focus restoration. Inspected screenshots: [mobile light](pr10-inspector-mobile-light.png), [desktop dark](pr10-inspector-desktop-dark.png). |
| PostgreSQL integration | 150 passed across nine files. Focused verification tests exercised a fixed synthetic allocation, exact request bytes, shared cap, pending holds, cancellation and inconsistent answer rejection without external requests. |
| Database security | 620 pgTAP assertions across five files passed; schema lint and generated type check passed. |
| Populated upgrade | Twelve migrations applied; existing rows across 15 tables and both owners remained unchanged across PR 08 → 09 and PR 09 → 10. Existing route violation backfilled; atomic replay and real synthetic maintenance passed. |
| Unit and static checks | 297 unit tests, lint, typecheck, build, nine-file bundle scan and 487 specification checks passed. |
| Provider smoke | Synthetic adapters passed; actual provider requests 0, live smoke not run, inference spend $0. |
| Built-app browser | 100 passed against the built bundle through the loopback synthetic composition. |
| Standalone accounting proof | Two admissions, one budget denial and one loopback transport; captured bytes matched, conservative pending cost was retained and later corrected. Actual provider requests and spend were zero. |
| Synthetic evaluation | All 16 control cases passed; real-model assessment was not run. |

Retained failures: the route block disappeared after step cleanup before migration 012; a focused test reproduced it and passed after repair. The inspector header overflowed at 200% zoom, and Escape failed to restore focus; the corrected layout and explicit focus restoration passed the development-browser journey. One earlier browser run returned 503s for CSV previews; the isolated rerun passed all four affected tests. A subsequent browser and unit run overlapped on port 3001, causing unit `EADDRINUSE` and browser login timeouts; the stalled local child was stopped, its synthetic fixtures cleaned, and isolated reruns passed. Initial sandbox process spawning was denied; local checks were rerun with permitted process access.

## Review and remaining gates

The Remora split-axis self-review covered the working diff, untracked additions, contracts and affected callers. **Axis 1 — specification fulfillment:** no remaining locally demonstrated blocking finding; live model behavior and M3 acceptance are not established. **Axis 2 — engineering, security and standards:** no remaining locally demonstrated blocking finding after the durable route-block and focus fixes. The built and development interfaces, PostgreSQL transactions, upgrade and synthetic evidence were exercised as above. This self-review is not the required independent cumulative M3 review.

Commands: `npm run test:dev -- --diagnostic`, `npm run test:e2e -- --diagnostic`, `npm run test:integration`, `npm run test:db`, `npm run db:lint`, `npm run db:types:check`, `npm run test:execution-upgrade -- --allow-disposable-reset`, `npm test -- --no-cache`, `npm run lint`, `npm run typecheck`, `npm run test:bundle`, `npm run test:evaluations -- --write-report`, `npm run test:providers -- --write-report`, `npm run test:executions`, and `python docs/spec/v0.1.0/scripts/validate_spec_package.py`. The browser and bundle commands include builds.

Model prices, provider capability and privacy evidence, separately authorized guarded live tool-loop verification, and independent M3 review remain outstanding. Synthetic evidence is not live inference evidence.

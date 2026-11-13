# M0 reproducible probes

Run from the repository root with locked dependencies installed and Node 24. No package, lockfile or CI change is required. These sources are dated evidence tools, not Vulpes ingestion or an evaluation runner. Fixture-scoped `.gitattributes` preserves CSV BOM/CRLF bytes and hashes across checkouts.

```powershell
node docs/evidence/v0.2.0/m0-probes/verify-artifacts.mjs --fixtures
node docs/evidence/v0.2.0/m0-probes/verify-artifacts.mjs --capacity
node docs/evidence/v0.2.0/m0-probes/verify-artifacts.mjs --documents
node docs/evidence/v0.2.0/m0-probes/share-probe.mjs
```

| Probe | What a pass means | Limits |
|---|---|---|
| fixtures | Manifest/header counts, CSV hashes/grammar, exact independently authored values and strict timezone examples agree | No production adapter or classifier; invalid recipes are future M1 tests |
| capacity | Synthetic 1,000-event/24,000-value serialization and boundary measurements completed | Proposed compact shape; JSONB spacing estimate, not PostgreSQL; timings vary; no API/DB throughput |
| documents | JSON/scenario/hash/arithmetic/acceptance structure and local file links are coherent | Semantic correctness requires review |
| share | Actual worker POST, byte recovery, atomic claim/expiry/cancel, rejection and cache separation in fresh desktop Chrome | No installed PWA, Android share sheet, RENPHO export, auth/account/update/race acceptance |

The share probe requires an existing Chrome installation (`channel: 'chrome'`) plus the repository's Playwright package. It uses a fresh disposable browser context, synthetic bytes and its own ephemeral loopback port, closes browser/server on completion, and makes no external request. It never reads a personal browser profile. Missing Chrome is a reported prerequisite failure; do not silently download/install a browser or substitute source documentation for a pass.

The capacity probe uses a public synthetic key with a fresh nonce per counterfactual shape only for disposable sizing; it has no production encryption imports. Its count-boundary rows describe generated recipes, not transactional acceptance. `capacity-result.json` and `share-result.json` retain the 2026-11-13 run; serialization timing/browser version can vary on rerun. Source hashes and byte sizes should agree on the same versions. `source-inventory.json` lists public documentation inspection, not hosted or manufacturer device verification.

See [M0 readiness](../m0-readiness.md) for decisions, evidence boundaries, unresolved gates and the physical-device procedure. Do not run production, database or provider scripts to reproduce these probes.

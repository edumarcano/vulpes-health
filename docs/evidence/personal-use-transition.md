# Personal-use transition (2026-11-03)

The owner approved account changes, each project configuration change, staging and cutover separately. The existing account and infrastructure were retained. Personal identity values, credentials, health records and operator receipts remain private.

## Verified operations

| Operation | Observed result |
|---|---|
| Account identity | The existing Auth UUID received a verified personal email and display name through Auth administration and the owned settings interface. Fresh email/password sign-in passed. The password and server-controlled `owner-pilot` metadata were preserved. Product, consent, preference and financial fingerprints matched around the changes, excluding the intended display-name/timestamp/settings-receipt updates. |
| Supabase | The existing project is renamed `vulpes`, remains `ACTIVE_HEALTHY` in `us-east-1`. The scoped token's rename request returned 403; the owner completed the name-only dashboard change, followed by an independent readback. |
| Vercel | The existing project is renamed `vulpes`. Its Hobby plan, deployment protection, credentials and provider configuration were retained. `vulpes-health.vercel.app` was assigned and verified on that project. |
| Common CI repair | [PR #43](https://github.com/edumarcano/vulpes-health/pull/43) fixed synthetic fixture timestamps without changing production journal validation. Local PostgreSQL reproduced one invalid ordering in 100,000 rows. The native journal case, 24 journal units and all 245 backend cases passed. The owner merged the PR; all three [merged-main CI jobs](https://github.com/edumarcano/vulpes-health/actions/runs/41739344006) passed. |
| Frozen deployment | Candidate `7dc702ba93cdd07e7a09c52845deb404bd4391f5`: 492 Git files plus one generated hosting overlay matched. CLI 62.5.0 dry-run inventory rehashed 471 upload files / 7,851,445 bytes with no forbidden private path. No credentials were copied into the candidate. |
| Staging | The staged production deployment reached READY in `iad1`, with automatic domain assignment disabled. The candidate used build/runtime origin overrides for `https://vulpes-health.vercel.app`; only that new address was assigned for verification. Old addresses retained their previous routing until cutover approval. |
| Cutover | Production `VULPES_APP_ORIGIN` now names the new address. Vercel's promote endpoint returned 409 because the tested deployment was already current; no rebuild or replacement was made. The primary old address returns 307 to the new address with path/query preserved. The secondary generated alias has the new redirect configured but retains its existing Vercel sign-in protection; unauthenticated requests reach that protection first. |
| Hosted regression | Both staged and post-cutover runs passed 14 public routing/header/cache/unauthorized probes, owner UUID/display metadata, foreign-origin denial, synthetic-peer login and mobile Data/Goals/Settings, dark Ask, logout/reload, seven loaded script responses against service-key/trace-key/password canaries, zero page errors/sends and unchanged financial fingerprints. Owner health values were not read. |
| Rollback | The previous immutable deployment remains READY. Rollback can restore old-domain routing and the previous public origin configuration; no backup restoration or data rollback was performed. |

The archive SHA-256 is `f63f6dbcc2dd946f0aee172475ad50fe3c79f2c9f6cbf13cc33a39cd986f7b21`; generated configuration SHA-256 is `a853363d512ffc73086ef5feeb975c1834a75d5f0e1fbac42a0f5cf89d077652`. Private operator helpers passed strict TypeScript checks and rejected missing approval input before credentials/network. Vercel's function packaging emitted additional TypeScript library/type diagnostics; the guarded build, CI and actual hosted checks passed. No compatibility repair was introduced on that evidence alone.

## Remaining boundaries

Supabase Auth Site URL read/write is unavailable through the scoped token; the available browser has no signed-in dashboard session. After the dashboard instructions, the owner confirmed that sign-in works at the new address and that the PWA was reinstalled. This is owner-attested completion of the Auth URL/sign-in and PWA checkpoint; the Auth configuration was not independently read back. Keep the existing narrow Redirect URLs unchanged; no wildcard or new callback flow is required. Broader physical-device and accessibility acceptance was not repeated.

The [RENPHO adapter PR #44](https://github.com/edumarcano/vulpes-health/pull/44) is separate and unmerged. Its synthetic adapter evidence does not establish hosted compatibility or authorize a private preview/import. It was excluded from this deployment.

Both Remora self-review axes found no blocking defect for the completed operational steps. The authenticated secondary-alias redirect remains unverified; owner sign-in and PWA completion are attested above. No agent model requests, health imports, goal activations, migrations, private backup operations, credential rotation, paid upgrade or additional paid spending occurred. Existing financial history, consent, caps and uncertain-charge policy remain in force; this transition is not formal release/invited-account acceptance or restored-access authorization.

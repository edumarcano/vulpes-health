# PR 04: authenticated shell and private payloads

Baseline: clean `main` at `bc490e4` (merged PR 03), 2026-10-24. Implementation branch: `feat/pr04-auth-private-payloads`. Synthetic local accounts and data only; no hosted service, inference, real data, or deployment. Actual spend: **$0**.

## Checkpoint evidence

| Checkpoint | Observed evidence |
|---|---|
| Contracts/auth | 80 initial focused unit tests, lint and typecheck passed. Server verifies bearer tokens through real Auth and derives owner identity; public liveness remains minimal. |
| Settings | Seven real local HTTP/Auth/RPC tests passed initially. Replay, stale/concurrent edits, provider consent, foreign origins, size limits and direct-write denial are exercised. |
| Private payloads | Initial combined integration suite: 62 tests passed. Exact binary/UTF-8 round trips, tampering, foreign/purpose denial, exact read-expiry boundary, bounded cleanup and reference clearing pass. |
| Offline regressions | Final complete suite: 208 unit tests passed, including stale-render request and mutation-cache commit guards. |
| Database | Clean reset applied all four migrations. PostgreSQL lint, generated type drift check and 413 pgTAP assertions passed. Final real integration suite: 63 tests passed. |
| CLI | Actual `maintenance:cleanup` returned `{"removed":0,"batches":1,"batchLimit":100,"maxBatches":100,"scope":"local_synthetic_private_payloads"}`; a separate integration case verifies nonempty cleanup and its database effect. |
| Browser | Final compiled preview: 35 tests passed, including 200% login/Settings text at all five viewports in light/dark themes. Real `dev:full` save/consent/reload proof also passed. Selected synthetic screenshots were visually inspected. |
| Public output | Final production build and six-file bundle scan passed with provider/admin/current/previous-key secret canaries. Source maps, server catalog and synthetic harness markers are absent. |
| Provider boundary | Default synthetic harness passed all four roles, reported zero actual provider requests and $0 inference spend. Live roles remain unavailable/disabled. |
| Specifications | Final validator: 469 specification/fixture checks passed. |
| Cleanup | Final database inspection returned `auth_users=0`, `profiles=0`, `payloads=0`, `usage_buckets=0`. `npm run db:stop` succeeded; subsequent Docker inspection found no running Supabase containers. |

Commands actually run: `npm install --save-exact @supabase/supabase-js@2.118.0`, `npm run lint`, `npm run typecheck`, focused and full `npm test`, `npm run db:start`, repeated clean `npm run db:reset:test`, `npm run db:types`, `npm run db:types:check`, `npm run db:lint`, `npm run test:db`, focused and full `npm run test:integration`, `npm run test:e2e`, `npm run test:dev`, `npm run test:bundle` (which runs `npm run build`), `npm run test:providers`, `npm run maintenance:cleanup`, `npm run db:stop`, `python docs/spec/v0.1.0/scripts/validate_spec_package.py`, Git diff checks and local Docker metadata/cleanup-count queries. The pinned install reported zero audit advisories. Browser runners build and start the actual Node/Vite interfaces, not a mocked application.

Rendered proof: [mobile Settings](pr04-settings-mobile.png), [Settings with 200% text](pr04-settings-zoom.png), [login with 200% text](pr04-login-zoom.png). All accounts and displayed settings are synthetic. UI proof includes actual authenticated API/RPC persistence, reload, explicit consent acceptance/revocation, A/B switching, cross-tab sign-out, failed remote logout, delayed GET/PATCH responses and conflict refresh. Traces/video and automatic failure screenshots are disabled; no credential-bearing artifact is committed.

## Failures and repairs

| Finding | Classification and resolution |
|---|---|
| Branch creation, native test processes and Docker access denied in the sandbox | Host restriction; reran named authorized operations with execution approval. No product/test bypass. |
| Empty-input crypto assertion searched for an empty plaintext substring | Test defect; assert ciphertext exclusion only for nonempty input. Empty-byte round-trip and nonce checks remain. |
| Generated optional PostgreSQL UUID argument did not accept TypeScript `null` | Type mismatch; omit the optional argument to use its SQL null default. |
| Timezone hint participated in the input's label | Browser-reproduced accessibility defect. Moved the hint into `aria-describedby`; retained exact-label assertions. |
| Units control failed exact label lookup | Browser-reproduced label association defect. Used an explicit label/control ID; retained exact-label assertions. |
| Direct RPC accepted PostgreSQL `Factory` timezone, rejected by Node's IANA validator | Reproduced through real PostgREST before repair. Compared both local timezone catalogs; `Factory` was the sole mismatch. The RPC now rejects it. |
| Malformed request target escaped the local router | Regression test reproduced uncaught `Invalid URL` before repair. Router returns a safe JSON 400. |
| A stale render could start a request after cleanup; a later mutation callback could rebuild an old cache | Failing production-helper regression reproduced an old-token request succeeding after identity change. Requests now require the captured render epoch before transport; mutation cache updates also commit only under the current epoch. Both boundaries have regression assertions. |
| Browser runs before label repairs | First: 16/17 passed; expanded: 31/35; after timezone repair: 34/35. Remaining failures were the reproduced control-label defects, not waived tests. |
| Expanded Settings 200% text checks overflowed at four narrower viewports in both themes | Reproduced in eight browser cases. Made Settings grid tracks shrinkable and long text wrap, without clipping or hiding content; exact overflow assertions retained. |

## Split-axis self-review

Reviewed the actual tracked/untracked change surface against `bc490e4`, including new migrations, handlers, SDK configuration, services, browser state, tests, documentation and synthetic screenshots. No subagents were used; these are self-review verdicts, not independent reviewer approval.

**Axis 1, specification fulfillment: Approved.** The approved PR 04 scope is implemented. Real local Auth verifies identity; owned settings persist through a narrow transaction; unprovisioned/deleting identities are denied at the API; public signup remains denied; profile/consent changes survive reload; identity transitions remove old caches/drafts and reject obsolete work; encrypted payloads preserve exact bytes, reject tampering/foreign access and enforce expiry before physical cleanup. Provisioning and key/retention procedures are documented. No later health, accounting, inspector or operational workflow is represented as complete.

**Axis 2, engineering/security/test assurance: Approved with observations.** Ordinary reads use user-scoped clients/RLS. Settings RPCs derive `auth.uid()` and lock the profile; privileged payload functions are service-role-only. Search paths and grants are explicit. Crypto uses authenticated native primitives with bounded expansion and versioned recoverable keys. Browser state has entry, response and mutation-commit identity checks. Boundary tests and actual API/database/browser artifacts support the conclusions. Demonstrated blockers listed above were repaired and affected checks rerun.

Test assurance samples: an old consent acceptance after revocation traverses the real HTTP handler/RPC and must return 409 without changing authoritative consent; a foreign payload ID traverses the production store and must return `not_found` while direct PostgREST remains denied; the real cleanup CLI removes its seeded expired envelope and a subsequent production read reports missing; stale render/response/commit tests fail if old identity work can reach transport or rebuild a cleared cache. UI tests expose label and overflow defects instead of weakening selectors/assertions.

Nonblocking observations and unverified boundaries:

- Vite reports a roughly 994 kB uncompressed application chunk; no performance acceptance threshold is violated. No speculative bundle refactor was added.
- Docker Desktop's previously recorded host-port exposure remains an environment limitation. This stack is disposable/synthetic, and is stopped after verification; no global firewall/runtime change was made.
- Production Auth-origin CSP configuration and actual hosted routing remain a separately authorized deployment gate. Current static production CSP fails closed for external Auth connections.
- SEC-06 is verified at persisted consent/policy boundaries; paid admission and live-provider enforcement are later gates. TRACE-02 transport capture and inspector expiry rendering are not claimed from encryption tests alone.
- SEC-07 covers implemented settings/drafts and the shared abort/epoch/stream-consumer boundary. Production conversation streams/charts/traces do not exist yet and must retain this protection when introduced.
- Family invitation/recovery, full export/deletion, backup/restore, hosted maintenance, real data and live providers remain unverified/unapproved. Physical-device keyboard and full screen-reader conformance were not established by Chromium emulation.

M1 local foundation gates pass cumulatively with merged PR 03. PR 04 remains **Locally verified**, pending PR review/integration. No release, deployment or family-readiness claim. No approved scope deviation.

# Owner-pilot Step 3D.4A: independent deletion journal

Date: 2026-11-01. Branch `feat/owner-pilot-recovery-journal`, based on PR #29 at `060a50ad1e950596b5d92cfeab3b6475a476eccb`. The owner requested continued implementation with stops only for a ready PR or necessary owner involvement. This packet prepares the independently retained deletion evidence required for recovery; no hosted journal/database capture, restore or access activation occurred.

## Delivered boundary

`scripts/recovery-journal.ts` adds an inert plan, separately authorized read-only synthetic capture and offline validation. The command reuses the target manifest, deletion journal schema and authenticated encrypted archive. Capture approval binds the exact source and resolved output path, expiry and independent journal/separate key custody attestations. A single read-only PostgreSQL statement includes every unfinished/completed receipt, database time, synthetic Auth guard and empty Storage guard. Count/row agreement, limits and lifecycle/identity uniqueness prevent silent omissions. Ciphertext is written create-only; no plaintext, key or row appears in reports. Existing local backup/maintenance guards, application APIs, providers and infrastructure are unchanged.

Offline validation authenticates the bytes, source, lifecycle, freshness and supplied backup-time coverage before returning replay records to a trusted caller. The standalone CLI's safe report always leaves restore access unauthorized. This is a journal prerequisite, not a complete backup, current-completeness guarantee after source loss, or hosted-source restore proof. [The recovery runbook](../operations/hosted-recovery.md) defines custody and the remaining checkpoints.

## Observed verification

| Interface or check | Actual result |
|---|---|
| `npm test` | 431 tests across 35 files passed, including 24 journal cases |
| Focused new PostgreSQL/CLI integration | One test passed against a uniquely named disposable database inside the existing local Docker stack. The exact lifecycle migration supplied receipt DDL; minimal Auth/Storage fixtures exercised only the guard columns. Real SQL returned completed and unfinished receipts; before/after journal rows were identical; encrypted output validated through the actual private-stdin CLI with zero network requests and no identity/key in stdout/stderr |
| Real loopback HTTP | Passed; actual request serialization/path/read-only body and streamed response handling were exercised over an injected loopback transport, with no hosted fallback |
| Actual CLI plan | Exit 0; zero-network scope and limits printed without credentials |
| Actual CLI missing opt-in | Exit 1 before manifest/stdin/network, generic safe refusal |
| `npm run typecheck`, `npm run lint` | Passed |
| Specification validator / `git diff --check` | 520 checks passed; no whitespace errors |
| Refusal/retention proof | Wrong source/output hash, expired/overlong approval, missing custody attestation, extra credentials, real identities, Storage objects, truncated/count-mismatched/oversized/non-JSON/error responses, duplicate/invalid receipt lifecycle, write-to-existing output, wrong key/purpose, corruption, stale/pre-backup journal and ambiguous CLI modes refused |
| Freshness regression | Exactly five-minute-old empty source snapshot was accepted by capture but rejected by verification. The added test failed before repair; aligning capture's inclusive stale boundary made the same test pass in the final full unit suite |
| Initial local environment failures | Managed sandbox denied Vite child-process/Docker access; normal approved local execution passed without changing assertions. CLI help initially attempted an out-of-workspace telemetry write; rerunning with telemetry disabled succeeded |
| Initial retained-root SQL probe | Refused because the retained local stack omits `storage.objects`. No source query or schema guard was weakened. A uniquely named disposable database with explicit Auth/Storage fixtures proved the exact query and preserved all retained root data. Only that test database and its own synthetic temporary files were removed |

The source query reads Auth email classification counts and deletion metadata only. No hosted request, original-account change, source reset, backup export, deployment, provider request, paid spending, real health data or optional-model activation was involved. Raw failed diagnostics and local operational artifacts remain ignored.

## Split-axis self-review

**Axis 1, requirements:** Prepared for the named independent-journal checkpoint. Actual SQL, HTTP and offline CLI evidence covers capture/validation mechanics and refusal gates. Hosted operation, separate durable key/journal custody, compatible database capture, fenced restore, post-backup replay, source-loss completeness, session revocation and human/device/formal acceptance remain unverified. No local result is labeled a hosted acceptance pass.

**Axis 2, engineering/security:** Target/output/mode/expiry gates precede source reads. Fixed read-only SQL, single-snapshot inventory, strict bounded schemas/body, no redirects/cookies, create-only output, authenticated source binding and generic CLI errors preserve isolation and privacy. Existing encryption/deletion contracts are reused without new runtime dependencies or public administration routes. No demonstrated blocking defect remains in this packet; the reproduced freshness defect and initial environment/probe failures are retained.

Next implementation packet is compatible encrypted database capture and fenced restore preparation. It can proceed without owner involvement. Once that procedure is concrete, the owner checkpoint selects independent journal and separate recoverable key custody and approves the bounded source-read/output/fenced-rehearsal scope at $0 paid spending. An isolated five-minute journal capture is unnecessary before the remaining implementation is ready. No dashboard work or new token is necessary for the journal action. Keys will be generated/handed off privately only after custody choices. No automatic merge or restored-access authorization.

# Owner-pilot Step 3D.4B: encrypted database and fenced restore preparation

Date: 2026-11-01. Branch `feat/owner-pilot-database-recovery`, based on PR #30 at `398b13837b81e6a92418b8abfe02f7a9e4eaae98`. The owner requested continued implementation, stopping only for a ready PR or necessary owner action. No hosted capture, restore, resource change, provider request, real data or paid spending occurred. The original source identities and all retained Luna state remain untouched.

## Delivered behavior

`recovery:database` provides separately authorized synthetic capture and fenced local restoration. Capture binds the source/connection/CA/output/expiry, uses verified TLS and read-only source transactions, compares before/after snapshots and encrypts a bounded schema-scoped PostgreSQL custom archive without a plaintext dump file. The authenticated bundle includes complete selected table counts/hashes, schema/security metadata, extensions and encrypted samples covering every present trace-key version; it contains no backup or trace key. Existing files and unsupported/incomplete sources fail closed.

Restoration authenticates first, creates a fresh cached-image container with network `none`, no ports/binds and no Auth/API service, checks empty state, restores transactionally, compares schema/owners/grants/RLS/rows/extensions and decrypts current/retained samples. It always stops the owned immutable container ID and never enables access. The result names current-journal completeness/replay, restored-session revocation, Auth/API compatibility and separate access approval as remaining gates. [The runbook](../operations/hosted-recovery.md) owns exact inputs, custody and future secure credential steps.

The existing local backup harness imports the original comparison queries from `recovery-inventory.ts`; its guards and operational behavior remain unchanged. New source SELECTs avoid temporary DDL; CHECK normalization occurs only in the fenced destination. Comparison additionally ignores database-catalog names when restoring the disposable named source into database `postgres`, while preserving logical object identity and security.

## Actual verification and retained failures

| Check | Observed result |
|---|---|
| Final complete offline unit suite | 447 tests across 36 files passed, including 16 new database recovery cases and the final CA binding assertion |
| Final certificate binding regression | The trust anchor was initially absent from connection approval identity. The unchanged added assertion failed, then passed after including the CA SHA-256; all 16 affected tests passed |
| Real local PostgreSQL and CLI | A complete schema clone from the migrated local stack, two new synthetic Auth/profile/conversation graphs and encrypted payloads under current/previous keys were captured. Exact source snapshot equality held after capture. Two actual restores passed full catalog/row/key comparison: one through the library and one through the real private-stdin CLI. Both had no network/ports, denied access activation and were independently confirmed stopped |
| Final focused integration | Database capture/restore and journal SQL/CLI tests both passed together. Only their uniquely named databases, temporary files and new synthetic containers/volumes were removed; retained root data was not reset |
| Actual inert/refused CLI | Plan exit 0, zero source requests/credentials; capture without explicit opt-in exit 1 before manifest/stdin/Docker access |
| Static checks | Typecheck/lint and 522 specification/link checks passed; `git diff --check` passed |
| Legacy harness extraction | Executable comparison against parent `398b138` confirmed both original schema and row-inventory query strings are byte-identical; its local-only guards remain intact |
| Initial fixture clone | Restoring owner metadata as local `postgres` failed with `must be able to SET ROLE supabase_admin`; fixture restore now uses the existing local superuser, as the actual restore does. Product checks were retained |
| Read-only failure and repair | The inherited comparison helper's `CREATE TEMP TABLE` failed in a read-only transaction for both catalog and inventory. Exact local reproduction confirmed the error. Source paths now use SELECT-only catalog/XML count-hash queries; normalization is confined to the destination. The final real test passed under read-only source transactions |
| Init readiness failure and repair | The image's temporary initialization server accepted Unix sockets then shut down, producing `FATAL: the database system is shutting down`. Readiness now checks TCP loopback for the final server, without longer arbitrary sleeps or weakened assertions |
| Catalog mismatch and repair | Full comparison failed only in column/grant metadata. Private diagnostics identified `table_catalog` and `udt_catalog` differences between the generated source database and destination `postgres`. Only database-catalog identity fields were normalized; owner/grant/policy/constraint/row assertions remain intact and passed |
| Command-size preparation | Destination SQL uses stdin, including complete constraint metadata, rather than a large command argument; private SQL is absent from argv |
| Approval-review interruption | One test invocation was not executed because automatic approval review hit the workspace cap. After the owner confirmed refill, the same scoped verification was retried through ordinary approval review; no bypass was used |

The cached-image empty probe remains stopped with an ignored ownership receipt. Rehearsal containers created by the automated tests were stopped, checked and removed only by their generated owned names. Test-only diagnostic sinks retain raw failures/snapshots under ignored scratch; production CLI failures expose no SQL, identity, key or password. No cloud evidence is inferred from those local snapshots.

## Split-axis self-review

**Axis 1, requirements:** Prepared for encrypted schema-scoped capture and inaccessible local restoration. Actual complete local capture, two restored trace-key versions, strict metadata/rows and real CLI proof establish this scope. Managed source roles/permissions/TLS, actual hosted Auth/schema compatibility, independent current completeness/replay, session revocation, durable custody and access validation remain unverified. The installed CLI's default schema export was empirically shown to exclude Auth; the custom-archive choice still needs managed verification, not an assumption of compatibility.

**Axis 2, engineering/security:** Strict target/action/expiry/connection/certificate/output or archive/image bindings, verified TLS, minimal child environments, no password arguments, bounded data, authenticated bytes before restore and an immutable fresh-container identity preserve the boundary. The destination cannot egress, bind a host path, publish a port or reopen through this CLI. Logical normalization preserves the compared security/data meaning. No new dependency, migration, public endpoint or provider setting was added. No demonstrated blocking defect remains in the local packet; recorded failures are not relabeled as passes.

Next code packet is current-journal replay, session revocation and recovery validation while the destination stays fenced. It can proceed without new owner actions. Group custody/connection credentials and the bounded hosted source-read/fenced-rehearsal approval once that packet is concrete. No isolated capture or manual credential work is needed merely to complete this PR. Step 3D and real-data authorization remain incomplete; no automatic merge.

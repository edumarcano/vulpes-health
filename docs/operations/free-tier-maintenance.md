# Free infrastructure operating check

Run this manual check weekly, before release or a production migration, and after inactivity. The project uses Supabase Free and Vercel Hobby.

## Weekly procedure

1. Open the Supabase Dashboard and confirm the selected project reference. Check database size, total disk/WAL usage, egress and plan limits. Database bytes exclude some disk overhead; a small database does not establish safe disk headroom.
2. Review `npm run maintenance:status -- --plan --owner-pilot` (or `--invited-pilot`). The plan makes no requests. Prepare a private manifest naming the exact project and accounts, then approve its bounded read-only inspection. Supply the Management token and authorization through private stdin, never arguments or chat.
3. Inspect the aggregate report. Warning starts at 70% and critical at 85% of the configured capacity. Apply those thresholds separately to the Dashboard's total disk limit. The CLI reports disk as unknown because database size cannot establish it. Check the encrypted dump's separate 128 MiB tool limit before it prevents capture. Missing measurements require investigation.
4. If retention work is due, run `maintenance:hosted --inspect` with its existing explicit hosted/mode/manifest flags. Review `pendingHolds`, `retryAfter` and `unfinished`, then authorize a bounded execute if needed. Repeat only within that approval; never shorten accounting holds, reset balances or delete product history to make space.
5. Verify a complete encrypted snapshot within seven days and take a fresh approved capture before release/migration. Optionally give status inspection the existing archive, distinct independently stored copy and retained backup/trace keys. It authenticates equal ciphertext and all represented trace-key samples. It rejects a same-file/hardlink copy, corruption, expiry and wrong source; it does not prove off-site custody or restoration. A missing backup is unknown; a capture older than seven days is overdue.
6. Confirm the separate journal/key custody and a successful fenced reconciliation. Follow [hosted recovery](hosted-recovery.md) and [cutover](recovery-cutover.md). Keep database backups at most 30 days, completed deletion records at least 31 days and unfinished records until resolved. Remove old copies only under an approved rotation procedure.

Do not run `VACUUM FULL`, disable read-only protection or change a plan automatically. Ordinary deletion makes space reusable inside PostgreSQL but need not shrink allocated files. Investigate continuing growth and use the platform's current recovery guidance before corrective database operations.

## Status input and report

`maintenance:status --inspect --allow-hosted --manifest=<private-file>` requires the manifest's `--owner-pilot` or `--invited-pilot` mode; omit both only for a synthetic manifest. Private stdin contains `accessToken`, optional `backup`, and `authorization`. It sends exactly one fixed aggregate query with `read_only: true`; approval is rechecked after the response. Output contains counts, allowlisted relation names, sizes and hashes, never identities or health values.

| Field | Contract |
|---|---|
| Authorization | `purpose` is `synthetic-operations-inspect`, `owner-pilot-operations-inspect` or `invited-pilot-operations-inspect`; exact `targetSHA256`, `bindingSHA256`, `approved: true`, expiry within 24 hours |
| Binding | Compute `operationsStatusBinding(backup)` from `scripts/operations-status.ts`; binds resolved archive/copy path hashes and selected key IDs, or explicitly no backup |
| Optional backup | `archivePath`, `copyPath`, `keyId`, `backupKeyB64`, `traces: {keyId: base64Key}`; paths/keys stay private |
| Backup outcome | Authenticated timestamp/digest, seven-day freshness, verified sample key count and dump headroom; `restoreVerified: false` and `independentCustodyVerified: false` |
| Missing/invalid evidence | Missing backup/disk stays unknown. Invalid supplied material fails inspection; it cannot produce a healthy result |

## Returning after inactivity

1. Check Supabase status and the project's Dashboard before retrying writes. A paused or unavailable project is not evidence that an account was deleted.
2. If paused, review and approve resumption of that exact project. Use the Dashboard's Resume action. This is a cloud operation, not a CLI inspection. Keep the application and inference idle until the project is healthy.
3. Recheck the database/migration status, sign-in and synthetic isolation. Run the read-only status and maintenance inspections; review expired-data cleanup and unresolved holds before approving execute.
4. Verify backup/key/copy freshness and journal/accounting reconciliation. If the original project cannot resume, follow bounded recovery rather than importing an export or overwriting another database.

Pause/resume eligibility and quotas change. Consult [project pausing](https://supabase.com/docs/guides/platform/free-project-pausing), [database/disk sizing](https://supabase.com/docs/guides/platform/database-size) and [billing](https://supabase.com/docs/guides/platform/billing-on-supabase).

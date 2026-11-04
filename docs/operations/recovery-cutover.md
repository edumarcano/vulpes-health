# Recovery target and cutover gates

The v0.1.0 recovery-point target is a verified encrypted snapshot no more than seven days old, plus a fresh capture before release or a production migration. This is a manual target, not a measured service guarantee. The owner must adopt the reminder and authorize each operation involving personal data. Keep the existing 30-day backup maximum, independent deletion journal, separate key custody and accounting rules. No paid backup plan is enabled.

## Owner actions for the backup target

1. Add a weekly calendar reminder titled **Vulpes: approve and verify encrypted backup**. No scheduler has been installed by this change.
2. When it fires, review the inert `npm run recovery:database -- --plan --owner-pilot` and `npm run recovery:journal -- --plan --owner-pilot` output. Confirm the source, private output paths, independent copy location, key versions and available disk space.
3. Explicitly approve the exact owner-mode capture and journal operations described in [hosted recovery](hosted-recovery.md). Supply credentials through the protected private-input flow, never chat or command arguments.
4. Verify archive authentication, retained keys and the independently stored ciphertext copy. Record safe timestamps/digests, not records or credentials. A file that merely exists does not meet the target.
5. Perform the approved fenced restore/reconciliation checks. If capture, copy, key recovery or reconciliation fails, record the target as missed and keep release blocked. Rotate only under the existing approved retention procedure.

No fresh personal backup was taken during audit remediation. The dated historical capture does not establish the target is currently met.

## Synthetic return-to-service rehearsal

Local `backup:verify` exercises encrypted capture, separate-environment restore, tamper/missing-key denial, post-backup deletion, restored-session revocation and recovery with synthetic users. It does not create a Supabase project, repoint Vercel or establish source-loss completeness. Never relabel that local proof as a cloud cutover rehearsal.

The following cloud rehearsal requires explicit resource/configuration/deployment approval and must use synthetic data only:

1. Name a disposable source and a new empty destination Supabase project, allowed region, pinned application revision and separate Vercel rehearsal project. Keep both isolated from the personal application, with signup and inference disabled. Review possible infrastructure charges before creation.
2. Freeze synthetic source writes. Capture and independently copy the encrypted database, deletion journal and accounting evidence; retain all required keys separately. Record the final source watermark and prove there were no writes after it. Preserve the source for rollback.
3. Run the existing fenced restore and authenticated inventory checks first. They must prove schema/functions/grants/RLS/owners, rows, trace keys, deletion replay, session revocation and exact current accounting.
4. **Hosted restore tooling gate:** the current recovery CLI deliberately supports only a new fenced local destination. It cannot write a hosted destination or enable access. Before proceeding, review and approve a destination-bound hosted import mechanism that restores the complete Auth/public/Storage/migration state transactionally, refuses a nonempty destination and fails on ownership/grant/extension incompatibility. Do not pipe the local dump into production or remove incompatible objects to make it pass. This mechanism and managed-project compatibility remain unimplemented and block this rehearsal.
5. After that gate is satisfied, restore only to the approved empty synthetic project. Independently compare the authenticated inventory and reapply all journal obligations; revoke restored sessions. Keep access fenced and provider credentials absent.
6. Prepare a target-specific hosting configuration for the new rehearsal project. Update the bound Supabase URL, publishable key, server key, exact CSP origin, app origin, project ID and approved region together. Never repoint the personal project during the rehearsal. Run the exact-commit CI and schema build guards; authorize deployment separately.
7. Verify fresh sign-in, old-session denial, two-account isolation, measurement/goal/conversation reads, export, cancellation and budget denial with inference disabled. Verify the deleted synthetic account remains absent. Record time to service and errors; no recovery-time guarantee is assumed.
8. Revert the rehearsal binding to its known source deployment and verify it again. Obtain approval before deleting disposable resources or retained decrypted volumes. Record project/deployment identities and safe outcomes, including any failed step.

## Real incident or planned personal cutover

Stop writes before a planned cutover, keep the old app fenced, and obtain explicit approval for each personal-data operation and cloud change. Repeat the proven synthetic procedure against exact owner-bound manifests only after the hosted restore gate is implemented and rehearsed. Recheck the independent journal and accounting at the final source watermark immediately before opening access. Enabling access is a separate consequential approval; a `restoreAccessAuthorized: false` result cannot be overridden by a checklist.

After unplanned source loss, an older snapshot alone cannot prove that later deletions or charges did not occur. If independently current completeness cannot be established, keep restored access blocked. The weekly snapshot target accepts possible measurement loss; it does not waive deletion or financial integrity. No new service may be exposed by discarding receipts, shortening holds, resetting budgets or assuming missing source history is empty.

Before declaring v0.1.0 complete, record a successful approved synthetic cloud cutover, a fresh approved owner backup and independent copy, current deletion/accounting evidence and the owner's explicit release decision. Until then F-06 remains operationally open.

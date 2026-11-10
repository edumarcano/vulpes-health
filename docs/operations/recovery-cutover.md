# Recovery target and cutover

Keep a verified encrypted snapshot no more than seven days old and take a fresh capture before a release or production migration. Rotate backups within 30 days. Keep the deletion journal and backup, journal and trace keys separately.

## Backup procedure

1. Set a weekly reminder to approve and verify an encrypted backup.
2. Review `npm run recovery:database -- --plan --owner-pilot` and `npm run recovery:journal -- --plan --owner-pilot`. Confirm the source, private paths, copy location, keys and disk space.
3. Approve and run the capture and journal operations described in [hosted recovery](hosted-recovery.md), using private input for credentials.
4. Authenticate the archive and independent copy, verify retained keys, and perform the fenced restore and reconciliation checks. Record safe timestamps and digests.
5. If capture, copy, key recovery or reconciliation fails, record the target as missed and keep release blocked. Rotate copies under the existing retention procedure.

## Hosted recovery

Whole-project hosted restoration and cutover are deferred for the personal release. The existing tools restore into an isolated local destination; they do not import into a hosted project. Local `backup:verify` exercises encrypted capture and restore, tamper and missing-key rejection, deletion replay, session revocation and accounting with synthetic data.

Before relying on hosted restoration, implement and rehearse an import into an isolated destination, verify platform compatibility and service fencing, and test application behavior and rollback. For a planned cutover or source loss, establish current deletion and accounting completeness before opening restored access. If that completeness cannot be established, keep access blocked.

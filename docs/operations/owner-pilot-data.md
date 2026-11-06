# Personal-owner operations

The existing hosted personal application uses Luna with current OpenRouter consent, encrypted traces and persistent app/account budgets. The owner handoff and real-data import were completed; [evidence](../evidence/owner-pilot-step5.md) records the tested scope. The [personal-use transition](../evidence/personal-use-transition.md) records the current hosted address and cutover. Repository defaults and CI keep live AI disabled.

Production automation requires coordinated owner-approved activation of Vercel Git deployment and the main-only release gate; after activation, successful main commits deploy automatically. Follow [deployment activation and ordering limits](deployment-integrity.md). Backups and maintenance remain manual; no background scheduler is configured. Changes to resources, provider settings, budgets or account data require their appropriate owner authorization.

## Provider and budgets

The approved pilot uses Luna, per-request ZDR and `openrouter_zdr_v2` consent, including the documented screening/flagged-content exception. Flash, Argon and decision scoring remain unavailable. The recorded dedicated key cap is $0.50 without reset; the current pilot allocation was $0.10 per app/account month and $0.04 per run. Check actual remaining balances and holds before use; these historical allocations are not a promise of future capacity. A missing monthly bucket denies admission. Preserve spent and reserved amounts; do not reset holds or buy credit to continue.

A lost connection does not guarantee upstream cancellation. Reopen the saved conversation before considering another request. An unknown charge retains its reservation under the existing uncertainty policy. Provider verification and rate/privacy rechecks are described in [Luna verification](luna-verification.md).

At the current catalog bounds/rates, `reserveMaximum(models.everyday.price)` is exactly `$0.0093192` per request, including the existing safety margin and possible cache-write charge. Ten unresolved reservations total `$0.093192` of an illustrative `$0.10` monthly allocation; a multi-request run can reserve more. The audit's roughly `$0.0006` completed request is a historical example, not a guaranteed future cost. A dropped connection does not prove the provider stopped billing.

F-10 recommendation: retain the existing 24-hour full-reservation uncertainty policy and exact late-usage correction. First reduce avoidable interruptions through the streaming remediation and inspect saved run status before another send. If the allocation proves unsuitable, review actual usage/holds and request a specific owner-approved allocation change; do not shorten holds, under-reserve, auto-top-up or reset spent amounts. No financial policy or allocation was changed by this disposition.

## Maintenance and backups

Use a strict `owner-pilot` manifest naming the owner and at most one synthetic peer, and add `--owner-pilot` to the relevant recovery, journal and hosted maintenance commands. The owner account has the server-controlled `vulpes_data_scope=owner-pilot` marker; synthetic commands reject it. Do not use historical synthetic fixture plans for owner data.

```sh
npm run maintenance:hosted -- --plan --owner-pilot
npm run recovery:database -- --plan --owner-pilot
npm run recovery:journal -- --plan --owner-pilot
```

Plans are inert. Inspect hosted maintenance before a separately authorized bounded execute. Check `pendingHolds`, `retryAfter` and `unfinished`; future holds may remain when no work is currently due. Use the exact target, owner, action and expiry in the private authorization. Maintenance can resume an existing deletion; it cannot create a new deletion, reset budgets or rotate backups. Follow [account lifecycle](account-lifecycle.md) for retention and [hosted recovery](hosted-recovery.md) for capture, independent journal, key custody and fenced restoration.

Rotate encrypted backups within 30 days and verify independent ciphertext copies. Keep backup, journal and required trace-key versions separately recoverable. A copy is a snapshot, not an automatic backup; the post-import handoff predates later conversations. Before recovery, capture a fresh independent journal and reconcile current accounting. Missing source-loss completeness, keys or current evidence blocks restored access.

The [recovery target](recovery-cutover.md) requires a verified snapshot within seven days and a fresh approved capture before release/migration. The owner must adopt a manual reminder; no scheduler or personal-data backup was run during this remediation.

## Deployments and checks

The repository enables native Git builds only for `main` on the existing Vercel project at `https://vulpes-health.vercel.app`. Vercel must require `Main / Release gate` before assigning production domains. The gate succeeds only after all three main CI jobs succeed; PR checks retain separate identities. The build independently enforces production configuration, source metadata, approved inference and complete migration compatibility. Follow the [coordinated cutover runbook](deployment-integrity.md) before merging: both old deployment paths must be paused, and the native gate must be configured before Git deployment resumes. Repository changes alone do not prove cloud enforcement.

The root `vercel.json` binds the production project, Supabase origin, `iad1` region and existing Luna pilot mode. The build rejects preview environments, Git builds from other branches, wrong project/origin bindings and missing server configuration. Keep credentials in Vercel's Production environment; the repository contains only public target identifiers. Deployment runs the application build and does not apply database migrations, reset data or call a model. Review and apply required migrations separately before merging dependent code.

After deployment, check `/api/status`, sign-in, routing and the affected feature. Keep the previous immutable deployment available for rollback. Local checks do not prove Vercel packaging or production behavior.

For separately authorized manual/synthetic hosting, `npm run hosting:prepare -- --plan`, `npm run hosting:probe -- --plan` and `npm run hosting:security -- --plan` describe the guarded tooling. Generated hosting overlays keep Git deployments disabled and default to inference off; Luna pilot mode requires its explicit mode and existing consent/budget gates.

The owner reported a Galaxy S23 conversation, installation and offline check. TalkBack and broader release/device acceptance remain unverified. See [release readiness](release-readiness.md) before broadening use or inviting family members.

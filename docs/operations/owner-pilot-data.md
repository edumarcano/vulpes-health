# Owner operations

This document covers running the hosted personal deployment: provider use, budgets, maintenance and deployment checks. Local development is in the [root README](../../README.md).

The hosted app uses Luna with the owner's OpenRouter consent, encrypted traces and persistent app and account budgets. The owner handoff and real-data import are complete; [step 5 evidence](../evidence/owner-pilot-step5.md) records the tested scope, and the [personal-use transition](../evidence/personal-use-transition.md) records the cutover. Repository defaults and CI keep live AI off.

Backups and maintenance are manual. No background scheduler is configured. Any change to cloud resources, provider settings, budgets or account data needs the owner's explicit authorization.

## Provider and budgets

| Item | Current setting |
|---|---|
| Model | Luna only. Flash, Argon and decision scoring are unavailable. |
| Privacy | Per-request ZDR routing and `openrouter_zdr_v2` consent, including the documented exception for provider screening and flagged-content retention |
| Dedicated key cap | $0.50 with no reset |
| Pilot allocation | $0.10 per app and per account each month, $0.04 per run |
| Missing monthly bucket | Denies admission |

The allocations were recorded for the pilot and may have changed. Check the actual remaining balances and holds before use, and never reset holds or buy credit to continue.

**Interrupted requests.** A lost connection does not guarantee that the provider stopped the request. Reopen the saved conversation before sending another. A charge of unknown size keeps its full reservation for 24 hours, and a late usage report corrects it exactly.

**Reservation size.** At current catalog bounds, `reserveMaximum(models.everyday.price)` is $0.0093192 per request, including the safety margin and a possible cache-write charge. Ten unresolved reservations total $0.093192 of a $0.10 allocation, and a multi-request run can reserve more. Completed requests usually cost far less (one audited request cost about $0.0006), but that is an example, not a guarantee.

**If the allocation is too small.** Review actual usage and holds, then ask the owner for a specific allocation change. Do not shorten holds, under-reserve, add automatic top-ups or reset spent amounts. [Luna verification](luna-verification.md) covers rate and privacy rechecks.

## Maintenance and backups

Use a strict `owner-pilot` manifest that names the owner and at most one synthetic peer, and add `--owner-pilot` to recovery, journal and hosted maintenance commands. The owner account carries the server-controlled `vulpes_data_scope=owner-pilot` marker, which synthetic commands reject. Never use synthetic fixture plans for owner data.

```sh
npm run maintenance:hosted -- --plan --owner-pilot
npm run recovery:database -- --plan --owner-pilot
npm run recovery:journal -- --plan --owner-pilot
```

Plans are inert. Run a hosted maintenance inspection first, and run a bounded execute only under a separate authorization that names the exact target, owner, action and expiry. Inspect `pendingHolds`, `retryAfter` and `unfinished` in the output. Future holds can remain when no work is due.

Maintenance can resume an existing deletion. It cannot start a deletion, reset budgets or rotate backups.

- **Backups and restore:** follow [hosted recovery](hosted-recovery.md), which owns the [recovery targets](hosted-recovery.md#recovery-targets), the independent journal and key custody. A copy is a snapshot, not an automatic backup. Before any recovery, capture a fresh journal and reconcile current accounting.
- **Retention and deletion:** follow [account lifecycle](account-lifecycle.md).
- **Weekly infrastructure check:** follow [free-tier maintenance](free-tier-maintenance.md). Its status command is read-only and cannot authorize cleanup, restore or access.

The owner adopts a manual reminder for backups. Missing keys, current evidence or source-loss completeness block restored access.

## Deployments and checks

Pushes to `main` deploy to the existing Vercel project at `https://vulpes-health.vercel.app` through Vercel's Git integration. Preview deployments are disabled, so verify pull requests on localhost with local Supabase and synthetic data.

| Control | Behavior |
|---|---|
| Release gate | Vercel requires the `Main / Release gate` check before assigning production domains. It succeeds only after all three main CI jobs succeed. |
| Build validation | The build checks production configuration, source metadata, approved inference and the complete set of required migrations. It rejects preview environments, other branches, wrong project or origin bindings and missing server configuration. |
| Bindings | `vercel.json` binds the production project, Supabase origin, `iad1` region and Luna pilot mode. Credentials stay in Vercel's Production environment. |
| Migrations | A deployment does not apply migrations, reset data or call a model. Review and apply required migrations before merging dependent code. |
| Logging | The build emits JSON stage markers and allowlisted error codes. Unknown errors use `hosted_build_unexpected`. Never log raw exceptions, environment values or database or provider responses. |

Repository changes alone do not prove that Vercel enforces these settings. Vercel owns promotion order and retries.

After a deployment, check `/api/status`, sign-in, routing and the affected feature. Keep the previous immutable deployment available for rollback. Local checks do not prove Vercel packaging or production behavior.

For separately authorized manual or synthetic hosting, `npm run hosting:prepare -- --plan`, `npm run hosting:probe -- --plan` and `npm run hosting:security -- --plan` describe the guarded tooling. Generated overlays keep Git deployments disabled and inference off by default.

The owner reported a Galaxy S23 conversation, install and offline check. TalkBack and broader device acceptance are unverified. See [release readiness](release-readiness.md) before widening use or adding accounts.

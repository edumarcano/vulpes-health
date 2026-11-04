# Personal-owner operations

The existing hosted personal application uses Luna with current OpenRouter consent, encrypted traces and persistent app/account budgets. The owner handoff and real-data import were completed; [evidence](../evidence/owner-pilot-step5.md) records the tested scope. The [personal-use transition](../evidence/personal-use-transition.md) records the current hosted address and cutover. Repository defaults and CI keep live AI disabled.

The owner manually maintains the application. No background backup or maintenance scheduler is configured. Do not change deployment, resources, provider settings, budgets or account data without the appropriate owner authorization.

## Provider and budgets

The approved pilot uses Luna, per-request ZDR and `openrouter_zdr_v2` consent, including the documented screening/flagged-content exception. Flash, Argon and decision scoring remain unavailable. The recorded dedicated key cap is $0.50 without reset; the current pilot allocation was $0.10 per app/account month and $0.04 per run. Check actual remaining balances and holds before use; these historical allocations are not a promise of future capacity. A missing monthly bucket denies admission. Preserve spent and reserved amounts; do not reset holds or buy credit to continue.

A lost connection does not guarantee upstream cancellation. Reopen the saved conversation before considering another request. An unknown charge retains its reservation under the existing uncertainty policy. Provider verification and rate/privacy rechecks are described in [Luna verification](luna-verification.md).

## Maintenance and backups

Use a strict `owner-pilot` manifest naming the owner and at most one synthetic peer, and add `--owner-pilot` to the relevant recovery, journal and hosted maintenance commands. The owner account has the server-controlled `vulpes_data_scope=owner-pilot` marker; synthetic commands reject it. Do not use historical synthetic fixture plans for owner data.

```sh
npm run maintenance:hosted -- --plan --owner-pilot
npm run recovery:database -- --plan --owner-pilot
npm run recovery:journal -- --plan --owner-pilot
```

Plans are inert. Inspect hosted maintenance before a separately authorized bounded execute. Check `pendingHolds`, `retryAfter` and `unfinished`; future holds may remain when no work is currently due. Use the exact target, owner, action and expiry in the private authorization. Maintenance can resume an existing deletion; it cannot create a new deletion, reset budgets or rotate backups. Follow [account lifecycle](account-lifecycle.md) for retention and [hosted recovery](hosted-recovery.md) for capture, independent journal, key custody and fenced restoration.

Rotate encrypted backups within 30 days and verify independent ciphertext copies. Keep backup, journal and required trace-key versions separately recoverable. A copy is a snapshot, not an automatic backup; the post-import handoff predates later conversations. Before recovery, capture a fresh independent journal and reconcile current accounting. Missing source-loss completeness, keys or current evidence blocks restored access.

## Deployments and checks

The hosted build requires an explicit target and inference mode. `npm run hosting:prepare -- --plan`, `npm run hosting:probe -- --plan` and `npm run hosting:security -- --plan` describe the guarded tooling without deployment. For an authorized deployment:

1. Copy `config/hosting-synthetic.example.json` to an ignored target file, fill the approved source, project, origin and region, then run `npm run hosting:prepare -- --target=<private-target-file>`. Inspect the generated configuration and migration hashes and review the exact pending migration dry run.
2. Export the reviewed Git candidate to an isolated directory, overlay its root `vercel.json` with the generated configuration and verify all other files against the candidate. Bind the hosted build to that target; owner Luna mode requires `--mode=owner-pilot-luna` and its independent provider, consent and budget gates.
3. Retain production-only server secrets, run the deployment CLI from the isolated candidate directory, and verify the intended deployment, routing, security headers and public bundle before use. Hosted changes and paid requests need their own scope and approval.

The owner reported a Galaxy S23 conversation, installation and offline check. TalkBack and broader release/device acceptance remain unverified. See [release readiness](release-readiness.md) before broadening use or inviting family members.

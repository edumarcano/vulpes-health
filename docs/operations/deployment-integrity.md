# Native CI-gated production deployment

Vercel owns production builds, promotion and domain assignment. GitHub Actions owns synthetic CI. Vercel must require **`Main / Release gate`** as a Deployment Check before this flow is activated. Repository configuration alone does not install that cloud check.

A main push starts CI and a Vercel production build. The hosted build validates the bound project, production configuration, source metadata, approved inference mode and complete database migration set before building. It makes no GitHub API requests and needs no local `.git` directory. Vercel holds production promotion until the build and required release check succeed. The application retains its existing ownership, encryption, provider consent and budget controls.

## Release check

| Event | Job identity and behavior |
| --- | --- |
| Main push | `Main / Fast checks`, `Main / Backend integration checks`, `Main / Browser integration checks` run independently. |
| Main push, after all three jobs | `Main / Release gate` runs even after dependency failure and succeeds only when every dependency result is exactly `success`. Failure, cancellation, skipped or absent results cannot pass its shell check. |
| PR or manual CI | Existing validation names remain; the release job is named `No production release` and is skipped. Its result cannot satisfy the main-only check. |

Keep the three existing PR checks required by the main ruleset, require up-to-date PRs and prohibit direct/force pushes and deletion with no owner/admin bypass. Configure Vercel to require the release gate, never the old `deploy` job, a generic `CI` status or the PR validation jobs. A passing gate proves the tested main commit; Vercel owns check-status interpretation, retries, supersession and promotion ordering. This replaces the custom latest-attempt/current-main protocol and promotion journal. It makes no absolute zero-window promise about concurrent merges or owner overrides. Do not use Force Promote to bypass a failing gate.

## Coordinated cutover (owner approval required)

This PR enables native Git deployment **only for main** and removes the custom workflow. Do not merge it while the current deployment paths are active. The following operations change cloud configuration and are separate from preparing the PR.

1. Pause merges. Disable repository variable `VULPES_AUTODEPLOY_ENABLED` and disconnect the existing Vercel Git integration. Do not delete the project, domains, deployments, secrets or database. Inspect Actions and Vercel for active builds/promotions; allow them to finish and verify consistent production aliases. Resolve any outstanding old `vulpes-promote` intent with the [previous reviewed recovery procedure](https://github.com/edumarcano/vulpes-health/blob/d9fbbc18576abed7196af57138f6f6ab67b5729b/docs/operations/deployment-integrity.md#failure-supersession-and-rollback) before abandoning that journal. Preserve its records. Keep the existing healthy production deployment serving.
2. After separately approving merge, merge this PR with Git still disconnected. Wait for all main CI jobs and `Main / Release gate` to pass. Record that merge SHA. Keep the existing three PR ruleset requirements; their names have not changed.
3. In Vercel **Settings > Build and Deployment > Deployment Checks**, choose **Add Checks > GitHub > Select checks to add**, enter the merge SHA and show all checks. Require only **`Main / Release gate`**. Verify it is listed as required before reconnecting Git. If GitHub import requires an active Git connection, stop: first set **Ignored Build Step** to **Don't build anything** and save, then reconnect and configure the check while builds remain disabled. Restore the prior ignored-build setting only after verifying the required check. Do not bypass the check to bootstrap.
4. Confirm Production tracks `main` and automatic production domain assignment is enabled. Confirm the configured build command still invokes `build:hosted` with the reviewed target and inference mode. Reconnect Git only after the gate is configured (or use the disabled-build sequence in step 3). Inspect any deployment that reconnection creates before requesting another. Verify the expected project and immutable source SHA.
5. Perform the separately approved live verification below. Do not declare cutover complete from local tests or a green PR. Only after successful verification, remove the unused Vercel `VULPES_GITHUB_READ_TOKEN` and its GitHub token, the GitHub production environment's `VERCEL_TOKEN`/`VERCEL_TEAM_ID`, and the obsolete automation variable. Check they are not shared with another consumer before removing or revoking them. Retain application, database and provider credentials.

If any check, ordering or access behavior is unsupported, keep builds paused and the healthy deployment serving. Do not substitute PR-only checks or silently return to unrestricted production publishing.

## Live verification and rollback

Cloud behavior remains **unverified by repository tests**. With explicit owner approval, use reviewed synthetic-only changes and no provider requests or health-record reads:

| Scenario | Required observation |
| --- | --- |
| Required main job fails or is skipped | Release gate fails; new artifact never receives the production application domain. |
| Gate is missing, pending or cancelled | Production promotion remains blocked. PR success alone cannot release it. |
| All three main jobs succeed | Gate succeeds; Vercel releases that same SHA after its guarded build succeeds. |
| Required check is rerun and fails | Record whether Vercel uses the current result; never assume an already-promoted artifact will be automatically rolled back. |
| Two main commits overlap | Record build/check SHAs and final production alias; confirm Vercel's ordering is acceptable and does not roll production back to the older artifact. |
| Hosted configuration or schema check fails | Build fails with a safe diagnostic; existing production remains serving. |

Verify final deployment ID/SHA, application-domain assignment, `/api/status`, sign-in and deep-link routing. The `/api/status` check does not test model quality or authorize inference. Apply no migrations as part of deployment.

To stop future releases, disconnect Git or use **Don't build anything**; inspect already-running builds/promotions because neither action recalls accepted work. With separate owner approval, use Vercel's existing healthy production artifact for rollback and independently verify aliases. Follow Vercel's rollback/re-promotion procedure before resuming automatic releases. No custom journal repair or automatic rollback script remains in the new flow. Historical unresolved promotions must be reconciled before cutover, not ignored.

## Build diagnostics

The CLI emits JSON stage markers for `configuration`, `source`, `schema` and `application`. Failure reports include only a stage and an allowlisted literal code; unknown errors become `hosted_build_unexpected`. Never add raw error messages, stacks, validation inputs, environment values, database bodies or provider responses to these logs.

| Diagnostic | Action |
| --- | --- |
| `hosted_project_mismatch`, `hosted_origin_mismatch` | Compare nonsecret target/project/environment/origin settings. |
| `owner_pilot_inference_unverified`, `owner_pilot_credential_missing` | Inspect the current approved catalog/evidence and production-only credential configuration. Do not bypass approval or initiate paid verification. |
| `deployment_source_missing`, `production_branch_required` | Inspect Vercel's Git SHA/ref metadata; build only the intended main source. |
| `hosted_schema_unavailable` | Check service-role RPC access and database availability without printing credentials. |
| `hosted_schema_incompatible` | Compare migration inventory; obtain separate approval for any missing migration. |
| `hosted_schema_evidence_invalid` | Inspect the schema RPC contract; malformed migration evidence is refused. |
| `hosted_build_failed` | Inspect preceding application typecheck/build output. |
| `hosted_build_unexpected` | Use the last stage marker to narrow the boundary; add a reviewed literal diagnostic if further investigation requires it. |

The diagnostics do not establish the cause of the earlier generic hosted-build failure. It may persist after simplification. A read-only configuration reproduction is `npm run build:hosted -- --project-ref=abcdefghijklmnopqrst --project-id=prj_Synthetic --app-origin=https://vulpes-synthetic.vercel.app --check-only` with no hosted credentials: it exits 1 and emits `configuration` / `hosted_project_mismatch` before network access.

Local checks: `npm test -- tests/unit/deployment-policy.test.ts tests/unit/hosted-build-diagnostics.test.ts tests/unit/hosted-schema.test.ts tests/unit/hosting.test.ts`. They exercise the real release shell with success/failure/skipped/cancelled inputs, real CLI diagnostics, synthetic schema responses and retained configuration guards. They do not prove Vercel check enforcement or domain ordering.

Sources: [Vercel Deployment Checks](https://vercel.com/docs/deployment-checks), [Git deployment](https://vercel.com/docs/git), [rollback](https://vercel.com/docs/instant-rollback).

## Migration-before-code gate

The build calls service-only `schema_version_v1()` on the bound Supabase project and requires every version in `supabase/migrations/`. A latest version alone cannot prove an older migration was applied. Missing RPC, unavailable database or malformed/missing versions blocks the build. Extra forward versions are allowed; this checks the migration ledger, not statement equivalence or manual drift.

1. Review `20261104000100_schema_compatibility.sql` and obtain explicit approval to apply this metadata-only migration to production. It adds no application data or table changes. Do not merge the dependent build guard first.
2. Use the existing reviewed Supabase migration process to apply the migration, then verify the RPC succeeds for `service_role` and fails for `anon` and `authenticated`. Never expose the service key in chat, arguments or browser/client configuration.
3. Compare the returned version set with the repository, including any other pending migrations. Keep future schema changes additive and compatible with the still-serving app; removing old interfaces requires a later, separately reviewed migration after old code is retired.
4. Merge the guard only after approval and confirmed migration availability. After approved automation activation, eligible merges deploy after CI; migration approval remains separate. Do not delete ledger rows or bypass the check to force a build.

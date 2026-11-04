# CI-gated automatic production deployment

After one-time approved activation, successful merges need no manual deployment approval. `.github/workflows/production.yml` runs only after a successful main-push `CI` run. It checks out that exact SHA, verifies the latest CI run and attempt and all three required jobs, then asks Vercel to build the same immutable Git SHA with production settings and automatic domain assignment disabled. Once READY, it verifies project, source, current main and CI again before requesting promotion of that artifact. It never pulls production environment files into GitHub.

| Required check             | Evidence                                                 |
| -------------------------- | -------------------------------------------------------- |
| Fast checks                | Successful job on the latest exact-main push run attempt |
| Backend integration checks | Same run, attempt and SHA                                |
| Browser integration checks | Same run, attempt and SHA                                |

PR checks, skipped jobs, failed/cancelled runs, stale trigger attempts, missing credentials and API errors cannot authorize deployment. Deployment jobs share one concurrency group with cancellation disabled: a newer run cannot interrupt a promotion request already in flight. Queued stale candidates fail the current-main check. A superseded build can remain staged without receiving production domains. Production continues serving the existing immutable deployment on failure.

`build:hosted` independently verifies the checked-out Git identity and CI inside Vercel. Its `--check-only` option validates environment shape without building or checking CI. The Git integration stays connected for source access, while `git.deploymentEnabled: false` prevents its direct deployment path from racing CI.

## One-time activation (explicit approval required)

Do not perform these cloud steps until the revised approach is approved. Do not merge without separate merge authorization.

1. Pause merges. In the existing Vercel project's **Settings > Git**, temporarily disconnect Git before any main push. Keep the existing production deployment serving. Do not delete the project, domains, environment variables or deployments.
2. In GitHub **Settings > Rules > Rulesets**, activate a rule for `main` with no bypass actors, including administrators. Require PRs, up-to-date branches and the three checks above from GitHub Actions; block force pushes and deletion. If the private-repository plan cannot enforce this, stop and resolve that limitation before merging.
3. In GitHub **Settings > Environments**, create `production`, restrict deployment branches to `main`, and use no required reviewers for ordinary releases. Add a least-privilege, expiring Vercel deployment token as environment secret `VERCEL_TOKEN` and the existing team's ID as environment variable `VERCEL_TEAM_ID`. Restrict the token to the existing project/team as far as the account permits. Do not paste credentials into chat. Keep repository variable `VULPES_AUTODEPLOY_ENABLED` unset until step 6.
4. In Vercel Production only, add `VULPES_GITHUB_READ_TOKEN`: a fine-grained GitHub token limited to this repository, **Contents: read** and **Actions: read**. Set an expiry and rotation reminder. Retain existing production secrets and `npm run build:hosted` configuration. Keep production credentials out of previews and restrict settings/deployment access to the owner.
5. Inspect effective rules and their enforcement through GitHub's UI/API. After separately authorizing the PR merge, merge with automatic deployment still disabled. Wait for the resulting main CI to pass. Confirm the committed `git.deploymentEnabled: false` is effective when reconnecting Vercel Git, and that reconnection does not create a direct production deployment. If the platform cannot reconnect safely with deployments disabled, stop before reconnecting.
6. After approving automation activation and its first deployment, set repository variable `VULPES_AUTODEPLOY_ENABLED=true`. Re-run the successful main CI run to trigger the first automated release. No workflow-dispatch deployment path exists. Subsequent successful merges deploy automatically; migrations, provider activation, paid verification and financial changes retain separate approval requirements.
7. Inspect the Actions safe report (commit, CI run/attempt, deployment ID and `promotion: requested`). Confirm Vercel's staged deployment used the expected project, main SHA, production environment and no production domains before promotion. Confirm promotion completes and domains point to it; then check `/api/status`, sign-in and routing without reading health records or making Luna requests. Record identities and safe outcomes. These live checks remain unverified until authorized.

## Failure, supersession and rollback

Disable `VULPES_AUTODEPLOY_ENABLED` to stop future jobs, then inspect running jobs before any emergency rollback. A job already started is not stopped by changing the variable. Cancellation cannot recall an API request Vercel has already accepted. With owner approval, use Vercel's existing immutable healthy deployment for rollback; do not weaken the current-main check to rebuild an old commit. Resolve in-flight promotions before rollback so automation cannot overwrite it. Retain prior deployments and all existing resources.

There is no cross-service atomic operation that compares GitHub main while Vercel assigns domains. The last current-main/CI check rejects supersession detected before promotion; a merge or cancellation arriving after that check can race the accepted promotion request. Serialized jobs prevent an older automation job overwriting a newer automated release, but do not prove an absolute zero-window supersession guarantee. If that literal guarantee is required, activation remains blocked pending a separately designed merge/promotion coordination mechanism. Do not claim F-01 operationally closed until enforcement, staging behavior and the approved ordering guarantee have live evidence.

## Local evidence and sources

Run `npm test -- tests/unit/deployment-integrity.test.ts tests/unit/production-deployment.test.ts tests/unit/hosting.test.ts`. These use synthetic API responses and make no deployment requests. The CLI refuses invocation outside `workflow_run` before network access. Cloud enforcement, staging/domain behavior, token permissions and rollback remain unverified.

The implementation uses Vercel's [Git deployment API](https://vercel.com/docs/rest-api/deployments/create-a-new-deployment), its client's [`autoAssignCustomDomains` option](https://github.com/vercel/vercel/blob/main/packages/client/src/types.ts), and [staged production promotion](https://vercel.com/docs/cli/deploy). GitHub documents [workflow completion triggers](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run) and [deployment concurrency](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/control-deployments).

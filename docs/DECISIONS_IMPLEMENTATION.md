# Implementation decisions

The [product and architecture decisions](spec/v0.1.0/DECISIONS.md) are authoritative. This log records the implementation choices that shape ongoing operation, each with its reason. Dated blow-by-blow history is in [Git](https://github.com/edumarcano/vulpes-health/blob/e57c821/docs/DECISIONS_IMPLEMENTATION.md).

## Public source and licensing

- **License.** Vulpes uses Apache-2.0. Copied source and the Remora agent guidance keep their upstream MIT licenses and notices. The npm package stays `private` to prevent accidental registry publication.
- **What public evidence contains.** Technical results, dated candidates and verification limits. It leaves out personal usage, account balances and backup-custody details, which stay outside the repository. Cleaning up the public repository kept the existing Git history, so earlier operational metadata is still there.
- **Publishing is not activation.** Publishing source does not authorize hosted testing, deployment, provider usage or broader release acceptance.

## Owner pilot and providers

- **Luna-only hosted pilot.** The owner authorized a hosted pilot that uses Luna under current consent, trace encryption and persistent account and application budgets. Local defaults keep inference off. The server-side typed catalog owns models and limits. Flash, Argon and decision scoring each need separate evidence and approval.
- **Evidence binds a prompt version.** v7 evidence ([record](evidence/luna-owner-pilot-live.md)) cannot authorize a later template. The v8 synthetic packet failed, v9 passed its technical checks, and v10 passed on 2026-11-10 ([record](evidence/luna-v10-technical.md)). The owner approved the v10 production binding that day and deferred model benchmarks. Deployment is a separate decision.
- **Fail closed without evidence.** The committed owner-pilot-Luna mode refuses an entire new hosted build until matching passing evidence exists. The artifact already serving stays up.

## Ask behavior

- **Server-supplied dates (v8).** Requests carry the server instant and the owner's profile-local date. Read tools resolve local dates across DST on their own and return bounded validation feedback. Authorization, infrastructure and ledger errors still fail closed. Rejected tool input stays inspectable and exportable under the same encryption, hash and ownership checks.
- **Body-fat floor.** The owner approved an AI-only refusal of body-fat targets at or below 2%, including range boundaries and merged revisions. This is a conservative product rule, not a clinical safe range. Storage validation and direct owner entry are unchanged.
- **Interval mismatch (v9).** A correctly dated single-day query was once answered with a seven-day scalar. Tool projection 4 now withholds a scalar when the selection and calculation intervals differ, and prompt v9 requires the answer to state the limitation. The deterministic statistic is unchanged. See the [v8 and v9 record](evidence/luna-v8-v9-verification.md).
- **Shorter prompt (v10).** The prompt drops account selectors, sharing and data-entry inventory, which do not help the model do its task. It keeps authorized-tool use, server-supplied identity and permissions, and the wellness, data-grounding and goal-approval rules.
- **Streaming checkpoints.** Response checkpoints batch by time and size. Committed prefixes are written before emission and capture stays byte-exact, so valid text can be saved before a parser failure ends the run. The agent finalizes its own runs. Cancellation fencing and cleanup on iterator disposal are enforced. Step payloads share one database-clock expiry, so later writes cannot extend retention. Reads enforce expiry, ownership and decryption but never start cleanup, which stays with bounded maintenance.

## Deployment

- **Vercel Git deployment (2026-11-05).** The owner replaced the custom GitHub and Vercel promotion controller with Vercel Git deployment and a required `Main / Release gate` check. The check runs on pushes to `main` only, depends on all three CI jobs and needs every result to be `success`. Vercel owns publication and ordering. The build still checks production target, configuration, source metadata, inference approval and migration completeness, and emits safe diagnostics. The custom promotion journal, polling and GitHub read credential are retired. This trades custom latest-run guarantees for platform behavior and does not promise safety against every supersession window. [Owner operations](operations/owner-pilot-data.md#deployments-and-checks) owns the current guidance.
- **Production bindings.** The repository binds the existing production target and Luna mode, and credentials stay in Vercel's Production environment. Builds validate the project ID and configured application origin, not Vercel's preferred-domain metadata, which can name another verified alias. Deployments do not apply migrations or call a model.
- **Root `tsconfig.json`.** Vercel's function compiler reads the root `tsconfig.json`, which extends the server configuration. Target and module settings are explicit at the root because Vercel applies ES2021 and non-strict module defaults before it resolves inherited settings. This keeps ES2023 library declarations and strict union narrowing during packaging.
- **Migration inventory.** Hosted builds require every repository migration version, read through a service-only RPC. An exact required set catches older missing migrations that a maximum-version comparison would miss, and extra forward versions allow additive rollout. This is ledger evidence, not proof against manual schema drift. Apply the introspection migration before merging dependent code, and keep future migrations compatible with the app still serving traffic.

## Recovery and data scope

- **Owner scope.** Owner-data capture, journal and maintenance use explicit owner manifests and a server-controlled data-scope marker. Synthetic operations reject the marked owner. Backup, journal and trace keys stay separately recoverable. Restores are fenced, reconcile independent deletion and accounting evidence, and never authorize access. See [hosted recovery](operations/hosted-recovery.md).
- **Invited-pilot manifest.** Invited-account operations use an `invited-pilot` manifest with at most ten owner, invited and synthetic identities, set through `ownerUserId`, `invitedUserIds` and `syntheticPeerUserIds`. Each operation needs its own authorization and does not discover accounts. Inviting accounts is a separate decision.
- **Clean break (2026-11-10).** The new manifest contract replaces the named-account one with no runtime aliases, legacy readers or SQL migrations. Removed flags, purposes and UUID fields fail closed, and owner and synthetic manifest hashes are unchanged. Local inspection found no old manifests or archives, and the hosted check records temporary-account cleanup and owner-mode backup custody. Hosted metadata and external private custody were not re-inspected, and no live transition was made. Confirm any required legacy recovery state before retiring the old tooling or changing live markers. The [implementation plan](https://github.com/edumarcano/vulpes-health/blob/ed62dbecfb3292187300a42cc042030e8cb40bd7/docs/plans/invited-accounts-clean-break.md) is kept at the reviewed revision.
- **Seven-day snapshot target.** A manual seven-day snapshot target and a pre-release capture requirement were added without changing the 30-day retention ceiling. Hosted whole-project restoration is deferred for the personal release. Missing source-loss deletion or accounting completeness blocks restored access.
- **Accounting fingerprint.** The original fingerprint query selected the wrong XML root, so its historical match results did not prove freshness. The corrected query and synthetic regressions require current independent reconciliation before anyone relies on a result.
- **Infrastructure status.** A manual aggregate check and the existing maintenance process report database size and total disk use separately. Backup inspection authenticates the archive, copy and retained trace-key samples. It does not establish independent custody or a successful restore.

## Data and goals

- **Measurements.** Exact decimal values, provenance, original units and timestamps are preserved. Leap-second timestamps are rejected before JavaScript and PostgreSQL can read them differently. Daily goal totals use local-day bounds. Direct and chat goals share explicit approval, revisions and deterministic progress.
- **Measurement deletion.** Deleting a measurement also removes the owner's retained exact AI trace payloads. Conversations, accounting and frozen goal decisions keep their own contracts. The owner approved this for the documented synthetic cleanup only, not for future deletions in general.
- **RENPHO import.** The adapter accepts the documented English 31-column layout, imports weight and body-fat percentage through the existing preview and commit flow, and requires profile and timezone confirmation. See the [synthetic evidence](evidence/renpho-import.md).
- **Import navigation.** After an import, the user picks a series to open. The range comes from full-batch metadata and covers at most 366 local days ending at the latest imported observation. This avoids inferring the series from the truncated preview or changing filters before the user chooses.

## Retention and spending

- **Account deletion.** Deletion is resumable and keeps uncertain charges until settlement. Completed deletion receipts last at least 31 days, and encrypted database backups last at most 30 days. [Account lifecycle](operations/account-lifecycle.md) owns the details.
- **24-hour uncertain-charge policy.** The conservative full-reservation hold for an interrupted request stays. The single-request reserve is $0.0093192, and lowering it because most requests cost less would remove the bounded-cost guarantee. Streaming repairs and saved-run inspection are the smallest nonfinancial mitigation. Any allocation or settlement-policy change needs separate owner approval.

## Client delivery (2026-11-06)

- **Deferred features.** Protected pages and assistant Markdown load on demand, and React has one shared chunk. The service worker precaches public and offline shell assets only and leaves application JavaScript and CSS to browser caching. This avoids downloading unused features at install time and keeps the offline page free of data.
- **Bundle limits.** Bundle checks cap JavaScript chunks at 500 kB. Production browser checks cap initial sign-in JavaScript at 750 kB (220 kB gzipped).
- **Build scripts.** npm approval covers only the locked esbuild 0.28.2 install script.

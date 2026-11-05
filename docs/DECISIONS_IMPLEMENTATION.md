# Implementation decisions

The [product and architecture decisions](spec/v0.1.0/DECISIONS.md) remain authoritative. This file records implementation choices that affect ongoing operation. Detailed dated implementation history remains in [Git](https://github.com/edumarcano/vulpes-health/blob/e57c821/docs/DECISIONS_IMPLEMENTATION.md).

## Owner pilot and providers

The owner authorized a Luna-only hosted pilot under current consent, trace encryption and persistent account/application budgets. Local defaults remain inference-off. The server-side typed catalog owns models and limits; Flash, Argon and decision scoring require separate evidence and approval. [Provider evidence](evidence/luna-owner-pilot-live.md) records the bound v7 verification and its limitations.

Audit remediation grounds v8 requests in the server instant and owned profile-local date. Read tools resolve local dates independently across DST and return persisted, bounded input-validation feedback; authorization, infrastructure and ledger errors still fail closed. Authentic rejected tool input remains inspectable/exportable under the same encryption/hash/ownership checks, and typed error output retains strict contract and provider-projection checks. The owner approved an AI-only refusal of body-fat targets at or below 2%, including range boundaries and merged revisions. This is a conservative product rule, not a clinical safe range; storage validation and direct owner entry remain unchanged. Existing v7 evidence cannot authorize a later template. The v8 synthetic packet subsequently failed, and the v9 correction remains unverified. The committed owner-pilot-Luna mode refuses the entire new hosted build until matching passing evidence exists; the current production artifact remains serving.

Streaming response and message checkpoints batch by time/size while retaining committed prefixes before emission and byte-exact capture. The agent owns run finalization for its dispatches so valid parsed text can checkpoint before a parser failure makes the run terminal. Cancellation fencing and iterator-disposal cleanup remain enforced. The existing provider timeout and accounting policy remain unchanged. Step payloads reuse one database-clock expiry, so later writes cannot extend retention. Payload reads enforce expiry/ownership/decryption without starting physical cleanup; bounded maintenance retains that responsibility.

After separately approved cloud activation, ordinary successful main merges deploy automatically through a serialized CI-completion workflow. It stages the exact verified Git SHA without assigning domains and rechecks current main and CI before promotion. A durable GitHub deployment intent precedes submission; verified terminal alias/production-target success closes it. Every execution reconciles unresolved intent before staging. Failure, timeout, ambiguity or partial mapping requires reconciliation, never an automatic retry or rollback. GitHub's workflow token needs deployment-record write access; Vercel's separate GitHub token stays read-only. Cross-service supersession during the promotion request remains a documented limitation. Git auto-deployment is disabled in the repository because PR requirements alone do not prevent Vercel racing main-push CI. The build refuses missing, pending, failed, skipped or cancelled exact-main CI evidence. Protected-branch enforcement, journal permissions and cloud activation require separate owner approval; [deployment instructions](operations/deployment-integrity.md) define the boundary. PR verification uses local Supabase and synthetic data.

The repository binds the existing production target and Luna mode, while credentials remain production-only in Vercel. Builds validate the project ID and configured application origin rather than Vercel's preferred-domain metadata, which can name another verified alias. Application deployments do not apply database migrations or run model requests.

Hosted builds require the complete repository migration version set from a read-only, service-only RPC. An exact required set catches older missing migrations that a maximum-version comparison misses; additional forward versions permit additive rollout. This is migration-ledger evidence, not proof against manual schema drift. The introspection migration must be approved and applied before merging dependent code. Future migrations must preserve compatibility with the app still serving traffic.

## Recovery and data scope

Owner-data capture, journal and maintenance use explicit owner manifests and a server-controlled data-scope marker; synthetic operations reject the marked owner. Backup, journal and trace keys remain separately recoverable. Restores are fenced, reconcile independent deletion and accounting evidence, and do not authorize access. See [recovery](operations/hosted-recovery.md).

The original accounting fingerprint query selected the wrong XML root, so its historical match results did not prove freshness. The corrected query and synthetic regressions require current independent reconciliation before operational reliance.

Audit F-06 adds a seven-day manual snapshot target and a pre-release capture requirement without changing the 30-day retention ceiling. Cloud restoration/cutover remains a distinct unverified gate; the existing fenced local restore cannot enable a hosted destination. Missing source-loss deletion/accounting completeness must still block access. No personal backup, recurring scheduler or cloud resource change is implied by the runbook.

## Data and goals

The 2026-11-05 synthetic v8 verification exposed a correctly dated single-day query answered with a seven-day scalar. Tool projection 4 withholds scalar values when the selection and calculation intervals differ; full evidence and historical projections remain inspectable. Prompt v9 requires an explicit limitation. This preserves the existing deterministic statistic rather than inventing a new day-mean contract. [Verification evidence](evidence/luna-v8-verification.md) records the failed batch and pending live recheck.

Measurements preserve exact decimal values, provenance, original units and timestamps. Unsupported leap-second timestamps are rejected before JavaScript and PostgreSQL can interpret them differently. Daily goal totals use local-day bounds. Direct and chat goals share explicit approval, revisions and deterministic progress.

Deleting a measurement also removes the owner's retained exact AI trace payloads; conversations, accounting and frozen goal decisions follow their existing contracts. The owner approved this consequence for the documented synthetic cleanup, not as a general approval for future deletions.

The RENPHO CSV adapter accepts the documented English 31-column layout, imports weight and body-fat percentage through the existing preview and commit flow, and requires profile and timezone confirmation. [Synthetic evidence](evidence/renpho-import.md) records the tested scope.

Import completion offers explicit navigation per series using full-batch metadata, with at most 366 local days ending at the latest imported observation. This avoids inferring the series from the truncated preview or changing the user's filters before they choose a series.

## Retention and PWA

Account deletion is resumable and preserves uncertain charges until settlement. Completed deletion receipts persist at least 31 days; encrypted database backups have a 30-day maximum. The PWA caches public shell assets only. [Account lifecycle](operations/account-lifecycle.md) owns the current details.

Audit F-10 retains the approved conservative 24-hour uncertain-charge policy. The current single-request reserve is `$0.0093192`; reducing it because ordinary requests often cost less would lose the existing bounded-cost guarantee. Streaming repairs and saved-run inspection are the smallest nonfinancial mitigation. Any allocation or settlement-policy change requires separate owner approval.

# Implementation decisions

The [product and architecture decisions](spec/v0.1.0/DECISIONS.md) remain authoritative. This file records implementation choices that affect ongoing operation. Detailed dated implementation history remains in [Git](https://github.com/edumarcano/vulpes-health/blob/e57c821/docs/DECISIONS_IMPLEMENTATION.md).

## Owner pilot and providers

The owner authorized a Luna-only hosted pilot under current consent, trace encryption and persistent account/application budgets. Local defaults remain inference-off. The server-side typed catalog owns models and limits; Flash, Argon and decision scoring require separate evidence and approval. [Provider evidence](evidence/luna-owner-pilot-live.md) records the bound v7 verification and its limitations.

## Recovery and data scope

Owner-data capture, journal and maintenance use explicit owner manifests and a server-controlled data-scope marker; synthetic operations reject the marked owner. Backup, journal and trace keys remain separately recoverable. Restores are fenced, reconcile independent deletion and accounting evidence, and do not authorize access. See [recovery](operations/hosted-recovery.md).

The original accounting fingerprint query selected the wrong XML root, so its historical match results did not prove freshness. The corrected query and synthetic regressions require current independent reconciliation before operational reliance.

## Data and goals

Measurements preserve exact decimal values, provenance, original units and timestamps. Unsupported leap-second timestamps are rejected before JavaScript and PostgreSQL can interpret them differently. Daily goal totals use local-day bounds. Direct and chat goals share explicit approval, revisions and deterministic progress.

Deleting a measurement also removes the owner's retained exact AI trace payloads; conversations, accounting and frozen goal decisions follow their existing contracts. The owner approved this consequence for the documented synthetic cleanup, not as a general approval for future deletions.

The RENPHO CSV adapter accepts the documented English 31-column layout, imports weight and body-fat percentage through the existing preview and commit flow, and requires profile and timezone confirmation. [Synthetic evidence](evidence/renpho-import.md) records the tested scope.

## Retention and PWA

Account deletion is resumable and preserves uncertain charges until settlement. Completed deletion receipts persist at least 31 days; encrypted database backups have a 30-day maximum. The PWA caches public shell assets only. [Account lifecycle](operations/account-lifecycle.md) owns the current details.

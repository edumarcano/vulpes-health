# Invited accounts: clean-break implementation plan

Status: proposed, 2026-11-10. Implementation has not started. This plan extends
[PR #70](https://github.com/edumarcano/vulpes-health/pull/70); it does not authorize
deployment, live account changes, private backup operations or paid verification.

## Outcome and boundaries

Replace relationship-based account terminology throughout current code and
documentation with **invited accounts**. Use **invited adults** for the initial
audience, **additional private accounts** for setup, and **invited pilot** for the
bounded operational scope. Invitations remain an operator decision: accounts are
manually provisioned and credentials delivered privately. This introduces no
invitation service, public signup, sharing role or account-management UI.

Keep the adult-only initial pilot, ten-identity operational limit, named ownership,
per-user consent, operator-controlled allocations, isolation, recovery, deletion
and onboarding gates. Broadening the wording does not approve children, public or
commercial use, medical use, additional recipients or new provider capabilities.

Provider API families, persisted provider continuation fields, CSS `font-family`,
font licenses and ordinary groupings such as acceptance-test families are outside
scope. Do not rewrite Git history or rename the PR branch merely to change its
historical name.

## Inspected baseline and consequences

The starting point is clean `docs/family-account-readiness` at
`9ef2f34cd1889a140d10fc37e81195eea2357bbd`, matching PR #70's remote head.
Its base is `main` at `5f636069f3f87e1d7d91d37659d3607154a22b53`.
The existing PR changes account setup and dated verification documentation; they
must be preserved while implementing this plan.

| Source | Finding | Implementation consequence |
|---|---|---|
| [Recovery targets](../../scripts/recovery-target.ts) | The named-account purpose and UUID field are parsed strictly and included in `recoveryTargetHash`. | A renamed manifest has a new hash; recreate approvals rather than translating them. Preserve owner and synthetic schemas and hash behavior. |
| [Database recovery](../../scripts/recovery-database.ts), [journal](../../scripts/recovery-journal.ts) and [archive](../../scripts/backup-archive.ts) | Scope purposes and target hashes are inside authenticated encrypted contents. | Old named-account archives cannot be renamed in place. New tooling rejects them. The encryption envelope and its version do not need redesign. |
| [Account setup](../setup/private-accounts.md) | Additional accounts use an Auth `app_metadata.vulpes_data_scope` marker; public signup is disabled. | Change the documented marker and synthetic fixtures. No application SQL schema change or generated database type change is indicated. |
| [November 10 evidence](../evidence/temporary-account-2026-11-10.md) | No additional real accounts were created; temporary synthetic accounts were removed. The retained backup and journals used owner mode. | A clean break appears feasible. This dated evidence does not establish the current inventory of private artifacts or hosted metadata. Confirm that inventory before retiring the old operational contract. |
| [System prompt](../../server/ai/prompts/everyday.ts), [versions](../../server/config/everyday-versions.ts), [production evidence](../../server/config/everyday-production.ts) and [hosting](../../scripts/hosting.ts) | Account wording is in the v9 prompt; hosted Luna builds require matching approved evidence. | Version the edited prompt. Existing v9 approval does not prove the changed template. An unverified replacement blocks a new hosted build. |

This assessment used source, tests, runbooks, Git state and read-only GitHub
metadata. It did not inspect live Auth metadata or private recovery files, execute
application tests, call a provider or spend money. Historical passing results are
inputs to planning, not new verification of the proposed implementation.

## Contract decisions

Use a direct replacement with no runtime aliases, dual readers, fallback parser,
SQL migration or general migration framework.

| Existing name | Replacement |
|---|---|
| Manifest `purpose: 'family-pilot'` | `purpose: 'invited-pilot'` |
| CLI `--family-pilot` | `--invited-pilot` |
| Manifest `familyUserIds` | `invitedUserIds` |
| `FamilyRecoveryTargetSchema` | `InvitedRecoveryTargetSchema` |
| Local `familyUuid` / `familyPilot` identifiers | `invitedUuid` / `invitedPilot` |
| Auth marker `vulpes_data_scope=family-pilot` | `vulpes_data_scope=invited-pilot` |
| Authorization and archive `family-pilot-*` purposes | Corresponding `invited-pilot-*` purposes |
| Report scope segments `family_pilot` | `invited_pilot` in the same report shapes |
| Current acceptance gate `F` | `I`, meaning required before inviting additional adults |
| `tests/{unit,integration}/family-recovery.test.ts` | `tests/{unit,integration}/invited-recovery.test.ts` |

Keep `ownerUserId`, `syntheticPeerUserIds`, account UUIDs, requirement IDs such as
`SEC-02` and `COST-06`, backup retention, journal freshness and authorization
expiry unchanged. Named scopes still require at most ten distinct UUIDs in total,
normalized UUID comparison, complete declared inventories or authoritative
completed-deletion proof, and explicit mutually exclusive CLI modes.

Retain the existing synthetic predicate: only absent/empty or `synthetic-only`
markers can qualify, together with the synthetic email requirement. An old or
unknown marker must remain nonsynthetic. Treating it as nonsynthetic grants no
membership or authority in the new manifest.

## Packet 1: establish that retirement is safe

Recheck the branch and inventory before edits. Compare the recorded account cleanup
and owner-mode backup evidence with current, privately held operational records.
If those records are insufficient, prepare a bounded read-only check of Auth scope
counts and privately held manifest/archive purposes. Keep UUIDs, credentials,
health content, archive bytes and custody paths out of the repository and output.
Do not infer scope from a filename, hostname or example email.

| Inventory result | Required action before operational cutover |
|---|---|
| No active old-scope accounts and no required old-scope artifacts | Proceed with the direct replacement. No migration or alias is needed. Keep owner/synthetic recovery material intact. |
| Old manifests or expired action approvals only | Create new manifests and independently approved action bindings when needed. Do not carry an old approval onto a new hash. |
| Active old markers or replaceable old-scope recovery material | Prepare a specific owner-approved marker update and fresh capture/journal/copy verification using the new manifest. Preserve all other metadata, retained keys and the working recovery route until replacement proof is complete. |
| A required old artifact is the only recoverable copy, or its source is unavailable | Block retirement of that recovery route. Retain the known working tool revision and keys. Assess a separately approved one-off offline conversion only if needed; do not silently add permanent compatibility code or discard the artifact. |

**Checkpoint:** record a non-sensitive inventory disposition in the implementation
decision log. An unresolved live inventory does not prevent local implementation,
but it prevents declaring the operational transition complete. No live mutation
or personal-data recapture is authorized by this plan.

## Packet 2: replace the operational contracts atomically

Update the target schema, helpers, all five operator entry points, encrypted bundle
and journal parsers, authorization purposes, plan output, errors and test fixtures
in one coherent code packet. Do not accept both spellings temporarily.

| Files | Work |
|---|---|
| `scripts/recovery-target.ts` | Rename the invited schema, UUID list, mode parameter and purpose generation. Preserve owner/synthetic parsing, serialization order and hashes. |
| `scripts/recovery-database.ts`, `scripts/recovery-journal.ts` | Replace named-scope authenticated purposes and report values. Retain target matching, authentication before restore, deletion/accounting reconciliation and fencing. |
| `scripts/hosted-database-recovery.ts`, `scripts/hosted-maintenance.ts`, `scripts/hosted-account-recovery.ts`, `scripts/operations-status.ts` | Replace flags and authorization allowlists, including forwarded flags on child commands. Unknown and mixed modes still fail before private input, requests or destination creation. |
| Renamed invited recovery suites; `tests/unit/hosted-account-recovery.test.ts`, `tests/unit/operations-status.test.ts` | Update markers, identifiers, fixture names and expected outputs. Preserve existing isolation, deletion, accounting, session-revocation and privacy assertions. |

Extend existing contract tests only where they distinguish a relevant failure:

- New scope succeeds with the explicit new mode and matching target/action binding.
  Duplicate, undeclared, excess or incorrectly classified identities still fail.
- Removed flags fail as unknown options. Removed purpose values and UUID keys fail
  strict parsing, including mixed old/new documents. No alias or auto-conversion
  can reach private input, network or restore creation.
- An authenticated old named-scope bundle/journal and an old action purpose are
  rejected. Tampered, expired, wrong-target and wrong-mode inputs remain rejected.
- Fixed synthetic and owner manifest examples retain their baseline hashes and
  recover through the existing paths. Derive expected hashes from the baseline,
  not the newly edited implementation.
- The invited integration fixture uses synthetic health content with two named
  identities and retained trace keys. The real capture/restore CLI must match
  catalog and rows, preserve the source, keep the destination fenced, avoid leaking
  keys/identities and report `restoreAccessAuthorized: false`.

**Checkpoint:** run the focused unit suites and typecheck below. Preserve removed
spellings only in targeted rejection fixtures and this dated mapping; their
presence is evidence of refusal, not a compatibility path.

## Packet 3: reconcile product wording, prompt and evidence

Update complete affected sections in present tense. Keep
[private account setup](../setup/private-accounts.md) authoritative for provisioning
and [hosted recovery](../operations/hosted-recovery.md) authoritative for manifests
and action contracts. Rename its heading to "Named invited-account operation
scope" and update every incoming anchor; add no legacy anchor aliases.

| Documentation or code | Required treatment |
|---|---|
| Root `README.md`, `AGENTS.md`, `docs/DECISIONS_IMPLEMENTATION.md`, `docs/plans/v0.1.0-execution.md` | Use invited-account terminology and record the clean-break decision, inventory disposition and prompt approval consequence. Keep release acceptance separate from the owner handoff. |
| `docs/setup/private-accounts.md`; operations `hosted-recovery.md`, `account-lifecycle.md`, `free-tier-maintenance.md`, `owner-pilot-data.md`, `release-readiness.md` | Replace current commands, fields, marker values, purposes, audience descriptions and links together. Preserve private credential handoff, consent, allocations and recovery prerequisites. |
| `docs/operations/luna-verification.md` | Describe the new template's actual evidence state and required verification. Keep v9 results dated and distinguish pending approval from a passing packet. |
| Specifications `README.md`, `PRODUCT_SPEC.md`, `DECISIONS.md`, `ARCHITECTURE.md`, `SECURITY_AND_PRIVACY.md`, `DEPLOYMENT.md`, `IMPLEMENTATION_PLAN.md`, `ACCEPTANCE_TESTS.md`, applicable account-privacy wording in `AI_SPEC.md` | Describe an owner and invited adults with independent accounts. Replace current `F` gate labels with `I` without changing row IDs, requirements or pass status. Preserve adult-only, operator-access disclosure and pre-invitation testing. |
| `server/ai/prompts/everyday.ts`, `tests/unit/chat.test.ts` | Replace "no family selector" with "no account selector"; retain isolation, no data sharing and no external connections. |
| `scripts/luna-evaluation.ts`, `docs/spec/v0.1.0/fixtures/eval-cases.json` | Keep E06 as an adversarial cross-account request using "another account's measurements"; do not remove the denial expectation or claim a new live result. |
| `scripts/release-evidence.ts` | Emit neutral invitation and additional-account limitations for future reports. Preserve report structure and readiness behavior. |
| Dated `docs/evidence/` narratives and descriptive JSON fields | Rephrase account-related descriptions neutrally while preserving candidates, dates, failures, spend, counts and limits. Describe an old command as the then-current named-account mode, rather than claiming the new flag ran. Never rewrite captured provider data, hashes or evidence bindings. |

Historical acceptance gate codes and exact bound artifacts may remain historical.
Where exact old syntax is necessary for provenance, link to the original pinned
Git revision rather than presenting it as a current command. Do not regenerate an
old report from a new candidate or change a failed/unverified result to passed.
In particular, keep the recorded hosted-restoration, cloud-readback and device
limitations in the November 10 evidence.

### Prompt version and deployability

Advance `everydayTemplateVersion` from v9 to v10, or the next unused version if the
baseline has moved. Update the focused prompt/version assertions, including
`tests/unit/ask-remediation.test.ts`. Do not relabel the v9 capability or production
evidence in `server/config/everyday-verification.ts` or
`server/config/everyday-production.ts` as a new passing result.

Until fresh evidence is approved, verify that the new candidate fails the existing
owner-pilot build check with `owner_pilot_inference_unverified`; leave those gates
enforced. Record this expected intermediate state in the affected tests instead of
making stale evidence appear current. The already deployed artifact continues to
serve, but merging an unverified template would prevent its replacement build.

Before making the implementation merge-ready, prepare the bounded verification
packet from [Luna verification](../operations/luna-verification.md). The inert
`npm run verify:luna -- --plan --technical-only` currently describes at most seven
requests and a `$0.0652344` reservation ceiling. Recompute current bounds and check
remaining key/app headroom. Obtain approval for actual paid dispatch and the new
template's activation before using protected credentials. Approval for earlier
templates is not reusable. Before an approved send, prepare fresh verification-only
capability evidence from current capability/privacy/rate checks so preflight can
accept the new template. Create a new production evidence record only after the
actual packet passes and the resulting evidence is reviewed and approved.

Use the existing technical-only route if approved; it covers E10/V03 and does not
newly assess E06 or model quality. Preserve the explicit model-benchmark deferral
without calling it passed. Do not expand this terminology change into a full model
evaluation, change models or rates, raise budgets or weaken the hosted build gate.
If paid verification is deferred, keep the implementation unmerged and report the
exact pending gate; local checks may still complete.

**Checkpoint:** inspect all affected documents and references, validate the spec
package, and verify local prompt/preflight/hosting tests. No paid execution is
part of the local checkpoint.

## Packet 4: prove the replacement and finish PR #70

Use the pinned Node/npm toolchain and existing dependencies. Run checks against the
actual implementation candidate. These commands are planned, not results of this
planning change:

```sh
npx --no-install vitest run tests/unit/invited-recovery.test.ts tests/unit/owner-recovery.test.ts tests/unit/recovery-database.test.ts tests/unit/recovery-journal.test.ts tests/unit/hosted-maintenance.test.ts tests/unit/hosted-account-recovery.test.ts tests/unit/operations-status.test.ts
npm run typecheck
npx --no-install vitest run tests/unit/chat.test.ts tests/unit/ask-remediation.test.ts tests/unit/luna-evaluation.test.ts tests/unit/live-preflight.test.ts tests/unit/production-transport.test.ts tests/unit/hosting.test.ts tests/unit/release-evidence.test.ts
python docs/spec/v0.1.0/scripts/validate_spec_package.py
npm run recovery:database -- --plan --invited-pilot
npm run recovery:journal -- --plan --invited-pilot
npm run maintenance:hosted -- --plan --invited-pilot
npm run maintenance:status -- --plan --invited-pilot
npm run account:recover:hosted -- --plan --invited-pilot
```

Inspect each actual CLI result: plans require no credentials or requests, use the
new scope where applicable, and preserve the operation's existing limits. Repeat
the five plan invocations with the removed flag: each must exit nonzero without
reading private input or contacting a service. Unit spies establish ordering;
process execution establishes the shipped CLI behavior.

Run local database proof through the existing disposable verification workspace,
following [release readiness](../operations/release-readiness.md). Inspect an
existing `.scratch/pr17-verification` before reuse. Use
`npm run evidence:release -- --prepare` for a new copy or the separate `--sync`
option for an inspected existing copy; confirm it matches the candidate and check
that stale files from the renamed test suites do not remain in the copy. Start and
reset only that disposable project with the guarded `--check=start` and
`--check=reset` commands. From that copy, run:

```sh
npm run test:integration -- tests/integration/invited-recovery.test.ts tests/integration/recovery-database.test.ts tests/integration/recovery-journal.test.ts tests/integration/recovery-replay.test.ts tests/integration/operations-status.test.ts
npm run test:evaluations
```

Stop the disposable stack with `npm run evidence:release -- --check=stop` from the
repository root even after failure. Never reset the retained local or hosted
personal database. These fixtures exercise SQL, encrypted capture and fenced local
restoration; they do not establish hosted return to service.

After the packets are integrated, run `npm run format:check`, `npm run lint`,
`npm test`, `npm run build` and `git diff --check` once on the final candidate.
On Windows, select installed Git Bash for the workflow-shell unit test as recorded
in the November 10 evidence. Existing CI supplies its normal integration/browser
checks; add no wording-only browser tests or new terminology scanner dependency.
Inspect Markdown paths and renamed anchors manually or with a local link check.

Review remaining `rg -n -i 'family|families'` matches across tracked paths, including
filenames. Classify each as an unrelated technical/grouping use, an exact historical
binding, a targeted rejection case or this dated plan. No current account-facing
prose, accepted contract, setup command or fixture identity should retain the old
relationship terminology. A global zero-match assertion would reject legitimate
CSS/provider vocabulary and is not the acceptance criterion.

Perform separate correctness/security and documentation/maintainability self-review
passes over the complete diff. Keep the work on PR #70 in coherent commits; update
its title and brief to describe the actual replacement only after implementation.
Do not report the plan as implemented or historical hosted checks as proof of the
new contracts. Do not merge or deploy under this planning request.

## Completion criteria and execution boundaries

| Criterion | Required evidence |
|---|---|
| Direct contract replacement | New mode works; old names fail closed; owner/synthetic hashes and recovery still work. No alias, SQL migration or compatibility layer was added. |
| Security and recovery preservation | Existing adversarial checks pass; real CLI synthetic capture/restore remains fenced and source-preserving; deletion, accounting and key checks remain enforced. |
| Coherent documentation | Current owners, product scope, gate labels, examples and anchors agree; history remains faithful and no acceptance status is upgraded by renaming. |
| Local verification | Focused checks, final static/unit/build checks, spec validation and actual CLI proof have recorded outcomes on the implementation candidate. |
| Operational transition | Packet 1 confirms no required legacy state, or a separately approved replacement is verified before retirement. Unknown state remains explicitly pending. |
| Merge readiness | New prompt evidence and activation disposition are approved and correctly bound; PR checks/review pass. Any paid or hosted step not performed remains unverified. |

Local code, tests, documentation and PR preparation can proceed after plan review.
Owner involvement is needed only for an actual private-state transition or fresh
paid/provider activation evidence that is required. This plan addition itself
changes documentation only and incurs zero provider requests or spend.

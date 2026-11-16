# v0.2.0 M4 goals and conversation

**Date:** 2026-11-15. **P4 base:** `c4d4cacd60ae7a7eeb8841b6d97776b872e7a326`. Group approval/UI and expanded conversation tools follow in P5â€“P7. Application provider requests/spend: **0 / $0**.

## Numeric goal contract

Direct goals use all 25 registry entries with resolved semantics and canonical units. Each supports increase, decrease and maintained-range targets. BMR and three target deltas remain raw-only. Representation bounds describe valid storage, not recommended targets; the body-fat floor remains an AI recommendation rule rather than a direct-entry range.

Baselines are reviewed and frozen. Latest evidence uses bounded owned reads, retains declared local-day ordering and rejects conflicting latest values. Current reads exclude future observations. Covered rolling evidence requires three observed days. The optional reviewed age policy uses elapsed days from the oldest contributing measurement; absent policy means dated evidence without a universal cutoff. Progress never completes, pauses or archives goals.

Progress separates actual change, unclipped directional percentage, maintained-range state, current condition satisfaction and freshness. Zero-distance percentages remain undefined even when the current condition can be established. Baseline evidence dates live inside references so existing correction/deletion redaction removes the new private copies as well.

| Acceptance | Verification status |
|---|---|
| AT-16 representation/eligibility across metrics and modes | Runtime tests and all 75 metric/mode SQL combinations passed |
| AT-16 direct approval/progress/freshness | Five numeric HTTP cases and seven built-Chrome goal journeys passed |
| AT-24 ownership/concurrency/query bounds | 925 pgTAP assertions and 63 affected HTTP cases passed across owning runs |
| AT-25 correction/deletion of dated baseline references | Actual approved revision/proposal references and value scrubbed after correction; progress requires review |
| AT-27 forward/fresh schema replay | Nine forward migrations and fresh replay passed in an isolated synthetic database; Auth and financial controls preserved |
| AT-17â€“20 groups and Ask | P5â€“P7 not implemented by P4 |

Hosted migrations, model activation, live evaluation, physical-device/accessibility acceptance and deployment remain separately gated. No prior model approval is extended by this record.

## Executed checks

The full 714-test unit suite, lint, formatting and all TypeScript projects passed. Bundle verification inspected 34 public files without server/private canaries; specification/fixture validation passed 625 checks. Database lint and generated-type comparison passed. Independent review approved both specification and engineering axes against the P4 base.

The guarded browser runner passed seven goal journeys, including mass, percentage-range and decimal-index creation, exact baseline review, zero-distance progress, later overshoot, approval/reload and account-switch handling. Existing narrow/desktop and light/dark screens remained usable at 200% text. The Ask journey initially reproduced the same early-UTC future-fixture issue as HTTP and passed after using completed days. These are automated Chrome observations, not physical-device or assistive-technology acceptance.

All 24 affected Data/measurement lifecycle browser checks also passed against the integrated P4 candidate, including comparisons, stale evidence navigation, second-60 validation, correction/deletion, export and narrow/desktop themes at 200% text.

Authenticated HTTP demonstrated a muscle-mass target, percentage range, decimal ratio/age targets, negative progress and 200% overshoot with clipped display, stale evidence withholding condition satisfaction, zero-distance satisfaction with undefined percentage, raw-only denial, foreign-source denial and direct body-fat representation below the AI recommendation floor. Correction removed the frozen value and dated references from both approved revision and proposal copies. Current-value reads excluded future measurements; UTC, fractional-offset and DST daily boundaries passed.

Reproduction found a revision-preparation race returning invalid input instead of conflict, and a new 200-reference preparation limit preventing explicit pause of historical 201-reference goals. Both are repaired. Historical retention requires the exact owned approved current baseline and is bound again to the locked target at registration/approval; new replacement and create-time reuse remain bounded. Existing tests now assert dated current evidence rather than an artificial whole-history selection. Rolling journey fixtures use three completed days so an early-UTC run does not accidentally include a future observation.

Reproduce the real HTTP paths with `npm run test:integration -- tests/integration/numeric-goals.test.ts tests/integration/goals.test.ts tests/integration/chat-goals.test.ts tests/integration/measurement-lifecycle.test.ts tests/integration/analysis.test.ts` against the documented disposable local stack. Browser proof uses `npm run test:e2e -- --goals-proof` through the guarded synthetic runner. The older destructive goal-upgrade runner was not run against retained verification accounts; populated/fresh replay used the isolated database rehearsal instead.

## Atomic groups (P5)

**Base:** `71a2caecf62d60e548b42750c9fd6bec67ef1942`. P5 adds group contracts and authenticated reads/proposals to the existing Goals/Approvals routes. Members link exact approved versions/revisions or use ordinary server-prepared child definitions. One parent approval commits every child and ordered membership, or rolls all effects back. Group progress checks a shared data revision/clock and all child versions; it exposes independent outcomes without an aggregate percentage. P6 owns direct group UI and P7 owns conversation tools/checkpointing.

Six real group HTTP cases and twelve account cases passed. They exercised mixed child creation/revision/linking, explicit membership revision, duplicate/fifth/foreign-member denial, actual RLS/write/RPC denial, approval retries, stale child/data conflicts, rejection/expiry and archival after a child changed. Account deletion created active groups through real HTTP for two owners, removed the deleting account's groups/members and preserved the other account's data.

The 1,006 pgTAP assertions passed, including owner-composite links, private helpers/grants, nested historical parent redaction, unchanged foreign/unaffected copies, original approval hashes and export sections. A trigger deliberately failed the last child insertion: no earlier goal, revision or group survived, and the unchanged pending parent then approved successfully after the fault was removed. Direct deletion could not empty an active group or remove a required child.

Account export now uses schema 3 with 21 canonical sections. Recovery and hosted security inventories include the two new tables. All 116 affected legacy/isolation/recovery HTTP cases and six deletion-replay/retention cases passed. The encrypted database capture/restore retained group membership and child baselines; post-backup deletion replay removed new entities while preserving accounting controls. Eleven forward migrations and fresh replay preserved Auth and financial controls.

The full unit run passed 721 cases and exposed one security-inventory count failure. Adding the two tables to the real hosted checker and updating the empty-sample expectation made all 14 cases in that owning file pass. Lint, formatting, all TypeScript projects, generated-type comparison, database lint, bundle inspection and 626 specification/fixture checks passed. Seven existing goal journeys, nine account/settings/theme journeys and the full import→Ask→approval→export→deletion release journey passed in built Chrome. The last journey reproduced another early-UTC fixture copy in P4 CI (142 other cases passed); the completed-day repair is in the parent layer. Independent review approved both axes; group UI remains P6.

Final direct-role testing reproduced a deletion fence omission: an unexpired session could read new group tables before physical purge. Both policies now require an active owned profile, matching existing tables. The two before-fix failures passed after repair; the narrow fix received independent review. No hosted or paid-provider verification has run, and physical-device acceptance remains open.

P5 CI passed fast and browser checks; its backend run passed 301 cases and exposed the lifecycle rehearsal's hardcoded v2 attachment name. That checker now uses the canonical export filename/version/section inventory and includes group tables in its owned-data inventory. Its nine unit cases and the actual local production-handler/Auth rehearsal passed after repair. This local rehearsal does not verify a hosted environment.

## Direct group interface (P6)

**Date:** 2026-11-16. **Base:** `0fd63fb593296b900e3260f7301214e63ee956ac`. Goals reuses one numeric form for individual edits and local group member drafts. A group can link current approved goals, create new members or revise existing ones. Saving a member creates no individual proposal or goal. One complete proposal shows every frozen target/baseline before a single parent approval. Changed members require explicit adoption or revision; pending/invalidated bodies never become active from a display read.

The group view separates administrative state from independent member outcomes, dates and progress. Members link to their individual detail/history on the same mounted Goals page. Archive review labels retained historical state and makes clear that no child changes. The reusable owned proposal component validates the issued ID/hash/version, polls pending state, reuses a decision request ID and links the approved receipt.

All eight built-Chrome goal journeys passed, including one complete mixed-member group journey through review/reload/approval/replay, a real stale-card `409` with no partial effects, membership/order revision, child archive/correction, truthful group archival, detail/history navigation, cancellation focus and account switch. It confirmed no AI runs or chat dispatch. A stale-card network barrier retained the already rendered owned card while status polling was unavailable; the approval handler itself remained real.

The first new journey exposed fixture label/column/status-order assumptions, which were corrected without weakening server behavior. Additional interface assertions reproduced missing archive-effect clarification and loss of opener focus after Escape; both passed after repair. A controlled delayed group-detail response then reproduced focus moving behind an active editor and dismissing it. Heading focus now follows a requested selection once and yields when editing starts; the same delayed-response journey passed after repair. This final focus refinement was self-reviewed after the independent review.

Native group inputs reuse the established form styles. Narrow light/dark screens at 200% text retained bounded controls and 44px touch height; title, description and control-label contrast passed 4.5:1. Theme captures wait for readable colors, avoiding a misleading image taken midway through a color transition. These automated Chrome observations do not establish physical-device or assistive-technology acceptance.

The full 722-test unit suite, lint, formatting, all TypeScript projects, production bundle inspection of 34 public files and 626 specification/fixture checks passed. Independent review approved requirements and engineering axes against the P6 base. No backend schema change, live provider call, hosted verification, physical device or assistive-technology pass is implied. P7 owns conversation integration and the final prompt/tool contract.

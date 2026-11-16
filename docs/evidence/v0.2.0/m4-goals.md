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

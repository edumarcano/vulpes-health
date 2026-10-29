# PR 15: mobile interface and static PWA

Locally verified on 2026-10-29. Branch: `feat/pr15-mobile-pwa`, from refreshed
`main` at `172b5cb`. Scope: execution-plan PR 15. Account lifecycle remains PR 16;
combined independent M5/M6 review follows PR 17. Production inference is disabled.

## Delivered behavior

The production build generates a versioned public-asset allowlist and service
worker. It caches compiled JS/CSS, approved icons/branding, the manifest and a
separate data-free offline document. API, authentication, conversations, exports
and private traces receive no worker cache or offline fallback. No offline writes
or background inference are introduced. New workers wait for open tabs to close;
activation removes obsolete Vulpes static caches. Asset names and public content
participate in versioning. `npm run test:pwa` runs against an existing build.

The header preserves the supplied horizontal wordmark in both themes, using a
light backing in dark mode. Runtime icons are resized from the approved color
master. Route titles remain correct after session restoration. Controls wrap long
text, disclosures retain tap targets, and the inspector respects safe areas.
Goals uses Data's chart failure boundary and a keyboard-accessible table region.
Long history timestamps and progress bars fit narrow, zoomed layouts. Failed
Goals requests remain distinct from empty data. Inspector API retry and lazy-load
failure dismissal preserve the conversation and return focus. Status messages
announce lifecycle changes rather than individual token deltas.

No provider, domain-service, approval, analytics, schema or public API contract
changes were made. No dependency was added. Tailwind scans `src/` explicitly;
checkout and verification-copy stylesheet hashes matched.

## Observed verification

Runtime: Node 24.15.0, npm 11.18.0; dependency versions remain locked.

| Command actually run | Result |
|---|---|
| `npm run lint` | Passed on final TS/TSX and test sources |
| `npm run typecheck` | Passed; repeated by final strict builds |
| `npm test -- --maxWorkers=1` | Final serialized run: 328 passed across 24 files |
| `npm run test:bundle` | Final build passed; 15 public files passed secret/server/harness scan |
| `npm run test:e2e` | Complete built-browser suite: 111 passed; final test-only inspector matrix expansion verified below |
| `npm run test:dev -- --diagnostic` | Final Vite/API suite: 28 passed |
| `npm run test:pwa` | Final built-worker privacy, obsolete-cache cleanup and offline-shell proof passed |
| `npm run test:e2e -- --mobile-proof` | Seven final focused checks passed, including inspector at all five required viewports in both themes, title, keyboard, chart/inspector failure and Goals recovery |
| `npm run test:e2e -- --goals-proof` | Six related chat/direct-goal checks passed after timestamp wrapping repair |
| Specification validator and `git diff --check` | 499 specification/fixture checks and whitespace validation passed |

Authentication, HTTP, PostgreSQL and browser flows use a separately named
`vulpes-health-pr15-test` disposable stack on loopback ports 26321/26322. An ignored
source copy specializes project/port bindings only. Environment files were not
copied. Development uses port 25173 because an existing service occupies 5173.
The retained M3 stack/allocation was not reset, used or replenished.

| Acceptance area | Actual local evidence and limit |
|---|---|
| UI-01/04 | Five required viewports in light/dark; populated Data and Goal states, 200% root text sizing, reduced motion, wrapping and contrast assertions; inspected synthetic screenshots |
| UI-02/03 | Composer/viewport geometry, keyboard traversal, labelled controls, native dialog focus/Escape, status roles and chart/table access; physical keyboard and real screen-reader behavior remain unverified |
| UI-05/06 | Loading/error/partial/cancelled/stale/expired states, explicit retries, inert unsafe text/links and owned evidence regressions |
| OPS-01 | Inspected real worker caches, obsolete-cache removal, API/auth/query/POST exclusions, private-route offline fallback with no scripts or private identifiers |
| SEC-04/05/07/08 | Bundle canaries, sanitized rendering, real synthetic account switching/late-response guards, local routing/headers; hosted behavior remains unverified |
| COST-01/07 | Deterministic browsing/approvals and reload do not create paid requests; existing cancellation/replay assertions retained |

The imported-data Ask/inspect/propose/approve/reimport/progress/reload journey
passed through real local handlers and persistence, with synthetic provider
composition. Final screenshots were captured at all required sizes. Completion audit expanded
the inspector from two sample pairings to all ten viewport/theme combinations;
the updated imported-data journey and six related mobile checks passed. The mobile
Ask, inspector and offline artifacts were inspected; the icon was inspected for
legibility. Full screenshot inventories remain in ignored local test output.
Safe committed samples: [light offline shell](pr15-offline-light.png) and
[dark offline shell](pr15-offline-dark.png), both at 360px/200% text.

## Retained failures and repairs

- Restricted Windows process creation initially denied the build. The authorized
  process-capable build passed. The first PWA config used the wrong working
  directory and failed before tests; resolving the repository directory fixed it.
- The initial full browser run passed 106/108. Its chart network fault was bypassed
  by the new public cache, so that fault context now blocks service workers while
  retaining the fallback assertions. Keyboard traversal now waits for restored
  content. The subsequent 108-case suite passed.
- The new reload test reproduced the title `Vulpes · Vulpes`; deriving titles from
  known routes repaired it. The inspector fault initially lost to a later general
  routing handler; registering it after setup exercised the actual error boundary.
- The expanded 111-case suite passed 110 and reproduced Goal history text overflow
  (466px document at a 360px viewport/200% text). Page-boundary wrapping fixed it.
  A subsequent active-progress zoom test reproduced native progress-bar overflow;
  constraining its width fixed it. Final built and development suites passed with
  the original assertions intact.
- Development startup twice failed on occupied port 5173. Sanitized diagnostics
  established the conflict; only the disposable copy moved to 25173. A final unit
  run overlapping other checks timed out in the first ESLint initialization case
  (327/328 passed). The isolated one-worker run passed all 328 with unchanged
  assertions/timeouts; no exact initialization root cause is claimed.
- A temporary workspace approval-review cap denied two final commands before
  execution. After the user resolved it, verification resumed. The existing large
  bundle warning remains; no performance benchmark or improvement is claimed.

## Split-axis self-review

**Axis 1, specification fulfillment: approved for local PR 15 scope.** Review
covered the diff from `172b5cb`, new/untracked files, canonical UI/PWA requirements,
affected callers and actual interface artifacts. Required local states, branding,
responsive checks and offline privacy are demonstrated. Title and zoom blockers
were reproduced, repaired and rechecked. External acceptance is not inferred.

**Axis 2, engineering/security/test assurance: approved with one observation.**
Public cache writes have a fixed build-owned allowlist; runtime private responses
cannot become cache entries. Existing tenant/epoch guards and server boundaries
remain intact. Chart handling is reused; the inspector boundary is local and
bounded. No new framework or dependency is introduced. Tests retain fault,
ownership, numerical and approval assertions. The inherited bundle-size warning
is advisory. This is implementing-agent self-review, not independent M5/M6 review.

## Remaining gates and completion boundary

Physical on-screen keyboard/safe-area behavior, actual screen readers, installed
PWA behavior on phones, hosted routing/CSP and live providers remain unverified.
Before UI/device acceptance, use a separately authorized synthetic test origin:
verify keyboard-open long-chat composition, deliberate scroll position, dialog
focus/return, headings/navigation/status announcements and chart table access with
the chosen assistive technology. Record device/browser/reader versions and actual
results. Emulation does not establish WCAG certification or device acceptance.

No deployment, hosted health database, real records or provider requests were used.
Maximum authorized and actual inference spend: $0. PR 14 stays deferred; PRs 16–17,
combined review, milestone acceptance and pilot authorization remain separate.
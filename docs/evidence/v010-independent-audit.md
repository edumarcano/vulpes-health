# Vulpes v0.1.0 — independent audit report

**Revision audited:** `main` at `ad70d74151457cafa01beed02db6aad9c2a86fe8` (clean, in sync with `origin/main`). I changed no application code and left the working tree clean.

## 1. Executive assessment

Vulpes's security and data integrity are strong, well above what a personal project usually has. I found no tenant-isolation, authorization, secret-exposure or paid-call gating defect.

There are two High findings, and they are about how the system is run and how Ask behaves, not about its controls:

- **Production deploys are not gated by CI.** Nothing stops untested code from reaching the deployment that holds your real health data.
- **Ask isn't told today's date, and one wrong tool argument fails the whole run.** Ask also has to send exact local-midnight timestamps for the `America/New_York` timezone, including across daylight-saving changes. So the most natural questions ("this week", "last month") are likely to fail after spending money, or to be computed for the wrong period.

Beyond those, the release evidence is stale, recovery depends on a manual process with no rehearsed path back into service, and the streaming path does an amount of database work that grows quadratically with answer length. I would not declare v0.1.0 ready until the High findings are fixed and current release evidence exists. None of this calls for an architectural rewrite.

## 2. Findings

| ID | Severity | Status | Title | Blocks v0.1.0 |
|---|---|---|---|---|
| F-01 | High | Verified | Production deploys are not gated by CI or branch protection | Yes |
| F-03 | High | Verified (static plus reproduction) | Ask has no current date; tool-interval errors fail the whole run | Yes |
| F-02 | Medium | Verified | Nothing enforces that migrations are applied before dependent code deploys | Recommended |
| F-04 | Medium | Verified pattern; hosted impact not measured | Streaming re-encrypts the whole response on every chunk, inside the provider timeout | Recommended |
| F-05 | Medium | Verified | Release evidence is stale; P1 gates are failed or blocked | Yes (evidence) |
| F-06 | Medium | Not externally verified | Manual backups with no recovery-point target and no rehearsed return to service | Yes (operational) |
| F-07 | Low | Verified | Canonical specs contradict the current deployment model | With F-01 |
| F-08 | Low | Verified | Windows checkout fails `format:check`; a CLI test is fragile to npm warnings | No |
| F-12 | Low | Verified | Opportunistic cleanup runs inside the payload-read path used before every paid send | No |
| F-09 | Low | Verified | Keyword safety heuristics over-match benign text; no numeric plausibility check on goals | No |
| F-10 | Low | Verified | Interrupted requests settle at about 15× a typical cost against a $0.10/month allocation | No |
| F-11 | Low | Verified | `VulpesAgent.run` is a ~620-line generator and the main change hotspot | No |

There is no F-13; finding IDs are not contiguous because I merged two drafts.

### F-01 — High: production deploys are not gated by CI

**Evidence**
- `vercel.json:5` deploys every push to `main`. `docs/operations/owner-pilot-data.md:29` says so explicitly: "Vercel deployment begins on the main push independently of its CI run."
- The GitHub API shows `main` is unprotected and has no rulesets: `{"protected":false,...,"required_status_checks":{"checks":[]...}}`.
- `ci.yml:11-13`: the shared concurrency group cancels pending `main` runs. The `main` runs for #48, #49 and #50 ended `cancelled`, yet those commits were deployed. Only the final head, `ad70d74`, has a passing `main` run.
- `build:hosted` runs typecheck and build only. The isolation, RLS, accounting and browser suites never gate a deploy.

**Impact:** a regression that the integration suites would catch, for example in ownership checks or ledger behavior, can go live on the real-data deployment just because it typechecks. Nothing technical prevents direct pushes either.

**Smallest fix:** add a GitHub ruleset on `main` that requires the three CI jobs, requires branches to be up to date, and blocks force and direct pushes (including admins). Change the concurrency group so `main` push runs are never cancelled, for example by grouping on `github.sha` for push events. Optionally, add a Vercel Ignored Build Step that checks the commit's status.

**Confidence:** high.

### F-03 — High: Ask has no current date, and tool-interval errors kill the run

**Evidence.** The model context contains the safety template, profile (`timezone`, `units`, `data_revision`), the selection and the user's message. It never includes the current date:

```290:302:server/ai/context.ts
  const essential: GenerationRequest = {
    turns: [
      { type: 'message', role: 'system', text: safetyInstructions },
      {
        type: 'message',
        role: 'system',
        text: JSON.stringify({
          profile: profile.data,
          selection: input.context_selection,
          selectedGoal,
        }),
      },
      { type: 'message', role: 'user', text: input.message.text },
```

- `summarize_metric` and `get_measurements` require ISO instants that fall exactly on local midnight in the `timezone` the model passes. Otherwise they throw (`server/analytics/summary.ts:22-23`, `server/services/measurements.ts:321-329`).
- Tool execution in `VulpesAgent.ts:603-610` has no error handling. A thrown `HttpFailure` reaches the outer catch at lines 753-785 and the run ends as `run.failed`, after at least one paid request.
- I reproduced the rejection with the owner's timezone:
  - Accepted: UTC midnights with timezone `UTC`.
  - **Rejected:** UTC midnights with `America/New_York`.
  - **Rejected:** a fixed `-04:00` offset at both ends of a week that crosses the Nov 1 DST change.
  - Accepted: correct local midnights.
- If the model picks timezone `UTC` instead, the call succeeds but buckets evening weigh-ins into the next UTC day. That is a labelled but silent day shift for the user.
- Coverage gap: every test and live interval is a UTC midnight. See `tests/integration/chat.test.ts:1489-1495`, `scripts/evaluate-everyday.ts:122-123`, and the live tool-loop prompt `scripts/live-everyday.ts:297`, which supplies explicit dates "UTC". No evaluation asks a relative-time question.

**Impact:** relative-time questions, the core use of Ask, are likely to fail after spending, or to report "no data" or "insufficient data" for the wrong period. The latter is a false statement about your data.

**Fix:**
1. Put the server's current instant and the local date in the profile timezone into context.
2. Let the tools accept local dates (`YYYY-MM-DD`) and resolve midnights server-side in the profile timezone.
3. Return typed tool errors to the model (code plus hint) within the existing six-tool and four-call limits, instead of failing the run.
4. Add evaluation cases for "last 7 days", "this month" and a DST-crossing week.

**Dependency:** this changes the instruction template. Production availability is bound to `templateVersion: 'vulpes-everyday-v7'` (`server/config/everyday-production.ts:26`), so the fix needs a new bounded live verification. That is a small paid run and needs your approval.

**Confidence:** high on mechanism, medium on real-world frequency. The model can partly anchor on `list_metrics` `last_at`, but it cannot know "today".

### F-02 — Medium: migration-before-code ordering is unenforced

- The runbook says to "apply required migrations separately before merging dependent code" (`owner-pilot-data.md:31`). Neither CI, the build nor the runtime checks this.
- Code that calls a new RPC before the hosted migration exists produces 503s across features, i.e. an outage, not corruption.

**Fix:** add a service-only `schema_version_v1()` RPC (applied to the hosted database first, with your approval). Then have `build-hosted.ts` refuse to build when the hosted latest migration is older than the repository's. **Confidence:** high.

### F-04 — Medium: streaming does quadratic encryption and database work inside the provider timeout

**Evidence**
- `dispatcher.ts:126-133`: for every transport chunk, the whole cumulative response is re-gzipped, re-encrypted and hex-encoded. `checkpoint_step_v1` then inserts a new row and deletes the previous one.
- Each envelope also makes its own expiry RPC (`execution.ts:273-284`, `private-payloads.ts:63-76`).
- Separately, every text delta rewrites the message row (`VulpesAgent.ts:375`).
- All of this is serialized by backpressure inside `AbortSignal.timeout(60s)`, which caps the whole stream rather than idle time (`dispatcher.ts:101-112`, `policy.ts:11`).

An offline simulation with synthetic Responses-API events, worst case of one event per chunk:

| Text deltas | Database round trips | Cumulative upload |
|---|---|---|
| 300 | ~900 | ~0.7 MiB |
| 1,000 | ~3,000 | ~5.5 MiB |
| 3,072 | ~9,200 | ~47 MiB |

**Impact:** long answers are slow, and very long ones could hit the 60-second cap. That ends the run with an uncertain hold at full reservation. It also churns dead tuples on Supabase Free. I did not measure hosted latency.

**Fix:** measure locally first with the mock transport. Then batch checkpoints, for example every 250 ms or 8 KiB plus terminal events, and emit a batch only after it is checkpointed. This preserves the "prefix committed before SSE emission" contract and byte-exact capture. Compute payload expiry once per step. **Confidence:** high on the pattern, medium on impact.

### F-05 — Medium: release evidence is stale

- The only release report, `docs/evidence/release/m6-local.json`, was generated from `508757f` on 2026-10-30 and says `releaseReady: false`.
- In it, UI-01 through UI-06 are `failed`; AI-07/08/09 and OPS-06 are `blocked`.
- Since then there have been 26 commits and about 7,900 changed lines in `src/`. `test:dev`, which feeds those UI gates, is not in CI.
- AI-07 and AI-09 test Flash, which is disabled. They need explicit not-applicable dispositions, not silent omission.

**Fix:** regenerate the evidence on the release candidate, record dispositions for gates that don't apply, and keep the TalkBack exception explicit.

### F-06 — Medium: recovery has no recovery-point target and no rehearsed return to service

- Supabase Free has no managed backups or point-in-time recovery, and backups are manual.
- The last verified backup is the 2026-11-02 post-import capture (`owner-pilot-step5.md:94-108`). It predates later conversations.
- The runbooks deliberately offer no access-enable or cutover path, and "source-loss/cutover completeness" is recorded as unverified (`hosted-recovery.md:19,57`). After real source loss, there is no rehearsed way to put a restored database back behind the app.

**Fix:**
1. Set a recovery-point target, for example weekly, with a recurring reminder.
2. Write and rehearse with synthetic data a "restore into a new Supabase project and repoint Vercel" runbook.
3. Take a fresh backup before declaring the release.
4. Optionally weigh the cost of Supabase Pro's point-in-time recovery. That is your call.

**Confidence:** medium, because it depends on external state I didn't inspect.

### F-07 — Low: spec drift

- `docs/spec/v0.1.0/DEPLOYMENT.md:62` says the root `vercel.json` "refuses an unbound hosted build" and that "Git automatic deployment remains disabled". Both are now false.
- `ARCHITECTURE.md:39` says "Nine thin Vercel entry points"; there are eight.

Fix these with F-01.

### F-08 — Low: Windows developer friction

- `core.autocrlf=true` checks files out as CRLF, and `.gitattributes` lacks `* text=auto eol=lf`. As a result, `format:check` flags 253 files on this machine, even though the index is LF.
- `tests/unit/provider-smoke.test.ts:119,130` parse all of stderr as JSON. They failed (14 tests) when the environment printed an npm warning. With the injected variable removed, all 18 pass.

**Fix:** add the `.gitattributes` rule, and have the test parse the last JSON line or invoke node directly.

### F-12 — Low: cleanup coupled into the critical read path

`readPayload` runs `cleanup_data_v1` inside the same `try` as decryption (`private-payloads.ts:139-143`). A transient cleanup failure therefore reports the trace as `unavailable`. That blocks the pre-send check (`execution.ts:390-400`) and silently drops history groups.

**Fix:** run cleanup after returning, on a best-effort basis.

### F-09 — Low (optional): keyword safety heuristics

- `baselineSafety` (`server/ai/prompts/everyday.ts:15-30`) returns a canned crisis or clinical reply for benign phrases. Examples: "I can't breathe well when running" gets the crisis message; "I was diagnosed with…" and "starving after the gym" get the clinical refusal.
- `goalPolicyAllows` is keyword-only. Extreme numeric targets, such as body fat 2%, can be proposed. You still have to approve them, so this is friction rather than a safety hole.

Defer.

### F-10 — Low (operational): budget versus conservative holds

An interrupted request settles at its full reservation of $0.0093192 after 24 hours (`reconcile_runs_v1`). A typical completed request costs about $0.0006. With a $0.10/month allocation, roughly ten mobile disconnects exhaust the month. This is policy-consistent; keep it in mind or revisit the allocation.

### F-11 — Low (maintainability)

`VulpesAgent.run` (`VulpesAgent.ts:165-786`) mixes context pruning, dispatch, settlement, escalation, tool execution and card emission in one generator. Extract only the tool-step execution, as part of fixing F-03. No broader refactor is warranted.

**Design note, not a defect:** any data-revision change, including adding a reading, drops all prior chat history from model context (`context.ts:198-205`). This is documented ("current-revision"), but it weakens AI-08 follow-ups for someone who logs daily. It's worth a product decision.

## 3. Strengths I verified

- **Database privileges.** From a read-only catalog query on a local stack with all 39 migrations applied:
  - `authenticated` has SELECT-only access to owned tables. Every table has RLS, plus a restrictive `live_session` policy; `anon` has nothing.
  - All 61 security-definer functions pin `search_path=''`.
  - Only 13 RPCs are callable by users, and each derives the owner from `auth.uid()` with strict shape, unit, range and offset validation.
  - Import commits are bound by content hash to server-written ciphertext, so calling PostgREST directly cannot bypass server-side CSV validation.
- **Sessions.** Every request goes through `getUser`, then a persisted-session check, so revocation works even while a signed JWT is still unexpired. Account deletion requires a password sign-in within the last five minutes, read from the authenticated AMR claim.
- **Paid-call gating.** The exact request is encrypted and persisted before sending. `authorize_send_v1` is a single-use compare-and-set that rechecks consent against the run's frozen consent, budget headroom and trace presence. There are no retries; uncertain cost is held; money uses decimals; route cost blocks persist.
- **Provider configuration.** Requests use `zdr: true`, `store: false` and no plugins. Model and limits live only in the catalog, and availability is bound to recorded evidence. The hosted build refuses a wrong project, origin, key shape or stray `VITE_*` variables.
- **Analytics.** Exact decimals; DST-correct calendar windows via Temporal; day median then window mean; a minimum of three valid days; percentage points; guarded zero denominators.
- **Goal approval** is enforced in the database: content hash, expected version, expiry, single use, data revision, and owner from the session. The model can only propose.
- **Frontend.** No raw HTML; react-markdown's URL allowlist; strict CSP (`script-src 'self'`, `frame-ancestors 'none'`); a service worker that caches enumerated public assets only; caches cleared on identity change; no automatic chat retry.
- **CI and dependencies.** Actions are SHA-pinned, permissions are `contents: read`, CI uses no secrets and live AI is off. `npm audit --omit=dev` reports **0** vulnerabilities.

## 4. Coverage and limitations

**What I ran**

| Check | Result |
|---|---|
| Lint | Passed |
| Typecheck | Passed |
| Unit tests | 517/517 passed once a sandbox npm warning was removed |
| Spec validator | Passed |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `format:check` | Failed, attributable to CRLF checkout (F-08) |
| Interval reproduction | Rejections confirmed as described in F-03 |
| Write-amplification simulation | Figures in F-04 |
| Database catalog introspection | Read-only, on the existing local stack |

**What I reviewed:** the specs, operations runbooks and decision log; the server HTTP, auth, AI, ledger, provider, analytics, security and core service code; final function definitions for import, measurement, settings, approval, send authorization, checkpoint, reconcile and session; key frontend files; CI and `vercel.json`; the recorded evidence.

**What I did not run:** integration, pgTAP, e2e, build and `backup:verify`. They start or reset stacks, and you asked me not to reset databases.

**What I did not review in depth:** most of the ~48 operator and recovery scripts, account-export internals, the Vertex adapters (disabled), and the pgTAP test contents.

**What I could not verify:**
- Hosted Supabase Auth settings: signup disabled, redirect URLs.
- Vercel environment scoping and deployment protection.
- OpenRouter key cap and account privacy settings.
- Hosted latency.
- Real-device behavior and TalkBack.

I matched the local database to the repository by migration versions only, not by statement contents.

## 5. Remediation plan

| PR | Scope | Depends on | Priority | Acceptance criteria |
|---|---|---|---|---|
| **PR-1: Deploy integrity and hygiene** | `main` ruleset requiring the three CI jobs, up-to-date branches, no direct or force pushes; CI concurrency that never cancels `main` push runs; DEPLOYMENT and ARCHITECTURE fixes; `.gitattributes` LF; stderr parsing in the provider-smoke test | none | P0 | API shows required checks; a test direct push is rejected; consecutive merges each get a completed `main` run; `format:check` passes on a fresh Windows clone; spec validator passes |
| **PR-2: Ask temporal grounding and typed tool errors** | Current local date in context (template v8); date-only intervals resolved server-side; typed tool errors returned within existing limits; tool-step extraction; evaluation cases for relative ranges and DST | PR-1 | P0 | A synthetic-provider test of "last 7 days" in `America/New_York` across Nov 1 returns a correct summary; a malformed interval yields a tool error and a completed answer, not `run.failed`; then a small paid live verification, with your approval, updates `everydayProductionEvidence` |
| **PR-3: Streaming checkpoint batching** | Time- and size-based batching of response and message checkpoints; one expiry lookup per step; cleanup moved out of `readPayload`'s `try` | PR-1 | P1 | A 1,000-delta mock run cuts round trips by at least 10× with a before/after measurement; byte-identical trace (TRACE-02) and prefix-before-emit tests still pass |
| **PR-4: Schema compatibility guard** | Service-only `schema_version_v1()` migration, applied to the hosted database first with approval; `build-hosted.ts` refuses when the database lags the repository | PR-1 | P1 | A hosted build against a lagging schema fails; a matching schema builds |
| **PR-5: Release candidate evidence and recovery** | Full local evidence sequence on the candidate; P1 dispositions (Flash gates not applicable, TalkBack exception); fresh encrypted backup; synthetic cutover runbook and rehearsal | PR-2, PR-3, PR-4 | P0 | Current `m6-local.json` bound to the candidate with no unexplained failed or blocked P1; a dated backup and independent copy exist; the cutover rehearsal is recorded |

F-09, F-10 and the rest of F-11 are deferred.

## 6. Release recommendation

**Before declaring v0.1.0:** PR-1, PR-2 including the approved live re-verification, and PR-5. PR-3 and PR-4 are strongly recommended. At minimum, PR-3's measurement should show that hosted long answers stay well under the 60-second cap.

**Can wait:** keyword-heuristic tuning, budget allocation review, the broader agent refactor, Flash, Argon, decision scoring, family gates (OPS-04/05, F-tagged items) and full TalkBack acceptance, provided it stays an explicit exception.

I'll wait for your approval before implementing any of this.
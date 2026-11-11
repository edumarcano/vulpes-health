# Hosted Ask Vulpes activation (2026-11-01 to 2026-11-02)

This is a summary of the owner's Luna-only hosted activation and the first device report. The [full step-by-step record](https://github.com/edumarcano/vulpes-health/blob/ee4e040/docs/evidence/owner-pilot-step4.md) is kept in Git history. Current operating rules are in [owner operations](../operations/owner-pilot-data.md).

## Scope

The owner authorized the normal hosted chat path with Luna only, plus synthetic verification before any real-data or physical-device checks. No optional model, cosmetic work, real data or merge was part of this step.

## Activation

| Item | Result |
|---|---|
| Model and limits | `openai/gpt-6-luna`, low effort. Typed run ceiling $0.04. Pilot allocation $0.10 per app and per account within the $0.50 dedicated key cap. |
| Build mode | The explicit `owner-pilot-luna` mode requires approved readiness evidence, the live switch, exact project and origin, public Auth values and a server-only provider key. Default builds keep inference off. |
| Provider recheck | Public Luna rates, ZDR routing and data-collection policy were rechecked on 2026-11-02. The catalog's conservative rate bounds still applied. The provider still screens ZDR traffic and may retain flagged content, so no absolute no-retention claim is made. |
| Hosted deployment | Built from a frozen, hashed archive of a candidate that passed CI. 14 of 14 public routing and header checks passed. Seven public files passed private-key canary checks. |
| Setup | Matching $0.10 November allocations, owner consent (`openrouter_zdr_v2`) and a $0.10 personal preference were set through the normal interfaces. Seven labelled synthetic weight readings were imported. |

## Synthetic checks on the hosted app

| Case | Result |
|---|---|
| Consent denial | Returned 403 `run_policy_denied` with no provider usage. |
| Tool-grounded summary | Completed for $0.00041. The answer matched the tool result (seven readings, mean 69.34 kg). Exact input hashes, reload and foreign-account denial passed. |
| Goal proposal | A vague prompt produced an offer rather than a review card, and that attempt is recorded as failed. A fully specified prompt created exactly one pending card with a 69 kg baseline and 68 kg target. No goal was active. |
| Cancellation | A cancel issued after dispatch left the full $0.0093192 hold in place, as designed. A cancel that arrived after completion was recorded as a failed timing check. |
| Connection loss | The run still completed once and charged $0.00025. Reopening showed the saved result with no second send. Immediate upstream cancellation on disconnect is not established. |
| Browser send | One real send completed for $0.0006. A readback passed 7 checks: rendered answer, inspector, reload, mobile layout, saved cancelled runs and logout, with no page errors or extra sends. |

Seven runs used 19 generation steps. Reported spend was $0.002111 per allocation, with one $0.0093192 hold. Dedicated-key usage rose by $0.00228, leaving $0.4909 under the cap. Infrastructure cost was $0.

## Repair found during hosted checks

A calculation card with a current window but no previous window displayed `change null kg`. The fix shows "previous-window change unavailable" instead, with a browser regression test. Calculations, prompts and data contracts did not change. After the replacement deployment, 14 of 14 routing checks and an eight-check browser readback passed.

## Owner device report (2026-11-02)

Reported on a Samsung Galaxy S23 (Android 17, Chrome 156) against the hosted app. This is owner-reported evidence and does not cover every viewport, theme or assistive technology.

| Area | Report | Disposition |
|---|---|---|
| Conversations | Everything worked. The owner found the UI accessible but awkward. | Accepted for the owner workflow. Broader UI verification stays open. |
| Installation | Chrome installed Vulpes as a separate app. | Passed on this device. |
| Airplane mode | The offline check worked. | Passed as owner-reported. |
| Markdown rendering | Responses showed literal `**` markers. | Known issue, deferred to a UI-polish change. |
| TalkBack | Turned on, but navigation was not verified. | Not verified. Deferred for the personal pilot. UI-03 remains required for a full release. |

## Remaining gates at the time

Formal acceptance, fresh recovery and accounting evidence, and a bounded single-profile data import were still open. Later records ([step 5](owner-pilot-step5.md)) cover the import and handoff.

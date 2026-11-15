# Metric definitions and reference coverage

**Reviewed:** 2026-11-15. **Scope:** v0.2.0 P2 original product content and deterministic reference infrastructure. Manufacturer classification is **unavailable**. AT-15 classification and evaluation E11 remain pending; no test-only rule is enabled for production.

Definitions explain the recorded quantities in original prose. Tracking eligibility means the representation and units are resolved, not that optimizing a value is advisable. BMR time basis and the three target-delta directions remain unresolved; raw readings and original labels remain available independently of guidance.

## Per-metric audit

`U` means unavailable: no complete applicable, versioned manufacturer rule and resolved reuse basis was established. `N` means not applicable to the RENPHO reference investigation; no alternative range is implied. All entries below use content `metric-explanations-v1`, reference registry `manufacturer-references-unavailable-v1` and resolver `manufacturer-reference-v1`.

| Metric | Reference | Additional boundary |
|---|---|---|
| Weight | U | Source-reported mass |
| BMI | U | Vendor calculation, preserved without Vulpes recalculation |
| Body fat percentage | U | Estimate; distinct from fat mass |
| Body fat mass | U | Estimate; distinct from percentage |
| Muscle percentage | U | Distinct from skeletal muscle |
| Muscle mass | U | Distinct from fat-free and skeletal muscle mass |
| Skeletal muscle percentage | U | Separate vendor estimate |
| Skeletal muscle mass | U | Separate vendor estimate |
| Bone percentage | U | Not bone density |
| Bone mass | U | Not bone mineral density |
| Protein percentage | U | Not dietary intake |
| Protein mass | U | Not dietary intake |
| Body water percentage | U | Not a hydration diagnosis |
| Body water mass | U | Preserve separately from percentage |
| Fat-free mass | U | Not synonymous with muscle mass |
| Subcutaneous fat percentage | U | Source-specific estimate |
| Visceral fat index | U | Proprietary index, no cross-brand conversion |
| BMR | U | Raw kcal; time basis unresolved; ineligible for analysis/goals |
| Metabolic age | U | Not chronological age |
| Waist-to-hip ratio | U | Does not provide underlying circumferences |
| Optimal weight | U | Vendor reference, never an approved target |
| Target weight delta | U | Signed value; direction unresolved; raw-only |
| Target muscle delta | U | Signed value; direction unresolved; raw-only |
| Target fat delta | U | Signed value; direction unresolved; raw-only |
| Observed heart rate | N | Keep recorded source/method and sample statistics |
| Explicitly resting heart rate | N | Do not infer resting status from observed samples |
| Height | N | Recorded stature |
| Daily steps | N | Preserve local-day total semantics |
| Sleep duration | N | Preserve recorded session/day semantics |

## Source and reuse review

| Source | Review outcome |
|---|---|
| [RENPHO Health App FAQ](https://renpho.com/pages/faq-for-renpho-health-app) | Profile/mode context and in-app guidance do not supply a complete public rule |
| [RENPHO body-composition scale manual](https://renpho.com/pages/body-composition-scale-manual) | Model/estimate information does not establish a universal range registry |
| [RENPHO visceral-fat article](https://renpho.com/blogs/wellness-fitness-blog/visceral-fat) | Displayed intervals overlap at endpoints; exact inclusivity and model/app/mode applicability unresolved |
| [RENPHO BMI article](https://renpho.com/blogs/wellness-fitness-blog/what-your-bmi-says-about-your-health) | Displayed categories do not establish complete decimal boundaries and export/app applicability |
| [RENPHO Terms of Use](https://renpho.com/pages/terms-of-use) | Undated page reviewed 2026-11-15; no affirmative redistribution permission or reviewed exception established |

| REF-07 item | Disposition |
|---|---|
| Exact material reused by P2 | Original Vulpes definitions and charts only; no manufacturer prose, illustrations, range table or numeric classification rule adopted |
| Existing functional headers/product names | Retained compatibility/provenance identifiers from M1; no new dialect inferred |
| Terms/license version and date | Undated terms page, reviewed 2026-11-15; no new content license adopted |
| Reuse basis | Unresolved for proposed manufacturer range content; affected content stays unavailable |
| Required new redistribution notices | None identified for original P2 prose; reassess before adding manufacturer-derived content |
| Production outcome | Empty verified range registry, explicit unavailable/not-applicable states; imports and direct tracking remain usable |

No legal exception or permission is inferred from a citation, numerical fact, personal-access license or public page. Resolving the first rule requires exact boundaries/inclusivity/unit, model/app/mode scope, necessary profile basis, reviewable source/version and a documented reuse outcome. A later focused PR may add that rule and independent applicability/boundary tests. Until then, do not describe manufacturer classification as shipped or drop E11 from the evaluation denominator.

## Verification status

P2 definitions, unavailable-state service and resolver mechanics are locally verified. Synthetic injected rules exercise mechanics only and cannot establish manufacturer applicability, rights or release acceptance. No profile attributes are collected without an adopted rule requiring them. Provider requests/spend: **0 / $0**.

| Check | Executed result |
|---|---|
| Focused unit/contracts | 85 tests passed: reference boundary/applicability/version/profile/overlap checks, original content coverage, analysis and API contract regressions |
| Existing unit suite | 683 tests passed; the new reference file was added after that run's discovery, so its 22 tests are reported in the focused result above |
| HTTP/Auth/PostgREST | Three reference tests passed: owned value `70` with explicit unavailable guidance, four-field raw-only definition path, stable ID, stale `410`, foreign-source denial and strict selections |
| Static checks | Full TypeScript and affected ESLint passed |
| Independent review | Both specification and engineering axes approved; no remaining findings |

No schema, profile persistence, copied manufacturer table, new redistribution notice or live verification is introduced. New metadata distinguishes tracking eligibility from the goal mutation expansion in P4. P3 owns the user-facing Data guidance; P7 owns Ask integration. AT-15 classification and E11 remain pending.

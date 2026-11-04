# Independent audit remediation status

Baseline: `ad70d74151457cafa01beed02db6aad9c2a86fe8`. The [independent audit](v010-independent-audit.md) is preserved unchanged. Findings F-01 through F-12 are in scope; there is no F-13. Draft PRs are not merged or deployed. No real health records, production settings, personal backups or paid model calls were used for remediation.

The matrix is completed against the combined executable candidate after the implementation PRs are integrated for local verification. A code-complete row is not an operational closure claim. Cloud safeguards, production migration, current-template paid Luna evidence, owner backup and cloud cutover require explicit owner approval.

| Finding | Remediation PR | Evidence and current verification | Remaining limitation |
|---|---|---|---|
| F-01 | [#53](https://github.com/edumarcano/vulpes-health/pull/53) | Exact-main push CI gate; Git auto-deploy disabled; [local evidence](audit-deployment-remediation.md). 533 baseline-plus-deploy unit tests passed. | Cloud rules/token/auto-deploy activation and hosted refusal/deployment proof require approval. Operationally open. |
| F-02 | [#54](https://github.com/edumarcano/vulpes-health/pull/54), depends on #53 | [Schema evidence](audit-schema-remediation.md): six before-repair failures; 23 focused tests and 745 pgTAP assertions pass. Local service 200 / anon 401. | Production metadata migration and hosted compatibility proof require approval. |
| F-03 | Ask PR pending | Temporal grounding, DST intervals and recoverable tool-error evidence pending integration. | Paid current-template Luna verification requires approval. |
| F-04 | Streaming PR pending | Synthetic write-amplification and durable-prefix evidence pending integration. | Hosted latency remains unmeasured. |
| F-05 | Release evidence PR pending | Historical report retained; current-candidate local sequence pending. Explicit Flash dispositions; development-browser acceptance added to CI. | Required external acceptance stays blocked; no release-ready claim. |
| F-06 | Release evidence PR pending | [Recovery target/cutover](../operations/recovery-cutover.md) and fenced local proof. Seven-day manual target plus pre-release capture. | Hosted import/cutover mechanism and rehearsal, fresh owner capture/copy and source-loss completeness remain open. |
| F-07 | #53 | Canonical deployment model and eight-entry-point description corrected; specification validator passed 446 checks. | Actual cloud activation is separate from intended repository configuration. |
| F-08 | #53 | Injected npm warning: 14 failures before, 18 passes after. Fresh Windows clone: 267 source files, zero CRLF. Full format check passed. | Existing clones need local LF normalization; no unrelated content changed. |
| F-09 | Ask PR pending | Contextual safety and numeric goal plausibility verification pending integration. | Heuristics cannot provide medical assessment; approval remains required for every goal. |
| F-10 | Release evidence PR pending | Actual exact pricing function returned `$0.0093192`; ten reserves `$0.093192`. [Policy recommendation](../operations/owner-pilot-data.md#provider-and-budgets) retains existing safeguards. | No budget or financial-policy change. Real future usage/cost remains variable. |
| F-11 | Ask PR pending | Focused tool-step extraction pending integration. | Broader orchestrator refactor remains outside scope. |
| F-12 | Streaming PR pending | Payload-read cleanup isolation evidence pending integration. | Retention/read-time expiry and bounded maintenance must remain enforced. |

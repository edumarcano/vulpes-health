# Deployment audit remediation

Scope: F-01, F-07 and F-08 of the independent v0.1.0 audit, baseline `ad70d74151457cafa01beed02db6aad9c2a86fe8`. Local verification uses synthetic configuration only. No production data, settings or deployments were changed; no provider requests or spend occurred.

## Reproduction

- GitHub's branch API reported `protected: false`, no required checks, and no rulesets on 2026-11-04. This is a read-only observation, not proof of future enforcement.
- The new production configuration regression failed on the baseline: `git.deploymentEnabled` enabled `main`, and main CI used a shared ref concurrency group.
- With `npm_config_vulpes_audit_warning=true`, 14 of 18 existing provider-smoke tests failed while parsing npm's warning as JSON. The repaired tests invoke the Node/tsx CLI directly, preserving the actual command's behavior without the npm wrapper.
- The original checkout had CRLF TypeScript/JavaScript with `core.autocrlf=true`. The committed LF attribute applies to future checkouts; existing tracked source was normalized locally without changing its indexed content.

## Verification

The focused deployment, hosting and provider-smoke suite passed 57 tests. Typecheck, format check and the 446-check specification validator passed. The deployment gate tests require the exact SHA, current main head, main-push event, trusted workflow path, successful latest run attempt and all three successful jobs. Pending/cancelled/failed runs, skipped/missing/wrong-SHA jobs, changed main head, GitHub failure and absent identity/credential are refused. Configuration-only checks never build an artifact.

Cloud enforcement and actual hosted build/deployment remain unverified. Before merging operational changes, complete the [owner activation procedure](../operations/deployment-integrity.md), including rules with no bypass and closing the existing auto-deployment race. A new server-only GitHub read token is required because the repository is private. The existing immutable deployment remains the rollback reference. Local passing tests do not close the operational portion of F-01.

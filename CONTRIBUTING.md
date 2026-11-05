# Contributing

Read [AGENTS.md](AGENTS.md) before changing code. Use a branch in your fork and open a focused pull request against `main` with the problem, change and verification results.

## Local verification

Follow the [README](README.md#run-locally) for the pinned toolchain, local Supabase setup and verification commands. Use synthetic accounts and records only. Database reset, upgrade and restore checks require the dedicated disposable environments described in [release readiness](docs/operations/release-readiness.md).

Keep live inference disabled. Do not use production credentials, upload health records, publish private traces or screenshots, run hosted migrations, deploy, or incur provider charges as part of a contribution. Report suspected vulnerabilities through the [private security reporting route](SECURITY.md), not a public issue.

## Pull request checks

External-contributor workflows require maintainer approval before execution. This approval permits CI execution; it does not approve a merge or production deployment. Maintainers inspect proposed workflow and dependency changes before approving their execution.

Keep changes scoped, preserve provider and domain boundaries, and state which checks passed, were deferred or could not run. Do not replace missing evidence with a claim of verification.

## Licensing

Submit only work you have the right to contribute. Original code and documentation contributions are licensed under the project's [Apache-2.0 license](LICENSE), unless explicitly agreed otherwise. Preserve applicable upstream notices for copied material and follow the separate [branding permissions](BRANDING.md).

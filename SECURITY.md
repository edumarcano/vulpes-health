# Security policy

## Report privately

Use GitHub's [Report a vulnerability](https://github.com/edumarcano/vulpes-health/security/advisories/new) form to contact the maintainers privately. Do not disclose suspected vulnerabilities through public issues or pull requests before coordinated disclosure.

Describe the affected revision, expected behavior, impact and reproduction using synthetic accounts and data. Never include real health records, production credentials, access tokens, private trace bodies or account exports. Use placeholders for private identifiers and redact diagnostic output.

## Testing boundaries

Use a local development environment and synthetic records. A public repository is not authorization to probe the hosted application, access another user's data, run destructive tests, incur provider charges or modify cloud resources. Obtain explicit owner approval before any such activity.

## Supported revisions

Security fixes target `main`; no separately maintained release branches or response-time guarantee are offered. The application is a wellness tool, not a medical diagnostic or emergency-monitoring service.

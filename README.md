# Vulpes

Vulpes is a personal health application for measurements, goals and conversations grounded in deterministic calculations. **Ask Vulpes** provides an inspectable assistant; Data and Goals remain usable without model calls.

The personal-owner pilot is in use on the existing hosted application. Luna is enabled there under consent and persistent budgets. Repository defaults and CI keep inference off; Flash, Argon and decision scoring remain unavailable. Full release and family acceptance are separate from the completed owner handoff. Manual encrypted backup rotation remains necessary.

Merges and pushes to `main` deploy production automatically through Vercel. Preview deployments are disabled; verify PRs on localhost with local Supabase and synthetic data. See [owner operations](docs/operations/owner-pilot-data.md#deployments-and-checks) for deployment checks and migration boundaries.

## Run locally

Use Node 24 and npm 11.18.0:

```sh
npm ci
cp .env.example .env.local
npm run db:start
npm run dev:full
```

Configure a local Supabase project and private accounts using [private account setup](docs/setup/private-accounts.md). Keep populated settings in ignored `.env.local`; the local API reads that file, while Vite also reads `.env`. Never commit credentials or real health data. Without configuration the app displays a sign-in-unavailable state.

Open `http://127.0.0.1:5173`; the local API listens on `127.0.0.1:3001`. Restart both processes after environment or server changes. Stop the application with Ctrl+C and the local database with `npm run db:stop`. Use only synthetic records in local tests.

## Verification

```sh
npm run format:check
npm run lint
npm run typecheck
npm test
npm run test:spec
npm run build
```

Database and browser tests use disposable synthetic accounts and a local Supabase stack. Review [release readiness](docs/operations/release-readiness.md) before running the broader evidence sequence: its reset and upgrade checks target a dedicated disposable project. Local Supabase may publish ports on host interfaces; use a trusted network or host restrictions.

## Documentation

| Document | Purpose |
|---|---|
| [Specifications](docs/spec/v0.1.0/) | Product, architecture, API, data, security, UI and acceptance contracts |
| [Owner operations](docs/operations/owner-pilot-data.md) | Current hosted operation, provider and maintenance boundaries |
| [Account lifecycle](docs/operations/account-lifecycle.md) | Export, deletion and retention |
| [Hosted recovery](docs/operations/hosted-recovery.md) | Encrypted backup, journal and fenced restore |
| [Release readiness](docs/operations/release-readiness.md) | Local evidence reproduction and broader release gates |
| [Implementation decisions](docs/DECISIONS_IMPLEMENTATION.md) | Lasting decisions and corrections |
| [Evidence index](docs/evidence/README.md) | Recorded provider, owner-pilot and historical results |
| [AGENTS.md](AGENTS.md) | Project engineering and safety rules |
| [Contributing](CONTRIBUTING.md) | Local verification and safe public contributions |
| [Security policy](SECURITY.md) | Private vulnerability reporting |

Vulpes uses React, Vite, TypeScript, Supabase and Vercel in a modular monolith. Provider adapters are isolated from domain services. The application is a wellness tool and does not provide medical diagnosis.

## License

Original code and documentation are licensed under [Apache-2.0](LICENSE). Supplied brand artwork has separate [branding permissions](BRANDING.md), and copied third-party materials retain their [upstream licenses](THIRD_PARTY_NOTICES.md).

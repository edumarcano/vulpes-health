# Vulpes implementation decision log

The canonical product and architecture decisions are recorded in [`spec/v0.1.0/DECISIONS.md`](spec/v0.1.0/DECISIONS.md).

Record implementation trade-offs, actual provider capabilities and identifier verification, pinned dependency choices, schema changes, deviations, and relevant tests here. Each entry should identify its date, impact, alternatives and owner approval when required.

## 2026-10-24: PR 01 application foundation

**Status:** Implemented within the approved PR 01 plan; local verification is recorded in [PR 01 evidence](evidence/pr01-foundation.md). No deployment or inference activation.

**Decisions:**

| Area | Choice and reason |
|---|---|
| Runtime | Node 24 (`24.15.0` tested), npm `11.18.0`, exact direct dependency pins and npm lockfile. TypeScript `6.0.3` satisfies typescript-eslint `8.72.0`'s `<6.1` peer range; the latest TypeScript 7 was not compatible. |
| UI dependencies | React `19.3.1`, Vite `8.3.5`, React Router `7.18.4`, TanStack Query `5.104.5`, assistant-ui `0.15.31`, Tailwind `4.3.3`, adapted shadcn Button/Card source, and Lucide. Chart/animation/provider/database packages remain deferred. |
| Local runtime | A loopback Node HTTP runner executes the same thin API handler as Vercel. Vite proxies API traffic; concurrently supervises the two processes. API changes require a restart so startup failures propagate instead of leaving a watcher alive. No application server framework or cloud credentials are needed. |
| API scope | Public liveness only. The status entry point also handles the hosting rewrite's unmatched-API discriminator, preserving JSON errors without an extra deployed function. Add future named API routes ahead of the fallback. |
| Configuration | Parse the live switch strictly, but keep inference unavailable even when requested. No provider transport, runtime model registry, or model environment overrides are introduced. |
| CSP | Production scripts and connections are same-origin; component inline styles are allowed. Development additionally permits Vite's inline refresh script and loopback HMR WebSocket. Test the production policy through the built preview. |
| Branding | Use approved PNGs without cropping/recoloring. Dark text accents use the lighter semantic focus-color derivative after the initial orange-on-muted navigation measured 3.80:1 contrast. Logo and button colors are preserved. |

**Verification:** Vitest exercises the actual Node HTTP handler and Vite's disconnected-proxy response; Playwright checks the built shell. No persistence or authenticated provider support is claimed. See the evidence record for exact commands, fixes, screenshots, and remaining gates.

## 2026-10-19: Typed model catalog, minimal deployment environment

**Status:** Approved baseline; integrated into canonical specifications ([`DECISIONS.md`](spec/v0.1.0/DECISIONS.md#d08---models-and-typed-catalog), [`PROVIDER_SETUP.md`](spec/v0.1.0/PROVIDER_SETUP.md), and [`ARCHITECTURE.md`](spec/v0.1.0/ARCHITECTURE.md)).

**Decision:** Server-side model identities, provider adapters, model-specific reasoning, token limits and routing defaults are version-controlled in one typed catalog (`server/config/models.ts`), not duplicated in `.env` and runtime JSON. Secrets/deployment identity and a fail-closed AI enable switch remain in the environment. Use one capability-aware gateway and provider-specific adapters. Model changes are independently testable and require approval before live activation.

**Reason:** Prevent configuration drift and make monthly model evaluations practical without modifying domain or agent code.

## 2026-10-19: Ask Vulpes, language policy, modularity, repository housekeeping

**Status:** Approved baseline; integrated into canonical specifications ([`PRODUCT_SPEC.md`](spec/v0.1.0/PRODUCT_SPEC.md), [`DECISIONS.md`](spec/v0.1.0/DECISIONS.md), [`ARCHITECTURE.md`](spec/v0.1.0/ARCHITECTURE.md), [`UI_SPEC.md`](spec/v0.1.0/UI_SPEC.md), and [`ACCEPTANCE_TESTS.md`](spec/v0.1.0/ACCEPTANCE_TESTS.md)).

**Decision:** Main AI experience is **Ask Vulpes**, compact tab **Ask**, route `/ask`. Build the v0.1.0 client and backend in strict TypeScript, SQL for migrations, Kotlin later if needed for Android; a future Python analytics service is permitted when justified by validated scientific requirements but must remain behind a stable contract. Enforce replaceability tests for generation/decision providers and measurement-source adapters. Consolidate specifications directly into the canonical documentation and remove obsolete starter-package artifacts.

**Reason:** Align interface naming with Vulpes branding, maintain a one-language MVP, enable frequent model swaps, avoid unnecessary root-level documentation and maintain a clean, unified documentation baseline.

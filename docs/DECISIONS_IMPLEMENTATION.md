# Vulpes implementation decision log

The canonical product and architecture decisions are recorded in [`spec/v0.1.0/DECISIONS.md`](spec/v0.1.0/DECISIONS.md).

Record implementation trade-offs, actual provider capabilities and identifier verification, pinned dependency choices, schema changes, deviations, and relevant tests here. Each entry should identify its date, impact, alternatives and owner approval when required.

## 2026-10-19: Typed model catalog, minimal deployment environment

**Status:** Approved baseline; integrated into canonical specifications ([`DECISIONS.md`](spec/v0.1.0/DECISIONS.md#d08---models-and-typed-catalog), [`PROVIDER_SETUP.md`](spec/v0.1.0/PROVIDER_SETUP.md), and [`ARCHITECTURE.md`](spec/v0.1.0/ARCHITECTURE.md)).

**Decision:** Server-side model identities, provider adapters, model-specific reasoning, token limits and routing defaults are version-controlled in one typed catalog (`server/config/models.ts`), not duplicated in `.env` and runtime JSON. Secrets/deployment identity and a fail-closed AI enable switch remain in the environment. Use one capability-aware gateway and provider-specific adapters. Model changes are independently testable and require approval before live activation.

**Reason:** Prevent configuration drift and make monthly model evaluations practical without modifying domain or agent code.

## 2026-10-19: Ask Vulpes, language policy, modularity, repository housekeeping

**Status:** Approved baseline; integrated into canonical specifications ([`PRODUCT_SPEC.md`](spec/v0.1.0/PRODUCT_SPEC.md), [`DECISIONS.md`](spec/v0.1.0/DECISIONS.md), [`ARCHITECTURE.md`](spec/v0.1.0/ARCHITECTURE.md), [`UI_SPEC.md`](spec/v0.1.0/UI_SPEC.md), and [`ACCEPTANCE_TESTS.md`](spec/v0.1.0/ACCEPTANCE_TESTS.md)).

**Decision:** Main AI experience is **Ask Vulpes**, compact tab **Ask**, route `/ask`. Build the v0.1.0 client and backend in strict TypeScript, SQL for migrations, Kotlin later if needed for Android; a future Python analytics service is permitted when justified by validated scientific requirements but must remain behind a stable contract. Enforce replaceability tests for generation/decision providers and measurement-source adapters. Consolidate specifications directly into the canonical documentation and remove obsolete starter-package artifacts.

**Reason:** Align interface naming with Vulpes branding, maintain a one-language MVP, enable frequent model swaps, avoid unnecessary root-level documentation and maintain a clean, unified documentation baseline.

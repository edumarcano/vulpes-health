# Changelog

All notable changes to Vulpes will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-10

### Added
- **Ask Vulpes:** Chat interface powered by server-side tool orchestration, delivering deterministic calculations with inspectable execution metadata.
- **Data Management:** Manual measurement entry and structured CSV import (including English RENPHO Health scale exports) with duplicate detection and preview validation.
- **Goal Tracking:** Conversational goal proposals with mandatory explicit user approval, deterministic progress computation, and revision history.
- **Execution Inspector:** Detailed inspection dialog displaying provider requests, step timings, token usage, tool parameters, and calculated cost breakdowns.
- **Privacy & Security:** Account isolation via PostgreSQL Row-Level Security, AES-256-GCM encryption for stored private execution traces, explicit AI consent gates, and configurable spending ceilings.
- **Operations & Recovery:** Two-tier recovery runbook featuring routine headless encrypted database and deletion journal snapshots alongside isolated containerized restoration rehearsals.
- **Specification Package:** Complete product specifications, API contracts, AI orchestration rules, and 614 automated specification checks.

# Owner-pilot Step 3C: hosted setup, publication pending

Date: 2026-10-31. Application candidate `bf42111120e287e4b709ea073bfae31ba91f5048`, PR #28, stacked on #27 and unmerged. Both candidate checks passed in [CI run 41264126258](https://github.com/edumarcano/vulpes-health/actions/runs/41264126258). The owner explicitly approved synthetic migrations/deployment with inference off and $0 paid spending. This record does not authorize real data, provider activation, recovery destruction or automatic merge.

## Verified hosted work

| Interface/check | Observed result |
|---|---|
| Scoped Management API project read | Correct source reference, `us-east-1`, `ACTIVE_HEALTHY`, PostgreSQL `17.11.0.011` |
| Read-only source preflight | Zero public relations/functions, Auth users, Storage buckets/objects and no migration history |
| Supabase CLI 2.122.0 `db push --project-ref=<approved-source> --workdir=<ignored-generated-copy> --skip-vault --dry-run --agent yes` | Exit 0; exact 38 reviewed migrations listed; copied/source hashes match |
| Same pinned CLI target, `--yes` replacing `--dry-run` | Exit 0; all 38 migrations applied without reset, extra migrations, seeds or vault updates |
| Independent read-only migration-history query | Exact ordered 38-version equality with the reviewed manifest |
| Post-migration schema | 19 public tables; zero tables without RLS; zero profiles, Auth users and Storage objects |
| Vercel Production environment metadata | Seven required variables, Production only: three private values are Secrets, four public/operational values are Config; no provider credentials |
| Local hosted guard using protected source credentials and bound platform identity, `--check-only` | Valid synthetic-only configuration, inference false; build not run |
| Vercel CLI 62.5.0 source dry-run | 414 candidate files; no private upload paths; no upload/deployment |
| Public Auth settings | Email/password enabled; **public signup still enabled** (`disable_signup: false`), blocking publication |

The scoped token and selected source/trace keys are stored locally using Windows DPAPI, excluded from Git and uploads. Secret values travel to the Vercel CLI through stdin, never arguments or published logs. The trace key was generated from 32 cryptographically random bytes and was not rotated on retries. The owner confirmed Vercel optional training/sharing opt-out; Vercel account MFA was independently reported enabled. Root local-test configuration and retained Luna allocations remain untouched. No unrelated Supabase project was accessed.

The initial CLI summary counted one array container rather than its 38 migration-version entries. A separate read-only projection confirmed all 38 versions; no migration was repeated. The original summary and corrected count remain in ignored evidence. Raw CLI output, target manifests, encrypted credentials and safe operational receipts remain under `.scratch/hosting-owner-pilot/` and `.scratch/hosting/`; they are not public release artifacts.

## Remaining checkpoint

The token intentionally has no Auth configuration write permission. The owner must disable global public signup and anonymous sign-ins while keeping email/password enabled, then configure the exact site URL and narrow redirects. Verify those settings before publishing. Synthetic identities/profile provisioning, authenticated API/direct-RLS checks, immutable deployment/build binding, actual hosted CSP/routing/cache behavior and readable disabled Ask/Settings states remain unverified. Row-security flags alone do not prove isolation.

The actual deployment count remains zero. Additional paid spend and provider requests are zero. Separate hosted-source recovery/maintenance, backup/journal/key custody, device and formal acceptance gates remain pending; recovery is deferred, not passed. See the [operator procedure](../operations/synthetic-hosting.md) and [execution ledger](../plans/v0.1.0-execution.md#owner-pilot-continuation).

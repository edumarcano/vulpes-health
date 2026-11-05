# Schema deployment guard

F-02 reproduction used the actual `hostedBuild` entry point with synthetic environment, GitHub evidence, database responses and a stubbed child-process boundary. Before repair, six cases incorrectly proceeded to the application build: lagging migration set, an older missing migration, three malformed responses, and an unavailable RPC. No hosted database was contacted.

The guard requires every repository migration version in the service-only database inventory before running the build. Checking only the maximum version would overlook older holes. Missing/unavailable/malformed evidence fails closed. Additional forward migrations are permitted for expand/contract deployments; version presence is not proof against manual schema drift or a destructive future migration.

`20261104000100_schema_compatibility.sql` adds a read-only metadata RPC with pinned search path and service-only execution. It changes no health records, application tables or accounting. Hosted application code does not apply it. Apply and verify it separately with explicit owner approval before merging the dependent build guard; preserve the currently serving application throughout.

Verification: all 23 focused schema/deployment tests passed; strict typecheck and lint passed. The migration applied only to `.scratch/pr17-verification` on loopback ports 27421/27422, leaving the retained original local stack untouched. All 745 pgTAP assertions passed, including service-only privileges and pinned search path. Database lint and generated-type consistency passed; `database.types.ts` was generated with `npm run db:types` in that disposable workspace, then copied without hand edits.

Actual PostgREST calls returned `service_role: 200`, 40 migration versions ending `20261104000100`; `anon: 401`. No health content or keys were printed. Hosted application, production migration and cloud build remain unverified and require approval. These checks prove local migration inventory and access behavior, not hosted schema equivalence.

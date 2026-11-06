import { readdirSync } from 'node:fs';
import { z } from 'zod';

const Version = z.string().regex(/^\d{14}$/);
export function requiredSchemaVersions() {
  const files = readdirSync(
    new URL('../supabase/migrations/', import.meta.url),
  );
  if (!files.length || files.some((f) => !/^\d{14}_[a-z0-9_]+\.sql$/.test(f)))
    throw new Error('repository_migrations_invalid');
  const versions = files.map((f) => f.slice(0, 14)).sort();
  if (new Set(versions).size !== versions.length)
    throw new Error('repository_migrations_invalid');
  return versions;
}

export async function verifyHostedSchema(
  env: NodeJS.ProcessEnv,
  request: typeof fetch = fetch,
) {
  const required = requiredSchemaVersions();
  const response = await request(
    `${env.VITE_SUPABASE_URL}/rest/v1/rpc/schema_version_v1`,
    {
      method: 'POST',
      headers: {
        apikey: env.SUPABASE_SERVICE_ROLE_KEY!,
        Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY!}`,
        'Content-Type': 'application/json',
      },
      body: '{}',
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok) throw new Error('hosted_schema_unavailable');
  const parsed = z
    .object({ versions: z.array(Version) })
    .safeParse(await response.json());
  if (!parsed.success) throw new Error('hosted_schema_evidence_invalid');
  const applied = parsed.data;
  if (
    new Set(applied.versions).size !== applied.versions.length ||
    required.some((v) => !applied.versions.includes(v))
  )
    throw new Error('hosted_schema_incompatible');
  return {
    requiredMigrations: required.length,
    requiredSchemaVersion: required.at(-1)!,
  };
}

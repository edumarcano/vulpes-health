import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import {
  RecoveryHttpSchema,
  verifyRecoveryHttp,
  type RecoveryHttpInput,
  type RecoveryHttpClient,
} from './recovery-http.js';
import {
  recoveryReadCatalogSql,
  recoveryReadInventorySql,
} from './recovery-inventory.js';

type Docker = (
  args: string[],
  input?: Buffer,
  extra?: NodeJS.ProcessEnv,
) => Buffer;
export async function recoveryHttpServices(
  input: RecoveryHttpInput,
  journalOwners: Set<string>,
  sql: (statement: string, role?: string) => string,
  docker: Docker,
  id: string,
  guard: () => Promise<void>,
  onFailure?: (bytes: Buffer) => void,
) {
  const proof = RecoveryHttpSchema.parse(input),
    owned: string[] = [];
  function cleanup() {
    let failed = false;
    for (const child of owned.reverse()) {
      try {
        docker(['rm', '--force', '--volumes', child]);
      } catch {
        failed = true;
      }
    }
    if (failed)
      throw new Error(
        'Owned recovery HTTP cleanup incomplete; inspect the stopped recovery destination.',
      );
  }
  const catalog = () =>
    sql('begin read only;' + recoveryReadCatalogSql + 'rollback;');
  const publicRows = () =>
    Object.fromEntries(
      Object.entries(
        JSON.parse(
          sql('begin read only;' + recoveryReadInventorySql + 'rollback;'),
        ) as Record<string, unknown>,
      ).filter(([table]) => table.startsWith('public.')),
    );
  const accounts = z
    .array(z.object({ id: z.uuid(), email: z.email() }))
    .parse(
      JSON.parse(
        sql(
          "select coalesce(jsonb_agg(jsonb_build_object('id',id,'email',email)),'[]') from auth.users;",
        ),
      ),
    );
  const keepers = new Set<string>();
  for (const u of proof.users) {
    const account = accounts.find((a) => a.id === u.id);
    if (account) {
      if (account.email !== u.email)
        throw new Error('Recovery HTTP identity mismatch.');
      keepers.add(u.id);
    } else if (!journalOwners.has(u.id))
      throw new Error('Deleted HTTP identity missing journal authority.');
  }
  if (keepers.size < 2 || !proof.users.some((u) => journalOwners.has(u.id)))
    throw new Error('Recovery HTTP fixture coverage incomplete.');
  const secret = randomBytes(48).toString('hex'),
    authPassword = randomBytes(32).toString('hex'),
    restPassword = randomBytes(32).toString('hex');
  const common = {
    GOTRUE_DB_DRIVER: 'postgres',
    GOTRUE_DB_DATABASE_URL: `postgres://supabase_auth_admin:${authPassword}@127.0.0.1:5432/postgres`,
    GOTRUE_SITE_URL: 'http://localhost',
    API_EXTERNAL_URL: 'http://127.0.0.1:9999',
    GOTRUE_API_HOST: '127.0.0.1',
    PORT: '9999',
    GOTRUE_API_PORT: '9999',
    GOTRUE_JWT_SECRET: secret,
    GOTRUE_JWT_EXP: '3600',
    GOTRUE_JWT_AUD: 'authenticated',
    GOTRUE_JWT_ADMIN_ROLES: 'service_role',
    GOTRUE_DISABLE_SIGNUP: 'true',
    GOTRUE_EXTERNAL_EMAIL_ENABLED: 'true',
    GOTRUE_MAILER_AUTOCONFIRM: 'true',
    GOTRUE_EXTERNAL_ANONYMOUS_USERS_ENABLED: 'false',
    GOTRUE_SECURITY_REFRESH_TOKEN_ROTATION_ENABLED: 'true',
    GOTRUE_LOG_LEVEL: 'error',
  };
  const rest = {
    PGRST_DB_URI: `postgres://authenticator:${restPassword}@127.0.0.1:5432/postgres`,
    PGRST_DB_CONFIG: 'false',
    PGRST_JWT_SECRET: secret,
    PGRST_DB_ANON_ROLE: 'anon',
    PGRST_DB_SCHEMAS: 'public',
    PGRST_SERVER_HOST: '127.0.0.1',
    PGRST_SERVER_PORT: '3000',
    PGRST_DB_POOL: '2',
    PGRST_LOG_LEVEL: 'crit',
  };
  async function start(image: string, env: NodeJS.ProcessEnv, label: string) {
    await guard();
    docker(['image', 'inspect', image]);
    const name =
      'vulpes-recovery-' + label + '-' + randomUUID().replaceAll('-', '');
    const child = docker(
      [
        'create',
        '--pull=never',
        '--network=container:' + id,
        '--name',
        name,
        ...Object.keys(env).flatMap((k) => ['--env', k]),
        image,
      ],
      undefined,
      env,
    )
      .toString()
      .trim();
    if (!/^[a-f0-9]{64}$/.test(child))
      throw new Error('Owned recovery HTTP container missing.');
    owned.push(child);
    const state = JSON.parse(
      docker(['inspect', '--format', '{{json .}}', child]).toString(),
    ) as {
      Name: string;
      Image: string;
      HostConfig: {
        NetworkMode: string;
        PortBindings: Record<string, unknown> | null;
        Binds: unknown[] | null;
        Privileged: boolean;
      };
      Mounts: unknown[];
    };
    if (
      state.Name !== '/' + name ||
      state.Image !== image ||
      state.HostConfig.NetworkMode !== 'container:' + id ||
      Object.keys(state.HostConfig.PortBindings ?? {}).length ||
      state.HostConfig.Binds?.length ||
      state.HostConfig.Privileged ||
      state.Mounts.length
    )
      throw new Error('Recovery HTTP fence unavailable.');
    docker(['start', child]);
  }
  let requests = 0;
  const client: RecoveryHttpClient = {
    request: async (service, path, method, body, token) => {
      await guard();
      if (++requests > 150 || !path.startsWith('/') || /[\r\n]/.test(path))
        throw new Error('Recovery HTTP request bound exceeded.');
      const options = [
        `url = ${JSON.stringify('http://127.0.0.1:' + (service === 'auth' ? '9999' : '3000') + path)}`,
        `request = ${JSON.stringify(method)}`,
        'header = "Content-Type: application/json"',
        ...(token
          ? [`header = ${JSON.stringify('Authorization: Bearer ' + token)}`]
          : []),
        ...(body !== undefined
          ? [`data = ${JSON.stringify(JSON.stringify(body))}`]
          : []),
      ];
      const bytes = Buffer.from(options.join('\n'));
      try {
        const output = docker(
          [
            'exec',
            '-i',
            id,
            'curl',
            '--silent',
            '--max-time',
            '3',
            '--max-filesize',
            '2097152',
            '--write-out',
            '\n%{http_code}',
            '--config',
            '-',
          ],
          bytes,
        ).toString();
        if (output.length > 2097152)
          throw new Error('Recovery HTTP response exceeds bounds.');
        const split = output.lastIndexOf('\n'),
          status = Number(output.slice(split + 1)),
          raw = output.slice(0, split);
        return { status, body: raw ? (JSON.parse(raw) as unknown) : null };
      } finally {
        bytes.fill(0);
      }
    },
  };
  try {
    await guard();
    // Only ephemeral service-role passwords in this new destination change.
    sql(
      `alter role supabase_auth_admin password '${authPassword}';alter role authenticator password '${restPassword}';`,
      'supabase_admin',
    );
    const before = catalog(),
      rows = JSON.stringify(publicRows());
    await start(proof.authImage, common, 'auth');
    await start(proof.restImage, rest, 'rest');
    for (const service of ['auth', 'rest'] as const) {
      let ready = false;
      for (let n = 0; n < 30; n++) {
        try {
          const r = await client.request(
            service,
            service === 'auth' ? '/health' : '/',
            'GET',
          );
          if (r.status === 200) {
            ready = true;
            break;
          }
        } catch {
          /* Startup connection failures contain no emitted private diagnostics. */
        }
        await new Promise((resolve) => setTimeout(resolve, 250));
      }
      if (!ready)
        throw new Error('Recovery HTTP service unavailable: ' + service);
    }
    const report = await verifyRecoveryHttp(proof, keepers, client);
    if (before !== catalog() || rows !== JSON.stringify(publicRows()))
      throw new Error(
        'Recovery HTTP changed the restored security catalog or product rows.',
      );
    return report;
  } catch (error) {
    for (const child of owned) {
      onFailure?.(docker(['logs', '--tail', '30', child]));
    }
    throw error;
  } finally {
    // These exact immutable IDs were created by this invocation. Remove their
    // ephemeral credentials/logs; the database remains separately fenced/stopped.
    cleanup();
  }
}

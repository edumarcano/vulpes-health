import { createHash, randomUUID } from 'node:crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { z } from 'zod';
import type { Database } from '../server/db/database.types.js';
import { recoverAccount } from '../server/security/account-recovery.js';
import { AccountStatusSchema } from '../shared/account.js';
import {
  AuthenticatedStatusSchema,
  SettingsSchema,
  publicAuthConfig,
} from '../shared/auth.js';
import {
  MutationResultSchema,
  MeasurementMutationResultSchema,
  DataSummarySchema,
  MeasurementsPageSchema,
} from '../shared/data.js';
import { ImportResultSchema } from '../shared/imports.js';
import { ImportPreviewV2Schema as ImportPreviewSchema } from '../shared/import-v2.js';
import {
  GoalDefinitionSchema,
  GoalRevisionPayloadSchema,
} from '../shared/goals.js';
import { MessagesPageSchema } from '../shared/chat.js';
import {
  HostingTargetSchema,
  supabaseOrigin,
  type HostingTarget,
} from './hosting.js';

const userSchema = z.strictObject({
  id: z.uuid(),
  email: z.enum(['vulpes-3d-a@example.invalid', 'vulpes-3d-b@example.invalid']),
  password: z.string().min(24).max(100),
  nextPassword: z.string().min(24).max(100),
});
export const LifecyclePlanSchema = z
  .strictObject({
    purpose: z.literal('owner-pilot-3d2'),
    runId: z.uuid(),
    createdAt: z.iso.datetime(),
    projectRef: z.string().regex(/^[a-z0-9]{20}$/),
    users: z.tuple([userSchema, userSchema]),
  })
  .refine(
    (p) =>
      p.users[0].id !== p.users[1].id &&
      p.users[0].email === 'vulpes-3d-a@example.invalid' &&
      p.users[1].email === 'vulpes-3d-b@example.invalid' &&
      p.users.every((u) => u.password !== u.nextPassword),
  );
export type LifecyclePlan = z.infer<typeof LifecyclePlanSchema>;
export const LifecyclePhaseSchema = z.enum([
  'provision',
  'journey',
  'reset',
  'delete-start',
  'delete-resume',
]);
export type LifecyclePhase = z.infer<typeof LifecyclePhaseSchema>;
type Artifacts = {
  read: (name: string) => Promise<unknown>;
  write: (name: string, value: unknown) => Promise<void>;
};
const tables = [
  'profiles',
  'data_sources',
  'import_batches',
  'measurements',
  'conversations',
  'messages',
  'goals',
  'action_proposals',
  'goal_revisions',
  'private_payloads',
  'ai_runs',
  'ai_steps',
  'usage_buckets',
  'usage_reservations',
  'audit_events',
  'live_verification_allocations',
] as const;
const graphSchema = z.strictObject({
  manualSource: z.uuid(),
  manualReading: z.uuid(),
  csvSource: z.uuid(),
  batch: z.uuid(),
  proposal: z.uuid(),
  goal: z.uuid(),
  conversation: z.uuid(),
  revision: z.uuid(),
  message: z.uuid(),
});
type Graph = z.infer<typeof graphSchema>;
const jsonRows = z.array(z.record(z.string(), z.unknown()));
const sha = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
const ensure = (value: unknown, name: string) => {
  if (!value) throw new Error(name);
};
const requestId = () => randomUUID();

// Operator rehearsal only. The caller durably protects the plan before provisioning
// and supplies create-only private artifacts; no ambient credentials or public admin route.
export async function hostedLifecycle(
  input: {
    target: HostingTarget;
    plan: LifecyclePlan;
    publishableKey: string;
    adminKey: string;
    phase: LifecyclePhase;
    approved: boolean;
    csv: string;
    artifacts: Artifacts;
  },
  network: typeof fetch = fetch,
) {
  ensure(input.approved === true, 'approval_required');
  LifecyclePhaseSchema.parse(input.phase);
  const target = HostingTargetSchema.parse(input.target),
    plan = LifecyclePlanSchema.parse(input.plan),
    source = supabaseOrigin(target);
  ensure(
    plan.projectRef === target.supabaseProjectRef &&
      publicAuthConfig(source, input.publishableKey) &&
      input.adminKey !== input.publishableKey,
    'target_mismatch',
  );
  ensure(
    /^sb_secret_[\w-]+$/.test(input.adminKey) ||
      (() => {
        try {
          return (
            JSON.parse(
              Buffer.from(
                input.adminKey.split('.')[1]!,
                'base64url',
              ).toString(),
            ).role === 'service_role'
          );
        } catch {
          return false;
        }
      })(),
    'invalid_admin_key',
  );
  const checks: string[] = [];
  let step = 'start',
    requests = 0,
    sessionCleanupConfirmed = true;
  let failure: { failedStep: string; reason: string } | null = null;
  const sessions: SupabaseClient<Database>[] = [];
  const boundedFetch: typeof fetch = async (url, init) => {
    const parsed = new URL(
      typeof url === 'string' ? url : url instanceof URL ? url.href : url.url,
    );
    ensure(
      [source, target.appOrigin].includes(parsed.origin),
      'unexpected_origin',
    );
    ensure(requests < 800, 'request_limit');
    requests++;
    return network(url, {
      ...init,
      redirect: 'error',
      credentials: 'omit',
      signal: AbortSignal.any([
        AbortSignal.timeout(25_000),
        ...(init?.signal ? [init.signal] : []),
      ]),
    });
  };
  const options = {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: boundedFetch },
  };
  const admin = createClient<Database>(source, input.adminKey, options);
  const test = async (name: string, run: () => Promise<void>) => {
    step = name;
    await run();
    checks.push(name);
  };
  const dbCheck = (
    error: { code?: string | undefined } | null,
    name: string,
  ) => {
    if (error)
      throw new Error(
        name +
          '_' +
          (/^[A-Za-z0-9_]{1,40}$/.test(error.code ?? '')
            ? error.code
            : 'unavailable'),
      );
  };
  async function own(index: number) {
    const u = plan.users[index]!;
    const receipt = z
      .object({ id: z.uuid(), runId: z.uuid(), projectRef: z.string() })
      .parse(await input.artifacts.read('created-' + index));
    ensure(
      receipt.id === u.id &&
        receipt.runId === plan.runId &&
        receipt.projectRef === plan.projectRef,
      'creation_receipt_mismatch',
    );
    const result = await admin.auth.admin.getUserById(u.id);
    if (
      input.phase === 'delete-resume' &&
      result.error?.code === 'user_not_found' &&
      !result.data.user
    ) {
      const journal = await admin
        .from('account_deletion_receipts')
        .select('phase,outcome,completed_at')
        .eq('user_id', u.id)
        .single();
      dbCheck(journal.error, 'completed_owned_receipt');
      ensure(
        journal.data?.phase === 'completed' &&
          journal.data.outcome === 'completed' &&
          journal.data.completed_at,
        'missing_completed_receipt',
      );
      return 'completed';
    }
    dbCheck(result.error, 'owned_auth');
    const user = result.data.user;
    ensure(
      user?.id === u.id &&
        user.email === u.email &&
        user.app_metadata.vulpes_rehearsal === plan.purpose &&
        user.app_metadata.vulpes_run_id === plan.runId,
      'owned_identity_mismatch',
    );
    return 'present';
  }
  async function login(index: number, password = plan.users[index]!.password) {
    const client = createClient<Database>(
      source,
      input.publishableKey,
      options,
    );
    sessions.push(client);
    const result = await client.auth.signInWithPassword({
      email: plan.users[index]!.email,
      password,
    });
    dbCheck(result.error, 'sign_in');
    ensure(
      result.data.user?.id === plan.users[index]!.id && result.data.session,
      'signed_identity_mismatch',
    );
    return {
      client,
      token: result.data.session!.access_token,
      refresh: result.data.session!.refresh_token,
    };
  }
  async function bytes(response: Response) {
    const reader = response.body?.getReader();
    ensure(reader, 'missing_body');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      while (true) {
        const next = await reader!.read();
        if (next.done) break;
        size += next.value.length;
        ensure(size <= 2 * 1024 * 1024, 'response_limit');
        chunks.push(next.value);
      }
      return Buffer.concat(chunks).toString('utf8');
    } finally {
      await reader!.cancel().catch(() => undefined);
      reader!.releaseLock();
    }
  }
  async function api(
    path: string,
    token: string,
    body?: unknown,
    status = 200,
  ) {
    const response = await boundedFetch(target.appOrigin + path, {
      method: body === undefined ? 'GET' : 'POST',
      headers: {
        Authorization: 'Bearer ' + token,
        ...(path.split('?')[0] === '/api/data'
          ? { 'X-Vulpes-Data-Contract': '2' }
          : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    ensure(
      response.status === status,
      'api_http_' + response.status + '_expected_' + status,
    );
    ensure(
      response.headers.get('cache-control') === 'no-store' &&
        response.headers.get('content-type')?.startsWith('application/json'),
      'api_headers',
    );
    const value: unknown = JSON.parse(await bytes(response));
    const envelope = z.object({ data: z.unknown() });
    if (
      status === 200 &&
      path === '/api/account' &&
      body &&
      typeof body === 'object' &&
      'action' in body &&
      body.action === 'export'
    ) {
      ensure(
        response.headers.get('content-disposition') ===
          'attachment; filename="vulpes-account-v2.json"',
        'export_attachment',
      );
      return value;
    }
    return status === 200 ? envelope.parse(value).data : value;
  }
  async function rows(table: (typeof tables)[number], id: string) {
    const result = await admin
      .from(table)
      .select('*')
      .eq('user_id', id)
      .order(table === 'profiles' ? 'user_id' : 'id');
    dbCheck(result.error, 'inventory_' + table);
    return jsonRows.parse(result.data);
  }
  async function foreignSnapshot(index: number) {
    const result: Record<string, unknown> = {};
    for (const table of tables)
      result[table] = await rows(table, plan.users[index]!.id);
    return sha(result);
  }
  async function untouched() {
    const profiles = await admin
      .from('profiles')
      .select('user_id,account_state,data_revision,updated_at')
      .not('user_id', 'in', '(' + plan.users.map((u) => u.id).join(',') + ')')
      .order('user_id');
    dbCheck(profiles.error, 'existing_profiles');
    const budgets = await admin
      .from('usage_buckets')
      .select('*')
      .eq('scope', 'app')
      .order('id');
    dbCheck(budgets.error, 'shared_budgets');
    return sha({ profiles: profiles.data, budgets: budgets.data });
  }
  const observation = {
    metric: 'weight',
    value: '70',
    unit: 'kg',
    observed_at: '2026-09-08T08:00:00Z',
    timezone: 'UTC',
    local_date: null,
    granularity: 'instant',
    method: 'device_reported',
    quality_flags: [],
  };
  const definition = (sourceId: string) =>
    GoalDefinitionSchema.parse({
      schemaVersion: 1,
      title: 'Synthetic 3D goal',
      metric: 'weight',
      unit: 'kg',
      sourceId,
      target: { direction: 'decrease_to', value: 68 },
      baselineMethod: 'daily_median_mean_7d',
      reportedBaseline: null,
      baselineFrom: '2026-09-01T00:00:00Z',
      baselineTo: '2026-09-08T00:00:00Z',
      currentMethod: 'daily_median_mean_7d',
      method: 'device_reported',
      granularity: 'instant',
      timezone: 'UTC',
      targetDate: null,
      constraints: [],
      proposedStrategy: null,
    });
  const selection = (sourceId: string, view: string) =>
    '/api/data?' +
    new URLSearchParams({
      view,
      source_id: sourceId,
      metric: 'weight',
      from: '2026-09-08T00:00:00Z',
      to: '2026-09-15T00:00:00Z',
      timezone: 'UTC',
      method: 'device_reported',
      granularity: 'instant',
    });
  const graphs: Graph[] = [];
  try {
    if (input.phase === 'provision') {
      await test('refuse-existing-names-and-ids', async () => {
        const listed = await admin.auth.admin.listUsers({
          page: 1,
          perPage: 200,
        });
        dbCheck(listed.error, 'list_users');
        ensure(listed.data.users.length < 200, 'unbounded_user_inventory');
        ensure(
          !listed.data.users.some((u) =>
            plan.users.some(
              (p) => p.id === u.id || p.email === u.email?.toLowerCase(),
            ),
          ),
          'preexisting_disposable_identity',
        );
      });
      await input.artifacts.write('baseline', { hash: await untouched() });
      for (const [i, u] of plan.users.entries())
        await test('provision-disposable-' + i, async () => {
          const created = await admin.auth.admin.createUser({
            id: u.id,
            email: u.email,
            password: u.password,
            email_confirm: true,
            app_metadata: {
              vulpes_rehearsal: plan.purpose,
              vulpes_run_id: plan.runId,
            },
          });
          dbCheck(created.error, 'create_user');
          ensure(created.data.user?.id === u.id, 'created_id_mismatch');
          await input.artifacts.write('created-' + i, {
            id: u.id,
            runId: plan.runId,
            projectRef: plan.projectRef,
          });
          await own(i);
          const profile = await admin.from('profiles').insert({
            user_id: u.id,
            display_name: 'Synthetic 3D ' + (i ? 'B' : 'A'),
            timezone: 'UTC',
            units: 'metric',
          });
          dbCheck(profile.error, 'create_profile');
        });
    } else {
      const owned = await Promise.all([own(0), own(1)]);
      if (input.phase === 'journey') {
        const authenticated = await Promise.all([login(0), login(1)]);
        for (const [i, session] of authenticated.entries()) {
          const u = plan.users[i]!,
            token = session.token;
          await test('disabled-and-empty-' + i, async () => {
            const status = AuthenticatedStatusSchema.parse(
              await api('/api/status', token),
            );
            const settings = SettingsSchema.parse(
              await api('/api/settings', token),
            );
            ensure(
              !status.features.inference &&
                status.roles.everyday === 'unavailable' &&
                settings.providerConsents.every((c) => !c.accepted) &&
                settings.budget.allocationUSD === null,
              'inference_or_budget_enabled',
            );
            for (const table of tables)
              ensure(
                (await rows(table, u.id)).length ===
                  (table === 'profiles' ? 1 : 0),
                'nonempty_fixture_start',
              );
          });
          let manual!: z.infer<typeof MutationResultSchema>,
            csvSource = '',
            batch = '',
            proposal = '',
            goal = '',
            conversation = '',
            revision = '';
          await test('manual-entry-correction-' + i, async () => {
            manual = MutationResultSchema.parse(
              await api('/api/data', token, {
                action: 'add_measurement',
                client_request_id: requestId(),
                source: {
                  kind: 'new',
                  label: 'Synthetic 3D ' + (i ? 'B' : 'A') + ' manual',
                  origin_app: null,
                  device_label: null,
                },
                observation,
              }),
            );
            const edit = MeasurementMutationResultSchema.parse(
              await api('/api/data', token, {
                action: 'correct_measurement',
                measurement_id: manual.id,
                expected_version: manual.version,
                client_request_id: requestId(),
                changes: {
                  value: '69.5',
                  unit: 'kg',
                  observed_at: observation.observed_at,
                  timezone: 'UTC',
                  local_date: null,
                },
              }),
            );
            ensure(
              edit.version === 2 && edit.dataRevision > manual.dataRevision,
              'correction_version',
            );
            const read = MeasurementsPageSchema.parse(
              await api(selection(manual.sourceId, 'measurements'), token),
            );
            ensure(
              read.items.length === 1 &&
                read.items[0]!.value === 69.5 &&
                read.items[0]!.version === 2,
              'correction_not_persisted',
            );
          });
          await test(
            'csv-preview-commit-replay-and-numerics-' + i,
            async () => {
              const preview = ImportPreviewSchema.parse(
                await api('/api/data', token, {
                  schema_version: 2,
                  action: 'preview_csv',
                  client_request_id: requestId(),
                  csv_base64: Buffer.from(input.csv).toString('base64'),
                  source: {
                    kind: 'new',
                    label: 'Synthetic 3D ' + (i ? 'B' : 'A') + ' CSV',
                    origin_app: null,
                    device_label: null,
                  },
                  mapping: {
                    schema_version: 1,
                    format: 'canonical',
                    source_label: 'Synthetic Scale A',
                    timezone: 'UTC',
                    profile: null,
                    single_profile: true,
                    review_requested: false,
                  },
                }),
              );
              ensure(
                preview.counts.new === 28 && preview.counts.invalid === 0,
                'canonical_preview_counts',
              );
              csvSource = preview.source_id;
              batch = preview.batch_id;
              const body = {
                schema_version: 2,
                action: 'commit_import',
                batch_id: batch,
                payload_hash: preview.payload_hash,
                client_request_id: requestId(),
              };
              const committed = ImportResultSchema.parse(
                await api('/api/data', token, body),
              );
              ensure(committed.inserted === 28, 'canonical_commit_count');
              ensure(
                sha(
                  ImportResultSchema.parse(await api('/api/data', token, body)),
                ) === sha(committed),
                'commit_replay_changed',
              );
              const summary = DataSummarySchema.parse(
                await api(selection(csvSource, 'summary'), token),
              );
              ensure(
                summary.analysis.value === 69 &&
                  summary.analysis.previousValue === 69.7 &&
                  Math.abs(summary.analysis.absoluteChange! + 0.7) < 1e-10,
                'canonical_arithmetic',
              );
            },
          );
          await test('pending-exact-goal-approval-' + i, async () => {
            const p = z
              .object({
                id: z.uuid(),
                payload_hash: z.string(),
                target_version: z.number().nullable(),
                state: z.literal('pending'),
                canonical_payload: GoalRevisionPayloadSchema,
              })
              .parse(
                await api('/api/goals', token, {
                  action: 'propose_create',
                  client_request_id: requestId(),
                  definition: definition(csvSource),
                }),
              );
            proposal = p.id;
            ensure(
              p.canonical_payload.baseline.value === '69.7',
              'baseline_mismatch',
            );
            ensure(
              (await rows('goals', u.id)).length === 0,
              'goal_created_before_approval',
            );
            const approved = z
              .object({
                goalId: z.uuid(),
                revisionNumber: z.literal(1),
                outcome: z.literal('approved'),
              })
              .parse(
                await api('/api/approvals', token, {
                  action: 'approve',
                  proposal_id: proposal,
                  payload_hash: p.payload_hash,
                  expected_version: p.target_version,
                  client_request_id: requestId(),
                }),
              );
            goal = approved.goalId;
            const revisions = await rows('goal_revisions', u.id);
            ensure(revisions.length === 1, 'revision_count');
            revision = z.string().parse(revisions[0]!.id);
          });
          await test(
            'owned-conversation-and-uncommitted-staging-' + i,
            async () => {
              conversation = randomUUID();
              await api('/api/conversations', token, {
                action: 'create',
                id: conversation,
                client_request_id: requestId(),
              });
              const title = await admin
                .from('conversations')
                .update({
                  title: 'Synthetic 3D ' + (i ? 'B' : 'A') + ' conversation',
                })
                .eq('id', conversation)
                .eq('user_id', u.id);
              dbCheck(title.error, 'conversation_label');
              const preview = ImportPreviewSchema.parse(
                await api('/api/data', token, {
                  schema_version: 2,
                  action: 'preview_csv',
                  client_request_id: requestId(),
                  csv_base64: Buffer.from(
                    input.csv.replace('70.0', '70.1'),
                  ).toString('base64'),
                  source: {
                    kind: 'new',
                    label: 'Synthetic 3D ' + (i ? 'B' : 'A') + ' staging',
                    origin_app: null,
                    device_label: null,
                  },
                  mapping: {
                    schema_version: 1,
                    format: 'canonical',
                    source_label: 'Synthetic Scale A',
                    timezone: 'UTC',
                    profile: null,
                    single_profile: true,
                    review_requested: false,
                  },
                }),
              );
              ensure(preview.counts.new === 28, 'staging_preview');
              ensure(
                (await rows('private_payloads', u.id)).length > 0,
                'encrypted_staging_missing',
              );
            },
          );
          const message = randomUUID();
          await test('valid-owned-parent-counterexamples-' + i, async () => {
            const reading = (await rows('measurements', u.id)).find(
              (row) => row.id === manual.id,
            )!;
            const positive = await admin.from('measurements').insert({
              ...reading,
              id: randomUUID(),
              fingerprint: sha(randomUUID()),
            } as Database['public']['Tables']['measurements']['Insert']);
            dbCheck(positive.error, 'owned_measurement_parent');
            const m = await admin.from('messages').insert({
              id: message,
              user_id: u.id,
              conversation_id: conversation,
              role: 'user',
              content_parts: [
                {
                  type: 'text',
                  text: 'Synthetic 3D ' + (i ? 'B' : 'A') + ' message',
                },
              ],
              status: 'completed',
            });
            dbCheck(m.error, 'owned_message_parent');
          });
          graphs.push(
            graphSchema.parse({
              manualSource: manual.sourceId,
              manualReading: manual.id,
              csvSource,
              batch,
              proposal,
              goal,
              conversation,
              revision,
              message,
            }),
          );
        }
        await input.artifacts.write('graphs', graphs);
        for (const [i, session] of authenticated.entries()) {
          const u = plan.users[i]!,
            other = plan.users[1 - i]!,
            foreign = graphs[1 - i]!;
          const before = await foreignSnapshot(1 - i);
          await test('populated-direct-and-api-isolation-' + i, async () => {
            for (const table of [
              'profiles',
              'data_sources',
              'import_batches',
              'measurements',
              'conversations',
              'messages',
              'goals',
              'action_proposals',
              'goal_revisions',
            ] as const) {
              ensure(
                (await rows(table, other.id)).length > 0,
                'foreign_positive_fixture_missing',
              );
              const direct = await session.client
                .from(table)
                .select('*')
                .eq('user_id', other.id);
              dbCheck(direct.error, 'foreign_read');
              ensure(direct.data?.length === 0, 'foreign_rows_leaked');
            }
            await api(
              selection(foreign.csvSource, 'measurements'),
              session.token,
              undefined,
              404,
            );
            await api(
              '/api/conversations?view=messages&id=' + foreign.conversation,
              session.token,
              undefined,
              404,
            );
            await api(
              '/api/goals?view=detail&id=' + foreign.goal,
              session.token,
              undefined,
              404,
            );
            await api(
              '/api/goals?view=proposal&id=' + foreign.proposal,
              session.token,
              undefined,
              404,
            );
            await api(
              '/api/data',
              session.token,
              {
                action: 'add_measurement',
                client_request_id: requestId(),
                source: { kind: 'existing', id: foreign.manualSource },
                observation,
              },
              404,
            );
            await api(
              '/api/goals',
              session.token,
              {
                action: 'propose_create',
                client_request_id: requestId(),
                definition: definition(foreign.csvSource),
              },
              404,
            );
          });
          await test(
            'direct-writes-and-foreign-parent-constraints-' + i,
            async () => {
              for (const table of [
                'data_sources',
                'measurements',
                'conversations',
                'messages',
                'goals',
                'action_proposals',
                'goal_revisions',
              ] as const) {
                const existing = (await rows(table, other.id))[0]!;
                const newId = randomUUID();
                for (const method of ['POST', 'PATCH', 'DELETE'] as const) {
                  const path =
                    '/rest/v1/' +
                    table +
                    (method === 'POST' ? '' : '?id=eq.' + existing.id);
                  const response = await boundedFetch(source + path, {
                    method,
                    headers: {
                      apikey: input.publishableKey,
                      Authorization: 'Bearer ' + session.token,
                      'Content-Type': 'application/json',
                    },
                    ...(method === 'DELETE'
                      ? {}
                      : {
                          body: JSON.stringify(
                            method === 'POST'
                              ? { ...existing, id: newId, user_id: u.id }
                              : { user_id: u.id },
                          ),
                        }),
                  });
                  ensure(response.status === 403, 'direct_mutation_not_denied');
                  ensure(
                    z
                      .object({ code: z.literal('42501') })
                      .safeParse(JSON.parse(await bytes(response))).success,
                    'direct_mutation_wrong_code',
                  );
                }
              }
              const reading = (await rows('measurements', u.id))[0]!;
              const foreignMeasurement = await admin
                .from('measurements')
                .insert({
                  ...reading,
                  id: randomUUID(),
                  source_id: foreign.manualSource,
                  import_batch_id: null,
                  fingerprint: sha(randomUUID()),
                } as Database['public']['Tables']['measurements']['Insert']);
              ensure(
                foreignMeasurement.error?.code === '23503',
                'foreign_measurement_parent_accepted',
              );
              const foreignMessage = await admin.from('messages').insert({
                id: randomUUID(),
                user_id: u.id,
                conversation_id: foreign.conversation,
                role: 'user',
                content_parts: [
                  { type: 'text', text: 'Synthetic denied parent' },
                ],
                status: 'completed',
              });
              ensure(
                foreignMessage.error?.code === '23503',
                'foreign_message_parent_accepted',
              );
              ensure(
                before === (await foreignSnapshot(1 - i)),
                'foreign_state_changed',
              );
            },
          );
          await test('owned-export-integrity-and-staging-' + i, async () => {
            const raw = await api('/api/account', session.token, {
              action: 'export',
              trace_parts: [],
              sensitive_content_acknowledged: false,
            });
            const doc = z
              .object({
                ownerId: z.uuid(),
                sections: z.record(z.string(), jsonRows),
                integrity: z.record(
                  z.string(),
                  z.object({ count: z.number(), sha256: z.string() }),
                ),
              })
              .parse(raw);
            ensure(
              doc.ownerId === u.id &&
                doc.sections.measurements?.length === 30 &&
                doc.sections.messages?.length === 1,
              'export_inventory',
            );
            for (const [name, records] of Object.entries(doc.sections)) {
              ensure(
                records.every(
                  (row) => !('user_id' in row) || row.user_id === u.id,
                ),
                'export_foreign_owner',
              );
              ensure(
                doc.integrity[name]?.count === records.length &&
                  doc.integrity[name]?.sha256 ===
                    createHash('sha256')
                      .update(
                        records
                          .map((row) => JSON.stringify(row) + '\n')
                          .join(''),
                      )
                      .digest('hex'),
                'export_integrity',
              );
            }
            const text = JSON.stringify(raw);
            for (const secret of [
              other.id,
              input.adminKey,
              session.token,
              session.refresh,
              ...plan.users.flatMap((user) => [
                user.password,
                user.nextPassword,
              ]),
            ])
              ensure(!text.includes(secret), 'export_private_leak');
            ensure(
              doc.sections.staging?.some((row) => row.state === 'available'),
              'export_staging_missing',
            );
            await input.artifacts.write('export-' + i, raw);
            const messages = MessagesPageSchema.parse(
              await api(
                '/api/conversations?view=messages&id=' +
                  graphs[i]!.conversation,
                session.token,
              ),
            );
            ensure(
              messages.items.length === 1 &&
                messages.items[0]!.id === graphs[i]!.message,
              'owned_message_missing',
            );
          });
        }
      } else if (input.phase === 'reset') {
        await test('trusted-reset-revokes-old-access-and-refresh', async () => {
          const old = await login(0),
            u = plan.users[0];
          const result = await recoverAccount(admin, {
            userId: u.id,
            password: u.nextPassword,
            identityVerified: true,
          });
          ensure(result.sessionsRevoked, 'reset_unconfirmed');
          await api('/api/settings', old.token, undefined, 401);
          const direct = await old.client.from('profiles').select('user_id');
          dbCheck(direct.error, 'revoked_direct');
          ensure(direct.data?.length === 0, 'old_direct_session_accepted');
          const refresh = await createClient<Database>(
            source,
            input.publishableKey,
            options,
          ).auth.refreshSession({ refresh_token: old.refresh });
          ensure(
            !!refresh.error && !refresh.data.session,
            'old_refresh_accepted',
          );
          const fresh = await login(0, u.nextPassword);
          const settings = SettingsSchema.parse(
            await api('/api/settings', fresh.token),
          );
          ensure(settings.profile.userId === u.id, 'fresh_login_failed');
          const oldPassword = await createClient<Database>(
            source,
            input.publishableKey,
            options,
          ).auth.signInWithPassword({ email: u.email, password: u.password });
          ensure(
            !!oldPassword.error && !oldPassword.data.session,
            'old_password_accepted',
          );
        });
      } else if (input.phase === 'delete-start') {
        await test('deletion-fence-persisted-before-process-exit', async () => {
          const fresh = await login(0, plan.users[0].nextPassword);
          const status = AccountStatusSchema.parse(
            await api('/api/account', fresh.token, {
              action: 'delete',
              confirmation: 'DELETE MY VULPES ACCOUNT',
            }),
          );
          ensure(
            status.state === 'deleting' && status.phase === 'fenced',
            'deletion_not_fenced',
          );
          await api('/api/data?view=sources', fresh.token, undefined, 403);
          await api('/api/conversations', fresh.token, undefined, 403);
          await input.artifacts.write('deletion-start', {
            receiptId: status.state === 'deleting' ? status.receiptId : null,
            phase: 'fenced',
          });
        });
      } else {
        for (const [i, u] of plan.users.entries())
          await test('resumed-complete-deletion-' + i, async () => {
            if (owned[i] === 'completed') {
              for (const table of tables)
                ensure(
                  (await rows(table, u.id)).length === 0,
                  'completed_rows_remain',
                );
              return;
            }
            const fresh = await login(i, i === 0 ? u.nextPassword : u.password);
            let status = AccountStatusSchema.parse(
              await api('/api/account', fresh.token),
            );
            if (i === 0) {
              ensure(
                status.state === 'deleting' && status.phase === 'fenced',
                'lost_deletion_fence',
              );
              const receipt = z
                .object({ receiptId: z.uuid() })
                .parse(await input.artifacts.read('deletion-start'));
              ensure(
                status.state === 'deleting' &&
                  status.receiptId === receipt.receiptId,
                'receipt_changed',
              );
            } else
              status = AccountStatusSchema.parse(
                await api('/api/account', fresh.token, {
                  action: 'delete',
                  confirmation: 'DELETE MY VULPES ACCOUNT',
                }),
              );
            for (
              let n = 0;
              n < 30 &&
              status.state === 'deleting' &&
              status.phase !== 'completed';
              n++
            )
              status = AccountStatusSchema.parse(
                await api('/api/account', fresh.token, {
                  action: 'continue_delete',
                }),
              );
            ensure(
              status.state === 'deleting' && status.phase === 'completed',
              'deletion_unfinished',
            );
            for (const table of tables)
              ensure(
                (await rows(table, u.id)).length === 0,
                'deleted_rows_remain_' + table,
              );
            const absent = await admin.auth.admin.getUserById(u.id);
            ensure(
              absent.error?.code === 'user_not_found' && !absent.data.user,
              'auth_removal_unconfirmed',
            );
            const journal = await admin
              .from('account_deletion_receipts')
              .select('id,phase,outcome,completed_at')
              .eq('user_id', u.id)
              .single();
            dbCheck(journal.error, 'authoritative_receipt');
            ensure(
              journal.data?.phase === 'completed' &&
                journal.data.outcome === 'completed' &&
                journal.data.completed_at,
              'journal_incomplete',
            );
            await api('/api/settings', fresh.token, undefined, 401);
          });
      }
    }
    const baseline = z
      .object({ hash: z.string() })
      .parse(await input.artifacts.read('baseline'));
    ensure(
      baseline.hash === (await untouched()),
      'existing_profiles_or_shared_budget_changed',
    );
  } catch (error) {
    failure = {
      failedStep: step,
      reason:
        error instanceof z.ZodError
          ? 'schema_' +
            error.issues[0]?.code +
            '_' +
            error.issues[0]?.path
              .filter(
                (p) =>
                  typeof p === 'number' || /^[a-z_]{1,32}$/i.test(String(p)),
              )
              .join('_')
          : error instanceof Error && /^[a-zA-Z0-9_]+$/.test(error.message)
            ? error.message
            : 'assertion_or_transport_failed',
    };
  } finally {
    for (const client of sessions) {
      try {
        const result = await client.auth.signOut({ scope: 'local' });
        if (result.error && ![401, 403].includes(result.error.status ?? 0))
          sessionCleanupConfirmed = false;
      } catch {
        sessionCleanupConfirmed = false;
      }
    }
  }
  return {
    scope: 'hosted-synthetic-lifecycle',
    phase: input.phase,
    status: failure || !sessionCleanupConfirmed ? 'failed' : 'passed',
    checks,
    ...failure,
    requests,
    sessionCleanupConfirmed,
    providerRequests: 0,
    paidSpendUSD: '0',
    realDataAuthorized: false,
  };
}

import { randomUUID, createHash } from 'node:crypto';
import { z } from 'zod';
import {
  HostingTargetSchema,
  supabaseOrigin,
  type HostingTarget,
} from './hosting.js';
import {
  InspectionOverviewSchema,
  InspectionPayloadSchema,
} from '../shared/inspection.js';
import { ErrorEnvelopeSchema } from '../shared/api.js';
import { AuthenticatedStatusSchema, SettingsSchema } from '../shared/auth.js';
import type { CloseoutFixture } from './closeout-fixture.js';

type Actor = { token: string; fixture: CloseoutFixture };
export async function verifyHostedCloseout(
  input: {
    target: HostingTarget;
    publishableKey: string;
    actors: [Actor, Actor];
    approved: boolean;
  },
  network: typeof fetch = fetch,
) {
  if (input.approved !== true) throw Error('closeout_approval_required');
  const target = HostingTargetSchema.parse(input.target),
    source = supabaseOrigin(target),
    checks: string[] = [];
  let requests = 0,
    step = 'start';
  const check = (value: unknown, name: string) => {
    if (!value) throw Error(name);
  };
  check(
    input.actors[0].fixture.owner !== input.actors[1].fixture.owner,
    'distinct_owners_required',
  );
  async function send(
    actor: Actor,
    path: string,
    method = 'GET',
    body?: string,
    direct = false,
  ) {
    check(++requests <= 160, 'closeout_request_limit');
    const base = direct ? source : target.appOrigin;
    return network(base + path, {
      method,
      redirect: 'error',
      credentials: 'omit',
      cache: 'no-store',
      signal: AbortSignal.timeout(25000),
      headers: {
        Authorization: 'Bearer ' + actor.token,
        Origin: target.appOrigin,
        ...(direct ? { apikey: input.publishableKey } : {}),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      },
      ...(body === undefined ? {} : { body }),
    });
  }
  async function bytes(response: Response) {
    const reader = response.body?.getReader();
    check(reader, 'response_body_required');
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const p = await reader!.read();
        if (p.done) break;
        size += p.value.byteLength;
        check(size <= 4 * 1024 * 1024, 'response_bound');
        chunks.push(p.value);
      }
      return Buffer.concat(chunks);
    } finally {
      await reader!.cancel();
    }
  }
  async function json(response: Response, status: number) {
    check(
      response.status === status &&
        response.headers.get('content-type')?.startsWith('application/json') &&
        response.headers.get('cache-control') === 'no-store',
      'json_status_or_headers',
    );
    return JSON.parse((await bytes(response)).toString()) as Record<
      string,
      unknown
    >;
  }
  const test = async (name: string, run: () => Promise<void>) => {
    step = name;
    await run();
    checks.push(name);
  };
  try {
    for (const [index, actor] of input.actors.entries()) {
      const f = actor.fixture,
        foreign = input.actors[1 - index]!.fixture;
      await test('disabled-status-and-settings-' + index, async () => {
        const status = AuthenticatedStatusSchema.parse(
          (await json(await send(actor, '/api/status'), 200)).data,
        );
        check(
          !status.features.inference && status.roles.everyday === 'unavailable',
          'inference_enabled',
        );
        const settings = SettingsSchema.parse(
          (await json(await send(actor, '/api/settings'), 200)).data,
        );
        check(
          settings.profile.userId === f.owner &&
            settings.providerConsents.every((c) => !c.accepted) &&
            settings.inferenceAvailability?.state !== 'available',
          'consent_or_availability',
        );
      });
      for (const [path, method] of [
        ['/api/settings', 'PATCH'],
        ['/api/data', 'POST'],
        ['/api/goals', 'POST'],
        ['/api/conversations', 'POST'],
        ['/api/account', 'POST'],
        ['/api/chat', 'POST'],
      ] as const) {
        for (const [variant, body] of [
          ['malformed', '{'],
          ['unknown-field', '{"unexpected":true}'],
        ] as const)
          await test(
            'invalid-write-' + index + '-' + path.slice(5) + '-' + variant,
            async () => {
              const result = ErrorEnvelopeSchema.parse(
                await json(await send(actor, path, method, body), 400),
              );
              check(
                result.error.code === 'invalid_input',
                'unexpected_write_error',
              );
            },
          );
      }
      await test('disabled-chat-json-no-stream-' + index, async () => {
        const response = await send(
          actor,
          '/api/chat',
          'POST',
          JSON.stringify({
            action: 'send',
            client_request_id: randomUUID(),
            conversation_id: f.ids.conversation,
            message: {
              id: randomUUID(),
              text: 'Synthetic disabled-inference verification',
            },
            depth: 'everyday',
          }),
        );
        const result = ErrorEnvelopeSchema.parse(await json(response, 503));
        check(
          result.error.code === 'inference_unavailable',
          'disabled_chat_result',
        );
      });
      await test('populated-run-step-and-protected-rows-' + index, async () => {
        for (const [table, id] of [
          ['ai_runs', f.ids.run],
          ['ai_steps', f.ids.step],
        ] as const) {
          const response = await send(
            actor,
            '/rest/v1/' + table + '?select=id,user_id',
            'GET',
            undefined,
            true,
          );
          check(response.status === 200, 'owned_rows_status');
          const rows = z
            .array(z.object({ id: z.uuid(), user_id: z.uuid() }))
            .parse(JSON.parse((await bytes(response)).toString()));
          check(
            rows.length === 1 &&
              rows[0]!.id === id &&
              rows[0]!.user_id === f.owner,
            'owned_nonempty_rows',
          );
        }
        for (const table of [
          'private_payloads',
          'live_verification_allocations',
          'usage_buckets',
        ]) {
          const response = await send(
            actor,
            '/rest/v1/' + table + '?select=*&limit=1',
            'GET',
            undefined,
            true,
          );
          check(response.status === 403, 'protected_rows_readable');
          check(
            z
              .object({ code: z.literal('42501') })
              .safeParse(JSON.parse((await bytes(response)).toString()))
              .success,
            'protected_rows_wrong_error',
          );
        }
      });
      await test('owned-inspector-and-foreign-denials-' + index, async () => {
        const result = InspectionOverviewSchema.parse(
          (
            await json(
              await send(
                actor,
                '/api/executions?view=overview&run=' + f.ids.run,
              ),
              200,
            )
          ).data,
        );
        check(
          result.run.id === f.ids.run &&
            result.run.state === 'failed' &&
            result.run.reservationUSD === '0' &&
            result.steps.length === 1 &&
            result.steps[0]!.id === f.ids.step,
          'inspector_owned_graph',
        );
        const payload = InspectionPayloadSchema.parse(
          (
            await json(
              await send(
                actor,
                '/api/executions?view=payload&run=' +
                  f.ids.run +
                  '&step=' +
                  f.ids.step +
                  '&part=input',
              ),
              200,
            )
          ).data,
        );
        check(
          payload.state === 'available' && payload.base64 === f.inputBase64,
          'owned_trace_bytes',
        );
        for (const query of [
          'view=overview&run=' + foreign.ids.run,
          'view=payload&run=' +
            foreign.ids.run +
            '&step=' +
            foreign.ids.step +
            '&part=input',
          'view=payload&run=' +
            f.ids.run +
            '&step=' +
            foreign.ids.step +
            '&part=input',
        ])
          ErrorEnvelopeSchema.parse(
            await json(await send(actor, '/api/executions?' + query), 404),
          );
        const exported = await send(
          actor,
          '/api/executions?view=export&run=' +
            f.ids.run +
            '&step=' +
            f.ids.step +
            '&part=input',
        );
        check(
          exported.status === 200 &&
            exported.headers.get('cache-control') === 'no-store' &&
            !!exported.headers.get('content-disposition'),
          'trace_export_headers',
        );
        check(
          (await bytes(exported)).toString('base64') === f.inputBase64,
          'trace_export_bytes',
        );
      });
      await test('cancel-owned-export-body-' + index, async () => {
        const response = await send(
          actor,
          '/api/account',
          'POST',
          JSON.stringify({
            action: 'export',
            trace_parts: ['input'],
            sensitive_content_acknowledged: true,
          }),
        );
        check(
          response.status === 200 &&
            response.headers.get('cache-control') === 'no-store',
          'cancel_export_headers',
        );
        const reader = response.body?.getReader();
        check(reader, 'cancel_export_body');
        try {
          const first = await reader!.read();
          check(
            !first.done && first.value.length > 0,
            'cancel_export_first_chunk',
          );
        } finally {
          await reader!.cancel();
        }
      });
      await test(
        'account-export-integrity-and-allocation-isolation-' + index,
        async () => {
          const response = await send(
            actor,
            '/api/account',
            'POST',
            JSON.stringify({
              action: 'export',
              trace_parts: ['input'],
              sensitive_content_acknowledged: true,
            }),
          );
          check(
            response.headers.get('content-disposition')?.includes('attachment'),
            'account_attachment',
          );
          const doc = z
            .object({
              ownerId: z.uuid(),
              sections: z.record(
                z.string(),
                z.array(z.record(z.string(), z.unknown())),
              ),
              integrity: z.record(
                z.string(),
                z.object({ count: z.number(), sha256: z.string() }),
              ),
            })
            .parse(await json(response, 200));
          check(doc.ownerId === f.owner, 'account_owner');
          for (const [name, rows] of Object.entries(doc.sections)) {
            check(
              rows.every(
                (row) => !('user_id' in row) || row.user_id === f.owner,
              ),
              'export_foreign_owner',
            );
            check(
              doc.integrity[name]?.count === rows.length &&
                doc.integrity[name]?.sha256 ===
                  createHash('sha256')
                    .update(rows.map((r) => JSON.stringify(r) + '\n').join(''))
                    .digest('hex'),
              'account_integrity',
            );
          }
          check(
            doc.sections.ai_runs?.length === 1 &&
              doc.sections.ai_runs[0]!.id === f.ids.run &&
              doc.sections.ai_steps?.length === 1 &&
              doc.sections.ai_steps[0]!.id === f.ids.step,
            'export_owned_execution',
          );
          check(
            doc.sections.live_verification_allocations?.length === 1 &&
              doc.sections.live_verification_allocations[0]!.id ===
                f.ids.allocation,
            'allocation_export_isolation',
          );
          const traces = doc.sections.ai_steps?.[0]?.traces as
            Record<string, { bytes?: string }> | undefined;
          check(
            traces?.input?.bytes === f.inputBase64,
            'account_trace_roundtrip',
          );
          check(
            !JSON.stringify(doc).includes(foreign.marker) &&
              !JSON.stringify(doc).includes(foreign.owner),
            'foreign_export_content',
          );
        },
      );
      await test('csv-roundtrip-' + index, async () => {
        const query = new URLSearchParams({
          view: 'export',
          source_id: f.ids.source,
          metric: 'weight',
          from: f.from,
          to: f.to,
          timezone: 'UTC',
          method: 'user_reported',
          granularity: 'instant',
        });
        const response = await send(actor, '/api/data?' + query);
        check(
          response.status === 200 &&
            response.headers.get('cache-control') === 'no-store' &&
            response.headers.get('content-type')?.startsWith('text/csv'),
          'csv_headers',
        );
        const body = (await bytes(response)).toString();
        check(
          body.includes(f.marker) &&
            body.includes(f.ids.reading) &&
            !body.includes(foreign.marker),
          'csv_owned_content',
        );
      });
    }
    return {
      scope: 'synthetic-hosted-closeout',
      status: 'passed',
      checks,
      requests,
      providerRequests: 0,
      paidSpendUSD: '0',
    } as const;
  } catch (error) {
    throw new Error('closeout_failed:' + step, { cause: error });
  }
}

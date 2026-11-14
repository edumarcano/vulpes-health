import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { beforeAll, afterAll, describe, expect, it, vi } from 'vitest';
import { localRouter } from '../../server/http/router.js';
import { localStatus } from '../../scripts/local-database.js';
import { LocalSupabase } from '../helpers/local-supabase.js';
import { successEnvelopeSchema } from '../../shared/api.js';
import {
  ImportResultSchema,
  ImportPreviewV2Schema,
  type ImportPreviewV2,
} from '../../shared/imports.js';
import { EventDetailSchema } from '../../shared/events.js';
import { parse } from 'csv-parse/sync';
import { spawnSync } from 'node:child_process';
import { localEnvironment, projectId } from '../../scripts/local-database.js';

const full = readFileSync('docs/spec/v0.2.0/fixtures/renpho-v1/full-panel.csv');
const expected = JSON.parse(
  readFileSync(
    'docs/spec/v0.2.0/fixtures/renpho-v1/expected-values.json',
    'utf8',
  ),
) as {
  observations: Array<{
    key: string;
    canonicalValue: string;
    originalValue: string;
    canonicalUnit: string;
    originalUnit: string;
  }>;
};
const server = createServer(localRouter);
let db: LocalSupabase,
  a: { id: string; token: string },
  b: { id: string; token: string },
  origin: string;
function request(csv: Buffer | string = full, source?: string) {
  return {
    schema_version: 2,
    action: 'preview_csv',
    client_request_id: randomUUID(),
    csv_base64: Buffer.from(csv).toString('base64'),
    source: source
      ? { kind: 'existing', id: source }
      : {
          kind: 'new',
          label: 'Synthetic full panel',
          origin_app: 'Synthetic export',
          device_label: null,
        },
    mapping: {
      schema_version: 1,
      format: 'renpho',
      timezone: 'America/New_York',
      profile: null,
      single_profile: true,
      timezone_confirmed: true,
      review_requested: false,
    },
  };
}
async function post(
  body: unknown,
  token: string | null = a.token,
  version: string | undefined = '2',
) {
  return fetch(origin + '/api/data', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(version === undefined ? {} : { 'X-Vulpes-Data-Contract': version }),
    },
    body: JSON.stringify(body),
  });
}
async function preview(csv: Buffer | string = full, source?: string) {
  const response = await post(request(csv, source));
  const body = await response.json();
  expect({
    status: response.status,
    body: response.ok ? undefined : body,
  }).toEqual({ status: 200, body: undefined });
  return successEnvelopeSchema(ImportPreviewV2Schema).parse(body).data;
}
function commitBody(p: ImportPreviewV2) {
  return {
    schema_version: 2,
    action: 'commit_import',
    batch_id: p.batch_id,
    payload_hash: p.payload_hash,
    client_request_id: randomUUID(),
  };
}
async function commit(p: ImportPreviewV2) {
  const response = await post(commitBody(p)),
    body = await response.json();
  expect({
    status: response.status,
    body: response.ok ? undefined : body,
  }).toEqual({ status: 200, body: undefined });
  return successEnvelopeSchema(ImportResultSchema).parse(body).data;
}
async function review(p: ImportPreviewV2) {
  const response = await post({
    action: 'review_import',
    batch_id: p.batch_id,
    payload_hash: p.payload_hash,
    review: {
      exclude_invalid: true,
      exclude_conflicts: true,
      acknowledge_unknown: true,
    },
  });
  expect(response.status).toBe(200);
  return successEnvelopeSchema(ImportPreviewV2Schema).parse(
    await response.json(),
  ).data;
}
async function table(name: string, source: string) {
  return (await (
    await db.admin(`/rest/v1/${name}?source_id=eq.${source}&select=*`, 'GET')
  ).json()) as Array<Record<string, unknown>>;
}
beforeAll(async () => {
  const local = localStatus();
  vi.stubEnv('VITE_SUPABASE_URL', local.apiUrl);
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', local.anonKey);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', local.adminKey);
  vi.stubEnv('VULPES_TRACE_ENCRYPTION_KEY_ID', 'synthetic-m1');
  vi.stubEnv(
    'VULPES_TRACE_ENCRYPTION_KEY_B64',
    randomBytes(32).toString('base64'),
  );
  vi.stubEnv('VULPES_LIVE_AI_ENABLED', 'false');
  db = new LocalSupabase();
  a = await db.createUser();
  b = await db.createUser();
  for (const user of [a, b])
    await db.admin('/rest/v1/profiles', 'POST', {
      user_id: user.id,
      display_name: 'Synthetic M1 import',
    });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw Error();
  origin = `http://127.0.0.1:${address.port}`;
});
afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  try {
    if (db) await db.cleanup();
  } finally {
    vi.unstubAllEnvs();
  }
});

describe('M1 owned event HTTP transactions', () => {
  it('refuses to present a discarded request as a fresh actionable preview', async () => {
    const input = request();
    const response = await post(input);
    expect(response.status).toBe(200);
    const p = successEnvelopeSchema(ImportPreviewV2Schema).parse(
      await response.json(),
    ).data;
    expect(
      (await post({ action: 'discard_import', batch_id: p.batch_id })).status,
    ).toBe(200);
    expect((await post(input)).status).toBe(409);
    expect(await table('measurements', p.source_id)).toEqual([]);
  });
  it('previews without readings, commits all 24 originals/canonical decimals and three annotations, then replays once', async () => {
    const p = await preview();
    expect(p.counts).toMatchObject({ observations: 24, new: 24, invalid: 0 });
    expect(p.events).toEqual({ total: 1, new: 1, existing: 0, conflict: 0 });
    expect(await table('measurements', p.source_id)).toEqual([]);
    expect(await table('weigh_in_events', p.source_id)).toEqual([]);
    const result = await commit(p);
    expect(result).toMatchObject({
      inserted: 24,
      inserted_events: 1,
      annotations_added: 3,
    });
    const events = await table('weigh_in_events', p.source_id);
    expect(events).toHaveLength(1);
    const response = await fetch(
      origin +
        '/api/data?' +
        new URLSearchParams({ view: 'event', event_id: String(events[0]!.id) }),
      { headers: { Authorization: `Bearer ${a.token}` } },
    );
    expect(response.status).toBe(200);
    const detail = successEnvelopeSchema(EventDetailSchema).parse(
      await response.json(),
    ).data;
    expect(detail.observations).toHaveLength(24);
    for (const value of expected.observations)
      expect(
        detail.observations.find((row) => row.metric === value.key),
      ).toMatchObject({
        canonicalValue: value.canonicalValue,
        originalValue: value.originalValue,
        unit: value.canonicalUnit,
        originalUnit: value.originalUnit,
        eventId: events[0]!.id,
      });
    expect(Object.keys(detail.event.annotations)).toHaveLength(3);
    expect(await commit(p)).toEqual(result);
    expect(await table('measurements', p.source_id)).toHaveLength(24);
    const repeated = await preview(full, p.source_id);
    expect(repeated.historical_result).toEqual(result);
  });
  it('requires explicit exclusion/unknown review, changes the bound hash and preserves the original expiry', async () => {
    const p = await preview(
      'Date,Time,Weight(lb),BMI,Experimental\n2026.09.01,08:00:00,150,bad,7',
    );
    expect(p.ready_to_commit).toBe(false);
    expect((await post(commitBody(p))).status).toBe(409);
    const reviewed = await review(p);
    expect(reviewed.payload_hash).not.toBe(p.payload_hash);
    expect(reviewed.expires_at).toBe(p.expires_at);
    expect(reviewed.ready_to_commit).toBe(true);
    expect((await post(commitBody(p))).status).toBe(409);
    expect((await commit(reviewed)).inserted).toBe(1);
  });
  it('enriches missing metrics, preserves corrections, and retains different-minute weigh-ins', async () => {
    const p = await preview('Date,Time,Weight(lb)\n2026.09.01,08:00:00,150');
    await commit(p);
    const enriched = await preview(full, p.source_id);
    expect(enriched.enrichment_count).toBe(23);
    expect(enriched.counts.duplicate).toBe(1);
    expect((await commit(enriched)).enriched).toBe(23);
    expect(await table('weigh_in_events', p.source_id)).toHaveLength(1);
    const next = await preview(
      'Date,Time,Weight(lb)\n2026.09.01,08:01:00,150',
      p.source_id,
    );
    expect((await commit(next)).inserted_events).toBe(1);
    expect(await table('weigh_in_events', p.source_id)).toHaveLength(2);
    const weight = (await table('measurements', p.source_id)).find(
      (r) =>
        r.metric_key === 'weight' &&
        String(r.observed_at).startsWith('2026-09-01T12:00:00'),
    )!;
    expect(
      (
        await post({
          action: 'correct_measurement',
          measurement_id: weight.id,
          expected_version: weight.version,
          client_request_id: randomUUID(),
          changes: {
            value: '151',
            unit: 'lb',
            observed_at: weight.observed_at,
            timezone: weight.timezone,
            local_date: null,
          },
        })
      ).status,
    ).toBe(200);
    const reimport = await preview(
      'No.,Date,Time,Weight(lb)\n77,2026.09.01,08:00:00,150.00',
      p.source_id,
    );
    expect(reimport.counts.conflict).toBe(1);
    expect((await commit(await review(reimport))).inserted).toBe(0);
    expect(
      (await table('measurements', p.source_id)).find(
        (r) => r.id === weight.id,
      ),
    ).toMatchObject({
      original_value: '151',
      quality_flags: expect.arrayContaining(['user_corrected']),
    });
  });
  it('covers exact equality, renumbering, same-file ambiguity, source/zone independence and annotation enrichment/conflicts', async () => {
    const header = 'No.,Date,Time,Weight(lb),Remarks\n';
    const p = await preview(header + '1,2026.09.01,08:00:00,150,');
    await commit(p);
    const equal = await preview(
      header + '99,2026.09.01,08:00:00,150.000,',
      p.source_id,
    );
    expect(equal.counts).toMatchObject({ duplicate: 1, new: 0 });
    const duplicate = await commit(equal);
    expect(duplicate.dataRevision).toBe(equal.dataRevision);
    const annotation = await preview(
      header + '17,2026.09.01,08:00:00,150,=1+1',
      p.source_id,
    );
    expect(annotation.annotation_additions).toBe(1);
    expect((await commit(annotation)).annotations_added).toBe(1);
    const conflict = await preview(
      header + '18,2026.09.01,08:00:00,150,changed',
      p.source_id,
    );
    expect(conflict.annotation_conflicts).toBe(1);
    expect(conflict.ready_to_commit).toBe(false);
    await commit(await review(conflict));
    expect(
      (await table('weigh_in_events', p.source_id))[0]!.annotations,
    ).toEqual({ remarks: '=1+1' });
    const missing = await preview(
      'Date,Time,Weight(lb)\n2026.09.01,08:00:00,150',
      p.source_id,
    );
    expect(missing.annotation_additions).toBe(0);
    await commit(missing);
    const internal = await preview(
      header + '1,2026.09.02,08:00:00,150,a\n2,2026.09.02,08:00:00,151,a',
      p.source_id,
    );
    expect(internal.counts.conflict).toBe(2);
    expect((await commit(await review(internal))).inserted_events).toBe(0);
    const repeated = await preview(
      header + '1,2026.09.03,08:00:00,150,a\n2,2026.09.03,08:00:00,150.0,a',
      p.source_id,
    );
    expect(repeated.counts).toMatchObject({ new: 1, duplicate: 1 });
    expect((await commit(repeated)).inserted_events).toBe(1);
    const changed = request(
      'Date,Time,Weight(lb)\n2026.09.01,08:00:00,150',
      p.source_id,
    );
    changed.mapping.timezone = 'UTC';
    const response = await post(changed);
    expect(response.status).toBe(200);
    const timeConflict = successEnvelopeSchema(ImportPreviewV2Schema).parse(
      await response.json(),
    ).data;
    expect(timeConflict.counts.conflict).toBe(1);
    await commit(await review(timeConflict));
    expect(
      (await preview('Date,Time,Weight(lb)\n2026.09.01,08:00:00,150')).counts
        .new,
    ).toBe(1);
  });
  it('links unordered new, enriched and repeated rows to their own parents after an excluded row', async () => {
    const p = await preview('Date,Time,Weight(lb)\n2026.09.01,08:00:00,150');
    await commit(p);
    expect(
      (
        await post({
          action: 'add_measurement',
          client_request_id: randomUUID(),
          source: { kind: 'existing', id: p.source_id },
          observation: {
            metric: 'weight',
            value: '150',
            unit: 'lb',
            observed_at: '2026-09-04T08:00:00-04:00',
            timezone: 'America/New_York',
            local_date: null,
            granularity: 'instant',
            method: 'device_reported',
            quality_flags: [],
          },
        })
      ).status,
    ).toBe(200);
    const incoming = await preview(
      'Date,Time,Weight(lb),BMI\n2026.09.04,08:00:00,151,\n2026.09.03,08:00:00,152,22\n2026.09.01,08:00:00,150,23\n2026.09.02,08:00:00,153,24\n2026.09.03,08:00:00,152,22',
      p.source_id,
    );
    expect(incoming.counts).toMatchObject({
      new: 5,
      duplicate: 3,
      conflict: 1,
    });
    expect(await commit(await review(incoming))).toMatchObject({
      inserted: 5,
      inserted_events: 2,
      enriched: 1,
    });
    const parents = await table('weigh_in_events', p.source_id);
    expect(parents).toHaveLength(3);
    const readings = await table('measurements', p.source_id);
    expect(readings).toHaveLength(7);
    expect(readings.filter((r) => r.event_id === null)).toHaveLength(1);
    for (const parent of parents) {
      const children = readings.filter((r) => r.event_id === parent.id);
      expect(children).toHaveLength(2);
      expect(children.every((r) => r.observed_at === parent.observed_at)).toBe(
        true,
      );
    }
  });
  it('commits new annotations when every numeric value conflicts without overwriting readings', async () => {
    const header = 'Date,Time,Weight(lb),Remarks\n';
    const initial = await preview(header + '2026.09.01,08:00:00,150,');
    await commit(initial);
    const readings = await table('measurements', initial.source_id);
    const pending = await preview(
      header + '2026.09.01,08:00:00,151,Synthetic enrichment',
      initial.source_id,
    );
    expect(pending.counts).toMatchObject({ conflict: 1, new: 0 });
    expect(pending.annotation_additions).toBe(1);
    const reviewed = await review(pending);
    expect(reviewed.ready_to_commit).toBe(true);
    expect(reviewed.annotation_additions).toBe(1);
    const result = await commit(reviewed);
    expect(result).toMatchObject({
      inserted: 0,
      conflict: 1,
      annotations_added: 1,
      inserted_events: 0,
    });
    expect(result.dataRevision).toBe(reviewed.dataRevision + 1);
    expect(await table('measurements', initial.source_id)).toEqual(readings);
    expect(
      (await table('weigh_in_events', initial.source_id))[0]!.annotations,
    ).toEqual({ remarks: 'Synthetic enrichment' });
    expect(await commit(reviewed)).toEqual(result);
  });
  it('excludes annotations when conflicting unlinked readings cannot supply an event parent', async () => {
    const added = await post({
      action: 'add_measurement',
      client_request_id: randomUUID(),
      source: {
        kind: 'new',
        label: 'Synthetic unlinked reading',
        origin_app: null,
        device_label: null,
      },
      observation: {
        metric: 'weight',
        value: '150',
        unit: 'lb',
        observed_at: '2026-09-01T08:00:00-04:00',
        timezone: 'America/New_York',
        local_date: null,
        granularity: 'instant',
        method: 'device_reported',
        quality_flags: [],
      },
    });
    expect(added.status).toBe(200);
    const { data: reading } = await added.json();
    const pending = await preview(
      'Date,Time,Weight(lb),Remarks\n2026.09.01,08:00:00,151,Synthetic excluded annotation',
      reading.sourceId,
    );
    expect(pending.annotation_additions).toBe(0);
    expect(pending.annotation_conflicts).toBe(1);
    const result = await commit(await review(pending));
    expect(result).toMatchObject({
      inserted: 0,
      annotations_added: 0,
      inserted_events: 0,
    });
    expect(await table('weigh_in_events', reading.sourceId)).toEqual([]);
  });
  it('keeps rounded values conflicting, later missing metrics intact and review flags outside identity across owners', async () => {
    const p = await preview();
    await commit(p);
    const input = request(full, p.source_id);
    input.mapping.review_requested = true;
    const response = await post(input);
    expect(response.status).toBe(200);
    const flagged = successEnvelopeSchema(ImportPreviewV2Schema).parse(
      await response.json(),
    ).data;
    expect(flagged.counts).toMatchObject({
      duplicate: 24,
      new: 0,
      conflict: 0,
    });
    await commit(flagged);
    expect(
      (await table('measurements', p.source_id)).every(
        (r) => !(r.quality_flags as string[]).includes('review_requested'),
      ),
    ).toBe(true);
    const missing = await preview(
      'Date,Time,Weight(lb)\n2026.09.01,08:00:00,150',
      p.source_id,
    );
    await commit(missing);
    expect(await table('measurements', p.source_id)).toHaveLength(24);
    const rounded = request(
      'observed_at,metric,value,unit,source,granularity,timezone,method\n2026-09-01T08:00:00-04:00,weight,68.0,kg,S,instant,America/New_York,device_reported',
      p.source_id,
    );
    const generic = {
      ...rounded,
      mapping: {
        schema_version: 1,
        format: 'canonical',
        timezone: 'America/New_York',
        profile: null,
        single_profile: true,
        review_requested: false,
        source_label: 'S',
      },
    };
    const conflict = await post(generic);
    expect(conflict.status).toBe(200);
    expect(
      successEnvelopeSchema(ImportPreviewV2Schema).parse(await conflict.json())
        .data.counts.conflict,
    ).toBe(1);
    const other = await post(request(), b.token);
    expect(other.status).toBe(200);
    expect(
      successEnvelopeSchema(ImportPreviewV2Schema).parse(await other.json())
        .data.counts,
    ).toMatchObject({ new: 24, duplicate: 0 });
  });
  it('corrects event time and annotations atomically, exports exact context, and removes the parent after the final reading', async () => {
    const p = await preview();
    await commit(p);
    let event = (await table('weigh_in_events', p.source_id))[0]!;
    const target = () => ({
      event_id: event.id,
      expected_version: event.version,
      client_request_id: randomUUID(),
    });
    const reading = (await table('measurements', p.source_id))[0]!;
    expect(
      (
        await post({
          action: 'correct_measurement',
          measurement_id: reading.id,
          expected_version: 1,
          client_request_id: randomUUID(),
          changes: {
            value: reading.original_value,
            unit: reading.original_unit,
            observed_at: '2026-09-01T13:00:00Z',
            timezone: 'America/New_York',
            local_date: null,
          },
        })
      ).status,
    ).toBe(409);
    expect(
      (
        await post({
          action: 'correct_event_time',
          ...target(),
          changes: {
            observed_at: '2026-09-01T13:00:00Z',
            timezone: 'America/New_York',
          },
        })
      ).status,
    ).toBe(200);
    const rows = await table('measurements', p.source_id);
    expect(rows).toHaveLength(24);
    expect(
      rows.every((r) => r.observed_at === '2026-09-01T13:00:00+00:00'),
    ).toBe(true);
    event = (await table('weigh_in_events', p.source_id))[0]!;
    expect(event.source_observed_at).toBe('2026-09-01T12:00:00+00:00');
    expect(
      (
        await post({
          action: 'update_event_annotations',
          ...target(),
          changes: {
            remarks: '=HYPERLINK("synthetic")\n<script>inert</script>',
          },
        })
      ).status,
    ).toBe(200);
    const exported = await fetch(
      origin +
        '/api/data?' +
        new URLSearchParams({
          view: 'export',
          source_id: p.source_id,
          metric: 'renpho.target_fat_delta',
          method: 'device_estimate',
          granularity: 'instant',
          timezone: 'UTC',
          from: '2026-09-01T00:00:00Z',
          to: '2026-09-02T00:00:00Z',
        }),
      { headers: { Authorization: `Bearer ${a.token}` } },
    );
    expect(exported.status).toBe(200);
    const csv = parse(await exported.text(), { columns: true }) as Array<
      Record<string, string>
    >;
    expect(csv[0]).toMatchObject({
      value: '-3.401942775',
      event_id: event.id,
      schema_version: '2',
    });
    expect(JSON.parse(csv[0]!.event_context!).annotations).toEqual({
      remarks: '=HYPERLINK("synthetic")\n<script>inert</script>',
    });
    const account = await fetch(origin + '/api/account', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${a.token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action: 'export',
        trace_parts: [],
        sensitive_content_acknowledged: false,
      }),
    });
    expect(account.status).toBe(200);
    const document = await account.json();
    expect(document.schemaVersion).toBe(2);
    expect(document.sections.weigh_in_events).toContainEqual(
      expect.objectContaining({
        id: event.id,
        annotations: {
          remarks: '=HYPERLINK("synthetic")\n<script>inert</script>',
        },
      }),
    );
    expect(document.sections.measurements).toContainEqual(
      expect.objectContaining({
        event_id: event.id,
        metric_key: 'renpho.target_fat_delta',
        canonical_value: '-3.401942775',
      }),
    );
    event = (await table('weigh_in_events', p.source_id))[0]!;
    expect(
      (await post({ action: 'delete_event', ...target() }, b.token)).status,
    ).toBe(404);
    for (const row of await table('measurements', p.source_id))
      expect(
        (
          await post({
            action: 'delete_measurement',
            measurement_id: row.id,
            expected_version: row.version,
            client_request_id: randomUUID(),
          })
        ).status,
      ).toBe(200);
    expect(await table('weigh_in_events', p.source_id)).toEqual([]);
    expect((await commit(p)).inserted).toBe(24);
    expect(await table('measurements', p.source_id)).toEqual([]);
  });
  it('binds source defaults and detail paging to owned versions and expires reads before cleanup', async () => {
    const input = request(
      'Date,Time,Weight(lb),BMI\n' +
        Array.from(
          { length: 61 },
          (_, i) =>
            `2026.09.01,08:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')},150,bad`,
        ).join('\n'),
    );
    const response = await post(input);
    expect(response.status).toBe(200);
    const p = successEnvelopeSchema(ImportPreviewV2Schema).parse(
      await response.json(),
    ).data;
    const get = (query: Record<string, string>, token = a.token) =>
      fetch(origin + '/api/data?' + new URLSearchParams(query), {
        headers: { Authorization: `Bearer ${token}` },
      });
    const items = await get({
      view: 'import_items',
      batch_id: p.batch_id,
      payload_hash: p.payload_hash,
      offset: '50',
      limit: '100',
    });
    expect(await items.json()).toMatchObject({
      data: {
        total: 122,
        items: expect.arrayContaining([
          expect.objectContaining({ kind: 'issue', row: 62 }),
        ]),
      },
    });
    const status = await get({
      view: 'import_status',
      client_request_id: input.client_request_id,
    });
    expect(await status.json()).toMatchObject({
      data: { batch_id: p.batch_id, status: 'previewed' },
    });
    expect(
      (
        await get(
          {
            view: 'import_items',
            batch_id: p.batch_id,
            payload_hash: p.payload_hash,
          },
          b.token,
        )
      ).status,
    ).toBe(404);
    const defaults = {
      action: 'update_source_defaults',
      source_id: p.source_id,
      expected_version: 1,
      client_request_id: randomUUID(),
      mapping: input.mapping,
    };
    expect((await post(defaults, b.token)).status).toBe(404);
    expect((await post(defaults)).status).toBe(200);
    expect((await post(commitBody(p))).status).toBe(409);
    expect(
      (await post({ ...defaults, client_request_id: randomUUID() })).status,
    ).toBe(409);
    const fresh = await preview();
    await db.admin(`/rest/v1/import_batches?id=eq.${fresh.batch_id}`, 'PATCH', {
      created_at: new Date(Date.now() - 120000).toISOString(),
      expires_at: new Date(Date.now() - 60000).toISOString(),
    });
    expect(
      (
        await get({
          view: 'import_items',
          batch_id: fresh.batch_id,
          payload_hash: fresh.payload_hash,
        })
      ).status,
    ).toBe(409);
    expect(
      await (
        await get({ view: 'import_status', batch_id: fresh.batch_id })
      ).json(),
    ).toMatchObject({ data: { status: 'expired', preview: null } });
  });
  it('denies foreign imports/events, old clients and direct old RPC writes before mutations', async () => {
    const p = await preview();
    expect((await post(commitBody(p), b.token)).status).toBe(404);
    expect((await post(commitBody(p), null)).status).toBe(401);
    expect((await post(commitBody(p), a.token, '1')).status).toBe(409);
    const legacy = await db.request('/rest/v1/rpc/commit_import_v1', a.token, {
      method: 'POST',
      body: JSON.stringify({ p_request: commitBody(p), p_bytes: '' }),
    });
    expect([401, 403]).toContain(legacy.status);
    expect(await table('measurements', p.source_id)).toEqual([]);
    await commit(p);
    const event = (await table('weigh_in_events', p.source_id))[0]!;
    const foreign = await fetch(
      origin +
        '/api/data?' +
        new URLSearchParams({ view: 'event', event_id: String(event.id) }),
      { headers: { Authorization: `Bearer ${b.token}` } },
    );
    expect(foreign.status).toBe(404);
    expect(
      await (
        await db.request(`/rest/v1/weigh_in_events?id=eq.${event.id}`, b.token)
      ).json(),
    ).toEqual([]);
  });
  it('serializes double confirmation and reports committed status when discard loses the race', async () => {
    const p = await preview();
    const results = await Promise.all([
      post(commitBody(p)),
      post(commitBody(p)),
    ]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    expect(await table('measurements', p.source_id)).toHaveLength(24);
    const discarded = await post({
      action: 'discard_import',
      batch_id: p.batch_id,
    });
    expect(await discarded.json()).toMatchObject({
      data: { status: 'committed', result: { inserted: 24 } },
    });
    const status = await fetch(
      origin +
        '/api/data?' +
        new URLSearchParams({ view: 'import_status', batch_id: p.batch_id }),
      { headers: { Authorization: `Bearer ${a.token}` } },
    );
    expect(await status.json()).toMatchObject({
      data: { status: 'committed', preview: null, result: { inserted: 24 } },
    });
  });
  it('rejects missing person/timezone declarations on direct source-default RPCs and denies direct event writes', async () => {
    const p = await preview();
    for (const mapping of [
      { ...request().mapping, single_profile: false },
      { ...request().mapping, timezone_confirmed: false },
      {
        schema_version: 1,
        format: 'canonical',
        timezone: 'UTC',
        single_profile: true,
        review_requested: false,
        source_label: 'S',
      },
      {
        schema_version: 1,
        format: 'canonical',
        timezone: 'UTC',
        profile: null,
        single_profile: false,
        review_requested: false,
        source_label: 'S',
      },
    ]) {
      const response = await db.request(
        '/rest/v1/rpc/update_source_defaults_v2',
        a.token,
        {
          method: 'POST',
          body: JSON.stringify({
            p_request: {
              schema_version: 2,
              action: 'update_source_defaults',
              source_id: p.source_id,
              expected_version: 1,
              client_request_id: randomUUID(),
              mapping,
            },
          }),
        },
      );
      expect(response.status).toBe(400);
    }
    expect([401, 403]).toContain(
      (
        await db.request('/rest/v1/weigh_in_events', a.token, {
          method: 'POST',
          body: '{}',
        })
      ).status,
    );
  });
  it('enforces source consistency for batch/event and observation lineage even through trusted direct SQL writes', async () => {
    const first = await preview();
    await commit(first);
    const second = await preview();
    await commit(second);
    const event = (await table('weigh_in_events', first.source_id))[0]!;
    const response = await db.request(
      `/rest/v1/weigh_in_events?id=eq.${event.id}`,
      'admin',
      {
        method: 'PATCH',
        body: JSON.stringify({ import_batch_id: second.batch_id }),
      },
    );
    expect(response.status).toBe(409);
    const reading = (await table('measurements', first.source_id))[0]!;
    const changed = await db.request(
      `/rest/v1/measurements?id=eq.${reading.id}`,
      'admin',
      {
        method: 'PATCH',
        body: JSON.stringify({ import_batch_id: second.batch_id }),
      },
    );
    expect(changed.status).toBe(409);
  });
  it('rolls back event parents, readings, annotations, staging state and revision after a late insert failure', async () => {
    const p = await preview();
    const sql = (input: string) => {
      const r = spawnSync(
        'docker',
        [
          'exec',
          '-i',
          'supabase_db_' + projectId,
          'psql',
          '-X',
          '-qAt',
          '-U',
          'postgres',
          '-d',
          'postgres',
          '-v',
          'ON_ERROR_STOP=1',
        ],
        { input, encoding: 'utf8', env: localEnvironment() },
      );
      expect(r.status).toBe(0);
    };
    const name = 'm1_fault_' + randomUUID().replaceAll('-', '');
    sql(
      `create function public.${name}() returns trigger language plpgsql set search_path='' as $fault$ begin if new.source_id='${p.source_id}'::uuid and new.metric_key='body_fat_percent' then raise exception 'synthetic_late_failure' using errcode='23514'; end if; return new; end; $fault$; create trigger ${name} before insert on public.measurements for each row execute function public.${name}();`,
    );
    try {
      expect((await post(commitBody(p))).status).toBe(400);
      expect(await table('weigh_in_events', p.source_id)).toEqual([]);
      expect(await table('measurements', p.source_id)).toEqual([]);
      const batch = await (
        await db.admin(
          `/rest/v1/import_batches?id=eq.${p.batch_id}&select=status,staging_payload_id`,
          'GET',
        )
      ).json();
      expect(batch).toEqual([
        { status: 'previewed', staging_payload_id: expect.any(String) },
      ]);
      const profile = await (
        await db.admin(
          `/rest/v1/profiles?user_id=eq.${a.id}&select=data_revision`,
          'GET',
        )
      ).json();
      expect(profile).toEqual([{ data_revision: p.dataRevision }]);
    } finally {
      sql(
        `drop trigger ${name} on public.measurements;drop function public.${name}();`,
      );
    }
    expect((await commit(p)).inserted).toBe(24);
  });
});

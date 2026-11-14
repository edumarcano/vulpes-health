import { createServer } from 'node:http';
import { once } from 'node:events';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { gzipSync } from 'node:zlib';
import { parse } from 'csv-parse/sync';
import { afterAll, beforeAll, expect, it, vi } from 'vitest';
import { localEnvironment, localStatus } from '../../scripts/local-database.js';
import { localRouter } from '../../server/http/router.js';
import { verifySession } from '../../server/auth/session.js';
import { readPayload } from '../../server/security/private-payloads.js';
import { LocalSupabase } from '../helpers/local-supabase.js';
import { successEnvelopeSchema } from '../../shared/api.js';
import { ImportPreviewV2Schema } from '../../shared/imports.js';

const server = createServer(localRouter);
let db: LocalSupabase, user: { id: string; token: string }, origin: string;
const rows = parse(
  readFileSync('docs/spec/v0.2.0/fixtures/renpho-v1/full-panel.csv'),
) as string[][];
const quote = (value: string) => '"' + value.replaceAll('"', '""') + '"';
function day(index: number) {
  return new Date(Date.UTC(2023, 0, index + 1))
    .toISOString()
    .slice(0, 10)
    .replaceAll('-', '.');
}
function body(csv: string) {
  return {
    schema_version: 2,
    action: 'preview_csv',
    client_request_id: randomUUID(),
    csv_base64: Buffer.from(csv).toString('base64'),
    source: {
      kind: 'new',
      label: 'Synthetic capacity',
      origin_app: null,
      device_label: null,
    },
    mapping: {
      schema_version: 1,
      format: 'renpho',
      timezone: 'UTC',
      profile: null,
      single_profile: true,
      timezone_confirmed: true,
      review_requested: false,
    },
  };
}
const post = (value: unknown) =>
  fetch(origin + '/api/data', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${user.token}`,
      'Content-Type': 'application/json',
      'X-Vulpes-Data-Contract': '2',
    },
    body: JSON.stringify(value),
  });
beforeAll(async () => {
  const status = localStatus();
  vi.stubEnv('VITE_SUPABASE_URL', status.apiUrl);
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', status.anonKey);
  vi.stubEnv('SUPABASE_SERVICE_ROLE_KEY', status.adminKey);
  vi.stubEnv('VULPES_TRACE_ENCRYPTION_KEY_ID', 'synthetic-m1-capacity');
  vi.stubEnv(
    'VULPES_TRACE_ENCRYPTION_KEY_B64',
    randomBytes(32).toString('base64'),
  );
  vi.stubEnv('VULPES_LIVE_AI_ENABLED', 'false');
  db = new LocalSupabase();
  user = await db.createUser();
  await db.admin('/rest/v1/profiles', 'POST', {
    user_id: user.id,
    display_name: 'Synthetic capacity',
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const a = server.address();
  if (!a || typeof a === 'string') throw Error();
  origin = `http://127.0.0.1:${a.port}`;
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

it('imports 1,000 complete weigh-ins and 24,000 numeric observations through authenticated preview/commit', async () => {
  const header = rows[0]!,
    template = rows[1]!;
  const csv = [
    header.map(quote).join(','),
    ...Array.from({ length: 1000 }, (_, index) =>
      header
        .map((h, i) =>
          quote(
            h === 'Date'
              ? day(index)
              : h === 'No.'
                ? String(index + 1)
                : h === 'Remarks'
                  ? `Synthetic row ${index + 1}`
                  : template[i]!,
          ),
        )
        .join(','),
    ),
  ].join('\n');
  const input = body(csv),
    started = performance.now(),
    response = await post(input),
    result = await response.json(),
    previewMs = performance.now() - started;
  expect({
    status: response.status,
    error: response.ok ? undefined : result,
  }).toEqual({ status: 200, error: undefined });
  const p = successEnvelopeSchema(ImportPreviewV2Schema).parse(result).data;
  expect(p.counts).toMatchObject({
    observations: 24000,
    new: 24000,
    invalid: 0,
  });
  expect(p.events.total).toBe(1000);
  const batch = (await (
    await db.admin(
      `/rest/v1/import_batches?id=eq.${p.batch_id}&select=staging_payload_id`,
      'GET',
    )
  ).json()) as Array<{ staging_payload_id: string }>;
  const envelope = (await (
    await db.admin(
      `/rest/v1/private_payloads?id=eq.${batch[0]!.staging_payload_id}&select=encrypted_bytes`,
      'GET',
    )
  ).json()) as Array<{ encrypted_bytes: string }>;
  const context = await verifySession({
      headers: { authorization: `Bearer ${user.token}` },
    }),
    payload = await readPayload(
      context,
      batch[0]!.staging_payload_id,
      'import_staging',
    );
  expect(payload.state).toBe('available');
  if (payload.state !== 'available') throw Error();
  const sql = `select octet_length(convert_from(decode('${payload.bytes.toString('base64')}','base64'),'UTF8')::jsonb::text);`;
  const measured = spawnSync(
    'docker',
    [
      'exec',
      '-i',
      'supabase_db_vulpes-health-pr03-test',
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
    {
      input: sql,
      encoding: 'utf8',
      env: localEnvironment(),
      maxBuffer: 1024 * 1024,
    },
  );
  expect(measured.status).toBe(0);
  const jsonbBytes = Number(measured.stdout.trim());
  const commitStart = performance.now(),
    committed = await post({
      schema_version: 2,
      action: 'commit_import',
      batch_id: p.batch_id,
      payload_hash: p.payload_hash,
      client_request_id: randomUUID(),
    }),
    ack = await committed.json(),
    commitMs = performance.now() - commitStart;

  expect({
    status: committed.status,
    error: committed.ok ? undefined : ack,
  }).toEqual({ status: 200, error: undefined });
  expect(ack).toMatchObject({
    data: { inserted: 24000, inserted_events: 1000, annotations_added: 3000 },
  });
  const events = await db.request(
    `/rest/v1/weigh_in_events?source_id=eq.${p.source_id}&select=id`,
    user.token,
    { method: 'HEAD', headers: { Prefer: 'count=exact' } },
  );
  const measurements = await db.request(
    `/rest/v1/measurements?source_id=eq.${p.source_id}&select=id`,
    user.token,
    { method: 'HEAD', headers: { Prefer: 'count=exact' } },
  );
  expect(events.headers.get('content-range')).toMatch(/\/1000$/);
  expect(measurements.headers.get('content-range')).toMatch(/\/24000$/);
  const measurement = {
    artifact: 'm1_capacity',
    synthetic: true,
    fixtureSHA256: createHash('sha256').update(csv).digest('hex'),
    events: 1000,
    observations: 24000,
    csvBytes: Buffer.byteLength(csv),
    requestBytes: Buffer.byteLength(JSON.stringify(input)),
    stagingBytes: payload.bytes.length,
    gzipBytes: gzipSync(payload.bytes).length,
    ciphertextBytes: (envelope[0]!.encrypted_bytes.length - 2) / 2,
    jsonbBytes,
    previewMs: Math.round(previewMs),
    commitMs: Math.round(commitMs),
  };
  mkdirSync('test-results', { recursive: true });
  writeFileSync(
    'test-results/m1-capacity.json',
    JSON.stringify(measurement, null, 2) + '\n',
  );
  console.info(JSON.stringify(measurement));
  payload.bytes.fill(0);
}, 120000);

it('accepts the complete 1 MiB CSV envelope with bounded control-character annotations', async () => {
  const lines = ['Date,Time,Weight(lb),Remarks'];
  let remaining = 1024 * 1024 - Buffer.byteLength(lines[0]!);
  for (let index = 0; remaining > 0; index++) {
    const prefix = `\n${day(index)},08:00:00,150,`;
    if (remaining < Buffer.byteLength(prefix))
      throw Error('Synthetic filler recipe cannot fit.');
    const size = Math.min(4096, remaining - Buffer.byteLength(prefix));
    lines.push(prefix + '\u0001'.repeat(size));
    remaining -= Buffer.byteLength(prefix) + size;
  }
  const csv = lines.join('');
  expect(Buffer.byteLength(csv)).toBe(1024 * 1024);
  const input = body(csv);
  expect(Buffer.byteLength(JSON.stringify(input))).toBeLessThan(
    2 * 1024 * 1024,
  );
  const response = await post(input),
    result = await response.json();
  expect({
    status: response.status,
    error: response.ok ? undefined : result,
  }).toEqual({ status: 200, error: undefined });
  const p = successEnvelopeSchema(ImportPreviewV2Schema).parse(result).data;
  expect(p.annotation_additions).toBeGreaterThan(250);
  expect(
    (await post({ action: 'discard_import', batch_id: p.batch_id })).status,
  ).toBe(200);
  const below = await post(body(csv.slice(0, -1)));
  expect(below.status).toBe(200);
  const lower = successEnvelopeSchema(ImportPreviewV2Schema).parse(
    await below.json(),
  ).data;
  expect(
    (await post({ action: 'discard_import', batch_id: lower.batch_id })).status,
  ).toBe(200);
  const above = await post(body(csv + 'x'));
  expect(above.status).toBe(413);
}, 120000);

it('bounds normalized staging separately from decoded CSV and cleans rejection without registering a batch', async () => {
  const flags = '\u0001'.repeat(100) + ';' + '\u0002'.repeat(100);
  const csv =
    'observed_at,metric,value,unit,source,granularity,quality_flags\n' +
    `2026-09-01T08:00:00Z,weight,70,kg,S,instant,${flags}\n`.repeat(3500);
  expect(Buffer.byteLength(csv)).toBeLessThan(1024 * 1024);
  const input = {
    ...body(csv),
    mapping: {
      schema_version: 1,
      format: 'canonical',
      source_label: 'S',
      timezone: 'UTC',
      profile: null,
      single_profile: true,
      review_requested: false,
    },
  };
  const before = await (
    await db.admin(
      `/rest/v1/import_batches?user_id=eq.${user.id}&select=id`,
      'GET',
    )
  ).json();
  const response = await post(input);
  expect(response.status).toBe(413);
  expect(await response.json()).toMatchObject({
    error: { code: 'staging_too_large' },
  });
  expect(
    await (
      await db.admin(
        `/rest/v1/import_batches?user_id=eq.${user.id}&select=id`,
        'GET',
      )
    ).json(),
  ).toEqual(before);
}, 120000);

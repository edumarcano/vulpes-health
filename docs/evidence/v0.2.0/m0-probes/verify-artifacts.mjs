/* global Buffer, console, process, URL */
import assert from 'node:assert/strict';
import { createHash, createCipheriv, randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { parse } from 'csv-parse/sync';
import { Decimal } from 'decimal.js';
import { Temporal } from '@js-temporal/polyfill';

// Isolated M0 evidence: no application, configuration, database or provider imports.
const root = new URL('../../../../', import.meta.url);
const fixtures = new URL('docs/spec/v0.2.0/fixtures/renpho-v1/', root);
const readJSON = async (url) => JSON.parse(await readFile(url, 'utf8'));
const manifest = await readJSON(new URL('manifest.json', fixtures));
const expected = await readJSON(new URL('expected-values.json', fixtures));
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const Exact = Decimal.clone({ precision: 2100 });
const bytes = (value) => Buffer.byteLength(JSON.stringify(value));
const mode = process.argv[2];
assert.equal(
  process.argv.length,
  3,
  'Select --fixtures, --capacity or --documents.',
);

if (mode === '--fixtures') {
  assert.equal(manifest.synthetic, true);
  assert.equal(manifest.fields.length, 24);
  assert.equal(
    manifest.fields.filter((field) => field.requiredNumeric).length,
    19,
  );
  assert.equal(new Set(manifest.fields.map((field) => field.key)).size, 24);
  const aliases = manifest.fields.flatMap((field) => field.aliases);
  assert.equal(new Set(aliases).size, aliases.length);
  assert.deepEqual(
    manifest.annotations.map((field) => field.header),
    ['Weight Level', 'Body Type', 'Remarks'],
  );
  for (const fixture of manifest.fixtures) {
    const content = await readFile(new URL(fixture.file, fixtures));
    assert.equal(sha(content), fixture.sha256, fixture.file);
    const rows = parse(content, { bom: true });
    const headers = rows.shift();
    assert.equal(rows.length, fixture.sourceRows);
    assert.equal(new Set(headers).size, headers.length);
    let numericValues = 0;
    for (const row of rows) {
      assert.equal(row.length, headers.length);
      for (const field of manifest.fields) {
        const position = headers.indexOf(field.header);
        const value = position < 0 ? '' : row[position];
        if (!['', '--'].includes(value)) {
          assert.match(value, /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/);
          numericValues++;
        }
      }
    }
    assert.equal(numericValues, fixture.populatedNumericValues, fixture.file);
  }
  const panel = parse(await readFile(new URL('full-panel.csv', fixtures)), {
    columns: true,
  })[0];
  assert.equal(expected.observations.length, 24);
  for (const field of manifest.fields) {
    const oracle = expected.observations.find((row) => row.key === field.key);
    assert.equal(panel[field.header], oracle.originalValue);
    assert.equal(
      new Exact(panel[field.header]).mul(field.conversionFactor).toFixed(),
      oracle.canonicalValue,
    );
    assert.equal(oracle.canonicalUnit, field.canonicalUnit);
  }
  for (const sample of manifest.timezoneCases) {
    const resolve = () => {
      assert.match(sample.local, /T\d{2}:\d{2}:[0-5]\d$/);
      return Temporal.PlainDateTime.from(sample.local, { overflow: 'reject' })
        .toZonedDateTime(sample.zone, { disambiguation: 'reject' })
        .toInstant()
        .toString();
    };
    if (sample.expectedInstant) assert.equal(resolve(), sample.expectedInstant);
    else assert.throws(resolve);
  }
  const identity = await readJSON(new URL('identity-cases.json', fixtures));
  assert.equal(identity.cases.length, 13);
  assert.equal(new Set(identity.cases.map((entry) => entry.id)).size, 13);
  console.log(
    JSON.stringify({
      artifact: 'm0_fixture_structure',
      status: 'passed',
      csvFiles: 5,
      numericFields: 24,
      timezoneCases: 5,
      identityDecisions: 13,
      productionAdapterTested: false,
    }),
  );
} else if (mode === '--capacity') {
  const started = performance.now();
  const mapping = {
    schema_version: 1,
    format: 'renpho',
    timezone: 'America/New_York',
    profile: null,
    single_profile: true,
    timezone_confirmed: true,
    review_requested: false,
  };
  const source = {
    kind: 'existing',
    id: '11111111-1111-4111-8111-111111111111',
  };
  const common = {
    schema_version: 2,
    adapter: manifest.adapterId,
    mapping,
    source,
    data_revision: 1,
    client_request_id: '22222222-2222-4222-8222-222222222222',
  };
  const rows = [],
    events = [];
  const csvHeaders = parse(
    await readFile(new URL('full-panel.csv', fixtures)),
  )[0];
  const quote = (value) =>
    /[",\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
  const csvRows = [csvHeaders.map(quote).join(',')];
  for (let event = 0; event < 1000; event++) {
    const local = Temporal.PlainDateTime.from('2026-01-01T08:00:00').add({
      days: event,
    });
    const zoned = local.toZonedDateTime(mapping.timezone);
    const time = local.toPlainTime().toString();
    const date = local.toPlainDate().toString();
    const observed = zoned.toInstant().toString();
    const offset = zoned.offsetNanoseconds / 60000000000;
    const values = manifest.fields.map((field, index) => {
      const oracle = expected.observations[index];
      rows.push({
        metric_key: field.key,
        canonical_value: oracle.canonicalValue,
        canonical_unit: field.canonicalUnit,
        original_value: field.sampleOriginal,
        original_unit: field.originalUnit,
        observed_at: observed,
        original_offset_minutes: offset,
        timezone: mapping.timezone,
        local_date: null,
        granularity: 'instant',
        measurement_method: field.method,
        quality_flags: [],
        external_record_id: null,
        provenance: {
          schema_version: 1,
          adapter: 'csv',
          row: event + 2,
          column: field.header,
          mapping,
        },
      });
      return [index, field.sampleOriginal, oracle.canonicalValue];
    });
    const annotations = {
      'Weight Level': 'Synthetic',
      'Body Type': 'Synthetic',
      Remarks: 'Synthetic capacity record.',
    };
    events.push({
      row: event + 2,
      original_row_id: String(event + 1),
      local: date + 'T' + time,
      instant: observed,
      offset,
      annotations,
      values,
    });
    const cells = {
      'No.': String(event + 1),
      Date: date.replaceAll('-', '.'),
      Time: time,
      ...annotations,
    };
    manifest.fields.forEach((field) => {
      cells[field.header] = field.sampleOriginal;
    });
    csvRows.push(
      csvHeaders.map((header) => quote(cells[header] ?? '')).join(','),
    );
  }
  const csv = csvRows.join('\n') + '\n';
  const flat = {
    ...common,
    observations: rows,
    classifications: rows.map(() => 'new'),
  };
  const compact = {
    ...common,
    fields: manifest.fields.map((field) => ({
      key: field.key,
      original_unit: field.originalUnit,
      canonical_unit: field.canonicalUnit,
      method: field.method,
      header: field.header,
    })),
    events,
    classifications: events.map(() => ({
      event: 'new',
      observations: 'all_new',
    })),
  };
  function measure(shape) {
    const plaintext = Buffer.from(JSON.stringify(shape));
    const compressed = gzipSync(plaintext);
    // Public synthetic key with a fresh nonce for disposable sizing only.
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', Buffer.alloc(32, 1), nonce);
    const ciphertext = Buffer.concat([
      cipher.update(compressed),
      cipher.final(),
      cipher.getAuthTag(),
    ]);
    const text = plaintext.toString();
    let separators = 0,
      inString = false,
      escape = false;
    for (const character of text) {
      if (escape) {
        escape = false;
        continue;
      }
      if (inString && character === '\\') {
        escape = true;
        continue;
      }
      if (character === '"') inString = !inString;
      else if (!inString && (character === ',' || character === ':'))
        separators++;
    }
    return {
      shapeSHA256: sha(plaintext),
      plaintextBytes: plaintext.length,
      gzipBytes: compressed.length,
      ciphertextBytes: ciphertext.length,
      hexPayloadRpcBytes: bytes({
        p_envelope: {
          encrypted_bytes: '\\x' + ciphertext.toString('hex'),
          nonce: '\\x' + nonce.toString('hex'),
          purpose: 'import_staging',
        },
      }),
      inspectRpcBytes: bytes({
        p_source: source,
        p_rows: shape.observations ?? shape,
      }),
      registerRpcBytes: bytes({
        p_payload_id: '33333333-3333-4333-8333-333333333333',
        p_bytes: text,
      }),
      commitRpcBytes: bytes({
        p_request: {
          action: 'commit_import',
          batch_id: '44444444-4444-4444-8444-444444444444',
          payload_hash: sha(plaintext),
          client_request_id: common.client_request_id,
        },
        p_bytes: text,
      }),
      estimatedJsonbTextBytes: plaintext.length + separators,
      jsonbMeasurement: 'spacing estimate only; PostgreSQL not run',
      fits4MiBPlaintext: plaintext.length <= 4194304,
    };
  }
  function csvAtSize(size) {
    let result = 'Date,Time,Weight(lb),Remarks\n';
    const prefix = '2026.09.01,08:00:00,150,';
    while (size - Buffer.byteLength(result) > 4096 + prefix.length + 1)
      result += prefix + 'x'.repeat(4096) + '\n';
    const remainder = size - Buffer.byteLength(result) - prefix.length - 1;
    assert(remainder >= 0 && remainder <= 4096);
    result += prefix + 'x'.repeat(remainder) + '\n';
    assert.equal(Buffer.byteLength(result), size);
    parse(result);
    return {
      bytes: Buffer.byteLength(result),
      sourceRows: parse(result).length - 1,
      text: result,
    };
  }
  const escapedRemark = String.fromCodePoint(92, 34, 233, 0x1f98a).repeat(40);
  const escaped =
    parse(csv)
      .map((row) =>
        row
          .map((cell) =>
            quote(cell === 'Synthetic capacity record.' ? escapedRemark : cell),
          )
          .join(','),
      )
      .join('\n') + '\n';
  assert.equal(parse(escaped).length, 1001);
  const result = {
    artifact: 'm0_capacity_serialization',
    schemaVersion: 1,
    synthetic: true,
    runtime: {
      node: process.version,
      platform: process.platform,
      arch: process.arch,
    },
    events: 1000,
    numericObservations: rows.length,
    csvBytes: Buffer.byteLength(csv),
    csvSHA256: sha(csv),
    apiJsonBytes: bytes({
      action: 'preview_csv',
      client_request_id: common.client_request_id,
      source,
      mapping,
      csv,
    }),
    flatCounterfactual: measure(flat),
    proposedCompact: measure(compact),
    highEscapingSample: {
      csvBytes: Buffer.byteLength(escaped),
      apiJsonBytes: bytes({ csv: escaped, source, mapping }),
    },
    transportEscapingSamples: ['\\', '\u0001'].map((character) => {
      const csv = csvAtSize(1048576);
      // Replace only annotation filler, retaining valid CSV shape and field bounds.
      const text = csv.text.replaceAll('x', character);
      return {
        characterCodePoint: character.codePointAt(0),
        decodedCsvBytes: Buffer.byteLength(text),
        apiJsonBytes: bytes({ csv: text, source, mapping }),
        syntax:
          'Valid CSV grammar; annotation control-character policy not established in M0',
      };
    }),
    byteBoundarySamples: [1048575, 1048576, 1048577].map((size) => {
      const { text, ...metadata } = csvAtSize(size);
      assert(text);
      return metadata;
    }),
    rowBoundarySamples: [9999, 10000, 10001].map((count) => ({
      sourceRows: count,
      csvBytes: Buffer.byteLength(
        'Date,Time,Weight(lb)\n' + '2026.09.01,08:00:00,150\n'.repeat(count),
      ),
    })),
    observationBoundarySamples: [24999, 25000, 25001].map((count) => ({
      numericObservations: count,
      fullEvents: Math.floor(count / 24),
      remainderValues: count % 24,
    })),
    serializationMilliseconds:
      Math.round((performance.now() - started) * 100) / 100,
    evidenceBoundary:
      'Synthetic serialization only. Flat expansion is counterfactual: current parser handles two fields. Compact format/RPC is proposed, not implemented. No API/database transaction or hosting throughput measured.',
  };
  assert.equal(result.numericObservations, 24000);
  assert(result.csvBytes < 1048576);
  console.log(JSON.stringify(result, null, 2));
} else if (mode === '--documents') {
  const evidence = await readJSON(
    new URL('docs/spec/v0.2.0/fixtures/evaluation-plan-v1.json', root),
  );
  assert.equal(evidence.synthetic, true);
  assert(evidence.scenarios.length >= 16 && evidence.scenarios.length <= 24);
  assert.equal(
    new Set(evidence.scenarios.map((entry) => entry.id)).size,
    evidence.scenarios.length,
  );
  assert.equal(
    evidence.scenarios.filter(
      (entry) => entry.partition === 'final_verification',
    ).length,
    3,
  );
  assert(
    evidence.scenarios.every(
      (entry) =>
        entry.prompt &&
        entry.must.length &&
        entry.mustNot.length &&
        entry.fixture,
    ),
  );
  assert.equal(evidence.scoring.ordinaryMinimumCompletion, 0.9);
  assert.equal(evidence.scenarios.filter((entry) => entry.critical).length, 8);
  assert.equal(
    evidence.scenarios.filter((entry) => !entry.critical).length,
    12,
  );
  assert(
    evidence.scenarios
      .filter((entry) => entry.partition === 'final_verification')
      .every((entry) => !entry.critical),
  );
  assert.equal(evidence.scoring.ordinaryRequiredPasses, Math.ceil(12 * 0.9));
  for (const [file, binding] of Object.entries(evidence.fixtureBindings)) {
    assert.equal(
      sha(await readFile(new URL('docs/spec/v0.2.0/fixtures/' + file, root))),
      binding.sha256,
      file,
    );
  }
  for (const entry of evidence.scenarios)
    await readFile(new URL('docs/spec/v0.2.0/fixtures/' + entry.fixture, root));
  const data = await readJSON(
    new URL('docs/spec/v0.2.0/fixtures/evaluation-data-v1.json', root),
  );
  const oracle = data.independentOracles;
  const september = data.events.filter((event) =>
    event.local.startsWith('2026-09'),
  );
  const daily = new Map();
  for (const event of september) {
    const day = event.local.slice(0, 10);
    daily.set(day, [...(daily.get(day) ?? []), new Exact(event.weightKg)]);
  }
  const medians = [...daily.values()].map((values) => {
    values.sort((a, b) => a.comparedTo(b));
    const middle = Math.floor(values.length / 2);
    return values.length % 2
      ? values[middle]
      : values[middle - 1].plus(values[middle]).div(2);
  });
  const mean = (values) =>
    values
      .reduce((sum, value) => sum.plus(value), new Exact(0))
      .div(values.length);
  assert.deepEqual(
    medians.map((value) => value.toFixed()),
    oracle.septemberDailyMediansKg,
  );
  assert.equal(mean(medians).toFixed(), oracle.septemberEqualDayMeanKg);
  assert.equal(
    mean(september.map((event) => new Exact(event.weightKg))).toFixed(),
    oracle.septemberRawSampleMeanKg,
  );
  const august = mean(
    data.events
      .filter((event) => event.local.startsWith('2026-08'))
      .map((event) => new Exact(event.weightKg)),
  );
  assert.equal(august.toFixed(), oracle.augustEqualDayMeanKg);
  assert.equal(mean(medians).minus(august).toFixed(), oracle.meanChangeKg);
  assert.equal(
    mean(medians).minus(august).div(august).mul(100).toFixed(),
    oracle.relativeMeanChangePercent,
  );
  const prior = data.events.find((event) => event.id === 'sep-01-a');
  const current = data.events.find((event) => event.id === 'sep-02');
  const fatChange = new Exact(current.bodyFatPercent).minus(
    prior.bodyFatPercent,
  );
  const muscleChange = new Exact(current.muscleMassKg).minus(
    prior.muscleMassKg,
  );
  assert.equal(fatChange.toFixed(), oracle.bodyFatChangePercentagePoints);
  assert.equal(
    fatChange.div(prior.bodyFatPercent).mul(100).toFixed(),
    oracle.bodyFatRelativeChangePercent,
  );
  assert.equal(muscleChange.toFixed(), oracle.muscleChangeKg);
  assert.equal(
    muscleChange.div(prior.muscleMassKg).mul(100).toFixed(),
    oracle.muscleRelativeChangePercent,
  );
  const weightGoal = data.goalFixtures.weight;
  const muscleGoal = data.goalFixtures.muscle;
  assert.equal(
    new Exact(weightGoal.baselineKg)
      .minus(weightGoal.latestKg)
      .div(new Exact(weightGoal.baselineKg).minus(weightGoal.targetKg))
      .mul(100)
      .toFixed(),
    oracle.weightGoalProgressPercent,
  );
  assert.equal(
    new Exact(muscleGoal.latestKg)
      .minus(muscleGoal.baselineKg)
      .div(new Exact(muscleGoal.targetKg).minus(muscleGoal.baselineKg))
      .mul(100)
      .toFixed(),
    oracle.muscleGoalProgressPercent,
  );
  assert.equal(daily.size, oracle.septemberCoveredDays);
  const rolling = september.filter(
    (event) => event.local >= '2026-09-03' && event.local < '2026-09-10',
  );
  assert.equal(
    mean(rolling.map((event) => new Exact(event.weightKg))).toFixed(),
    oracle.rollingSeptember03Through09Kg,
  );
  assert.equal(data.zeroBaselineCase.baseline, '0');
  assert.equal(data.zeroBaselineCase.expectedRelativePercent, null);
  assert.equal(oracle.zeroBaselineRelativeChange, null);
  const files = [
    new URL('docs/evidence/v0.2.0/m0-readiness.md', root),
    new URL('docs/evidence/v0.2.0/m0-probes/README.md', root),
    new URL('docs/V0.2.0_RELEASE_PLAN.md', root),
  ];
  let links = 0;
  for (const file of files) {
    const text = await readFile(file, 'utf8');
    assert(!/[ \t]+$/m.test(text), fileURLToPath(file));
    assert.equal((text.match(/^```/gm) ?? []).length % 2, 0);
    for (const match of text.matchAll(/\]\(([^)]+)\)/g)) {
      if (/^(?:https?:|#)/.test(match[1])) continue;
      await readFile(new URL(match[1].split('#')[0], file));
      links++;
    }
  }
  const m0 = await readFile(files[0], 'utf8');
  for (let id = 1; id <= 9; id++) assert(m0.includes('M0-A' + id));
  const source = await readdir(fixtures);
  assert.equal(source.filter((file) => file.endsWith('.csv')).length, 5);
  console.log(
    JSON.stringify({
      artifact: 'm0_documents',
      status: 'passed',
      localFileLinks: links,
      evaluationScenarios: evidence.scenarios.length,
      acceptanceRows: 9,
      semanticReviewRequired: true,
    }),
  );
} else throw new Error('Unknown probe mode.');

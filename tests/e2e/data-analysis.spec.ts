import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { accounts, restrictNetwork, signIn } from './auth-helpers';
import { LocalSupabase } from '../helpers/local-supabase';

async function clear() {
  const db = new LocalSupabase();
  for (const account of accounts.slice(0, 2))
    for (const table of [
      'audit_events',
      'measurements',
      'weigh_in_events',
      'import_batches',
      'private_payloads',
      'data_sources',
    ])
      await db.admin(`/rest/v1/${table}?user_id=eq.${account.id}`, 'DELETE');
}
async function post(page: Page, body: unknown) {
  const account = accounts[0] as (typeof accounts)[number] & { token: string };
  const response = await page.request.post('/api/data', {
    headers: {
      'X-Vulpes-Data-Contract': '2',
      Authorization: `Bearer ${account.token}`,
    },
    data: body,
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as { data: Record<string, unknown> };
}
async function fixture(page: Page) {
  let sourceId = '',
    firstId = '';
  const rows = [
    ['80', '2026-08-01T08:00:00Z'],
    ['80', '2026-08-15T08:00:00Z'],
    ['80', '2026-08-30T08:00:00Z'],
    ['70', '2026-09-01T08:00:00Z'],
    ['74', '2026-09-01T09:00:00Z'],
    ['78', '2026-09-01T10:00:00Z'],
    ['68', '2026-09-03T08:00:00Z'],
    ['74', '2026-09-10T08:00:00Z'],
  ];
  for (const [value, observedAt] of rows) {
    const result = await post(page, {
      action: 'add_measurement',
      client_request_id: crypto.randomUUID(),
      source: sourceId
        ? { kind: 'existing', id: sourceId }
        : {
            kind: 'new',
            label: 'Synthetic period scale',
            origin_app: null,
            device_label: null,
          },
      observation: {
        metric: 'weight',
        value,
        unit: 'kg',
        observed_at: observedAt,
        timezone: 'UTC',
        local_date: null,
        granularity: 'instant',
        method: 'device_reported',
        quality_flags: [],
      },
    });
    sourceId = String(result.data.sourceId);
    if (observedAt === '2026-09-01T08:00:00Z') firstId = String(result.data.id);
  }
  for (const [value, observedAt] of [
    ['25', '2026-08-15T08:00:00Z'],
    ['20', '2026-09-10T08:00:00Z'],
  ])
    await post(page, {
      action: 'add_measurement',
      client_request_id: crypto.randomUUID(),
      source: { kind: 'existing', id: sourceId },
      observation: {
        metric: 'body_fat_percent',
        value,
        unit: '%',
        observed_at: observedAt,
        timezone: 'UTC',
        local_date: null,
        granularity: 'instant',
        method: 'device_estimate',
        quality_flags: [],
      },
    });
  return { sourceId, firstId };
}
async function selectMonth(page: Page, sourceId: string) {
  await page.goto('/data');
  await page.getByLabel('Source', { exact: true }).selectOption(sourceId);
  await page
    .getByLabel('Method', { exact: true })
    .selectOption('device_reported');
  await page.getByLabel('Analysis timezone', { exact: true }).fill('UTC');
  await page.getByLabel('From date', { exact: true }).fill('2026-09-01');
  await page.getByLabel('Through date', { exact: true }).fill('2026-09-30');
}
test.beforeEach(async ({ page }) => {
  await clear();
  await restrictNetwork(page);
  await signIn(page);
});
test.afterEach(clear);

test('M3 analysis displays independent month comparisons, coverage and percentage points without inference', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls: string[] = [];
  page.on('request', (request) => {
    if (/\/api\/(chat|approvals|executions)/.test(request.url()))
      calls.push(request.url());
  });
  const { sourceId } = await fixture(page);
  await selectMonth(page, sourceId);
  await expect(page.getByLabel('Calculation', { exact: true })).toHaveValue(
    'observed_day_mean',
  );
  await expect(page.getByTestId('headline-value')).toHaveText('72 kg');
  const summary = page.getByRole('region', {
    name: 'Deterministic summary',
    exact: true,
  });
  await expect(summary).toContainText('3/30 observed/calendar days');
  await page
    .getByLabel('Compare with', { exact: true })
    .selectOption('previous_month');
  await expect(summary).toContainText('-8 kg (-10% relative change)');
  await expect(summary).toContainText('Previous: 80 kg');
  await expect(summary).toContainText('3/31 observed/calendar days');
  await page
    .getByLabel('Metric', { exact: true })
    .selectOption('body_fat_percent');
  await page
    .getByLabel('Method', { exact: true })
    .selectOption('device_estimate');
  await expect(summary).toContainText(
    '-5 percentage points (-20% relative change)',
  );
  await expect(
    page.getByRole('region', { name: 'Metric guidance' }),
  ).toContainText('Manufacturer reference unavailable');
  await page.getByLabel('Metric', { exact: true }).selectOption('weight');
  await page
    .getByLabel('Method', { exact: true })
    .selectOption('device_reported');
  await page.getByLabel('Compare with', { exact: true }).selectOption('none');
  await page
    .getByLabel('Calculation', { exact: true })
    .selectOption('rolling_7d');
  await page.getByLabel('Through date', { exact: true }).fill('2026-09-10');
  await expect(summary).toContainText('Insufficient data');
  await expect(summary).toContainText('1/7 observed/calendar days');
  await expect(page.getByTestId('headline-value')).toHaveCount(0);
  await page.getByLabel('Show loaded raw readings', { exact: true }).uncheck();
  await expect(page.locator('.recharts-line-dots .recharts-dot')).toHaveCount(
    3,
  );
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth + 1,
      ),
    ).toBe(true);
  }
  expect(calls).toEqual([]);
});

test('M3 analysis separates an incomplete latest event from dated per-metric readings and raw unresolved fields', async ({
  page,
}) => {
  async function importCsv(csv: Buffer | string, source?: string) {
    const preview = await post(page, {
      action: 'preview_csv',
      schema_version: 2,
      client_request_id: crypto.randomUUID(),
      csv_base64: Buffer.from(csv).toString('base64'),
      source: source
        ? { kind: 'existing', id: source }
        : {
            kind: 'new',
            label: 'Synthetic event scale',
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
    });
    await post(page, {
      action: 'commit_import',
      schema_version: 2,
      batch_id: preview.data.batch_id,
      payload_hash: preview.data.payload_hash,
      client_request_id: crypto.randomUUID(),
    });
    return String(preview.data.source_id);
  }
  const source = await importCsv(
    readFileSync('docs/spec/v0.2.0/fixtures/renpho-v1/full-panel.csv'),
  );
  await importCsv('Date,Time,Weight(lb)\n2026.09.02,08:00:00,149\n', source);
  await selectMonth(page, source);
  const event = page.getByRole('region', {
    name: 'Latest weigh-in',
    exact: true,
  });
  await expect(event).toContainText('1 observations from this event only');
  await expect(event).not.toContainText('Body fat');
  const overview = page.getByRole('region', {
    name: 'Latest per metric',
    exact: true,
  });
  const fat = overview
    .getByRole('listitem')
    .filter({ hasText: 'Body fat (device estimate)' });
  await expect(fat).toContainText('20 %');
  await expect(fat).toContainText('2026-09-01T08:00:00');
  await event
    .getByRole('button', { name: 'Inspect latest weigh-in', exact: true })
    .click();
  const detail = page.getByRole('region', {
    name: 'Weigh-in detail',
    exact: true,
  });
  await expect(detail.getByRole('table').getByRole('row')).toHaveCount(2);
  await detail
    .getByRole('button', { name: 'Close weigh-in', exact: true })
    .click();
  await page.getByLabel('Metric', { exact: true }).selectOption('renpho.bmr');
  await page
    .getByLabel('Method', { exact: true })
    .selectOption('device_estimate');
  await expect(page.getByRole('table')).toContainText('1500.5 kcal');
  await expect(
    page.getByRole('region', { name: 'Metric guidance' }),
  ).toContainText('unverified');
  await expect(page.getByText(/Raw values remain available/)).toBeVisible();
});

test('M3 analysis evidence retains its owned selection and refuses stale or missing descriptors', async ({
  page,
}) => {
  const { sourceId, firstId } = await fixture(page);
  await selectMonth(page, sourceId);
  await expect(page.getByTestId('headline-value')).toHaveText('72 kg');
  await page
    .getByRole('button', { name: 'Open result evidence', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Result evidence', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('headline-value')).toHaveText('72 kg');
  const evidenceUrl = page.url();
  await post(page, {
    action: 'correct_measurement',
    measurement_id: firstId,
    expected_version: 1,
    client_request_id: crypto.randomUUID(),
    changes: {
      value: '71',
      unit: 'kg',
      observed_at: '2026-09-01T08:00:00Z',
      timezone: 'UTC',
      local_date: null,
    },
  });
  await page.reload();
  await expect(page.getByRole('alert')).toContainText(
    'Original result unavailable',
  );
  await expect(page.getByTestId('headline-value')).toHaveCount(0);
  await page.goto('/data');
  await page.goto(evidenceUrl);
  await expect(page.getByRole('alert')).toContainText(
    'Current data has not been substituted',
  );
  await expect(
    page.getByRole('region', { name: 'Deterministic summary' }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Request current data', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Data', exact: true }),
  ).toBeVisible();
});

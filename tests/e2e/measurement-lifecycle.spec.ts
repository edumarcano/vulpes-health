import { readFileSync } from 'node:fs';
import { parse } from 'csv-parse/sync';
import { expect, test, type Page } from '@playwright/test';
import { accounts, restrictNetwork, signIn } from './auth-helpers';
import { LocalSupabase } from '../helpers/local-supabase';
const canonical = readFileSync(
  'docs/spec/v0.1.0/fixtures/measurements-synthetic.csv',
);
async function clear() {
  const db = new LocalSupabase();
  for (const a of accounts)
    for (const table of [
      'audit_events',
      'measurements',
      'import_batches',
      'private_payloads',
      'data_sources',
    ])
      await db.admin(`/rest/v1/${table}?user_id=eq.${a.id}`, 'DELETE');
}
test.beforeEach(async ({ page }) => {
  await clear();
  await restrictNetwork(page);
  await signIn(page);
  await page.goto('/data');
  await expect(
    page.getByRole('heading', { name: 'Data', level: 1, exact: true }),
  ).toBeVisible();
});
test.afterEach(clear);
async function range(page: Page) {
  await page.getByLabel('From date', { exact: true }).fill('2026-09-01');
  await page.getByLabel('Through date', { exact: true }).fill('2026-09-14');
  await page
    .getByLabel('Method', { exact: true })
    .selectOption('device_reported');
}
async function seed(
  page: Page,
  value = '70',
  metric = 'weight',
  label = 'Synthetic lifecycle',
) {
  const response = await page.request.post('/api/data', {
    headers: {
      Authorization: `Bearer ${(accounts[0] as (typeof accounts)[number] & { token: string }).token}`,
    },
    data: {
      action: 'add_measurement',
      client_request_id: crypto.randomUUID(),
      source: { kind: 'new', label, origin_app: null, device_label: null },
      observation: {
        metric,
        value,
        unit: metric === 'weight' ? 'kg' : 'index',
        observed_at: '2026-09-08T08:00:00Z',
        timezone: 'UTC',
        local_date: null,
        granularity: 'instant',
        method: 'device_reported',
        quality_flags: [],
      },
    },
  });
  expect(response.status()).toBe(200);
  const data = (
    (await response.json()) as {
      data: { id: string; sourceId: string; version: number };
    }
  ).data;
  await page.reload();
  await range(page);
  await page.getByLabel('Source', { exact: true }).selectOption(data.sourceId);
  if (metric !== 'weight')
    await page.getByLabel('Metric', { exact: true }).selectOption(metric);
  await expect(page.getByRole('table')).toContainText(value);
  return data;
}
async function importFixture(page: Page) {
  const fileInput = page.getByLabel('CSV file', { exact: true });
  if (!(await fileInput.isVisible())) {
    await page
      .getByRole('button', { name: 'Import CSV', exact: true })
      .click();
  }
  await page.getByLabel('CSV file', { exact: true }).setInputFiles({
    name: 'synthetic.csv',
    mimeType: 'text/csv',
    buffer: canonical,
  });
  await expect(
    page.getByText('Selected: synthetic.csv', { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('Import source label', { exact: true })
    .fill('Synthetic M2 scale');
  await page
    .getByLabel('CSV source label to include', { exact: true })
    .fill('Synthetic Scale A');
  await page
    .getByLabel('I confirm this file contains one profile', { exact: true })
    .check();
  await page.getByRole('button', { name: 'Preview CSV', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Confirm CSV import', exact: true }),
  ).toContainText('28 new');
  await page
    .getByRole('button', { name: 'Confirm import', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Import recorded', exact: true }),
  ).toBeVisible();
  await range(page);
  await expect(page.getByTestId('headline-value')).toHaveText('69 kg');
}
async function switchAccount(page: Page) {
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Settings', exact: true })
    .click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, 1);
  await page.goto('/data');
  await expect(
    page.getByRole('heading', { name: 'No measurements loaded', exact: true }),
  ).toBeVisible();
}
test('M2 data journey imports, corrects, deletes, recalculates and downloads surviving canonical CSV', async ({
  page,
}, info) => {
  const calls: string[] = [];
  page.on('request', (r) => {
    if (/\/api\/(chat|goals|approvals|executions)/.test(r.url()))
      calls.push(r.url());
  });
  await importFixture(page);
  const row = page.getByRole('row').filter({ hasText: '2026-09-08T08:00:00' });
  await row.getByRole('button', { name: 'Correct', exact: true }).click();
  await page.getByLabel('Corrected value', { exact: true }).fill('76.3');
  await page
    .getByRole('button', { name: 'Review correction', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Confirm correction', exact: true }),
  ).toBeFocused();
  await page
    .getByRole('button', { name: 'Confirm correction', exact: true })
    .press('Enter');
  await expect(page.getByTestId('headline-value')).toHaveText('70 kg');
  await expect(
    page.getByRole('heading', { name: 'Measurement table', exact: true }),
  ).toBeFocused();
  await expect(row).toContainText('user_corrected');
  await row.getByRole('button', { name: 'Delete', exact: true }).click();
  const deletion = page.getByRole('region', {
    name: 'Confirm deletion',
    exact: true,
  });
  await expect(deletion).toContainText('frozen historical decisions');
  await expect(deletion).toContainText('retained exact request');
  await expect(
    page.getByRole('button', {
      name: 'Confirm delete measurement',
      exact: true,
    }),
  ).toBeFocused();
  await page
    .getByRole('button', { name: 'Confirm delete measurement', exact: true })
    .click();
  await expect(page.getByTestId('headline-value')).toHaveText('68.95 kg');
  await expect(row).toHaveCount(0);
  const downloading = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Export selected measurements', exact: true })
    .click();
  const download = await downloading;
  expect(download.suggestedFilename()).toBe('vulpes-measurements-v1.csv');
  await download.saveAs(info.outputPath('surviving-synthetic.csv'));
  const records = parse(
    readFileSync(info.outputPath('surviving-synthetic.csv')),
    { columns: true },
  ) as Array<Record<string, string>>;
  expect(records).toHaveLength(13);
  expect(
    records.some((r) => r.observed_at === '2026-09-08T08:00:00+00:00'),
  ).toBe(false);
  expect(records.every((r) => r.schema_version === '1')).toBe(true);
  expect(calls).toEqual([]);
  await page.screenshot({
    path: info.outputPath('m2-journey.png'),
    fullPage: true,
  });
});
test('a stale correction shows refresh/review instead of overwriting a concurrent change', async ({
  page,
}) => {
  const r = await seed(page);
  await page.getByRole('button', { name: 'Correct', exact: true }).click();
  await page.getByLabel('Corrected value', { exact: true }).fill('69');
  const response = await page.request.post('/api/data', {
    headers: {
      Authorization: `Bearer ${(accounts[0] as (typeof accounts)[number] & { token: string }).token}`,
    },
    data: {
      action: 'correct_measurement',
      measurement_id: r.id,
      expected_version: 1,
      client_request_id: crypto.randomUUID(),
      changes: {
        value: '68',
        unit: 'kg',
        observed_at: '2026-09-08T08:00:00Z',
        timezone: 'UTC',
        local_date: null,
      },
    },
  });
  expect(response.status()).toBe(200);
  await page
    .getByRole('button', { name: 'Review correction', exact: true })
    .click();
  await page
    .getByRole('button', { name: 'Confirm correction', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('data changed');
  await expect(
    page.getByRole('button', { name: 'Confirm correction', exact: true }),
  ).toBeDisabled();
  await page
    .getByRole('button', { name: 'Refresh reading', exact: true })
    .click();
  await expect(page.getByRole('table')).toContainText('68 kg');
  await expect(
    page.getByRole('region', { name: 'Correct measurement', exact: true }),
  ).toHaveCount(0);
});
test('correction invalidates an open CSV preview in the rendered screen', async ({
  page,
}) => {
  await seed(page);
  const fileInput = page.getByLabel('CSV file', { exact: true });
  if (!(await fileInput.isVisible())) {
    await page
      .getByRole('button', { name: 'Import CSV', exact: true })
      .click();
  }
  await page.getByLabel('CSV file', { exact: true }).setInputFiles({
    name: 'synthetic.csv',
    mimeType: 'text/csv',
    buffer: canonical,
  });
  await expect(
    page.getByText('Selected: synthetic.csv', { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('Import source label', { exact: true })
    .fill('Pending synthetic');
  await page
    .getByLabel('CSV source label to include', { exact: true })
    .fill('Synthetic Scale A');
  await page
    .getByLabel('I confirm this file contains one profile', { exact: true })
    .check();
  await page.getByRole('button', { name: 'Preview CSV', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Confirm CSV import', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Correct', exact: true })
    .dispatchEvent('click');
  await page.getByLabel('Corrected value', { exact: true }).fill('69');
  await page
    .getByRole('button', { name: 'Review correction', exact: true })
    .dispatchEvent('click');
  await page
    .getByRole('button', { name: 'Confirm correction', exact: true })
    .dispatchEvent('click');
  await expect(
    page
      .getByRole('region', { name: 'Confirm CSV import', exact: true })
      .getByRole('alert'),
  ).toContainText('Your data changed');
  await expect(
    page.getByRole('button', { name: 'Confirm import', exact: true }),
  ).toBeDisabled();
});
test('download preserves numeric negatives and protects formula text', async ({
  page,
}, info) => {
  await seed(
    page,
    '-1.250000000000000001',
    'renpho.visceral_fat_index',
    '=1+1',
  );
  await page.evaluate(() => {
    const create = URL.createObjectURL.bind(URL),
      revoke = URL.revokeObjectURL.bind(URL);
    const counts = { created: 0, revoked: 0 };
    Object.assign(window, { syntheticDownloadUrls: counts });
    URL.createObjectURL = (blob) => {
      counts.created++;
      return create(blob);
    };
    URL.revokeObjectURL = (url) => {
      counts.revoked++;
      revoke(url);
    };
  });
  const waiting = page.waitForEvent('download');
  await page
    .getByRole('button', { name: 'Export selected measurements', exact: true })
    .click();
  const download = await waiting;
  await download.saveAs(info.outputPath('negative-synthetic.csv'));
  const records = parse(
    readFileSync(info.outputPath('negative-synthetic.csv')),
    { columns: true },
  ) as Array<Record<string, string>>;
  expect(records[0]).toMatchObject({
    value: '-1.250000000000000001',
    original_value: '-1.250000000000000001',
    source: "'=1+1",
  });
  expect(
    await page.evaluate(() => Reflect.get(window, 'syntheticDownloadUrls')),
  ).toEqual({ created: 1, revoked: 1 });
});
for (const action of ['correct_measurement', 'delete_measurement', 'export'])
  test(`account change discards late ${action} result`, async ({ page }) => {
    await seed(page);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached!: () => void;
    const started = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let finished!: () => void;
    const completed = new Promise<void>((resolve) => {
      finished = resolve;
    });
    let intercepted = false;
    let downloads = 0;
    page.on('download', () => downloads++);
    await page.route('**/api/data**', async (route) => {
      const req = route.request();
      const matches =
        action === 'export'
          ? req.url().includes('view=export')
          : req.postData()?.includes(action);
      if (intercepted || !matches) {
        await route.continue();
        return;
      }
      intercepted = true;
      const response = await route.fetch();
      expect(response.status()).toBe(200);
      reached();
      await barrier;
      try {
        await route.fulfill({ response });
      } catch {
        /* The identity guard may already have aborted this obsolete request. */
      } finally {
        finished();
      }
    });
    try {
      if (action === 'export')
        await page
          .getByRole('button', {
            name: 'Export selected measurements',
            exact: true,
          })
          .click();
      else {
        await page
          .getByRole('button', {
            name: action === 'correct_measurement' ? 'Correct' : 'Delete',
            exact: true,
          })
          .click();
        if (action === 'correct_measurement') {
          await page.getByLabel('Corrected value', { exact: true }).fill('69');
          await page
            .getByRole('button', { name: 'Review correction', exact: true })
            .click();
        }
        await page
          .getByRole('button', {
            name:
              action === 'correct_measurement'
                ? 'Confirm correction'
                : 'Confirm delete measurement',
            exact: true,
          })
          .click();
      }
      await started;
      await switchAccount(page);
      release();
      await completed;
      await expect(
        page.getByRole('region', { name: 'Correct measurement', exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('region', { name: 'Confirm deletion', exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('status').filter({ hasText: 'Measurement corrected.' }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('status').filter({ hasText: 'CSV download started' }),
      ).toHaveCount(0);
      expect(downloads).toBe(0);
    } finally {
      release();
    }
  });
for (const colorScheme of ['light', 'dark'] as const)
  for (const [width, height] of [
    [360, 800],
    [390, 844],
    [430, 932],
    [768, 1024],
    [1440, 900],
  ])
    test(`lifecycle ${width}x${height} ${colorScheme}: correction and deletion at 200% text`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width: width!, height: height! });
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await seed(page);
      await page.getByRole('button', { name: 'Correct', exact: true }).click();
      await page.getByLabel('Corrected value', { exact: true }).fill('69');
      await page
        .getByRole('button', { name: 'Review correction', exact: true })
        .click();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath('correction.png'),
        fullPage: true,
      });
      await page
        .getByRole('region', { name: 'Correct measurement', exact: true })
        .screenshot({
          path: info.outputPath(`correction-${width}-${colorScheme}.png`),
        });
      await page
        .getByRole('button', { name: 'Cancel change', exact: true })
        .click();
      await page.getByRole('button', { name: 'Delete', exact: true }).click();
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await expect(
        page.getByRole('button', {
          name: 'Confirm delete measurement',
          exact: true,
        }),
      ).toBeVisible();
      await page.screenshot({
        path: info.outputPath('deletion-zoom.png'),
        fullPage: true,
      });
      await page
        .getByRole('region', { name: 'Confirm deletion', exact: true })
        .screenshot({
          path: info.outputPath(`deletion-${width}-${colorScheme}-zoom.png`),
        });
    });

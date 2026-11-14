import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { expect, test, type Page } from '@playwright/test';
import { accounts, restrictNetwork, signIn } from './auth-helpers';
import { LocalSupabase } from '../helpers/local-supabase';
const canonical = readFileSync(
  'docs/spec/v0.1.0/fixtures/measurements-synthetic.csv',
);
const wide = readFileSync('docs/spec/v0.1.0/fixtures/wide-synthetic.csv');
async function clear() {
  const db = new LocalSupabase();
  for (const a of accounts)
    for (const table of [
      'audit_events',
      'measurements',
      'weigh_in_events',
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
test('full-panel CSV preserves all fields, unresolved raw values and inert annotations on mobile without inference', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  const calls: string[] = [];
  page.on('request', (r) => {
    if (
      r.method() === 'POST' &&
      /\/api\/(chat|approvals|executions)/.test(r.url())
    )
      calls.push(r.url());
  });
  await choose(
    page,
    readFileSync('docs/spec/v0.2.0/fixtures/renpho-v1/full-panel.csv'),
  );
  await page
    .getByLabel('Import timezone', { exact: true })
    .fill('America/New_York');
  await page
    .getByLabel('I confirm the import timezone matches this RENPHO file', {
      exact: true,
    })
    .check();
  await preview(page);
  await expect(
    page.getByRole('region', { name: 'Confirm CSV import', exact: true }),
  ).toContainText('24 new');
  await page
    .getByRole('button', { name: 'Review all import details', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: 'Import detail page', exact: true }),
  ).toContainText('-3.401942775');
  await confirm(page);
  await page
    .getByRole('region', { name: 'View imported readings', exact: true })
    .getByRole('button', { name: /^Weight · device reported/ })
    .click();
  await page
    .getByRole('button', { name: 'Inspect weigh-in', exact: true })
    .click();
  const detail = page.getByRole('region', {
    name: 'Weigh-in detail',
    exact: true,
  });
  await expect(detail.getByRole('table').getByRole('row')).toHaveCount(25);
  await expect(detail).toContainText('30.617484975');
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= window.innerWidth + 1,
    ),
  ).toBe(true);
  await detail
    .getByLabel('remarks', { exact: true })
    .fill('=1+1\n<script>synthetic-inert</script>');
  await detail
    .getByRole('button', { name: 'Review annotations', exact: true })
    .click();
  await detail
    .getByRole('button', { name: 'Confirm weigh-in change', exact: true })
    .click();
  await expect(detail).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Inspect weigh-in', exact: true })
    .click();
  await expect(detail.getByLabel('remarks', { exact: true })).toHaveValue(
    '=1+1\n<script>synthetic-inert</script>',
  );
  expect(
    await page.locator('script').filter({ hasText: 'synthetic-inert' }).count(),
  ).toBe(0);
  await detail
    .getByRole('button', { name: 'Close weigh-in', exact: true })
    .click();
  await page.getByLabel('Metric', { exact: true }).selectOption('renpho.bmr');
  await page
    .getByLabel('Method', { exact: true })
    .selectOption('device_estimate');
  await expect(page.getByRole('table')).toContainText('1500.5 kcal');
  await expect(page.getByText(/Raw values remain available/)).toBeVisible();
  expect(calls).toEqual([]);
  await page.screenshot({
    path: info.outputPath('m1-raw-mobile.png'),
    fullPage: true,
  });
});
async function choose(page: Page, buffer = canonical) {
  const dialog = page.getByRole('dialog', { name: 'Import CSV', exact: true });
  if (!(await dialog.isVisible()))
    await page.getByRole('button', { name: 'Import CSV', exact: true }).click();
  const fileInput = page.getByLabel('CSV file', { exact: true });
  await expect(fileInput).toBeEnabled();
  await fileInput.setInputFiles({
    name: 'synthetic.csv',
    mimeType: 'text/csv',
    buffer,
  });
  await expect(
    page.getByText('Selected: synthetic.csv', { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('Import source label', { exact: true })
    .fill('Synthetic imported scale');
  await page
    .getByLabel('I confirm this file contains one profile', { exact: true })
    .check();
}
async function preview(page: Page) {
  const r = page.waitForResponse(
    (r) => r.url().endsWith('/api/data') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Preview CSV', exact: true }).click();
  expect((await r).status()).toBe(200);
  await expect(
    page.getByRole('region', { name: 'Confirm CSV import', exact: true }),
  ).toBeVisible();
}
async function confirm(page: Page) {
  for (const label of [
    'Exclude invalid entries shown in the details',
    'Exclude conflicts and preserve existing values',
    'Acknowledge that populated unsupported columns will not be imported',
  ]) {
    const checkbox = page.getByLabel(label, { exact: true });
    if ((await checkbox.isVisible()) && !(await checkbox.isChecked())) {
      const response = page.waitForResponse(
        (r) => r.url().endsWith('/api/data') && r.request().method() === 'POST',
      );
      await checkbox.check();
      expect((await response).status()).toBe(200);
      await expect(checkbox).toBeEnabled();
    }
  }

  const r = page.waitForResponse(
    (r) => r.url().endsWith('/api/data') && r.request().method() === 'POST',
  );
  await page
    .getByRole('button', { name: 'Confirm import', exact: true })
    .click();
  const response = await r;
  expect(response.status()).toBe(200);
  await expect(
    page.getByRole('heading', { name: 'Import recorded', exact: true }),
  ).toBeFocused();
  return ((await response.json()) as { data: { source_id: string } }).data
    .source_id;
}
test('canonical CSV imports exactly 28 and reimport returns the historical outcome with AI disabled', async ({
  page,
}) => {
  const calls: string[] = [];
  page.on('request', (r) => {
    if (/\/api\/(chat|goals|approvals|executions)/.test(r.url()))
      calls.push(r.url());
  });
  await expect(
    page.getByRole('heading', { name: 'No measurements loaded', exact: true }),
  ).toBeVisible();
  await choose(page);
  await page
    .getByLabel('CSV source label to include', { exact: true })
    .fill('Synthetic Scale A');
  await preview(page);
  await expect(
    page.getByRole('button', { name: 'Confirm import', exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole('region', { name: 'Confirm CSV import', exact: true }),
  ).toContainText('28 new; 0 duplicates; 0 conflicts');
  const dbBeforeConfirm = new LocalSupabase();
  expect(
    await (
      await dbBeforeConfirm.admin(
        `/rest/v1/measurements?user_id=eq.${accounts[0]!.id}&select=id`,
        'GET',
      )
    ).json(),
  ).toEqual([]);
  const source = await confirm(page);
  await page
    .getByRole('region', { name: 'View imported readings', exact: true })
    .getByRole('button', { name: /^Weight · device reported/ })
    .click();
  await expect(page.getByLabel('Method', { exact: true })).toHaveValue(
    'device_reported',
  );
  await expect(page.getByLabel('From date', { exact: true })).toHaveValue(
    '2026-09-01',
  );
  await expect(page.getByLabel('Through date', { exact: true })).toHaveValue(
    '2026-09-14',
  );
  await expect(page.getByTestId('headline-value')).toHaveText('69 kg');
  await page.reload();
  await page
    .getByLabel('Method', { exact: true })
    .selectOption('device_reported');
  await page.getByLabel('From date', { exact: true }).fill('2026-09-01');
  await page.getByLabel('Through date', { exact: true }).fill('2026-09-14');
  await expect(page.getByTestId('headline-value')).toHaveText('69 kg');
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click();
  await page.getByLabel('CSV file', { exact: true }).setInputFiles({
    name: 'synthetic.csv',
    mimeType: 'text/csv',
    buffer: canonical,
  });
  await expect(
    page.getByText('Selected: synthetic.csv', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('combobox', { name: 'Import source', exact: true })
    .selectOption(source);
  await page
    .getByLabel('CSV source label to include', { exact: true })
    .fill('Synthetic Scale A');
  await page
    .getByLabel('I confirm this file contains one profile', { exact: true })
    .check();
  await page.getByRole('button', { name: 'Preview CSV', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Import recorded', exact: true }),
  ).toBeVisible();
  expect(calls).toEqual([]);
  const db = new LocalSupabase();
  expect(
    await (
      await db.admin(
        `/rest/v1/measurements?source_id=eq.${source}&select=id`,
        'GET',
      )
    ).json(),
  ).toHaveLength(28);
});
test('RENPHO CSV requires profile and timezone confirmation before preview, then commits only reviewed readings', async ({
  page,
}, info) => {
  const renpho = Buffer.concat([
    Buffer.from('\uFEFF'),
    readFileSync('docs/spec/v0.1.0/fixtures/renpho-synthetic.csv'),
  ]);
  await choose(page, renpho);
  await expect(
    page.getByRole('combobox', { name: 'CSV format', exact: true }),
  ).toHaveValue('renpho');
  await expect(
    page.getByLabel('Timestamp column', { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText('Imports supported values and annotations', {
      exact: false,
    }),
  ).toBeVisible();
  await page
    .getByLabel('Import timezone', { exact: true })
    .fill('America/New_York');
  await page.getByRole('button', { name: 'Preview CSV', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText(
    'Confirm the timezone for RENPHO',
  );
  await page
    .getByLabel('I confirm the import timezone matches this RENPHO file', {
      exact: true,
    })
    .check();
  await page
    .getByLabel('I confirm this file contains one profile', { exact: true })
    .uncheck();
  await page.getByRole('button', { name: 'Preview CSV', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('single-profile');
  await page
    .getByLabel('I confirm this file contains one profile', { exact: true })
    .check();
  await preview(page);
  const review = page.getByRole('region', {
    name: 'Confirm CSV import',
    exact: true,
  });
  await expect(review).toContainText(
    '7 new; 0 duplicates; 0 conflicts requiring review; 0 invalid; 65 blank',
  );
  await expect(review).toContainText('Ignored columns: None');
  await expect(review).toContainText('68.0388555 kg');
  await expect(review).toContainText('2026-09-01T12:00:00Z');
  await page.screenshot({
    path: info.outputPath('renpho-preview.png'),
    fullPage: true,
  });
  const db = new LocalSupabase();
  expect(
    await (
      await db.admin(
        `/rest/v1/measurements?user_id=eq.${accounts[0]!.id}&select=id`,
        'GET',
      )
    ).json(),
  ).toEqual([]);
  const hashes = await (
    await db.admin(
      `/rest/v1/import_batches?user_id=eq.${accounts[0]!.id}&select=file_hash`,
      'GET',
    )
  ).json();
  expect(hashes).toEqual([
    { file_hash: createHash('sha256').update(renpho).digest('hex') },
  ]);
  const source = await confirm(page);
  expect(
    await (
      await db.admin(
        `/rest/v1/measurements?source_id=eq.${source}&select=id`,
        'GET',
      )
    ).json(),
  ).toHaveLength(7);
  await page
    .getByRole('region', { name: 'View imported readings', exact: true })
    .getByRole('button', { name: /^Body fat .*device estimate/ })
    .click();
  await expect(page.getByLabel('Metric', { exact: true })).toHaveValue(
    'body_fat_percent',
  );
  await expect(page.getByLabel('Method', { exact: true })).toHaveValue(
    'device_estimate',
  );
  await expect(page.getByRole('table')).toContainText('20 %');
  await page.getByRole('button', { name: 'Log Reading', exact: true }).click();
  await expect(page.getByLabel('Entry source', { exact: true })).toHaveValue(
    source,
  );
  await expect(page.getByLabel('Entry metric', { exact: true })).toHaveValue(
    'body_fat_percent',
  );
  await expect(page.getByLabel('Entry unit', { exact: true })).toHaveValue('%');
});

test('RENPHO CSV refuses nonempty trailing cells instead of discarding them', async ({
  page,
}) => {
  const csv = readFileSync(
    'docs/spec/v0.1.0/fixtures/renpho-synthetic.csv',
    'utf8',
  ).replace('ignored note",', 'ignored note",nonempty');
  await choose(page, Buffer.from(csv));
  await page.getByLabel('Import timezone', { exact: true }).fill('UTC');
  await page
    .getByLabel('I confirm the import timezone matches this RENPHO file', {
      exact: true,
    })
    .check();
  await page
    .getByLabel('Import timezone', { exact: true })
    .fill('America/New_York');
  await expect(
    page.getByLabel('I confirm the import timezone matches this RENPHO file', {
      exact: true,
    }),
  ).not.toBeChecked();
  await page
    .getByLabel('I confirm the import timezone matches this RENPHO file', {
      exact: true,
    })
    .check();
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/api/data') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Preview CSV', exact: true }).click();
  expect((await response).status()).toBe(400);
  await expect(page.getByRole('alert')).toContainText(
    'terminal-column header and every value must be exactly empty',
  );
  await expect(
    page.getByRole('region', { name: 'Confirm CSV import', exact: true }),
  ).toHaveCount(0);
  const db = new LocalSupabase();
  expect(
    await (
      await db.admin(
        `/rest/v1/measurements?user_id=eq.${accounts[0]!.id}&select=id`,
        'GET',
      )
    ).json(),
  ).toEqual([]);
});

test('wide mapping exposes five exact observations, ignored columns and a missing value', async ({
  page,
}) => {
  await choose(page, wide);
  await expect(
    page.getByRole('combobox', { name: 'CSV format', exact: true }),
  ).toHaveValue('wide');
  await page
    .getByRole('combobox', { name: 'Metric for Mass (lb)', exact: true })
    .selectOption('weight');
  await page
    .getByRole('combobox', { name: 'Unit for Mass (lb)', exact: true })
    .selectOption('lb');
  await page
    .getByRole('combobox', { name: 'Method for Mass (lb)', exact: true })
    .selectOption('device_reported');
  await page
    .getByRole('combobox', { name: 'Metric for Fat (%)', exact: true })
    .selectOption('body_fat_percent');
  await page
    .getByRole('combobox', { name: 'Method for Fat (%)', exact: true })
    .selectOption('device_estimate');
  await preview(page);
  const region = page.getByRole('region', {
    name: 'Confirm CSV import',
    exact: true,
  });
  await expect(region).toContainText('5 new');
  await expect(region).toContainText('1 blank cells skipped');
  await expect(region).toContainText('Ignored columns: Notes');
  await expect(region).toContainText('68.0388555 kg');
  await confirm(page);
});

test('second-60 CSV rows are excluded visibly and the valid boundary row commits unchanged', async ({
  page,
}, info) => {
  const csv =
    'observed_at,metric,value,unit,source,granularity,timezone,method\n2026-09-01T23:59:60Z,weight,70,kg,Synthetic Scale A,instant,UTC,device_reported\n2026-09-01T23:59:59.123456Z,weight,69,kg,Synthetic Scale A,instant,UTC,device_reported';
  await choose(page, Buffer.from(csv));
  await page
    .getByLabel('CSV source label to include', { exact: true })
    .fill('Synthetic Scale A');
  await preview(page);
  const region = page.getByRole('region', {
    name: 'Confirm CSV import',
    exact: true,
  });
  await expect(region).toContainText(
    '1 new; 0 duplicates; 0 conflicts requiring review; 1 invalid',
  );
  await expect(region).toContainText('Row 2');
  await expect(region.getByRole('table')).toContainText(
    '2026-09-01T23:59:59.123456Z',
  );
  await page.screenshot({
    path: info.outputPath('second-60-csv-preview.png'),
    fullPage: true,
  });
  const source = await confirm(page);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page
    .getByLabel('Method', { exact: true })
    .selectOption('device_reported');
  await page.getByLabel('From date', { exact: true }).fill('2026-09-01');
  await page.getByLabel('Through date', { exact: true }).fill('2026-09-01');
  await expect(page.getByRole('table')).toContainText(
    '2026-09-01T23:59:59.123456+00:00',
  );
  await expect(page.getByRole('table').getByRole('row')).toHaveCount(2);
  const db = new LocalSupabase();
  expect(
    await (
      await db.admin(
        `/rest/v1/measurements?source_id=eq.${source}&select=observed_at`,
        'GET',
      )
    ).json(),
  ).toEqual([{ observed_at: '2026-09-01T23:59:59.123456+00:00' }]);
});
test('profile exclusion, invalid rows and altered values remain explicit before confirmation', async ({
  page,
}) => {
  const rows = canonical.toString().trim().split(/\r?\n/);
  const csv = [
    rows[0] + ',Profile',
    rows[1] + ',A',
    rows[2] + ',B',
    rows[1]!.replace('70.0', '71.0') + ',A',
    rows[3]!.replace('69.9', 'NaN') + ',A',
  ].join('\n');
  await choose(page, Buffer.from(csv));
  await page
    .getByLabel('CSV source label to include', { exact: true })
    .fill('Synthetic Scale A');
  await page
    .getByRole('combobox', { name: 'Profile column', exact: true })
    .selectOption('Profile');
  await page.getByLabel('Profile value to include', { exact: true }).fill('A');
  await preview(page);
  const region = page.getByRole('region', {
    name: 'Confirm CSV import',
    exact: true,
  });
  await expect(region).toContainText('2 conflicts requiring review; 1 invalid');
  await expect(region).toContainText('1 profile-excluded rows');
  await confirm(page);
  await expect(
    page.getByRole('status').filter({ hasText: 'Historical batch outcome' }),
  ).toContainText('0 inserted');
});
test('failed preview and expired commit show errors without inventing success', async ({
  page,
}) => {
  await choose(page);
  await page
    .getByLabel('CSV source label to include', { exact: true })
    .fill('Synthetic Scale A');
  await page.route('**/api/data', (route) =>
    route.request().postData()?.includes('preview_csv')
      ? route.abort()
      : route.continue(),
  );
  await page.getByRole('button', { name: 'Preview CSV', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page.unroute('**/api/data');
  await page
    .getByRole('button', { name: 'Check import status', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Preview CSV', exact: true }),
  ).toBeEnabled();
  await preview(page);
  const db = new LocalSupabase();
  await db.admin(
    `/rest/v1/import_batches?user_id=eq.${accounts[0]!.id}`,
    'PATCH',
    {
      created_at: new Date(Date.now() - 120000).toISOString(),
      expires_at: new Date(Date.now() - 60000).toISOString(),
    },
  );
  await page
    .getByRole('button', { name: 'Confirm import', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('expired');
  await expect(
    page.getByRole('heading', { name: 'Import recorded', exact: true }),
  ).toHaveCount(0);
});
test('canonical CSV imports can create a fresh preview after discarding an expired one', async ({
  page,
}) => {
  await choose(page);
  await page
    .getByLabel('CSV source label to include', { exact: true })
    .fill('Synthetic Scale A');
  await preview(page);
  const db = new LocalSupabase();
  await db.admin(
    `/rest/v1/import_batches?user_id=eq.${accounts[0]!.id}`,
    'PATCH',
    {
      created_at: new Date(Date.now() - 120000).toISOString(),
      expires_at: new Date(Date.now() - 60000).toISOString(),
    },
  );
  await page
    .getByRole('button', { name: 'Confirm import', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText('expired');
  await page
    .getByRole('button', {
      name: 'Discard preview and choose file',
      exact: true,
    })
    .click();
  await choose(page);
  await preview(page);
  await confirm(page);
});
test('account switch discards the file and pending preview', async ({
  page,
}) => {
  await choose(page);
  await page
    .getByLabel('CSV source label to include', { exact: true })
    .fill('Synthetic Scale A');
  await preview(page);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Settings', exact: true })
    .click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await signIn(page, 1);
  await page.goto('/data');
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Confirm CSV import', exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByLabel('Import source label', { exact: true }),
  ).toHaveValue('');
  await expect(page.getByLabel('CSV file', { exact: true })).toHaveValue('');
});
test('canonical CSV imports retry a lost preview reply without creating another source', async ({
  page,
}) => {
  await choose(page);
  await page
    .getByLabel('CSV source label to include', { exact: true })
    .fill('Synthetic Scale A');
  let lost = false;
  await page.route('**/api/data', async (route) => {
    if (!lost && route.request().postData()?.includes('preview_csv')) {
      lost = true;
      expect((await route.fetch()).status()).toBe(200);
      await route.abort();
    } else await route.continue();
  });
  await page.getByRole('button', { name: 'Preview CSV', exact: true }).click();
  await expect(page.getByRole('alert')).toBeVisible();
  await page
    .getByRole('button', { name: 'Check import status', exact: true })
    .click();
  await expect(
    page.getByRole('region', { name: 'Confirm CSV import', exact: true }),
  ).toBeVisible();
  await confirm(page);
  const db = new LocalSupabase();
  expect(
    await (
      await db.admin(
        `/rest/v1/data_sources?user_id=eq.${accounts[0]!.id}&select=id`,
        'GET',
      )
    ).json(),
  ).toHaveLength(1);
});
test('CSV lost commit reply reconciles the recorded result before retry or cancellation', async ({
  page,
}) => {
  await choose(page);
  await page
    .getByLabel('CSV source label to include', { exact: true })
    .fill('Synthetic Scale A');
  await preview(page);
  let lost = false;
  await page.route('**/api/data', async (route) => {
    if (!lost && route.request().postDataJSON()?.action === 'commit_import') {
      lost = true;
      expect((await route.fetch()).status()).toBe(200);
      await route.abort();
    } else await route.continue();
  });
  await page
    .getByRole('button', { name: 'Confirm import', exact: true })
    .click();
  await expect(
    page.getByRole('button', { name: 'Check import status', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', {
      name: 'Discard preview and choose file',
      exact: true,
    }),
  ).toBeDisabled();
  await expect(
    page.getByRole('heading', { name: 'Import recorded', exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole('button', { name: 'Check import status', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Import recorded', exact: true }),
  ).toBeFocused();
  await expect(
    page.getByRole('region', { name: 'View imported readings', exact: true }),
  ).toBeVisible();
  const db = new LocalSupabase();
  expect(
    await (
      await db.admin(
        `/rest/v1/measurements?user_id=eq.${accounts[0]!.id}&select=id`,
        'GET',
      )
    ).json(),
  ).toHaveLength(28);
});
test('canonical CSV imports preserve source warning text as inert data', async ({
  page,
}) => {
  const lines = canonical.toString().trim().split(/\r?\n/);
  await choose(
    page,
    Buffer.from(
      lines[0] +
        ',quality_flags\n' +
        lines[1] +
        ',<script>synthetic-warning</script>',
    ),
  );
  await page
    .getByLabel('CSV source label to include', { exact: true })
    .fill('Synthetic Scale A');
  await preview(page);
  await confirm(page);
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page
    .getByLabel('Method', { exact: true })
    .selectOption('device_reported');
  await page.getByLabel('From date', { exact: true }).fill('2026-09-01');
  await page.getByLabel('Through date', { exact: true }).fill('2026-09-14');
  await expect(page.getByRole('table')).toContainText(
    '<script>synthetic-warning</script>',
  );
  expect(
    await page
      .locator('script')
      .filter({ hasText: 'synthetic-warning' })
      .count(),
  ).toBe(0);
});
for (const action of ['preview_csv', 'commit_import'])
  test(`account change discards late ${action} completion`, async ({
    page,
  }) => {
    await choose(page);
    await page
      .getByLabel('CSV source label to include', { exact: true })
      .fill('Synthetic Scale A');
    if (action === 'commit_import') await preview(page);
    let release!: () => void;
    const barrier = new Promise<void>((resolve) => {
      release = resolve;
    });
    let reached!: () => void;
    const started = new Promise<void>((resolve) => {
      reached = resolve;
    });
    let intercepted = false;
    await page.route('**/api/data', async (route) => {
      if (intercepted || !route.request().postData()?.includes(action)) {
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
        /* Account switching may abort the obsolete request. */
      }
    });
    try {
      await page
        .getByRole('button', {
          name: action === 'preview_csv' ? 'Preview CSV' : 'Confirm import',
          exact: true,
        })
        .click();
      await started;
      await page.getByRole('button', { name: 'Close', exact: true }).click();
      await page
        .getByRole('navigation')
        .getByRole('link', { name: 'Settings', exact: true })
        .click();
      await page.getByRole('button', { name: 'Sign out', exact: true }).click();
      await signIn(page, 1);
      await page.goto('/data');
      release();
      await expect(
        page.getByRole('heading', {
          name: 'No measurements loaded',
          exact: true,
        }),
      ).toBeVisible();
      await page
        .getByRole('button', { name: 'Import CSV', exact: true })
        .click();
      await expect(
        page.getByLabel('Import source label', { exact: true }),
      ).toHaveValue('');
      await expect(
        page.getByRole('region', { name: 'Confirm CSV import', exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole('heading', { name: 'Import recorded', exact: true }),
      ).toHaveCount(0);
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
    test(`CSV ${width}x${height} ${colorScheme}: review layout and 200% text`, async ({
      page,
    }, info) => {
      await page.setViewportSize({ width: width!, height: height! });
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await choose(page);
      await page
        .getByLabel('CSV source label to include', { exact: true })
        .fill('Synthetic Scale A');
      await preview(page);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath('import-preview.png'),
        fullPage: true,
      });
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await expect(
        page.getByRole('button', { name: 'Confirm import', exact: true }),
      ).toBeVisible();
      await page.screenshot({
        path: info.outputPath('import-zoom.png'),
        fullPage: true,
      });
    });

import { readFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { accounts, restrictNetwork } from './auth-helpers';
import { LocalSupabase } from '../helpers/local-supabase';

test.skip(
  process.env.VULPES_TEST_MODE === 'dev_proof',
  'Production worker acceptance runs against the compiled candidate.',
);
const full = readFileSync(
  'docs/spec/v0.2.0/fixtures/renpho-v1/full-panel.csv',
  'utf8',
);
const small = 'Date,Time,Weight(lb)\n2026.09.01,08:00:00,150\n';
const db = new LocalSupabase();
async function clear() {
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
async function rows(table: string) {
  return (
    await db.admin(
      `/rest/v1/${table}?user_id=eq.${accounts[0]!.id}&select=id`,
      'GET',
    )
  ).json();
}
async function loginHere(page: Page, index = 0) {
  await page.getByLabel('Email', { exact: true }).fill(accounts[index]!.email);
  await page
    .getByLabel('Password', { exact: true })
    .fill(accounts[index]!.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
}
async function share(page: Page, csv = small) {
  await page.evaluate((csv) => {
    const form = document.createElement('form');
    form.action = '/api/share-target';
    form.method = 'POST';
    form.enctype = 'multipart/form-data';
    const input = document.createElement('input');
    input.type = 'file';
    input.name = 'files';
    const data = new DataTransfer();
    data.items.add(new File([csv], 'synthetic.csv', { type: 'text/csv' }));
    input.files = data.files;
    form.append(input);
    document.body.append(form);
    form.requestSubmit();
  }, csv);
  await page.waitForURL(/\/(?:login|data\/import)/);
}
async function setupPreview(page: Page) {
  await page
    .getByLabel('Import source label', { exact: true })
    .fill('Synthetic shared scale');
  await page
    .getByLabel('Import timezone', { exact: true })
    .fill('America/New_York');
  await page
    .getByLabel('I confirm this file contains one profile', { exact: true })
    .check();
  await page
    .getByLabel('I confirm the import timezone matches this RENPHO file', {
      exact: true,
    })
    .check();
  await page.getByRole('button', { name: 'Preview CSV', exact: true }).click();
  await expect(
    page.getByRole('region', { name: 'Confirm CSV import', exact: true }),
  ).toBeVisible();
}
async function localCounts(page: Page) {
  return page.evaluate(async () => {
    const request = indexedDB.open('vulpes-import-handoff', 1);
    const database = await new Promise<IDBDatabase>((resolve) => {
      request.onsuccess = () => resolve(request.result);
    });
    const values = await Promise.all(
      ['files', 'operations'].map(
        (store) =>
          new Promise<number>((resolve) => {
            const read = database.transaction(store).objectStore(store).count();
            read.onsuccess = () => resolve(read.result);
          }),
      ),
    );
    database.close();
    return values;
  });
}

test.beforeEach(async ({ page }) => {
  await clear();
  await restrictNetwork(page);
  await page.goto('/offline.html');
  await page.evaluate(async () => {
    await navigator.serviceWorker.register('/sw.js', { type: 'module' });
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect
    .poll(() => page.evaluate(() => !!navigator.serviceWorker.controller))
    .toBe(true);
});
test.afterEach(clear);

test('signed-out share requires account confirmation, preserves the full panel and reuses saved settings without inference', async ({
  page,
}) => {
  const previews: string[] = [],
    inference: string[] = [];
  page.on('request', (r) => {
    if (
      r.method() === 'POST' &&
      r.url().endsWith('/api/data') &&
      r.postData()?.includes('preview_csv')
    )
      previews.push(r.url());
    if (/\/api\/(chat|executions|approvals)/.test(r.url()))
      inference.push(r.url());
  });
  await share(page, full);
  await expect(
    page.getByRole('heading', { name: 'Sign in to Vulpes' }),
  ).toBeVisible();
  expect(previews).toHaveLength(0);
  await loginHere(page);
  await expect(
    page.getByRole('heading', { name: 'File received, not imported' }),
  ).toBeVisible();
  expect(previews).toHaveLength(0);
  expect(await rows('measurements')).toEqual([]);
  await page
    .getByRole('button', { name: 'Use this account and preview' })
    .click();
  await setupPreview(page);
  expect(await rows('measurements')).toEqual([]);
  expect(await localCounts(page)).toEqual([0, 1]);
  await page
    .getByRole('button', { name: 'Confirm import', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Import recorded', exact: true }),
  ).toBeVisible();
  expect(await rows('measurements')).toHaveLength(24);
  expect(await rows('weigh_in_events')).toHaveLength(1);
  expect(await localCounts(page)).toEqual([0, 0]);
  await share(page, full);
  await expect(
    page.getByRole('heading', { name: 'File received, not imported' }),
  ).toBeVisible();
  expect(previews).toHaveLength(1);
  await page
    .getByRole('button', { name: 'Use this account and preview' })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Import recorded', exact: true }),
  ).toBeVisible();
  expect(await rows('measurements')).toHaveLength(24);
  expect(await rows('data_sources')).toHaveLength(1);
  expect(inference).toEqual([]);
});

test('reload restores the exact reviewed mapping and a lost commit reply resolves by owned status', async ({
  page,
}) => {
  await share(page);
  await loginHere(page);
  await page
    .getByRole('button', { name: 'Use this account and preview' })
    .click();
  await setupPreview(page);
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await page.getByRole('button', { name: 'Check import status' }).click();
  const review = page.getByRole('region', {
    name: 'Confirm CSV import',
    exact: true,
  });
  await expect(review).toContainText('America/New_York');
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
    page.getByRole('button', { name: 'Check import status' }),
  ).toBeVisible();
  page.once('dialog', (dialog) => dialog.accept());
  await page.reload();
  await page.getByRole('button', { name: 'Check import status' }).click();
  await expect(
    page.getByRole('heading', { name: 'Import recorded', exact: true }),
  ).toBeVisible();
  expect(await rows('measurements')).toHaveLength(1);
  expect(await localCounts(page)).toEqual([0, 0]);
});

test('another tab cannot claim a bound file and logout clears all pending bytes and locators', async ({
  page,
}) => {
  await share(page);
  await loginHere(page);
  await page
    .getByRole('button', { name: 'Use this account and preview' })
    .click();
  await expect(page.getByLabel('CSV file', { exact: true })).toBeEnabled();
  const opened = page.waitForEvent('popup');
  await page.evaluate(() => window.open('/data/import', '_blank'));
  const other = await opened;
  await restrictNetwork(other);
  await other
    .getByRole('button', { name: 'Use this account and preview' })
    .click();
  await expect(other.getByRole('alert')).toContainText('another Vulpes window');
  expect(await rows('import_batches')).toEqual([]);
  await other.getByRole('link', { name: 'Settings', exact: true }).click();
  await other.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect.poll(() => localCounts(other)).toEqual([0, 0]);
  await expect(
    page.getByRole('heading', { name: 'Sign in to Vulpes' }),
  ).toBeVisible();
  await loginHere(other, 1);
  await other.goto('/data/import');
  await expect(
    other.getByRole('heading', { name: 'File received, not imported' }),
  ).toHaveCount(0);
  expect(await rows('measurements')).toEqual([]);
});

test('expiry on claim rejects a received file before cleanup and cancellation keeps the picker available', async ({
  page,
}) => {
  await share(page);
  await loginHere(page);
  await expect(
    page.getByRole('heading', { name: 'File received, not imported' }),
  ).toBeVisible();
  await page.evaluate(async () => {
    const request = indexedDB.open('vulpes-import-handoff', 1);
    const database = await new Promise<IDBDatabase>((resolve) => {
      request.onsuccess = () => resolve(request.result);
    });
    await new Promise<void>((resolve) => {
      const tx = database.transaction('files', 'readwrite');
      const store = tx.objectStore('files');
      const read = store.get('active');
      read.onsuccess = () =>
        store.put({ ...read.result, expiresAt: Date.now() }, 'active');
      tx.oncomplete = () => resolve();
    });
    database.close();
  });
  await page
    .getByRole('button', { name: 'Use this account and preview' })
    .click();
  await expect(page.getByRole('alert')).toContainText('expired');
  expect(await rows('import_batches')).toEqual([]);
  await page.getByRole('button', { name: 'Discard received file' }).click();
  await expect(page.getByLabel('CSV file', { exact: true })).toBeEnabled();
  expect(await localCounts(page)).toEqual([0, 0]);
});

test('the same tab can reload a claimed file before preview without waiting for its lease', async ({
  page,
}) => {
  await share(page);
  await loginHere(page);
  await page
    .getByRole('button', { name: 'Use this account and preview' })
    .click();
  await expect(
    page.getByText('Selected: synthetic.csv', { exact: true }),
  ).toBeVisible();
  await page.reload();
  await page
    .getByRole('button', { name: 'Use this account and preview' })
    .click();
  await expect(
    page.getByText('Selected: synthetic.csv', { exact: true }),
  ).toBeVisible();
  expect(await rows('import_batches')).toEqual([]);
});

test('backend loss retains local receipt and reconnecting does not preview automatically', async ({
  page,
}) => {
  await share(page);
  await loginHere(page);
  await expect(
    page.getByRole('heading', { name: 'File received, not imported' }),
  ).toBeVisible();
  await page.route('**/api/data?*', (route) => route.abort());
  await page.reload();
  await expect(
    page.getByRole('button', { name: 'Retry source settings' }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Use this account and preview' }),
  ).toBeDisabled();
  expect(await rows('import_batches')).toEqual([]);
  await page.unroute('**/api/data?*');
  await page.getByRole('button', { name: 'Retry source settings' }).click();
  await expect(
    page.getByRole('button', { name: 'Use this account and preview' }),
  ).toBeEnabled();
  expect(await rows('import_batches')).toEqual([]);
  await page.getByRole('button', { name: 'Discard received file' }).click();
  expect(await localCounts(page)).toEqual([0, 0]);
});

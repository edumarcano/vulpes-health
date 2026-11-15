import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
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

test('built receiver preserves exact bytes privately and refuses a second share', async ({
  page,
}) => {
  const result = await page.evaluate(async () => {
    const body = new FormData();
    body.append(
      'files',
      new File(
        ['Date,Time,Weight(lb)\r\n2026.09.01,08:00:00,150\r\n'],
        'synthetic.csv',
        { type: 'text/csv' },
      ),
    );
    const first = await fetch('/api/share-target', {
      method: 'POST',
      body,
      redirect: 'manual',
    });
    const request = indexedDB.open('vulpes-import-handoff', 1);
    const db = await new Promise<IDBDatabase>((resolve) => {
      request.onsuccess = () => resolve(request.result);
    });
    const tx = db.transaction('files');
    const read = tx.objectStore('files').get('active');
    const file = await new Promise<{
      body: Blob;
      name: string;
      owner: null;
      expiresAt: number;
      receivedAt: number;
    }>((resolve) => {
      read.onsuccess = () => resolve(read.result);
    });
    const text = await file.body.text();
    db.close();
    const second = await fetch('/api/share-target', { method: 'POST', body });
    const cacheKeys = (
      await Promise.all(
        (await caches.keys()).map(async (key) =>
          (await (await caches.open(key)).keys()).map((r) => r.url),
        ),
      )
    ).flat();
    return {
      first: first.type,
      text,
      name: file.name,
      owner: file.owner,
      lifetime: file.expiresAt - file.receivedAt,
      second: second.status,
      cacheKeys,
    };
  });
  expect(result.first).toBe('opaqueredirect');
  expect(result.text).toBe(
    'Date,Time,Weight(lb)\r\n2026.09.01,08:00:00,150\r\n',
  );
  expect(result.owner).toBeNull();
  expect(result.lifetime).toBe(900000);
  expect(result.second).toBe(400);
  expect(
    result.cacheKeys.every(
      (key) =>
        !key.includes('/api/') &&
        !key.includes('handoff') &&
        !key.includes('synthetic'),
    ),
  ).toBe(true);
});

test('malformed shares create no pending file', async ({ page }) => {
  const statuses = await page.evaluate(async () => {
    const results: number[] = [];
    for (const kind of ['empty', 'text', 'multiple', 'wrong', 'oversize']) {
      const body = new FormData();
      if (kind === 'text') body.append('text', 'Synthetic private canary');
      if (kind !== 'empty' && kind !== 'text')
        body.append(
          'files',
          new File(
            [kind === 'oversize' ? new Uint8Array(1048577) : 'x'],
            kind === 'wrong' ? 'x.pdf' : 'x.csv',
            { type: kind === 'wrong' ? 'application/pdf' : 'text/csv' },
          ),
        );
      if (kind === 'multiple') body.append('files', new File(['x'], 'y.csv'));
      results.push(
        (await fetch('/api/share-target', { method: 'POST', body })).status,
      );
    }
    return results;
  });
  expect(statuses).toEqual([400, 400, 400, 400, 413]);
});

test('offline receipt stays local and cold navigation shows a data-free recovery page', async ({
  page,
  context,
}) => {
  await context.setOffline(true);
  const received = await page.evaluate(async () => {
    const body = new FormData();
    body.append(
      'files',
      new File(
        ['Date,Time,Weight(lb)\n2026.09.01,08:00:00,150'],
        'synthetic.csv',
        { type: 'text/csv' },
      ),
    );
    return (
      await fetch('/api/share-target', {
        method: 'POST',
        body,
        redirect: 'manual',
      })
    ).type;
  });
  expect(received).toBe('opaqueredirect');
  await page.goto('/data/import');
  await expect(
    page.getByRole('heading', { name: 'Import needs a connection' }),
  ).toBeVisible();
  await expect(page.locator('body')).toContainText('It has not been imported');
  expect(await page.locator('script').count()).toBe(0);
  await context.setOffline(false);
  await page.getByRole('link', { name: 'Return to import' }).click();
  await expect(
    page.getByRole('heading', { name: 'Sign in to Vulpes' }),
  ).toBeVisible();
});

test('a new worker waits while the current page and received file remain intact', async ({
  page,
}) => {
  await page.goto('/login');
  const original = await page.evaluate(
    () => navigator.serviceWorker.controller!.scriptURL,
  );
  await page.evaluate(async () => {
    const body = new FormData();
    body.append(
      'files',
      new File(['synthetic'], 'synthetic.csv', { type: 'text/csv' }),
    );
    await fetch('/api/share-target', {
      method: 'POST',
      body,
      redirect: 'manual',
    });
    await navigator.serviceWorker.register('/sw.js?candidate=next', {
      type: 'module',
    });
  });
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await navigator.serviceWorker.getRegistration())?.waiting?.state,
      ),
    )
    .toBe('installed');
  expect(
    await page.evaluate(() => navigator.serviceWorker.controller!.scriptURL),
  ).toBe(original);
  await expect(
    page.getByRole('status').filter({ hasText: 'A Vulpes update is ready' }),
  ).toBeVisible();
  const count = await page.evaluate(async () => {
    const open = indexedDB.open('vulpes-import-handoff', 1);
    const database = await new Promise<IDBDatabase>((resolve) => {
      open.onsuccess = () => resolve(open.result);
    });
    const count = await new Promise<number>((resolve) => {
      const read = database.transaction('files').objectStore('files').count();
      read.onsuccess = () => resolve(read.result);
    });
    database.close();
    return count;
  });
  expect(count).toBe(1);
});

for (const size of [1048575, 1048576, 1048577])
  test(`handoff file-byte boundary: ${size}`, async ({ page }) => {
    const result = await page.evaluate(async (size) => {
      const body = new FormData();
      body.append(
        'files',
        new File([new Uint8Array(size)], 'synthetic.csv', { type: 'text/csv' }),
      );
      const response = await fetch('/api/share-target', {
        method: 'POST',
        body,
        redirect: 'manual',
      });
      return { type: response.type, status: response.status };
    }, size);
    if (size <= 1048576) expect(result.type).toBe('opaqueredirect');
    else expect(result.status).toBe(413);
  });

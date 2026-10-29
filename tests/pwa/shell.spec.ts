import { expect, test } from '@playwright/test';

test('built worker caches only public assets and gives private routes a data-free offline page', async ({ page, context }, info) => {
  await context.route('**/*', route => {
    const url = new URL(route.request().url());
    return url.origin === 'http://127.0.0.1:4175' ? route.continue() : route.abort();
  });
  await page.goto('/offline.html');
  await page.evaluate(async () => {
    await caches.open('vulpes-static-obsolete');
    await navigator.serviceWorker.register('/sw.js');
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  const results = await page.evaluate(async () => {
    for (const url of ['/api/data', '/api/conversations', '/api/executions?view=payload', '/auth/callback', '/login', '/offline.html?private=synthetic']) {
      await fetch(url).catch(() => undefined);
    }
    await fetch('/offline.html', { method: 'POST', body: 'synthetic private text' }).catch(() => undefined);
    const names = await caches.keys();
    const urls = (await Promise.all(names.map(async name => (await (await caches.open(name)).keys()).map(request => request.url)))).flat();
    return { names, urls };
  });
  expect(results.names).toHaveLength(1);
  expect(results.names[0]).toMatch(/^vulpes-static-/);
  expect(results.urls.length).toBeGreaterThan(8);
  expect(results.urls.every(value => {
    const url = new URL(value);
    return !url.search && /^(?:\/assets\/[\w.-]+\.(?:js|css)|\/offline\.(?:html|css)|\/manifest.webmanifest|\/(?:brand|icons)\/[\w.-]+\.png)$/.test(url.pathname);
  })).toBe(true);
  await context.setOffline(true);
  await page.goto('/ask?conversation=synthetic-private-id');
  await expect(page.getByRole('heading', { name: "You're offline" })).toBeVisible();
  await expect(page.locator('body')).not.toContainText('synthetic-private-id');
  expect(await page.locator('script').count()).toBe(0);
  for (const path of ['/api/data', '/api/chat', '/auth/callback', '/login']) {
    expect(await page.evaluate(url => fetch(url).then(() => 'response', () => 'offline'), path)).toBe('offline');
  }
  for (const scheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme: scheme, reducedMotion: 'reduce' });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(page.getByRole('link', { name: 'Try again' })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`offline-${scheme}.png`), fullPage: true });
  }
});

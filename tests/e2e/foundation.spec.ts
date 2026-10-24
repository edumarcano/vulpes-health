import { expect, test } from '@playwright/test';

test.beforeEach(async ({ context, page }) => {
  await context.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === 'http:' && url.hostname === '127.0.0.1') await route.continue();
    else { await route.abort(); throw new Error(`Unexpected external request to ${url.hostname}`); }
  });
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      document.documentElement.dataset.cspViolation = event.violatedDirective;
    });
  });
});

for (const colorScheme of ['light', 'dark'] as const) {
  for (const [width, height] of [[360, 800], [390, 844], [430, 932], [768, 1024], [1440, 900]]) {
    test(`${width}x${height} ${colorScheme}: all screens and approved branding`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width: width!, height: height! });
      await page.emulateMedia({ colorScheme });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      for (const [route, heading] of [['/ask', 'Ask Vulpes'], ['/goals', 'Goals'], ['/data', 'Data'], ['/settings', 'Settings']]) {
        await page.goto(route!);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(heading!);
        await expect(page.getByRole('navigation', { name: 'Primary' }).getByRole('link')).toHaveCount(4);
        const logo = page.locator('.brand-link img:visible');
        await expect(logo).toBeVisible();
        expect(await logo.evaluate((image: HTMLImageElement) => image.complete && image.naturalWidth === 3200)).toBe(true);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
        expect(await page.locator('html').getAttribute('data-csp-violation')).toBeNull();
        await page.screenshot({ path: testInfo.outputPath(`${route!.slice(1)}.png`), fullPage: true });
      }
      expect(errors).toEqual([]);
    });
  }
}

test('root, deep links, unknown pages, and navigation focus', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveURL('/ask');
  await page.getByRole('navigation').getByRole('link', { name: 'Goals' }).click();
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await expect(page.getByRole('navigation').getByRole('link', { name: 'Goals' })).toHaveAttribute('aria-current', 'page');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Goals');
  for (const path of ['/login', '/auth/callback']) {
    await page.goto(path);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Sign-in unavailable');
    await expect(page.getByRole('textbox')).toHaveCount(0);
  }
  await page.goto('/ask/unknown');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Page not found');
});

test('keyboard, skip link, reduced motion, and 200% text sizing', async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/ask');
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Explore Data' })).toBeFocused();
  expect(await page.getByRole('link', { name: 'Explore Data' }).evaluate((element) => getComputedStyle(element).outlineStyle)).not.toBe('none');
  await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.getByRole('link', { name: 'Explore Data' })).toBeVisible();
  expect(await page.getByRole('link', { name: 'Explore Data' }).evaluate((element) => getComputedStyle(element).transitionDuration)).toBe('0s');
});

test('chat stays disabled and navigation stores no private data or service worker', async ({ page }) => {
  const mutations: string[] = [];
  page.on('request', (request) => { if (request.method() !== 'GET') mutations.push(request.url()); });
  await page.goto('/ask');
  await expect(page.getByRole('textbox', { name: 'Message Ask Vulpes' })).toBeDisabled();
  await expect(page.getByRole('button', { name: /send|regenerate|edit/i })).toHaveCount(0);
  await page.getByRole('link', { name: 'Explore Data' }).click();
  await expect(page.getByRole('heading', { name: 'No measurements loaded', exact: true })).toBeVisible();
  await page.getByRole('navigation').getByRole('link', { name: 'Settings' }).click();
  await expect(page.getByRole('status')).toHaveText('Local API is responding.');
  expect(await page.evaluate(() => ({ local: localStorage.length, session: sessionStorage.length }))).toEqual({ local: 0, session: 0 });
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length)).toBe(0);
  expect(await page.evaluate(async () => (await caches.keys()).length)).toBe(0);
  expect(mutations).toEqual([]);
});

test('Settings reports interrupted API access honestly', async ({ page }) => {
  await page.route('**/api/status', (route) => route.abort());
  await page.goto('/settings');
  await expect(page.getByRole('status')).toHaveText('Local API unavailable. Check that the full local stack is running.');
});

test('built HTTP surface preserves JSON errors and security headers', async ({ request }) => {
  for (const [path, method, expectedStatus] of [
    ['/api/status', 'GET', 200], ['/api/status', 'POST', 405], ['/api', 'GET', 404],
    ['/api/chat', 'POST', 404], ['/api/unknown', 'GET', 404], ['/api/status?__vulpes_unmatched=1', 'GET', 404],
  ] as const) {
    const response = await request.fetch(path, { method });
    expect(response.status()).toBe(expectedStatus);
    expect(response.headers()['content-type']).toContain('application/json');
    expect(response.headers()['cache-control']).toBe('no-store');
    expect((await response.json() as { request_id: string }).request_id).toMatch(/^[0-9a-f-]{36}$/);
  }
  const shell = await request.get('/ask');
  expect(shell.headers()['content-security-policy']).toContain("script-src 'self';");
  expect(shell.headers()['content-security-policy']).not.toContain('unsafe-eval');
  expect(shell.headers()['x-content-type-options']).toBe('nosniff');
});

test('dark navigation and card accent text meet normal-text contrast', async ({ page }) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/ask');
  const ratios = await page.locator('.nav-link.active, .welcome-card .eyebrow').evaluateAll((elements) => {
    function luminance(rgb: string): number {
      const values = rgb.match(/[\d.]+/g)!.slice(0, 3).map(Number).map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
    }
    return elements.map((element) => {
      const style = getComputedStyle(element);
      let background: Element | null = element;
      while (background && getComputedStyle(background).backgroundColor === 'rgba(0, 0, 0, 0)') background = background.parentElement;
      const foreground = luminance(style.color);
      const surface = luminance(getComputedStyle(background!).backgroundColor);
      return (Math.max(foreground, surface) + 0.05) / (Math.min(foreground, surface) + 0.05);
    });
  });
  expect(ratios).toHaveLength(2);
  for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
});

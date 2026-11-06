import { expect, test } from '@playwright/test';
import { restrictNetwork, signIn } from './auth-helpers';

test.beforeEach(async ({ page }) => {
  await restrictNetwork(page);
  await page.addInitScript(() => {
    document.addEventListener('securitypolicyviolation', (event) => {
      document.documentElement.dataset.cspViolation = event.violatedDirective;
    });
  });
  await signIn(page);
});

for (const colorScheme of ['light', 'dark'] as const) {
  for (const [width, height] of [
    [360, 800],
    [390, 844],
    [430, 932],
    [768, 1024],
    [1440, 900],
  ]) {
    test(`${width}x${height} ${colorScheme}: all screens and approved branding`, async ({
      page,
    }, testInfo) => {
      await page.setViewportSize({ width: width!, height: height! });
      await page.emulateMedia({ colorScheme });
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      for (const [route, heading] of [
        ['/ask', 'Ask Vulpes'],
        ['/goals', 'Goals'],
        ['/data', 'Data'],
        ['/settings', 'Settings'],
      ]) {
        await page.goto(route!);
        await expect(page.getByRole('heading', { level: 1 })).toHaveText(
          heading!,
        );
        await expect(
          page.getByRole('navigation', { name: 'Primary' }).getByRole('link'),
        ).toHaveCount(4);
        const logo = page.locator('.brand-link img:visible');
        await expect(logo).toBeVisible();
        expect(
          await logo.evaluate(
            (image: HTMLImageElement) =>
              image.complete &&
              image.naturalWidth === 2945 &&
              image.naturalHeight === 940,
          ),
        ).toBe(true);
        expect(
          await page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        ).toBe(true);
        expect(
          await page.locator('html').getAttribute('data-csp-violation'),
        ).toBeNull();
        await page.screenshot({
          path: testInfo.outputPath(`${route!.slice(1)}.png`),
          fullPage: true,
        });
        if (route === '/settings') {
          await expect(
            page.getByLabel('Timezone', { exact: true }),
          ).toBeVisible();
          await page.evaluate(() => {
            document.documentElement.style.fontSize = '200%';
          });
          expect(
            await page.evaluate(
              () => document.documentElement.scrollWidth <= innerWidth,
            ),
          ).toBe(true);
          await page
            .getByRole('button', { name: 'Save profile', exact: true })
            .scrollIntoViewIfNeeded();
          await expect(
            page.getByRole('button', { name: 'Save profile', exact: true }),
          ).toBeInViewport();
          await page.screenshot({
            path: testInfo.outputPath('settings-zoom.png'),
            fullPage: true,
          });
        }
      }
      expect(errors).toEqual([]);
    });
  }
}

test('root, deep links, unknown pages, and navigation focus', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page).toHaveURL('/ask');
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Goals' })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toBeFocused();
  await expect(
    page.getByRole('navigation').getByRole('link', { name: 'Goals' }),
  ).toHaveAttribute('aria-current', 'page');
  await page.reload();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Goals');
  await page.goto('/login');
  await expect(page).toHaveURL('/ask');
  await page.goto('/auth/callback');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Page not found',
  );
  await page.goto('/ask/unknown');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Page not found',
  );
});

test('keyboard, skip link, reduced motion, and 200% text sizing', async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 800 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/ask');
  await expect(
    page.getByRole('heading', { name: 'Ask Vulpes', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('link', { name: 'Skip to content' }),
  ).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('main')).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'Conversation history', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(
    page.getByRole('button', { name: 'New conversation', exact: true }),
  ).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Explore Data' })).toBeFocused();
  expect(
    await page
      .getByRole('link', { name: 'Explore Data' })
      .evaluate((element) => getComputedStyle(element).outlineStyle),
  ).not.toBe('none');
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await expect(page.getByRole('link', { name: 'Explore Data' })).toBeVisible();
  expect(
    await page
      .getByRole('link', { name: 'Explore Data' })
      .evaluate((element) => getComputedStyle(element).transitionDuration),
  ).toBe('0s');
});

test('chat stays disabled and navigation stores only the auth session', async ({
  page,
}) => {
  const mutations: string[] = [];
  page.on('request', (request) => {
    if (request.method() !== 'GET') mutations.push(request.url());
  });
  await page.goto('/ask');
  await expect(
    page.getByRole('textbox', { name: 'Message Ask Vulpes' }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: 'Send', exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole('button', { name: /regenerate|edit/i }),
  ).toHaveCount(0);
  await page.getByRole('link', { name: 'Explore Data' }).click();
  await expect(
    page.getByRole('heading', { name: 'No measurements loaded', exact: true }),
  ).toBeVisible();
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Settings' })
    .click();
  await expect(page.getByLabel('Timezone', { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() =>
      Object.keys(localStorage).every((key) =>
        key.startsWith('vulpes.auth.session.v1'),
      ),
    ),
  ).toBe(true);
  expect(await page.evaluate(() => sessionStorage.length)).toBe(0);
  const cached = await page.evaluate(async () =>
    (
      await Promise.all(
        (await caches.keys()).map(async (name) =>
          (await (await caches.open(name)).keys()).map(
            (request) => new URL(request.url).pathname,
          ),
        ),
      )
    ).flat(),
  );
  expect(
    cached.every((path) =>
      /^(?:\/assets\/|\/brand\/|\/icons\/|\/offline\.(?:html|css)$|\/manifest.webmanifest$)/.test(
        path,
      ),
    ),
  ).toBe(true);
  expect(mutations).toEqual([]);
});

test('Settings reports interrupted API access honestly', async ({ page }) => {
  await page.route('**/api/settings', (route) => route.abort());
  await page.goto('/settings');
  await expect(page.getByRole('alert')).toContainText(
    'Your settings could not be loaded.',
  );
});

test('Settings rejects a malformed settings envelope through the shared schema', async ({
  page,
}) => {
  await page.route('**/api/settings', (route) =>
    route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ data: { status: 'ok' } }),
    }),
  );
  await page.goto('/settings');
  await expect(page.getByRole('alert')).toContainText(
    'Your settings could not be loaded.',
  );
});

test('built HTTP surface preserves JSON errors and security headers', async ({
  request,
}) => {
  for (const [path, method, expectedStatus] of [
    ['/api/status', 'GET', 200],
    ['/api/status', 'POST', 405],
    ['/api', 'GET', 404],
    ['/api/chat', 'POST', 401],
    ['/api/conversations', 'GET', 401],
    ['/api/unknown', 'GET', 404],
    ['/api/status?__vulpes_unmatched=1', 'GET', 404],
  ] as const) {
    const response = await request.fetch(path, { method });
    expect(response.status()).toBe(expectedStatus);
    expect(response.headers()['content-type']).toContain('application/json');
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(
      ((await response.json()) as { request_id: string }).request_id,
    ).toMatch(/^[0-9a-f-]{36}$/);
  }
  const shell = await request.get('/ask');
  expect(shell.headers()['content-security-policy']).toContain(
    "script-src 'self';",
  );
  expect(shell.headers()['content-security-policy']).not.toContain(
    'unsafe-eval',
  );
  expect(shell.headers()['x-content-type-options']).toBe('nosniff');
});

test('dark navigation and card accent text meet normal-text contrast', async ({
  page,
}) => {
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/ask');
  await expect(
    page.getByRole('heading', { name: 'Ask Vulpes', exact: true }),
  ).toBeVisible();
  const ratios = await page
    .locator('.nav-link.active')
    .evaluateAll((elements) => {
      function luminance(rgb: string): number {
        const values = rgb
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((value) => {
            const channel = value / 255;
            return channel <= 0.04045
              ? channel / 12.92
              : ((channel + 0.055) / 1.055) ** 2.4;
          });
        return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722;
      }
      return elements.map((element) => {
        const style = getComputedStyle(element);
        let background: Element | null = element;
        while (
          background &&
          getComputedStyle(background).backgroundColor === 'rgba(0, 0, 0, 0)'
        )
          background = background.parentElement;
        const foreground = luminance(style.color);
        const surface = luminance(
          getComputedStyle(background!).backgroundColor,
        );
        return (
          (Math.max(foreground, surface) + 0.05) /
          (Math.min(foreground, surface) + 0.05)
        );
      });
    });
  expect(ratios).toHaveLength(1);
  for (const ratio of ratios) expect(ratio).toBeGreaterThanOrEqual(4.5);
});

test('deferred page loading keeps navigation available and focuses the loaded heading', async ({
  page,
}) => {
  let release!: () => void;
  const blocked = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route('**/assets/data-page-*.js', async (route) => {
    await blocked;
    await route.continue();
  });
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Data', exact: true })
    .click();
  try {
    await expect(page.getByRole('status')).toHaveText('Loading page…');
    await expect(
      page.getByRole('navigation', { name: 'Primary' }),
    ).toBeVisible();
  } finally {
    release();
  }
  await expect(
    page.getByRole('heading', { level: 1, name: 'Data', exact: true }),
  ).toBeFocused();
});

test('failed page download offers reload without losing navigation', async ({
  page,
}) => {
  await page.route('**/assets/settings-page-*.js', (route) => route.abort());
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Settings', exact: true })
    .click();
  await expect(page.getByRole('alert')).toContainText(
    'This page could not be loaded.',
  );
  await expect(page.getByRole('button', { name: 'Reload page' })).toBeVisible();
  await page
    .getByRole('navigation')
    .getByRole('link', { name: 'Ask', exact: true })
    .click();
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(
    'Ask Vulpes',
  );
});

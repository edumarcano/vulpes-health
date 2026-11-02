import { expect, test, type Page } from '@playwright/test';
import { restrictNetwork, signIn } from './auth-helpers';

test('mobile restored route retains the Ask Vulpes document title', async ({
  page,
}) => {
  await restrictNetwork(page);
  await signIn(page);
  await page.reload();
  await expect(
    page.getByRole('heading', { name: 'Ask Vulpes', exact: true }),
  ).toBeVisible();
  await expect(page).toHaveTitle('Ask Vulpes · Vulpes');
});

async function answer(page: Page) {
  await restrictNetwork(page);
  await signIn(page, 2);
  const created = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/conversations') &&
      response.request().postDataJSON()?.action === 'create',
  );
  await page
    .getByRole('button', { name: 'New conversation', exact: true })
    .click();
  const id = (await (await created).json()).data.id;
  await expect(page).toHaveURL(new RegExp(`conversation=${id}`));
  await page
    .getByLabel('Message Ask Vulpes', { exact: true })
    .fill('Synthetic safety scenario: severe chest pain.');
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(
    page.getByText('Response saved.', { exact: true }),
  ).toBeVisible();
}

test('mobile message controls keep conversation geometry stable when focused', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await answer(page);
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement)
      document.activeElement.blur();
  });
  const conversation = page.locator('.conversation');
  const before = await conversation.evaluate(
    (node) => node.getBoundingClientRect().height,
  );
  await page
    .getByRole('button', { name: 'Inspect execution', exact: true })
    .focus();
  expect(
    await conversation.evaluate((node) => node.getBoundingClientRect().height),
  ).toBe(before);
});

test('mobile inspector API failure supports explicit retry and returns focus', async ({
  page,
}) => {
  await answer(page);
  await page.route('**/api/executions?*', (route) => route.abort());
  const trigger = page.getByRole('button', {
    name: 'Inspect execution',
    exact: true,
  });
  await trigger.click();
  const inspector = page.getByRole('dialog', { name: 'Execution inspector' });
  await expect(
    inspector.getByRole('button', { name: 'Retry execution' }),
  ).toBeVisible();
  await page.unroute('**/api/executions?*');
  await inspector.getByRole('button', { name: 'Retry execution' }).click();
  await expect(
    inspector.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(trigger).toBeFocused();
});

test('mobile inspector survives same-owner session revalidation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await answer(page);
  await page
    .getByRole('button', { name: 'Inspect execution', exact: true })
    .click();
  const inspector = page.getByRole('dialog', { name: 'Execution inspector' });
  await expect(
    inspector.getByRole('heading', { name: 'Overview', exact: true }),
  ).toBeVisible();
  const checked = page.waitForResponse(
    (r) => r.url().endsWith('/api/account') && r.request().method() === 'GET',
  );
  await page.evaluate(() => {
    const key = 'vulpes.auth.session.v1';
    const channel = new BroadcastChannel(key);
    channel.postMessage({
      event: 'TOKEN_REFRESHED',
      session: JSON.parse(localStorage.getItem(key)!),
    });
    channel.close();
  });
  expect((await checked).status()).toBe(200);
  await expect(
    page.getByRole('heading', { name: 'Ask Vulpes', exact: true }),
  ).toBeVisible();
  await expect(inspector).toBeVisible();
});

test.describe('inspector chunk unavailable', () => {
  test.use({ serviceWorkers: 'block' });
  test('mobile inspector chunk failure preserves conversation and dismissal focus', async ({
    page,
  }) => {
    await answer(page);
    await page.route('**/assets/inspector-*.js', (route) => route.abort());
    await page.route('**/src/features/executions/inspector.tsx*', (route) =>
      route.abort(),
    );
    const trigger = page.getByRole('button', {
      name: 'Inspect execution',
      exact: true,
    });
    await trigger.click();
    await expect(
      page.getByRole('alert', { name: 'Inspector unavailable' }),
    ).toContainText('Your saved conversation remains available.');
    await page.getByRole('button', { name: 'Dismiss inspector error' }).click();
    await expect(trigger).toBeFocused();
    await expect(
      page.getByText('Response saved.', { exact: true }),
    ).toBeVisible();
  });
});

test('Goals request failure stays distinct from an empty account and offers recovery', async ({
  page,
}) => {
  await restrictNetwork(page);
  await signIn(page);
  await page.route('**/api/goals*', (route) => route.abort());
  await page.goto('/goals');
  await expect(
    page.getByRole('button', { name: 'Retry goals', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Retry proposals', exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText('No approved goals yet.', { exact: true }),
  ).toHaveCount(0);
  await page.unroute('**/api/goals*');
  await page.getByRole('button', { name: 'Retry goals', exact: true }).click();
  await expect(
    page.getByText('No approved goals yet.', { exact: true }),
  ).toBeVisible();
});

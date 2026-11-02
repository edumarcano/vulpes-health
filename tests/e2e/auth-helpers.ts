import { expect, type Page } from '@playwright/test';
export const accounts = JSON.parse(
  process.env.VULPES_TEST_ACCOUNTS_JSON ?? '[]',
) as Array<{ id: string; email: string; password: string }>;
export async function signIn(page: Page, index = 0) {
  const account = accounts[index];
  if (!account) throw new Error('Use the guarded npm run test:e2e runner.');
  await page.goto('/login');
  await page.getByLabel('Email', { exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByRole('heading', { name: 'Ask Vulpes', exact: true }),
  ).toBeVisible();
}
export async function restrictNetwork(page: Page) {
  await page.route('**/*', async (route) => {
    const url = new URL(route.request().url());
    if (
      url.protocol === 'http:' &&
      url.hostname === '127.0.0.1' &&
      [
        process.env.VULPES_TEST_MODE === 'dev_proof' ? '5173' : '4173',
        '54321',
      ].includes(url.port)
    )
      await route.continue();
    else {
      await route.abort();
      throw new Error('Unexpected external browser request.');
    }
  });
}

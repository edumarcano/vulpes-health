import { expect, test } from '@playwright/test';
import { accounts, restrictNetwork, signIn } from './auth-helpers';

test.beforeEach(async ({ page }) => { await restrictNetwork(page); });

test('guards deep links, rejects invalid credentials, and ignores external return paths', async ({ page }) => {
  await page.goto('/settings');
  await expect(page).toHaveURL('/login?returnTo=%2Fsettings');
  await expect(page.getByRole('navigation',{ name:'Primary' })).toHaveCount(0);
  await page.getByLabel('Email',{ exact:true }).fill(accounts[0]!.email);
  await page.getByLabel('Password',{ exact:true }).fill('Synthetic-Wrong-Password');
  await page.getByRole('button',{ name:'Sign in',exact:true }).click();
  await expect(page.getByRole('status')).toContainText('Sign-in failed.');
  await expect(page.getByLabel('Password',{ exact:true })).toHaveValue('');
  await page.goto('/login?returnTo=https%3A%2F%2Fforeign.example.test');
  await page.getByLabel('Email',{ exact:true }).fill(accounts[0]!.email);
  await page.getByLabel('Password',{ exact:true }).fill(accounts[0]!.password);
  await page.getByRole('button',{ name:'Sign in',exact:true }).click();
  await expect(page).toHaveURL('/ask');
});

test('saves profile and explicit consent through the real API and survives reload', async ({ page }) => {
  await signIn(page); await page.goto('/settings');
  await page.getByLabel('Display name',{ exact:true }).fill('Synthetic saved profile');
  await page.getByLabel('Timezone',{ exact:true }).fill('America/New_York');
  await page.getByLabel('Units',{ exact:true }).selectOption('imperial');
  await page.getByRole('button',{ name:'Save profile',exact:true }).click();
  await expect(page.getByRole('status')).toHaveText('Settings saved. AI remains unavailable.');
  await page.reload();
  await expect(page.getByLabel('Display name',{ exact:true })).toHaveValue('Synthetic saved profile');
  await expect(page.getByLabel('Timezone',{ exact:true })).toHaveValue('America/New_York');
  await expect(page.getByLabel('Units',{ exact:true })).toHaveValue('imperial');
  await page.getByRole('button',{ name:'Allow OpenRouter',exact:true }).click();
  await expect(page.getByRole('button',{ name:'Revoke OpenRouter',exact:true })).toBeEnabled();
  await page.reload();
  await expect(page.getByRole('button',{ name:'Revoke OpenRouter',exact:true })).toBeEnabled();
  await page.getByRole('button',{ name:'Revoke OpenRouter',exact:true }).click();
  await expect(page.getByRole('button',{ name:'Allow OpenRouter',exact:true })).toBeEnabled();
  await expect(page.getByRole('button',{ name:'Allow Google Cloud',exact:true })).toHaveCount(0);
  await expect(page.getByText('AI and spending controls',{ exact:true })).toBeVisible();
});

test('account switching clears the prior profile, draft, consent, and session namespace', async ({ page }) => {
  await signIn(page); await page.goto('/settings');
  await page.getByLabel('Display name',{ exact:true }).fill('Unsaved synthetic A draft');
  await page.getByRole('button',{ name:'Sign out',exact:true }).click();
  await expect(page.getByRole('heading',{ name:'Sign in to Vulpes',exact:true })).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('vulpes.auth.session.v1'))).toBeNull();
  await signIn(page,1); await page.goto('/settings');
  await expect(page.getByLabel('Display name',{ exact:true })).toHaveValue('Synthetic B');
  await expect(page.getByLabel('Timezone',{ exact:true })).toHaveValue('UTC');
  await expect(page.getByRole('button',{ name:'Allow OpenRouter',exact:true })).toBeEnabled();
  await expect(page.getByText('Unsaved synthetic A draft',{ exact:true })).toHaveCount(0);
  await page.reload(); await expect(page.getByLabel('Display name',{ exact:true })).toHaveValue('Synthetic B');
});

test('sign out clears another open tab on the same device', async ({ page,context }) => {
  await signIn(page); await page.goto('/settings');
  const other = await context.newPage(); await restrictNetwork(other); await other.goto('/settings');
  await expect(other.getByRole('button',{ name:'Sign out',exact:true })).toBeVisible();
  await page.getByRole('button',{ name:'Sign out',exact:true }).click();
  await expect(other.getByRole('heading',{ name:'Sign in to Vulpes',exact:true })).toBeVisible();
  await expect(other.getByLabel('Display name',{ exact:true })).toHaveCount(0);
});

for (const method of ['GET','PATCH']) {
  test(`late ${method} completion cannot restore the prior account`, async ({ page }) => {
    await signIn(page); if (method === 'PATCH') await page.goto('/settings');
    let release!: () => void; const barrier = new Promise<void>((resolve) => { release = resolve; });
    let reached!: () => void; const started = new Promise<void>((resolve) => { reached = resolve; });
    let intercept = true;
    await page.route('**/api/settings',async (route) => {
      if (!intercept || route.request().method() !== method) { await route.fallback(); return; }
      intercept = false;
      const response = await route.fetch(); reached(); await barrier;
      try { await route.fulfill({ response }); } catch { /* Account change can abort this obsolete browser request. */ }
    });
    try {
      if (method === 'GET') await page.goto('/settings');
      else { await page.getByLabel('Display name',{ exact:true }).fill('Synthetic late A save'); await page.getByRole('button',{ name:'Save profile',exact:true }).click(); }
      await started;
      await page.getByRole('button',{ name:'Sign out',exact:true }).click();
      await expect(page.getByRole('heading',{ name:'Sign in to Vulpes',exact:true })).toBeVisible();
      await signIn(page,1); await page.goto('/settings');
      await expect(page.getByLabel('Display name',{ exact:true })).toHaveValue('Synthetic B');
      release();
      await page.getByRole('button',{ name:'Refresh settings',exact:true }).click();
      await expect(page.getByLabel('Display name',{ exact:true })).toHaveValue('Synthetic B');
      await page.reload(); await expect(page.getByLabel('Display name',{ exact:true })).toHaveValue('Synthetic B');
    } finally { release(); }
  });
}

test('stale settings require refresh instead of silently overwriting another tab', async ({ page,context }) => {
  await signIn(page); await page.goto('/settings');
  const other = await context.newPage(); await restrictNetwork(other); await other.goto('/settings');
  await expect(other.getByLabel('Timezone',{ exact:true })).toBeVisible();
  await page.getByLabel('Display name',{ exact:true }).fill('Synthetic current version');
  await page.getByRole('button',{ name:'Save profile',exact:true }).click();
  await expect(page.getByRole('status')).toContainText('Settings saved.');
  await other.getByLabel('Display name',{ exact:true }).fill('Synthetic stale version');
  await other.getByRole('button',{ name:'Save profile',exact:true }).click();
  await expect(other.getByRole('status')).toContainText('Settings changed. Refresh');
  await other.getByRole('button',{ name:'Refresh settings',exact:true }).click();
  await expect(other.getByLabel('Display name',{ exact:true })).toHaveValue('Synthetic current version');
});

test('failed remote sign-out still clears local private state', async ({ page }) => {
  await signIn(page); await page.goto('/settings');
  await page.route('**/auth/v1/logout*',(route) => route.fulfill({ status:503,contentType:'application/json',body:'{"message":"Synthetic unavailable"}' }));
  await page.getByRole('button',{ name:'Sign out',exact:true }).click();
  await expect(page.getByRole('heading',{ name:'Sign in to Vulpes',exact:true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Remote sign-out could not be confirmed');
  expect(await page.evaluate(() => localStorage.getItem('vulpes.auth.session.v1'))).toBeNull();
  await page.reload(); await expect(page.getByRole('heading',{ name:'Sign in to Vulpes',exact:true })).toBeVisible();
});

for (const colorScheme of ['light','dark'] as const) for (const [width,height] of [[360,800],[390,844],[430,932],[768,1024],[1440,900]]) {
  test(`login ${width}x${height} ${colorScheme} is labelled, usable and contains no layout overflow`,async ({ page },testInfo) => {
    await page.setViewportSize({ width:width!,height:height! }); await page.emulateMedia({ colorScheme });
    await page.goto('/login');
    await expect(page.getByLabel('Email',{ exact:true })).toBeVisible(); await expect(page.getByLabel('Password',{ exact:true })).toBeVisible();
    await page.getByLabel('Email',{ exact:true }).focus(); await page.keyboard.press('Tab'); await expect(page.getByLabel('Password',{ exact:true })).toBeFocused();
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path:testInfo.outputPath('login.png'),fullPage:true });
  });
}

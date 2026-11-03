import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { accounts, signIn, restrictNetwork } from './auth-helpers';
import { LocalSupabase } from '../helpers/local-supabase';
const tokens = JSON.parse(
  process.env.VULPES_TEST_ACCOUNTS_JSON ?? '[]',
) as Array<{ token: string }>;

test('release journey signs in, imports, asks, inspects, approves, reimports, exports and deletes', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  await restrictNetwork(page);
  const account = accounts[6]!;
  const db = new LocalSupabase();
  const headers = { Authorization: `Bearer ${tokens[6]!.token}` };
  let sends = 0;
  page.on('request', (r) => {
    if (r.url().endsWith('/api/chat') && r.postDataJSON()?.action === 'send')
      sends++;
  });
  await signIn(page, 6);
  expect(sends).toBe(0);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
  await page.goto('/data');
  await page.getByLabel('CSV file', { exact: true }).setInputFiles({
    name: 'synthetic-release.csv',
    mimeType: 'text/csv',
    buffer: readFileSync(
      'docs/spec/v0.1.0/fixtures/measurements-synthetic.csv',
    ),
  });
  await page
    .getByLabel('Import source label', { exact: true })
    .fill('Synthetic release scale');
  await page
    .getByLabel('CSV source label to include', { exact: true })
    .fill('Synthetic Scale A');
  await page
    .getByLabel('I confirm this file contains one profile', { exact: true })
    .check();
  const pending = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/data') &&
      r.request().postDataJSON()?.action === 'preview_csv',
  );
  await page.getByRole('button', { name: 'Preview CSV', exact: true }).click();
  const source = (await (await pending).json()).data.source_id;
  await page.screenshot({
    path: info.outputPath('release-import.png'),
    fullPage: true,
  });
  await page
    .getByRole('button', { name: 'Confirm import', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Import recorded', exact: true }),
  ).toBeVisible();
  expect(sends).toBe(0);
  await page.goto('/ask');
  await expect(page.getByLabel('Analysis depth')).toHaveCount(0);
  const created = page.waitForResponse(
    (r) =>
      r.url().endsWith('/api/conversations') &&
      r.request().postDataJSON()?.action === 'create',
  );
  await page
    .getByRole('button', { name: 'New conversation', exact: true })
    .click();
  const conversation = (await (await created).json()).data.id;
  await expect(page).toHaveURL(new RegExp('conversation=' + conversation));
  async function say(text: string) {
    await expect(
      page.getByLabel('Message Ask Vulpes', { exact: true }),
    ).toBeEnabled();
    await page.getByLabel('Message Ask Vulpes', { exact: true }).fill(text);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(
      page.getByText('Response saved.', { exact: true }),
    ).toBeVisible();
  }
  await say('How has my imported weight changed?');
  await expect(
    page.getByText(/seven-day mean 69 kg; change -0.7 kg/),
  ).toBeVisible();
  await page
    .getByRole('button', { name: 'Inspect execution', exact: true })
    .click();
  const inspector = page.getByRole('dialog', { name: 'Execution inspector' });
  await expect(
    inspector.getByRole('heading', { name: 'Step 5: generation' }),
  ).toBeVisible();
  await expect(
    inspector.getByText(/finish stop \(adapter-normalized\)/),
  ).toBeVisible();
  await inspector.screenshot({
    path: info.outputPath('release-inspector.png'),
  });
  await inspector.getByRole('button', { name: 'Close', exact: true }).click();
  await page.route('**/api/chat', (route) =>
    route.continue({
      headers: {
        ...route.request().headers(),
        'x-vulpes-test-scenario': 'goal_create',
      },
    }),
  );
  await say(`Propose a weight target using source:${source}`);
  const review = page.getByRole('region', { name: 'Review goal proposal' });
  await expect(review).toContainText('69.7');
  await expect(review).toContainText('pending');
  expect(
    await (
      await db.admin(`/rest/v1/goals?user_id=eq.${account.id}`, 'GET')
    ).json(),
  ).toHaveLength(0);
  await review
    .getByRole('button', { name: 'Approve goal proposal', exact: true })
    .click();
  await expect(review).toContainText('approved');
  expect(sends).toBe(2);
  await page
    .getByRole('link', { name: 'Open approved goal', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Revision history', exact: true }),
  ).toBeVisible();
  const goalUrl = page.url();
  const today = new Date().toISOString().slice(0, 10);
  const csv =
    'observed_at,metric,value,unit,source,granularity,external_record_id,local_date,timezone,method\n' +
    [2, 1, 0]
      .map(
        (offset, index) =>
          `${new Date(Date.parse(today) - offset * 86400000).toISOString().slice(0, 10)}T08:00:00Z,weight,${['68.9', '68.8', '68.7'][index]},kg,Synthetic Scale A,instant,release-${index},,UTC,device_reported`,
      )
      .join('\n') +
    '\n';
  // Reimport through the production HTTP contract using the same owned source.
  const preview = await page.request.post('/api/data', {
    headers,
    data: {
      action: 'preview_csv',
      client_request_id: randomUUID(),
      csv,
      source: { kind: 'existing', id: source },
      mapping: {
        schema_version: 1,
        format: 'canonical',
        timezone: 'UTC',
        profile: null,
        single_profile: true,
        review_requested: false,
        source_label: 'Synthetic Scale A',
      },
    },
  });
  expect(preview.status()).toBe(200);
  const p = (await preview.json()).data;
  expect(
    (
      await page.request.post('/api/data', {
        headers,
        data: {
          action: 'commit_import',
          batch_id: p.batch_id,
          payload_hash: p.payload_hash,
          client_request_id: randomUUID(),
        },
      })
    ).status(),
  ).toBe(200);
  await page.goto(goalUrl);
  await expect(
    page.getByRole('region', { name: 'Goal progress', exact: true }),
  ).toContainText('Current: 68.8');
  await page.reload();
  await expect(
    page.getByRole('region', { name: 'Goal progress', exact: true }),
  ).toContainText('Current: 68.8');
  expect(sends).toBe(2);
  await page.screenshot({
    path: info.outputPath('release-progress.png'),
    fullPage: true,
  });
  await page.goto('/settings');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download account JSON' }).click();
  const file = await (await download).path();
  expect(file).toBeTruthy();
  const exported = JSON.parse(readFileSync(file!, 'utf8'));
  expect(Object.keys(exported.sections)).toHaveLength(18);
  expect(exported.sections.measurements.length).toBeGreaterThan(14);
  expect(exported.sections.goals).toHaveLength(1);
  expect(exported.sections.conversations).toHaveLength(1);
  expect(exported.sections.messages.length).toBeGreaterThanOrEqual(4);
  await page
    .getByLabel('Current password', { exact: true })
    .fill(account.password);
  await page
    .getByLabel('Deletion confirmation', { exact: true })
    .fill('DELETE MY VULPES ACCOUNT');
  await page
    .getByRole('button', { name: 'Start account deletion', exact: true })
    .click();
  await expect(
    page.getByRole('heading', { name: 'Account deletion in progress' }),
  ).toBeVisible();
  await page.reload();
  await expect(page.getByRole('navigation', { name: 'Primary' })).toHaveCount(
    0,
  );
  for (let n = 0; n < 100; n++) {
    const pending = page.waitForResponse(
      (r) =>
        r.url().endsWith('/api/account') &&
        r.request().postDataJSON()?.action === 'continue_delete',
    );
    await page
      .getByRole('button', { name: 'Continue account deletion', exact: true })
      .click();
    const response = await pending;
    expect(response.status()).toBe(200);
    const value = (await response.json()).data;
    if (value.phase === 'completed') break;
    await expect(
      page.getByRole('button', {
        name: 'Continue account deletion',
        exact: true,
      }),
    ).toBeEnabled();
  }
  await expect(
    page.getByRole('heading', {
      name: 'Account deletion completed',
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({ path: info.outputPath('release-deleted.png') });
  expect(sends).toBe(2);
  for (const table of [
    'profiles',
    'measurements',
    'goals',
    'conversations',
    'messages',
    'ai_runs',
    'ai_steps',
    'private_payloads',
  ])
    expect(
      await (
        await db.admin(`/rest/v1/${table}?user_id=eq.${account.id}`, 'GET')
      ).json(),
    ).toEqual([]);
  expect(
    (await db.request(`/auth/v1/admin/users/${account.id}`, 'admin')).status,
  ).toBe(404);
});

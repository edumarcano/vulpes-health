import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { expect, test } from '@playwright/test';
import { LocalSupabase } from '../helpers/local-supabase';
import { restrictNetwork, signIn } from './auth-helpers';
import type { V020ChatScenario } from '../fixtures/chat-v020';

test('v0.2 conversation shares exact event evidence and atomically reviewed group progress', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const account = JSON.parse(
    process.env.VULPES_TEST_ACCOUNTS_JSON ?? '[]',
  )[8] as { id: string; token: string };
  const db = new LocalSupabase();
  const headers = {
    Authorization: `Bearer ${account.token}`,
    'X-Vulpes-Data-Contract': '2',
  };
  async function rows(table: string) {
    return (await (
      await db.admin(
        `/rest/v1/${table}?user_id=eq.${account.id}&select=id`,
        'GET',
      )
    ).json()) as { id: string }[];
  }
  async function post(body: unknown) {
    const response = await page.request.post('/api/data', {
      headers,
      data: body,
    });
    expect(response.status()).toBe(200);
    return (await response.json()).data;
  }
  async function importCsv(csv: Buffer | string, source?: string) {
    const preview = await post({
      action: 'preview_csv',
      schema_version: 2,
      client_request_id: randomUUID(),
      csv_base64: Buffer.from(csv).toString('base64'),
      source: source
        ? { kind: 'existing', id: source }
        : {
            kind: 'new',
            label: 'Synthetic v0.2 Ask panel',
            origin_app: null,
            device_label: null,
          },
      mapping: {
        schema_version: 1,
        format: 'renpho',
        timezone: 'UTC',
        profile: null,
        single_profile: true,
        timezone_confirmed: true,
        review_requested: false,
      },
    });
    await post({
      action: 'commit_import',
      schema_version: 2,
      batch_id: preview.batch_id,
      payload_hash: preview.payload_hash,
      client_request_id: randomUUID(),
    });
    return preview.source_id as string;
  }
  async function start() {
    const created = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/conversations') &&
        response.request().method() === 'POST' &&
        response.request().postDataJSON()?.action === 'create',
    );
    await page
      .getByRole('button', { name: 'New conversation', exact: true })
      .click();
    const response = await created;
    expect(response.status()).toBe(200);
    const id = (await response.json()).data.id as string;
    await expect(page).toHaveURL(new RegExp('conversation=' + id));
    await expect(
      page.getByLabel('Message Ask Vulpes', { exact: true }),
    ).toBeEnabled();
    return '/ask?conversation=' + id;
  }
  async function say(text: string) {
    const sent = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/chat') &&
        response.request().method() === 'POST',
    );
    await page.getByLabel('Message Ask Vulpes', { exact: true }).fill(text);
    await page.getByRole('button', { name: 'Send', exact: true }).click();
    const response = await sent;
    if (response.status() !== 200)
      throw new Error(
        `Chat returned ${response.status()}: ${(await response.text()).slice(-1000)}`,
      );
    await expect(
      page.getByText('Response saved.', { exact: true }),
    ).toBeVisible();
  }
  await restrictNetwork(page);
  let scenario: V020ChatScenario = 'v020_panel';
  await page.route('**/api/chat', (route) =>
    route.continue({
      headers: {
        ...route.request().headers(),
        'x-vulpes-test-scenario': scenario,
      },
    }),
  );
  let sends = 0;
  page.on('request', (request) => {
    if (
      request.url().endsWith('/api/chat') &&
      request.postDataJSON()?.action === 'send'
    )
      sends++;
  });
  const runsBefore = (await rows('ai_runs')).length;
  const goalsBefore = (await rows('goals')).length;
  const source = await importCsv(
    readFileSync('docs/spec/v0.2.0/fixtures/renpho-v1/full-panel.csv'),
  );
  await importCsv('Date,Time,Weight(lb)\n2026.09.02,08:00:00,149\n', source);
  await signIn(page, 8);
  await expect
    .poll(async () => (await rows('ai_runs')).length)
    .toBe(runsBefore);
  expect(sends).toBe(0);

  const panelConversation = await start();
  await say(`Show my latest weigh-in, source:${source}`);
  const panel = page.getByRole('region', {
    name: 'Latest weigh-in result',
    exact: true,
  });
  await expect(panel).toContainText('1 observations from this event only');
  await expect(panel).toContainText('2026-09-02T08:00:00');
  await expect(panel).toContainText('67.585 kg');
  await expect(panel).not.toContainText('Body fat (device estimate)');
  const evidence = panel.getByRole('link', {
    name: 'Open result evidence in Data',
    exact: true,
  });
  const href = (await evidence.getAttribute('href'))!;
  const resultId = new URL(href, 'http://127.0.0.1').searchParams.get(
    'evidence',
  )!;
  expect(resultId).toMatch(/^analysis:[a-f0-9]{64}$/);
  await evidence.click();
  const resolved = page.getByRole('region', {
    name: 'Weigh-in evidence',
    exact: true,
  });
  await expect(resolved).toContainText(resultId);
  await expect(resolved).toContainText(
    '1 observations from 2026-09-02T08:00:00',
  );
  await page.goto(panelConversation);
  await expect(panel).toContainText('67.585 kg');
  expect(sends).toBe(1);
  expect((await rows('ai_runs')).length).toBe(runsBefore + 1);

  scenario = 'v020_group_create';
  const groupConversation = await start();
  await say(
    `Prepare the synthetic weight and body-fat group for review, source:${source}`,
  );
  const review = page.getByRole('region', {
    name: 'Review group proposal',
    exact: true,
  });
  await expect(review).toContainText('Synthetic v0.2 Ask group');
  await expect(review).toContainText('Member 1: Synthetic v0.2 weight target');
  await expect(review).toContainText(
    'Member 2: Synthetic v0.2 body-fat target',
  );
  await expect(review).toContainText('Decrease to 65 kg');
  await expect(review).toContainText('Decrease to 18 %');
  await expect(
    review.getByText(
      'User-reported baseline; no measurement date is claimed.',
      { exact: false },
    ),
  ).toHaveCount(2);
  expect((await rows('goals')).length).toBe(goalsBefore);
  const approve = review.getByRole('button', {
    name: 'Approve group proposal',
    exact: true,
  });
  await page.setViewportSize({ width: 360, height: 800 });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '200%';
  });
  for (const colorScheme of ['light', 'dark'] as const) {
    await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
    await expect
      .poll(() =>
        approve.evaluate((button) => getComputedStyle(button).backgroundColor),
      )
      .toBe(colorScheme === 'dark' ? 'rgb(241, 90, 36)' : 'rgb(185, 63, 19)');
    await review
      .getByRole('heading', {
        name: 'Synthetic v0.2 Ask group',
        exact: true,
        level: 3,
      })
      .scrollIntoViewIfNeeded();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
    ).toBe(true);
    await approve.scrollIntoViewIfNeeded();
    const box = (await approve.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    const label = await approve.evaluate((button) => {
      const style = getComputedStyle(button);
      const canvas = document.createElement('canvas');
      const context = canvas.getContext('2d')!;
      context.font = style.font;
      return {
        available:
          button.clientWidth -
          parseFloat(style.paddingLeft) -
          parseFloat(style.paddingRight),
        longestWord: Math.max(
          ...button
            .textContent!.trim()
            .split(/\s+/)
            .map((word) => context.measureText(word).width),
        ),
      };
    });
    expect(label.available).toBeGreaterThanOrEqual(label.longestWord);
    expect(box.height).toBeLessThan(160);
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(360);
    await page.screenshot({
      path: info.outputPath(`ask-group-review-${colorScheme}.png`),
      fullPage: false,
    });
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = '';
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  const decision = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/approvals') &&
      response.request().method() === 'POST',
  );
  await approve.focus();
  await approve.press('Enter');
  const approval = await decision;
  expect(approval.status()).toBe(200);
  const receipt = (await approval.json()).data;
  expect(receipt.outcome).toBe('approved');
  expect(receipt.members).toHaveLength(2);
  await expect(
    page.getByText('Group approved atomically.', { exact: true }),
  ).toBeVisible();
  expect((await rows('goals')).length).toBe(goalsBefore + 2);
  expect(sends).toBe(2);
  await page.reload();
  await expect(
    page.getByRole('link', { name: 'Open approved group', exact: true }),
  ).toBeVisible();
  expect(sends).toBe(2);

  scenario = 'v020_group_progress';
  await start();
  await say(`Show current group progress, group:${receipt.groupId}`);
  const progress = page.getByRole('region', {
    name: 'Group progress',
    exact: true,
  });
  await expect(progress).toContainText('Synthetic v0.2 weight target');
  await expect(progress).toContainText('Synthetic v0.2 body-fat target');
  await expect(progress).toContainText('2026-09-02T08:00:00');
  await expect(progress).toContainText('2026-09-01T08:00:00');
  await expect(progress).toContainText(
    'At least one required member is not meeting its condition.',
  );
  await page.reload();
  await expect(progress).toContainText(
    'Each member keeps its own units, evidence dates and calculation.',
  );
  await page.goto(groupConversation);
  await expect(
    page.getByRole('link', { name: 'Open approved group', exact: true }),
  ).toBeVisible();
  expect(sends).toBe(3);
  expect((await rows('ai_runs')).length).toBe(runsBefore + 3);
});

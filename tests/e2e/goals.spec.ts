import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { LocalSupabase } from '../helpers/local-supabase';
import { accounts, signIn, restrictNetwork } from './auth-helpers';

test('direct Goals latest daily progress includes today without inference', async ({
  page,
}, info) => {
  const db = new LocalSupabase();
  const owner = accounts[0]!.id;
  const source = randomUUID();
  const token = (
    JSON.parse(process.env.VULPES_TEST_ACCOUNTS_JSON!)[0] as { token: string }
  ).token;
  const headers = { Authorization: `Bearer ${token}` };
  const timezone = 'Pacific/Honolulu';
  const today = Temporal.Now.instant()
    .toZonedDateTimeISO(timezone)
    .startOfDay();
  await db.admin('/rest/v1/data_sources', 'POST', {
    id: source,
    user_id: owner,
    kind: 'manual',
    label: 'Synthetic daily progress',
    source_namespace: randomUUID(),
  });
  try {
    async function post(path: string, input: unknown) {
      const response = await page.request.post(path, { headers, data: input });
      expect(response.status()).toBe(200);
      return (await response.json()).data;
    }
    for (const [offset, value] of [
      [-1, '6000'],
      [0, '8000'],
    ] as const) {
      const day = today.add({ days: offset });
      await post('/api/data', {
        action: 'add_measurement',
        client_request_id: randomUUID(),
        source: { kind: 'existing', id: source },
        observation: {
          metric: 'steps_daily',
          value,
          unit: 'count',
          observed_at: day.toInstant().toString(),
          timezone,
          local_date: day.toPlainDate().toString(),
          granularity: 'daily_total',
          method: 'device_reported',
          quality_flags: [],
        },
      });
    }
    const p = await post('/api/goals', {
      action: 'propose_create',
      client_request_id: randomUUID(),
      definition: {
        schemaVersion: 1,
        title: 'Synthetic daily goal',
        metric: 'steps_daily',
        unit: 'count',
        sourceId: source,
        target: { direction: 'increase_to', value: 10000 },
        baselineMethod: 'user_reported',
        reportedBaseline: 4000,
        baselineFrom: today.subtract({ days: 7 }).toInstant().toString(),
        baselineTo: today.toInstant().toString(),
        currentMethod: 'latest_value',
        method: 'device_reported',
        granularity: 'daily_total',
        timezone,
        targetDate: null,
        constraints: [],
        proposedStrategy: null,
      },
    });
    const goal = await post('/api/approvals', {
      action: 'approve',
      proposal_id: p.id,
      payload_hash: p.payload_hash,
      expected_version: p.target_version,
      client_request_id: randomUUID(),
    });
    await restrictNetwork(page);
    await signIn(page);
    let sends = 0;
    page.on('request', (r) => {
      if (r.url().includes('/api/chat')) sends++;
    });
    await page.goto('/goals?goal=' + goal.goalId);
    const progress = page.getByRole('region', {
      name: 'Goal progress',
      exact: true,
    });
    await expect(progress).toContainText('Current: 8000');
    await expect(progress).toContainText('66.67%');
    expect(sends).toBe(0);
    await page.setViewportSize({ width: 360, height: 800 });
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      progress.getByRole('progressbar', { name: 'Goal progress', exact: true }),
    ).toHaveAttribute('value', /66[.]6/);
    await expect(
      page.getByRole('img', { name: /Selected daily totals/ }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath('m4-daily-progress.png'),
      fullPage: true,
    });
  } finally {
    await db.admin(`/rest/v1/goals?user_id=eq.${owner}`, 'PATCH', {
      state: 'draft',
      current_revision_id: null,
    });
    for (const table of ['goal_revisions', 'action_proposals', 'goals'])
      await db.admin(`/rest/v1/${table}?user_id=eq.${owner}`, 'DELETE');
    await db.admin(`/rest/v1/measurements?source_id=eq.${source}`, 'DELETE');
    await db.admin(`/rest/v1/data_sources?id=eq.${source}`, 'DELETE');
  }
});
test('direct Goals review and approval persist without inference', async ({
  page,
}, info) => {
  const db = new LocalSupabase();
  const owner = accounts[0]!.id;
  const source = randomUUID();
  await db.admin('/rest/v1/data_sources', 'POST', {
    id: source,
    user_id: owner,
    kind: 'manual',
    label: 'Synthetic Goals browser',
    source_namespace: randomUUID(),
  });
  try {
    await restrictNetwork(page);
    await signIn(page);
    const calls: string[] = [];
    page.on('request', (r) => {
      if (r.url().includes('/api/chat')) calls.push(r.url());
    });
    await page.goto('/goals');
    await page.getByRole('button', { name: '+ New Goal', exact: true }).click();
    await page
      .getByLabel('Metric', { exact: true })
      .selectOption('body_fat_percent');
    await page
      .getByLabel('Title', { exact: true })
      .fill('Synthetic empty target');
    await page
      .getByRole('button', { name: 'Review proposal', exact: true })
      .click();
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Approve goal proposal', exact: true }),
    ).toHaveCount(0);
    await page.getByLabel('Metric', { exact: true }).selectOption('weight');
    await page
      .getByLabel('Title', { exact: true })
      .fill('Synthetic browser goal');
    await page.getByLabel('Source', { exact: true }).selectOption(source);
    await page.getByLabel('target', { exact: true }).fill('68');
    await page
      .getByRole('combobox', { name: 'Baseline method', exact: true })
      .selectOption('user_reported');
    await page.getByLabel('Reported baseline', { exact: true }).fill('70');
    await page
      .getByRole('button', { name: 'Review proposal', exact: true })
      .click();
    const review = page.getByRole('region', { name: 'Review goal proposal' });
    await expect(review).toContainText('Synthetic browser goal');
    await expect(
      page.getByRole('button', { name: 'Synthetic browser goal · active' }),
    ).toHaveCount(0);
    await review
      .getByRole('button', { name: 'Approve goal proposal', exact: true })
      .click();
    await page
      .getByRole('button', {
        name: 'Synthetic browser goal · active',
        exact: true,
      })
      .click();
    await expect(
      page.getByRole('heading', { name: 'Revision history', exact: true }),
    ).toBeVisible();
    for (const [width, height] of [
      [360, 800],
      [390, 844],
      [430, 932],
      [768, 1024],
      [1440, 900],
    ])
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.setViewportSize({ width: width!, height: height! });
        await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
        await page.evaluate(() => {
          document.documentElement.style.fontSize = '200%';
        });
        const layout = await page.evaluate(() => ({
          fits: document.documentElement.scrollWidth <= innerWidth,
          viewport: innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
          overflow: [...document.querySelectorAll('*')]
            .filter((el) => el.getBoundingClientRect().right > innerWidth + 1)
            .map((el) => ({
              tag: el.tagName,
              className: el.className,
              right: el.getBoundingClientRect().right,
            }))
            .slice(0, 20),
        }));
        if (!layout.fits)
          await page.screenshot({
            path: info.outputPath(`goal-overflow-${width}-${colorScheme}.png`),
            fullPage: true,
          });
        expect(layout, JSON.stringify(layout)).toMatchObject({ fits: true });
        const observations = page.getByRole('region', {
          name: 'Goal observations',
          exact: true,
        });
        await observations.focus();
        await expect(observations).toBeFocused();
        await expect(observations.getByRole('table')).toBeVisible();
        await page.screenshot({
          path: info.outputPath(`goal-${width}-${colorScheme}-zoom.png`),
          fullPage: true,
        });
      }
    await page.reload();
    await expect(
      page.getByRole('button', {
        name: 'Synthetic browser goal · active',
        exact: true,
      }),
    ).toBeVisible();
    expect(calls).toEqual([]);
    await page.screenshot({
      path: info.outputPath('goals-approved.png'),
      fullPage: true,
    });
  } finally {
    await db.admin(`/rest/v1/goals?user_id=eq.${owner}`, 'PATCH', {
      state: 'draft',
      current_revision_id: null,
    });
    await db.admin(`/rest/v1/goal_revisions?user_id=eq.${owner}`, 'DELETE');
    await db.admin(`/rest/v1/action_proposals?user_id=eq.${owner}`, 'DELETE');
    await db.admin(`/rest/v1/goals?user_id=eq.${owner}`, 'DELETE');
    await db.admin(`/rest/v1/data_sources?id=eq.${source}`, 'DELETE');
  }
});

import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { LocalSupabase } from '../helpers/local-supabase';
import { accounts, signIn, restrictNetwork } from './auth-helpers';

test('goal cards render unavailable, range, and directional progress distinctly', async ({
  page,
}) => {
  await restrictNetwork(page);
  await signIn(page);
  const id = (n: number) =>
    `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const cases = [
    [
      'within range',
      {
        kind: 'progress',
        baseline: '70',
        current: '69',
        result: { kind: 'within_range' },
      },
    ],
    [
      'below range',
      {
        kind: 'progress',
        baseline: '70',
        current: '64',
        result: { kind: 'below_range' },
      },
    ],
    [
      'above range',
      {
        kind: 'progress',
        baseline: '70',
        current: '76',
        result: { kind: 'above_range' },
      },
    ],
    [
      'undefined',
      {
        kind: 'progress',
        baseline: '70',
        current: '69',
        result: { kind: 'undefined', reason: 'zero_denominator' },
      },
    ],
    ['insufficient data', { kind: 'insufficient_data' }],
    ['unavailable', { kind: 'unavailable', reason: 'needs_review' }],
    [
      'directional',
      {
        kind: 'progress',
        baseline: '70',
        current: '68',
        result: {
          kind: 'directional',
          rawPercent: 66.67,
          displayPercent: 66.67,
        },
      },
    ],
    [
      'malformed',
      {
        kind: 'progress',
        baseline: '70',
        current: '68',
        result: { kind: 'directional', rawPercent: 150, displayPercent: 150 },
      },
    ],
  ] as const;
  const goals = cases.map(([label], index) => ({
    id: id(index + 1),
    title: `Synthetic ${label} goal`,
    state: 'active',
    review_status: 'clear',
    version: 1,
    direction: index < 3 ? 'maintain_range' : 'decrease_to',
    target_lower: 65,
    target_upper: 75,
    target_value: 67,
    canonical_unit: 'kg',
    source_policy: { currentMethod: 'latest_value' },
  }));
  await page.route('**/api/data?*', (route) =>
    route.fulfill({
      json: {
        data: {
          items: [],
          nextCursor: null,
          dataRevision: 1,
          timezone: 'UTC',
        },
        request_id: id(99),
      },
    }),
  );
  await page.route('**/api/goals**', (route) => {
    const url = new URL(route.request().url());
    const selected = url.searchParams.get('id');
    const index = goals.findIndex((goal) => goal.id === selected);
    const data =
      url.searchParams.get('view') === 'progress'
        ? cases[index]?.[1]
        : {
            items: url.searchParams.get('view') === 'proposals' ? [] : goals,
            nextCursor: null,
          };
    return route.fulfill({ json: { data, request_id: id(99) } });
  });
  await page.goto('/goals');
  for (const [label] of cases) {
    const card = page
      .locator('.goal-card')
      .filter({ hasText: `Synthetic ${label} goal` });
    await expect(card).toBeVisible();
    if (label === 'directional') {
      await expect(card.locator('progress')).toHaveCount(1);
      await expect(card).toContainText('66.7%');
    } else {
      await expect(card.locator('progress')).toHaveCount(0);
      await expect(card).not.toContainText('Pending');
      await expect(card).not.toContainText('0%');
    }
  }
  await expect(
    page
      .locator('.goal-card')
      .filter({ hasText: 'Synthetic within range goal' }),
  ).toContainText('Within range');
  await expect(
    page
      .locator('.goal-card')
      .filter({ hasText: 'Synthetic insufficient data goal' }),
  ).toContainText('Insufficient data');
  await expect(
    page.locator('.goal-card').filter({ hasText: 'Synthetic undefined goal' }),
  ).toContainText('Undefined');
  await expect(
    page
      .locator('.goal-card')
      .filter({ hasText: 'Synthetic below range goal' }),
  ).toContainText('Below range');
  await expect(
    page
      .locator('.goal-card')
      .filter({ hasText: 'Synthetic above range goal' }),
  ).toContainText('Above range');
  await expect(
    page
      .locator('.goal-card')
      .filter({ hasText: 'Synthetic unavailable goal' }),
  ).toContainText('Baseline review required.');
  await expect(
    page.locator('.goal-card').filter({ hasText: 'Synthetic malformed goal' }),
  ).toContainText('Current value unavailable.');
});

test('direct Goals latest daily progress includes today without inference', async ({
  page,
}, info) => {
  const db = new LocalSupabase();
  const owner = accounts[0]!.id;
  const source = randomUUID();
  const token = (
    JSON.parse(process.env.VULPES_TEST_ACCOUNTS_JSON!)[0] as { token: string }
  ).token;
  const headers = {
    'X-Vulpes-Data-Contract': '2',
    Authorization: `Bearer ${token}`,
  };
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
    await expect
      .poll(() =>
        page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
      )
      .toBe(true);
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
    await page.getByRole('button', { name: 'New Goal', exact: true }).click();
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

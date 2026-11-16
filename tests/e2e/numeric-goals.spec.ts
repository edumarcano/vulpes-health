import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { LocalSupabase } from '../helpers/local-supabase';
import { accounts, restrictNetwork, signIn } from './auth-helpers';

test('new numeric metrics use reviewed direct goals, frozen baselines and dated progress without inference', async ({
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
  const now = Temporal.Instant.from(new Date().toISOString());
  const measuredPrefix = now
    .subtract({ hours: 2 })
    .toString({ smallestUnit: 'second' })
    .replace(/Z$/, '');
  const today = now.toZonedDateTimeISO('UTC').startOfDay();
  const goals: string[] = [];
  const runsBefore = await (
    await db.admin(
      `/rest/v1/ai_runs?user_id=eq.${owner}&select=id&order=id`,
      'GET',
    )
  ).json();
  await db.admin('/rest/v1/data_sources', 'POST', {
    id: source,
    user_id: owner,
    kind: 'manual',
    label: 'Synthetic full numeric goals',
    source_namespace: randomUUID(),
  });
  const cases = [
    {
      metric: 'renpho.muscle_mass',
      unit: 'kg',
      value: '55',
      title: 'Synthetic muscle mass increase',
      direction: 'increase_to',
      target: '56',
    },
    {
      metric: 'renpho.skeletal_muscle_percent',
      unit: '%',
      value: '40.25',
      title: 'Synthetic skeletal muscle range',
      direction: 'maintain_range',
      lower: '39',
      upper: '41',
    },
    {
      metric: 'renpho.visceral_fat_index',
      unit: 'index',
      value: '8.25',
      title: 'Synthetic decimal index condition',
      direction: 'decrease_to',
      target: '8.25',
    },
  ] as const;
  async function add(
    metric: string,
    unit: string,
    value: string,
    observedAt: string,
  ) {
    const response = await page.request.post('/api/data', {
      headers,
      data: {
        action: 'add_measurement',
        client_request_id: randomUUID(),
        source: { kind: 'existing', id: source },
        observation: {
          metric,
          unit,
          value,
          observed_at: observedAt,
          timezone: 'UTC',
          local_date: null,
          granularity: 'instant',
          method: 'device_estimate',
          quality_flags: [],
        },
      },
    });
    expect(response.status()).toBe(200);
  }
  try {
    for (const item of cases)
      await add(
        item.metric,
        item.unit,
        item.value,
        now.subtract({ hours: 2 }).toString(),
      );
    await restrictNetwork(page);
    await signIn(page);
    const dispatches: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/chat')) dispatches.push(request.url());
    });
    await page.goto('/goals');
    for (const [index, item] of cases.entries()) {
      await page.getByRole('button', { name: 'New Goal', exact: true }).click();
      const sheet = page.getByRole('dialog');
      await expect(sheet).toBeVisible();
      const metrics = sheet.getByLabel('Metric', { exact: true });
      await expect(metrics.locator('option')).toHaveCount(25);
      for (const raw of [
        'renpho.bmr',
        'renpho.target_weight_delta',
        'renpho.target_muscle_delta',
        'renpho.target_fat_delta',
      ])
        await expect(metrics.locator(`option[value="${raw}"]`)).toHaveCount(0);
      await metrics.selectOption(item.metric);
      await sheet.getByLabel('Title', { exact: true }).fill(item.title);
      await sheet.getByLabel('Source', { exact: true }).selectOption(source);
      await expect(
        sheet.getByLabel('Measurement method', { exact: true }),
      ).toHaveValue('device_estimate');
      await sheet
        .getByLabel('Direction', { exact: true })
        .selectOption(item.direction);
      if (item.direction === 'maintain_range') {
        await sheet.getByLabel('lower', { exact: true }).fill(item.lower);
        await sheet.getByLabel('upper', { exact: true }).fill(item.upper);
        await expect(sheet.getByLabel('target', { exact: true })).toHaveCount(
          0,
        );
      } else {
        await sheet.getByLabel('target', { exact: true }).fill(item.target);
      }
      await sheet
        .getByLabel('Baseline method', { exact: true })
        .selectOption('latest_value');
      await sheet
        .getByLabel('Baseline from', { exact: true })
        .fill(today.subtract({ days: 1 }).toInstant().toString());
      await sheet
        .getByLabel('Baseline to', { exact: true })
        .fill(today.add({ days: 1 }).toInstant().toString());
      const age = sheet.getByLabel('Maximum evidence age (days, optional)', {
        exact: true,
      });
      await expect(age).toHaveValue('');
      if (index === 0) await age.fill('30');
      await sheet
        .getByRole('button', { name: 'Review proposal', exact: true })
        .click();
      await expect(sheet).not.toBeVisible();
      const review = page
        .getByRole('region', { name: 'Review goal proposal', exact: true })
        .filter({
          has: page.getByRole('heading', { name: item.title, exact: true }),
        });
      await expect(review).toContainText(item.value);
      await expect(review).toContainText(measuredPrefix);
      await expect(review).toContainText('latest_value');
      await expect(review).toContainText(
        index === 0 ? 'At most 30 elapsed days' : 'No age cutoff',
      );
      await expect(
        page.getByRole('button', {
          name: `${item.title} · active`,
          exact: true,
        }),
      ).toHaveCount(0);
      const approval = page.waitForResponse(
        (response) =>
          response.url().endsWith('/api/approvals') &&
          response.request().method() === 'POST',
      );
      await review
        .getByRole('button', { name: 'Approve goal proposal', exact: true })
        .click();
      const approved = await approval;
      expect(approved.status()).toBe(200);
      const receipt = (await approved.json()).data;
      goals.push(receipt.goalId);
      await page
        .getByRole('button', { name: `${item.title} · active`, exact: true })
        .click();
      const progress = page.getByRole('region', {
        name: 'Goal progress',
        exact: true,
      });
      await expect(progress).toContainText(`Current: ${item.value}`);
      await expect(progress).toContainText(measuredPrefix);
      await expect(progress).toContainText('Actual change from baseline');
      if (item.direction === 'maintain_range') {
        await expect(progress).toContainText('within range');
        await expect(progress).toContainText('0 percentage points');
        await expect(progress.getByRole('progressbar')).toHaveCount(0);
      } else if (index === 2) {
        await expect(progress).toContainText(
          'Progress is undefined because the target equals the baseline.',
        );
        await expect(progress).toContainText(
          'Currently meeting the target condition',
        );
        await expect(progress.getByRole('progressbar')).toHaveCount(0);
      }
    }
    await add(
      'renpho.muscle_mass',
      'kg',
      '56.5',
      now.subtract({ hours: 1 }).toString(),
    );
    await page.goto('/goals?goal=' + goals[0]);
    const progress = page.getByRole('region', {
      name: 'Goal progress',
      exact: true,
    });
    await expect(progress).toContainText('Baseline: 55');
    await expect(progress).toContainText('Current: 56.5');
    await expect(progress).toContainText('1.5 kg');
    await expect(progress).toContainText('150% progress');
    await expect(progress).toContainText(
      'Currently meeting the target condition',
    );
    await expect(progress.getByRole('progressbar')).toHaveAttribute(
      'value',
      '100',
    );
    await page.reload();
    await expect(progress).toContainText('Baseline: 55');
    await page.setViewportSize({ width: 360, height: 800 });
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      await expect
        .poll(() =>
          page.evaluate(
            () => document.documentElement.scrollWidth <= innerWidth,
          ),
        )
        .toBe(true);
      await expect(progress).toBeVisible();
      await page.screenshot({
        path: info.outputPath(`numeric-goals-${colorScheme}.png`),
        fullPage: true,
      });
    }
    expect(dispatches).toEqual([]);
    const runs = await db.admin(
      `/rest/v1/ai_runs?user_id=eq.${owner}&select=id&order=id`,
      'GET',
    );
    expect(await runs.json()).toEqual(runsBefore);
  } finally {
    for (const id of goals) {
      await db.admin(`/rest/v1/goals?id=eq.${id}`, 'PATCH', {
        state: 'draft',
        current_revision_id: null,
      });
      await db.admin(`/rest/v1/goal_revisions?goal_id=eq.${id}`, 'DELETE');
    }
    const proposals = await db.admin(
      `/rest/v1/action_proposals?user_id=eq.${owner}&select=id,canonical_payload`,
      'GET',
    );
    for (const row of (await proposals.json()) as {
      id: string;
      canonical_payload: { definition?: { sourceId?: string } } | null;
    }[])
      if (row.canonical_payload?.definition?.sourceId === source)
        await db.admin(`/rest/v1/action_proposals?id=eq.${row.id}`, 'DELETE');
    for (const id of goals)
      await db.admin(`/rest/v1/goals?id=eq.${id}`, 'DELETE');
    await db.admin(`/rest/v1/measurements?source_id=eq.${source}`, 'DELETE');
    await db.admin(`/rest/v1/data_sources?id=eq.${source}`, 'DELETE');
  }
});

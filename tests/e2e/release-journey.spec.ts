import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { accountExportSections } from '../../shared/account';
import { accounts, signIn, restrictNetwork } from './auth-helpers';
import { LocalSupabase } from '../helpers/local-supabase';
const tokens = JSON.parse(
  process.env.VULPES_TEST_ACCOUNTS_JSON ?? '[]',
) as Array<{ token: string }>;

test('release journey preserves full-panel evidence, reviewed goals and groups through imports, corrections and deletion', async ({
  page,
}, info) => {
  test.setTimeout(150_000);
  await restrictNetwork(page);
  const account = accounts[6]!;
  const db = new LocalSupabase();
  const headers = {
    'X-Vulpes-Data-Contract': '2',
    Authorization: `Bearer ${tokens[6]!.token}`,
  };
  async function post(path: string, data: unknown) {
    const response = await page.request.post(path, { headers, data });
    expect(response.status(), await response.text()).toBe(200);
    return (await response.json()).data;
  }
  async function rows(table: string) {
    return (await (
      await db.admin(`/rest/v1/${table}?user_id=eq.${account.id}`, 'GET')
    ).json()) as Record<string, unknown>[];
  }
  async function renpho(csv: Buffer | string, source?: string) {
    const preview = await post('/api/data', {
      action: 'preview_csv',
      schema_version: 2,
      client_request_id: randomUUID(),
      csv_base64: Buffer.from(csv).toString('base64'),
      source: source
        ? { kind: 'existing', id: source }
        : {
            kind: 'new',
            label: 'Synthetic release full panel',
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
    const committed = await post('/api/data', {
      action: 'commit_import',
      schema_version: 2,
      client_request_id: randomUUID(),
      batch_id: preview.batch_id,
      payload_hash: preview.payload_hash,
    });
    return { source: preview.source_id as string, preview, committed };
  }
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
  await page.getByRole('button', { name: 'Import CSV', exact: true }).click();
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
  const firstConversationUrl = page.url();
  await expect(
    page.getByText(/seven-day mean 69 kg; change -0.7 kg/),
  ).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
  await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
  await page.screenshot({
    path: info.outputPath('release-ask-dark.png'),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
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
  const fullPanel = readFileSync(
    'docs/spec/v0.2.0/fixtures/renpho-v1/full-panel.csv',
  );
  const panel = await renpho(fullPanel);
  expect(panel.committed.inserted).toBe(24);
  await renpho('Date,Time,Weight(lb)\n2026.09.02,08:00:00,149\n', panel.source);
  await page.goto('/data');
  await page.getByLabel('Source', { exact: true }).selectOption(panel.source);
  await page.getByLabel('Analysis timezone', { exact: true }).fill('UTC');
  await page.getByLabel('From date', { exact: true }).fill('2026-09-01');
  await page.getByLabel('Through date', { exact: true }).fill('2026-09-30');
  const latest = page.getByRole('region', {
    name: 'Latest weigh-in',
    exact: true,
  });
  await expect(latest).toContainText('1 observations from this event only');
  await expect(latest).not.toContainText('Body fat');
  await expect(
    page.getByRole('region', { name: 'Latest per metric', exact: true }),
  ).toContainText('2026-09-01T08:00:00');
  await expect(
    page.getByRole('region', { name: 'Metric guidance', exact: true }),
  ).toContainText('Manufacturer reference unavailable');
  await page.getByLabel('Source', { exact: true }).selectOption(source);
  await page
    .getByLabel('Method', { exact: true })
    .selectOption('device_reported');
  await page.getByLabel('From date', { exact: true }).fill('2026-09-08');
  await page.getByLabel('Through date', { exact: true }).fill('2026-09-14');
  await page
    .getByLabel('Compare with', { exact: true })
    .selectOption('previous_period');
  const summary = page.getByRole('region', {
    name: 'Deterministic summary',
    exact: true,
  });
  await expect(summary).toContainText('69 kg');
  await expect(summary).toContainText('Previous: 69.7 kg');
  await expect(summary).toContainText('-0.7 kg');
  await expect(summary).toContainText('7/7 observed/calendar days');
  await page
    .getByRole('button', { name: 'Open result evidence', exact: true })
    .click();
  const historicalEvidenceUrl = page.url();
  await page.goto('/goals');
  await page.getByRole('button', { name: 'New Goal', exact: true }).click();
  const sheet = page.getByRole('dialog');
  await sheet
    .getByLabel('Metric', { exact: true })
    .selectOption('renpho.muscle_mass');
  await sheet
    .getByLabel('Title', { exact: true })
    .fill('Synthetic release muscle');
  await sheet.getByLabel('Source', { exact: true }).selectOption(panel.source);
  await sheet
    .getByLabel('Measurement method', { exact: true })
    .selectOption('device_estimate');
  await sheet
    .getByLabel('Direction', { exact: true })
    .selectOption('increase_to');
  await sheet.getByLabel('target', { exact: true }).fill('49');
  await sheet
    .getByLabel('Baseline method', { exact: true })
    .selectOption('latest_value');
  await sheet
    .getByLabel('Baseline from', { exact: true })
    .fill('2026-09-01T00:00:00Z');
  await sheet
    .getByLabel('Baseline to', { exact: true })
    .fill('2026-09-02T00:00:00Z');
  await sheet
    .getByRole('button', { name: 'Review proposal', exact: true })
    .click();
  const muscleReview = page.getByRole('region', {
    name: 'Review goal proposal',
    exact: true,
  });
  await expect(muscleReview).toContainText('47.62719885');
  await expect(muscleReview).toContainText('2026-09-01T08:00:00');
  expect(await rows('goals')).toHaveLength(0);
  await muscleReview
    .getByRole('button', { name: 'Approve goal proposal', exact: true })
    .click();
  await expect(muscleReview).toContainText('approved');
  const muscle = (await rows('goals'))[0]!;
  const muscleRevision = (await rows('goal_revisions')).find(
    (row) => row.goal_id === muscle.id,
  )!;
  const muscleBaseline = (muscleRevision.payload as { baseline: unknown })
    .baseline;
  expect(sends).toBe(1);
  await page.goto(firstConversationUrl);
  let scenario = 'goal_create';
  await page.route('**/api/chat', (route) =>
    route.continue({
      headers: {
        'X-Vulpes-Data-Contract': '2',
        ...route.request().headers(),
        'x-vulpes-test-scenario': scenario,
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
  ).toHaveLength(1);
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
  await page.getByRole('button', { name: 'New Group', exact: true }).click();
  const groupEditor = page.getByRole('dialog');
  await groupEditor
    .getByLabel('Group name', { exact: true })
    .fill('Synthetic release group');
  const linkedGoals = await rows('goals');
  expect(linkedGoals).toHaveLength(2);
  for (const goal of linkedGoals) {
    await groupEditor
      .getByRole('button', { name: 'Add approved goal', exact: true })
      .click();
    await groupEditor
      .getByRole('combobox', { name: 'Approved goal', exact: true })
      .selectOption(String(goal.id));
    await groupEditor
      .getByRole('button', { name: 'Use current approved goal', exact: true })
      .click();
  }
  await groupEditor
    .getByRole('button', { name: 'Review complete group', exact: true })
    .click();
  const groupReview = page.getByRole('region', {
    name: 'Review group proposal',
    exact: true,
  });
  await expect(groupReview).toContainText('Synthetic release muscle');
  expect(await rows('goal_groups')).toHaveLength(0);
  const groupDecision = page.waitForResponse(
    (response) =>
      response.url().endsWith('/api/approvals') &&
      response.request().method() === 'POST',
  );
  await groupReview
    .getByRole('button', { name: 'Approve group proposal', exact: true })
    .click();
  const groupResponse = await groupDecision;
  expect(groupResponse.status()).toBe(200);
  const groupId = (await groupResponse.json()).data.groupId as string;
  expect(await rows('goal_groups')).toHaveLength(1);
  expect(sends).toBe(2);
  scenario = 'v020_group_progress';
  await page.goto('/ask');
  await page
    .getByRole('button', { name: 'New conversation', exact: true })
    .click();
  await say(`Show current group progress, group:${groupId}`);
  const groupProgress = page.getByRole('region', {
    name: 'Group progress',
    exact: true,
  });
  await expect(groupProgress).toContainText('Synthetic release muscle');
  await expect(groupProgress).toContainText(
    'Each member keeps its own units, evidence dates and calculation.',
  );
  expect(sends).toBe(3);
  const beforeOverlap = (await rows('measurements'))
    .map((row) => row.id)
    .sort();
  const overlap = await renpho(fullPanel, panel.source);
  expect(overlap.committed).toEqual(panel.committed);
  expect((await rows('measurements')).map((row) => row.id).sort()).toEqual(
    beforeOverlap,
  );
  const enrichment = await renpho(
    'Date,Time,Weight(lb),Body Fat Percentage(%)\n2026.09.02,08:00:00,149,21\n',
    panel.source,
  );
  expect(enrichment.committed.inserted).toBe(1);
  expect(enrichment.committed.duplicate).toBe(1);
  expect(
    (await rows('goal_revisions')).find((row) => row.id === muscleRevision.id)
      ?.payload,
  ).toEqual(muscleRevision.payload);
  const today = new Date().toISOString().slice(0, 10);
  const csv =
    'observed_at,metric,value,unit,source,granularity,external_record_id,local_date,timezone,method\n' +
    [3, 2, 1]
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
      schema_version: 2,
      action: 'preview_csv',
      client_request_id: randomUUID(),
      csv_base64: Buffer.from(csv).toString('base64'),
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
          schema_version: 2,
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
  const weightProgress = page.getByRole('region', {
    name: 'Goal progress',
    exact: true,
  });
  await expect(weightProgress).toContainText('Current: 68.8');
  const exactProgressResponse = await page.request.get(
    '/api/goals?view=progress&id=' + new URL(goalUrl).searchParams.get('goal'),
    { headers },
  );
  expect(exactProgressResponse.status()).toBe(200);
  const exactProgress = (await exactProgressResponse.json()).data;
  expect(exactProgress.relativeChangePercent.length).toBeGreaterThan(1000);
  await expect(weightProgress).toContainText('Relative change -1.291%');
  expect(await weightProgress.textContent()).not.toMatch(/[+-]?\d+\.\d{20,}/);
  expect((await weightProgress.textContent())!.length).toBeLessThan(2500);
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth + 1,
    ),
  ).toBe(true);
  expect(sends).toBe(3);
  await page.screenshot({
    path: info.outputPath('release-progress.png'),
    fullPage: true,
  });
  const muscleReading = (await rows('measurements')).find(
    (row) =>
      row.source_id === panel.source && row.metric_key === 'renpho.muscle_mass',
  )!;
  expect(await rows('conversations')).toHaveLength(2);
  expect((await rows('messages')).length).toBeGreaterThanOrEqual(4);
  const corrected = await post('/api/data', {
    action: 'correct_measurement',
    measurement_id: muscleReading.id,
    expected_version: muscleReading.version,
    client_request_id: randomUUID(),
    changes: {
      value: '48',
      unit: 'kg',
      observed_at: '2026-09-01T08:00:00Z',
      timezone: 'UTC',
      local_date: null,
    },
  });
  expect(corrected.outcome).toBe('corrected');
  expect(await rows('conversations')).toEqual([]);
  expect(await rows('messages')).toEqual([]);
  expect(
    (await rows('goals')).find((row) => row.id === muscle.id)?.review_status,
  ).toBe('needs_review');
  await page.goto(historicalEvidenceUrl);
  await expect(page.getByRole('alert')).toContainText(
    'Original result unavailable',
  );
  await page.goto('/goals?group=' + groupId);
  await expect(
    page.getByRole('region', { name: 'Group progress', exact: true }),
  ).toContainText('The all-members condition is unavailable.');
  const removed = await post('/api/data', {
    action: 'delete_measurement',
    measurement_id: muscleReading.id,
    expected_version: corrected.version,
    client_request_id: randomUUID(),
  });
  expect(removed.outcome).toBe('deleted');
  expect(
    (await rows('measurements')).some((row) => row.id === muscleReading.id),
  ).toBe(false);
  const scrubbedBaseline = (
    (await rows('goal_revisions')).find((row) => row.id === muscleRevision.id)
      ?.payload as { baseline: unknown }
  ).baseline;
  expect(scrubbedBaseline).not.toEqual(muscleBaseline);
  expect(sends).toBe(3);
  await page.goto('/settings');
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download account JSON' }).click();
  const file = await (await download).path();
  expect(file).toBeTruthy();
  const exported = JSON.parse(readFileSync(file!, 'utf8'));
  expect(Object.keys(exported.sections).sort()).toEqual(
    [...accountExportSections].sort(),
  );
  expect(exported.sections.measurements.length).toBeGreaterThan(14);
  expect(exported.sections.goals).toHaveLength(2);
  expect(exported.sections.goal_groups).toHaveLength(1);
  expect(exported.sections.goal_group_members).toHaveLength(2);
  expect(exported.sections.conversations).toEqual([]);
  expect(exported.sections.messages).toEqual([]);
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
  expect(sends).toBe(3);
  for (const table of [
    'profiles',
    'measurements',
    'goals',
    'goal_groups',
    'goal_group_members',
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

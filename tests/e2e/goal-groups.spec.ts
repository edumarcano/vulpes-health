import { test, expect, type Locator } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { Temporal } from '@js-temporal/polyfill';
import { LocalSupabase } from '../helpers/local-supabase';
import { accounts, restrictNetwork, signIn } from './auth-helpers';
import type { GoalDefinition } from '../../shared/goals';
import type { z } from 'zod';
import type {
  GoalGroupDecisionSchema,
  GoalGroupProposalRowSchema,
} from '../../shared/goal-groups';

test('direct groups review every member atomically, preserve independent evidence and require fresh membership review', async ({
  page,
}, info) => {
  test.setTimeout(90_000);
  const db = new LocalSupabase();
  const owner = accounts[0]!.id;
  const source = randomUUID();
  const prefix = 'Synthetic group ' + source.slice(0, 8);
  const token = (
    JSON.parse(process.env.VULPES_TEST_ACCOUNTS_JSON!)[0] as { token: string }
  ).token;
  const headers = {
    Authorization: `Bearer ${token}`,
    'X-Vulpes-Data-Contract': '2',
  };
  const now = Temporal.Instant.from(new Date().toISOString());
  const today = now.toZonedDateTimeISO('UTC').startOfDay();
  const dates = [1, 2, 3].map((hours) => now.subtract({ hours }).toString());
  async function post(path: string, body: unknown) {
    return page.request.post(path, { headers, data: body });
  }
  async function get(view: string, id: string) {
    const response = await page.request.get(
      '/api/goals?view=' + view + '&id=' + id,
      { headers },
    );
    expect(response.status()).toBe(200);
    return (await response.json()).data;
  }
  async function rows(table: string) {
    return (await (
      await db.admin(
        `/rest/v1/${table}?user_id=eq.${owner}&select=*&order=id`,
        'GET',
      )
    ).json()) as Record<string, unknown>[];
  }
  const runsBefore = await rows('ai_runs');
  function definition(
    title: string,
    metric: 'weight' | 'renpho.muscle_mass',
    value: number,
  ): GoalDefinition {
    return {
      schemaVersion: 1,
      title,
      metric,
      unit: 'kg',
      sourceId: source,
      target: { direction: 'increase_to', value },
      method: 'device_estimate',
      granularity: 'instant',
      baselineMethod: 'latest_value',
      currentMethod: 'latest_value',
      baselineFrom: today.subtract({ days: 1 }).toInstant().toString(),
      baselineTo: today.add({ days: 1 }).toInstant().toString(),
      reportedBaseline: null,
      timezone: 'UTC',
      targetDate: null,
      constraints: [],
      proposedStrategy: null,
    };
  }
  async function decide(
    proposal: {
      id: string;
      payload_hash: string;
      target_version: number | null;
    },
    action = 'approve',
    requestId = randomUUID(),
  ) {
    const response = await post('/api/approvals', {
      action,
      proposal_id: proposal.id,
      payload_hash: proposal.payload_hash,
      expected_version: proposal.target_version,
      client_request_id: requestId,
    });
    expect(response.status()).toBe(200);
    return (await response.json()).data;
  }
  async function create(def: GoalDefinition) {
    const response = await post('/api/goals', {
      action: 'propose_create',
      client_request_id: randomUUID(),
      definition: def,
    });
    expect(response.status()).toBe(200);
    return decide((await response.json()).data);
  }
  async function uiApproval(review: Locator) {
    const wait = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/approvals') &&
        response.request().method() === 'POST',
    );
    await review
      .getByRole('button', { name: 'Approve group proposal', exact: true })
      .click();
    const response = await wait;
    expect(response.status()).toBe(200);
    return (await response.json()).data as z.infer<
      typeof GoalGroupDecisionSchema
    > & { outcome: 'approved' };
  }
  function reviewFor(name: string) {
    return page
      .getByRole('region', { name: 'Review group proposal', exact: true })
      .filter({ has: page.getByRole('heading', { name, exact: true }) });
  }
  let editorChecked = false;
  async function choose(sheet: Locator, goalId: string) {
    const control = sheet.getByRole('combobox', {
      name: 'Approved goal',
      exact: true,
    });
    await expect(control.locator(`option[value="${goalId}"]`)).toHaveCount(1);
    if (!editorChecked) {
      editorChecked = true;
      await page.setViewportSize({ width: 360, height: 800 });
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '200%';
      });
      for (const colorScheme of ['light', 'dark'] as const) {
        await page.emulateMedia({ colorScheme, reducedMotion: 'reduce' });
        await expect
          .poll(async () =>
            sheet
              .locator(
                '[data-slot="sheet-title"], [data-slot="sheet-description"], label',
              )
              .evaluateAll((elements) => {
                function luminance(color: string) {
                  const channels = color
                    .match(/[\d.]+/g)!
                    .slice(0, 3)
                    .map(Number)
                    .map((value) => {
                      const channel = value / 255;
                      return channel <= 0.04045
                        ? channel / 12.92
                        : ((channel + 0.055) / 1.055) ** 2.4;
                    });
                  return (
                    channels[0]! * 0.2126 +
                    channels[1]! * 0.7152 +
                    channels[2]! * 0.0722
                  );
                }
                if (elements.length < 3) return 0;
                return Math.min(
                  ...elements.map((element) => {
                    let surface: Element | null = element;
                    while (
                      surface &&
                      getComputedStyle(surface).backgroundColor ===
                        'rgba(0, 0, 0, 0)'
                    )
                      surface = surface.parentElement;
                    const foreground = luminance(
                      getComputedStyle(element).color,
                    );
                    const background = luminance(
                      getComputedStyle(surface!).backgroundColor,
                    );
                    return (
                      (Math.max(foreground, background) + 0.05) /
                      (Math.min(foreground, background) + 0.05)
                    );
                  }),
                );
              }),
          )
          .toBeGreaterThanOrEqual(4.5);
        const sheetBox = (await sheet.boundingBox())!;
        for (const input of [
          sheet.getByLabel('Group name', { exact: true }),
          control,
        ]) {
          const box = (await input.boundingBox())!;
          expect
            .soft(box.height, 'group editor controls retain 44px touch height')
            .toBeGreaterThanOrEqual(44);
          expect
            .soft(
              box.x + box.width,
              'group editor controls stay within sheet at 200% text',
            )
            .toBeLessThanOrEqual(sheetBox.x + sheetBox.width);
        }
        await page.screenshot({
          path: info.outputPath(`group-editor-${colorScheme}.png`),
          fullPage: false,
        });
      }
      await page.evaluate(() => {
        document.documentElement.style.fontSize = '';
      });
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.emulateMedia({ colorScheme: 'light' });
    }
    await control.selectOption(goalId, { timeout: 5000 });
    await expect(
      sheet.getByRole('heading', {
        name: 'Current approved definition',
        exact: true,
      }),
    ).toBeVisible();
  }
  await db.admin('/rest/v1/data_sources', 'POST', {
    id: source,
    user_id: owner,
    kind: 'manual',
    label: prefix,
    source_namespace: randomUUID(),
  });
  try {
    for (const [index, item] of [
      { metric: 'renpho.muscle_mass', unit: 'kg', value: '50' },
      { metric: 'weight', unit: 'kg', value: '70' },
      { metric: 'body_fat_percent', unit: '%', value: '20' },
    ].entries()) {
      expect(
        (
          await post('/api/data', {
            action: 'add_measurement',
            client_request_id: randomUUID(),
            source: { kind: 'existing', id: source },
            observation: {
              ...item,
              observed_at: dates[index],
              timezone: 'UTC',
              local_date: null,
              granularity: 'instant',
              method: 'device_estimate',
              quality_flags: [],
            },
          })
        ).status(),
      ).toBe(200);
    }
    const linked = await create(
      definition(prefix + ' linked muscle', 'renpho.muscle_mass', 50),
    );
    const revised = await create(
      definition(prefix + ' revised weight', 'weight', 70),
    );
    await restrictNetwork(page);
    await signIn(page);
    const dispatches: string[] = [];
    page.on('request', (request) => {
      if (request.url().includes('/api/chat')) dispatches.push(request.url());
    });
    await page.goto('/goals');
    await page.getByRole('button', { name: 'New Group', exact: true }).click();
    const sheet = page.getByRole('dialog');
    await sheet.getByLabel('Group name', { exact: true }).fill(prefix);
    await sheet
      .getByRole('button', { name: 'Add approved goal', exact: true })
      .click();
    await choose(sheet, linked.goalId);
    await sheet
      .getByRole('button', { name: 'Use current approved goal', exact: true })
      .click();
    await sheet
      .getByRole('button', { name: 'Add approved goal', exact: true })
      .click();
    await choose(sheet, revised.goalId);
    await sheet
      .getByRole('button', { name: 'Prepare member revision', exact: true })
      .click();
    await sheet.getByLabel('target', { exact: true }).fill('71');
    await sheet
      .getByRole('combobox', {
        name: 'Member baseline resolution',
        exact: true,
      })
      .selectOption('retain');
    await sheet
      .getByRole('button', { name: 'Save member draft', exact: true })
      .click();
    const proposalsBefore = (await rows('action_proposals')).length;
    const goalsBefore = (await rows('goals')).length;
    await sheet
      .getByRole('button', { name: 'Add new member', exact: true })
      .click();
    await sheet
      .getByLabel('Title', { exact: true })
      .fill(prefix + ' fat range');
    await sheet
      .getByLabel('Metric', { exact: true })
      .selectOption('body_fat_percent');
    await sheet.getByLabel('Source', { exact: true }).selectOption(source);
    await sheet
      .getByLabel('Measurement method', { exact: true })
      .selectOption('device_estimate');
    await sheet
      .getByLabel('Direction', { exact: true })
      .selectOption('maintain_range');
    await sheet.getByLabel('lower', { exact: true }).fill('19');
    await sheet.getByLabel('upper', { exact: true }).fill('21');
    await sheet
      .getByLabel('Baseline method', { exact: true })
      .selectOption('latest_value');
    await sheet
      .getByLabel('Baseline from', { exact: true })
      .fill(today.subtract({ days: 1 }).toInstant().toString());
    await sheet
      .getByLabel('Baseline to', { exact: true })
      .fill(today.add({ days: 1 }).toInstant().toString());
    await sheet
      .getByRole('button', { name: 'Save member draft', exact: true })
      .click();
    // Member editing is local: no pending children, active children or group writes.
    expect((await rows('action_proposals')).length).toBe(proposalsBefore);
    expect((await rows('goals')).length).toBe(goalsBefore);
    await sheet
      .getByRole('button', { name: 'Review complete group', exact: true })
      .click();
    await expect(sheet).not.toBeVisible();
    const review = reviewFor(prefix);
    for (const text of [
      'Member 1: ' + prefix + ' linked muscle',
      'Member 2: ' + prefix + ' revised weight',
      'Member 3: ' + prefix + ' fat range',
      'Link existing approved goal',
      'Revise approved goal',
      'Create a new goal',
      '71',
      '19–21',
      'Baseline: retain',
    ])
      await expect(review).toContainText(text);
    await expect(
      review.getByRole('button', {
        name: 'Approve group proposal',
        exact: true,
      }),
    ).toHaveCount(1);
    expect((await rows('goals')).length).toBe(goalsBefore);
    await page.reload();
    await expect(review).toBeVisible();
    const receipt = await uiApproval(review);
    expect(receipt.members).toHaveLength(3);
    expect(receipt.members.map((member) => member.position)).toEqual([1, 2, 3]);
    expect((await rows('goals')).length).toBe(goalsBefore + 1);
    await page.goto('/goals?group=' + receipt.groupId);
    const progress = page.getByRole('region', {
      name: 'Group progress',
      exact: true,
    });
    await expect(progress).toContainText(
      'At least one required member is not meeting its condition.',
    );
    for (const date of dates)
      await expect(progress).toContainText(date!.replace('Z', ''));
    await expect(progress.getByRole('link')).toHaveCount(3);
    // Replaying the actual parent receipt is idempotent across reloads.
    const approvedProposal = (await rows('action_proposals')).find(
      (row) => row.id === receipt.proposalId,
    )! as unknown as z.infer<typeof GoalGroupProposalRowSchema>;
    expect(await decide(approvedProposal)).toEqual(receipt);
    await page.reload();
    expect((await get('group_detail', receipt.groupId)).group.version).toBe(1);

    // A changed last member invalidates the entire pending group, including a new child.
    const conflictName = prefix + ' conflict';
    const pendingResponse = await post('/api/goals', {
      action: 'propose_group_create',
      client_request_id: randomUUID(),
      name: conflictName,
      members: [
        {
          kind: 'create',
          definition: definition(prefix + ' must not activate', 'weight', 80),
        },
        { kind: 'existing', goal_id: linked.goalId, expected_version: 1 },
      ],
    });
    expect(pendingResponse.status()).toBe(200);
    const pending = (await pendingResponse.json()).data;
    await page.goto('/goals');
    const conflictReview = reviewFor(conflictName);
    await expect(
      conflictReview.getByRole('button', {
        name: 'Approve group proposal',
        exact: true,
      }),
    ).toBeVisible();
    // Retain a genuinely stale rendered card while status refresh is offline.
    const pendingStatus = '**/api/goals?view=group_proposal&id=' + pending.id;
    await page.route(pendingStatus, (route) => route.abort('failed'));
    const stateResponse = await post('/api/goals', {
      action: 'propose_state',
      client_request_id: randomUUID(),
      goal_id: linked.goalId,
      expected_version: 1,
      state: 'paused',
    });
    expect(stateResponse.status()).toBe(200);
    await decide((await stateResponse.json()).data);
    const groupsBeforeConflict = (await rows('goal_groups')).length;
    const goalsBeforeConflict = (await rows('goals')).length;
    const rejected = page.waitForResponse(
      (response) =>
        response.url().endsWith('/api/approvals') &&
        response.request().postDataJSON()?.proposal_id === pending.id,
    );
    await conflictReview
      .getByRole('button', { name: 'Approve group proposal', exact: true })
      .click();
    expect((await rejected).status()).toBe(409);
    expect((await rows('goals')).length).toBe(goalsBeforeConflict);
    expect((await rows('goal_groups')).length).toBe(groupsBeforeConflict);
    await page.unroute(pendingStatus);
    await page
      .getByRole('region', { name: 'Group proposal', exact: true })
      .filter({ has: conflictReview })
      .getByRole('button', { name: 'Refresh group proposal', exact: true })
      .click();
    await expect(conflictReview).toContainText('conflicted');
    await expect(
      conflictReview.getByRole('button', {
        name: 'Approve group proposal',
        exact: true,
      }),
    ).toHaveCount(0);

    await page.goto('/goals?group=' + receipt.groupId);
    await expect(progress).toContainText('Needs review');
    await page.getByRole('button', { name: 'Edit group', exact: true }).click();
    await expect(
      sheet.getByRole('button', { name: 'Review complete group', exact: true }),
    ).toBeDisabled();
    await sheet
      .getByRole('button', { name: 'Choose or revise member 1', exact: true })
      .click();
    await choose(sheet, linked.goalId);
    await sheet
      .getByRole('button', { name: 'Use current approved goal', exact: true })
      .click();
    await sheet
      .getByRole('button', { name: 'Remove member 2', exact: true })
      .click();
    await sheet
      .getByRole('button', { name: 'Move member 2 up', exact: true })
      .click();
    await sheet
      .getByLabel('Group name', { exact: true })
      .fill(prefix + ' reordered');
    await sheet
      .getByRole('button', { name: 'Review complete group', exact: true })
      .click();
    const changed = reviewFor(prefix + ' reordered');
    await expect(changed).toContainText('Member 1: ' + prefix + ' fat range');
    await expect(changed).toContainText(
      'Member 2: ' + prefix + ' linked muscle',
    );
    await uiApproval(changed);
    await page.goto('/goals?group=' + receipt.groupId);
    await expect(progress).toContainText(
      'Every required member is currently meeting its condition.',
    );
    await expect(progress).toContainText('Goal state: paused');

    const archivedChildResponse = await post('/api/goals', {
      action: 'propose_state',
      client_request_id: randomUUID(),
      goal_id: linked.goalId,
      expected_version: 2,
      state: 'archived',
    });
    expect(archivedChildResponse.status()).toBe(200);
    await decide((await archivedChildResponse.json()).data);
    await page.reload();
    await expect(progress).toContainText('Archived member');
    await expect(progress).toContainText(
      'The all-members condition is unavailable.',
    );

    // Correction invalidates frozen evidence while preserving reviewed membership.
    const measurements = await rows('measurements');
    const fat = measurements.find(
      (row) =>
        row.source_id === source && row.metric_key === 'body_fat_percent',
    )!;
    expect(
      (
        await post('/api/data', {
          action: 'correct_measurement',
          measurement_id: fat.id,
          expected_version: fat.version,
          client_request_id: randomUUID(),
          changes: {
            value: '20.5',
            unit: '%',
            observed_at: dates[2],
            timezone: 'UTC',
            local_date: null,
          },
        })
      ).status(),
    ).toBe(200);
    await page.reload();
    await expect(progress).toContainText('Needs review');
    await expect(progress).toContainText(
      'The all-members condition is unavailable.',
    );
    // A group remains administratively archivable after private evidence was removed.
    await page
      .getByRole('button', { name: 'Review group archive', exact: true })
      .click();
    const archive = reviewFor(prefix + ' reordered').filter({
      has: page.getByText('Resulting group state: archived', { exact: false }),
    });
    await expect
      .soft(archive)
      .toContainText('Archiving this group does not change any member goal.');
    await expect.soft(archive).not.toContainText('Create a new goal');
    await uiApproval(archive);
    await page.goto('/goals?group=' + receipt.groupId);
    await expect(progress).toContainText('Administrative state: archived');
    await expect(progress).toContainText(
      'The all-members condition is unavailable.',
    );
    await expect(
      page.getByRole('button', { name: 'Edit group', exact: true }),
    ).toHaveCount(0);
    await progress
      .getByRole('link', {
        name: 'Open ' + prefix + ' fat range detail and history',
        exact: true,
      })
      .click();
    await expect(
      page.getByRole('heading', { name: prefix + ' fat range', exact: true }),
    ).toBeFocused();
    await expect(
      page.getByRole('heading', { name: 'Revision history', exact: true }),
    ).toBeVisible();
    let releaseDetail!: () => void;
    const detailGate = new Promise<void>((resolve) => {
      releaseDetail = resolve;
    });
    const detailUrl = '**/api/goals?view=group_detail&id=' + receipt.groupId;
    await page.route(detailUrl, async (route) => {
      const response = await route.fetch();
      await detailGate;
      await route.fulfill({ response });
    });
    await page.goto('/goals?group=' + receipt.groupId);
    await page.getByRole('button', { name: 'New Group', exact: true }).click();
    await sheet
      .getByLabel('Group name', { exact: true })
      .fill(prefix + ' delayed view');
    const detailReply = page.waitForResponse((response) =>
      response.url().includes('view=group_detail&id=' + receipt.groupId),
    );
    releaseDetail();
    await detailReply;
    await page.unroute(detailUrl);
    await expect(progress).toBeAttached();
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel('Group name', { exact: true })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(sheet).not.toBeVisible();
    await expect(
      page.getByRole('button', { name: 'New Group', exact: true }),
    ).toBeFocused();
    await expect(progress).toBeVisible();
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.setViewportSize({ width: 360, height: 800 });
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
      await page.screenshot({
        path: info.outputPath('group-' + colorScheme + '.png'),
        fullPage: true,
      });
    }
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
    // Keyboard cancellation does not register a proposal, and identity switch clears it.
    await page.getByRole('button', { name: 'New Group', exact: true }).focus();
    await page.keyboard.press('Enter');
    await sheet
      .getByLabel('Group name', { exact: true })
      .fill(prefix + ' unsaved');
    await page.keyboard.press('Escape');
    await expect(sheet).not.toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => ({
          tag: document.activeElement?.tagName,
          text: document.activeElement?.textContent?.trim().slice(0, 80),
        })),
      )
      .toEqual({ tag: 'BUTTON', text: 'New Group' });
    await page.goto('/settings');
    await page.getByRole('button', { name: 'Sign out', exact: true }).click();
    await signIn(page, 1);
    await page.goto('/goals?group=' + receipt.groupId);
    await expect(page.getByText(prefix, { exact: true })).toHaveCount(0);
    await expect(
      page.getByRole('region', { name: 'Group progress', exact: true }),
    ).toHaveCount(0);
    expect(dispatches).toEqual([]);
    expect(await rows('ai_runs')).toEqual(runsBefore);
  } finally {
    // Only this test's synthetic graph is removed, in FK/deferred-constraint order.
    const groups = (await rows('goal_groups')).filter((row) =>
      String(row.name).startsWith(prefix),
    );
    const goals = (await rows('goals')).filter((row) =>
      String(row.title).startsWith(prefix),
    );
    for (const group of groups) {
      await db.admin('/rest/v1/goal_groups?id=eq.' + group.id, 'PATCH', {
        state: 'archived',
        current_approval_id: null,
      });
      await db.admin(
        '/rest/v1/goal_group_members?group_id=eq.' + group.id,
        'DELETE',
      );
    }
    for (const goal of goals) {
      await db.admin('/rest/v1/goals?id=eq.' + goal.id, 'PATCH', {
        state: 'draft',
        current_revision_id: null,
      });
      await db.admin('/rest/v1/goal_revisions?goal_id=eq.' + goal.id, 'DELETE');
    }
    for (const proposal of await rows('action_proposals')) {
      const body = proposal.canonical_payload as {
        name?: string;
        definition?: { title?: string };
      } | null;
      if (
        String(proposal.summary).startsWith(prefix) ||
        goals.some((goal) => goal.id === proposal.target_id) ||
        groups.some((group) => group.id === proposal.group_target_id) ||
        body?.name?.startsWith(prefix) ||
        body?.definition?.title?.startsWith(prefix)
      )
        await db.admin(
          '/rest/v1/action_proposals?id=eq.' + proposal.id,
          'DELETE',
        );
    }
    for (const group of groups)
      await db.admin('/rest/v1/goal_groups?id=eq.' + group.id, 'DELETE');
    for (const goal of goals)
      await db.admin('/rest/v1/goals?id=eq.' + goal.id, 'DELETE');
    await db.admin('/rest/v1/measurements?source_id=eq.' + source, 'DELETE');
    await db.admin('/rest/v1/data_sources?id=eq.' + source, 'DELETE');
  }
});

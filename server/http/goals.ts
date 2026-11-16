import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { GoalMutationSchema } from '../../shared/goals.js';
import { GoalGroupMutationSchema } from '../../shared/goal-groups.js';
import { ApprovalRequestSchema } from '../../shared/api.js';
import { UUIDSchema } from '../../shared/primitives.js';
import { GoalService } from '../services/goals.js';
import { GoalGroupService } from '../services/goal-groups.js';
import { verifySession } from '../auth/session.js';
import { checkOrigin, readJson } from './request.js';
import { HttpFailure, respondFailure } from './failure.js';
import { sendJson, sendError } from './responses.js';

export async function handleGoals(
  request: IncomingMessage,
  response: ServerResponse,
) {
  try {
    checkOrigin(request);
    const context = await verifySession(request);
    const service = new GoalService(context);
    const groups = new GoalGroupService(context);
    const approval =
      new URL(request.url ?? '/', 'http://localhost').pathname ===
      '/api/approvals';
    if (request.method === 'POST') {
      const body = await readJson(request);
      const parsed = (
        approval
          ? ApprovalRequestSchema
          : z.union([GoalMutationSchema, GoalGroupMutationSchema])
      ).safeParse(body);
      if (!parsed.success)
        throw new HttpFailure(
          400,
          'invalid_input',
          'Check the goal fields and expected version.',
        );
      let result;
      if (parsed.data.action === 'approve' || parsed.data.action === 'reject') {
        const proposal = await service.proposal(parsed.data.proposal_id);
        result = proposal.kind.startsWith('goal_group.')
          ? await groups.decide(parsed.data)
          : await service.decide(parsed.data);
      } else if (parsed.data.action.startsWith('propose_group_')) {
        result = await groups.propose(
          GoalGroupMutationSchema.parse(parsed.data),
        );
      } else
        result = await service.propose(GoalMutationSchema.parse(parsed.data));
      sendJson(response, 200, { data: result });
      return;
    }
    if (request.method !== 'GET' || approval) {
      response.setHeader('Allow', approval ? 'POST' : 'GET, POST');
      sendError(
        response,
        405,
        'method_not_allowed',
        'This method is unavailable.',
      );
      return;
    }
    const params = new URL(request.url ?? '/', 'http://localhost').searchParams;
    if ([...params.keys()].some((k) => params.getAll(k).length !== 1))
      throw new HttpFailure(400, 'invalid_input', 'Use one value per filter.');
    const q = z
      .strictObject({
        view: z
          .enum([
            'list',
            'detail',
            'progress',
            'proposals',
            'proposal',
            'revisions',
            'groups',
            'group_detail',
            'group_progress',
            'group_proposals',
            'group_proposal',
          ])
          .default('list'),
        id: UUIDSchema.optional(),
        page_size: z.coerce.number().int().min(1).max(200).default(50),
        cursor: UUIDSchema.optional(),
      })
      .parse(Object.fromEntries(params));
    await service.expire();
    if (q.view === 'groups' || q.view === 'group_proposals') {
      const page = { page_size: q.page_size, cursor: q.cursor };
      sendJson(response, 200, {
        data:
          q.view === 'groups'
            ? await groups.list(page)
            : await groups.proposals(page),
      });
      return;
    }
    if (q.view.startsWith('group_')) {
      if (!q.id)
        throw new HttpFailure(
          400,
          'invalid_input',
          'Choose a group or proposal.',
        );
      sendJson(response, 200, {
        data:
          q.view === 'group_detail'
            ? await groups.detail(q.id)
            : q.view === 'group_progress'
              ? await groups.progress(q.id)
              : await groups.proposal(q.id),
      });
      return;
    }
    if (q.view === 'proposal') {
      if (!q.id)
        throw new HttpFailure(400, 'invalid_input', 'Choose a proposal.');
      const proposal = await service.proposal(q.id);
      if (!proposal.kind.startsWith('goal.'))
        throw new HttpFailure(
          404,
          'goal_not_found',
          'This goal proposal is unavailable.',
        );
      sendJson(response, 200, { data: proposal });
      return;
    }
    if (q.view === 'progress') {
      if (!q.id) throw new HttpFailure(400, 'invalid_input', 'Choose a goal.');
      sendJson(response, 200, { data: await service.progress(q.id) });
      return;
    }
    if (q.view === 'detail') {
      if (!q.id) throw new HttpFailure(400, 'invalid_input', 'Choose a goal.');
      sendJson(response, 200, {
        data: {
          ...(await service.revision(q.id)),
          progress: await service.progress(q.id),
          chart: await service.chart(q.id),
        },
      });
      return;
    }
    const table =
      q.view === 'proposals'
        ? 'action_proposals'
        : q.view === 'revisions'
          ? 'goal_revisions'
          : 'goals';
    let query = context.db
      .from(table)
      .select('*')
      .eq('user_id', context.userId)
      .order('id')
      .limit(q.page_size);
    if (table === 'goals') query = query.filter('state', 'neq', 'draft');
    if (table === 'action_proposals') query = query.like('kind', 'goal.%');
    if (q.view === 'revisions') {
      if (!q.id) throw new HttpFailure(400, 'invalid_input', 'Choose a goal.');
      await service.owned(q.id);
      query = query.filter('goal_id', 'eq', q.id);
    }
    if (q.cursor) {
      const anchor = await context.db
        .from(table)
        .select('id')
        .eq('user_id', context.userId)
        .eq('id', q.cursor)
        .maybeSingle();
      if (!anchor.data)
        throw new HttpFailure(400, 'invalid_cursor', 'Refresh the list.');
      query = query.gt('id', q.cursor);
    }
    const { data, error } = await query;
    if (error)
      throw new HttpFailure(
        503,
        'goals_unavailable',
        'Goals could not be loaded.',
      );
    sendJson(response, 200, {
      data: {
        items: data,
        nextCursor: data.length === q.page_size ? data.at(-1)?.id : null,
      },
    });
  } catch (error) {
    respondFailure(
      response,
      error instanceof z.ZodError
        ? new HttpFailure(400, 'invalid_input', 'Check the goal query.')
        : error,
    );
  }
}

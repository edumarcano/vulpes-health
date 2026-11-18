import { z } from 'zod';
import {
  ChatMessageSchema,
  ConversationSchema,
  MessagesPageSchema,
  type ConversationMutation,
  type ConversationQuery,
  type ChatMessage,
  type ChatPart,
  EvidenceSchema,
} from '../../shared/chat.js';
import { UUIDSchema } from '../../shared/primitives.js';
import type { AuthContext } from '../auth/session.js';
import { administrativeClient } from '../db/administrative.js';
import { ExecutionService, requestHash } from '../ai/ledger/execution.js';
import { readPayload } from '../security/private-payloads.js';
import { HttpFailure } from '../http/failure.js';
import {
  AgentAnalysisToolResultSchema,
  AgentGoalProgressToolResultSchema,
  analysisCardSnapshot,
} from '../../shared/agent-tools.js';
import {
  evidenceIsCurrent,
  type EvidenceProfile,
} from './evidence-freshness.js';
import { GoalService } from './goals.js';

export function savedCardMatches(part: ChatPart, output: unknown) {
  if (
    part.type === 'text' ||
    part.type === 'goal_proposal' ||
    part.type === 'goal_group_proposal'
  )
    return false;
  if (part.type === 'analysis_result') {
    const parsed = AgentAnalysisToolResultSchema.safeParse(output);
    const result = parsed.success
      ? parsed.data.data.results.find((item) => item.id === part.result.id)
      : undefined;
    return (
      !!result &&
      requestHash(part.result) ===
        requestHash(
          result.kind === 'series_analysis'
            ? analysisCardSnapshot(result)
            : result,
        )
    );
  }
  if (part.type === 'goal_group_progress')
    return requestHash(output) === requestHash(part.result);
  if (part.type === 'goal_progress') {
    const parsed = AgentGoalProgressToolResultSchema.safeParse(output);
    return parsed.success
      ? parsed.data.goalId === part.goalId &&
          parsed.data.goalVersion === part.goalVersion &&
          parsed.data.revisionId === part.revisionId &&
          requestHash(parsed.data.progress) === requestHash(part.result)
      : part.goalVersion === undefined &&
          part.revisionId === undefined &&
          requestHash(output) === requestHash(part.result);
  }
  return (
    requestHash(output) === requestHash({ kind: 'summary', data: part.result })
  );
}

const failed = () =>
  new HttpFailure(
    503,
    'conversations_unavailable',
    'Conversations could not be loaded or saved.',
  );
export class ConversationService {
  private readonly db = administrativeClient();
  constructor(private readonly context: AuthContext) {}
  async mutate(request: ConversationMutation) {
    const { data, error } = await this.db.rpc('mutate_conversation_v1', {
      p_owner: this.context.userId,
      p_request: request,
    });
    if (error) {
      const codes: Record<string, number> = {
        conversation_not_found: 404,
        idempotency_conflict: 409,
        account_unavailable: 403,
      };
      if (Object.hasOwn(codes, error.message))
        throw new HttpFailure(
          codes[error.message]!,
          error.message,
          'The conversation operation could not proceed. Refresh and review.',
        );
      throw failed();
    }
    return z
      .strictObject({
        id: UUIDSchema,
        outcome: z.enum(['create', 'archive', 'delete']),
      })
      .parse(data);
  }
  async owned(id: string) {
    const { data, error } = await this.context.db
      .from('conversations')
      .select('*')
      .eq('user_id', this.context.userId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw failed();
    if (!data)
      throw new HttpFailure(
        404,
        'conversation_not_found',
        'The conversation was not found.',
      );
    return ConversationSchema.parse({
      id: data.id,
      title: data.title,
      archived: data.archived,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    });
  }
  private async resolveEvidence(
    message: ChatMessage,
    profile: EvidenceProfile,
  ): Promise<ChatMessage> {
    const parts = [];
    for (const part of message.parts) {
      if (part.type === 'text') {
        parts.push(part);
        continue;
      }
      if (
        part.type === 'goal_proposal' ||
        part.type === 'goal_group_proposal'
      ) {
        // Resolve only the owned message binding here. Pending-body RLS expiry
        // must not erase the reference needed to display its terminal status.
        const { data, error } = await this.db
          .from('action_proposals')
          .select(
            'id,kind,payload_hash,target_version,source_message_id,source_run_id',
          )
          .eq('user_id', this.context.userId)
          .eq('source_message_id', message.id)
          .eq('id', part.reference.proposalId)
          .maybeSingle();
        if (error) throw failed();
        const valid =
          message.role === 'assistant' &&
          data?.source_message_id === message.id &&
          data.source_run_id === message.runId &&
          (part.type === 'goal_group_proposal'
            ? data.kind.startsWith('goal_group.')
            : data.kind.startsWith('goal.')) &&
          data.payload_hash === part.reference.payloadHash &&
          data.target_version === part.reference.expectedVersion;
        parts.push(
          valid
            ? part
            : {
                type: 'text' as const,
                text: 'The saved goal proposal is unavailable.',
              },
        );
        continue;
      }
      let valid =
        message.contextState === 'eligible' &&
        part.evidence.ownerId === this.context.userId &&
        part.evidence.runId === message.runId &&
        part.evidence.dataRevision === profile.data_revision;
      if (
        valid &&
        part.type === 'goal_progress' &&
        part.result.kind === 'progress'
      ) {
        try {
          const current = await new GoalService(this.context).revision(
            part.goalId,
          );
          valid =
            current.goal.review_status === 'clear' &&
            (!part.result.goalId || part.result.goalId === part.goalId) &&
            (part.result.goalVersion !== undefined
              ? current.goal.version === part.result.goalVersion
              : current.revision.revision_number === part.result.revision);
        } catch (error) {
          if (!(error instanceof HttpFailure) || error.status !== 404)
            throw error;
          valid = false;
        }
      }
      if (valid) {
        const step = await this.context.db
          .from('ai_steps')
          .select('output_payload_id,status,step_type')
          .eq('user_id', this.context.userId)
          .eq('run_id', message.runId!)
          .eq('id', part.evidence.stepId)
          .maybeSingle();
        if (step.error) throw failed();
        valid =
          step.data?.step_type === 'tool' &&
          step.data.status === 'completed' &&
          !!step.data.output_payload_id;
        if (valid) {
          const payload = await readPayload(
            this.context,
            step.data!.output_payload_id!,
            'tool_output',
          );
          valid = false;
          if (payload.state === 'available')
            try {
              const stored = z
                .object({
                  evidence: EvidenceSchema,
                  result: z.json(),
                })
                .parse(JSON.parse(payload.bytes.toString('utf8')));
              valid =
                requestHash(stored.evidence) === requestHash(part.evidence) &&
                savedCardMatches(part, stored.result) &&
                (part.type === 'goal_progress' &&
                part.goalVersion === undefined &&
                part.result.kind === 'progress'
                  ? true
                  : await evidenceIsCurrent(
                      this.context,
                      stored.result,
                      profile,
                    ));
            } catch {
              /* Unverifiable content cannot become a resolved card. */
            }
        }
      }
      parts.push(
        valid
          ? part
          : {
              type: 'text' as const,
              text:
                part.type === 'goal_progress' ||
                part.type === 'goal_group_progress'
                  ? 'The saved goal calculation is unavailable or belongs to an earlier goal or data revision. Open Goals for current progress.'
                  : 'The saved calculation evidence is unavailable or belongs to an earlier data revision. Open Data for current measurements.',
            },
      );
    }
    return { ...message, parts };
  }
  async read(query: ConversationQuery) {
    // Reconciliation is a status operation; it never reclaims execution ownership.
    await new ExecutionService(this.context).reconcile();
    const table = query.view === 'messages' ? 'messages' : 'conversations';
    const binding = query.view === 'messages' ? query.id : query.archived;
    const conversation =
      query.view === 'messages' ? await this.owned(query.id) : null;
    // Read run state first: terminal finalization also commits message status.
    // A transition during the later message read leaves an active run to poll,
    // rather than a terminal run paired with an older streaming message.
    const latest =
      query.view === 'messages'
        ? await this.context.db
            .from('ai_runs')
            .select('id')
            .eq('user_id', this.context.userId)
            .eq('conversation_id', query.id)
            .order('admitted_at', { ascending: false })
            .order('id', { ascending: false })
            .limit(1)
            .maybeSingle()
        : null;
    if (latest?.error) throw failed();
    const run = latest?.data
      ? await new ExecutionService(this.context).summary(latest.data.id)
      : null;
    let selection =
      query.view === 'messages'
        ? this.context.db
            .from('messages')
            .select('*')
            .eq('user_id', this.context.userId)
            .eq('conversation_id', query.id)
        : this.context.db
            .from('conversations')
            .select('*')
            .eq('user_id', this.context.userId)
            .eq('archived', query.archived === 'true');
    if (query.cursor) {
      try {
        const anchor = z
          .strictObject({
            owner: UUIDSchema,
            view: z.string(),
            binding: z.string(),
            id: UUIDSchema,
          })
          .parse(
            JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')),
          );
        if (
          anchor.owner !== this.context.userId ||
          anchor.view !== query.view ||
          anchor.binding !== binding
        )
          throw new Error();
        const { data, error } = await this.context.db
          .from(table)
          .select('*')
          .eq('user_id', this.context.userId)
          .eq('id', anchor.id)
          .maybeSingle();
        if (error) throw failed();
        if (
          !data ||
          (query.view === 'messages'
            ? !('conversation_id' in data) || data.conversation_id !== binding
            : !('archived' in data) || String(data.archived) !== binding)
        )
          throw new Error();
        selection = selection.or(
          `created_at.lt.${data.created_at},and(created_at.eq.${data.created_at},id.lt.${data.id})`,
        );
      } catch (error) {
        if (error instanceof HttpFailure) throw error;
        throw new HttpFailure(
          400,
          'invalid_cursor',
          'Refresh to restart conversation pagination.',
        );
      }
    }
    const { data, error } = await selection
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(query.page_size);
    if (error) throw failed();
    const last = data.at(-1);
    const nextCursor =
      data.length === query.page_size && last
        ? Buffer.from(
            JSON.stringify({
              owner: this.context.userId,
              view: query.view,
              binding,
              id: last.id,
            }),
          ).toString('base64url')
        : null;
    if (query.view === 'list')
      return {
        items: data.map((row) => {
          if (!('title' in row)) throw failed();
          return ConversationSchema.parse({
            id: row.id,
            title: row.title,
            archived: row.archived,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
          });
        }),
        nextCursor,
      };
    const profile = await this.context.db
      .from('profiles')
      .select('data_revision,timezone')
      .eq('user_id', this.context.userId)
      .single();
    if (profile.error) throw failed();
    return MessagesPageSchema.parse({
      conversation,
      items: await Promise.all(
        data.reverse().map(async (row) => {
          if (!('content_parts' in row)) throw failed();
          return this.resolveEvidence(
            ChatMessageSchema.parse({
              id: row.id,
              role: row.role,
              parts: row.content_parts,
              runId: row.run_id,
              status: row.status,
              contextState: row.context_state,
              createdAt: row.created_at,
            }),
            profile.data,
          );
        }),
      ),
      nextCursor,
      run,
    });
  }
}

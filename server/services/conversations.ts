import { z } from 'zod';
import {
  ChatMessageSchema,
  ChatPartSchema,
  ConversationSchema,
  MessagesPageSchema,
  type ConversationMutation,
  type ConversationQuery,
  type ChatMessage,
} from '../../shared/chat.js';
import { UUIDSchema } from '../../shared/primitives.js';
import type { AuthContext } from '../auth/session.js';
import { administrativeClient } from '../db/administrative.js';
import { ExecutionService, requestHash } from '../ai/ledger/execution.js';
import { readPayload } from '../security/private-payloads.js';
import { HttpFailure } from '../http/failure.js';

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
    revision: number,
  ): Promise<ChatMessage> {
    const parts = [];
    for (const part of message.parts) {
      if (part.type === 'text') {
        parts.push(part);
        continue;
      }
      if (part.type === 'goal_proposal') {
        // Resolve only the owned message binding here. Pending-body RLS expiry
        // must not erase the reference needed to display its terminal status.
        const { data, error } = await this.db
          .from('action_proposals')
          .select('id,payload_hash,target_version,source_message_id')
          .eq('user_id', this.context.userId)
          .eq('source_message_id', message.id)
          .eq('id', part.reference.proposalId)
          .maybeSingle();
        if (error) throw failed();
        const valid =
          message.role === 'assistant' &&
          data?.source_message_id === message.id &&
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
        part.evidence.dataRevision === revision;
      if (
        valid &&
        part.type === 'goal_progress' &&
        part.result.kind === 'progress'
      ) {
        const goal = await this.context.db
          .from('goals')
          .select('version,review_status,current_revision_id')
          .eq('user_id', this.context.userId)
          .eq('id', part.goalId)
          .maybeSingle();
        if (goal.error) throw failed();
        valid =
          !!goal.data &&
          goal.data.review_status === 'clear' &&
          (!part.result.goalId || part.result.goalId === part.goalId);
        if (valid && part.result.goalVersion !== undefined)
          valid = goal.data!.version === part.result.goalVersion;
        else if (valid) {
          const current = await this.context.db
            .from('goal_revisions')
            .select('revision_number')
            .eq('user_id', this.context.userId)
            .eq('goal_id', part.goalId)
            .eq('id', goal.data!.current_revision_id!)
            .maybeSingle();
          if (current.error) throw failed();
          valid = current.data?.revision_number === part.result.revision;
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
                  evidence: ChatPartSchema.options[1].shape.evidence,
                  result: z.json(),
                })
                .parse(JSON.parse(payload.bytes.toString('utf8')));
              const result =
                part.type === 'metric_summary'
                  ? { kind: 'summary', data: part.result }
                  : part.result;
              valid =
                requestHash(stored.evidence) === requestHash(part.evidence) &&
                requestHash(stored.result) === requestHash(result);
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
                part.type === 'goal_progress'
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
    const latest = await this.context.db
      .from('ai_runs')
      .select('id')
      .eq('user_id', this.context.userId)
      .eq('conversation_id', query.id)
      .order('admitted_at', { ascending: false })
      .order('id', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (latest.error) throw failed();
    const profile = await this.context.db
      .from('profiles')
      .select('data_revision')
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
            profile.data.data_revision,
          );
        }),
      ),
      nextCursor,
      run: latest.data
        ? await new ExecutionService(this.context).summary(latest.data.id)
        : null,
    });
  }
}

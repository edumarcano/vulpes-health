import {
  ChatPartSchema,
  type ChatMessage,
  type ChatPart,
} from '../../../shared/chat';

// Only the server-issued card event reaches this parser. Model prose remains text.
export function chatPartFromCard(card: unknown): ChatPart | null {
  const parsed = ChatPartSchema.safeParse(card);
  return parsed.success && parsed.data.type !== 'text' ? parsed.data : null;
}

export function evidencePartAvailable(
  part: ChatPart,
  message: Pick<ChatMessage, 'contextState' | 'runId'>,
  ownerId: string | undefined,
): boolean {
  if (
    part.type === 'text' ||
    part.type === 'goal_proposal' ||
    part.type === 'goal_group_proposal'
  )
    return true;
  return (
    message.contextState === 'eligible' &&
    part.evidence.ownerId === ownerId &&
    part.evidence.runId === message.runId &&
    (!('dataRevision' in part.result) ||
      part.result.dataRevision === part.evidence.dataRevision)
  );
}

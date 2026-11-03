import { getRoleAvailability } from '../config/models.js';
import { readServerEnvironment } from '../config/environment.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  ConversationMutationSchema,
  ConversationQuerySchema,
} from '../../shared/chat.js';
import { verifySession } from '../auth/session.js';
import { ConversationService } from '../services/conversations.js';
import type { ChatComposition } from './chat.js';
import { checkOrigin, readJson } from './request.js';
import { sendError, sendJson } from './responses.js';
import { HttpFailure, respondFailure } from './failure.js';

export function createConversationsHandler(
  composition: ChatComposition = () => null,
  availability?: () => 'available' | 'unavailable',
) {
  return async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    try {
      checkOrigin(request);
      const context = await verifySession(request);
      const service = new ConversationService(context);
      if (request.method === 'GET') {
        const params = new URL(request.url ?? '/', 'http://localhost')
          .searchParams;
        if ([...params.keys()].some((key) => params.getAll(key).length !== 1))
          throw new HttpFailure(
            400,
            'invalid_input',
            'Use one value per filter.',
          );
        const input: Record<string, unknown> = {
          view: 'list',
          ...Object.fromEntries(params),
        };
        if ('page_size' in input)
          input.page_size = /^\d+$/.test(String(input.page_size))
            ? Number(input.page_size)
            : NaN;
        const parsed = ConversationQuerySchema.safeParse(input);
        if (!parsed.success)
          throw new HttpFailure(
            400,
            'invalid_input',
            'Choose valid conversation filters.',
          );
        sendJson(response, 200, {
          data: {
            ...(await service.read(parsed.data)),
            ...(parsed.data.view === 'list'
              ? {
                  availability: availability
                    ? availability()
                    : composition(context)
                      ? 'synthetic'
                      : 'unavailable',
                }
              : {}),
          },
        });
        return;
      }
      if (request.method === 'POST') {
        const parsed = ConversationMutationSchema.safeParse(
          await readJson(request),
        );
        if (!parsed.success)
          throw new HttpFailure(
            400,
            'invalid_input',
            'Choose valid conversation fields; deletion requires confirmation.',
          );
        sendJson(response, 200, { data: await service.mutate(parsed.data) });
        return;
      }
      response.setHeader('Allow', 'GET, POST');
      sendError(
        response,
        405,
        'method_not_allowed',
        'Use GET or POST for this endpoint.',
      );
    } catch (error) {
      respondFailure(response, error);
    }
  };
}
export const handleConversations = createConversationsHandler(
  () => null,
  () =>
    getRoleAvailability(
      'everyday',
      readServerEnvironment(process.env).liveAiRequested,
    ).state === 'available'
      ? 'available'
      : 'unavailable',
);

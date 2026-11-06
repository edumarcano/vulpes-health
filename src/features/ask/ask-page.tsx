import { lazy, Suspense, useEffect, useReducer, useRef, useState } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQueryClient,
  type InfiniteData,
} from '@tanstack/react-query';
import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
} from '@assistant-ui/react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowRight, History, LockKeyhole, Plus, Sparkles } from 'lucide-react';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { HistoryDrawer } from '../executions/history-drawer';
import { useAuth } from '@/lib/auth/auth-context';
import { ownedJson } from '@/lib/api';
import {
  ErrorEnvelopeSchema,
  successEnvelopeSchema,
  type ChatSendRequest,
} from '../../../shared/api';
import {
  ChatPartSchema,
  ConversationsPageSchema,
  MessagesPageSchema,
  type ChatMessage,
  type MessagesPage,
} from '../../../shared/chat';
import { StreamDecoder, isTerminalEvent } from '../../../shared/stream';
import { AdmissionResultSchema } from '../../../shared/executions';
import { askReducer, initialAskState } from './state';
import { ProposalPart, ProgressPart } from './goal-parts';
import { InspectionBoundary } from '../executions/inspection-boundary';
const LazyMarkdownText = lazy(() =>
  import('./markdown-text').then((m) => ({ default: m.MarkdownText })),
);
function MarkdownText({ text }: { text: string }) {
  return (
    <Suspense fallback={plainText({ text })}>
      <LazyMarkdownText />
    </Suspense>
  );
}
const Inspector = lazy(() => import('../executions/inspector'));

function Welcome() {
  return (
    <>
      <Card className="welcome-card">
        <div className="feature-symbol">
          <Sparkles size={24} aria-hidden="true" />
        </div>
        <h2>Your data comes first.</h2>
        <p>
          Explore your measurements and work toward goals you choose. Start a
          conversation to ask a question. Opening this page makes no model
          requests.
        </p>
        <Button asChild>
          <Link to="/data">
            Explore Data <ArrowRight size={16} aria-hidden="true" />
          </Link>
        </Button>
      </Card>
      <section className="sample-questions" aria-label="Suggested questions">
        <h2>Questions to explore when chat is available</h2>
        <ul>
          <li>How has my weight changed over time?</li>
          <li>Do I have enough data to see a trend?</li>
        </ul>
      </section>
    </>
  );
}
function SummaryPart({ data }: { data: unknown }) {
  const parsed = ChatPartSchema.safeParse(data);
  if (!parsed.success || parsed.data.type !== 'metric_summary')
    return <p>Evidence is unavailable.</p>;
  const { result } = parsed.data;
  const a = result.analysis;
  return (
    <Card className="chat-evidence">
      <h3>Calculated measurement summary</h3>
      <p>
        {a.coverageStatus !== 'sufficient'
          ? 'Insufficient observations for this summary.'
          : a.statistic === 'daily_totals'
            ? 'Daily totals are shown separately; no combined mean is calculated.'
            : a.statistic === 'session_observations'
              ? 'Sessions are shown separately; no combined mean is calculated.'
              : a.value === null
                ? 'A headline value is unavailable for this summary.'
                : a.statistic === 'observed_samples'
                  ? `Observed median: ${a.value} ${a.unit}.`
                  : `${a.value} ${a.unit}; ${a.absoluteChange === null ? 'previous-window change unavailable' : `change ${a.absoluteChange} ${a.unit}`}`}
      </p>
      <p>
        {a.validDays} valid days · {a.observationCount} observations ·{' '}
        {a.algorithmVersion}
      </p>
      <p>
        {result.selection.method} · {result.selection.granularity} ·{' '}
        {result.selection.timezone}
      </p>
      <p>
        {result.selection.from} to {result.selection.to} (end excluded)
      </p>
      <Button asChild variant="outline">
        <Link to="/data">Open Data</Link>
      </Button>
    </Card>
  );
}
const plainText = ({ text }: { text: string }) => (
  <p className="chat-text">{text}</p>
);

function AskThread({
  id,
  availability,
  locked,
}: {
  id: string | null;
  availability: 'synthetic' | 'unavailable' | 'available';
  locked: boolean;
}) {
  const { state: auth, scope } = useAuth();
  const session = auth.kind === 'signed_in' ? auth.session : null;
  const epoch = scope.epoch;
  const client = useQueryClient();
  const root = ['conversations', session?.user.id, epoch];
  const key = [...root, 'messages', id];
  const [state, dispatch] = useReducer(askReducer, initialAskState);
  const lock = useRef(false);
  const abort = useRef<AbortController | null>(null);
  const [existingConversation, setExistingConversation] = useState<
    string | null
  >(null);
  const [inspection, setInspection] = useState<string | null>(null);
  const inspectionTrigger = useRef<HTMLButtonElement | null>(null);
  const query = useInfiniteQuery({
    queryKey: key,
    enabled: !!session && !!id,
    initialPageParam: null as string | null,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal, pageParam }) =>
      successEnvelopeSchema(MessagesPageSchema).parse(
        await ownedJson(
          '/api/conversations?' +
            new URLSearchParams({
              view: 'messages',
              id: id!,
              ...(pageParam ? { cursor: pageParam } : {}),
            }),
          session!.access_token,
          scope,
          epoch,
          { signal },
        ),
      ).data,
    getNextPageParam: (page) => page.nextCursor,
    refetchInterval: (q) =>
      q.state.data?.pages[0]?.run &&
      ['admitted', 'running', 'cancellation_requested'].includes(
        q.state.data.pages[0].run.state,
      )
        ? 1000
        : false,
  });
  useEffect(() => () => abort.current?.abort(), []);
  useEffect(() => {
    if (state.phase === 'loading' && (!id || query.data))
      dispatch({ type: 'ready' });
  }, [state.phase, id, query.data]);
  const pages = query.data?.pages ?? [];
  const latest = pages[0];
  const messages = [
    ...new Map(
      [...pages]
        .reverse()
        .flatMap((page) => page.items)
        .map((message) => [message.id, message]),
    ).values(),
  ];
  const activeRun =
    latest?.run &&
    ['admitted', 'running', 'cancellation_requested'].includes(latest.run.state)
      ? latest.run
      : null;
  const busy =
    ['submitting', 'streaming', 'stopping'].includes(state.phase) ||
    !!activeRun;
  const retryText =
    state.attemptText ||
    [...messages]
      .reverse()
      .find(
        (message) =>
          message.role === 'user' && message.runId === latest?.run?.id,
      )
      ?.parts.filter((part) => part.type === 'text')
      .map((part) => part.text)
      .join('\n') ||
    '';
  async function recover(notice: string) {
    scope.commit(epoch, () => dispatch({ type: 'recover', notice }));
    await query.refetch();
    await client.invalidateQueries({ queryKey: [...root, 'list'] });
  }
  const send = useMutation({
    retry: false,
    mutationFn: async (text: string) => {
      if (!session || !id || lock.current)
        throw new Error('Choose a conversation before sending.');
      if (scope.epoch !== epoch || scope.userId !== session.user.id)
        throw new DOMException('The account changed.', 'AbortError');
      lock.current = true;
      const owner = scope.capture();
      const controller = new AbortController();
      abort.current = controller;
      const input: ChatSendRequest = {
        action: 'send',
        conversation_id: id,
        client_request_id: crypto.randomUUID(),
        message: { id: crypto.randomUUID(), text },
        depth: 'auto',
        context_selection: null,
      };
      let protocol = askReducer(initialAskState, { type: 'submit', text });
      dispatch({ type: 'submit', text });
      try {
        const response = await fetch('/api/chat', {
          method: 'POST',
          cache: 'no-store',
          signal: AbortSignal.any([owner.signal, controller.signal]),
          headers: {
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(input),
        });
        if (!owner.current()) return;
        if (!response.ok) {
          const failure = ErrorEnvelopeSchema.safeParse(await response.json());
          throw new Error(
            failure.success
              ? failure.data.error.message
              : 'The response could not start.',
          );
        }
        if (
          response.headers.get('content-type')?.startsWith('application/json')
        ) {
          const existing = successEnvelopeSchema(AdmissionResultSchema).parse(
            await response.json(),
          ).data;
          if (owner.current())
            setExistingConversation(
              existing.kind === 'retained'
                ? existing.conversationId
                : existing.run.conversationId,
            );
          await recover(
            'This request already exists or another run is active. Reading saved state.',
          );
          return;
        }
        if (
          !response.headers
            .get('content-type')
            ?.startsWith('text/event-stream') ||
          !response.body
        )
          throw new Error('The response stream is unavailable.');
        const decoder = new StreamDecoder();
        let terminal = false;
        const reader = response.body.getReader();
        while (true) {
          const next = await reader.read();
          if (!owner.current()) return;
          if (next.done) break;
          for (const event of decoder.push(next.value)) {
            if (!owner.current()) return;
            const previous = protocol;
            protocol = askReducer(protocol, { type: 'event', event });
            if (protocol.phase === 'recovering')
              throw new Error(protocol.notice);
            if (protocol === previous) continue;
            dispatch({ type: 'event', event });
            client.setQueryData<InfiniteData<MessagesPage>>(key, (old) => {
              if (!old || !owner.current()) return old;
              const first = old.pages[0]!;
              let items = [...first.items];
              if (event.type === 'run.started') {
                if (!items.some((m) => m.id === input.message.id))
                  items.push({
                    id: input.message.id,
                    role: 'user',
                    parts: [{ type: 'text', text }],
                    runId: event.run_id,
                    status: 'completed',
                    contextState: 'eligible',
                    createdAt: new Date().toISOString(),
                  });
                if (
                  !items.some(
                    (m) => m.id === event.payload.assistant_message_id,
                  )
                )
                  items.push({
                    id: event.payload.assistant_message_id,
                    role: 'assistant',
                    parts: [],
                    runId: event.run_id,
                    status: 'streaming',
                    contextState: 'eligible',
                    createdAt: new Date().toISOString(),
                  });
              }
              if (event.type === 'text.delta')
                items = items.map((m) =>
                  m.id !== event.payload.message_id
                    ? m
                    : {
                        ...m,
                        parts: [
                          ...m.parts.filter((p) => p.type !== 'text'),
                          {
                            type: 'text',
                            text:
                              m.parts
                                .filter((p) => p.type === 'text')
                                .map((p) => p.text)
                                .join('') + event.payload.text,
                          },
                        ],
                      },
                );
              if (
                event.type === 'card.ready' &&
                event.payload.card.type === 'goal_proposal' &&
                'reference' in event.payload.card
              ) {
                const part = ChatPartSchema.parse({
                  type: 'goal_proposal',
                  reference: event.payload.card.reference,
                });
                items = items.map((m) =>
                  m.id === event.payload.message_id
                    ? { ...m, parts: [...m.parts, part] }
                    : m,
                );
              }
              return {
                ...old,
                pages: [{ ...first, items }, ...old.pages.slice(1)],
              };
            });
            if (isTerminalEvent(event)) terminal = true;
          }
        }
        decoder.finish();
        if (!terminal)
          throw new Error(
            'The stream disconnected. Reading the saved prefix; inference will not restart.',
          );
        await query.refetch();
        await client.invalidateQueries({ queryKey: [...root, 'list'] });
      } catch (error) {
        controller.abort();
        if (owner.current())
          await recover(
            error instanceof Error
              ? error.message
              : 'The response stopped. Refresh saved status.',
          );
      } finally {
        lock.current = false;
        owner.release();
        abort.current = null;
      }
    },
  });
  const stop = useMutation({
    retry: false,
    mutationFn: async () => {
      const runId = state.runId ?? activeRun?.id;
      if (!session || !runId) return;
      dispatch({ type: 'stop' });
      try {
        await ownedJson('/api/chat', session.access_token, scope, epoch, {
          method: 'POST',
          body: JSON.stringify({
            action: 'cancel',
            run_id: runId,
            client_request_id: crypto.randomUUID(),
          }),
        });
        abort.current?.abort();
        await recover(
          'Stop requested. Reading saved status; usage may remain pending.',
        );
      } catch (error) {
        scope.commit(epoch, () =>
          dispatch({
            type: 'recover',
            notice:
              error instanceof Error
                ? error.message
                : 'Stop could not be confirmed. Refresh saved status.',
          }),
        );
      }
    },
  });
  const runtime = useExternalStoreRuntime<ChatMessage>({
    messages,
    isRunning: busy,
    isDisabled:
      locked ||
      availability === 'unavailable' ||
      !id ||
      query.isPending ||
      latest?.conversation.archived === true ||
      query.isError,
    isSendDisabled: busy,
    onNew: async (message: AppendMessage) => {
      await send.mutateAsync(
        message.content
          .filter((part) => part.type === 'text')
          .map((part) => part.text)
          .join('\n'),
      );
    },
    onCancel: async () => {
      await stop.mutateAsync();
    },
    hasEarlier: query.hasNextPage,
    onLoadEarlier: async () => {
      await query.fetchNextPage();
    },
    convertMessage: (message) => ({
      id: message.id,
      role: message.role,
      createdAt: new Date(message.createdAt),
      content: message.parts.map((part) => {
        if (part.type === 'text')
          return { type: 'text' as const, text: part.text };
        if (part.type === 'goal_proposal')
          return { type: 'data' as const, name: 'goal_proposal', data: part };
        if (
          message.contextState !== 'eligible' ||
          part.evidence.ownerId !== session?.user.id ||
          part.evidence.runId !== message.runId ||
          (part.type === 'metric_summary' &&
            part.result.dataRevision !== part.evidence.dataRevision)
        )
          return {
            type: 'text' as const,
            text: 'Evidence is unavailable or was invalidated.',
          };
        return { type: 'data' as const, name: part.type, data: part };
      }),
      ...(message.role === 'assistant'
        ? {
            status:
              message.status === 'streaming'
                ? { type: 'running' as const }
                : message.status === 'completed'
                  ? { type: 'complete' as const, reason: 'stop' as const }
                  : { type: 'incomplete' as const, reason: 'error' as const },
          }
        : {}),
      metadata: { ...(message.runId ? { runId: message.runId } : {}) },
    }),
  });
  const notice =
    state.notice ||
    (activeRun
      ? 'Recovering saved run status. Inference will not restart.'
      : query.isPending && id
        ? 'Loading conversation…'
        : query.isError
          ? 'Conversation could not be loaded.'
          : '');
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <ThreadPrimitive.Root className="conversation" aria-label="Conversation">
        <ThreadPrimitive.Viewport className="conversation-viewport">
          {query.hasNextPage && (
            <Button
              variant="outline"
              onClick={() => void query.fetchNextPage()}
              disabled={query.isFetchingNextPage}
            >
              Load earlier messages
            </Button>
          )}
          {!messages.length && !query.isError && <Welcome />}
          <ThreadPrimitive.Messages>
            {({ message }) => {
              const runId = messages.find(
                (item) => item.id === message.id,
              )?.runId;
              const runAccounting =
                runId && latest?.run?.id === runId ? latest.run : null;
              return (
                <MessagePrimitive.Root
                  className={`chat-message chat-${message.role}`}
                >
                  <p className="chat-speaker">
                    {message.role === 'user' ? 'You' : 'Vulpes'}
                  </p>
                  <MessagePrimitive.Parts
                    components={{
                      Text:
                        message.role === 'assistant' ? MarkdownText : plainText,
                      data: {
                        by_name: {
                          metric_summary: SummaryPart,
                          goal_proposal: ProposalPart,
                          goal_progress: ProgressPart,
                        },
                      },
                    }}
                  />
                  {message.role === 'assistant' &&
                    message.status.type === 'incomplete' && (
                      <p className="incomplete-badge">Incomplete response</p>
                    )}
                  {message.role === 'assistant' && runId && (
                    <div className="message-run-meta">
                      {runAccounting && (
                        <p role="status" className="availability-note">
                          Run {runAccounting.state} · {runAccounting.costStatus}{' '}
                          ·{' '}
                          {runAccounting.costUSD === null
                            ? 'Total cost unknown'
                            : `$${runAccounting.costUSD}`}{' '}
                          · held ${runAccounting.reservationUSD}
                        </p>
                      )}
                      <Button
                        variant="outline"
                        onClick={(event) => {
                          inspectionTrigger.current = event.currentTarget;
                          setInspection(runId);
                        }}
                      >
                        Inspect execution
                      </Button>
                    </div>
                  )}
                </MessagePrimitive.Root>
              );
            }}
          </ThreadPrimitive.Messages>
          <p role="status" aria-live="polite" className="chat-status">
            {notice}
          </p>
          {availability === 'unavailable' && (
            <p id="chat-unavailable" className="availability-note">
              <LockKeyhole size={14} aria-hidden="true" />
              Ask is unavailable until provider verification and activation
              pass. Review consent and spending in Settings.
            </p>
          )}
          {availability === 'synthetic' && (
            <p className="availability-note">
              Local synthetic verification. No live provider calls.
            </p>
          )}
          {state.phase === 'recovering' && (
            <Button
              variant="outline"
              onClick={() => void recover('Reading saved status.')}
            >
              Refresh saved status
            </Button>
          )}
          {existingConversation && (
            <Button asChild variant="outline">
              <Link
                to={`/ask?conversation=${encodeURIComponent(existingConversation)}`}
              >
                Open current run
              </Link>
            </Button>
          )}
          {retryText &&
            !busy &&
            (state.phase === 'recovering' ||
              (latest?.run &&
                ['failed', 'cancelled', 'interrupted'].includes(
                  latest.run.state,
                ))) && (
              <Button
                variant="outline"
                disabled={
                  availability === 'unavailable' ||
                  latest?.conversation.archived
                }
                onClick={() => send.mutate(retryText)}
              >
                Send again as a new request (may incur another charge)
              </Button>
            )}
          {query.isError && (
            <Button variant="outline" onClick={() => void query.refetch()}>
              Reload conversation
            </Button>
          )}
          <p className="wellness-note text-center text-xs text-muted-foreground my-2">
            Personal wellness information. Not medical diagnosis or emergency
            monitoring.
          </p>
        </ThreadPrimitive.Viewport>
        <div className="composer-area">
          <ComposerPrimitive.Root className="composer">
            <ComposerPrimitive.Input
              aria-label="Message Ask Vulpes"
              placeholder="Ask about your measurements…"
              rows={1}
            />
            {busy ? (
              <Button
                onClick={() => void stop.mutateAsync()}
                disabled={stop.isPending || (!state.runId && !activeRun)}
              >
                Stop
              </Button>
            ) : (
              <ComposerPrimitive.Send asChild>
                <Button>Send</Button>
              </ComposerPrimitive.Send>
            )}
          </ComposerPrimitive.Root>
        </div>
      </ThreadPrimitive.Root>
      {inspection && (
        <InspectionBoundary
          onClose={() => {
            setInspection(null);
            inspectionTrigger.current?.focus();
          }}
        >
          <Suspense fallback={<p role="status">Loading inspector…</p>}>
            <Inspector
              run={inspection}
              onClose={() => {
                setInspection(null);
                inspectionTrigger.current?.focus();
              }}
            />
          </Suspense>
        </InspectionBoundary>
      )}
    </AssistantRuntimeProvider>
  );
}

export function AskPage() {
  const { state, scope } = useAuth();
  const session = state.kind === 'signed_in' ? state.session : null;
  const epoch = scope.epoch;
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const [archived, setArchived] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const historyTrigger = useRef<HTMLButtonElement | null>(null);
  const [notice, setNotice] = useState('');
  const root = ['conversations', session?.user.id, epoch];
  const list = useInfiniteQuery({
    queryKey: [...root, 'list', archived],
    enabled: !!session,
    initialPageParam: null as string | null,
    retry: false,
    refetchOnWindowFocus: false,
    queryFn: async ({ signal, pageParam }) =>
      successEnvelopeSchema(ConversationsPageSchema).parse(
        await ownedJson(
          '/api/conversations?' +
            new URLSearchParams({
              archived: String(archived),
              ...(pageParam ? { cursor: pageParam } : {}),
            }),
          session!.access_token,
          scope,
          epoch,
          { signal },
        ),
      ).data,
    getNextPageParam: (page) => page.nextCursor,
  });
  const items = list.data?.pages.flatMap((page) => page.items) ?? [];
  const id = params.get('conversation') ?? items[0]?.id ?? null;
  const mutation = useMutation({
    retry: false,
    mutationFn: async (action: 'create' | 'archive' | 'delete') => {
      if (!session) return;
      const target = action === 'create' ? crypto.randomUUID() : id;
      if (!target) return;
      const result = await ownedJson(
        '/api/conversations',
        session.access_token,
        scope,
        epoch,
        {
          method: 'POST',
          body: JSON.stringify({
            action,
            id: target,
            client_request_id: crypto.randomUUID(),
            ...(action === 'delete' ? { confirm: true } : {}),
          }),
        },
      );
      const checked = successEnvelopeSchema(
        z.strictObject({
          id: z.uuid(),
          outcome: z.enum(['create', 'archive', 'delete']),
        }),
      ).parse(result).data;
      scope.commit(epoch, () => {
        setParams(action === 'create' ? { conversation: checked.id } : {});
        setNotice(
          action === 'create'
            ? 'Conversation created.'
            : action === 'archive'
              ? 'Conversation archived.'
              : 'Conversation deleted.',
        );
      });
      await client.invalidateQueries({ queryKey: root });
    },
    onError: (error) =>
      scope.commit(epoch, () =>
        setNotice(
          error instanceof Error
            ? error.message
            : 'The conversation operation failed.',
        ),
      ),
  });
  return (
    <div className="ask-page">
      <header className="chat-canvas-header">
        <Button
          variant="ghost"
          size="sm"
          ref={historyTrigger}
          aria-label="Conversation history"
          onClick={() => setHistoryOpen(true)}
        >
          <History className="h-4 w-4" />
          <span className="hidden sm:inline">History</span>
        </Button>
        <h1 tabIndex={-1} className="text-base font-semibold">
          Ask Vulpes
        </h1>
        <Button
          size="sm"
          aria-label="New conversation"
          onClick={() => mutation.mutate('create')}
          disabled={mutation.isPending}
        >
          <Plus className="h-4 w-4" />
          <span>New conversation</span>
        </Button>
      </header>

      {notice && (
        <p
          role="status"
          className="chat-status absolute top-12 left-0 right-0 z-10 text-xs text-muted-foreground px-4 py-1.5 border-b border-border bg-card/95 backdrop-blur-xs text-center"
        >
          {notice}
        </p>
      )}

      <HistoryDrawer
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          historyTrigger.current?.focus();
        }}
        items={items}
        currentId={id}
        onSelect={(selectedId) => {
          setParams({ conversation: selectedId });
          setHistoryOpen(false);
        }}
        archived={archived}
        onArchivedChange={(val) => {
          setArchived(val);
          setParams({});
        }}
        onArchive={() => mutation.mutate('archive')}
        onDelete={() => mutation.mutate('delete')}
        isPending={mutation.isPending}
        hasNextPage={list.hasNextPage}
        onFetchNextPage={() => void list.fetchNextPage()}
        isFetchingNextPage={list.isFetchingNextPage}
        isError={list.isError}
        onRefetch={() => void list.refetch()}
      />

      <AskThread
        key={`${id ?? 'empty'}:${epoch}`}
        id={id}
        availability={list.data?.pages[0]?.availability ?? 'unavailable'}
        locked={mutation.isPending}
      />
    </div>
  );
}

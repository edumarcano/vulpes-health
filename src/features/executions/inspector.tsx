import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { z } from 'zod';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { ownedJson } from '@/lib/api';
import { useAuth } from '@/lib/auth/auth-context';
import { successEnvelopeSchema } from '../../../shared/api';
import { ContextManifestSchema } from '../../../shared/domain';
import { DataSummarySchema } from '../../../shared/data';
import {
  InspectionOverviewSchema,
  InspectionPayloadSchema,
} from '../../../shared/inspection';

type Part = 'input' | 'output' | 'context' | 'usage';

function bytesFromBase64(value: string) {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

function Evidence({
  run,
  step,
  part,
  incomplete = false,
  initialVisible = false,
}: {
  run: string;
  step: string;
  part: Part;
  incomplete?: boolean;
  initialVisible?: boolean;
}) {
  const { state, scope } = useAuth();
  const session = state.kind === 'signed_in' ? state.session : null;
  const epoch = scope.epoch;
  const [visible, setVisible] = useState(initialVisible);
  const [notice, setNotice] = useState('');
  const query = useQuery({
    queryKey: ['inspection', session?.user.id, epoch, run, step, part],
    enabled: visible && !!session,
    retry: false,
    queryFn: async ({ signal }) =>
      successEnvelopeSchema(InspectionPayloadSchema).parse(
        await ownedJson(
          '/api/executions?' +
            new URLSearchParams({ view: 'payload', run, step, part }),
          session!.access_token,
          scope,
          epoch,
          { signal },
        ),
      ).data,
  });
  const data = query.data;
  let raw: string | null = null;
  let formatted: string | null = null;
  let context: ReturnType<typeof ContextManifestSchema.safeParse> | null = null;
  let summary: z.infer<typeof DataSummarySchema> | null = null;
  if (data?.state === 'available') {
    try {
      raw = new TextDecoder('utf-8', { fatal: true }).decode(
        bytesFromBase64(data.base64),
      );
    } catch {
      raw = null;
    }
    if (raw !== null)
      try {
        const parsed: unknown = JSON.parse(raw);
        formatted = JSON.stringify(parsed, null, 2);
        if (part === 'context')
          context = ContextManifestSchema.safeParse(parsed);
        if (part === 'output') {
          const result = z
            .object({
              result: z.object({
                kind: z.literal('summary'),
                data: DataSummarySchema,
              }),
            })
            .safeParse(parsed);
          if (result.success) summary = result.data.result.data;
        }
      } catch {
        /* An observed stream need not be JSON. */
      }
  }
  function share(action: 'copy' | 'export') {
    if (
      !data ||
      data.state !== 'available' ||
      (action === 'copy' && raw === null)
    )
      return;
    if (
      !window.confirm(
        'This evidence can contain private health data and conversation text. Continue?',
      )
    )
      return;
    if (action === 'copy' && raw !== null) {
      void navigator.clipboard.writeText(raw).then(
        () => setNotice('Copied exact text.'),
        () => setNotice('Copy failed.'),
      );
      return;
    }
    const url = URL.createObjectURL(
      new Blob([bytesFromBase64(data.base64)], {
        type: 'application/octet-stream',
      }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `vulpes-${part}-${step}.bin`;
    a.click();
    URL.revokeObjectURL(url);
    setNotice('Evidence exported.');
  }
  return (
    <section className="inspection-evidence mt-3 space-y-2">
      <h4>
        {part === 'input'
          ? 'Exact input'
          : part === 'output'
            ? 'Observed output'
            : part === 'context'
              ? 'Context manifest'
              : 'Raw usage'}
      </h4>
      {part === 'output' && incomplete && (
        <p>This is an incomplete observed prefix, not a completed response.</p>
      )}
      {!visible && (
        <Button variant="outline" size="sm" onClick={() => setVisible(true)}>
          Load {part}
        </Button>
      )}
      {query.isPending && visible && <p role="status">Loading evidence…</p>}
      {query.isError && <p role="alert">Evidence could not be loaded.</p>}
      {data && data.state !== 'available' && (
        <p>Evidence {data.state}. Exact content cannot be reconstructed.</p>
      )}
      {data?.state === 'available' && (
        <>
          <p>Available until {data.expiresAt}. Private content.</p>
          {data.completeness === 'partial' && (
            <p>
              This older context manifest is partial; some included items were
              not recorded.
            </p>
          )}
          {raw === null && (
            <p>
              These bytes are not valid UTF-8. Exact byte export is available.
            </p>
          )}
          {part === 'context' &&
            (context?.success ? (
              <>
                <h5>Included</h5>
                <ul>
                  {context.data.included.map((item) => (
                    <li key={item.reference.id}>
                      {item.reference.label} ({item.reference.kind}) · hash{' '}
                      {item.contentHash}
                    </li>
                  ))}
                </ul>
                <h5>Excluded</h5>
                {context.data.excluded.length ? (
                  <ul>
                    {context.data.excluded.map((item, i) => (
                      <li key={`${item.referenceId}:${i}`}>
                        {item.referenceId}: {item.reason}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p>No exclusions recorded.</p>
                )}
              </>
            ) : (
              <p>Context manifest is malformed.</p>
            ))}
          {summary && (
            <section>
              <h5>Calculation and sources</h5>
              <p>
                {summary.selection.metric} · source{' '}
                {summary.selection.source_id} · {summary.selection.method} ·{' '}
                {summary.selection.granularity}
              </p>
              <p>
                {summary.selection.from} to {summary.selection.to} (end
                excluded) · {summary.selection.timezone}
              </p>
              <p>
                {summary.analysis.algorithmVersion} ·{' '}
                {summary.analysis.validDays} valid days ·{' '}
                {summary.analysis.observationCount} observations ·{' '}
                {summary.analysis.coverageStatus}
              </p>
              <ul>
                {summary.analysis.references.map((reference) => (
                  <li key={`${reference.kind}:${reference.id}`}>
                    {reference.label} ({reference.kind}: {reference.id})
                  </li>
                ))}
              </ul>
            </section>
          )}
          {raw !== null && <pre className="inspection-raw">{raw}</pre>}
          {formatted !== null && (
            <details>
              <summary>Formatted JSON (not the raw bytes)</summary>
              <pre className="inspection-raw">{formatted}</pre>
            </details>
          )}
          <div className="inspection-actions flex flex-wrap gap-2 mt-2">
            {raw !== null && (
              <Button variant="outline" size="sm" onClick={() => share('copy')}>
                Copy exact text
              </Button>
            )}
            <Button variant="outline" size="sm" onClick={() => share('export')}>
              Export exact bytes
            </Button>
          </div>
          <p role="status">{notice}</p>
        </>
      )}
    </section>
  );
}

function StepPayloadViewer({
  run,
  step,
}: {
  run: string;
  step: z.infer<typeof InspectionOverviewSchema>['steps'][number];
}) {
  const [activePart, setActivePart] = useState<Part>('input');
  const [loadedParts, setLoadedParts] = useState<Record<string, boolean>>({});

  function handleTriggerLoad(part: Part) {
    setActivePart(part);
    setLoadedParts((prev) => ({ ...prev, [part]: true }));
  }

  return (
    <div className="step-payload-container">
      <div className="step-payload-actions">
        <Button
          variant={
            activePart === 'input' && loadedParts['input']
              ? 'default'
              : 'outline'
          }
          size="sm"
          onClick={() => handleTriggerLoad('input')}
        >
          Load input
        </Button>
        <Button
          variant={
            activePart === 'output' && loadedParts['output']
              ? 'default'
              : 'outline'
          }
          size="sm"
          onClick={() => handleTriggerLoad('output')}
        >
          Load output
        </Button>
        {step.type !== 'tool' && (
          <>
            <Button
              variant={
                activePart === 'context' && loadedParts['context']
                  ? 'default'
                  : 'outline'
              }
              size="sm"
              onClick={() => handleTriggerLoad('context')}
            >
              Load context
            </Button>
            <Button
              variant={
                activePart === 'usage' && loadedParts['usage']
                  ? 'default'
                  : 'outline'
              }
              size="sm"
              onClick={() => handleTriggerLoad('usage')}
            >
              Load usage
            </Button>
          </>
        )}
      </div>

      {loadedParts[activePart] ? (
        <Evidence
          key={activePart}
          run={run}
          step={step.id}
          part={activePart}
          incomplete={step.status !== 'completed'}
          initialVisible={true}
        />
      ) : (
        <p className="text-xs text-muted-foreground italic">
          Click an action above to load and inspect raw payload bytes.
        </p>
      )}
    </div>
  );
}

export default function Inspector({
  run,
  onClose,
}: {
  run: string;
  onClose: () => void;
}) {
  const { state, scope } = useAuth();
  const session = state.kind === 'signed_in' ? state.session : null;
  const epoch = scope.epoch;
  const client = useQueryClient();
  const userId = session?.user.id;
  useEffect(
    () => () => {
      client.removeQueries({ queryKey: ['inspection', userId, epoch, run] });
    },
    [client, userId, epoch, run],
  );

  const query = useQuery({
    queryKey: ['inspection', session?.user.id, epoch, run, 'overview'],
    enabled: !!session,
    retry: false,
    queryFn: async ({ signal }) =>
      successEnvelopeSchema(InspectionOverviewSchema).parse(
        await ownedJson(
          '/api/executions?' + new URLSearchParams({ run }),
          session!.access_token,
          scope,
          epoch,
          { signal },
        ),
      ).data,
  });

  const overview = query.data;
  const totalInputTokens =
    overview?.steps.reduce((acc, s) => acc + (s.usage.inputTokens ?? 0), 0) ??
    0;
  const totalOutputTokens =
    overview?.steps.reduce((acc, s) => acc + (s.usage.outputTokens ?? 0), 0) ??
    0;
  const totalReasoningTokens =
    overview?.steps.reduce(
      (acc, s) => acc + (s.usage.reasoningTokens ?? 0),
      0,
    ) ?? 0;
  const toolSteps = overview?.steps.filter((s) => s.type === 'tool') ?? [];
  const toolNames = Array.from(
    new Set(toolSteps.map((s) => s.toolName).filter(Boolean)),
  );

  return (
    <Sheet
      open={true}
      modal={false}
      onOpenChange={(open) => {
        if (!open) {
          onClose();
        }
      }}
    >
      <SheetContent
        side="right"
        aria-label="Execution inspector"
        className="w-full sm:max-w-2xl md:max-w-3xl overflow-y-auto overflow-x-hidden p-6"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          onClose();
        }}
      >
        <SheetHeader className="mb-4">
          <SheetTitle id="inspection-title">Execution inspector</SheetTitle>
        </SheetHeader>
        {query.isPending && <p role="status">Loading execution…</p>}
        {query.isError && (
          <div role="alert" className="space-y-2 py-4">
            <p>Execution could not be loaded.</p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              Retry execution
            </Button>
          </div>
        )}
        {overview && (
          <>
            <section
              className="inspector-overview"
              aria-labelledby="inspector-overview-heading"
            >
              <h3
                id="inspector-overview-heading"
                className="text-sm font-semibold uppercase tracking-wider text-muted-foreground mb-3"
              >
                Overview
              </h3>

              <div className="inspector-metrics-grid">
                {/* Card 1: Model & Route */}
                <Card className="metric-card">
                  <span className="text-xs text-muted-foreground font-medium block">
                    Model & Route
                  </span>
                  <div className="text-sm font-semibold truncate mt-1">
                    {overview.run.route?.model ?? 'No model'}
                  </div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    {overview.run.route?.role ?? 'No role'} ·{' '}
                    {overview.run.route?.provider ?? 'unknown provider'}
                  </div>
                </Card>

                {/* Card 2: Latency & Tokens */}
                <Card className="metric-card">
                  <span className="text-xs text-muted-foreground font-medium block">
                    Latency & Tokens
                  </span>
                  <div className="text-sm font-semibold truncate mt-1">
                    {totalInputTokens + totalOutputTokens} tokens
                  </div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    {totalInputTokens} in · {totalOutputTokens} out ·{' '}
                    {totalReasoningTokens} reasoning
                  </div>
                </Card>

                {/* Card 3: Cost & Budget */}
                <Card className="metric-card">
                  <span className="text-xs text-muted-foreground font-medium block">
                    Cost & Budget
                  </span>
                  <div className="text-sm font-semibold truncate mt-1">
                    {overview.run.costUSD === null
                      ? 'unknown'
                      : `$${overview.run.costUSD}`}
                  </div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    Cost {overview.run.costStatus} · held $
                    {overview.run.reservationUSD}
                  </div>
                </Card>

                {/* Card 4: Tool Calls */}
                <Card className="metric-card">
                  <span className="text-xs text-muted-foreground font-medium block">
                    Tool Calls
                  </span>
                  <div className="text-sm font-semibold truncate mt-1">
                    {toolSteps.length} calls
                  </div>
                  <div className="text-xs text-muted-foreground truncate mt-0.5">
                    {toolNames.join(', ') || 'No tools invoked'}
                  </div>
                </Card>
              </div>

              <div className="inspector-overview-meta space-y-1 text-xs text-muted-foreground">
                <p>
                  {overview.run.state} · trace {overview.run.traceState} ·{' '}
                  {overview.run.admittedAt}
                </p>
                <p>
                  {overview.run.route?.role ?? 'No model'} ·{' '}
                  {overview.run.route?.provider ?? 'unknown provider'} ·{' '}
                  {overview.run.route?.model ?? 'unknown model'}
                </p>
                <p>
                  Cost {overview.run.costStatus}:{' '}
                  {overview.run.costUSD === null
                    ? 'unknown'
                    : `$${overview.run.costUSD}`}{' '}
                  · known ${overview.run.knownCostUSD} · reserved $
                  {overview.run.reservationUSD}
                </p>
                {overview.routeHistory.map((change) => (
                  <p key={change.sourceStepId}>
                    Authorized handoff: Everyday → Intermediate ·{' '}
                    {change.reason}
                  </p>
                ))}
                <p>
                  Evidence revision: {overview.evidenceRevision}
                  {overview.evidenceRevision === 'stale'
                    ? ' (historical; current data has changed)'
                    : ''}
                  .
                </p>
                <p>
                  Seven-day private trace retention. RAG and web research were
                  not used. This view shows what Vulpes sent and received, not
                  hidden provider instructions or reasoning.
                </p>
              </div>
            </section>

            <div className="steps-timeline space-y-6 mt-6">
              {overview.steps.map((step) => (
                <section
                  key={step.id}
                  className="inspection-step"
                  data-step-id={step.id}
                >
                  <div className="step-milestone" aria-hidden="true" />

                  <h3 className="step-title font-semibold text-sm">
                    Step {step.sequence}: {step.type}
                    {step.toolName ? ` · ${step.toolName}` : ''}
                  </h3>

                  {step.status !== 'completed' && (
                    <p className="text-xs font-medium my-1">
                      This is an incomplete observed prefix, not a completed
                      response.
                    </p>
                  )}

                  <div className="step-meta space-y-1 text-xs text-muted-foreground my-2">
                    <p>
                      {step.status} · dispatch {step.dispatchState} ·{' '}
                      {step.startedAt}
                    </p>
                    <p>
                      {step.provider ?? 'Local tool'} · adapter{' '}
                      {step.adapterVersion ?? 'unknown'}
                    </p>
                    <p>
                      Model requested {step.model ?? 'none'}, provider-reported{' '}
                      {step.effectiveModel ?? 'unknown'}
                    </p>
                    <p>
                      Effort requested {step.requestedEffort ?? 'unknown'},
                      provider-reported {step.effectiveEffort ?? 'unknown'} ·
                      finish {step.finishReason ?? 'unknown'}{' '}
                      (adapter-normalized)
                    </p>
                    <p>
                      Request SHA-256: {step.requestBodyHash ?? 'unavailable'}
                    </p>
                    <p>
                      Cost {step.costStatus}:{' '}
                      {step.costUSD === null ? 'unknown' : `$${step.costUSD}`} ·
                      bound {step.costBoundState}
                    </p>
                    <p>
                      Tokens: input {step.usage.inputTokens ?? 'unknown'},
                      output {step.usage.outputTokens ?? 'unknown'}, reasoning{' '}
                      {step.usage.reasoningTokens ?? 'unknown'}, cache read{' '}
                      {step.usage.cacheReadTokens ?? 'unknown'}, cache write{' '}
                      {step.usage.cacheWriteTokens ?? 'unknown'}
                    </p>
                    <details>
                      <summary>Request metadata and price snapshot</summary>
                      <pre className="inspection-raw">
                        {JSON.stringify(
                          {
                            request: step.requestMetadata,
                            price: step.priceSnapshot,
                            providerRequestId: step.providerRequestId,
                          },
                          null,
                          2,
                        )}
                      </pre>
                    </details>
                  </div>

                  <StepPayloadViewer run={run} step={step} />
                </section>
              ))}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

import { isProductionTransport } from '../providers/openrouter-production.js';
import { isVertexVerificationTransport } from '../providers/vertex-verification.js';
import { HttpFailure } from '../../http/failure.js';
import { MAX_PAYLOAD_BYTES } from '../../security/encryption.js';
import type {
  ExecutionService,
  PreparedStep,
  RunLease,
  StepInput,
} from './execution.js';
import { executionPolicy } from './policy.js';
import { isVerificationTransport } from '../providers/openrouter-verification.js';

// Real transports must be issued by their gated factories. Every request still
// passes durable capture, authorization and settlement through this dispatcher.
export interface RequestTransport {
  readonly mode: 'mock' | 'verification' | 'production';
  send(body: Uint8Array, signal: AbortSignal): AsyncIterable<Uint8Array>;
}
export interface PaidRequestDispatcher {
  send(
    request: Pick<
      StepInput,
      | 'body'
      | 'metadata'
      | 'adapterVersion'
      | 'requestedEffort'
      | 'effectiveEffort'
    >,
    signal: AbortSignal,
  ): AsyncIterable<Uint8Array>;
}
interface StepDispatcher {
  send(
    step: PreparedStep,
    signal: AbortSignal,
    cancellationSignal?: AbortSignal,
  ): AsyncIterable<Uint8Array>;
  bind(
    lease: RunLease,
    binding: Pick<StepInput, 'provider' | 'model' | 'price' | 'context'>,
    onPrepared: (step: PreparedStep) => void,
    // Distinguish owner cancellation from aborting an adapter's pending read
    // during disposal after a parser or message-checkpoint failure.
    cancellationSignal?: AbortSignal,
  ): PaidRequestDispatcher;
}

const CHECKPOINT_BYTES = 8 * 1024;
const CHECKPOINT_MS = 250;

// Keep a single outstanding read across timed flushes. Closing must abort the
// source before awaiting return(), since a provider may be waiting for bytes.
export async function* streamBatches<T>(
  source: AsyncIterable<T>,
  signal: AbortSignal,
  byteLength: (value: T) => number,
  close: () => void,
): AsyncGenerator<T[]> {
  const iterator = source[Symbol.asyncIterator]();
  let pending: Promise<IteratorResult<T>> | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: () => void = () => undefined;
  const aborted = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
  });
  // A consumer can abort while suspended at yield, before the next race exists.
  void aborted.catch(() => undefined);
  try {
    while (true) {
      signal.throwIfAborted();
      const batch: T[] = [];
      let bytes = 0;
      const elapsed = new Promise<null>((resolve) => {
        timer = setTimeout(() => resolve(null), CHECKPOINT_MS);
      });
      while (bytes < CHECKPOINT_BYTES) {
        pending ??= iterator.next();
        const next = await Promise.race([pending, elapsed, aborted]);
        signal.throwIfAborted();
        if (next === null) break;
        pending = undefined;
        if (next.done) {
          if (batch.length) yield batch;
          return;
        }
        batch.push(next.value);
        bytes += byteLength(next.value);
      }
      clearTimeout(timer);
      if (batch.length) yield batch;
    }
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', abort);
    close();
    await iterator.return?.();
  }
}

export function createDispatcher(
  ledger: ExecutionService,
  transport: RequestTransport,
  consumerExitStatus: 'failed' | 'cancelled' = 'cancelled',
): StepDispatcher {
  const dispatcher: StepDispatcher = {
    bind(lease, binding, onPrepared, cancellationSignal) {
      let state: 'fresh' | 'used' = 'fresh';
      return {
        async *send(request, signal) {
          if (state !== 'fresh')
            throw new HttpFailure(
              409,
              'dispatch_already_used',
              'Each model invocation permits one transport request.',
            );
          state = 'used';
          signal.throwIfAborted();
          const step = await ledger.prepare(lease, {
            ...binding,
            type: 'generation',
            body: request.body,
            metadata: request.metadata,
            adapterVersion: request.adapterVersion,
            ...(request.requestedEffort === undefined
              ? {}
              : { requestedEffort: request.requestedEffort }),
            ...(request.effectiveEffort === undefined
              ? {}
              : { effectiveEffort: request.effectiveEffort }),
          });
          try {
            onPrepared(step);
          } catch {
            await ledger.settle(step, null, 'failed', 0, true);
            await ledger.finish(lease, 'failed');
            throw new HttpFailure(
              503,
              'execution_unavailable',
              'The execution could not start.',
            );
          }
          yield* dispatcher.send(step, signal, cancellationSignal);
        },
      };
    },
    async *send(step, signal, cancellationSignal = signal) {
      if (
        transport.mode !== 'mock' &&
        !isVerificationTransport(transport) &&
        !isVertexVerificationTransport(transport) &&
        !isProductionTransport(transport)
      )
        throw new Error('live_transport_unavailable');
      signal.throwIfAborted();
      // Never retry this transition after an ambiguous reply. Only true permits a
      // send; a repeated call with the same step cannot execute the transport.
      const captured = Buffer.from(step.body);
      await ledger.authorize({ ...step, body: captured });
      const controller = new AbortController();
      const timeout = Math.max(
        1,
        Math.min(
          executionPolicy.providerTimeoutSeconds * 1000,
          Date.parse(step.lease.deadlineAt) - Date.now(),
        ),
      );
      const combined = AbortSignal.any([
        signal,
        controller.signal,
        AbortSignal.timeout(timeout),
      ]);
      let heartbeat: Promise<unknown> = Promise.resolve();
      const timer = setInterval(() => {
        heartbeat = heartbeat
          .then(() => ledger.heartbeat(step.lease))
          .catch(() => {
            controller.abort();
          });
      }, executionPolicy.heartbeatSeconds * 1000);
      const chunks: Buffer[] = [];
      let length = 0;
      let committedLength = -1;
      let checkpointFailed = false;
      let streamState: 'reading' | 'completed' | 'failed' = 'reading';
      const checkpoint = async () => {
        try {
          const capturedLength = length;
          await ledger.checkpoint(step, Buffer.concat(chunks, capturedLength));
          committedLength = capturedLength;
        } catch (error) {
          checkpointFailed = true;
          throw error;
        }
      };
      async function* capture() {
        for await (const chunk of transport.send(captured, combined)) {
          combined.throwIfAborted();
          if (length + chunk.byteLength > MAX_PAYLOAD_BYTES)
            throw new Error('response_too_large');
          const copy = Buffer.from(chunk);
          chunks.push(copy);
          length += copy.byteLength;
          yield copy;
        }
      }
      try {
        combined.throwIfAborted();
        for await (const batch of streamBatches(
          capture(),
          combined,
          (chunk) => chunk.byteLength,
          () => controller.abort(),
        )) {
          combined.throwIfAborted();
          await checkpoint();
          combined.throwIfAborted();
          yield Buffer.concat(batch);
        }
        if (length === 0) await checkpoint();
        signal.throwIfAborted();
        streamState = 'completed';
      } catch {
        streamState = 'failed';
        if (!checkpointFailed && length > committedLength)
          await checkpoint().catch(() => undefined);
        await ledger
          .settle(
            step,
            null,
            cancellationSignal.aborted ? 'cancelled' : 'failed',
          )
          .catch(() => undefined);
        await ledger
          .finish(
            step.lease,
            cancellationSignal.aborted ? 'cancelled' : 'failed',
          )
          .catch(() => undefined);
        throw new HttpFailure(
          503,
          'execution_interrupted',
          'The request stopped. Usage may still be pending; read its saved status.',
        );
      } finally {
        clearInterval(timer);
        controller.abort();
        await heartbeat;
        if (streamState === 'reading') {
          if (!checkpointFailed && length > committedLength)
            await checkpoint().catch(() => undefined);
          // A parser rejecting bytes is a failure. The original direct-consumer
          // API continues to classify an abandoned iterator as cancellation.
          const status = cancellationSignal.aborted
            ? 'cancelled'
            : consumerExitStatus;
          await ledger.settle(step, null, status).catch(() => undefined);
          await ledger.finish(step.lease, status).catch(() => undefined);
        }
      }
    },
  };
  return dispatcher;
}

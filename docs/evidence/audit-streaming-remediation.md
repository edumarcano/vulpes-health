# Audit F-04 and F-12: streaming checkpoints

2026-11-04. Implementation base: `ad70d74`. Synthetic, offline evidence only.

## Reproduction and measurement

Before editing production code, `tests/unit/streaming-remediation.test.ts` ran
1,000 distinct 32-character synthetic text deltas and a completed Responses event,
one event per transport chunk. It exercised `VulpesAgent`, the real Responses
adapter, dispatcher, `ExecutionService`, gzip, AES-GCM encryption and decryption.
Only context construction, database responses and the final display-usage query
were replaced. No database, HTTP provider or credentials were used.

The database boundary counted each select/RPC and the UTF-8 size of serialized RPC
arguments, including ciphertext hex and message content. These are application
round trips and uploaded JSON bytes, excluding HTTP headers, database execution
time, replies and network latency. The synthetic database returned successful
transactions; this does not establish PostgreSQL atomicity or accounting behavior.

| Measurement | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Database calls | 3,014 | 24 | 125.58 times |
| Uploaded JSON bytes | 36,555,411 | 405,031 | 90.25 times |
| Response checkpoint RPCs | 1,001 | 11 | 91 times |
| Message checkpoint RPCs | 1,000 | 4 | 250 times |
| Expiry lookups | 1,004 | 1 | 1,004 times |
| Exact captured response bytes | 120,165 | 120,165 | Identical |
| Emitted text bytes | 32,000 | 32,000 | Identical |

The pre-change measurement failed the fewer-than-300-calls assertion. The F-12
reproduction separately returned `unavailable` for correctly encrypted, unexpired
request bytes when cleanup failed. Both regressions pass after remediation.

Reproduce the current measurement without a database or provider:

```sh
node node_modules/vitest/vitest.mjs run tests/unit/streaming-remediation.test.ts --disableConsoleIntercept
```

Its JSON output includes the counts above. The test asserts at least tenfold
reductions against the recorded baseline for calls and upload size, decrypts and
compares the entire trace, and checks durable trace/message prefixes before each
text emission. The workload is intentionally varied synthetic text; it is not a
hosted latency or typical-answer benchmark.

## Behavior and trade-offs

Response and generation-event batches flush at 8 KiB, 250 ms, or stream completion.
One source item can cross the size threshold; the existing total payload and text
limits remain enforced. Each layer has its own batching interval, so this is not
an end-to-end 250 ms latency guarantee. A response batch commits before the adapter
can consume it; a combined text delta commits before SSE emission. The transport
keeps one outstanding read across timed flushes and aborts it before awaiting
iterator closure. Partial received trace bytes are saved best effort on failure or
cancellation, with no final buffered emission. A failed checkpoint is not retried.
Unemitted buffered bytes can be lost on process death; emitted prefixes remain
durable. Cumulative snapshots still grow with response length.

Every step fixes its payload expiry from one database-clock lookup during prepare.
All current execution payload purposes share the database's seven-day limit.
Requests, context, responses, usage and saved state reuse that instant, so later
writes cannot extend retention. Reads still enforce expiry, owner, purpose and
authenticated decryption. They no longer start cleanup. Existing bounded
`cleanupExpiredData` maintenance remains responsible for physical deletion; a hung
or failed cleanup cannot block a read or the critical pre-send trace check.

Provider timeout, run deadline, heartbeat, reservation and settlement policy are
unchanged. Cancellation and failures still send unknown usage as `source: pending`
with null cost. Direct dispatcher iterator abandonment remains cancelled; the
agent's existing parser/consumer-exit policy remains failed. Explicit owner abort
is cancelled. Iterator disposal emits no trailing events in the tested paths.

## Verification and review

| Check | Result |
| --- | --- |
| Six targeted pure suites | 76 passed, including 17 remediation cases |
| `npm run typecheck` | Passed for app, server and tools |
| ESLint on all changed TypeScript files | Passed, zero warnings |
| Prettier on all changed TypeScript files | Passed |
| `git diff --check` | Passed |
| Axis 1: requirements and contracts | Self-review: no blocking findings |
| Axis 2: architecture, security and test assurance | Self-review: no blocking or advisory findings |

Targeted suites: `streaming-remediation`, `providers`, `encryption`,
`production-transport`, `verification-transport`, and `live-preflight` under
`tests/unit/`. Remediation assertions cover short/empty batches, split UTF-8,
timed flush without a subsequent chunk, failed writes, partial-batch transport
failure, cancellation before flush and during commit, pending-read iterator return,
agent cancellation/disposal, second message-batch failure, malformed provider
frames, unavailable/hung cleanup, expiry/decryption rejection, and authoritative
usage with fixed expiry. A controlled lookahead test receives bytes during an
in-flight timed checkpoint, then returns the consumer and verifies those extra
bytes are saved without emission.

The two-axis review inspected the actual source/test diff and relevant callers.
It was performed by the implementation agent; no independent reviewer or delegate
was used. Production edits are confined to the assigned ledger/payload files and
the generation-stream region of `VulpesAgent`. The tool-execution region is untouched.
Two existing integration failure-injection tests now use an 8 KiB first prefix so
they still fail at the second durable batch rather than assuming per-delta writes.

Database integration, pgTAP, HTTP/browser acceptance, hosted latency and paid
provider verification were not run. The integration test edits are typechecked and
reviewed but unexecuted. No shared stack, reset, cloud resource, `.env`, real health
record, provider activation or paid request was accessed. Provider requests: zero;
inference spend: USD 0. Deployment, recovery and decision-log work belong to the
parent remediation task. This draft does not establish merge or release readiness.

CI follow-up: integration/browser assertions exposed a valid parsed text prefix being dropped when a later provider frame failed or the stream ended without completion. Two new pure regressions failed before repair and all 19 streaming cases passed afterward. Generation-event batching now flushes previously parsed valid events before propagating a non-cancellation source failure, persisting text before emission. Raw unflushed transport batches and owner cancellation still do not flush. Original integration/browser prefix assertions are retained for the database/browser rerun; no pass is inferred from pure tests.

## Independent-review repair (2026-11-04)

The earlier malformed-frame pure proof missed PostgreSQL's writable-run guard. A new real HTTP/PostgreSQL regression sent a short valid delta followed by malformed JSON in the same transport chunk; before repair the expected text was empty. Dispatcher cleanup had already settled and finalized the run, changing its fence before the outer batcher could persist valid parsed text.

For agent-owned dispatch, the dispatcher still captures raw bytes and conservatively settles the step, while the agent owns run finalization. This leaves the run writable until parsed text is durably checkpointed and emitted, then finalizes failure. Direct dispatcher consumers retain their original finalization policy. Agent iterator disposal has explicit best-effort terminal cleanup without trailing emission. Cancellation still uses the original signal and database fence; unknown usage remains pending with its reservation.

The PostgreSQL regression now passes: reloaded message bytes equal the valid synthetic prefix, message/run/step finish failed, partial output is true, cost is null/pending, the reservation remains positive, and the exact raw trace includes the malformed suffix. The 96 focused pure streaming/Ask/chat tests pass, including cancellation, disposal, failed message writes and retained prefixes. The unit database boundary now rejects message writes after finalization instead of masking the ordering defect. No schema, timeout, retention or accounting-policy change was made. Both Remora axes were checked against the actual diff; hosted/provider behavior remains unverified. Provider requests/spend: zero.

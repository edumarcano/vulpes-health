# Luna v10 technical verification, 2026-11-10

The owner authorized the bounded synthetic technical packet and deferred model
benchmarks. Candidate `f6fb5ebcc14607a1c26fa769c8579caec985e339` passed all five
technical cases using five provider requests. This does not approve production
activation, merge or deployment; committed production evidence still binds v9.

| Case                           | Requests | Result                                                                                    |
| ------------------------------ | -------: | ----------------------------------------------------------------------------------------- |
| E10 zero-budget denial         |        0 | Passed; no transport send or charge                                                       |
| Tool loop and persisted reload |        2 | Passed; `summarize_metric`, exact request bytes and owned tool evidence verified          |
| V03 typed-error protocol       |        1 | Passed; provider accepted an explicitly seeded synthetic rejected-call transcript         |
| Cancellation                   |        1 | Passed; nonterminal capture observed, uncertain reservation retained                      |
| Controlled disconnection       |        1 | Passed; nonterminal capture observed, incomplete trace and uncertain reservation retained |

Confirmed charges were **$0.000459865**, matching the dedicated key's reported
usage. Interrupted requests retained **$0.0186384** in application reservations;
their final charges and provider-side termination remain unknown. The immutable
application ceiling was `$0.0652344`, with a seven-request maximum; the dedicated
key had a non-resetting `$0.07` limit. No retries of provider requests occurred.

The completed tool-loop run is `e80d09fb-eaf3-483b-bfe8-84f8ea93ed13`.
The suite is `8fef532e-d571-4b09-b59b-7e17e6c558c5`, with plan hash
`1a5dba0ae255f08aa9810228444054bd78588f9541a696454feadf5d540c0b94`.
Bindings remained `openai/gpt-6-luna`, low effort, Responses v2, v10,
price hash `0a5a7a4099aeff7c38bcc37991a7f8243f534c4a870069ad3e20bb93d466bc2f`
and policy hash `c4446166b4f12430000892d989c682d5e5e1f6dbdcce8987b09c80465b37f1d5`.
Completed generations reported the requested model and effort.

Current [endpoint rates](https://openrouter.ai/api/v1/models/openai/gpt-6-luna/endpoints)
and [ZDR eligibility](https://openrouter.ai/api/v1/endpoints/zdr) were rechecked
before dispatch and fit the configured conservative price bounds. Existing
privacy policy and screening exceptions remain applicable. Twelve retained
request, response and tool payloads decrypted successfully; all five saved
provider requests had `store: false` and `provider.zdr: true`. Credentials and raw
payloads remain private. V03 establishes wire-format compatibility, not independent
model error repair. Model quality and broader safety assessment remain deferred.

A fresh disposable local project used fixed project/port substitutions and fresh
trace keys. Verification-only capability evidence was refreshed inside that copy;
production evidence was not changed. Initial zero-budget setup stopped at an
unsubstituted local-port guard before transport or run admission. Accounting was
checked at zero, and the guard was corrected to require the disposable port before
continuing. A later optional offline-control invocation stopped on the existing
application-period bucket (HTTP 409); it produced no new control evaluation.
The previously recorded 16 passing offline controls remain the candidate's control
evidence. No retained allocation was reset or replenished. The disposable stack
was stopped with its encrypted evidence and accounting preserved.

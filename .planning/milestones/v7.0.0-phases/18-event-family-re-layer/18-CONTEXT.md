# Phase 18: EVENT Family Re-layer - Context

**Gathered:** 2026-08-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Make `event()` one readiness-aware EVENT/AUTH wire interaction and make `publish()` the sole owner of configurable auth, retry, reconnect, and whole-operation timeout policy. Preserve raw group fan-out semantics, prevent `sync()` SEND from silently losing auth behavior, and align every test, comment, and held changeset with the resulting contract.

</domain>

<decisions>
## Implementation Decisions

### Low-level event Contract
- Mirror `req()`'s protocol-vs-transport boundary: a genuine matching relay `OK` frame is a value whether `ok` is true or false; socket/client attempt failures use the observable error channel; a clean connection close before `OK` completes without a fabricated response.
- For an EVENT verb, parse `auth-required:` once and throw `AuthRequiredError` directly. `event()` never calls an auth handler and never resends.
- Attach a typed relay-verdict error to an `OK false` `PublishResponse`. Client-side failures reject and never manufacture a response carrying `error`; update the held changeset/provenance to this contract.
- Shared transport readiness is a precondition above the direct WebSocket, not policy owned by either method. `event()` waits for readiness and then performs one EVENT write/reply interaction.
- A written EVENT attempt has a small fixed reply bound. Caller-configurable whole-operation timing belongs to `publish()`.

### High-level publish Policy
- Remove auth, reconnect, retry, and caller-configurable whole-operation timeout options from public `event()`; retain only raw-attempt inputs and the EVENT/AUTH verb distinction. `publish()` owns those policy options.
- `publish()` calls the readiness-aware `event()` without adding a duplicate readiness wait, then wraps it with bounded auth resend and transient retry/reconnect.
- Keep auth and generic retry counters distinct and call-scoped across the whole publish operation.
- The configurable timeout measures the whole publish operation, including `event()`'s readiness wait and retry backoff. Suspend it only while legitimate auth handling/signing is active; each written EVENT retains its fixed reply bound.
- Retry transient client failures such as reply timeout and reconnectable socket loss. Do not retry a genuine relay verdict, auth exhaustion, handler failure, auth timeout, or terminal typed CLOSED reason.

### EVENT-family Consumers
- `RelayGroup.event()` remains raw fan-out: exactly one `relay.event()` attempt per relay, with no auth/reconnect/retry policy. `RelayGroup.publish()` remains the high-level policy API and isolates per-relay failures into responses.
- Rewire `Relay.sync()`'s SEND transfer leg to `publish()` now so Phase 18 does not silently remove auth behavior. Phase 24 may later internalize a unified sync-owned policy budget.
- `auth(event)` keeps calling `event(event, "AUTH")`, never `publish()`. For the AUTH verb, every matching `OK` frame, including `OK false`, is a genuine authentication verdict value; EVENT-only auth-required parsing must not recurse into AUTH.
- Narrow Relay/Group/Pool `event()` option types to raw-attempt inputs, update comments/docs/tests and RAUTH-07 provenance, and add a focused one-change changeset. Existing `publish()` call sites remain source-compatible.

### Retry Invariants and Proof
- Maximum EVENT writes are additive: `1 + authRetries + retries`. Auth budgets do not reset inside each generic retry and cannot multiply the two counters.
- `AuthRequiredError` is consumed only by the bounded auth branch. Auth exhaustion, handler failure, auth timeout, relay verdicts, and terminal `RelayClosedError` subclasses bypass generic retry/reconnect; only explicitly transient client/socket errors re-enter policy.
- Preserve a fresh unshared send/listen attempt per subscription.
- Tests must prove a synchronous auth handler writes the second EVENT, each resend installs a fresh listener, concurrent publishes have independent gates/counters, and timeout retry performs a real second wire write.
- Update D-01, D-07, RAUTH-07, and progress-predicate comments together. Replace false held changeset wording with focused single-sentence changesets matching the final contract and include RED→GREEN mutation probes for resend and error classification.

### the agent's Discretion
- Choose internal error subclass names and RxJS operator decomposition consistent with existing relay errors and auth-retry helpers.
- Preserve public method shapes where they do not conflict with the accepted ownership/type changes.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `Relay.req()` supplies the accepted low-level protocol-vs-transport precedent: protocol lifecycle frames are values, typed failures error, clean close completes, and readiness is shared transport behavior.
- `AuthPhaseGate`, auth-retry helpers, suspendable clocks, connection retry helpers, and typed CLOSED errors already exist in `packages/relay/src`.
- `RelayGroup.publish()` already provides high-level per-relay isolation.

### Established Patterns
- One unshared `defer` owns each real wire write so synchronous resubscription cannot rejoin a completed shared chain.
- Operation clocks suspend during active auth handling and progress predicates must be total over their union.
- Changesets in this repository describe exactly one change in one sentence.

### Integration Points
- `event()`/`publish()`/`auth()` live together in `relay.ts`; their option types live in `types.ts`.
- `RelayGroup.event()` and pool forwarding signatures inherit the relay method's option surface.
- `Relay.sync()` currently calls low-level `event()` directly for SEND and must be rewired to avoid behavior loss before Phase 24.
- Phase 13's RAUTH-07 and Phase 16's amended D-01/D-07 provenance must agree with the shipped code.

</code_context>

<specifics>
## Specific Ideas

- Readiness remains a shared transport precondition for both direct `event()` and composed `publish()` use; avoid duplicate waits in the implementation.
- Treat authenticating an AUTH frame as a relay verdict, not another request to authenticate.
- Use the additive send-count invariant as the core non-vacuity oracle.

</specifics>

<deferred>
## Deferred Ideas

- Phase 24 will replace the temporary `sync()` SEND-through-`publish()` composition with one coherent sync-owned auth/clock/reconnect/concurrency policy.

</deferred>

## Phase 20 amendment (2026-08-31)

Phase 18's one-attempt transport invariants remain authoritative: readiness, listener-before-write ordering, matching replies, fixed reply bounds, and fresh unshared attempts are preserved. Phase 20 intentionally supersedes only the public EVENT/AUTH verb selector: `event(event)` is fixed to EVENT, `auth(event)` is fixed to AUTH, and both use the private one-frame/one-reply primitive.

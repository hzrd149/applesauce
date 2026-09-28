# Phase 18: EVENT Family Re-layer - Research

**Researched:** 2026-08-20
**Domain:** RxJS relay EVENT/AUTH request-response layering, retry policy, and error taxonomy
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

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

### Deferred Ideas (OUT OF SCOPE)
- Phase 24 will replace the temporary `sync()` SEND-through-`publish()` composition with one coherent sync-owned auth/clock/reconnect/concurrency policy.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| EVT-01 | `event()` is one EVENT write/reply and throws `AuthRequiredError` for EVENT auth refusal. | Exact current value-signal/auth loop and the target one-attempt boundary are mapped below. [VERIFIED: codebase] |
| EVT-02 | `publish()` owns auth handling and resend. | Existing `authRetry`, `AuthPhaseGate`, request-context adapter, and fresh-attempt seam are identified. [VERIFIED: codebase] |
| EVT-03 | Reply timeout is retryable. | Current timeout returns `of(PublishResponse)`, while RxJS `retry` reacts only to errors; the required error-channel correction is documented. [CITED: https://rxjs.dev/api/operators/timeout] [CITED: https://rxjs.dev/api/index/function/retry] |
| EVT-04 | Remove the event/publish gate symbol threading and message-string round trip. | Exact `AUTH_PHASE_GATE` and auth-required conversion sites are inventoried. [VERIFIED: codebase] |
| EVT-05 | Restate RAUTH-07 with provenance. | Archived requirement, changeset, tests, and Phase 13 context sites are identified. [VERIFIED: planning artifacts and codebase] |
| EVT-06 | Deliberately preserve group raw fan-out and sync SEND auth behavior. | `RelayGroup.event()` and `Relay.sync()` SEND call paths are mapped to their target owners. [VERIFIED: codebase] |
| RESID-04 | Remove false publish-error, progress-predicate, and timeout documentation. | Held changeset and live comment/doc search targets are listed under Provenance and Documentation Audit. [VERIFIED: milestone audit and codebase] |
</phase_requirements>

## Summary

Phase 18 should relocate the existing EVENT authentication policy, not replace the shared authentication machinery. Today `event()` performs the write/listen interaction, converts an `OK false auth-required:` verdict into an internal value signal, runs `authRetryOperator`, converts exhausted `AuthRequiredError` back to a response, and then `publish()` reconstructs the same error from the response message. The target removes that round trip: `event()` owns readiness plus one fresh write/listen attempt and its fixed reply bound; `publish()` owns one call-scoped gate, auth loop, transient retry/reconnect, and whole-operation clock. [VERIFIED: `packages/relay/src/relay.ts`, `18-CONTEXT.md`]

The key implementation constraint is the additive write bound. A generic retry must not recreate the auth budget, or total sends become multiplicative. The publish operation therefore needs one outer per-call state closure containing independent auth and transient counters; each actual wire attempt must still be created by an unshared `defer`. RxJS officially defines `defer` as invoking its factory for each subscriber, and `retry` as resubscribing only after an error, which directly supports this structure. [CITED: https://rxjs.dev/api/index/function/defer] [CITED: https://rxjs.dev/api/index/function/retry]

No new package is needed. Existing RxJS 7.8.1, `authRetry`, `AuthPhaseGate`, `suspendableTimeout`, readiness handling, `customRetryOperator`, typed relay errors, and group error isolation cover the phase. The plan should split runtime re-layering, downstream group/sync/type alignment, and provenance/changeset cleanup into reviewable units, then run focused mutation probes and the full relay suite. [VERIFIED: `packages/relay/package.json` and source]

**Primary recommendation:** Build one call-scoped `publish()` policy pipeline around a fresh `defer(() => event(...))` attempt factory, classify errors before generic retry, and prove the exact `1 + authRetries + retries` wire count with real WebSocket traces. [VERIFIED: codebase patterns and locked decisions]

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| WebSocket readiness and one EVENT/AUTH interaction | API / Backend (`Relay.event`) | WebSocket transport | The relay instance owns connection readiness and matching `OK` frames; it must not own caller policy. [VERIFIED: codebase] |
| Auth handling, resend, retry/reconnect, operation timeout | API / Backend (`Relay.publish`) | RxJS operators | These are high-level operation policies and must remain call-scoped. [VERIFIED: D-01 and `18-CONTEXT.md`] |
| Per-relay raw EVENT fan-out | API / Backend (`RelayGroup.event`) | `Relay.event` | Group aggregation catches each relay error into a response but adds no policy. [VERIFIED: `group.ts`] |
| Per-relay high-level publish fan-out | API / Backend (`RelayGroup.publish`) | `Relay.publish` | Each relay owns its publish policy; group isolates outcomes and collects them. [VERIFIED: `group.ts`] |
| Sync SEND compatibility bridge | API / Backend (`Relay.sync`) | `Relay.publish` | Phase 18 temporarily delegates SEND transfers to the high-level EVENT owner. [VERIFIED: `relay.ts`; locked decision] |
| Public option propagation | Type/API surface (`types.ts`, Group, Pool) | Relay methods | Relay declares the contract, Group derives it, and Pool derives Group parameters structurally. [VERIFIED: codebase] |

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `rxjs` | `^7.8.1` (installed `7.8.2`) | Observable construction, auth resubscription, retries, timeout, error routing | Already the relay package's execution model; official `defer`, `retry`, and `timeout` semantics match the required design. [VERIFIED: package manifest/lockfile] [CITED: https://rxjs.dev/api/index/function/defer] |
| `vitest` | `^4.0.15` | Unit and WebSocket behavior tests | Existing relay test runner and fixtures; no framework change is justified. [VERIFIED: `packages/relay/package.json`] |
| `vitest-websocket-mock` | `^0.5.0` | Real wire-write/listener assertions | Existing relay tests already use server message traces for resend non-vacuity. [VERIFIED: relay tests and package manifest] |

### Supporting

| Library / Asset | Version | Purpose | When to Use |
|-----------------|---------|---------|-------------|
| Existing `authRetry` / `AuthPhaseGate` / `suspendableTimeout` | repository source | Auth phase execution, clock suspension, terminal error mapping | Reuse in `publish()`; do not fork an EVENT-only implementation. [VERIFIED: codebase] |
| Existing `customRetryOperator` / connection readiness | repository source | Transient retry policy and readiness gating | Reuse after tightening the retry classifier; retain readiness inside `event()`. [VERIFIED: codebase] |
| Existing `errorToPublishResponse` | repository source | Per-relay group isolation | Keep for raw `group.event()` and high-level `group.publish()`. [VERIFIED: `group.ts`] |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Existing auth operator | Duplicate auth loop in `publish()` | Rejected: risks divergent timeout, logging, handler, and counter behavior. [VERIFIED: locked decision and shared operator design] |
| Error-channel reply timeout | Synthetic `{ok:false,error}` value | Rejected: values bypass RxJS retry and contradict the locked client-failure contract. [CITED: https://rxjs.dev/api/index/function/retry] |
| One call-scoped auth budget | Recreate auth budget inside each generic retry | Rejected: produces multiplicative rather than additive writes. [VERIFIED: locked invariant] |

**Installation:** None. This phase installs no external packages. [VERIFIED: phase scope]

## Architecture Patterns

### System Architecture Diagram

```text
publish(event, policy)
  -> create call-scoped auth gate + auth counter + transient retry counter
  -> arm whole-operation suspendable clock
  -> defer(one attempt)
       -> event(event, "EVENT", raw options)
          -> waitForReady
          -> install matching OK listener
          -> write one EVENT
          -> OK true/false value | EVENT auth-required error | client/timeout error | clean completion
  -> classify outcome
       -> AuthRequiredError and budget remains -> run auth phase -> resend fresh attempt
       -> transient client error and budget remains -> backoff/reconnect -> resend fresh attempt
       -> relay verdict / terminal auth / typed CLOSED -> terminate
       -> OK value -> resolve PublishResponse

RelayGroup.event -> one relay.event per relay -> catch each error as response
RelayGroup.publish -> one relay.publish per relay -> catch each error as response
Relay.sync SEND -> relay.publish (temporary Phase 18 bridge)
Relay.auth -> relay.event(..., "AUTH") (never enters EVENT auth branch)
```

### Recommended Project Structure

```text
packages/relay/src/
├── relay.ts                         # event/publish/auth/sync behavior and error taxonomy
├── types.ts                         # raw event options vs high-level PublishOptions
├── group.ts                         # raw/high group fan-out contracts
├── pool.ts                          # structurally inherited group signatures
├── operators/auth-retry.ts          # shared auth gate/retry/clock machinery
└── __tests__/
    ├── relay.test.ts                # wire counts, classifications, clocks, concurrency
    ├── group.test.ts                # raw fan-out and isolated errors
    ├── pool.test.ts                 # narrowed option propagation/type surface
    └── auth-lifecycle-logging.test.ts # operation log continuity
```

### Pattern 1: Fresh Attempt Factory

**What:** Put listener construction and EVENT write inside the factory invoked for every subscription/resubscription.

**When to use:** Every initial EVENT, auth resend, and transient retry.

```typescript
// Source: https://rxjs.dev/api/index/function/defer
const attempt$ = defer(() => {
  const reply$ = socket.pipe(filter(matchesEvent), take(1));
  socket.next([verb, event]);
  return reply$;
});
```

The exact production ordering should ensure the listener exists before a synchronous mock or socket can deliver `OK`; preserve the repository's existing send/listen discipline. [VERIFIED: current `event()` and Phase 13 CR-02 history]

### Pattern 2: Error Classification Before Generic Retry

**What:** Route only explicit transient client/socket failures to generic retry. Relay verdict errors and all terminal auth errors must be excluded.

**When to use:** Immediately before `customRetryOperator` or in its delay predicate.

```typescript
// Source: existing relay error taxonomy + locked Phase 18 contract
if (isRelayVerdict(err) || err instanceof RelayClosedError) throw err;
if (isTransientClientFailure(err)) return retryAttempt(err);
throw err;
```

Because `AuthRequiredError`, `AuthHandlerError`, and `AuthTimeoutError` extend `RelayClosedError`, the auth branch must consume the first `AuthRequiredError` before this terminal-family check; exhausted auth must remain terminal. [VERIFIED: `relay.ts`]

### Pattern 3: One Gate Per Publish Call

**What:** Construct `AuthPhaseGate` and counters inside `publish()` per call, then pass the gate to the auth operator and whole-operation suspendable timeout in that same method.

**When to use:** Always; never store gate/counter state on `Relay`.

```typescript
// Source: existing request()/publish() pattern
const gate = new AuthPhaseGate();
return defer(() => eventAttempt()).pipe(
  authPolicy(gate),
  transientRetryPolicy(),
  suspendableTimeout(totalBudget, gate, { firstWhen: () => true }),
);
```

The actual decomposition must keep the auth budget outside any generic retry closure so counters cannot multiply. [VERIFIED: locked additive invariant]

### Anti-Patterns to Avoid

- **Message-string round trip:** Do not turn `AuthRequiredError` into a response and parse its message again in `publish()`. [VERIFIED: EVT-04]
- **Timeout as a value:** Do not use `timeout({with: () => of(...)})` for an attempt failure that must be retryable. [CITED: https://rxjs.dev/api/operators/timeout]
- **Auth operator inside generic retry factory:** This resets auth budget per retry and violates the maximum-write invariant. [VERIFIED: locked decision]
- **Duplicate readiness waits:** `event()` remains readiness-aware; `publish()` should compose it directly. [VERIFIED: locked decision]
- **Shared attempt observable:** A shared completed listener can swallow a synchronous resend; each write must install a fresh listener. [VERIFIED: Phase 13 CR-02/CR-03 provenance]
- **AUTH recursion:** Do not interpret an `AUTH` verb's `OK false auth-required:` response as another authentication request. [VERIFIED: locked decision]

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Per-subscription attempt creation | Manual listener-reset/ref-count state | RxJS `defer` | Factory invocation is defined per subscriber. [CITED: https://rxjs.dev/api/index/function/defer] |
| Retry scheduling/config vocabulary | Custom loop/timer parser | Existing `customRetryOperator` plus RxJS `retry` config | Preserves public `boolean | number | RetryConfig` behavior and backoff conventions. [VERIFIED: codebase] |
| Suspendable operation clock | Ad hoc pause/resume timers in `publish()` | Existing `AuthPhaseGate` + `suspendableTimeout` | Already handles auth-phase suspension and teardown. [VERIFIED: codebase] |
| Auth handler/requirement logic | EVENT-specific handler loop | Existing `authRetry` adapter | Centralizes missing-pubkey context, handler failures, auth timeout, and logs. [VERIFIED: codebase] |
| Per-relay group error aggregation | New group publish result channel | Existing `internalPublish` / `errorToPublishResponse` | Already isolates thrown relay errors into response values. [VERIFIED: `group.ts`] |

**Key insight:** The difficult part is ownership and classification, not missing machinery; duplicating operators would make the additive bound and terminal-error exclusions harder to prove. [VERIFIED: codebase and context]

## Error and Outcome Matrix

| Outcome | `event()` | `publish()` | Group conversion | Retry? |
|---------|-----------|-------------|------------------|--------|
| Matching `OK true` | Emit `PublishResponse` value | Resolve value | Preserve value | No |
| Matching `OK false`, ordinary relay verdict | Emit response with typed relay-verdict `error` | Resolve verdict value | Preserve value | No |
| Matching EVENT `OK false auth-required:` | Throw `AuthRequiredError` | Consume while auth budget remains; terminal after exhaustion | Convert terminal error per relay | Auth branch only |
| Matching AUTH `OK false`, including auth-required text | Emit authentication verdict value | Not applicable | Preserve if fanned out indirectly | No |
| Fixed per-attempt reply timeout | Error with typed client timeout | Retry while transient budget remains | Convert terminal error per relay | Generic transient branch |
| Reconnectable socket loss | Error | Retry/reconnect while budget remains | Convert terminal error per relay | Generic transient branch |
| Terminal typed CLOSED reason | Error | Propagate | Convert terminal error per relay | No |
| Auth handler rejection | `event()` never handles auth | `AuthHandlerError` | Convert terminal error per relay | No |
| Auth phase timeout | `event()` never handles auth | `AuthTimeoutError` | Convert terminal error per relay | No |
| Clean close before `OK` | Complete without fabricated value | Promise behavior must be explicitly tested/retained | No response for that relay unless group semantics decide otherwise | No |

[VERIFIED: `18-CONTEXT.md`, current error classes, group conversion]

## Provenance and Documentation Audit

| Artifact | Current claim/problem | Required disposition |
|----------|-----------------------|----------------------|
| Archived Phase 13 D-01 | Amended in Phase 16 for one-hop retry/aggregation throws | Keep source of record consistent with direct `event()` throw and `publish()` consumption. [VERIFIED: Phase 16 summary] |
| Archived RAUTH-07 | Says auth behavior exists on both `publish` and raw `event` | Restate with recorded provenance: EVENT-family policy remains on `publish`; raw `event` is deliberately narrowed. [VERIFIED: milestone requirement] |
| `.changeset/relay-operation-scoped-auth-callbacks.md` | Lists `event` among methods accepting auth callbacks/options | Replace or adjust via focused single-change changeset strategy chosen in context; do not silently leave false release prose. [VERIFIED: file read] |
| `.changeset/wait-for-auth-pubkeys.md` | Lists raw `event` as accepting `waitForAuth` | Align with narrowed raw event surface. [VERIFIED: file read] |
| `.changeset/relay-publish-timeout-marks-itself.md` | Says a local timeout produces a response `.error` | False under locked contract: client failures reject; replace its wording/artifact before release. [VERIFIED: file read and RESID-04] |
| `relay.ts` EVENT progress comment | Claims every `PublishResponse` is real progress despite synthetic timeout value | Remove synthetic value and update predicate comments together. [VERIFIED: milestone audit WR-03] |
| Request timeout docs | Milestone audit WR-09 identifies stale `timeout` documentation | Search and correct only the RESID-04-scoped stale doc without expanding into Phase 22 behavior. [VERIFIED: v1.2 audit] |
| D-07 comments | Current generic retry comments rely on `RelayClosedError` skip | Update to name the refined transient/terminal classification and additive counters. [VERIFIED: codebase] |

Changeset bodies must contain exactly one markdown sentence and one logical change per file. [VERIFIED: `AGENTS.md`]

## Common Pitfalls

### Pitfall 1: Multiplicative Retry Budgets

**What goes wrong:** `authRetries=2` and `retries=3` can produce up to twelve attempts if a fresh auth budget is created inside each generic retry.

**Why it happens:** RxJS `retry` resubscribes to its entire upstream source; state inside that source factory is recreated. [CITED: https://rxjs.dev/api/index/function/retry]

**How to avoid:** Put both counters in one publish-subscription closure, consume auth errors through a dedicated branch, and assert exactly `1 + authRetries + retries` EVENT frames.

**Warning signs:** Tests assert only eventual failure, or calculate `(authRetries + 1) * (retries + 1)`.

### Pitfall 2: Retry Never Sees Timeout

**What goes wrong:** The fixed reply timeout emits `{ok:false}` and `publish()` resolves instead of retrying.

**Why it happens:** `retry` reacts to the error channel, while `timeout({with})` switches to the supplied Observable; `of(...)` is a normal value. [CITED: https://rxjs.dev/api/operators/timeout] [CITED: https://rxjs.dev/api/index/function/retry]

**How to avoid:** Make per-attempt timeout a typed thrown client failure and test a real second EVENT write.

**Warning signs:** A timeout test checks only the final result or call count on a mocked method rather than socket frames.

### Pitfall 3: Relay Verdict Retried as Transport Failure

**What goes wrong:** A genuine `OK false` causes reconnect/retry, spamming a relay that already made a final decision.

**Why it happens:** Adding a typed `error` field to a response can tempt code to throw every error-bearing response.

**How to avoid:** Keep ordinary relay verdicts as values with a typed verdict object attached; reserve the error channel for client failures and EVENT auth-required control flow.

**Warning signs:** Tests expect a second EVENT after `blocked:`, `invalid:`, or ordinary `OK false`.

### Pitfall 4: Synchronous Handler Loses the Reply Listener

**What goes wrong:** The second EVENT is written but its immediate `OK` is never observed, or the second write is silently dropped.

**Why it happens:** A resubscription can occur inside the same notification stack that terminated the previous attempt; shared/call-scoped listen chains may not have reset.

**How to avoid:** Construct send and terminating listener per attempt in one unshared `defer`, and prove both second write and second reply.

**Warning signs:** Async handlers pass while a synchronous non-Promise handler fails.

### Pitfall 5: Whole-Operation Clock Resets Per Attempt

**What goes wrong:** Every retry receives a fresh timeout, so elapsed readiness/backoff time is unbounded.

**Why it happens:** The suspendable timeout is placed inside the attempt factory rather than around the whole publish operation.

**How to avoid:** Keep fixed reply timeout inside `event()` and configurable operation timeout outside all attempt/resend logic in `publish()`; suspend only for the active auth phase.

**Warning signs:** A publish lasting multiple configured timeout windows still succeeds.

### Pitfall 6: AUTH Verb Re-enters EVENT Auth Policy

**What goes wrong:** Relay rejection of an AUTH event recursively invokes the auth handler.

**Why it happens:** Prefix parsing is applied without checking `verb === "EVENT"`.

**How to avoid:** Gate `AuthRequiredError` conversion to EVENT only; all AUTH `OK` frames are values.

**Warning signs:** `auth()` invokes `onAuthRequired`, or sends more than one AUTH frame.

### Pitfall 7: Sync Silently Loses SEND Authentication

**What goes wrong:** After raw `event()` loses auth policy, `sync()` continues calling it directly and authenticated uploads stop working.

**Why it happens:** The internal bypass was previously harmless because low-level `event()` owned policy.

**How to avoid:** Rewire only the SEND transfer call to `publish()` in Phase 18; leave the larger unified sync policy to Phase 24.

**Warning signs:** Existing RAUTH-08 sync SEND test is deleted rather than rewritten against `publish()`.

## Code Examples

Verified patterns from official sources and the repository:

### Retry Requires an Error

```typescript
// Source: https://rxjs.dev/api/operators/timeout
source$.pipe(
  timeout({ first: attemptMs, with: () => throwError(() => new ReplyTimeoutError()) }),
  retry({ count: retries }),
);
```

### Per-Subscription Factory

```typescript
// Source: https://rxjs.dev/api/index/function/defer
const attempts$ = defer(() => createFreshEventAttempt());
```

### Group Isolation Stays at the Aggregator Boundary

```typescript
// Source: packages/relay/src/group.ts
const observable = project(relay).pipe(errorToPublishResponse(relay));
```

## State of the Art

| Old Approach | Current Phase Approach | When Changed | Impact |
|--------------|------------------------|--------------|--------|
| `event()` owns auth retry and `publish()` reparses response messages | Raw `event()` throws once; `publish()` consumes the typed signal and owns policy | Phase 18 | Removes duplicated ownership and string discrimination. [VERIFIED: context] |
| Timeout fallback emits a failed response value | Attempt timeout errors; high-level retry can observe it | Phase 18 | Makes `publish({retries})` effective for timeout. [CITED: RxJS docs] |
| RAUTH-07 exposes auth hooks on raw and high-level EVENT APIs | Auth hooks remain on `publish`; raw EVENT is deliberately narrowed | Phase 18 provenance restatement | Aligns the public API with low/high layering. [VERIFIED: context] |
| Sync SEND calls raw `event()` | Temporary SEND-through-`publish()` bridge | Phase 18, superseded in Phase 24 | Preserves auth behavior until unified sync policy lands. [VERIFIED: context] |

**Deprecated/outdated:** The internal EVENT `AuthRequiredSignal` conversion path, `AUTH_PHASE_GATE` threading from `publish()` into `event()`, manufactured timeout `PublishResponse`, and held changeset claims that raw `event()` owns auth options. [VERIFIED: codebase and context]

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| — | None. All planning-relevant claims were verified against repository artifacts or cited from official RxJS documentation. | — | — |

## Open Questions (RESOLVED)

1. **Typed relay-verdict error class name and shape — resolved:** Add exported `RelayEventVerdictError extends Error`, carrying the relay's verdict message without inheriting from `RelayClosedError`; attach it only to genuine `OK false` response values, so retry classification never sees it as a thrown terminal or transient failure. [VERIFIED: locked decision; existing relay error taxonomy]

2. **Raw `RelayEventOptions` remaining fields — resolved:** Remove `RelayEventOptions` and the raw `event()` options parameter rather than preserving an empty bag. Exact call-site search found only auth-policy arguments in Relay tests/internal publish/sync paths, Group pass-through tests, and Pool pass-through tests; no genuine raw-attempt input exists, readiness is internal, and the fixed reply bound is not configurable. Update Relay, Group, and Pool signatures structurally and move internal policy callers to `publish()`. [VERIFIED: `rg -n "RelayEventOptions|\\.event\\([^\\n]*," packages/relay/src`]

3. **Clean completion before `OK` at the Promise boundary — resolved:** Preserve clean empty completion from raw `event()` exactly. At `publish()`'s `lastValueFrom` boundary, the resulting RxJS `EmptyError` is a terminal client-side outcome and is not eligible for generic retry/reconnect; only an explicit reconnectable socket-loss error may retry. Lock both raw completion and high-level rejection/no-second-write behavior with tests. [VERIFIED: locked clean-completion contract and explicit transient-only retry decision]

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| Node.js | build/tests | ✓ | `v22.23.1` | — |
| pnpm | workspace scripts | ✓ | `11.10.0` | — |
| RxJS | runtime | ✓ | `7.8.2` installed | — |
| Vitest | tests | ✓ | `4.0.15` manifest | — |
| WebSocket mock | wire tests | ✓ | `0.5.0` manifest | — |

**Missing dependencies with no fallback:** None. [VERIFIED: environment and manifests]

**Missing dependencies with fallback:** None. [VERIFIED: environment and manifests]

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest `^4.0.15` with `vitest-websocket-mock` `^0.5.0` |
| Config file | Root/workspace Vitest discovery; package script in `packages/relay/package.json` |
| Quick run command | `pnpm --filter applesauce-relay exec vitest run src/__tests__/relay.test.ts` |
| Full suite command | `pnpm --filter applesauce-relay test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| EVT-01 | one write/reply; EVENT auth refusal throws; AUTH refusal is a value; clean close completes | WebSocket unit | `pnpm --filter applesauce-relay exec vitest run src/__tests__/relay.test.ts` | ✅ extend |
| EVT-02 | publish auth handler/resend, synchronous handler, fresh listener, call-scoped concurrency | WebSocket unit | same | ✅ extend |
| EVT-03 | reply timeout causes a real second EVENT write | timed WebSocket unit | same | ✅ extend |
| EVT-04 | no symbol threading/string reconstruction on EVENT path | unit + static grep | `rg -n "AUTH_PHASE_GATE|authRequiredSignal" packages/relay/src/relay.ts` plus relay test | ✅ adapt |
| EVT-05 | RAUTH-07 provenance and type narrowing | static/type test | `pnpm --filter applesauce-relay build` plus targeted grep | ❌ Wave 0 type fixture or `@ts-expect-error` needed |
| EVT-06 | group raw one-attempt fan-out; sync SEND calls publish | unit/integration | `pnpm --filter applesauce-relay exec vitest run src/__tests__/group.test.ts src/__tests__/pool.test.ts src/__tests__/relay.test.ts` | ✅ rewrite/extend |
| RESID-04 | no false comments/docs/changesets remain | static audit | `rg -n "event.*onAuthRequired|publish.*error|Timeout|progress" .changeset packages/relay .planning/milestones/v1.2-*` | ❌ planner should enumerate exact acceptance grep |

### Sampling Rate

- **Per task commit:** targeted affected test file plus `pnpm --filter applesauce-relay build`
- **Per wave merge:** `pnpm --filter applesauce-relay test`
- **Phase gate:** relay build/test green, changeset format check, exact D-01/D-07/RAUTH-07/RESID-04 audit, and RED→GREEN mutation evidence recorded before `$gsd-verify-work`

### Wave 0 Gaps

- [ ] Add or identify a compile-time fixture proving raw Relay/Group/Pool `event()` rejects auth/retry/timeout options while `publish()` accepts them.
- [ ] Add wire-trace tests for additive `1 + authRetries + retries`, synchronous auth resend plus observed reply, per-resend listener freshness, concurrent publish independence, and timeout's second EVENT write.
- [ ] Add classification controls proving ordinary `OK false`, terminal CLOSED, exhausted auth, handler rejection, and auth timeout never enter generic retry.
- [ ] Rewrite group/pool RAUTH-07 table cases that currently expect all four auth options on `event()`.
- [ ] Rewrite sync SEND test to spy/trace `publish()` rather than raw `event()`.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | yes | Operation-scoped NIP-42 handler with bounded auth retries and no AUTH recursion. [VERIFIED: codebase/context] |
| V3 Session Management | yes | Relay authentication state remains informational; publish gates/counters are call-scoped. [VERIFIED: codebase] |
| V4 Access Control | no | Phase does not make authorization decisions; it preserves relay verdicts. [VERIFIED: scope] |
| V5 Input Validation | yes | Match `OK` by event id, parse `auth-required:` only for EVENT, treat other relay verdicts as typed values. [VERIFIED: context] |
| V6 Cryptography | no | Signing remains in the caller-provided auth handler/`authenticate()`; Phase 18 changes no crypto. [VERIFIED: scope] |

### Known Threat Patterns for Relay EVENT Publishing

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Relay-controlled message text triggers internal policy | Spoofing / Tampering | Branch once at the protocol boundary into a typed error; never reparse text downstream. [VERIFIED: EVT-04] |
| Malicious relay forces unbounded resend amplification | Denial of Service | Independent bounded counters and exact additive write invariant. [VERIFIED: context] |
| Relay verdict incorrectly treated as transient | Denial of Service | Preserve genuine `OK false` as a value and exclude typed terminal failures from retry. [VERIFIED: context] |
| Concurrent publish leaks auth/counter state | Tampering / Information disclosure | One gate and counters per publish subscription; no relay-scoped dedupe. [VERIFIED: RAUTH-05 pattern] |
| Slow handler consumes operation budget or races timeout | Denial of Service | Suspend whole-operation clock only during legitimate auth phase; retain separate auth timeout. [VERIFIED: context] |

## Project Constraints (from AGENTS.md)

- Documentation belongs in existing relevant locations; do not create a standalone best-practices document. [VERIFIED: `AGENTS.md`]
- Component docs, if edited, follow What it is → How to use it → Integration → Best Practices and omit summary sections. [VERIFIED: `AGENTS.md`]
- Documentation code blocks stay short and focused, approximately 20 lines maximum, and avoid duplicated setup. [VERIFIED: `AGENTS.md`]
- Each `.changeset` file describes exactly one change and its body is one markdown sentence; use the smallest applicable bump per package. [VERIFIED: `AGENTS.md`]
- Before completion, verify code examples/work, update navigation if docs move, and leave no duplicate/orphaned files. [VERIFIED: `AGENTS.md`]
- The NIP support checklist is not triggered: this phase changes relay method layering, not support for a new NIP. [VERIFIED: phase scope]

## Sources

### Primary (HIGH confidence)

- `packages/relay/src/relay.ts`, `types.ts`, `group.ts`, `pool.ts`, `operators/auth-retry.ts`, and relay tests — current implementation, signatures, errors, call graph, and test patterns. [VERIFIED: codebase]
- `.planning/phases/18-event-family-re-layer/18-CONTEXT.md` — accepted locked behavior and proof obligations. [VERIFIED: planning artifact]
- `.planning/REQUIREMENTS.md` EVT-01..06 and RESID-04; `.planning/ROADMAP.md`; `.planning/STATE.md`. [VERIFIED: planning artifacts]
- Phase 16 research/context/summary and archived Phase 13 context/research/summaries/validation — D-01 and RAUTH provenance. [VERIFIED: planning artifacts]
- `.planning/milestones/v1.2-MILESTONE-AUDIT.md` — WR-03/WR-06/WR-09 residuals. [VERIFIED: planning artifact]
- `AGENTS.md` — repository documentation, changeset, and verification constraints. [VERIFIED: codebase]

### Secondary (MEDIUM confidence)

- https://rxjs.dev/api/index/function/defer — per-subscription factory behavior. [CITED: official RxJS docs]
- https://rxjs.dev/api/index/function/retry and https://rxjs.dev/api/operators/RetryConfig — error-only resubscription and retry configuration. [CITED: official RxJS docs]
- https://rxjs.dev/api/operators/timeout and https://rxjs.dev/api/operators/TimeoutConfig — default timeout error and `with` fallback semantics. [CITED: official RxJS docs]

### Tertiary (LOW confidence)

- None.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — package versions and installed environment verified locally; no new dependency proposed.
- Architecture: HIGH — call paths, option types, errors, and tests read from current source and constrained by accepted context.
- Pitfalls: HIGH — grounded in prior Phase 13 reproduced defects, current code, locked invariants, and official RxJS semantics.

**Research date:** 2026-08-20
**Valid until:** 2026-09-19 (stable internal architecture; revalidate if Phase 18 source changes before planning)

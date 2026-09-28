# Phase 18: EVENT Family Re-layer - Pattern Map

**Mapped:** 2026-08-20
**Files analyzed:** 13 implementation/test/provenance targets
**Analogs found:** 13 / 13

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/relay/src/relay.ts` | service / protocol client | request-response, event-driven | `Relay.req()` and `Relay.count()` in the same file | exact |
| `packages/relay/src/types.ts` | model / public API | request-response | `PublishOptions`, `RelayReqOptions`, and structural forwarding types in `group.ts`/`pool.ts` | exact |
| `packages/relay/src/operators/auth-retry.ts` | utility / RxJS operator | event-driven transform | existing `authRetry`, `AuthPhaseGate`, and `suspendableTimeout` | exact |
| `packages/relay/src/group.ts` | service / aggregator | request-response fan-out | `internalPublish()` plus current `event()`/`publish()` split | exact |
| `packages/relay/src/pool.ts` | service / forwarding facade | request-response fan-out | existing `event()`/`publish()` structural forwarding | exact |
| `packages/relay/src/__tests__/relay.test.ts` | test | WebSocket request-response | REQ/COUNT synchronous resend and EVENT wire tests in the same file | exact |
| `packages/relay/src/__tests__/group.test.ts` | test | multi-relay aggregation | current group EVENT error-isolation tests | exact |
| `packages/relay/src/__tests__/pool.test.ts` | test / type-surface forwarding | request-response | current table-driven pool forwarding suite | exact |
| `packages/relay/src/__tests__/auth-lifecycle-logging.test.ts` | test | event-driven log trace | ordered real-wire lifecycle trace | role-match |
| `.planning/milestones/v1.2-phases/13-operation-scoped-nip-42-auth-hooks/13-CONTEXT.md` | config / decision record | documentation | Phase 16's in-place D-01 amendment | exact |
| `.planning/milestones/v1.2-REQUIREMENTS.md` | config / requirements provenance | documentation | prior ALOG/CAUTH restatement convention and RAUTH-07 source row | exact |
| `.changeset/relay-operation-scoped-auth-callbacks.md`, `.changeset/wait-for-auth-pubkeys.md`, `.changeset/relay-publish-timeout-marks-itself.md`, `.changeset/relay-publish-response-error-field.md` | config / release metadata | documentation | existing one-package changesets | exact |
| `.changeset/<focused-event-layering-name>.md` | config / release metadata | documentation | `.changeset/relay-operation-scoped-auth-callbacks.md` frontmatter/body shape | exact |

The planner should treat `relay.ts`, its tests, and `auth-retry.ts` as one behavior unit: moving only the method bodies without updating shared comments/symbol exports leaves D-01/D-07/EVT-04 contradictory. Group/Pool/types and their tests form a second unit. Provenance and held changesets form a third unit after runtime behavior is green.

## Pattern Assignments

### `packages/relay/src/relay.ts` (service, request-response/event-driven)

**Primary analog:** `Relay.req()` at `packages/relay/src/relay.ts:956-1067`.

**Fresh attempt pattern** (`relay.ts:956-973`, focused excerpt):

```typescript
return defer(() => {
  let relayClosedSub = false;
  const messages = this.socket.pipe(
    filter((m) => Array.isArray(m) && matches(m)),
    map((m) => toMessage(m)),
    share(),
  );
  // send and terminating listener are created in this attempt
  return this.waitForReady(attempt(messages));
}).pipe(/* policy operators live outside the attempt */);
```

Apply this shape to raw `event()`: the matching `OK` listener and `this.socket.next([verb, event])` belong inside the same unshared `defer`, with the listener established before the write. Preserve `waitForReady()` as the single readiness precondition (`relay.ts:890-903`). Do not retain the current split where `messages` is call-scoped (`relay.ts:1195-1204`).

**Protocol/error boundary analog** (`relay.ts:987-1005`):

```typescript
if (m.type === "CLOSED") {
  if (m.reason.startsWith(AUTH_REQUIRED_PREFIX)) {
    this.receivedAuthRequiredFor("REQ");
    return authRequiredSignal(m.reason);
  }
  const error = parseClosedError(m.reason);
  if (error) throw error;
}
return m;
```

For EVENT, narrow this further per the locked contract: matching `OK true` and ordinary `OK false` remain values; only `verb === "EVENT" && !ok && message.startsWith(AUTH_REQUIRED_PREFIX)` throws `AuthRequiredError`. For `verb === "AUTH"`, even an `auth-required:` text is a verdict value. A clean socket close completes. The current `auth()` call must remain `this.event(event, "AUTH")` (`relay.ts:1319-1328`).

**Reply timeout pattern** (`relay.ts:1178-1181`, COUNT):

```typescript
suspendableTimeout<RelayCountResponse>(10_000, gate, {
  firstWhen: () => true,
  with: () => throwError(() => new Error("COUNT timeout")),
})
```

Use a typed EVENT reply-timeout error on the error channel rather than the current synthetic `of<PublishResponse>` at `relay.ts:1244-1259`. Keep the fixed bound inside each raw attempt so `publish()` retry can observe it.

**High-level policy analog:** current `publish()` outer composition (`relay.ts:1590-1624`) plus the per-call gate pattern in `request()` (`relay.ts:1560-1577`).

```typescript
const gate = new AuthPhaseGate();
return lastValueFrom(
  attempt$.pipe(
    authPolicy,
    transientRetryPolicy,
    this.customSuspendableTimeoutOperator(opts?.timeout, this.publishTimeout, gate, () => true),
  ),
);
```

Construct `gate`, auth counter, and transient counter once per `publish()` subscription/call. `publish()` should call readiness-aware `event()` directly, consume `AuthRequiredError` through the auth branch, then allow only typed transient client/socket errors into generic retry. Never place a fresh auth budget inside the generic retry factory: maximum EVENT writes must be `1 + authRetries + retries`, not multiplicative.

**Auth machinery to reuse:** `authRetryOperator()` at `relay.ts:835-887` adapts public options into the shared handler/wait/timeout/logging machinery. Preserve its `buildAuthContext`, `authSatisfied$`, `satisfiedPubkeys`, gate, and three terminal error constructors. Adapt its input boundary for the direct thrown `AuthRequiredError`; do not duplicate handler logic in `publish()`.

**Retry classification analog** (`relay.ts:1464-1473`):

```typescript
return retry({
  ...config,
  delay: (error, count) => {
    if (error instanceof RelayClosedError) return throwError(() => error);
    if (typeof config.delay === "number") return timer(config.delay);
    if (typeof config.delay === "function") return config.delay(error, count);
    return of(null);
  },
});
```

Refine rather than broaden this classifier. Terminal `RelayClosedError` subclasses, auth exhaustion, handler rejection, and auth timeout bypass generic retry. Ordinary relay `OK false` never reaches retry because it remains a value. Only explicit reply timeout and reconnectable transport/socket failures retry.

**Sync SEND wiring** (`relay.ts:1672-1682`): replace only `lastValueFrom(this.event(event, "EVENT", authOptions))` with the high-level `this.publish(event, ...)` bridge. Preserve `Promise.allSettled`, `addSeenRelay` only on `response.ok`, RECEIVE `req()` behavior, and negentropy option forwarding. This is temporary Phase 18 wiring; do not design Phase 24's unified sync budget here.

### `packages/relay/src/types.ts` (model/public API, request-response)

**Analog:** separation between `PublishOptions` (`types.ts:120-131`) and lower-level option types.

```typescript
export type PublishOptions = {
  retries?: boolean | number | Parameters<typeof retry>[0];
  reconnect?: boolean | number | Parameters<typeof retry>[0];
  timeout?: number | boolean;
} & RelayAuthOptions;
```

Keep this high-level surface source-compatible. Narrow `RelayEventOptions` at `types.ts:161-162` so it contains no auth, retry, reconnect, or whole-operation timeout policy. If there are no genuine raw inputs, prefer omitting the options parameter/type over inventing a caller-configurable fixed reply timeout; if structural compatibility requires a type, make its emptiness explicit.

`PublishResponse` at `types.ts:133-140` remains the shared value. A real `OK false` must carry a typed relay-verdict error in `error`; client failures reject and do not manufacture `PublishResponse`. Name the verdict error narrowly and do not subclass `RelayClosedError`, because it is a non-thrown relay result.

Correct the stale `RelayRequestOptions.timeout` prose at `types.ts:180-184` in the same documentation/provenance task: it is handled by `suspendableTimeout`, not directly “Passed to rjxs timeout()”. Do not change REQ behavior (Phase 22).

### `packages/relay/src/operators/auth-retry.ts` (utility, event-driven transform)

**Analog:** the existing per-subscription auth state (`auth-retry.ts:252-260`) and phase finalization (`:291-360`).

```typescript
return (source) =>
  defer(() => {
    let consecutive = 0;
    // all state below is scoped to this operation subscription
    return source.pipe(/* consume auth condition and resubscribe */);
  });
```

Reuse `AuthPhaseGate` (`:69-93`) and `suspendableTimeout` (`:115-199`). Preserve `gate.begin()` inside phase construction and `finalize(() => gate.end())` on every exit. Preserve synchronous-handler normalization (`:301-320`): a direct throw and rejected Promise both become `AuthHandlerError`.

EVT-04 removes EVENT's dependence on `AUTH_PHASE_GATE`, `WithAuthPhaseGate`, and the `AuthRequiredSignal` message round trip. Do not delete these wholesale if REQ/COUNT/negentropy still use them. Narrow comments and exports to the remaining multi-hop users; remove only EVENT/publish symbol threading.

### `packages/relay/src/group.ts` (aggregator, request-response fan-out)

**Analog:** `internalPublish()` at `group.ts:193-225`.

```typescript
const observable = project(relay).pipe(
  errorToPublishResponse(relay),
);
observables.push(observable);
return merge(...observables);
```

Keep `RelayGroup.event()` (`group.ts:233-236`) as raw fan-out: one `relay.event()` per relay and per-relay error conversion, with no auth/reconnect/retry policy. Keep `RelayGroup.publish()` (`:259-263`) delegating to `relay.publish()` and collecting results. Preserve `errorToPublishResponse()` (`:77-88`) as the aggregation boundary that converts thrown failures into `{ok:false, from, message, error}`.

Derive the raw option type structurally from `Relay["event"]`, as it does today, but update the parameter index/removal if the Relay signature narrows. Do not copy `PublishOptions` onto group `event()`.

### `packages/relay/src/pool.ts` (forwarding facade, request-response fan-out)

**Analog:** current structural delegation at `pool.ts:155-181`.

```typescript
event(relays, event, opts?: Parameters<RelayGroup["event"]>[1]) {
  return this.group(relays).event(event, opts);
}

publish(relays, event, opts?: Parameters<RelayGroup["publish"]>[1]) {
  return this.group(relays).publish(event, opts);
}
```

Retain structural derivation so Relay → Group → Pool narrowing propagates automatically. If Group removes raw event options entirely, remove the Pool argument and its forwarding rather than leaving a permissive empty policy bag.

## Test Pattern Assignments

### `packages/relay/src/__tests__/relay.test.ts`

**Fixture convention:** real `vitest-websocket-mock` frames with `await expect(server).toReceiveMessage(...)`, followed by an explicit server reply and promise/subscriber assertion. This is stronger than spying on `event()` because it proves resend and listener freshness.

**One-attempt baseline** (`relay.test.ts:502-514`):

```typescript
const spy = subscribeSpyTo(relay.event(mockEvent));
expect(await server.nextMessage).toEqual(["EVENT", mockEvent]);
server.send(["OK", mockEvent.id, true, ""]);
await spy.onComplete();
expect(spy.receivedComplete()).toBe(true);
```

Extend this describe block to prove: ordinary `OK false` is one value with typed verdict error; EVENT auth refusal errors with `AuthRequiredError` after exactly one write; AUTH auth-looking refusal is a value and sends no extra AUTH; mismatched OK is ignored; clean close completes empty; unclean close errors; readiness delays the write without consuming the fixed reply clock.

**Synchronous resend analog:** REQ test `relay.test.ts:1900-1931` and COUNT test `:2549-2588`. Copy their oracle: synchronous handler, second wire frame asserted, second reply sent, final emitted/resolved value asserted. This directly covers the historical reentrancy bug.

**Bound/non-vacuity analog** (`relay.test.ts:1012-1045`): count real EVENT frames in `server.messages`, wait past configured retry delay when proving absence, and record RED→GREEN by temporarily mutating/removing the classifier or resend seam. Replace the old `authRetries + 1` claim with cases proving the additive `1 + authRetries + retries` maximum and independent counters.

Add controls showing no generic retry after ordinary relay verdict, terminal typed CLOSED, auth exhaustion, `AuthHandlerError`, or `AuthTimeoutError`; add positive controls showing a fixed reply timeout and reconnectable socket loss perform a real second EVENT write. Add two concurrent `publish()` calls with separate handlers/counters.

Rewrite current tests that encode old behavior: `event()` auth loop (`:466-490`), synthetic timeout values (`:537-550`, `:628-688`), direct raw-event auth options (`:1057-1063`, `:1130+`, `:1202`), and `publish()` forwarding policy into `event()` (`:1212-1221`). Preserve `auth()` state-recording coverage while updating timeout expectations to rejection.

**Sync SEND test:** adapt `relay.test.ts:3073-3100`. Spy on or trace `relay.publish()` for the SEND transfer; still drive a real negentropy round trip and assert the caller's auth handler reaches the high-level EVENT context. Do not delete RAUTH-08 coverage.

### `packages/relay/src/__tests__/group.test.ts`

**Analog:** `group.test.ts:131-189`. Preserve two-relay wire assertions, all-results completion, and failure isolation. Add a raw-contract test where an auth-required reply from one relay produces one converted failure response and exactly one EVENT frame for that relay; prove no handler and no resend. Separately assert `group.publish()` retains high-level policy per relay.

Rewrite the table at `group.test.ts:192-285`: remove `event` from the four-auth-option pass-through cases and replace it with a narrowing/raw-fan-out assertion. Keep `publish`, sync, req/request/subscription/count/negentropy coverage appropriate to their existing option contracts.

### `packages/relay/src/__tests__/pool.test.ts`

**Analog:** table-driven structural forwarding at `pool.test.ts:259-347`. Remove the old event auth-option row (`:309-316`) and the dedicated waitForAuth event assertion (`:240-247`). Add compile-time evidence (`@ts-expect-error` or a dedicated type fixture) that Relay/Group/Pool raw `event()` rejects auth/retry/timeout options while all three `publish()` surfaces accept them. Runtime Pool EVENT coverage at `:185-206` remains the raw forwarding oracle.

### `packages/relay/src/__tests__/auth-lifecycle-logging.test.ts`

Use its ordered real-wire trace convention (`auth-lifecycle-logging.test.ts:98-141`): locate lines with `findIndex` and assert relative ordering rather than exact arrays. Update only EVENT-specific expectations affected by ownership; preserve challenge → AUTH sent → verdict → resend continuity and bounded/truncated log assertions.

## Provenance and Release Pattern Assignments

### Archived D-01 / D-07 / RAUTH-07

Phase 16 established that the source of record and all shipped citations change together. Amend the existing D-01 block in `13-CONTEXT.md`; do not append a competing decision. Preserve its one-hop throw carve-out and restate EVENT as the canonical example: raw `event()` surfaces `AuthRequiredError`, immediate `publish()` consumes it. Keep REQ/COUNT multi-hop value signalling unchanged.

Restate RAUTH-07 in `.planning/milestones/v1.2-REQUIREMENTS.md:31` with dated provenance rather than silently deleting `event`: auth policy remains on `publish`; raw Relay/Group/Pool `event()` is deliberately narrowed by Phase 18. Update the relevant Phase 13 summary/validation references only where necessary to keep the historic claim understandable; do not rewrite historical execution facts.

Update D-07 comments at `relay.ts:1445-1473` and `:1614-1618` to state the new explicit transient/terminal classifier and additive counters. Update the false progress comments at `relay.ts:1244-1251` and `:1619-1622` as part of the same runtime edit.

### Held changesets and new focused changeset

Existing frontmatter/body shape (`.changeset/relay-operation-scoped-auth-callbacks.md:1-5`):

```markdown
---
"applesauce-relay": minor
---

`publish` owns operation-scoped EVENT authentication while raw `event` performs one bounded wire attempt.
```

Every changeset body must be exactly one markdown sentence and describe one logical change. Audit and correct these held claims:

- `.changeset/relay-operation-scoped-auth-callbacks.md`: must not say raw `event` accepts auth callbacks/options.
- `.changeset/wait-for-auth-pubkeys.md`: must not list raw `event` as accepting `waitForAuth`.
- `.changeset/relay-publish-timeout-marks-itself.md`: must not say a client timeout resolves as a response with `.error`; client failures reject.
- `.changeset/relay-publish-response-error-field.md`: align `error` with typed relay verdicts and group-converted thrown failures without claiming client failures manufacture raw responses.

Use the smallest applicable bump, but the re-layer/narrowed published API is a breaking v7 behavior tracked as a focused `applesauce-relay` changeset. Do not combine unrelated RESID-04 corrections into a multi-sentence body.

## Shared Patterns

### Authentication and clock ownership

- One `AuthPhaseGate` per high-level `publish()` call; never store it on `Relay`.
- Whole-operation `publishTimeout` wraps readiness, backoff, and all attempts, and suspends only during the active auth phase.
- Fixed reply timeout lives inside raw `event()` and is never caller-configurable.
- `auth()` stays raw and never invokes EVENT auth policy.

### Error taxonomy

- Relay `OK` verdict: value, including `ok:false`, with a typed verdict error attached.
- EVENT `auth-required:`: typed `AuthRequiredError` thrown once at protocol boundary.
- Client/socket failure: error channel; retry only if explicitly transient.
- Group boundary: catch per-relay thrown errors into `PublishResponse` with original `error` object.
- Never discriminate policy downstream by reparsing `PublishResponse.message`.

### Wire-test non-vacuity

Assertions must count actual WebSocket EVENT frames, observe the reply to the resend, and include controls for both retry and non-retry classifications. A mock-method call count alone does not prove a fresh listener was installed.

### Verification sequence

```bash
pnpm --filter applesauce-relay exec vitest run src/__tests__/relay.test.ts
pnpm --filter applesauce-relay exec vitest run src/__tests__/group.test.ts src/__tests__/pool.test.ts
pnpm --filter applesauce-relay build
pnpm --filter applesauce-relay test
```

Then run static acceptance searches for `AUTH_PHASE_GATE`/`authRequiredSignal` on the EVENT path, stale raw-event auth option claims, synthetic timeout response wording, D-01/D-07/RAUTH-07 consistency, and one-sentence changeset bodies. The symbols may remain for REQ-family multi-hop consumers; the gate is absence from EVENT/publish threading, not necessarily global deletion.

## No Analog Found

None. Every target is an in-place re-layering or has a strong existing REQ/COUNT/group/test/provenance analog.

## Planner File Ownership Guidance

| Suggested work unit | Files owned | Dependency |
|---|---|---|
| Raw EVENT contract and tests | `relay.ts`, `types.ts`, `relay.test.ts` | none |
| Publish policy and shared auth machinery | `relay.ts`, `operators/auth-retry.ts`, `relay.test.ts`, `auth-lifecycle-logging.test.ts` | raw contract |
| Group/Pool/sync downstream wiring | `relay.ts` sync section, `group.ts`, `pool.ts`, `group.test.ts`, `pool.test.ts`, `relay.test.ts` sync section | publish policy |
| Provenance and release truth | archived `13-CONTEXT.md`, v1.2 requirements/relevant summaries, four held changesets, new focused changeset | behavior green |

Because `relay.ts` and `relay.test.ts` span the first three units, execute them sequentially or give one executor ownership; parallel edits would conflict and make the additive-counter proof hard to attribute.

## Metadata

**Analog search scope:** `packages/relay/src` EVENT/REQ/COUNT/auth/retry/group/pool/sync implementations and tests; Phase 13 provenance; Phase 16 layering artifacts; v1.2 milestone audit; held relay changesets

**Strong analogs used:** 5 (`req()`, `count()`, `authRetry`, `internalPublish`, structural Group/Pool forwarding)

**Pattern extraction date:** 2026-08-20

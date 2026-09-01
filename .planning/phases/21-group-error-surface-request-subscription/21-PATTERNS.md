# Phase 21: Group Error Surface — request()/subscription() - Pattern Map

> **Phase 22 D-23/D-24 amendment:** Subscription lifetime-wrapper patterns below are historical and superseded. Relay, Group, and Pool subscriptions are clock-free; request retains its whole-operation timeout and total group failure remains immediate.

**Mapped:** 2026-09-01
**Files analyzed:** 13 new/modified files
**Analogs found:** 13 / 13

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/relay/src/types.ts` | model | request-response | `packages/relay/src/types.ts:180-197,245-278` | exact |
| `packages/relay/src/group.ts` | service | event-driven / streaming | `packages/relay/src/group.ts:162-197,272-328,389-437` | exact |
| `packages/relay/src/operators/auth-retry.ts` | utility/operator | event-driven | `packages/relay/src/operators/auth-retry.ts:69-199` | exact |
| `packages/relay/src/pool.ts` | service/facade | request-response / streaming | `packages/relay/src/pool.ts:98-127,180-234` | exact |
| `packages/relay/src/__tests__/group-error.test.ts` (new) | test | event-driven / streaming | `packages/relay/src/__tests__/group.test.ts:25-55,471-604` | exact |
| `packages/relay/src/__tests__/pool.test.ts` | test | request-response / streaming | `packages/relay/src/__tests__/pool.test.ts:155-183,209-338` | exact |
| `packages/relay/src/__tests__/exports.test.ts` | test | transform | `packages/relay/src/__tests__/exports.test.ts:1-39` | exact |
| `packages/relay/type-tests/group-error-types.ts` (new) | test | transform | `packages/relay/type-tests/event-auth-types.ts:1-11` | role-match |
| `apps/docs/loading/relays/pool.md` | documentation | request-response / streaming | same file, especially `:96-178,261-281` | exact |
| `apps/docs/migration/v5-v6.md` | documentation | transform | same file `:111-147` | exact |
| `.planning/REQUIREMENTS.md` | config/provenance | transform | same file `:62-68,164-168` | exact |
| `.planning/ROADMAP.md` | config/provenance | transform | same file `:197-210,229-235` | exact |
| `.changeset/<phase-21-name>.md` (new) | config/release | transform | `.changeset/relay-group-request-timeout-suspended.md:1-5` | exact |

`packages/relay/src/index.ts` needs no dedicated edit if the class remains exported from `group.ts` and the type from `types.ts`: its existing `export *` barrels at lines 1 and 7 already forward both. The runtime snapshot still must prove the class export.

## Pattern Assignments

### `packages/relay/src/types.ts` (model, request-response)

**Analog:** `packages/relay/src/types.ts:180-197,245-278`

**Public option/type placement:** keep high-level method policy beside the existing Group aliases, and use intersections rather than duplicating inherited fields.

```typescript
export type RelayRequestOptions = RelayReqOptions & {
  timeout?: number;
  complete?: RelayRequestCompleteOperator;
};

export type GroupSubscriptionOptions = RelaySubscriptionOptions & {
  eventStore?: IEventStoreActions | IAsyncEventStoreActions | null;
};
```

Add `RelayOutcome<T>` as the single exported discriminated union near the response types. Change Group subscription options to expose `timeout?: number | false`; preserve request's 30-second-default `timeout` surface. Keep the internal `GroupReqErrorMessage` union for raw `req()` bookkeeping; a private cohort control record should not leak into `GroupReqMessage`.

**Type derivation pattern:** Pool already derives its option parameters from Group rather than redeclaring them (`pool.ts:181-201`). This is the propagation mechanism the type fixture should lock.

### `packages/relay/src/group.ts` (service, event-driven / streaming)

**Analog:** `packages/relay/src/group.ts:162-197`

**Imports/fan-out pattern:** retain RxJS operators from `rxjs`, internal relative imports with `.js`, a per-Relay upstream cache, and `reverseSwitchMap` for gap-free dynamic replacement.

```typescript
const upstream = new WeakMap<Relay, Observable<GroupReqMessage>>();
return this.relays$.pipe(
  reverseSwitchMap((relays) => {
    const observables = relays.map((relay) =>
      project(relay).pipe(catchError((error) => of({ type: "ERROR", from: relay.url, error }))),
    );
    return merge(...observables);
  }),
  share(),
);
```

Adapt this seam into a private membership-first high-level stream: normalize/deduplicate URLs, emit a cohort replacement before subscribing to its inners, retain state only for retained URLs, initialize additions as pending, and remove departed URLs immediately. Do not change raw `req()`'s `GroupReqMessage` behavior.

**Aggregate error pattern:** place the exported `RelayGroupError extends AggregateError` beside `RelayGroup`, use one ordered normalized `[url, cause]` sequence for both native `errors` and `outcomes`, set `name = "RelayGroupError"`, use exactly `"All relays failed"`, and preserve cause identity. Do not serialize, clone, wrap, or freeze causes.

```typescript
super(entries.map(([, cause]) => cause), "All relays failed");
this.name = "RelayGroupError";
this.outcomes = Object.fromEntries(entries.map(([url, error]) => [url, { ok: false, error }]));
```

**Single settlement pattern:** `request()` and `subscription()` currently branch at `group.ts:272-328`. Replace their competing terminal pipelines with one reducer/arbitrator that mutates state, decides all-failed first, then honors custom completion for the same message.

| Mode | Latest cohort state | Decision |
|---|---|---|
| request | empty | complete |
| request | every active URL failed | error with `RelayGroupError` |
| request | every active URL terminal and at least one EOSE | complete |
| subscription | empty | continue waiting |
| subscription | every active URL failed | error with `RelayGroupError` |
| either | otherwise | continue |

`EVENT` means live/progress, never terminal immunity. Request `EOSE` is successful terminal state; subscription `EOSE` leaves the relay live. Only caught Observable errors become failed. `CLOSED` remains a value. A later error replaces live/progress state.

**Custom completion analog and warning:** the helpers at `group.ts:389-437` remain public input patterns, but `completeWhen.ts:8-19` creates a second notifier subscription:

```typescript
return connect((shared$) => {
  const complete$ = shared$.pipe(operator, filter(check), take(1));
  return shared$.pipe(takeUntil(complete$));
});
```

Do not add an independent all-failed observer beside this. Feed the shared message stream to the caller's completion operator within the arbitrator and give the state mutation/all-failed decision precedence when the final `ERROR` triggers both outcomes synchronously.

**Normalization source:** use `normalizeURL` from `applesauce-core/helpers/url`, matching `pool.ts:1-4,81-95`; do not key by Relay object or raw input URL.

### `packages/relay/src/operators/auth-retry.ts` (utility/operator, event-driven)

**Analog:** `packages/relay/src/operators/auth-retry.ts:69-199`

**Shared auth gate:** reuse the counter-based gate exactly; overlapping phases only emit inactive after the count reaches zero.

```typescript
export class AuthPhaseGate {
  private count = new BehaviorSubject(0);
  readonly active$ = this.count.pipe(map((n) => n > 0), distinctUntilChanged());
  begin(): void { this.count.next(this.count.value + 1); }
  end(): void { this.count.next(Math.max(0, this.count.value - 1)); }
}
```

**Whole-lifetime sibling pattern:** model a new internal sibling after `suspendableTimeout()` at lines 115-199: subscribe to `gate.active$`, store remaining budget, subtract elapsed time only when disarming, clear timers on every terminal/teardown path, and optionally use a `with` factory. Unlike the existing first-progress helper, it must never inspect `next`, set `firstEmitted`, reset, or disarm on activity. Keep it internal (the module's lines 29-33 explain why auth/timer machinery is not barrel-exported).

Apply the operator after cohort arbitration and before event filtering/sharing. Request resolves omitted timeout to `30_000`; subscription resolves omitted/`false` to identity and a supplied number to the lifetime clock. Timeout is an operation error, not a per-relay outcome.

**Teardown/error pattern** (`auth-retry.ts:130-198`): mark settled, clear timer, unsubscribe gate and source, and forward the original source error unchanged. The implementation should use the project-consistent timeout error selected during implementation and test by type/name rather than fragile message text.

### `packages/relay/src/pool.ts` (service/facade, request-response / streaming)

**Analog:** `packages/relay/src/pool.ts:180-234`

**Transparent forwarding pattern:** preserve direct delegation and derived parameter types. This guarantees the same `RelayGroupError` instance and newly expanded timeout options pass through without translation.

```typescript
request(relays, filters: Parameters<RelayGroup["request"]>[0],
  opts?: Parameters<RelayGroup["request"]>[1]) {
  return this.group(relays).request(filters, opts);
}

subscription(relays, filters: Parameters<RelayGroup["subscription"]>[0],
  options?: Parameters<RelayGroup["subscription"]>[1]) {
  return this.group(relays).subscription(filters, options);
}
```

`subscriptionMap()` already builds a controlled dynamic Group from URL keys at lines 198-217, and `outboxSubscription()` delegates to it at lines 220-234. Do not catch, wrap, or map Group errors in any of the four families.

### `packages/relay/src/__tests__/group-error.test.ts` (test, event-driven / streaming)

**Analog:** `packages/relay/src/__tests__/group.test.ts:1-55,471-604`

Use the existing real-wire harness: two `WS` servers, real `Relay` objects, `subscribeSpyTo(..., { expectErrors: true })`, mocked information documents, and `WS.clean()` in teardown. Preserve observable assertions (`receivedComplete`, `receivedError`, `getValues`, `getError`) and await actual REQ wire messages before scripting terminal frames.

For dynamic membership, construct `RelayGroup` with a `BehaviorSubject<Relay[]>`; prove replacement by emitting add/remove cohorts. Cover all D-22 cases, including empty static/dynamic request completion, empty dynamic subscription staying open, failure after an event, mixed EOSE/error success, retained/added/removed URL state, final-error precedence over a synchronous custom completion operator, normalized keys, ordered causes, and `toBe(cause)` identity.

**Timer/auth analog:** `group.test.ts:477-529` proves one shared gate by spying on both `relay.req` calls and comparing the hidden `AUTH_PHASE_GATE` values by identity; its real auth phase intentionally exceeds the operation budget. Extend this for subscription and overlapping auth. Rewrite the old control at lines 580-603: Phase 21 requires an EVENT not to cancel the whole-lifetime clock.

Use fake timers where practical for absolute lifetime/no-reset cases, but retain real-wire auth tests because only actual relay auth/retry activity opens the gate. Assert timeout is not a `RelayGroupError` and does not populate outcomes.

### `packages/relay/src/__tests__/pool.test.ts` (test, request-response / streaming)

**Analog:** `packages/relay/src/__tests__/pool.test.ts:155-183,209-338`

Use the existing real `RelayPool` + websocket mocks. Add table-driven or focused cases for `request`, `subscription`, `subscriptionMap`, and `outboxSubscription`; drive every active relay to Observable failure and assert each surface receives the same Group contract (instance type, normalized outcomes, cause identity). Include numeric subscription timeout forwarding and dynamic map/outbox replacement. The existing auth-option table at lines 259-338 is the preferred family-coverage organization.

### `packages/relay/src/__tests__/exports.test.ts` (test, transform)

**Analog:** entire file, especially lines 4-37.

Add `RelayGroupError` to the sorted inline runtime export snapshot. `RelayOutcome` is type-only and therefore must not appear in `Object.keys(exports)`.

### `packages/relay/type-tests/group-error-types.ts` (test, transform)

**Analog:** `packages/relay/type-tests/event-auth-types.ts:1-11`

Use ordinary compiling statements plus `@ts-expect-error` negative checks. Import `RelayOutcome`, `RelayGroup`, and `RelayPool`; prove both union arms narrow by `ok`, request accepts numeric timeout, Group/Pool subscription families accept numeric timeout and `false`, and unsupported timeout shapes fail. Include `subscriptionMap` and `outboxSubscription`, since their options derive through `Parameters<RelayGroup["subscription"]>[1]`.

### `apps/docs/loading/relays/pool.md` (documentation, request-response / streaming)

**Analog:** existing method sections at lines 96-204 and Group integration at lines 261-281.

Update in place. Keep examples under about 20 lines and correct the current high-level examples to treat outputs as events rather than string `EOSE`. Add concise `RelayGroupError` error handling showing `outcomes`, explain normalized URL keys and mixed success, distinguish empty request completion from persistent empty dynamic subscription, and document request's default 30-second whole lifetime versus subscription's opt-in numeric lifetime. Add focused Integration and Best Practices content to this component doc; do not create a standalone best-practices file or summary.

### `apps/docs/migration/v5-v6.md` (documentation, transform)

**Analog:** lines 121-147 preserve and explain custom Group completion operators.

Amend this existing section rather than duplicating it: custom completion remains supported, but total active-cohort failure now wins on the same final error and surfaces `RelayGroupError`. Clarify that raw `req()` keeps lifecycle/error messages while high-level request/subscription use the Observable error channel.

### `.planning/REQUIREMENTS.md` and `.planning/ROADMAP.md` (config/provenance, transform)

**Analogs:** requirements `:62-68`; roadmap `:197-210`.

Make the locked provenance amendment verbatim in meaning: GROUP-04 becomes one whole-returned-Observable lifetime clock (not separate first-progress/idle clocks); GROUP-05 applies auth suspension to every enabled whole-operation clock. Roadmap success criteria 2, 4, and 5 must reflect subscription's opt-in lifetime/no default, activity not resetting the clock, and overlapping auth suspension. Keep Phase 23's reuse statement intact.

### `.changeset/<phase-21-name>.md` (config/release, transform)

**Analog:** `.changeset/relay-group-request-timeout-suspended.md:1-5`.

```markdown
---
"applesauce-relay": major
---

Make high-level group requests and subscriptions report total relay failure and use auth-suspendable whole-operation timeouts.
```

The final filename is discretionary, but the body must be exactly one Markdown sentence, with no bullets, code block, second paragraph, or second distinct change.

## Shared Patterns

### Authentication and operation-clock suspension

**Source:** `packages/relay/src/group.ts:279-301`, `packages/relay/src/operators/auth-retry.ts:69-103,130-198`

**Apply to:** Group request/subscription and every Pool forwarding family.

Create one `AuthPhaseGate` per returned high-level call, thread the same hidden symbol value into every active relay `req()`, and use the same counter across cohort replacement. Timer cleanup and gate unsubscription belong on complete, error, and caller unsubscribe.

### Dynamic membership

**Source:** `packages/relay/src/group.ts:162-197`, `packages/relay/src/operators/reverse-switch-map.ts:27-55`, `packages/relay/src/pool.ts:198-234`

**Apply to:** Group arbitration and Pool dynamic subscription families.

`reverseSwitchMap` subscribes the replacement before disposing the old inner, including synchronous emissions. Therefore the cohort control record must be concatenated before the replacement inners; otherwise a synchronous new-relay error can be evaluated against stale membership.

### Error transparency

**Source:** `packages/relay/src/pool.ts:180-234`

**Apply to:** Pool request, subscription, subscriptionMap, outboxSubscription.

Direct delegation is the contract. Do not use `catchError`, create a replacement error, alter `outcomes`, or convert aggregate failures to empty completion.

### Test isolation

**Source:** `packages/relay/src/__tests__/group.test.ts:25-55`, `packages/relay/src/__tests__/pool.test.ts:16-41`

**Apply to:** all real-wire tests.

Mock the relay information document, create websocket servers before Relays, await outgoing wire messages before responding, close servers after each test, and call `WS.clean()` so timers/connections do not leak across cases.

## No Analog Found

None. The cohort reducer and whole-lifetime timer are new semantics, but their implementation seams and teardown disciplines have exact in-repository analogs. The planner should treat the reducer as a deliberate adaptation of `internalSubscription`, not a copy of `completeWhen`.

## Metadata

**Analog search scope:** `packages/relay/src`, `packages/relay/type-tests`, `apps/docs/loading/relays`, `apps/docs/migration`, `.changeset`, `.planning/ROADMAP.md`, `.planning/REQUIREMENTS.md`
**Files scanned closely:** 17
**Pattern extraction date:** 2026-09-01

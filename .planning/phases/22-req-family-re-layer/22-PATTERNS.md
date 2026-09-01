# Phase 22: REQ Family Re-layer - Pattern Map

**Mapped:** 2026-09-01
**Files analyzed:** 18 new/modified files or artifact groups
**Analogs found:** 18 / 18

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/relay/src/relay.ts` (raw `req`) | service | streaming / request-response | same file `eventExchange()` at lines 1283-1317 | exact role/data-flow boundary |
| `packages/relay/src/relay.ts` (private lifecycle compositor) | service | event-driven retry/repeat | same file `count()` at lines 1146-1280 and `publish()` at 1712-1738 | exact policy pattern |
| `packages/relay/src/relay.ts` (`request`/`subscription`) | service | streaming / request-response | same file current methods at lines 1666-1709 | extraction target |
| `packages/relay/src/relay.ts` (`sync` RECEIVE) | service | batch / streaming | same file RECEIVE branch at lines 1741-1838 | exact consumer |
| `packages/relay/src/types.ts` | model/config | transform | `PublishOptions` and `RelayCountOptions` at lines 120-166 | exact positive type style |
| `packages/relay/src/group.ts` | service | streaming / event-driven | `settledSubscription()` at lines 218-324 | exact group lifecycle |
| `packages/relay/src/pool.ts` | facade | request-response forwarding | derived Group signatures at lines 171-233 | exact |
| `packages/relay/src/__tests__/relay.test.ts` | test | streaming / wire protocol | raw REQ tests at lines 97-323 and Phase 13 regressions at 1888-1958 | exact |
| `packages/relay/src/__tests__/group.test.ts` | test | streaming / fan-out | request clock/progress tests at lines 471-599 | exact |
| `packages/relay/src/__tests__/group-error.test.ts` | test | event-driven settlement | lines 19-228 and 230-297 | exact |
| `packages/relay/src/__tests__/pool.test.ts` | test | forwarding / streaming | forwarding table at lines 195-209 and auth boundary at 392-410 | role-match |
| `packages/relay/type-tests/group-error-types.ts` | test/config | compile-time transform | same file lines 9-24 | exact reversal target |
| `apps/docs/loading/relays/pool.md` | documentation | request-response | request/subscription sections at lines 96-143 | exact update target |
| `apps/docs/migration/v5-v6.md` | documentation | transform | REQ migration section at lines 111-149 | exact update target |
| `.planning/REQUIREMENTS.md` | config/documentation | transform | REQ/GROUP clauses at lines 31-37 and 62-68 | exact provenance target |
| `.planning/ROADMAP.md` | config/documentation | transform | Phase 21/22 sections at lines 197-231 | exact provenance target |
| `.planning/phases/21-group-error-surface-request-subscription/*` | documentation | transform | `21-CONTEXT.md`, `21-02-SUMMARY.md`, `21-VERIFICATION.md` | exact reversal target |
| `.changeset/relay-group-error-surface.md` plus new Phase 22 changeset | config/documentation | release metadata | EVENT relayer changeset | exact format/role |

## Pattern Assignments

### `packages/relay/src/relay.ts` — raw `req()` (service, streaming)

**Primary analog:** `packages/relay/src/relay.ts:1283-1317` (`eventExchange`)

Copy the raw/high boundary: readiness surrounds a fresh `defer`; listener registration and the write live in the same attempt; policy is absent.

```ts
return this.waitForReady(
  defer(() => {
    const messages = this.socket.pipe(
      filter((m) => m[0] === "OK" && m[1] === event.id),
      map((m): PublishResponse => ({ ok: m[2], message: m[3], from: this.url })),
      take(1),
      share(),
    );
    const control = defer(() => {
      this.socket.next([verb, event]);
      return messages;
    });
    return merge(this.watchTower, control).pipe(takeUntil(messages.pipe(ignoreElements(), endWith(true))));
  }),
);
```

**Extraction source:** current `req()` at `packages/relay/src/relay.ts:990-1143`.

- Keep filter normalization and completion at 993-1007.
- Keep per-attempt socket matching and message mapping at 1034-1083.
- Keep listener-before-write, synthetic OPEN, tracking, and exact CLOSE cleanup at 1085-1114.
- Keep `waitForReady` at 1131 and the single public `share()` pattern at 1142.
- Move the call-scoped auth gate, auth retry, reconnect retry, and clean-CLOSED repeat out of raw `req()` (1015-1024 and 1133-1140).
- Raw CLOSED handling should retain `relayClosedSub = true` before inclusive termination, but emit ordinary CLOSED and throw typed/auth errors directly.

**Error/teardown analog:** current `req()` at lines 1057-1079 and 1100-1106.

```ts
if (m.type === "CLOSED") {
  relayClosedSub = true;
  const error = parseClosedError(m.reason);
  if (error) throw error;
}
return m;
// ...
finalize(() => {
  if (!relayClosedSub) this.socket.next(["CLOSE", id]);
  const { [id]: _, ...rest } = this.reqs$.value;
  this.reqs$.next(rest);
})
```

### `packages/relay/src/relay.ts` — private lifecycle compositor (service, event-driven)

**Primary analog:** `count()` at `packages/relay/src/relay.ts:1146-1280`; **secondary analog:** `publish()` at 1712-1738.

Use one call-scoped ID, `AuthPhaseGate`, auth counter, and clean-CLOSED holder outside a fresh attempt factory. The fresh factory must be the value passed through auth/reconnect/repeat so a synchronous auth handler cannot rejoin a dying listener.

```ts
const gate = new AuthPhaseGate();
const authCounter = { consecutive: 0 };
const attempt = defer(() =>
  this.event(event).pipe(
    catchError((error) =>
      error instanceof AuthRequiredError ? of(authRequiredSignal(error.reason)) : throwError(() => error),
    ),
  ),
);

return attempt.pipe(
  this.authRetryOperator(describeRequest, opts, gate, () => true, authCounter),
  this.customRetryOperator(opts?.retries ?? opts?.reconnect ?? true, this.publishRetry),
);
```

Use the explicit transport allowlist from `relay.ts:204-218` and `customRetryOperator` at 1577-1597, not `customConnectionRetryOperator` (1599-1619), whose negative exclusion is too broad.

```ts
function isReconnectableTransportError(error: unknown): error is CloseEvent {
  return typeof error === "object" && error !== null &&
    "wasClean" in error && error.wasClean === false &&
    "code" in error && typeof error.code === "number";
}
```

Keep `authRetryOperator`'s adapter and terminal error constructors from `relay.ts:927-957`. Keep request's whole lifetime outside every attempt loop, following `count()` at 1262-1279; subscription gets no lifetime operator.

### `packages/relay/src/relay.ts` — public `request()` and `subscription()`

**Analog:** current public-edge mapping at `relay.ts:1666-1709`.

Both methods should call the private lifecycle compositor, not raw `req()` with leaked options. Preserve lifecycle messages through policy/completion, then map only at the public edge.

```ts
return lifecycle.pipe(
  opts?.complete ? completeWhen(opts.complete) : identity,
  suspendableTimeout(opts?.timeout ?? 30_000, gate, { firstWhen: isReqProgress }),
  takeWhile((message) => message.type !== "EOSE"),
  filter((message) => message.type === "EVENT"),
  map((message) => message.event),
  share(),
);
```

For subscription, reuse the filter/map at 1672-1677 so OPEN remains private and every attempt's EOSE becomes public `"EOSE"`. Do not use `takeWhile` on EOSE and do not add a clock.

### `packages/relay/src/relay.ts` — sync RECEIVE

**Analog:** `relay.ts:1753-1762` for one extracted auth option object and `1801-1819` for RECEIVE storage/forwarding.

Replace the raw `this.req(..., authOptions)` call at line 1805 with finite high-level/private composition. Retain `mapEventsToStore` and `tap(observer.next)` at 1812-1818. This is the exact seam whose auth behavior Phase 13 established; do not simply delete the now-invalid raw options.

### `packages/relay/src/types.ts` (model/config, transform)

**Analog:** independent positive declarations `PublishOptions`/`RelayCountOptions` at `types.ts:120-166`.

Declare each public surface positively. Do not derive request/subscription from raw REQ and do not use broad `Omit`.

```ts
export type RelayReqOptions = { id?: string };

export type RelayRequestOptions = RelayAuthOptions & {
  id?: string;
  reconnect?: boolean | number | Parameters<typeof retry>[0];
  resubscribe?: boolean | number | Parameters<typeof repeat>[0];
  timeout?: number;
  complete?: RelayRequestCompleteOperator;
};
```

Mirror that shape for `RelaySubscriptionOptions` without `timeout`/`complete`. `GroupReqOptions` remains raw ID-only; `GroupRequestOptions` adds `eventStore`/group completion; `GroupSubscriptionOptions` adds only `eventStore`. Remove the Phase 21 timeout lines at 257-263.

### `packages/relay/src/group.ts` (service, streaming/event-driven)

**Primary analog:** `settledSubscription()` at `group.ts:218-324`.

Keep the URL-normalized latest-cohort state machine, its single `finish` function, failure-before-completion precedence, and `defer(() => project(relay))` at line 291. Feed it the private lifecycle compositor so it continues seeing OPEN/EOSE/CLOSED; do not reconstruct boundaries from `Relay.subscription()`.

```ts
const relaySubscription = defer(() => project(relay)).subscribe({
  next: (message) => {
    if (message.type === "EVENT") states.set(url, { status: "live" });
    else if (message.type === "EOSE")
      states.set(url, { status: mode === "request" ? "eose" : "live" });
    subscriber.next(message);
    decide();
    if (!settled) messages.next(message);
  },
  error: (error) => { /* record failure, decide, then publish ERROR */ },
});
```

Keep one dedupe store constructed at the outer public call, as currently done at `group.ts:432-435` and 457-460. This placement is above re-established relay attempts and therefore preserves dedupe across them. Remove the subscription gate and `authSuspendableLifetime` at 441-452; request keeps its gate/lifetime behavior.

### `packages/relay/src/pool.ts` (facade, forwarding)

**Analog:** `pool.ts:171-233`.

Continue deriving arguments from Group:

```ts
subscription(
  relays: PoolRelayInput,
  filters: Parameters<RelayGroup["subscription"]>[0],
  options?: Parameters<RelayGroup["subscription"]>[1],
): Observable<NostrEvent> {
  return this.group(relays).subscription(filters, options);
}
```

Use the same derived option for `subscriptionMap()` and `outboxSubscription()`. No handwritten duplicate option type is needed; removing timeout from Group automatically removes it from all Pool paths.

## Test Pattern Assignments

### Raw wire/lifecycle tests — `packages/relay/src/__tests__/relay.test.ts`

Copy the real-wire style at lines 97-265: explicitly await REQ/CLOSE frames and inspect public values. Expand it with exact counts for one write/listener, concurrent sharing, local unsubscribe/filter completion/error CLOSE, no CLOSE after relay CLOSED, EOSE non-terminal, ordinary CLOSED inclusive, and raw auth/reconnect/repeat rejection.

The existing assertions at 103-121 and 124-136 are the direct EOSE/CLOSE analogs. The concurrent sharing proof is at 249-265.

### Phase 13 mutation regressions — `packages/relay/src/__tests__/relay.test.ts`

Preserve the non-vacuity structure at lines 1888-1958:

- exact `authRetries + 1` REQ frames and one handler call (`1888-1925`);
- synchronous handler plus second frame **and observed reply** (`1928-1955`);
- wait beyond reconnect delay before asserting no extra frame (`1916-1924`).

Relocate these assertions to high-level `request()`/`subscription()` as policy moves. Record four deliberate RED symptoms in the plan summary: hoisted attempt loses reply observation; attempt-scoped clean-repeat holder suppresses next REQ; OPEN-as-progress exceeds auth bound; Group ERROR-as-progress breaks timeout evidence.

### High-level request/subscription loops — `relay.test.ts`

Use request tests at 1252-1352 and subscription tests at 1355-1435 as scaffolding, but strengthen from “supports retry” to stable-ID and exact frame/listener/CLOSE counts. Assert request finishes on first EOSE, subscription hides OPEN but emits EOSE after every auth/reconnect/clean-CLOSED attempt, and terminal errors remain single-attempt.

### Group/Pool settlement and dedupe

Use `group-error.test.ts:19-228` for total-failure, mixed-success, dynamic replacement, and error precedence. Keep request whole-timeout/activity/auth suspension tests at 230-297, but replace the subscription lifetime runtime test at 251-269 with “no clock” persistence and immediate all-failed settlement.

Use `group.test.ts:557-599` as the exact manufactured-ERROR-not-progress mutation oracle. Add duplicate EVENT delivery before and after re-establishment and assert one output with default store, two with `eventStore: null`. Mirror forwarding coverage in `pool.test.ts` for `subscription`, `subscriptionMap`, and `outboxSubscription`.

### Compile-time option surface — `packages/relay/type-tests/group-error-types.ts`

Use the existing `@ts-expect-error` fixture style at lines 19-24. Reverse lines 12-17 so all Relay/Group/Pool subscription paths reject `timeout`, and add raw `req()` rejection for auth/reconnect/resubscribe while request/subscription positive options compile.

```ts
// @ts-expect-error raw req has no reconnect policy
relay.req({}, { reconnect: true });
// @ts-expect-error subscriptions have caller-composed lifetimes
pool.subscription([], {}, { timeout: 100 });
```

## Documentation, Provenance, and Release Patterns

### Existing docs only

Update `apps/docs/loading/relays/pool.md:96-143` and `apps/docs/migration/v5-v6.md:111-149`; do not create a standalone best-practices file. Correct Pool raw REQ examples to use structured `message.type`, state that raw `req()` has no policy, and state that persistent Relay/Group/Pool subscriptions have no duration or inactivity option.

Follow the repository's focused example pattern (under about 20 lines):

```ts
import { takeUntil, timer } from "rxjs";

pool.subscription(relays, filters).pipe(
  takeUntil(timer(60_000)),
);
```

Keep request's 30-second whole-operation/auth-suspended timeout statement. Place caller-owned lifetime guidance in the existing Subscription section and a focused Best Practices subsection; link rather than duplicate between Pool and migration docs.

### Phase 21 reversal

Amend the exact stale claims rather than deleting Phase 21 provenance wholesale:

- `.planning/ROADMAP.md:197-217`, especially criteria 2, 4, 5 and plan 21-02 description;
- `.planning/REQUIREMENTS.md:64-68`, limiting GROUP-04/05 to finite request while preserving immediate subscription total-failure;
- `21-CONTEXT.md` D-06/D-08/D-09/D-12/D-17/D-22;
- `21-02-PLAN.md`, `21-02-SUMMARY.md`, `21-03-PLAN.md`, `21-03-SUMMARY.md`, `21-04-*`, and `21-VERIFICATION.md` wherever numeric subscription timeout or its auth gate is claimed.

Retain Phase 21's aggregate-error/latest-cohort guarantees and request lifetime; only the subscription-timeout amendment is superseded.

### Changesets

Revise `.changeset/relay-group-error-surface.md:5` so it no longer claims subscription timeouts. Use `.changeset/relay-event-publish-layering.md` as the exact one-change, one-sentence major-release analog for the new Phase 22 changeset:

```md
---
"applesauce-relay": major
---

Make req a one-interaction raw REQ primitive and move authentication, reconnect, and repeat policy to request and subscription.
```

## Shared Patterns

### Authentication and retry budgets

**Source:** `relay.ts:927-957`, `1146-1167`, `1712-1736`  
**Apply to:** private lifecycle compositor, Relay request/subscription, Group request.  
Create gate/counter once per returned operation; never inside `defer`. Convert only `AuthRequiredError` into the auth signal. Let handler/timeout/exhaustion/programming errors escape.

### Fresh attempt invariant

**Source:** `relay.ts:1026-1132`, `1169-1262`, `1283-1317`  
**Apply to:** every raw resend/reconnect/repeat.  
The listener, relay-closed flag, write, and cleanup belong to one unshared `defer`; sharing belongs around the complete returned operation.

### Positive terminal classification

**Source:** `relay.ts:204-218`, `1577-1597`  
**Apply to:** request/subscription reconnect.  
Retry only `CloseEvent`-shaped `wasClean === false` failures. Ordinary CLOSED may repeat; typed CLOSED/auth/timeout/arbitrary errors do neither.

### Lifecycle metadata before mapping

**Source:** `group.ts:218-324`, `relay.ts:1693-1708`  
**Apply to:** Relay and Group high-level members.  
Run auth/reconnect/repeat, completion, and settlement over `RelayReqMessage`; remove OPEN and map EVENT/EOSE only at the public edge.

### Group deduplication

**Source:** `group.ts:432-435`, `457-460`  
**Apply to:** Group/Pool request and subscription.  
Construct one `EventMemory` per public call outside re-establishment. Preserve `eventStore: null` as the explicit opt-out.

## No Analog Found

None. The private REQ lifecycle compositor is new as a named unit, but its required mechanics all have direct in-package analogs in `eventExchange()`, `count()`, `publish()`, and `settledSubscription()`.

## Metadata

**Analog search scope:** `packages/relay/src`, `packages/relay/type-tests`, `apps/docs`, `.planning/phases/21-*`, historical Phase 13 artifacts, Roadmap/Requirements, pending relay changesets  
**Strong analogs used:** 5 implementation sources plus focused test/documentation artifacts  
**Pattern extraction date:** 2026-09-01

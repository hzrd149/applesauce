# Phase 13: Operation-Scoped NIP-42 Auth Hooks - Pattern Map

**Mapped:** 2026-08-05
**Files analyzed:** 8 (modified: 5, new: 1, test files touched: 3, changesets: 2)
**Analogs found:** 8 / 8

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---|---|---|---|---|
| `packages/relay/src/operators/auth-retry.ts` (NEW, name at Claude's discretion) | utility (RxJS operator) | event-driven (value-signal retry) | `packages/relay/src/operators/complete-when.ts` | role-match (shape/JSDoc/export convention); logic closer to `customConnectionRetryOperator` below |
| `packages/relay/src/relay.ts` (`req`, `count`, `event`, `negentropy`, retry operators, error classes) | service (protocol client) | request-response + streaming | itself (self-modification) — sibling method `event()` (:970-995) is the analog for the other 3 sites | exact (event's value-signal is the target model) |
| `packages/relay/src/types.ts` (`RelayAuthOptions`, `RelayCountOptions`, `RelayEventOptions`, `RelaySyncOptions`) | model (type definitions) | CRUD (option composition) | `PublishOptions` / `RelayReqOptions` (:60-99) | exact (mixin-intersection pattern already established) |
| `packages/relay/src/group.ts` (`errorToPublishResponse`, `sync`, `count`/`event` opts derivation) | service (fan-out orchestrator) | request-response, pub-sub | `RelayGroup.count`/`RelayGroup.event` (:204-206, :285-289) for the `Parameters<>` derivation pattern; `internalPublish`/`errorToPublishResponse` (:56-59, :164-196) for per-relay isolation | exact |
| `packages/relay/src/pool.ts` (`sync` opts derivation) | service (fan-out orchestrator) | request-response | `pool.ts` `count`/`event`/`publish` pass-through (already `Parameters<>`-derived) | exact |
| `packages/relay/src/negentropy.ts` (`NegentropySyncOptions`, `NegentropyError`) | model + service | request-response (edge translation) | `NegentropyError` class itself, `RelayClosedError`/`AuthRequiredError` (relay.ts :105-118) | exact |
| `packages/loaders/src/loaders/sync-loader.ts` (`SyncAuthContext`, `SyncMethodOptions`, `methodOptions` threading, `withTimeout`, fallback `catchError`) | service (loader) | batch + event-driven | itself — existing `SyncAuthRequirement`/`SyncLoaderRelay` structural-mirror types (:34, :89) | exact |
| `packages/relay/src/__tests__/relay.test.ts` (new `describe` blocks) | test | request-response (wire-trace) | existing `waitForAuth`/auth-required tests in same file (:301-341) | exact |
| `packages/relay/src/__tests__/pool.test.ts`, `group.test.ts` (new pass-through assertions) | test | request-response | existing pass-through option tests in same files | exact |
| `packages/loaders/src/loaders/__tests__/sync-loader.test.ts` (new threading assertions) | test | event-driven (mocked-function assertions) | existing `toHaveBeenCalledWith` tests at `:125`, `:142`, `:158` | exact |
| `.changeset/*.md` (2 new files: applesauce-relay, applesauce-loaders) | config | file-I/O | `.changeset/lock-app-data-clears-plaintext.md` | exact |

## Pattern Assignments

### `packages/relay/src/operators/auth-retry.ts` (NEW — shared D-04 operator)

**Analog:** `packages/relay/src/operators/complete-when.ts` (file shape/export/JSDoc convention) + `packages/relay/src/operators/only-events.ts` (minimal single-purpose operator style) + `Relay.customConnectionRetryOperator`/`customTimeoutOperator` in `relay.ts` (the actual retry/timeout logic to adapt)

**File shape and export convention** (full file, `complete-when.ts`):
```typescript
import { connect, filter, MonoTypeOperatorFunction, OperatorFunction, take, takeUntil } from "rxjs";

/**
 * Complete an observable when an operator emits a value
 * @param operator - The operator to apply to the source observable
 * @param check - A method used to check value for completion, defaults to truthy
 */
export function completeWhen<T, U>(
  operator: OperatorFunction<T, U>,
  check: ((v: U) => boolean) | null = (v) => !!v,
): MonoTypeOperatorFunction<T> {
  return connect((shared$) => {
    const complete$ = check ? shared$.pipe(operator, filter(check), take(1)) : shared$.pipe(operator, take(1));
    return shared$.pipe(takeUntil(complete$));
  });
}
```

**Minimal single-purpose operator convention** (`only-events.ts`, full file):
```typescript
import { filter, OperatorFunction } from "rxjs";
import { NostrEvent } from "applesauce-core/helpers/event";
import { RelaySubscriptionResponse } from "../types.js";

/** Filter subscription responses and only return the events */
export function onlyEvents(): OperatorFunction<RelaySubscriptionResponse, NostrEvent> {
  return (source) => source.pipe(filter((r) => r !== "EOSE"));
}
```

**IMPORTANT — barrel-export note:** `packages/relay/src/operators/index.ts` currently exports only 5 of the 6 files in the directory:
```typescript
export * from "./complete-on-eose.js";
export * from "./liveness.js";
export * from "./only-events.js";
export * from "./reverse-switch-map.js";
export * from "./store-events.js";
```
`complete-when.ts` is present in the directory but is **NOT** barrel-exported (it's imported directly by `group.ts` via a relative path). This is a real, pre-existing convention split: purely-internal operators skip the barrel; public/reusable ones are barrel-exported. The planner must decide which bucket the new auth operator falls in and match accordingly — if it's `Relay`-internal only, follow `complete-when.ts` and do not add it to `index.ts`.

**Retry/skip logic to adapt** (`relay.ts:1116-1147`, both operators — the auth operator's retry-skip and timeout-suspend logic should mirror this shape):
```typescript
/** Internal operator for creating a retry() operator */
protected customRetryOperator<T extends unknown = unknown>(
  times: undefined | boolean | number | RetryConfig,
  base?: RetryConfig,
): MonoTypeOperatorFunction<T> {
  if (times === false || times === undefined) return identity;
  else if (typeof times === "number") return retry({ ...base, count: times });
  else if (times === true) return base ? retry(base) : retry();
  else return retry({ ...base, ...times });
}

/** Internal operator for retrying connection failures without retrying relay CLOSED errors */
protected customConnectionRetryOperator<T extends unknown = unknown>(
  times: undefined | boolean | number | RetryConfig,
  base?: RetryConfig,
): MonoTypeOperatorFunction<T> {
  if (times === false || times === undefined) return identity;
  const config: RetryConfig =
    typeof times === "number" ? { ...base, count: times } : times === true ? (base ?? {}) : { ...base, ...times };
  return retry({
    ...config,
    delay: (error, count) => {
      if (error instanceof RelayClosedError) return throwError(() => error);
      if (typeof config.delay === "number") return timer(config.delay);
      if (typeof config.delay === "function") return config.delay(error, count);
      return of(null);
    },
  });
}
```
**Note (Pitfall 1 from RESEARCH.md):** `customRetryOperator` (used by `publish()`) has NO `RelayClosedError` skip, unlike `customConnectionRetryOperator`. Per D-07, either the new terminal auth error must never reach `customRetryOperator`'s pipe position, or `customRetryOperator` needs an equivalent skip added — this is an explicit task, not a side effect.

**Timeout pattern to reuse for `authTimeout`** (`relay.ts:1172-1183`):
```typescript
protected customTimeoutOperator<T extends unknown = unknown>(
  timeout: undefined | boolean | number,
  defaultTimeout: number,
): MonoTypeOperatorFunction<T> {
  if (timeout === false) return identity;
  else if (timeout === true) return simpleTimeout(defaultTimeout);
  else return simpleTimeout(timeout ?? defaultTimeout);
}
```
Wrap only the per-phase auth sub-observable (handler + wait), not the whole operation — this gives "one clock per auth phase" (D-13) for free since a fresh sub-observable is created on each retry cycle.

**`expand()` sketch from RESEARCH.md** (illustrative starting point, not binding — exact signal shape is Claude's discretion):
```typescript
type AuthRequiredSignal = { kind: "auth-required"; reason: string };
type OperationResult<T> = T | AuthRequiredSignal;

source$.pipe(
  expand((value) => {
    if (!isAuthRequired(value)) return EMPTY;
    return runAuthPhase(value).pipe(switchMap(() => resendSource$()));
  }),
  filter((value) => !isAuthRequired(value)),
);
```

---

### `packages/relay/src/relay.ts` — four auth sites (`req`, `count`, `event`, `negentropy`)

**Analog:** `event()` is the existing value-signal model (:970-995) that `req`/`count`/`negentropy` must be converted to match.

**Target model — `event()`'s existing value-based signal, unchanged by D-02** (`relay.ts:970-995`):
```typescript
const observable = merge(this.watchTower, messages).pipe(
  takeUntil(messages.pipe(ignoreElements(), endWith(true))),
  take(1),
  tap(({ ok, message }) => {
    if (ok === false && message?.startsWith(AUTH_REQUIRED_PREFIX) && !this.receivedAuthRequiredForEvent.value) {
      this.log("Auth required for publish");
      this.receivedAuthRequiredForEvent.next(true);
    }
  }),
  timeout({
    first: this.eventTimeout,
    with: () => of<PublishResponse>({ ok: false, from: this.url, message: "Timeout" }),
  }),
);

// skip wait for auth if verb is AUTH or waitForAuth is false — RAUTH-06 site to preserve
const waitForAuth = opts?.waitForAuth ?? true;
if (verb === "AUTH" || !waitForAuth) return this.waitForReady(observable).pipe(share());
else
  return this.waitForReady(this.waitForAuth(this.authRequiredForPublish$, observable, waitForAuth)).pipe(share());
```

**Throw-driven site to convert — `req()`** (`relay.ts:844-877`, full pipe including the pre-block at `:845-847` to REMOVE and the `retry({delay})` at `:849-869` to convert to value-driven):
```typescript
// Wait for auth only when enabled and make sure to start the watch tower
const reqWithAuthStrategy = waitForAuth
  ? this.waitForAuth(this.authRequiredForRead$, observable, waitForAuth)
  : observable;

return defer(() => this.waitForReady(reqWithAuthStrategy)).pipe(
  retry({
    delay: (error) => {
      if (!(error instanceof AuthRequiredError)) return throwError(() => error);
      this.log(`Auth required for REQ`);
      this.receivedAuthRequiredForReq.next(true);
      if (!waitForAuth) return throwError(() => error);
      return this.authSatisfied$(waitForAuth).pipe(
        filter((satisfied) => satisfied),
        take(1),
      );
    },
  }),
  this.customConnectionRetryOperator(opts?.reconnect),  // D-09: order unchanged, stays downstream
  this.customRepeatOperator(opts?.resubscribe, () => shouldResubscribe),
  share(),
);
```

**Throw-driven site to convert — `count()`** (`relay.ts:923-946`, including the catch-and-rethrow at `:929-935` that D-01 says becomes unnecessary):
```typescript
const observable = merge(this.watchTower, control).pipe(
  takeUntil(messages.pipe(ignoreElements(), endWith(true))),
  take(1),
  catchError((error) => {
    if (error instanceof AuthRequiredError && !this.receivedAuthRequiredForReq.value) {
      this.log(`Auth required for COUNT`);
      this.receivedAuthRequiredForReq.next(true);
    }
    return throwError(() => error);
  }),
  timeout({ first: 10_000, with: () => throwError(() => new Error("COUNT timeout")) }),
);

const waitForAuth = opts?.waitForAuth ?? true;
const withAuthStrategy = waitForAuth
  ? this.waitForAuth(this.authRequiredForRead$, observable, waitForAuth)
  : observable;
return this.waitForReady(withAuthStrategy).pipe(share());
```

**Edge-translation site — `negentropy()`** (`relay.ts:1027-1104`, the `NegentropyError` → typed-error translation at `:1051-1058` STAYS per D-02; the `retry({delay})` at `:1065-1082` converts to value-driven):
```typescript
const runSync = defer(() =>
  from(buildStorage().then((storage) => negentropySync(storage, this.socket, filter, reconcile, opts))),
).pipe(
  catchError((err) => {
    if (err instanceof NegentropyError) {
      const parsed = parseClosedError(err.reason);
      if (parsed) return throwError(() => parsed);
    }
    return throwError(() => err);
  }),
);

const withAuthStrategy = waitForAuth ? this.waitForAuth(this.authRequiredForRead$, runSync, waitForAuth) : runSync;

const observable = withAuthStrategy.pipe(
  retry({
    delay: (error) => {
      if (!(error instanceof AuthRequiredError)) return throwError(() => error);
      this.log(`Auth required for sync`);
      this.receivedAuthRequiredForReq.next(true);
      if (!waitForAuth) return throwError(() => error);
      return this.authSatisfied$(waitForAuth).pipe(first((satisfied) => satisfied));
    },
  }),
);
```
**Note (Pitfall 3):** `sync()` (`:1243-1324`) internally calls `this.event(event)` (`:1280`) and `this.req({ids: need})` (`:1290`) with **no opts argument today**. These must be threaded with `sync()`'s own `RelaySyncOptions` explicitly — not covered by the 999.5 draft or CONTEXT.md canonical refs.

**Error class convention to follow for `AuthHandlerError`/`AuthTimeoutError`** (`relay.ts:104-118`):
```typescript
/** Base error thrown when a relay closes a REQ or COUNT with a CLOSED message */
export class RelayClosedError extends Error {
  constructor(public readonly reason: string) {
    super(reason);
    this.name = "RelayClosedError";
  }
}

/** Thrown when the relay closes a subscription with an auth-required: prefix */
export class AuthRequiredError extends RelayClosedError {
  constructor(reason: string) {
    super(reason);
    this.name = "AuthRequiredError";
  }
}
```
Both new classes must `extends RelayClosedError` (D-17) and set `this.name = "AuthHandlerError"` / `"AuthTimeoutError"` verbatim — this exact string is what `SyncLoader`'s duck-typed check (D-06, no import allowed) will match against.

**Sibling error class in a different file, same convention** (`negentropy.ts:35-39`):
```typescript
export class NegentropyError extends Error {
  constructor(...) {
    ...
    this.name = "NegentropyError";
  }
}
```

---

### `packages/relay/src/types.ts` — `RelayAuthOptions` mixin (D-05)

**Analog — existing named option type with intersection pattern** (`types.ts:60-99`):
```typescript
export type PublishOptions = {
  retries?: boolean | number | Parameters<typeof retry>[0];
  reconnect?: boolean | number | Parameters<typeof retry>[0];
  timeout?: number | boolean;
  waitForAuth?: AuthRequirement;
};

export type RelayReqOptions = {
  id?: string;
  waitForAuth?: AuthRequirement;
  resubscribe?: boolean | number | Parameters<typeof repeat>[0];
  reconnect?: boolean | number | Parameters<typeof retry>[0];
};

export type RelayRequestOptions = RelayReqOptions & {
  timeout?: number;
  complete?: RelayRequestCompleteOperator;
};
```
`RelayAuthOptions` should follow this exact shape — a standalone type with `waitForAuth` / `onAuthRequired` / `authTimeout` / `authRetries` — and get intersected (`&`) into `RelayReqOptions`, `PublishOptions`, `NegentropySyncOptions`, and the **new** `RelayCountOptions`/`RelayEventOptions`/`RelaySyncOptions`, exactly as `RelayRequestOptions` intersects `RelayReqOptions` above.

**The 5 anonymous literals to replace** (corrected count per RESEARCH.md, not "nine"):
- `Relay.count` (`relay.ts:883`): `opts?: { waitForAuth?: AuthRequirement }`
- `Relay.event` (`relay.ts:953`): `opts?: { waitForAuth?: AuthRequirement }`
- `Relay.sync` (`relay.ts:1247`, not directly read but referenced): `opts?: { waitForAuth?: AuthRequirement }`
- `RelayGroup.sync` (`group.ts:304`): `opts?: { waitForAuth?: AuthRequirement }` — hand-declared, NOT derived
- `RelayPool.sync` (`pool.ts:258`, referenced in RESEARCH.md): `opts?: { waitForAuth?: AuthRequirement }` — hand-declared, NOT derived

**The `Parameters<>`-derivation pattern already used for the other two — copy this shape for `sync`** (`group.ts:204-206`, `:285-289`):
```typescript
event(event: NostrEvent, opts?: Parameters<Relay["event"]>[2]): Observable<PublishResponse> {
  return this.internalPublish((relay) => relay.event(event, "EVENT", opts));
}

count(
  filters: Filter | Filter[],
  id = nanoid(),
  opts?: Parameters<Relay["count"]>[2],
): Observable<Record<string, RelayCountResponse>> { ... }
```
`RelayGroup.sync`/`RelayPool.sync` currently do NOT follow this pattern (Pitfall 4) — converting them to `Parameters<Relay["sync"]>[3]`-style derivation is an explicit sub-task, matching their own sibling methods above.

---

### `packages/relay/src/group.ts` — `errorToPublishResponse`, per-relay `sync` isolation (D-18/D-19)

**Analog — existing per-relay error-to-value conversion for publish** (`group.ts:55-60`):
```typescript
/** Convert an error to a PublishResponse */
function errorToPublishResponse(relay: Relay): MonoTypeOperatorFunction<PublishResponse> {
  return catchError((err) =>
    of({ ok: false, from: relay.url, message: err?.message || "Unknown error" } satisfies PublishResponse),
  );
}
```
D-18 requires this to gain an `error` field: `of({ ok: false, from: relay.url, message: err?.message || "Unknown error", error: err } satisfies PublishResponse)`.

**Analog — existing per-relay ERROR isolation for the REQ path** (`group.ts:145-148`, inside `internalSubscription`):
```typescript
const observable: Observable<GroupReqMessage> = project(relay).pipe(
  catchError((err) => of({ type: "ERROR", from: relay.url, error: err } satisfies GroupReqErrorMessage)),
);
```
`RelayGroup.sync` (`group.ts:300-320`) has **no** equivalent today — it merges all relay `sync()` calls with a bare `merge(...)` and no `catchError` per relay, so one relay's error kills the whole `sync()` observable. D-19 requires adding a `catchError` per relay inside the `relays.map((relay) => relay.sync(...))` step, matching the shape above (adapted since `sync()` returns `Observable<NostrEvent>` with no error channel to preserve into — the dropped relay becomes debug-log-only per D-19's note).

**Current `RelayGroup.sync` to modify** (`group.ts:299-320`):
```typescript
sync(
  store: NegentropySyncStore | NostrEvent[],
  filter: Filter,
  direction?: SyncDirection,
  opts?: { waitForAuth?: AuthRequirement },
): Observable<NostrEvent> {
  return defer(async () => {
    const supported = await Promise.all(
      this.relays.map(async (relay) => [relay, await relay.getSupported()] as const),
    );
    const relays = supported.filter(([_, supported]) => supported?.includes(77)).map(([relay]) => relay);
    if (relays.length === 0) throw new Error("No relays support NIP-77 negentropy sync");
    return relays;
  }).pipe(
    switchMap((relays) => merge(...relays.map((relay) => relay.sync(store, filter, direction, opts)))),
    share(),
  );
}
```

---

### `packages/loaders/src/loaders/sync-loader.ts` — structural mirror types, threading, stall-guard wrapping

**Analog:** the file's own existing `SyncAuthRequirement`/`SyncLoaderRelay` structural mirrors (D-06 continues this exact convention).

**Single threading point to extend** (`sync-loader.ts:270`, referenced in RESEARCH.md):
```typescript
methodOptions: SyncMethodOptions = { waitForAuth }
```
passed identically to both `sync(url, filter, methodOptions)` (`:361`) and `paginatedRequest(request, url, filter, limit, log..., methodOptions)` (`:351`). `onAuthRequired`/`authTimeout`/`authRetries` join `waitForAuth` here — the single place both paths pick up the new fields (RAUTH-08).

**Structural-mirror annotation convention** (visible at `SyncAuthRequirement` `:34` and `SyncLoaderRelay` `:89` per RESEARCH.md — read the actual comments at those lines when implementing; the new `SyncAuthContext` type must carry the same "structurally matches applesauce-relay's …" comment style and expose only `url`, `authenticate`, `auth`).

**Existing mocked-function test assertion convention** (`sync-loader.test.ts:115-158`):
```typescript
it("threads waitForAuth into the negentropy sync", async () => {
  const sync = vi.fn().mockReturnValue(of(a));
  const request = vi.fn();
  const getSupported = vi.fn().mockResolvedValue([1, 77]);
  const loader = createSyncLoader({ eventStore, request, getSupported, sync });
  const { events$ } = loader({ relays: ["wss://relay/"], filter, waitForAuth: user.pubkey });
  ...
  expect(sync).toHaveBeenCalledWith("wss://relay/", filter, { waitForAuth: user.pubkey });
});

it("threads waitForAuth into the paginated request", async () => {
  ...
  expect(request).toHaveBeenCalledWith("wss://relay/", [expect.any(Object)], { waitForAuth: user.pubkey });
});
```
New tests for `onAuthRequired`/`authTimeout`/`authRetries` threading should follow this exact `toHaveBeenCalledWith(..., { waitForAuth, onAuthRequired, authTimeout, authRetries })` shape, one `it` per path (negentropy + paginated), matching RAUTH-08.

**Duck-typed error-name check to add** (no analog exists yet — new code, but must match the `this.name` convention from `relay.ts:108/116` exactly): check `error?.name` against a known set (e.g., `["AuthRequiredError", "AuthHandlerError", "AuthTimeoutError"]`) rather than `instanceof`, consistent with the rest of the file already treating errors as untyped (`error?.message ?? error`).

---

### Test files — wire-trace and pass-through conventions

**Wire-trace real-timer oracle convention** (`relay.test.ts:301-309`, the existing `waitForAuth=false` test to extend for the new operator):
```typescript
it("should throw AuthRequiredError when waitForAuth=false and relay sends auth-required CLOSED", async () => {
  const spy = subscribeSpyTo(relay.req([{ kinds: [1] }], { id: "sub1", waitForAuth: false }), { expectErrors: true });
  await server.nextMessage;
  server.send(["CLOSED", "sub1", "auth-required: need to authenticate"]);
  await spy.onError();
  expect(spy.getError()).toBeInstanceOf(AuthRequiredError);
});
```
No fake timers anywhere in this describe block (`vitest-websocket-mock` + `subscribeSpyTo`, real clock) — matches D-20 exactly. New tests asserting the REQ → `CLOSED auth-required:` → AUTH → REQ frame sequence should use `server.nextMessage` / `server.send` / `await expect(server).toReceiveMessage([...])` in this same style, with small explicit `authTimeout` values (not fake timers).

---

## Shared Patterns

### Error class hierarchy and `.name` convention
**Source:** `packages/relay/src/relay.ts:104-118`
**Apply to:** `AuthHandlerError`, `AuthTimeoutError` (both new), and any place `AuthRequiredError` is constructed at a caller boundary
```typescript
export class AuthRequiredError extends RelayClosedError {
  constructor(reason: string) {
    super(reason);
    this.name = "AuthRequiredError";
  }
}
```

### `undefined | boolean | number | Config` operator-builder shape
**Source:** `packages/relay/src/relay.ts:1116-1183` (`customRetryOperator`, `customConnectionRetryOperator`, `customRepeatOperator`, `customTimeoutOperator`)
**Apply to:** the new shared auth operator's internal handling of `authRetries`/`authTimeout`
```typescript
if (times === false || times === undefined) return identity;
else if (typeof times === "number") return retry({ ...base, count: times });
else if (times === true) return base ? retry(base) : retry();
else return retry({ ...base, ...times });
```

### `Parameters<>`-derived option types for Group/Pool pass-through
**Source:** `packages/relay/src/group.ts:204-206`, `:285-289`
**Apply to:** `RelayGroup.sync`/`RelayPool.sync` (need conversion), keeping `RelayGroup.count`/`RelayGroup.event` as the reference (already correct)
```typescript
event(event: NostrEvent, opts?: Parameters<Relay["event"]>[2]): Observable<PublishResponse> { ... }
count(filters: Filter | Filter[], id = nanoid(), opts?: Parameters<Relay["count"]>[2]): Observable<...> { ... }
```

### Per-relay error isolation (`catchError` at the fan-out boundary)
**Source:** `packages/relay/src/group.ts:56-59` (publish), `:145-148` (REQ)
**Apply to:** `RelayGroup.sync` (D-19, currently missing this)
```typescript
catchError((err) => of({ ok: false, from: relay.url, message: err?.message || "Unknown error" } satisfies PublishResponse))
```

### Changeset format
**Source:** `.changeset/lock-app-data-clears-plaintext.md`
**Apply to:** two new changesets — `applesauce-relay` (minor: new options + breaking `waitForAuth` no-longer-pre-blocks behavior) and `applesauce-loaders` (minor: pass-through)
```markdown
---
"applesauce-common": patch
---

`lockAppData` now clears the decrypted content so `getAppDataContent` returns undefined after locking.
```
Per CLAUDE.md: one change per file, single-sentence body, no bullets/code blocks. The `applesauce-relay` changeset's single sentence must surface the D-14 consequence (callers relying on indefinite out-of-band-auth waits now need `authTimeout: false`) — phrase as one sentence, e.g. "Auth-required responses on `req`/`count`/`event`/`sync` now resolve per-operation with a bounded `authTimeout` (default 30s, pass `authTimeout: false` for the old indefinite wait) instead of blocking on a relay-wide flag." Two separate files if the relay changeset would otherwise need multiple sentences to cover both the new options and the behavior change — prefer splitting into two changeset files over a multi-sentence body.

## No Analog Found

None — every file in scope has a close existing analog in the same file or a sibling file. The one genuinely new construct (the shared D-04 auth operator) has two applicable analogs (file-shape from `operators/complete-when.ts`, retry/timeout logic from `relay.ts`'s existing `custom*Operator` methods), so it is not analog-less, just synthesized from two sources.

## Metadata

**Analog search scope:** `packages/relay/src/` (relay.ts, types.ts, group.ts, pool.ts, negentropy.ts, operators/), `packages/loaders/src/loaders/sync-loader.ts`, `packages/relay/src/__tests__/`, `packages/loaders/src/loaders/__tests__/`, `.changeset/`
**Files scanned:** relay.ts, types.ts, group.ts (full read), operators/complete-when.ts, operators/only-events.ts, operators/index.ts, negentropy.ts (targeted), relay.test.ts (targeted), sync-loader.test.ts (targeted greps), one changeset file
**Pattern extraction date:** 2026-08-05

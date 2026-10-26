# RxJS in package code (`packages/*/src`)

Library code is consumed by apps you can't see. It has to be cold, safe to subscribe to more than once, and explicit about who owns teardown. The conventions below come from `core/src/observable`, `core/src/models`, `core/src/casts`, `loaders/src`, and `relay/src`.

## Contents

1. Writing operators
2. Models
3. Cast `$` getters
4. Loaders
5. Classes: subjects, derived streams, disposal
6. Relay-style lifecycles: retry, completion, fan-out
7. Promise bridges
8. Testing

## 1. Writing operators

Prefer composition. Reach for a hand-written `Observable` only when you need sync/async control:

```ts
/** Filters out undefined and null values */
export function defined<T>(): OperatorFunction<T | undefined, NonNullable<T>> {
  return (source) => source.pipe(filter((v) => v !== undefined && v !== null));
}

/** Converts a stream of events into a sorted timeline */
export function mapEventsToTimeline<T extends NostrEvent>(): OperatorFunction<T, T[]> {
  return pipe(scan((list, e) => insertEventIntoDescendingList(list, e), [] as T[]), withImmediateValueOrDefault([]));
}
```

- **Per-subscription state goes inside the `(source) => { ... }` closure**, or inside `defer`. Never put it in the factory body, where every subscriber would share it. `loaders/src/operators/distinct-timeout.ts` creates its LRU outside the closure, which is a known bug to avoid repeating.
- **Optional steps return `identity`**: `opts?.blacklist ? ignoreBlacklistedRelays(opts.blacklist) : identity`.
- **Accept a value or an observable** with `isObservable(x) ? x : of(x)` combined via `combineLatestWith`.
- **Branch one source** with `connect((shared$) => merge(a(shared$), b(shared$)))` rather than subscribing to it twice.
- **Hand-written observables** must forward `error` and `complete` and return a teardown that unsubscribes every inner subscription and clears maps. See `combine-latest-by-index.ts` and `relay-selection.ts`.
- Export new operators from the package's `observable/` or `operators/` barrel, give them a single-line JSDoc, and update the export snapshot test.

## 2. Models

A model is `(...args) => (store) => Observable`. Normalize arguments outside the inner closure, build on store primitives, and finish with `map`:

```ts
/** A model that returns the contacts of a user */
export function ContactsModel(user: string | ProfilePointer): Model<ProfilePointer[]> {
  if (typeof user === "string") user = { pubkey: user };
  return (events) =>
    events.replaceable({ kind: kinds.Contacts, pubkey: user.pubkey, relays: user.relays }).pipe(
      // listen for event updates (hidden tags unlocked)
      watchEventUpdates(events),
      map((e) => (e ? getContacts(e) : [])),
    );
}
```

- **Don't add `share` or `shareReplay` inside a model.** `EventModels.model()` already caches by `getKey?.(...args) ?? hash_sum(args)` and shares with a `ReplaySubject(1)` and a keep-warm window.
- Add a static `getKey` when the arguments contain functions or observables, because `hash_sum` can't key them (see `models/outbox.ts`).
- Use `watchEventUpdates` / `watchEventsUpdates` when the derived value depends on hidden or decrypted content.
- Return the same array instance when nothing changed, so `distinctUntilChanged()` can skip the emission. Return a new array when something did change.
- Keep mutable state per subscription. `ThreadModel` keeps maps outside the closure and only works because the store hands out one instance per key; don't copy that.
- Register store convenience methods on `EventModels.prototype`, add a `declare module` augmentation, and import the registration from `__register__.ts`.

## 3. Cast `$` getters

Cast relationships are cached, chainable observables built with `$$ref`:

```ts
get comments$() {
  return this.$$ref("comments$", (store) =>
    store.model(CommentsModel, this.event).pipe(castTimelineStream(Comment, store)),
  );
}
```

- Return `of(undefined)` when the event has no reference to follow.
- Getters that take parameters key their `$$ref` with the parameters (`"timeline$|" + hash_sum(filters)`). Methods that take arguments may return a fresh `chainable(...)` instead.
- Validate in the constructor with the helper's type guard and throw on invalid input. `castEventStream` and `castTimelineStream` rely on that throw to drop invalid events.
- Break circular cast imports with a memoized lazy import: `defer(() => import("./_circular-import.js")).pipe(share({ connector: () => new ReplaySubject(1), resetOnRefCountZero: false, resetOnComplete: false }))`.
- Expose synchronous getters only for immutable event metadata. Anything that can change is a `$` getter.

## 4. Loaders

- A loader is a function that returns a cold observable. Wrap request construction in `defer(() => upstream(input))`, so a synchronous throw becomes an observable error and a retry rebuilds the request.
- Batch through `batchLoader`: a `Subject` queue, `bufferTime(...)`, and a reference-counted `share()`, so its timers only run while something subscribes. Consumers subscribe first and then `queue.next(input)`.
- For staged fallbacks (cache → hints → lookup relays), use generator utilities (`wrapGeneratorFunction`). Each stage gets `catchError(() => EMPTY)` and an optional `withStageTimeout`.
- For relay fan-out, use `merge(...relays.map(r => request(r).pipe(catchError(() => EMPTY))))`, so one relay can't cancel the others.
- Deduplicate and store with `filterDuplicateEvents(store)` / `mapEventsToStore(store)`. Upstream requests must complete on EOSE.
- Expose progress as `status$` from a private `BehaviorSubject` (`.asObservable()`).
- Give loaders explicit teardown: `stop()`, `[Symbol.dispose]`, and an `AbortSignal` option. Upstream work that outlives a single consumer is cut with `takeUntil(destroy$)` and cleaned up in `finalize`.

## 5. Classes: subjects, derived streams, disposal

```ts
class Thing {
  #status = new BehaviorSubject<Status>("idle");
  /** The current status of the thing */
  readonly status$ = this.#status.asObservable();
  get status() { return this.#status.value; }

  #destroy$ = new ReplaySubject<void>(1);
  dispose() { this.#destroy$.next(); this.#destroy$.complete(); }
}
```

- New code keeps subjects private and exposes `.asObservable()`, plus a sync getter for a `BehaviorSubject`. Existing public subjects such as `Relay.connected$` and `EventStore.insert$` are legacy API. Leave them as they are and don't add more.
- Assign derived streams once, in the constructor or a field initializer, as `readonly x$ = ...pipe(..., shareReplay(1))`. A getter that rebuilds a stream on every access breaks identity, which matters to `use$` deps and to caching.
- Make `destroy$` a `ReplaySubject<void>(1)`, so a stream subscribed after disposal completes immediately via `takeUntil(this.#destroy$)`.
- Library code subscribes only in hand-written observable bodies, in long-lived internal listeners held in a `Subscription` that `dispose()` unsubscribes, or in listener APIs that return the `Subscription` to the caller. Everything else returns cold observables.

## 6. Relay-style lifecycles: retry, completion, fan-out

- **Normalize retry options**: `false` / `undefined` gives `identity`, `true` gives the defaults, a number sets the count, and an object is merged. Retry only errors classified as retryable: `retry({ count, delay: (err) => (retryable(err) ? timer(ms) : throwError(() => err)) })`.
- **Completion conditions are composable observables of booleans.** Use `combineLatest(conditions.map((c) => source.pipe(c, startWith(false)))).pipe(map((v) => v.some(Boolean)))`.
- **Group fan-out** uses `relays$.pipe(reverseSwitchMap(...))` when a gap between old and new subscriptions would lose events. Wrap each relay in `catchError` → an `ERROR` value, and end with `share()` because completion checks subscribe more than once.
- **Placement of `share()` matters with retry.** Per-attempt singletons are shared *inside* the `defer`, and the public stream is shared *outside* the retry boundary (see the comments in `relay.ts` `req()`).
- **Bound everything**: request timeouts (`authSuspendableLifetime`, `simpleTimeout`), and ping health checks that fall back to `NEVER` instead of erroring the connection.

## 7. Promise bridges

- Observable → Promise:
  - `firstValueFrom` means "the current or next value".
  - `lastValueFrom` means "run to completion".
  - Bound both with `timeout({ first, with: () => of(fallback) })`.
  - Inside actions, use the cast helper: `await user.outboxes$.$first(1_000, undefined)`.
- Promise → Observable:
  - `defer(() => promiseFn())`, so work starts on subscribe and restarts on retry.
  - `from(promise)` only for a promise that already exists.
  - `r instanceof Promise ? from(r) : of(r)` for code that must support both sync and async stores.
- Cancellation: `takeUntil(fromEvent(signal, "abort"))`. Check `signal.aborted` first, because an already-aborted signal never fires the event.
- `getObservableValue` is deprecated. Use `firstValueFrom`.

## 8. Testing

- Use `subscribeSpyTo` from `@hirez_io/observer-spy` for most stream tests. Assert on `getValues()`, `receivedComplete()`, and `receivedError()`.
- Use fake timers (`vi.useFakeTimers()`) for `bufferTime`, `auditTime`, and `timeout`, rather than real waits.
- Test the empty input, a second subscriber, an unsubscribe in the middle of a stream, and an upstream error for every new operator or loader.

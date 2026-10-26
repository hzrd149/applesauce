---
name: rxjs-patterns
description: House style for writing simple, consistent, reactive RxJS in the applesauce monorepo — stream functions, operator choice, use$, sharing, teardown, status/error streams, and relay-set composition. Use whenever writing, refactoring, or reviewing code in this repo that imports from "rxjs", builds or pipes Observables or Subjects, calls use$, or writes models, casts, loaders, operators, or examples in apps/examples — even for small edits like adding one operator to a pipe, fixing a subscription leak, or replacing a useEffect.
---

# RxJS in applesauce

Applesauce is reactive end to end: the `EventStore` emits, models derive, casts chain relationships, loaders fill the store, and React subscribes with `use$`. Good code here reads as a single pipeline from source to consumer, with each step being an operator. Bad code coordinates the same data through variables, React state, effects, and manual subscriptions.

This skill covers the conventions that apply everywhere. Read the reference that matches your task:

- **React components and `apps/examples`** → `references/react.md` (`use$`, `$` stream functions, per-item lists, relay sets, status streams, account subjects). Also follow `apps/examples/AGENTS.md`, which owns the non-RxJS example rules.
- **Package code in `packages/*/src`** → `references/library.md` (custom operators, models, casts, loaders, class subjects, share strategies, teardown).
- **Reviewing or cleaning up existing code** → `references/rewrites.md` (anti-pattern → fix pairs found in this repo).

## Core principles

1. **Return cold observables; subscribing does the work.** A function that returns an observable must not start requests, timers, or mutate anything until subscribed. Put per-subscription state (accumulators, `Set`s, start times, resources) inside `defer(() => ...)` or an operator's `(source) => { ... }` closure, so each subscriber and each retry starts fresh. State created at module or function scope leaks between subscribers.

2. **One pipeline instead of coordination.** Derive values with operators from their source. Don't copy emissions into variables or React state and recompute elsewhere, and don't nest `.subscribe()` calls. If you write `.subscribe()` outside a hand-written `Observable` body or a long-lived owner, check whether an operator does the job.

3. **Load into the store, render from the store.** Network results go into the `EventStore` (`mapEventsToStore(eventStore)` or the `{ eventStore }` request option). The UI then reads `eventStore.timeline(...)`, models, or casts. When one stream has to do both, use `merge(load$.pipe(ignoreElements()), view$)`.

4. **Pick the flattening operator by intent.**
   - `switchMap`: a changing input replaces the old work (relays, pubkeys, filters). This is the default.
   - `mergeMap(fn, n)`: parallel fan-out. Give it a concurrency limit when the input is unbounded.
   - `concatMap`: ordered async steps, or async work the stream's completion must wait for.
   - `exhaustMap`: ignore new triggers while busy (drain, submit).

5. **Isolate failures and keep them visible.** Put `catchError` per relay or per item so one failure doesn't end its siblings: `catchError(() => EMPTY)` when the item is optional, or map the error to a value when the UI should show it. Never turn every error into an empty result. "Failed" and "found nothing" are different states.

6. **Bound every wait.** Waiting on data that may never arrive uses `timeout({ first: ms, with: () => of(fallback) })`. In async code use `firstValueFrom` with a timeout, or a cast's `$first(ms, fallback)`. Keep give-up timeouts generous (5–10 s for relay lists), because relay lists often arrive after the content that needs them.

7. **Share on purpose.** Leave a stream unshared when only one consumer subscribes. When several do, pick a strategy from the table below. Don't add `shareReplay` "just in case": it hides cold/hot bugs and, without `refCount`, keeps subscriptions alive forever.

8. **Teardown lives in the stream.** Release resources with `finalize`, a `new Observable` teardown, or `takeUntil(destroy$)`, so unsubscribing, or a `switchMap` replacing the stream, cleans up automatically. Shared infrastructure (stores, pools, loaders) is disposed by its owner, never by one of its consumers.

9. **Comment the steps that aren't obvious.** Put a one-line `//` comment above any operator whose purpose isn't clear from its name: why it waits, why it throttles, why it falls back. That is the house style in both packages and examples.

## Operator choice

| Need | Use | Avoid |
|---|---|---|
| Drop `undefined`/`null` | `defined()` from `applesauce-core` | `filter(x => !!x)` without a type guard |
| Changing input replaces work | `switchMap` | `mergeMap` (stale results race in) |
| Combine latest values of N streams | `combineLatest([...])` / `combineLatest({ a, b })` | Chaining `use$` results only to feed another `use$` |
| List of per-item streams | `combineLatest(items.map(item$))`, with `of([])` when empty | `combineLatest([])`, which never emits |
| Keyed list that changes often | `combineLatestByValue` / `ByIndex` / `ByKey` from `applesauce-core` | `switchMap(list => combineLatest(...))` rebuilding every branch |
| Batch re-renders | `auditTime(100)` (or 250 for heavy views) after the store | Throttling raw relay events before they are stored |
| Expensive recompute on a noisy input | `throttleTime(ms, undefined, { leading: true, trailing: true })` or `debounceTime` | `auditTime` when the first value matters |
| Skip identical arrays | `distinctUntilChanged((a, b) => a.join() === b.join())` | Reference equality on freshly built arrays |
| Accumulate per subscription | `scan` (state is per subscription) | A mutable variable outside `defer` |
| Initial or loading value | `startWith(value)` | Emitting a placeholder from outside the stream |
| Final value on completion | `endWith(value)` | Tracking completion through a `tap` flag |
| Load-only stream | `ignoreElements()` | `map(() => null)` |
| Optional pipeline step | `cond ? op : identity` | Branching around two whole pipelines |
| Value-or-observable input | `isObservable(x) ? x : of(x)` | Separate code paths |
| Promise → observable (lazy) | `defer(() => promiseFn())` | `from(promiseFn())` (starts eagerly, won't retry) |
| Observable → promise | `firstValueFrom(x$.pipe(timeout(...)))`, `cast.x$.$first(ms, fallback)` | Unbounded `firstValueFrom` / `lastValueFrom` |
| Async side effect awaited by the stream | `concatMap(async (x) => ...)` | `subscribe(async ...)`, `tap(async ...)` |
| Resource bound to subscription | `defer` + `finalize`, or `new Observable(sub => { ...; return cleanup })` | `useEffect` cleanup, manual `stop()` calls |

## Sharing strategies

| Situation | Operator |
|---|---|
| One upstream, many subscribers, reset when the last one leaves (relay methods, loaders) | `share()` |
| Derived state that late subscribers need, released when unused | `shareReplay({ bufferSize: 1, refCount: true })` |
| Replayed state with a keep-warm window | `share({ connector: () => new ReplaySubject(1), resetOnRefCountZero: () => timer(ms) })` |
| Replay every value (e.g. all relays seen so far) | `share({ connector: () => new ReplaySubject() })` |
| Permanent memo on a long-lived object or module cache | `shareReplay(1)`, and only when "never released" is intended |

Models from `eventStore.model(...)` and cast `$` getters are already cached and shared by the store. Don't wrap them in `share` again.

## Naming

- A function or getter that returns an observable ends in `$`: `bookmarks$(user, list)`, `note.replies$`, `relay.connected$`. Store and relay methods are the existing exceptions (`eventStore.timeline()`, `pool.request()`); don't rename them, and don't copy their unsuffixed style for new stream functions.
- A sync mirror drops the `$`: `get connected() { return this.connected$.value }`.
- `get*()` returns a value or a Promise, never an observable.
- Subjects in classes are private, and expose a read-only view: `#status = new BehaviorSubject(...)`; `status$ = this.#status.asObservable()`.

## Applesauce operators to reach for first

Check these before writing a custom operator:

- From `applesauce-core`:
  - `defined`, `mapEventsToStore`, `mapEventsToTimeline`, `watchEventUpdates`, `watchEventsUpdates`
  - `includeMailboxes`, `filterOptimalRelays`, `ignoreBlacklistedRelays`
  - `combineLatestByValue` / `ByIndex` / `ByKey`, `simpleTimeout`, `withImmediateValueOrDefault`
- From `applesauce-common/observable`: `castEventStream`, `castTimelineStream`, `filterTimelineByMutes`
- From `applesauce-relay`: `onlyEvents`, `completeOnEose`, `storeEvents`
- From `applesauce-core/helpers`: `mergeRelaySets` (prefer it over its alias `relaySet`), `selectOptimalRelays`

Verify each name against the package's current exports before using it. The export snapshot tests (`__tests__/exports.test.ts`) are the quickest place to look.

## Before you finish

- Trace every `subscribe` and confirm something unsubscribes it.
- Trace every `switchMap` input and confirm a change tears down the old inner stream.
- Check the empty case: `combineLatest([])`, empty relay lists, no signer.
- Check the error case: does one failure end the whole stream, or does it surface as a state?
- Check repeated subscription: a second subscriber, or React's probe subscription, must not duplicate side effects or share accumulators.
- Run the package's tests (`pnpm --filter <package> test`), or `pnpm --filter applesauce-examples exec tsc -b` for examples.

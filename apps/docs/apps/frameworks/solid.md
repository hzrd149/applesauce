---
description: Use Applesauce observables in Solid 2.0 apps with the built-in from() primitive and a small use$ helper, no adapter package or providers required
---

# Solid

Solid 2.0 reads RxJS observables natively through `from()`, so Applesauce needs no Solid package. Wrap an Applesauce observable in `from()` inside `createMemo` and read it like any other signal.

This requires `solid-js@^2.0.0`. Solid 1.x uses a different API.

## Setup

Create the Applesauce instances once and import them where they are needed. There are no context providers.

```ts
// nostr.ts
export const eventStore = new EventStore();
export const pool = new RelayPool();
export const accounts = new AccountManager();
export const actions = new ActionRunner(eventStore, accounts.signer, (event, relays) =>
  pool.publish(relays ?? defaultRelays, event),
);

createEventLoaderForStore(eventStore, pool);
```

Module-level instances suit client-rendered apps. With SSR, module scope is shared between requests, so create them per request and pass them through a Solid context instead.

## The use$ Helper

Copy this helper into your app. It wraps `createMemo` and `from()`, and returns `undefined` (or the given loading value) until the observable emits:

```ts
import { createMemo, from, type Accessor } from "solid-js";
import type { Observable } from "rxjs";

export function use$<T>(factory: () => Observable<T> | undefined): Accessor<T | undefined>;
export function use$<T>(factory: () => Observable<T>, loadingValue: T): Accessor<T>;
export function use$<T>(factory: () => Observable<T> | undefined, loadingValue?: T): Accessor<T | undefined> {
  return createMemo<T | undefined>(
    () => {
      const observable = factory();
      return observable ? from(observable) : undefined;
    },
    { loadingValue },
  );
}
```

The memo subscribes when it is created, keeps the latest value, and unsubscribes when its owner is disposed. Whatever the factory reads is tracked, so there is no dependency array: when `props.pubkey` changes, the old subscription closes and a new one opens.

```tsx
function Name(props: { pubkey: string }) {
  const profile = use$(() => eventStore.profile(props.pubkey));
  return <span>{profile()?.name ?? props.pubkey.slice(0, 8)}</span>;
}
```

Pass the type to `createMemo` when writing it inline. TypeScript infers `unknown` for `createMemo(() => from(obs$))`.

### Suspending Instead

To hold rendering until the first value, leave out `loadingValue`. The read then suspends to the nearest `<Loading>` boundary:

```tsx
const profile = createMemo<ProfileContent | undefined>(() => from(eventStore.profile(props.pubkey)));

<Loading fallback={<Spinner />}>
  <h1>{profile()?.name}</h1>
</Loading>;
```

Observables that emit synchronously (`BehaviorSubject`, `eventStore.timeline()`, `accounts.active$`) never suspend. Single-event models such as `eventStore.profile()` and `eventStore.event()` emit nothing until the event exists, so they hold the boundary until it loads.

Errors from the observable propagate to the nearest `<Errored>` boundary in both modes.

## Integration

### EventStore Models

Every `EventStore` method and model returns an observable:

```ts
const note = use$(() => eventStore.event(props.id));
const notes = use$(() => eventStore.timeline({ kinds: [1], authors: [props.pubkey] }), []);
const comments = use$(() => eventStore.model(CommentsModel, props.event));
```

### Casts

[Cast](../casting/users.md) observables, including chained properties, work the same way:

```ts
const user = createMemo(() => castUser(props.pubkey, eventStore));
const displayName = use$(() => user().profile$.displayName);
```

### Accounts

```ts
const account = use$(() => accounts.active$);
const all = use$(() => accounts.accounts$, []);
```

### Loaders

When a loader is subscribed only so that it fills the `EventStore`, subscribe in an effect and render from the store. Returning the teardown from the effect unsubscribes when its inputs change or the component unmounts.

```ts
createEffect(
  () => props.relays,
  (relays) => {
    const sub = createTimelineLoader(pool, relays, { kinds: [1] }, { eventStore })(windows$).subscribe();
    return () => sub.unsubscribe();
  },
);

const notes = use$(() => eventStore.timeline({ kinds: [1] }), []);
```

### Actions

Run actions from event handlers. Use Solid's `action()` with an optimistic flag when the UI needs a pending state:

```tsx
const [following, setFollowing] = createOptimistic(false);

const follow = action(function* (pubkey: string) {
  setFollowing(true);
  yield actions.run(FollowUser, pubkey);
});

<button disabled={following()} onClick={() => follow(props.pubkey)}>
  Follow
</button>;
```

## Best Practices

**Create observables inside the factory.** The factory re-runs when its tracked inputs change. An observable created outside it stays bound to the first props.

```ts
// ✅ Re-subscribes when props.pubkey changes
const profile = use$(() => eventStore.profile(props.pubkey));

// ❌ Subscribes once to the first pubkey
const profile$ = eventStore.profile(props.pubkey);
const profile = use$(() => profile$);
```

**Transform in a downstream memo.** Keep `from()` in its own memo and derive values from it, rather than piping or iterating inside the async compute.

```ts
const notes = use$(() => eventStore.timeline(filter), []);
const replies = createMemo(() => notes().filter((note) => note.tags.some((tag) => tag[0] === "e")));
```

**Render timelines with `<For>` over a memo, not a store.** The `EventStore` reuses event objects across emissions, so `<For>` keyed by identity only renders new rows. Store proxies break event identity and the symbol caches that Applesauce helpers write to events.

**Use `isPending()` for refetch indicators.** After the first value, switching to a new observable (for example a new `props.pubkey`) keeps the previous value on screen while `isPending(() => profile())` reads true in JSX. The first load behind a `loadingValue` never reads as pending.

**Return a cleanup from effects that subscribe.** Subscriptions opened in `createEffect` or `onSettled` must return `() => sub.unsubscribe()`.

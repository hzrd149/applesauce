---
description: Use Applesauce observables in Svelte 5 apps with the built-in $store syntax and a small observe() helper, and keep Nostr events out of $state proxies
---

# Svelte

Svelte 5 subscribes to RxJS observables natively through the `$store` syntax, so Applesauce needs no Svelte package. Put an Applesauce observable in a `$derived` and read it with a `$` prefix.

The one rule to follow: **never put Nostr events in `$state`.** Svelte deep-proxies plain objects, and the proxy breaks the symbol caches that Applesauce helpers write to events. See [Events and `$state`](#events-and-state).

This requires `svelte@^5.0.0`.

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

Class instances such as `EventStore`, `AccountManager`, accounts and casts are never proxied by Svelte, so they are safe anywhere.

Module-level instances suit client-rendered apps. With SvelteKit SSR, module scope is shared between requests, so create them per request and pass them through `setContext` instead. On the server, `$store` reads only the value an observable emits synchronously.

## Components: the $store Syntax

Svelte's store contract accepts any object with a `subscribe` method, including RxJS observables. Wrap the observable in `$derived` so it is recreated when props change:

```svelte
<script lang="ts">
  let { pubkey }: { pubkey: string } = $props();

  const profile$ = $derived(eventStore.profile(pubkey));
  const notes$ = $derived(eventStore.timeline({ kinds: [1], authors: [pubkey] }));
</script>

<h1>{$profile$?.name ?? pubkey.slice(0, 8)}</h1>
{#each $notes$ as note (note.id)}
  <Note {note} />
{/each}
```

Svelte subscribes on mount, keeps the latest value, and unsubscribes on unmount. When `pubkey` changes, the old subscription closes and a new one opens. Values that the observable emits synchronously render immediately; `eventStore.profile()` emits nothing until the profile exists, so `$profile$` is `undefined` until then.

Values read through `$store` are the original objects, not proxies, so events passed to child components keep their caches and identity.

## Modules and Classes: the observe() Helper

The `$store` syntax only works at the top level of a `.svelte` component. In `.svelte.ts` modules and classes, copy this helper into your app. It returns a `{ current }` object like the ones in `svelte/reactivity`:

```ts
// observe.svelte.ts
import { createSubscriber } from "svelte/reactivity";
import type { Observable } from "rxjs";

export function observe<T>(observable: Observable<T>): { readonly current: T | undefined };
export function observe<T>(observable: Observable<T>, initial: T): { readonly current: T };
export function observe<T>(observable: Observable<T>, initial?: T): { readonly current: T | undefined } {
  let value = initial;

  const subscribe = createSubscriber((update) => {
    let synchronous = true;
    const sub = observable.subscribe((next) => {
      value = next;
      if (!synchronous) update();
    });
    synchronous = false;

    return () => sub.unsubscribe();
  });

  return {
    get current() {
      subscribe();
      return value;
    },
  };
}
```

The subscription is lazy: it opens when an effect or template first reads `current` and closes when nothing reads it anymore. The `synchronous` flag skips the update for the value an observable emits during `subscribe()`, which is already returned by the same read.

```ts
// session.svelte.ts
export const activeAccount = observe(accounts.active$);
export const allAccounts = observe(accounts.accounts$, []);
```

```svelte
<span>{activeAccount.current?.pubkey}</span>
```

Wrap the call in `$derived` when the observable depends on reactive inputs, e.g. `const profile = $derived(observe(eventStore.profile(pubkey)))`.

## Integration

### EventStore Models

Every `EventStore` method and model returns an observable:

```ts
const note$ = $derived(eventStore.event(id));
const notes$ = $derived(eventStore.timeline({ kinds: [1], authors: [pubkey] }));
const comments$ = $derived(eventStore.model(CommentsModel, event));
```

### Casts

[Cast](../casting/users.md) observables, including chained properties, work the same way:

```ts
const user = $derived(castUser(pubkey, eventStore));
const displayName$ = $derived(user.profile$.displayName);
```

Pass casts to child components as props. A cast carries its store, so a child reads relationships without importing the `EventStore`, and can cast related events with `note.store`:

```svelte
<script lang="ts">
  let { note }: { note: Note } = $props();

  const profile$ = $derived(note.author.profile$);
  const replies$ = $derived(note.replies$);
  const parent$ = $derived(note.replyingTo$.pipe(castEventStream(Note, note.store)));
</script>

<b>{$profile$?.displayName}</b> · {$replies$.length} replies
```

### Accounts

```svelte
<script lang="ts">
  const account$ = accounts.active$;
</script>

{#if $account$}<Avatar pubkey={$account$.pubkey} />{/if}
```

Observables that never change can be read with `$` directly, without `$derived`.

### Loaders

When a loader is subscribed only so that it fills the `EventStore`, subscribe in an effect and render from the store. Returning the teardown from `$effect` unsubscribes when its inputs change or the component unmounts.

```ts
$effect(() => {
  const sub = createTimelineLoader(pool, relays, { kinds: [1] }, { eventStore })(windows$).subscribe();
  return () => sub.unsubscribe();
});

const notes$ = $derived(eventStore.timeline({ kinds: [1] }));
```

### Actions

Run actions from event handlers. Track pending state with a plain `$state` boolean:

```svelte
<script lang="ts">
  let following = $state(false);

  async function follow() {
    following = true;
    await actions.run(FollowUser, pubkey);
  }
</script>

<button disabled={following} onclick={follow}>Follow</button>
```

## Events and $state

`$state` wraps plain objects and arrays in deep proxies. Nostr events are plain objects, so `$state(event)`, `$state([])` holding events, and `$state` class fields holding events all produce proxies. Applesauce caches parsed values on events as non-enumerable symbol properties, which the proxy rejects:

```ts
let note = $state(event);

getEventUID(note); // ❌ throws state_descriptors_fixed
getProfileContent(note); // ❌ throws
eventStore.add(note); // ❌ throws
castEvent(note, Note, eventStore); // ❌ throws
```

The failure is intermittent. Reading a cache that already exists on the original event works through the proxy, so code that passes with events from the `EventStore` can throw on a freshly received event or after adding a new helper call.

Proxies cause other problems even when nothing throws:

- **Identity breaks.** `note !== event`, so `array.includes(event)`, `Set` and `WeakMap` lookups silently miss.
- **Caches are lost.** Writes through the proxy are stored in the proxy, never on the event, so the `EventStore` and other components don't see them.
- **Timelines get slow.** Every property, the `tags` array and each tag become separate signals.

Use `$state.raw`, `$derived` or the `$store` syntax instead. None of them proxy:

```ts
// ✅ Keeps the original event
let selected = $state.raw<NostrEvent | undefined>();
const note$ = $derived(eventStore.event(id));

// ❌ Deep proxy
let selected = $state<NostrEvent | undefined>();
```

Assign a new value to `$state.raw` to update it; it does not track mutations.

## Best Practices

**Create observables inside `$derived`.** A plain `const` is evaluated once and stays bound to the first props.

```ts
// ✅ Re-subscribes when pubkey changes
const profile$ = $derived(eventStore.profile(pubkey));

// ❌ Subscribes once to the first pubkey
const profile$ = eventStore.profile(pubkey);
```

**Transform in a downstream `$derived`.** Derive values from the `$store` value instead of piping inside the component:

```ts
const notes$ = $derived(eventStore.timeline(filter));
const replies = $derived($notes$.filter((note) => note.tags.some((tag) => tag[0] === "e")));
```

**Key `{#each}` blocks by `event.id`.** The `EventStore` reuses event objects across emissions, so keyed blocks only render new rows.

**Don't call `$state.snapshot()` on events.** It uses `structuredClone`, which drops every symbol, including decrypted content.

**Don't use `fromStore()` with RxJS observables.** It works until the component unmounts, then throws `TypeError: stop is not a function` because it treats the RxJS `Subscription` as a cleanup function. Use the `$store` syntax or `observe()`.

**Return a cleanup from effects that subscribe.** Subscriptions opened in `$effect` must return `() => sub.unsubscribe()`.

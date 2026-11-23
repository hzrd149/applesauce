---
description: Use Applesauce observables in Vue 3 apps with a small use$ helper built on shallowRef and watch, and keep Nostr events and casts out of deep reactivity
---

# Vue

Vue 3 has no built-in observable binding, but Applesauce needs no Vue package either. Copy the small `use$` helper below. It subscribes to an Applesauce observable and exposes the latest value as a `shallowRef`.

The one rule to follow: **keep Nostr events and Applesauce classes out of deep reactivity.** `ref()` and `reactive()` wrap plain objects and class instances in deep proxies. Those proxies break event identity and make casts throw. See [Events and Reactivity](#events-and-reactivity).

This requires `vue@^3.5`.

## Setup

Create the Applesauce instances once and import them where they are needed. There are no plugins or `provide` calls.

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

Module-level instances suit client-rendered apps. With Nuxt or other SSR, module scope is shared between requests, so create them per request and pass them down with `provide`/`inject` instead. Never wrap them in `ref()` or `reactive()`.

## The use$ Helper

Copy this helper into your app:

```ts
// use$.ts
import { shallowRef, toValue, watch, type MaybeRefOrGetter, type ShallowRef } from "vue";
import type { Observable } from "rxjs";

type Source<T> = MaybeRefOrGetter<Observable<T> | undefined>;

export function use$<T>(source: Source<T>): Readonly<ShallowRef<T | undefined>>;
export function use$<T>(source: Source<T>, initial: T): Readonly<ShallowRef<T>>;
export function use$<T>(source: Source<T>, initial?: T): Readonly<ShallowRef<T | undefined>> {
  const value = shallowRef(initial);

  watch(
    () => toValue(source),
    (observable, _previous, onCleanup) => {
      value.value = initial;
      const sub = observable?.subscribe((next) => (value.value = next));
      onCleanup(() => sub?.unsubscribe());
    },
    { immediate: true },
  );

  return value;
}
```

Pass a getter that returns the observable. `watch` tracks only that getter: when `props.pubkey` changes, the old subscription closes, the value resets to `initial`, and a new subscription opens. The subscription closes when the component unmounts.

`immediate` subscribes during `setup`, so values that the observable emits synchronously are available on the first render. `eventStore.profile()` emits nothing until the profile exists, so `profile` is `undefined` until then.

```vue
<script setup lang="ts">
const props = defineProps<{ pubkey: string }>();

const profile = use$(() => eventStore.profile(props.pubkey));
const notes = use$(() => eventStore.timeline({ kinds: [1], authors: [props.pubkey] }), []);
</script>

<template>
  <h1>{{ profile?.name ?? pubkey.slice(0, 8) }}</h1>
  <Note v-for="note in notes" :key="note.id" :note="note" />
</template>
```

The value is stored in a `shallowRef`, so events stay the original objects. Child components receive them through props, which Vue never deep-proxies, so the events keep their caches and identity.

`use$` also accepts a fixed observable, a ref or a `computed` that holds one: `use$(accounts.active$)`.

## Integration

### EventStore Models

Every `EventStore` method and model returns an observable:

```ts
const note = use$(() => eventStore.event(props.id));
const notes = use$(() => eventStore.timeline({ kinds: [1], authors: [props.pubkey] }), []);
const comments = use$(() => eventStore.model(CommentsModel, props.event));
```

### Casts

[Cast](../casting/users.md) observables, including chained properties, work the same way. `computed` does not proxy the value it returns, so it is safe for casts:

```ts
const user = computed(() => castUser(props.pubkey, eventStore));
const displayName = use$(() => user.value.profile$.displayName);
```

Pass casts to child components as props. A cast carries its store, so a child reads relationships without importing the `EventStore`, and can cast related events with `note.store`:

```vue
<script setup lang="ts">
const props = defineProps<{ note: Note }>();

const profile = use$(() => props.note.author.profile$);
const replies = use$(() => props.note.replies$, []);
const parent = use$(() => props.note.replyingTo$.pipe(castEventStream(Note, props.note.store)));
</script>

<template>
  <b>{{ profile?.displayName }}</b> · {{ replies.length }} replies
</template>
```

### Accounts

```ts
const account = use$(accounts.active$);
const all = use$(accounts.accounts$, []);
```

Observables that never change can be passed directly instead of through a getter.

### Loaders

When a loader is subscribed only so that it fills the `EventStore`, subscribe in `watchEffect` and render from the store. The cleanup runs when the effect's inputs change or the component unmounts.

```ts
watchEffect((onCleanup) => {
  const sub = createTimelineLoader(pool, props.relays, { kinds: [1] }, { eventStore })(windows$).subscribe();
  onCleanup(() => sub.unsubscribe());
});

const notes = use$(() => eventStore.timeline({ kinds: [1] }), []);
```

### Actions

Run actions from event handlers. Track pending state with a plain boolean `ref`:

```vue
<script setup lang="ts">
const following = ref(false);

async function follow() {
  following.value = true;
  await actions.run(FollowUser, props.pubkey);
}
</script>

<template>
  <button :disabled="following" @click="follow">Follow</button>
</template>
```

## Events and Reactivity

`ref()`, `reactive()` and `reactive` state in stores such as Pinia wrap plain objects, arrays **and class instances** in deep proxies. Every object read through the proxy is wrapped too, including events inside arrays and values that Applesauce cached on the events.

Casts and other Applesauce classes use private fields, which a proxy cannot read:

```ts
const user = ref(castUser(pubkey, eventStore));
user.value.profile$; // ❌ throws: Cannot read private member #refs

const notes = ref(events);
castEvent(notes.value[0], Note, eventStore).replies$; // ❌ can throw
```

The second failure is intermittent. `castEvent` caches the cast on the event. If the event was already cast elsewhere, the cached cast is read back through the proxy and wrapped. The same code then works or throws depending on which component cast the event first.

Proxies cause other problems even when nothing throws:

- **Identity breaks.** `notes.value[0] !== event`, so `array.includes(event)`, `Set` and `WeakMap` lookups silently miss.
- **Cached values are proxied.** `getProfileContent(proxy)` returns a reactive copy of the cached profile, not the cached object.
- **Timelines get slow.** Every property, the `tags` array and each tag are tracked separately.

Use `shallowRef`, `computed` or `use$` instead. None of them proxy their value:

```ts
// ✅ Keeps the original event
const selected = shallowRef<NostrEvent>();
const user = computed(() => castUser(pubkey, eventStore));

// ❌ Deep proxy
const selected = ref<NostrEvent>();
```

Assign a new value to a `shallowRef` to update it; it does not track mutations. Inside `reactive()` or Pinia state, wrap events and casts in `markRaw()` before storing them. Use `toRaw()` to recover the original from a value that was already proxied.

## Best Practices

**Pass a getter to `use$`.** An observable created once in `setup` stays bound to the first props.

```ts
// ✅ Re-subscribes when props.pubkey changes
const profile = use$(() => eventStore.profile(props.pubkey));

// ❌ Subscribes once to the first pubkey
const profile = use$(eventStore.profile(props.pubkey));
```

**Transform in a downstream `computed`.** Derive values from the `use$` ref instead of piping inside the getter:

```ts
const notes = use$(() => eventStore.timeline(filter), []);
const replies = computed(() => notes.value.filter((note) => note.tags.some((tag) => tag[0] === "e")));
```

**Key `v-for` by `event.id`.** The `EventStore` reuses event objects across emissions, so keyed lists only render new rows.

**Don't use `useObservable` from `@vueuse/rxjs` for events.** It stores values in a deep `ref`, so events come back as proxies. It also subscribes to one fixed observable and never re-subscribes when props change.

**Don't clone events.** `structuredClone`, `JSON` round-trips and object spreads drop the symbol caches, including decrypted content.

**Clean up effects that subscribe.** Subscriptions opened in `watchEffect` or `onMounted` must be closed with `onCleanup` or `onUnmounted`.

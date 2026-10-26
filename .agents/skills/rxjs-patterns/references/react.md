# RxJS in React and `apps/examples`

Examples teach readers how applesauce wants reactive code written, so they should show the simplest correct pipeline. `apps/examples/AGENTS.md` owns the layout, casts, actions, and UI rules. This file covers the streams.

The best current models to imitate:

- `bookmarks/manager.tsx`: relay discovery, per-item lists, account subjects
- `outbox/photo-gallery.tsx`: sync streams, outbox selection
- `notifications/zaps.tsx`: `scan` summaries, live subscriptions, `$first` in actions
- `moderation/social-graph.tsx`: dependent streams
- `relay/remote-monitor-liveness.tsx`: `defer` + `finalize` resources
- `loader/event-counts.tsx`: a resource per setting, DOM observers as streams

Older examples contain the anti-patterns listed in `rewrites.md`, so don't copy from a sibling just because it sits in the same folder.

## Contents

1. Module layout
2. `$` stream functions
3. `use$`
4. Local state vs subjects
5. Status, loading, and errors
6. Per-item lists
7. Relay sets that grow
8. Load and render in one stream
9. Resources and DOM observers
10. Actions and async boundaries

## 1. Module layout

Infrastructure and shared subjects live at module scope, created once:

```ts
const eventStore = new EventStore({ verifyEvent });
const pool = new RelayPool();
createEventLoaderForStore(eventStore, pool, { lookupRelays: lookupRelays$, extraRelays: FALLBACK_RELAYS });

const signer$ = new BehaviorSubject<ISigner | undefined>(undefined);
const user$ = new BehaviorSubject<User | undefined>(undefined);
```

Never create stores, pools, loaders, or services inside `useMemo`, `useState`, or a hook factory. If a loader depends on props, build it inside the stream function (or `switchMap`) so it is created per subscription and torn down with it.

## 2. `$` stream functions

All loading, filtering, transformation, and relationship resolution goes into module-level functions that take casts or plain values and return an observable. Name them with a `$` suffix and give them a one-sentence JSDoc:

```ts
/** Every unique video in the creator's notes and video events in the range */
function videos$(pubkey: string, since?: number): Observable<Video[]> {
  return eventStore.timeline({ kinds: VIDEO_KINDS, authors: [pubkey], since }).pipe(
    auditTime(250),
    map((events) => dedupe(events.flatMap(getVideos))),
  );
}
```

- Compose small stream functions out of each other (`loaded$` uses `bookmarkRelays$` and `bookmark$`) rather than writing one large pipe.
- Keep pure helpers (`dedupe`, `arrange`, parsers) as plain functions, and call them from `map`.
- Cache expensive per-event parsing with `getOrComputeCachedValue(event, Symbol, fn)`, not with a `Map` inside a stream.

## 3. `use$`

`use$` owns the subscription lifetime. It has two forms:

```ts
// Stable observables: cast properties and module subjects
const profile = use$(user.profile$);
const signer = use$(signer$);

// Streams built from props or state: a factory plus every input in deps
const items = use$(() => bookmarks$(user, list, hidden), [user, list, hidden]);
```

- **Always pass deps with the factory form.** Without them, the memo key is a new function every render, so the stream resubscribes on every render.
- **Return `undefined` when there's nothing to subscribe to**: `use$(() => (pointer ? loaded$(user, pointer) : undefined), [user, pointer])`. Don't use `NEVER` or `of(placeholder)` for this.
- **Combine streams in RxJS, not in React.** If one stream's input comes from another stream, `switchMap` inside the stream function. Chaining `use$` → value → `use$` costs an extra render and an extra resubscription per hop, so reserve it for a value that is also rendered on its own.
- When a component needs several streams together, combine them with `use$(() => combineLatest({ zaps: zaps$(pk, range), answered: answered$(pk) }), [pk, range])`.
- **`use$` subscribes twice**: a synchronous probe during the first render, then the real subscription in a layout effect. Cold streams with side effects run those side effects twice, so keep them idempotent, or share them at module level.
- A `use$` whose result is never read (for example `use$(() => liveZaps$(user), [user])`, which keeps a live subscription filling the store) is acceptable. Prefer merging that load into the stream the component already renders (§8).
- Don't use `use$` as an effect for writes. `use$(() => x$.pipe(tap(save)), [])` writes from inside a render-scoped subscription. Use a module-level subscription or a persistence helper instead.

## 4. Local state vs subjects

- **`useState`** holds component-local UI state: text input, toggles, selections, a `Set` of facets, page limits, busy/error flags. When that state parameterizes a stream, pass it through the `use$` deps:

```ts
const [query, setQuery] = useState("");
const results = use$(() => (query ? search$(query) : undefined), [query]);
```

- **A module-level `BehaviorSubject`** holds state that is shared across components or that feeds a long-lived pipeline (`signer$`, `user$`, a shared `range$`, `preview$`).
- **A module-level `Subject`** carries commands and events (`more$`, `reset$`).
- **Never** `useMemo(() => new BehaviorSubject(...))` plus `use$` to hold local state, and never `useState` to mirror an observable's value.
- Debounce a typed query inside the factory, since a dep change restarts it: `use$(() => (q ? timer(250).pipe(switchMap(() => search$(q))) : undefined), [q])`.

## 5. Status, loading, and errors

An error that reaches `use$` is rethrown during render, so it hits the nearest error boundary. Catch expected failures in the stream and turn them into a value the UI can show.

Model status as values inside the stream, with a typed initial value:

```ts
type SearchState = { status: "loading" } | { status: "ready"; results: Note[] } | { status: "error"; error: string };

const search$ = (q: string): Observable<SearchState> =>
  pool.request(RELAYS, { search: q, kinds: [1] }).pipe(
    mapEventsToStore(eventStore),
    toArray(),
    map((events) => ({ status: "ready" as const, results: events.map((e) => castEvent(e, Note, eventStore)) })),
    startWith<SearchState>({ status: "loading" }),
    catchError((e) => of<SearchState>({ status: "error", error: String(e?.message ?? e) })),
  );
```

- Status for a load-only stream: `mapEventsToStore(eventStore), ignoreElements(), startWith(false), endWith(true)`.
- `startWith(undefined)` on a slow member lets a `combineLatest` emit before every member has a value.
- Per-relay status: put `catchError` inside the per-relay branch, so one relay failing doesn't end the others.
- Sync loaders already expose a `status$`. Render it directly rather than rebuilding it.

## 6. Per-item lists

Load each list item's data in its own stream, combine the streams in the parent, and pass the results to the rows as props. This applies when the parent needs the loaded data for filtering, sorting, or counts:

```ts
function bookmarks$(user: User, list: Bookmark[]) {
  if (list.length === 0) return of([]); // combineLatest([]) never emits
  // Bookmarks resolve one by one, batch the re-renders
  return combineLatest(list.map((b) => loaded$(user, b))).pipe(auditTime(100));
}
// and inside loaded$: ...pipe(switchMap(load), startWith(bookmark)) so unloaded rows still render
```

- Every per-item stream needs `startWith(item)`. Without it, the slowest item holds back the entire list.
- When the list changes often and items are keyed, `combineLatestByValue` keeps the existing branches subscribed instead of rebuilding all of them.
- When the parent doesn't need the loaded data, give each row its own component that calls `use$`. Never call `use$` in a loop or a conditional.

## 7. Relay sets that grow

Relay lists arrive late. Build the set from every source as it is discovered, wait for at least one relay, and `switchMap` into the load, so a larger set re-requests:

```ts
function discovered$(...sources: Observable<string[] | undefined>[]): Observable<string[]> {
  return combineLatest(sources.map((r$) => r$.pipe(map((r) => r ?? [])))).pipe(
    map((sets) => mergeRelaySets(...sets)),
    distinctUntilChanged((a, b) => a.join() === b.join()),
    // Wait for at least one relay so loads don't skip straight to the fallbacks
    filter((relays) => relays.length > 0),
    timeout({ first: 10_000, with: () => of([]) }),
  );
}
```

- Sources: pointer hints `of(pointer.relays)`, the author's `outboxes$`, and, for pointers with no author, the current user's `inboxes$` and `outboxes$`.
- Popular relays are a last resort through the loader's `extraRelays` (or a `FALLBACK_RELAYS` constant on timeout). Don't mix them into the hints.
- Many loaders, like `createSyncLoader`, accept `relays` as an observable. Pass the stream itself, which makes the `switchMap` unnecessary.
- For many authors, use `of(authors.map((pubkey) => ({ pubkey }))).pipe(includeMailboxes(eventStore), throttleTime(1000, undefined, { leading: true, trailing: true }), map(selectOptimalRelays...))`.

## 8. Load and render in one stream

When a component both fills the store and renders from it, merge the load into the view stream, so a single `use$` owns both:

```ts
function torrents$(user: User) {
  const load$ = user.outboxes$.pipe(
    map((o) => (o?.length ? o : FALLBACK_RELAYS)),
    switchMap((relays) => pool.subscription(relays, { kinds: [TORRENT_KIND], authors: [user.pubkey] })),
    mapEventsToStore(eventStore),
    ignoreElements(),
  );
  const view$ = eventStore.timeline({ kinds: [TORRENT_KIND], authors: [user.pubkey] }).pipe(castTimelineStream(Torrent, eventStore));
  return merge(load$, view$);
}
```

Store every event before any throttling. `auditTime` and `throttleTime` belong on the store-side timeline, not on raw relay events, because applying them to raw events drops events.

## 9. Resources and DOM observers

A resource whose lifetime should match a subscription is created inside `defer` and released in `finalize`:

```ts
return defer(() => {
  const health = new RemoteMonitorRelayLiveness(eventStore, opts);
  health.connectToPool(pool);
  return combineLatest({ online: health.online$, unhealthy: health.unhealthy$ }).pipe(
    auditTime(250),
    finalize(() => health.destroy()),
  );
});
```

To create one resource per setting, use `settings$.pipe(switchMap((s) => new Observable((sub) => { const svc = build(s); sub.next(svc); return () => svc.stop(); })))`.

DOM observers (resize, intersection, fullscreen) become small observables consumed by `use$`, with the element held in `useState` through a ref callback. Don't use `useEffect` for them:

```ts
const width$ = (el: Element) =>
  new Observable<number>((sub) => {
    const ro = new ResizeObserver(([entry]) => sub.next(entry.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  });
```

## 10. Actions and async boundaries

User-initiated writes are plain async functions with `useState` busy and error flags. They should not be observable command subjects:

```ts
const [busy, setBusy] = useState(false);
const remove = () => {
  setBusy(true);
  actions.run(UnbookmarkEvent, pointer).catch(setError).finally(() => setBusy(false));
};
```

- Inside async code, read cast streams with `$first(ms, fallback)`: `await user.outboxes$.$first(1_000, undefined)`.
- Never pass an async callback to `.subscribe()` or `.forEach()`. RxJS doesn't await it, and its errors escape. Use `concatMap` or `mergeMap` in the pipe instead.
- Signing and decryption run only from explicit user actions, never inside a stream subscribed during render.

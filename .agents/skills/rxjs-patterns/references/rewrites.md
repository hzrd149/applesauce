# Rewrites: anti-pattern → fix

These anti-patterns have been found in this repo. Each entry shows the smell and the replacement. When you touch a file that contains one of them, fix it if the fix stays within your change. Otherwise leave it and mention it.

## Mirroring an observable into React state

```ts
// ❌
const [notes, setNotes] = useState<NostrEvent[]>([]);
useEffect(() => {
  const sub = eventStore.timeline(filter).subscribe(setNotes);
  return () => sub.unsubscribe();
}, [filter]);

// ✅
const notes = use$(() => eventStore.timeline(filter), [filter]);
```

## Local state wrapped in a subject

```ts
// ❌
const query$ = useMemo(() => new BehaviorSubject(""), []);
const query = use$(query$);
const results = use$(() => query$.pipe(debounceTime(300), switchMap(search$)), [query$]);

// ✅
const [query, setQuery] = useState("");
const results = use$(() => (query ? timer(300).pipe(switchMap(() => search$(query))) : undefined), [query]);
```

A pagination `pages$ = useMemo(() => new Subject())` becomes either a `useState` limit passed as a dep, or a module-level `more$` subject when the loader lives at module scope.

## Infrastructure in hooks

```ts
// ❌
const loader = useMemo(() => createTimelineLoader(pool, relays, filter, { eventStore }), [relays.join("|"), filter]);

// ✅ one module-level loader; createTimelineLoader accepts observable relays and filters
const relay$ = new BehaviorSubject("wss://relay.damus.io/");
const loader = createTimelineLoader(pool, relay$.pipe(map((r) => [r])), { kinds: [1] }, { eventStore });
```

The relay selection then lives in `relay$`, because it feeds a pipeline that outlives any single render. A value used for one render only would stay in `useState`.

Wrapping `castUser(pubkey, eventStore)` in `useMemo` is redundant, because casts are cached. Call it directly.

## Dependent values chained through React

```ts
// ❌
const outboxes = use$(user.outboxes$);
const notes = use$(() => outboxes && notes$(outboxes), [outboxes?.join(",")]);

// ✅ the relay change replaces the request inside the stream
const notes$ = (user: User) => user.outboxes$.pipe(defined(), switchMap((relays) => load$(relays)));
const notes = use$(() => notes$(user), [user]);
```

## Storing events with `tap`

```ts
// ❌
pool.request(relays, filter).pipe(tap((e) => eventStore.add(e)));

// ✅ mapEventsToStore emits the store's canonical instance and drops duplicates and invalid events
pool.request(relays, filter).pipe(mapEventsToStore(eventStore));
```

## Throttling before storing

```ts
// ❌ drops events
pool.subscription(relays, filter).pipe(throttleTime(500), mapEventsToStore(eventStore));

// ✅ store every event, throttle the store-side view
merge(pool.subscription(relays, filter).pipe(mapEventsToStore(eventStore), ignoreElements()),
      eventStore.timeline(filter).pipe(auditTime(100)));
```

## Shared accumulator

```ts
// ❌ every subscriber (and React's probe subscription) shares `seen`
const seen = new Set<string>();
const unique$ = events$.pipe(filter((e) => !seen.has(e.id) && !!seen.add(e.id)));

// ✅
const unique$ = defer(() => {
  const seen = new Set<string>();
  return events$.pipe(filter((e) => !seen.has(e.id) && !!seen.add(e.id)));
});
// or simply: events$.pipe(distinct((e) => e.id))
```

## Async callbacks in `subscribe`

```ts
// ❌ not awaited, errors escape, no ordering
items$.subscribe(async (item) => await save(item));

// ✅
items$.pipe(concatMap((item) => save(item)));
```

## `combineLatest` with no empty guard or `startWith`

```ts
// ❌ never emits for [], and one slow item blocks the list
switchMap((items) => combineLatest(items.map((i) => i.status$)));

// ✅
switchMap((items) =>
  items.length === 0 ? of([]) : combineLatest(items.map((i) => i.status$.pipe(startWith(undefined), map((s) => ({ i, s }))))),
),
auditTime(100);
```

## Swallowing every error into an empty result

```ts
// ❌ the UI can't tell "failed" from "nothing found"
load$.pipe(catchError(() => of([])));

// ✅ per-relay isolation, failure as a state at the boundary
merge(...relays.map((r) => pool.relay(r).request(filter).pipe(catchError(() => EMPTY))))
  .pipe(toArray(), map((events) => ({ status: "ready", events })), catchError((error) => of({ status: "error", error })));
```

## Unbounded waits

```ts
// ❌ hangs forever when the user has no relay list
const relays = await firstValueFrom(user.outboxes$.pipe(defined()));

// ✅
const relays = (await user.outboxes$.$first(1_000, undefined)) ?? FALLBACK_RELAYS;
```

## `shareReplay(1)` on a per-input stream

```ts
// ❌ never released, so it keeps the relay subscription open after every consumer leaves
const feed$ = (relay: string) => pool.subscription([relay], filter).pipe(shareReplay(1));

// ✅ release when unused, or don't share a stream that has one consumer
pool.subscription([relay], filter).pipe(shareReplay({ bufferSize: 1, refCount: true }));
```

Keep `shareReplay(1)` for permanent memos on long-lived objects, such as `readonly information$` on a `Relay`.

## Saying "no stream" three different ways

`use$(() => (x ? x$(x) : NEVER), [x])` and `: of(undefined)` both become `: undefined`. `use$` already turns `undefined` into an empty value.

## Unsuffixed stream functions

`syncReports(relays)`, `userTorrents(user)`, and `load(pubkey)` become `syncReports$`, `torrents$`, and `load$`. The `$` tells readers the call is lazy and has to be subscribed.

## `relaySet` and `mergeRelaySets`

They are aliases. New code uses `mergeRelaySets`.

## Fallback relays mixed into hints

```ts
// ❌ popular relays compete with the real outboxes
map((outboxes) => mergeRelaySets(pointer.relays, outboxes, EXTRA_RELAYS));

// ✅ hints only, and the loader's extraRelays covers the last resort
map((outboxes) => mergeRelaySets(pointer.relays, outboxes));
```

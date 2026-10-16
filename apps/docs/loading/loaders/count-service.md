# Event count service

`createCountService` loads individual event metrics without downloading every related event. Subscriptions share cached results and network work; releasing the last subscription cancels queued work, running requests, and refresh timers.

## How to use it

```ts
import { createCountService } from "applesauce-loaders/loaders";

const counts = createCountService(pool, {
  relays: trustedRelays$,
  ttl: ({ age }) => (age < 3600 ? 30_000 : 300_000),
});

const note = counts.event(event);
const subscription = note.reactions$.subscribe(renderCount);
subscription.unsubscribe();
```

Pass a structural pool directly; its methods keep their receiver. Configure `relays` for NIP-45, `providers` for NIP-85, or both to try assertions before relay counts. For explicit transports, use the options form:

```ts
const counts = createCountService({
  count,
  request,
  relays: trustedRelays$,
  providers: (kind, tag) => providerLists(kind, tag),
});
```

`createCountService(request, { providers })` creates an assertion-only service from a finite event request function. NIP-45 requires a separate `count` method; an event request function does not implicitly download related events to count them. The options form also accepts `pool`, with explicit `count`/`request` methods taking precedence over pool methods.

Handles are lazy. `reactions$` and `comments$` emit `number | undefined`, with distinct numeric emissions. Zero is a successful count; undefined means no accepted value. The corresponding `reactions` and `comments` properties expose chainable state:

```ts
note.reactions.refreshing.subscribe(renderSpinner);
note.reactions.origin.subscribe(renderProvenance);
note.reactions.subscribe(({ value, fresh, failure }) => {
  // Stale successful values stay visible during refresh and after failures.
});
```

State also includes `approximate`, fetch time `observedAt` (milliseconds), and assertion creation time `assertedAt` (seconds). The assertion timestamp describes the published assertion, rather than the age of the provider's underlying dataset.

### Metric semantics

| Descriptor                            | Meaning                                                                    | COUNT mapping               |
| ------------------------------------- | -------------------------------------------------------------------------- | --------------------------- |
| `reactionCountMetric` / `reactions`   | Kind-7 reaction events                                                     | `kinds: [7], #e`            |
| `rootCommentCountMetric` / `comments` | Entire NIP-22 comment tree rooted at the target                            | `kinds: [1111], #E` or `#A` |
| `legacyReferenceCountMetric`          | Kind-1 events referencing the target, including indirect thread references | `kinds: [1], #e`            |

`comments` never silently switches to legacy note references. Use `note.metric(legacyReferenceCountMetric)` when that is the intended meaning. NIP-85 providers define their own calculation rules; selecting one explicitly accepts its interpretation of the metric.

Event IDs are the default target identity. To count a stable address rather than one revision, supply `address` alongside `id`, `kind`, and `created_at`. Reactions and legacy references currently have no built-in address COUNT mapping; custom metrics can supply one.

### Sources and fallbacks

Use `sources` for an explicit hierarchy; it overrides automatic source creation from `relays` and `providers`. Individual adapters also accept `pool` or their explicit transport method. Sources implement the same `CountSource` interface. The service tries them in order, stops at the first valid result, and never adds counts from different relays or providers. `fallbackCountSource(children, id)` composes a nested hierarchy without adding another cache or scheduler.

```ts
const assertions = nip85CountSource({
  pool,
  providers: (kind, tag) => providerLists(kind, tag),
});
const counts = createCountService({
  sources: [assertions, relayCountSource({ pool, relays: trustedRelays$ })],
});
```

COUNT tries ordered relays individually. Unsupported filters, missing assertions or tags, malformed values, timeouts, and errors advance to the next candidate. COUNT returns one total for its filters; it cannot return separate per-target totals in a single aggregate request. Amount sums and provider-specific scores need an appropriate custom metric and source.

NIP-85 batches demanded subjects by provider, relay, and assertion kind. It verifies signatures, selects the latest assertion per subject, parses the requested tag, and retries an unanswered subject once in a separate singleton request to handle relay truncation. Unsubscribing detaches a metric from its batch; the request is cancelled when its last interested metric leaves. Assertions older than `maxAge` are rejected (default 86400 seconds). `verify` overrides signature verification for controlled trusted transports; production applications should retain verification.

### Cache and scheduling options

| Option                    | Default                                         | Behavior                                                                       |
| ------------------------- | ----------------------------------------------- | ------------------------------------------------------------------------------ |
| `ttl`                     | Age-based: 1 minute through 6 hours (see below) | Receives target `age` in seconds and returns freshness milliseconds            |
| `cache`                   | —                                               | Optional Keyv-compatible persistent store                                      |
| `cacheRetention`          | 24 hours                                        | Persistent retention in milliseconds; Infinity retains without expiry          |
| `cacheTimeout`            | 1000 ms                                         | Maximum duration of each persistent cache operation                            |
| `cacheCapacity`           | 1000                                            | Maximum inactive retained result/cooldown entries; active entries are pinned   |
| `concurrency`             | 8                                               | Global active transport limit                                                  |
| `perRelay`, `perProvider` | 2 each                                          | Additional atomic resource limits                                              |
| `admissionWindow`         | 0 ms (next scheduler turn)                      | Absorbs synchronous subscription probes before dispatch                        |
| `queueCapacity`           | 256                                             | Pending transport bound; overflow retries with other failures                  |
| `resolutionTimeout`       | 15000 ms                                        | Bound for the full hierarchy, including queue time                             |
| `attemptTimeout`          | 5000 ms                                         | Bound for an individual source/relay attempt                                   |
| `minimumRefresh`          | 1000 ms                                         | Floor for finite freshness intervals                                           |
| `retryDelay`              | 10000 ms                                        | Initial failure retry interval, with bounded exponential backoff and jitter    |
| `signal`                  | —                                               | Aborts the service                                                             |
| `diagnostic`              | —                                               | Receives bounded transport activity snapshots and cache/fallback notifications |

The default freshness curve uses the target event's age, independently of metric type:

| Target age              | Freshness TTL |
| ----------------------- | ------------- |
| Under 6 hours           | 1 minute      |
| 6 hours to under 1 day  | 5 minutes     |
| 1 day to under 7 days   | 30 minutes    |
| 7 days to under 30 days | 2 hours       |
| 30 days and older       | 6 hours       |

Age is reevaluated on observation and after each resolution; the next refresh uses the current age bracket. Only observed metrics schedule refreshes. A custom `ttl` replaces this curve and still respects `minimumRefresh`. Default successful refresh intervals are at least 60 seconds; use live relay subscriptions when an application needs live updates. Persistent retention defaults to 24 hours regardless of the freshness bracket.

Future target timestamps have age zero. Invalid finite TTL values use the minimum interval; Infinity disables automatic successful refresh. Failed attempts retain a separate retry deadline across unmounts and revisits. Retained data can outlive freshness; stale revisits emit immediately when effective policy is available. A change to effective relay/provider content or priority conservatively clears affected accepted values, cancels obsolete work, and resolves again. Equivalent configuration emissions cause no refresh. Empty lists remain observed so later account/provider updates can activate loading.

`counts.invalidate(event)` clears one target; `counts.invalidate()` clears all retained values. Both clear memory immediately and return a promise that resolves after persistent invalidation; await it when storage completion matters. Observed metrics refresh immediately. `counts.stop()` cancels the whole service and makes subsequent subscriptions complete without loading. Adapter instances can be shared across services; transport capacity and value caches belong to each service.

## Integration

### Persistent counts with Keyv

Pass a Keyv instance as `cache` to reuse counts across service instances and reloads. Keyv's default store is memory; use a persistent adapter such as IndexedDB in the browser:

```ts
import Keyv from "keyv";
import { KeyvIndexedDB } from "keyv-browser";

const cache = new Keyv({
  store: new KeyvIndexedDB({ dbName: "my-client", storeName: "counts" }),
});
const counts = createCountService(pool, {
  relays: trustedRelays$,
  cache,
  ttl: () => 5 * 60_000,
  cacheRetention: 24 * 60 * 60_000,
});
```

Here counts remain fresh for five minutes and available as stale results for up to one day. Reloading preserves the original deadlines: a fresh count skips the relay request, while a stale count appears during refresh. Retention defaults to 24 hours independently of freshness; each successful fetch starts a new retention period, while cache reads preserve the original deadline. `Infinity` disables the corresponding expiry. Existing in-memory retention still follows `cacheCapacity` and may outlive persistent retention.

Use a dedicated store or namespace with an untyped Keyv instance: the cache stores successful count records and string invalidation markers. Its structural `CountCache` interface needs only asynchronous `get` and `set`; `set` accepts a relative TTL in milliseconds, with zero disabling expiry. Loaders has no runtime dependency on Keyv.

Hydration waits for the effective source policy, and only accepts compatible records. Ordered source IDs, policy identities, target identity, and metric IDs scope persisted counts. Cache reads and writes are bounded by `cacheTimeout`; storage errors fall back to normal loading and are logged. Failures and retry cooldowns remain in memory. With persistence enabled, the initial state waits for hydration or its timeout.

Invalidation changes persistent markers without clearing unrelated keys; superseded records remain until their retention expires. `await counts.invalidate()` invalidates previous sessions too. Active metrics reload immediately, and `counts.stop()` leaves persisted data intact. Writes are asynchronous, so allow storage operations to finish before closing an application that has just fetched counts. Invalidation markers have no expiry; entries configured with infinite retention require application-managed storage cleanup.

Custom sources must change their policy identity when count acceptance changes. Use stable versioned metric IDs and source IDs across sessions, and change them when semantics change.

### Common trusted provider casts

`TrustedProviderList.providersFor$(kind, tag)` preserves metric-scoped trust and hidden-provider unlock updates. Use `switchMap` to replace the list when the active account changes:

```ts
const assertions = nip85CountSource({
  pool,
  providers: (kind, tag) =>
    user.trustedProviders$.pipe(switchMap((list) => (list ? list.providersFor$(kind, tag) : of([])))),
});
```

`AssertionProvider` objects fit structurally, including their reactive `relays$`. Raw declarations from common helpers also work, scoped by their `kind` and `tag`; a raw declaration needs a relay hint to be queried. Trusting a provider for one metric does not trust it for every metric. Loaders adds no runtime dependency on common or relay.

### React

Share the service at application scope and let `use$` manage each component's demand:

```tsx
const reactions = use$(() => counts.event(event).reactions$, [event]);
const refreshing = use$(() => counts.event(event).reactions.refreshing, [event]);
```

Multiple components observing the same metric share one canonical resolution. Constructing new handles does not start requests or create another retained handle cache. Use a virtualized list so offscreen components release their subscriptions.

### Custom metrics and sources

Use stable versioned metric IDs and explicit units. A source's `policy(query)` stays observed after its finite `count(query, context)` settles. Change the policy identity whenever trust or routing changes. Return one valid safe nonnegative integer, complete empty when unsupported, and tear down work on unsubscribe. Dispatch transports with `context.transport.run(resources, factory)` so custom sources respect service limits and cancellation. Resource keys use `relay:<normalized-url>` and `provider:<pubkey>`.

### Debug logging

Enable the core logger namespaces before reproducing a network problem:

```ts
import { enableLoggerNamespaces } from "applesauce-core";

enableLoggerNamespaces("applesauce:count-service*,applesauce:count-sources:*");
```

Service logs cover policy changes, cache acceptance, resolution failures, retry/refresh scheduling, and teardown. The `:transport` child reports queue admission, wait duration, overload, and abandoned work. The `:sources:fallback`, `:sources:relay`, and `:sources:nip85` children trace attempts, relay refusals, assertion validation, missing-subject recovery, and shared-batch cancellation. Sources used outside a service use `applesauce:count-sources:*`.

Records include target/metric identifiers, relay/provider routes, batch IDs, and operation durations; they omit signed event bodies and content. A transport that emitted a reply before `take(1)` unsubscribed is logged as answered rather than cancelled. An empty operation, a failed operation, and cancellation before an answer have separate records.

Use `DEBUG='applesauce:count-service*'` in Node, or inject a parent logger to distinguish application instances:

```ts
import { logger } from "applesauce-core";

const counts = createCountService(pool, {
  relays: trustedRelays$,
  logger: logger.extend("timeline"),
});
```

That instance logs under `applesauce:timeline:count-service:*` and `applesauce:timeline:count-service`. Source adapters also accept `logger` to override their inherited parent. Logging is disabled unless its namespace is enabled, and it retains no history. Keep `diagnostic` for numerical instrumentation; debug logs explain individual operations.

## Best Practices

- Choose trusted ordered sources; bare totals cannot be merged safely.
- Keep recent-event TTLs short and older-event TTLs longer.
- Keep provider calculation semantics visible through provenance.
- Set relay capacity alongside the global limit; one relay with limit two can only run two transports.
